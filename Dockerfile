FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

ARG VERSION=dev
ENV VERSION=${VERSION}

# Install all dependencies (including devDeps for build)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build client and server
RUN node build-client.js
RUN npx tsc -p tsconfig.server.json

# Production stage
FROM node:22-alpine AS production
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=base /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/server/index.js"]
