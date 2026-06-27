FROM oven/bun:1.3-debian AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run build

FROM base AS prod-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS release
COPY --from=build /app/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY server.ts server-lib ./server-lib/
COPY zosite.json ./
ENV NODE_ENV=production
EXPOSE 56401
CMD ["bun", "run", "server.ts"]


# Tiny standalone usage:
#   docker build -t scorm-builder .
#   docker run --rm -p 56401:56401 scorm-builder
# Then open http://localhost:56401