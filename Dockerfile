FROM node:20-alpine

# Install build dependencies for native modules (ssh2, better-sqlite3)
# libstdc++ is needed at runtime by native addons
RUN apk add --no-cache python3 make g++ gcc libc-dev libstdc++

WORKDIR /app

# Copy package files first for layer caching
COPY package.json ./

# Install dependencies
RUN npm install --production

# Remove build-only deps (keep libstdc++ for runtime)
RUN apk del python3 make g++ gcc libc-dev 2>/dev/null || true

# Runtime tools for port scanner
RUN apk add --no-cache iproute2 curl

# Copy application code
COPY server/ ./server/
COPY public/ ./public/

# Create directories for volumes
RUN mkdir -p /app/scripts /app/data /app/config

# Default port
ENV PORT=2222

EXPOSE 2222
EXPOSE 2000-2100

CMD ["node", "server/index.js"]
