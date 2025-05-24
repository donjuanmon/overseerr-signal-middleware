const express = require('express');
const axios = require('axios');
const sharp = require('sharp'); // <-- Added for image resizing
const app = express();
app.use(express.json());

// Configuration from environment variables
const PORT = process.env.PORT || 3001;
let SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://signal-cli:8080';
const SIGNAL_NUMBER = process.env.SIGNAL_NUMBER;

// Ensure the URL ends with /v2/send
if (!SIGNAL_API_URL.endsWith('/v2/send')) {
  // Remove any trailing slash first
  SIGNAL_API_URL = SIGNAL_API_URL.replace(/\/+$/, '');
  // Then add the path
  SIGNAL_API_URL = `${SIGNAL_API_URL}/v2/send`;
}

// Base URL for API status checks
const SIGNAL_BASE_URL = SIGNAL_API_URL.replace('/v2/send', '');

// Parse all recipients from a single environment variable, trim whitespace
const SIGNAL_RECIPIENTS = process.env.SIGNAL_RECIPIENTS
  ? process.env.SIGNAL_RECIPIENTS.split(',').map(r => r.trim())
  : [];

// Helper function to safely access nested properties
function getNestedValue(obj, path, defaultValue = 'unknown') {
  try {
    const keys = path.split('.');
    let result = obj;
    
    for (const key of keys) {
      if (result === undefined || result === null) return defaultValue;
      result = result[key];
    }
    
    return result || defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

// Format message with emojis (without text styling)
function formatMessage(message, event) {
  // Add event-specific emoji
  let eventEmoji = '🎬'; // Default movie emoji
  
  // Choose emoji based on notification type
  if (event.includes('Request Pending')) {
    eventEmoji = '⏳';
  } else if (event.includes('Automatically Approved') || event.includes('Approved')) {
    eventEmoji = '✅';
  } else if (event.includes('Available')) {
    eventEmoji = '🎉';
  } else if (event.includes('Declined')) {
    eventEmoji = '❌';
  } else if (event.includes('Failed')) {
    eventEmoji = '⚠️';
  } else if (event.includes('Issue')) {
    eventEmoji = '🔴';
  }
  
  // Parsing the message to find sections
  const lines = message.split('\n');
  
  // Replace first line with emoji
  if (lines.length > 0) {
    lines[0] = `${eventEmoji} ${lines[0]}`;
  }
  
  // Replace user and status lines with emojis
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('Requested By:')) {
      lines[i] = `👤 ${lines[i]}`;
    } else if (lines[i].startsWith('Request Status:')) {
      lines[i] = `📋 ${lines[i]}`;
    }
  }
  
  return lines.join('\n');
}

// Check Signal API health (without sending a message)
async function checkSignalAPI() {
  try {
    // Try to ping the about endpoint
    const response = await axios.get(`${SIGNAL_BASE_URL}/v1/about`, { timeout: 5000 });
    return { 
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      data: response.data 
    };
  } catch (error) {
    return { 
      ok: false, 
      error: error.message,
      status: error.response?.status || 'N/A'
    };
  }
}

// Add a health endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'OK',
    configuration: {
      signal_api: SIGNAL_API_URL,
      signal_base: SIGNAL_BASE_URL,
      signal_number: SIGNAL_NUMBER ? 'Set' : 'Not set',
      signal_recipients: SIGNAL_RECIPIENTS.length > 0 ? `Set (${SIGNAL_RECIPIENTS.length} recipients)` : 'Not set'
    }
  };
  
  // Check if Signal API is reachable
  const apiCheck = await checkSignalAPI();
  health.signal_api_check = apiCheck;
  
  // Return health status
  if (apiCheck.ok) {
    res.json(health);
  } else {
    res.status(500).json(health);
  }
});

app.post('/webhook', async (req, res) => {
  try {
    console.log('Received webhook from Overseerr');
    
    // Extract data from Overseerr payload - handling nested structure
    const notification_type = getNestedValue(req.body, 'notification_type');
    const event = getNestedValue(req.body, 'event');
    const subject = getNestedValue(req.body, 'subject');
    const message = getNestedValue(req.body, 'message');
    const image = getNestedValue(req.body, 'image');
    
    // Media details
    const media = req.body.media || {};
    const media_type = getNestedValue(media, 'media_type');
    const status = getNestedValue(media, 'status');
    
    // Request details
    const request = req.body.request || {};
    const requestedBy_username = getNestedValue(request, 'requestedBy_username');
    
    // Extract year from subject if possible
    let year = '';
    const yearMatch = subject.match(/\((\d{4})\)/);
    if (yearMatch && yearMatch[1]) {
      year = `(${yearMatch[1]})`;
    }
    
    // Format base message text - no TMDB ID, just year if available
    const title = subject.split(' (')[0];
    const formattedMessage = 
      `${event} - ${title} ${year}\n\n${message}\n\nRequested By: ${requestedBy_username}\nRequest Status: ${status || 'PENDING'}`;
    
    // Add emojis
    const finalMessage = formatMessage(formattedMessage, event);
    
    console.log('Formatted message:', finalMessage);
    
    // Prepare the base signal message payload (without recipients)
    const basePayload = {
      message: finalMessage,
      number: SIGNAL_NUMBER
    };

    // If there's an image URL, try to fetch and attach it
    let base64Image;
    if (image && image.startsWith('http')) {
      try {
        console.log('Attempting to fetch image:', image);
        
        // Download the image
        const imageResponse = await axios.get(image, { 
          responseType: 'arraybuffer',
          timeout: 5000 // 5 second timeout
        });

        // Resize the image to width=300px, height=450px (change as desired)
        const resizedBuffer = await sharp(imageResponse.data)
          .resize(150, 225, { fit: 'cover' }) // Change dimensions as needed
          .jpeg({ quality: 100 }) // You can use .png() if you prefer PNG
          .toBuffer();

        // Convert to base64
        base64Image = resizedBuffer.toString('base64');
        console.log('Successfully added resized image attachment');
      } catch (imageError) {
        console.error('Error processing image:', imageError.message);
        // Continue without the image if there's an error
      }
    }
    
    // Send to each recipient individually
    let sendErrors = [];
    for (const recipient of SIGNAL_RECIPIENTS) {
      const signalPayload = {
        ...basePayload,
        recipients: [recipient]
      };
      if (base64Image) {
        signalPayload.base64_attachments = [base64Image];
      }

      // Log the payload for debugging (but truncate the image data)
      console.log('Signal payload:', JSON.stringify({
        ...signalPayload,
        base64_attachments: signalPayload.base64_attachments ? ['[Image data truncated]'] : []
      }));

      // Send to signal-cli-rest-api
      try {
        console.log(`Sending to Signal API for recipient: ${recipient}...`);
        const response = await axios.post(SIGNAL_API_URL, signalPayload);
        console.log('Signal API response:', response.status, response.statusText);
      } catch (err) {
        console.error(`Failed to send to recipient ${recipient}:`, err.message);
        sendErrors.push({ recipient, error: err.message });
      }
    }
    
    if (sendErrors.length === 0) {
      res.status(200).send('Notification sent to all Signal recipients');
    } else if (sendErrors.length === SIGNAL_RECIPIENTS.length) {
      res.status(500).send(`Failed to send notification to any Signal recipients: ${JSON.stringify(sendErrors)}`);
    } else {
      res.status(206).send(`Notification sent to some recipients, but failed for: ${JSON.stringify(sendErrors)}`);
    }
  } catch (error) {
    console.error('Error processing webhook:', error.message);
    if (error.response) {
      console.error('Response data:', JSON.stringify(error.response.data || {}));
      console.error('Response status:', error.response.status);
    }
    res.status(500).send(`Error: ${error.message}`);
  }
});

// Check API at startup
(async () => {
  try {
    console.log(`Middleware server starting - checking Signal API at ${SIGNAL_BASE_URL}/v1/about...`);
    const apiHealth = await checkSignalAPI();
    if (apiHealth.ok) {
      console.log('Signal API is reachable:', apiHealth);
    } else {
      console.warn('WARNING: Signal API may not be reachable:', apiHealth);
      console.warn('This might cause failures when sending notifications.');
      console.warn('Check your SIGNAL_API_URL configuration and make sure signal-cli-rest-api is running.');
    }
  } catch (error) {
    console.error('Error checking Signal API:', error.message);
  }
  
  // Start server regardless of API check
  app.listen(PORT, () => {
    console.log(`Middleware server running on port ${PORT}`);
  });
})();
