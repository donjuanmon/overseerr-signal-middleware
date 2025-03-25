const express = require('express');
const axios = require('axios');
const app = express();
app.use(express.json());

// Configuration from environment variables
const PORT = process.env.PORT || 3001;
const SIGNAL_API_URL = process.env.SIGNAL_API_URL;
const SIGNAL_NUMBER = process.env.SIGNAL_NUMBER;
// Parse all recipients from a single environment variable
const SIGNAL_RECIPIENTS = process.env.SIGNAL_RECIPIENTS ? process.env.SIGNAL_RECIPIENTS.split(',') : [];

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
    
    // Prepare the signal message payload
    const signalPayload = {
      message: finalMessage,
      number: SIGNAL_NUMBER,
      recipients: SIGNAL_RECIPIENTS
    };
    
    // If there's an image URL, try to fetch and attach it
    if (image && image.startsWith('http')) {
      try {
        console.log('Attempting to fetch image:', image);
        
        // Download the image
        const imageResponse = await axios.get(image, { 
          responseType: 'arraybuffer',
          timeout: 5000 // 5 second timeout
        });
        
        // Convert to base64
        const base64Image = Buffer.from(imageResponse.data).toString('base64');
        
        // Add to payload
        signalPayload.base64_attachments = [base64Image];
        console.log('Successfully added image attachment');
      } catch (imageError) {
        console.error('Error processing image:', imageError.message);
        // Continue without the image if there's an error
      }
    }
    
    // Send to signal-cli-rest-api
    console.log('Sending to Signal API...');
    const response = await axios.post(SIGNAL_API_URL, signalPayload);
    console.log('Signal API response:', response.status, response.statusText);
    
    res.status(200).send('Notification sent to Signal');
  } catch (error) {
    console.error('Error processing webhook:', error.message);
    res.status(500).send(`Error: ${error.message}`);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Middleware server running on port ${PORT}`);
});
