// db.js
import pkg from "pg";
const { Pool } = pkg;

export const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "uber-2",
  password: "ishaninotokbutwhocares",
  port: 5432,
});
