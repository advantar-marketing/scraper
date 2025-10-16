FROM node:20-bullseye

# Install minimal libs for Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
  libasound2 libatk1.0-0 libatk-bridge2.0-0 libcairo2 libcups2 \
  libdbus-1-3 libexpat1 libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 \
  libnspr4 libnss3 libpango-1.0-0 libx11-6 libx11-xcb1 libxcb1 \
  libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 fonts-liberation ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

# Create /data directory and copy clubs.json there
RUN mkdir -p /data
COPY clubs.json /data/clubs.json

ENV NODE_ENV=production
ENV CLUBS_FILE=/data/clubs.json
ENV OUTPUT_FILE=/data/players.json
ENV ERROR_LOG_FILE=/data/errors.json

CMD ["node", "index.js"]


