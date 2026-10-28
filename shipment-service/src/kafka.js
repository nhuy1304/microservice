import { Kafka } from "kafkajs";
import dotenv from "dotenv";

dotenv.config();

const kafka = new Kafka({
  clientId: "shipment-service",
  brokers: [process.env.KAFKA_BROKER],
});

const consumer = kafka.consumer({
  groupId: "shipment-service-group",
});

export const connectKafkaConsumer = async (onOrderCreated) => {
  await consumer.connect();

  console.log(
    "Shipment Service connected to Kafka successfully"
  );

  await consumer.subscribe({
    topic: "order-created",
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const event = JSON.parse(
          message.value.toString()
        );

        if (event.event !== "OrderCreated") {
          return;
        }

        console.log(
          `Received OrderCreated event for oid=${event.oid}`
        );

        await onOrderCreated(event);
      } catch (error) {
        console.error(
          "Failed to process Kafka message:",
          error
        );
      }
    },
  });
};