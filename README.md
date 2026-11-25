# Afterhours

Afterhours is a private, invite-only listening dashboard for a non-commercial pilot of up to ten GitHub identities. Each member connects one public Last.fm username and confirms that they use that account. The connection status reflects this self-attestation.

## Local development

Use Node.js 24 from `.nvmrc` and the exact pnpm release declared in `package.json`. Use a separate local database or an isolated Neon development branch.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
ENV_FILE=.env.local pnpm check:env --operator
ENV_FILE=.env.local pnpm db:migrate
pnpm dev
```

Fill in `.env.local` before the environment check. Register a GitHub OAuth App with a callback at `http://localhost:3000/api/auth/callback/github` for the example local origin. Use `pnpm build` and `pnpm start` to exercise the production server. The build requires no credentials, database, or external asset fetches. Pages show a configuration message and affected APIs return a configuration error when runtime inputs are missing.

## Deploy to Vercel and Neon

1. Create a Neon database for production and an independent, initially empty staging database or Neon branch. For previews use a stable branch URL or a dedicated preview project and domain that retains the same origin across deployments. Create the staging branch from a clean base. Use dedicated GitHub OAuth Apps, independent secrets, and separate database targets for production, preview, and local development.
2. For each origin, register a GitHub OAuth App and use the exact callback `<origin>/api/auth/callback/github`. The app requests `read:user` and `user:email` for identity. Look up each member's numeric ID with `gh api users/<login> --jq .id`. Configure one to ten distinct positive decimal IDs. Changes to the deployed allowlist apply to existing sessions on their next protected request, so redeploy the updated environment to revoke access.
3. Obtain a Last.fm API key dedicated to this pilot. Generate each application secret independently, for example with two separate runs of `openssl rand -hex 32`. Scope Vercel environment variables to the deployment environment.
4. Connect the repository to Vercel and use the Next.js preset with Node.js 24.x. Fluid Compute is enabled in `vercel.json`. In the Vercel project's function-region settings, choose the region nearest the actual Neon database. Vercel Hobby is suitable only for an eligible non-commercial pilot. Confirm current usage, function-duration, and cron limits before enabling the schedule. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) · [Vercel function limits](https://vercel.com/docs/functions/limitations)
5. Check each environment's variables locally using `ENV_FILE=<file> pnpm check:env --operator`, then apply migrations using `ENV_FILE=<file> pnpm db:migrate`. Compare the intended Neon project, branch, database, and direct host in your operator configuration with the Neon console before applying. Keep the direct DSN in the operator environment. Apply migrations before enabling traffic or cron. [Neon connection documentation](https://neon.com/docs/connect/connect-from-any-app) · [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
6. Deploy the migrated revision to the isolated preview. Verify the callback with an invited GitHub identity and a non-invited identity, check secure cookies and CSP in the browser, connect your real public Last.fm profile, and verify the initial import and a subsequent incremental sync. Disconnect to verify removal. After the production rollout, verify the `0 3 * * *` UTC job and its latest invocation under the project's Cron Jobs and Logs views. Hobby scheduling may run within the scheduled hour.

| Variable                                   | Value                                                                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                             | Pooled Neon runtime DSN. Include `sslmode=require` or `sslmode=verify-full`. The PostgreSQL client validates the server certificate. |
| `DATABASE_URL_UNPOOLED`                    | Direct Neon DSN for the operator migration command.                                                                                  |
| `BETTER_AUTH_URL`                          | Exact canonical origin, with HTTPS on Vercel.                                                                                        |
| `BETTER_AUTH_SECRET`                       | Independent cryptographically random secret, at least 32 bytes.                                                                      |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Credentials for the environment's GitHub OAuth App.                                                                                  |
| `APP_ALLOWED_GITHUB_IDS`                   | CSV of one to ten distinct positive decimal GitHub IDs.                                                                              |
| `LASTFM_API_KEY`                           | Dedicated Last.fm API key.                                                                                                           |
| `CRON_SECRET`                              | Independent cryptographically random secret, at least 32 bytes.                                                                      |

Test cron against the intended isolated environment using its exact bearer token. A correct request returns aggregate counts for processed, succeeded, pending, skipped, and failed work.

```sh
curl --fail-with-body -sS \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "${BETTER_AUTH_URL}/api/cron/sync"
```

Redeploy the preceding compatible application revision to roll back. Keep migrations forward-compatible while an older deployment can receive traffic. For a planned destructive migration, test it on an isolated branch, record the restore point and schema compatibility, and verify a recovery branch before cutover. Govern the lifecycle of any retained backups and recovery copies under the same provider-data review as the primary database.

## Data and operations

- The initial import covers up to 30 elapsed days and 2,000 unique plays. The retention job trims each account to the latest 90 elapsed days and newest 10,000 records. Read queries apply the elapsed cutoff immediately. The day filters and chart reflect the member's selected IANA zone, including daylight saving transitions. Dashboard and statistics count saved plays.
- A completed play's source identity is the SHA-256 of a JSON array containing the UTC second plus trimmed NFC artist, track, and album strings. Replays at different seconds remain distinct. Identical same-second source fields collapse because the feed supplies no event ID. Derived groups use Unicode NFKC, whitespace collapse, trim, and lowercase.
- The service imports recent tracks newest first, with fixed window bounds and a two-minute safety delay. Subsequent windows include a ten-minute overlap. Mutable pagination, late or backdated plays outside the overlap, and downtime can leave gaps. Sync errors preserve earlier checkpointed pages. Manual sync has a 60-second owner cooldown and the scheduled run advances pending windows. Provider traffic shares a database-backed one-start-per-second gate and global backoff.
- The 50,000,000-byte logical limit counts every stored canonical Last.fm username, all play timestamps, display and normalized text, source hashes, and each cover's normalized identities, URL, and timestamp. The SQL charges UTF-8 bytes for fixed-order PostgreSQL JSON arrays and one delimiter byte per row. The limit spans all accounts in one database. Backups, other deployments, and actual storage and API usage need separate review.
- Last.fm's API terms describe a 100 MB aggregate usage cap, caching according to response headers, attribution, and a separate agreement for commercial use. Afterhours makes uncached import requests and retains a bounded derived listening history and approved cover URLs. Direct cover requests follow browser caching and referrer controls. Review this intended use with Last.fm before release if retention or caching permission is unclear, and seek review for broader retention, public rollout, or commercial use. The internal limit provides storage headroom. [Last.fm API terms](https://www.last.fm/api/tos) · [API introduction](https://www.last.fm/api/intro) · [Recent tracks](https://www.last.fm/api/show/user.getRecentTracks) · [Profile lookup](https://www.last.fm/api/show/user.getInfo)
- To purge a revoked member's imported data, run `ENV_FILE=<file> pnpm operator:delete-revoked <github-id>` against the intended environment. Review the dry-run count, then repeat with `--apply`. Profile disconnect deletes the connection, checkpoint, plays and cover metadata. Preferences are held separately. Review backup lifecycles for data deletion requests.
- Application JSON errors include `error.code`, `error.message`, and a request ID. Check logs by request ID. Generic infrastructure errors may carry an HTTP 5xx status. Sync failures and cron summaries emit counts, timing, and result codes. Report opaque request IDs when seeking support.

## Routes and verification

The application exposes `/`, `/sign-in`, `/dashboard`, `/history`, `/stats`, and `/profile`. It provides the GitHub sign-in, callback, session and sign-out endpoints under `/api/auth`, plus `/api/history`, `/api/preferences`, `/api/lastfm/connection`, `/api/lastfm/sync`, and `/api/cron/sync`.

```sh
pnpm lint
pnpm typecheck
pnpm format:check
pnpm test
pnpm db:generate
pnpm build
```

Integration and browser fixtures require a disposable loopback database named `afterhours_test`. The seed processes reset test tables. Start a fresh local PostgreSQL instance and export the matching DSNs. CI uses a fresh PostgreSQL service for each run.

```sh
export DATABASE_URL=postgresql://postgres:afterhours_test@127.0.0.1:5432/afterhours_test
export DATABASE_URL_UNPOOLED="$DATABASE_URL"
pnpm db:migrate
pnpm db:migrate
pnpm test:integration
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

Run `CAPTURE_SCREENSHOTS=1 pnpm test:e2e` to refresh the checked-in screenshots. Playwright starts the production build, freezes the clock outside application code, and creates ordinary database sessions from Better Auth's test utilities in a separate process. Fixture accounts, cover images, and transport stubs live under `tests/`. See [the visual reference](docs/visual-reference.md) for the screenshot locations and comparison.
