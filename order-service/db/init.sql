CREATE TABLE IF NOT EXISTS "Order" (
    oid SERIAL PRIMARY KEY,
    uid INT NOT NULL,
    discount DECIMAL(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS "OrderDetail" (
    oid INT NOT NULL,
    pid INT NOT NULL,
    qty INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,

    PRIMARY KEY (oid, pid),

    CONSTRAINT "OrderDetail_oid_fkey"
        FOREIGN KEY (oid)
        REFERENCES "Order"(oid)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Outbox" (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(100) NOT NULL,
    aggregate_id INT NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);