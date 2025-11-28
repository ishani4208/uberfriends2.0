// db.js
import pkg from "pg";
const { Pool } = pkg;

export const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "ridesdb",
  password: "1234abc",
  port: 5432,
});
