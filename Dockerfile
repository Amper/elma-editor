# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production server
FROM node:20-slim
WORKDIR /app

# Install server dependencies
#COPY --from=frontend-build /app/server/package.json server/package-lock.json* ./server/
#RUN cd server && npm ci

COPY --from=frontend-build /app/server server
COPY --from=frontend-build /app/src/collab src/collab
COPY --from=frontend-build /app/src/types src/types
COPY --from=frontend-build /app/src/utils src/utils
COPY --from=frontend-build /app/package.json package.json
COPY --from=frontend-build /app/package-lock.json package-lock.json
COPY --from=frontend-build /app/dist dist

RUN npm ci --omit=dev
WORKDIR /app/server
RUN npm ci

EXPOSE 8080
CMD ["npx", "-y", "tsx", "index.ts"]
