# Hrika HRMS — production image.
# Node 22+ is required for the built-in node:sqlite module (no native build step).
FROM node:22-slim

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package*.json ./
RUN npm install --omit=dev

# App source.
COPY . .

# Runtime config. DATA_DIR points at the mounted persistent volume so the
# SQLite database and uploaded files survive restarts/redeploys.
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data

EXPOSE 8080

CMD ["node", "server/index.js"]
