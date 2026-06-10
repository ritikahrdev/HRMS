# Hrika HRMS — production image (Postgres/Supabase build).
# Stateless: the database AND uploaded files live in Postgres (Supabase), so
# no persistent disk/volume is required — runs on free tiers (Render free, etc).
FROM node:22-slim

WORKDIR /app

# Install dependencies first (better layer caching).
COPY package*.json ./
RUN npm install --omit=dev

# App source.
COPY . .

ENV NODE_ENV=production
# The host (Render/Railway) injects PORT; the app reads process.env.PORT.
ENV PORT=8080
EXPOSE 8080

# Required at runtime (set these as environment variables on the host):
#   DATABASE_URL    postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres
#   SESSION_SECRET  a long random string
CMD ["node", "server/index.js"]
