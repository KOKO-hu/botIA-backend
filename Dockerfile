# syntax=docker/dockerfile:1

# ---------- Build stage ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Install OS deps (some libs may require builds)
RUN apk add --no-cache python3 make g++

# Copy only package manifests first for better layer caching
COPY package*.json ./

# Install dependencies (including dev deps for build)
RUN npm ci

# Copy source
COPY . .

# Build the NestJS project
RUN npm run build

# Prune devDependencies to slim runtime image
RUN npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy runtime node_modules and built dist from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json


# The app listens on 3000 by default
EXPOSE 3000

# Use non-root user for security
RUN addgroup -S nodejs && adduser -S nodeuser -G nodejs
USER nodeuser

# Start the server
CMD ["node", "dist/main.js"]
