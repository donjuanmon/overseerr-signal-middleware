FROM node:18-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy application code
COPY index.js ./

# Create a non-root user and switch to it
RUN addgroup -S signalgroup && adduser -S signalbot -G signalgroup
USER signalbot

EXPOSE 3001

CMD ["node", "index.js"]
