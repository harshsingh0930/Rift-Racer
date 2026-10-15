# syntax=docker/dockerfile:1

FROM node:22-alpine AS build

WORKDIR /app

# Keep dependency installation cacheable. The repository currently has no
# lockfile, so fall back to npm install until one is committed.
COPY package*.json ./
RUN if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund; \
    else \
      npm install --no-audit --no-fund; \
    fi

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Vite preview is intentionally used here because it is the existing package
# script and keeps the container path identical to local verification.
COPY --from=build /app /app

EXPOSE 4173
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
