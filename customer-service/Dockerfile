FROM node:20-alpine

WORKDIR /app/customer-service

COPY customer-service/package*.json ./

RUN npm ci --omit=dev

COPY customer-service/ ./
COPY proto/ /app/proto/

EXPOSE 3002
EXPOSE 50051

CMD ["npm", "start"]