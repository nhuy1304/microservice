FROM node:20-alpine

WORKDIR /app/order-service

COPY order-service/package*.json ./

RUN npm ci --omit=dev

COPY order-service/ ./
COPY proto/ /app/proto/

EXPOSE 3003

CMD ["npm", "start"]