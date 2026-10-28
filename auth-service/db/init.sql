CREATE TABLE IF NOT EXISTS "Role" (
    roleid SERIAL PRIMARY KEY,
    rolename VARCHAR(50) NOT NULL
);

CREATE TABLE IF NOT EXISTS "User" (
    uid SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    password VARCHAR(255) NOT NULL,
    roleid INT NOT NULL,
    CONSTRAINT "User_roleid_fkey"
        FOREIGN KEY (roleid)
        REFERENCES "Role"(roleid)
);