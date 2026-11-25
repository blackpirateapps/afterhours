// Schema generation only. The adapter does not connect to the placeholder DSN.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/node-postgres";

export const auth = betterAuth({
  baseURL: "http://localhost:3000",
  secret: "schema-generator-placeholder-value-only",
  database: drizzleAdapter(drizzle("postgresql://generator@localhost/unused"), {
    provider: "pg",
  }),
});
