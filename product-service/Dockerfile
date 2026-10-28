FROM node:20-alpine

WORKDIR /app/product-service

COPY product-service/package*.json ./

RUN npm ci --omit=dev

COPY product-service/ ./
COPY proto/ /app/proto/

EXPOSE 3004
EXPOSE 50052

CMD ["npm", "start"]