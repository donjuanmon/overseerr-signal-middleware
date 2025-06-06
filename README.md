# overseerr-signal-middleware

A middleware service that forwards Overseerr notifications to Signal messenger, allowing you to receive updates about your media requests directly in Signal.

Designed to replicate the Telegram notification as closely as possible.

## Features

- Forwards Overseerr notifications to Signal messenger
- Supports sending to both individual recipients and groups
- Formats messages with emojis for better readability
- Attaches media images when available
- Highly configurable through environment variables

## Requirements

This middleware requires:

1. [Overseerr](https://github.com/sct/overseerr) - A request management and media discovery tool
2. [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) - REST API for Signal messenger

## Usage

### Using Docker Compose

```yaml
version: '3'
services:
  overseerr-signal-middleware:
    image: ghcr.io/donjuanmon/overseerr-signal-middleware:latest
    container_name: overseerr-signal-middleware
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      - SIGNAL_API_URL=http://signal-cli-rest-api:8080
      - SIGNAL_NUMBER=+123456789
      # Can include phone numbers and/or group IDs, comma-separated
      - SIGNAL_RECIPIENTS=+987654321,+1234567890,group.this.is.a.group.id
```

### Full Stack Example

Here's an example docker-compose.yml that includes Overseerr, signal-cli-rest-api, and this middleware:

```yaml
version: '3'
services:
  overseerr:
    image: sctx/overseerr:latest
    container_name: overseerr
    environment:
      - LOG_LEVEL=debug
      - TZ=Asia/Tokyo
      - PORT=5055
    ports:
      - 5055:5055
    volumes:
      - ./overseerr-config:/app/config
    restart: unless-stopped

  signal-cli-rest-api:
    image: bbernhard/signal-cli-rest-api:latest
    container_name: signal-cli-rest-api
    environment:
      - MODE=normal
    ports:
      - "8080:8080"
    volumes:
      - ./signal-cli-config:/home/.local/share/signal-cli
    restart: unless-stopped

  overseerr-signal-middleware:
    image: ghcr.io/donjuanmon/overseerr-signal-middleware:latest
    container_name: overseerr-signal-middleware
    restart: unless-stopped
    ports:
      - "3001:3001"
    environment:
      - SIGNAL_API_URL=http://signal-cli-rest-api:8080
      - SIGNAL_NUMBER=+123456789
      - SIGNAL_RECIPIENTS=+987654321,+1234567890,group.this.is.a.group.id
    depends_on:
      - signal-cli-rest-api
```

### Environment Variables

- `SIGNAL_API_URL`: Base URL to the signal-cli-rest-api endpoint (e.g., `http://signal-cli-rest-api:8080`). The `/v2/send` endpoint will be added automatically.
- `SIGNAL_NUMBER`: Your Signal phone number used for sending messages
- `SIGNAL_RECIPIENTS`: Comma-separated list of Signal recipient phone numbers and/or group IDs

### Overseerr Configuration

In Overseerr, add a webhook notification agent with the URL pointing to your middleware service:

1. Go to Settings > Notifications > Webhook
2. Enable the webhook agent
3. Set the Webhook URL to `http://signal-cli-rest-api:3001/webhook`. Note this name is based on the service name in the docker-compose.yml
4. Leave authorization headers blank
5. Leave the JSON payload as default
6. Enable the notification types you want to receive in Signal

## Setup Instructions

### Signal CLI REST API Setup

1. First, set up signal-cli-rest-api according to its [documentation](https://github.com/bbernhard/signal-cli-rest-api)
2. Register your phone number with Signal through the API
3. Make note of your phone number (with country code) for the `SIGNAL_NUMBER` environment variable

### Finding Your Signal Group ID

To find a Signal group ID:

1. Set up the signal-cli-rest-api container
2. List your groups with: `curl http://your-server:8080/v1/groups/{your-number}`
3. Use the returned group ID in the `SIGNAL_RECIPIENTS` environment variable
4. Individual phone numbers can be used as well

## Building from Source

```bash
# Clone the repository
git clone https://github.com/donjuanmon/overseerr-signal-middleware.git
cd overseerr-signal-middleware

# Install dependencies
npm install

# Run the server
npm start
```

## Troubleshooting

It may be necessary to create the group via signal-cli-rest-api before sending messages to it. This can be done with a POST request to `http://your-server:8080/v1/groups/{your-number}`. Using an existing group caused some members to not receive messages.

## License

ISC
