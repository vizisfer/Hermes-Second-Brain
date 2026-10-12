# Minimal LiveKit Node.js agent runtime.
FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update -qq \
  && apt-get install --no-install-recommends -y ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system app \
  && useradd --system --gid app --home-dir /app --shell /usr/sbin/nologin app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=app:app src/ ./src/

USER app
CMD ["npm", "start"]
