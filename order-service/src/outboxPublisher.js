import pool from "./db.js";
import producer from "./kafka.js";

let isPublishing = false;

const publishPendingEvents = async () => {
  if (isPublishing) {
    return;
  }

  isPublishing = true;

  try {
    const result = await pool.query(
      `SELECT id, event_type, aggregate_id, payload
       FROM "Outbox"
       WHERE status = 'PENDING'
       ORDER BY id
       LIMIT 20`
    );

    for (const row of result.rows) {
      try {
        await producer.send({
          topic: "order-created",
          messages: [
            {
              key: String(row.aggregate_id),
              value: JSON.stringify(row.payload),
            },
          ],
        });

        await pool.query(
          `UPDATE "Outbox"
           SET status = 'PUBLISHED'
           WHERE id = $1
             AND status = 'PENDING'`,
          [row.id]
        );

        console.log(
          `Outbox published: id=${row.id}, oid=${row.aggregate_id}`
        );
      } catch (error) {
        console.error(
          `Outbox publish failed: id=${row.id}, oid=${row.aggregate_id}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error(
      "Outbox Publisher failed:",
      error.message
    );
  } finally {
    isPublishing = false;
  }
};

export const startOutboxPublisher = () => {
  // Thử gửi ngay khi service khởi động
  publishPendingEvents();

  // Sau đó kiểm tra lại các event PENDING mỗi 5 giây
  setInterval(() => {
    publishPendingEvents();
  }, 5000);

  console.log("Outbox Publisher started");
};