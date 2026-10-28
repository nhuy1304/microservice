CREATE TABLE IF NOT EXISTS "MemberShip" (
    mid SERIAL PRIMARY KEY,
    mname VARCHAR(50) NOT NULL,
    score INT NOT NULL
);

CREATE TABLE IF NOT EXISTS "Customer" (
    uid INT PRIMARY KEY,
    fullname VARCHAR(100) NOT NULL,
    mid INT NOT NULL,
    CONSTRAINT "Customer_mid_fkey"
        FOREIGN KEY (mid)
        REFERENCES "MemberShip"(mid)
);