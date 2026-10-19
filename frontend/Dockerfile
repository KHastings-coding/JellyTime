FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json .
RUN npm install

COPY public ./public
COPY src ./src
COPY scripts ./scripts

# Build arg for API URL (nginx will proxy /api so leave as /api)
ENV REACT_APP_API_URL=/api
ENV GENERATE_SOURCEMAP=false

# Run prebuild first to generate PWA icons
RUN npm run prebuild

RUN npm run build

# Production nginx stage
FROM nginx:alpine

COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
