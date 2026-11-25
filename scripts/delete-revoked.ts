import { loadEnvFile } from "node:process";
import { getPool, transaction } from "../src/server/db";
import { allowedIds } from "../src/server/env";
import { lockBudget } from "../src/server/sync/storage";

if (process.env.ENV_FILE) loadEnvFile(process.env.ENV_FILE);

const [githubId, flag, ...extra] = process.argv.slice(2);
if (
  !githubId ||
  !/^[1-9]\d*$/.test(githubId) ||
  (flag && flag !== "--apply") ||
  extra.length
) {
  console.error(
    "Usage: pnpm operator:delete-revoked <numeric-github-id> [--apply]",
  );
  process.exit(1);
}

const target = `SELECT c.id FROM lastfm_connections c
  JOIN account a ON a.user_id = c.user_id AND a.provider_id = 'github' WHERE a.account_id = $1`;
try {
  if (allowedIds().includes(githubId))
    throw new Error("Account is still authorized");
  const count =
    flag === "--apply"
      ? await transaction(async (client) => {
          await lockBudget(client);
          const result = await client.query(
            `DELETE FROM lastfm_connections WHERE id IN (${target})`,
            [githubId],
          );
          return result.rowCount;
        })
      : (await getPool().query(target, [githubId])).rowCount;
  console.info(
    JSON.stringify({
      mode: flag === "--apply" ? "applied" : "dry-run",
      connections: count,
    }),
  );
} catch {
  console.error(
    "Operation failed. Check that the GitHub ID is revoked and the target is configured.",
  );
  process.exitCode = 1;
} finally {
  try {
    await getPool().end();
  } catch {
    /* Configuration failed before a pool was created. */
  }
}
