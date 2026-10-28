import { Kafka } from "kafkajs";
import dotenv from "dotenv";

dotenv.config();

const kafka = new Kafka({
  clientId: "order-service",
  brokers: [process.env.KAFKA_BROKER],
});

const producer = kafka.producer();

export const connectKafkaProducer = async () => {
  try {
    await producer.connect();

    console.log(
      "Order Service connected to Kafka successfully"
    );
  } catch (error) {
    console.error(
      "Order Service failed to connect to Kafka:",
      error
    );

    throw error;
  }
};

export default producer;