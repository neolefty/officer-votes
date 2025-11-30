FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/client/package.json ./packages/client/
RUN pnpm install --frozen-lockfile || pnpm install

# Build shared
FROM deps AS build-shared
COPY packages/shared ./packages/shared
COPY tsconfig.json ./
RUN pnpm --filter shared build

# Build client
FROM build-shared AS build-client
COPY packages/client ./packages/client
RUN pnpm --filter client build

# Build server
FROM build-shared AS build-server
COPY packages/server ./packages/server
RUN pnpm --filter server build

# Production
FROM base AS production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/server/node_modules ./packages/server/node_modules
COPY --from=build-shared /app/packages/shared/dist ./packages/shared/dist
COPY --from=build-shared /app/packages/shared/package.json ./packages/shared/
COPY --from=build-server /app/packages/server/dist ./packages/server/dist
COPY --from=build-server /app/packages/server/package.json ./packages/server/
COPY --from=build-client /app/packages/client/dist ./packages/client/dist
COPY package.json pnpm-workspace.yaml ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "packages/server/dist/index.js"]
