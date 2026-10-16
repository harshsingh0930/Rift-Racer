# syntax=docker/dockerfile:1

FROM node:24.19.0-alpine AS build

WORKDIR /app

# Keep dependency installation cacheable and reproducible from the lockfile.
COPY package*.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN --network=none npm test
RUN --network=none npm run build

FROM node:24.19.0-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Vite preview is intentionally used here because it is the existing package
# script and keeps the container path identical to local verification.
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 4173
USER node
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173"]
