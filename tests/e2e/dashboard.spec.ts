import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { fixtureEnv, testOrigin } from "../fixtures/e2e-config";

type Cookie = Parameters<BrowserContext["addCookies"]>[0][number];
type User = "listener" | "empty" | "revoked" | "error" | "media";

async function session(context: BrowserContext, user: User) {
  const cookies: Record<User, Cookie[]> = JSON.parse(
    process.env.AFTERHOURS_FIXTURE_COOKIES!,
  );
  await context.clearCookies();
  await context.addCookies(cookies[user]);
}

async function visuals(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-25T20:00:00Z"));
  await page.route("https://lastfm.freetls.fastly.net/**", async (route) => {
    const match = new URL(route.request().url()).pathname.match(
      /fixture-(city|coral|train|mono)\.jpg$/,
    );
    if (!match) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({
      contentType: "image/jpeg",
      body: readFileSync(resolve("tests/fixtures/covers", `${match[1]}.jpg`)),
    });
  });
  await page.route("https://avatars.githubusercontent.com/**", (route) =>
    route.fulfill({
      contentType: "image/jpeg",
      body: readFileSync(resolve("tests/fixtures/covers/avatar.jpg")),
    }),
  );
}

test("serves the credential-protected routes, nonce CSP, and a real OAuth authorization request", async ({
  page,
  request,
}) => {
  const response = await page.goto("/");
  await expect(page).toHaveURL("/sign-in");
  expect(response?.headers()["cache-control"]).toContain("private, no-store");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("form-action 'self'");
  expect(csp).not.toContain("unsafe-eval");
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const inline = await page
    .locator("script:not([src])")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLScriptElement).nonce),
    );
  expect(inline.length).toBeGreaterThan(0);
  expect(inline.every((value) => value === nonce)).toBe(true);
  const assets = await page
    .locator("script[src]")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLScriptElement).src),
    );
  for (const asset of assets) {
    const text = await (await request.get(asset)).text();
    for (const secret of [
      fixtureEnv.BETTER_AUTH_SECRET,
      fixtureEnv.CRON_SECRET,
      fixtureEnv.GITHUB_CLIENT_SECRET,
      fixtureEnv.LASTFM_API_KEY,
    ])
      expect(text).not.toContain(secret);
  }
  expect((await request.get("/api/history")).status()).toBe(401);
  expect((await request.get("/api/cron/sync")).status()).toBe(401);
  const disabled = await request.post("/api/auth/sign-in/email", {
    data: { email: "fixture@example.test" },
  });
  expect(disabled.status()).toBe(404);
  await page.route("https://github.com/login/oauth/authorize?*", (route) =>
    route.fulfill({ body: "GitHub destination fixture" }),
  );
  await page.getByRole("button", { name: "Continue with GitHub" }).click();
  await expect(page).toHaveURL(
    /^https:\/\/github\.com\/login\/oauth\/authorize/,
  );
  const oauth = new URL(page.url());
  expect(oauth.searchParams.get("client_id")).toBe(fixtureEnv.GITHUB_CLIENT_ID);
  expect(oauth.searchParams.get("redirect_uri")).toBe(
    `${testOrigin}/api/auth/callback/github`,
  );
  expect(oauth.searchParams.get("state")).toBeTruthy();
  expect(oauth.searchParams.get("scope")?.split(" ").sort()).toEqual([
    "read:user",
    "user:email",
  ]);
});

test("enforces invites, revocation, same-origin mutations, validation, and owner isolation", async ({
  page,
  context,
}) => {
  await session(context, "revoked");
  await page.goto("/stats");
  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "This GitHub account needs an invite.",
  );
  expect((await context.request.get("/api/history")).status()).toBe(403);

  await session(context, "listener");
  await visuals(page);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Listening dashboard" }),
  ).toBeVisible();
  await page.goto("http://127.0.0.1:3171/dashboard");
  await expect(page.locator("main").getByRole("alert")).toHaveText(
    "This GitHub account needs an invite.",
  );
  expect(
    (
      await context.request.get("http://127.0.0.1:3171/api/auth/get-session")
    ).status(),
  ).toBe(403);

  const original = await context.request.get("/api/history");
  expect(original.status()).toBe(200);
  const payload = await original.json();
  expect(payload.items.length).toBe(25);
  expect(payload.items[0]).toMatchObject({
    track: "Literal %_! Midnight",
  });
  const crossOrigin = await context.request.patch("/api/preferences", {
    data: { timeZone: "UTC", reduceMotion: true },
    headers: { Origin: "https://example.test" },
  });
  expect(crossOrigin.status()).toBe(403);
  expect(await crossOrigin.json()).toMatchObject({
    error: { code: "invalid_origin" },
    requestId: expect.any(String),
  });
  const invalid = await context.request.post("/api/lastfm/connection", {
    data: { username: "afterdark_demo", confirmOwnership: false },
    headers: { Origin: testOrigin },
  });
  expect(invalid.status()).toBe(400);
  const oversized = await context.request.patch("/api/preferences", {
    data: { timeZone: "x".repeat(5000), reduceMotion: false },
    headers: { Origin: testOrigin },
  });
  expect(oversized.status()).toBe(400);
  const cron = await context.request.get("/api/cron/sync", {
    headers: { Authorization: `Bearer ${fixtureEnv.CRON_SECRET}` },
  });
  expect(cron.status()).toBe(200);
  expect(await cron.json()).toMatchObject({
    processed: expect.any(Number),
    failed: expect.any(Number),
    pending: expect.any(Number),
  });

  await session(context, "empty");
  expect(
    (await (await context.request.get("/api/history")).json()).items,
  ).toEqual([]);
  expect(
    (
      await context.request.delete("/api/lastfm/connection", {
        headers: { Origin: testOrigin },
      })
    ).status(),
  ).toBe(204);
  await session(context, "listener");
  expect(
    (await (await context.request.get("/api/history")).json()).items[0].id,
  ).toBe(payload.items[0].id);
});

const viewports = [
  { width: 1536, height: 1024 },
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

for (const viewport of viewports) {
  test(`renders six states at ${viewport.width}×${viewport.height} with accessible layout and direct artwork`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize(viewport);
    await visuals(page);
    const violations: string[] = [];
    const failures: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /Content Security Policy|hydrat/i.test(message.text())
      )
        failures.push(message.text());
    });
    page.on("pageerror", (error) => failures.push(error.message));

    const screens = [
      {
        user: "listener",
        path: "/dashboard",
        name: "dashboard",
        heading: "Listening dashboard",
      },
      {
        user: "listener",
        path: "/history",
        name: "history",
        heading: "Listening history",
      },
      {
        user: "listener",
        path: "/stats",
        name: "stats",
        heading: "Listening stats",
      },
      {
        user: "listener",
        path: "/profile",
        name: "profile",
        heading: "Alex Rivera",
      },
      {
        user: "empty",
        path: "/dashboard",
        name: "empty",
        heading: "Listening dashboard",
      },
      {
        user: "error",
        path: "/dashboard",
        name: "error",
        heading: "Listening dashboard",
      },
    ] as const;

    for (const { user, path, name, heading } of screens) {
      await session(context, user);
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      if (name === "empty")
        await expect(
          page.getByRole("link", { name: "Go to Profile" }),
        ).toBeVisible();
      if (name === "error")
        await expect(
          page.getByText("Last.fm history is private or unavailable.", {
            exact: false,
          }),
        ).toBeInViewport();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBe(viewport.width);
      if (["stats", "dashboard", "profile"].includes(name))
        await expect(
          page.getByRole("link", { name: "Last.fm", exact: true }),
        ).toBeVisible();
      const size = `${viewport.width}x${viewport.height}`;
      const output =
        process.env.CAPTURE_SCREENSHOTS === "1"
          ? resolve("docs/screenshots", size, `${name}.png`)
          : info.outputPath(`${name}.png`);
      await page.screenshot({ path: output, animations: "disabled" });
      if (viewport.width === 1536 || viewport.width === 390) {
        const audit = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        violations.push(
          ...audit.violations
            .filter(
              ({ impact }) => impact === "serious" || impact === "critical",
            )
            .map(
              ({ id, nodes }) =>
                `${name}: ${id} ${nodes.map(({ target }) => target.join(" ")).join(", ")}`,
            ),
        );
      }
    }
    expect(failures).toEqual([]);
    expect(violations).toEqual([]);
  });
}

test("filters, retries history pagination, and renders missing, broken, and disallowed covers without overflow", async ({
  page,
  context,
}) => {
  await session(context, "media");
  await visuals(page);
  await page.setViewportSize({ width: 320, height: 760 });
  const unexpected: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://example.test"))
      unexpected.push(request.url());
  });
  await page.goto("/history");
  expect(await page.locator("main ol img").nth(0).getAttribute("src")).toBe(
    "/record-fallback.svg",
  );
  await expect(page.locator("main ol img").nth(1)).toHaveAttribute(
    "src",
    "/record-fallback.svg",
  );
  await expect(page.locator("main ol img").nth(2)).toHaveAttribute(
    "src",
    "/record-fallback.svg",
  );
  await expect(page.locator("main ol img").nth(3)).toHaveAttribute(
    "src",
    /fixture-city\.jpg/,
  );
  expect(unexpected).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );

  await page.route(
    "**/api/history?**",
    (route) => route.fulfill({ status: 503, body: "{}" }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText(
    /could not be loaded/,
  );
  await page.getByRole("button", { name: "Retry loading more" }).click();
  await expect(page.locator("main ol li")).toHaveCount(50);
  await page
    .getByRole("textbox", { name: "Search tracks, artists, or albums" })
    .fill("%_!");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/q=%25_%21/);
  await expect(page.locator("main ol li")).toHaveCount(1);
  await expect(page.getByText("End of history for this range.")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search tracks, artists, or albums" })
    .fill("No fixture like this");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByText("No completed plays match this search and range."),
  ).toBeVisible();

  await session(context, "error");
  await page.goto("/stats");
  await page.getByLabel("Date range").selectOption("7d");
  await expect(page).toHaveURL(/range=7d/);
  await expect(
    page.getByText("No listening history in this range"),
  ).toBeVisible();
  await page.getByText("View daily play counts").click();
  await expect(
    page
      .getByRole("table", { name: "Daily play counts" })
      .getByRole("cell", { name: "0" }),
  ).toHaveCount(7);
});

test("supports keyboard focus, preferences, reduced motion, deletion confirmation and sign-out", async ({
  page,
  context,
}) => {
  await session(context, "listener");
  await visuals(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/profile");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  const signOut = page.getByRole("button", { name: "Sign out" });
  expect(
    await signOut.evaluate(
      (button) => getComputedStyle(button).transitionDuration,
    ),
  ).toBe("0s");

  await page.getByLabel("Time zone").fill("Asia/Kolkata");
  await page.getByLabel("Pause motion").check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("status")).toHaveText("Preferences saved.");
  await expect(page.locator("[data-reduced=true]")).toBeVisible();

  const disconnect = page.getByRole("button", {
    name: "Disconnect and delete imported history",
  });
  await disconnect.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Delete imported history?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(disconnect).toBeFocused();
  await disconnect.click();
  await dialog
    .getByRole("button", { name: "Disconnect and delete", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Last.fm disconnected" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "I confirm this is my Last.fm account.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Time zone")).toHaveValue("Asia/Kolkata");
  expect(
    (await (await context.request.get("/api/history")).json()).items,
  ).toEqual([]);
  await signOut.click();
  await expect(page).toHaveURL("/sign-in");
  expect((await context.request.get("/api/history")).status()).toBe(401);
});
