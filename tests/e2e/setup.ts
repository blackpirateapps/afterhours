import { execFileSync } from "node:child_process";
import { fixtureEnv } from "../fixtures/e2e-config";
import { requireTestDatabase } from "../fixtures/test-target";

export default function setup() {
  requireTestDatabase();
  const cookies = execFileSync(
    "pnpm",
    ["exec", "tsx", "--conditions=react-server", "tests/fixtures/seed-e2e.ts"],
    { env: { ...process.env, ...fixtureEnv }, encoding: "utf8" },
  );
  process.env.AFTERHOURS_FIXTURE_COOKIES = JSON.stringify(JSON.parse(cookies));
}
