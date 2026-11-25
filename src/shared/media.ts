export const coverHosts = [
  "lastfm.freetls.fastly.net",
  "lastfm-img2.akamaized.net",
] as const;

export function approvedCover(value: string | null | undefined): string | null {
  if (
    !value ||
    new TextEncoder().encode(value).length > 2048 ||
    /[?#\\\s]/.test(value)
  )
    return null;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      coverHosts.some((host) => host === url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      new TextEncoder().encode(url.href).length <= 2048 &&
      /^\/i\/u\/(?:[^/]+\/)*[^/]+\.(?:png|jpe?g|webp)$/i.test(url.pathname)
    )
      return url.href;
  } catch {
    return null;
  }
  return null;
}

export function lastFmProfile(username: string): string {
  return `https://www.last.fm/user/${encodeURIComponent(username)}`;
}
