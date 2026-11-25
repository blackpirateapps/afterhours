export function requireTestDatabase() {
  for (const key of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"]) {
    const raw = process.env[key];
    if (!raw && key === "DATABASE_URL_UNPOOLED") continue;
    const url = new URL(raw ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.pathname !== "/afterhours_test"
    ) {
      throw new Error(
        "Tests require a loopback PostgreSQL database named afterhours_test.",
      );
    }
  }
}
