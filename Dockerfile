FROM node:20

WORKDIR /app

COPY package*.json ./
# Install ALL dependencies (including dev) to ensure prisma CLI is available
RUN npm ci

COPY prisma ./prisma
# Generate Prisma Client
RUN npx prisma generate

COPY . .

# Expose backend port
EXPOSE 5003

# Run migrations and start the server
CMD ["/bin/sh", "-c", "npx prisma migrate deploy && node src/index.js"]
