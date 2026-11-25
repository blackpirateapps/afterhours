import { describe, expect, it } from "vitest";
import { approvedCover } from "@/shared/media";
import { connectionInput, preferencesInput } from "@/shared/validation";
import { allowedIds } from "@/server/env";
import { githubIdentityAllowed } from "@/server/auth/options";
import { retryDelay } from "@/server/lastfm/client";
import {
  checkProviderError,
  makePlay,
  parsePage,
  parseUser,
  sourceIdentity,
} from "@/server/lastfm/parse";
import { historyFilters, literalSearch } from "@/server/queries/history";
import { rangeWindow } from "@/server/queries/time";

const valid = "https://lastfm.freetls.fastly.net/i/u/300x300/cover.webp";
const track = (uts: string | number) => ({
  name: "Afternoon",
  artist: { "#text": " Artist  " },
  album: { "#text": "" },
  date: { uts },
});
const page = (records: unknown, attr = {}) => ({
  recenttracks: {
    track: records,
    "@attr": { page: "1", total: 3, perPage: "200", totalPages: 1, ...attr },
  },
});

describe("Last.fm response validation", () => {
  it("filters exact half-open bounds and now-playing and accepts numeric or string fields", () => {
    const result = parsePage(
      page([
        track("101"),
        track(100),
        track(99),
        { "@attr": { nowplaying: "true" } },
      ]),
      { from: 100, to: 101, page: 1 },
    );
    expect(result).toEqual({
      plays: [makePlay(100, "Artist", "Afternoon", "")],
      end: true,
    });
    expect(
      parsePage(page(track(100), { total: 1 }), { from: 100, to: 101, page: 1 })
        .plays,
    ).toHaveLength(1);
  });

  it("rejects invalid records and metadata as a failed page and identifies shrinking saved pages", () => {
    const bounds = { from: 100, to: 110, page: 1 };
    expect(() => parsePage(page([{ name: "unknown" }]), bounds)).toThrow(
      /unexpected data/,
    );
    expect(() =>
      parsePage(page([{ ...track(101), name: "🎧".repeat(501) }]), bounds),
    ).toThrow(/unexpected data/);
    expect(() => parsePage(page([], { totalPages: 4 }), bounds)).toThrow(
      /unexpected data/,
    );
    expect(() =>
      parsePage(page([], { total: 0, totalPages: 0 }), { ...bounds, page: 2 }),
    ).toThrow(/changed its page/);
    expect(parsePage(page([], { total: 0, totalPages: 0 }), bounds).end).toBe(
      true,
    );
  });

  it("uses the first valid size in explicit priority order", () => {
    const item = {
      ...track(101),
      album: "Album",
      image: [
        {
          size: "small",
          "#text": "https://lastfm-img2.akamaized.net/i/u/small.png",
        },
        { size: "mega", "#text": "https://example.com/i/u/invalid.png" },
        { size: "extralarge", "#text": valid },
      ],
    };
    expect(
      parsePage(page(item, { total: 1 }), { from: 100, to: 110, page: 1 })
        .plays[0].cover,
    ).toBe(valid);
  });

  it("normalizes grouping separately from source identity", () => {
    const play = makePlay(100, " Ｃafé   Club ", " A\u0301rea ", "");
    expect(play.artistNorm).toBe("café club");
    expect(play.track).toBe("Área");
    expect(play.hash).toBe(sourceIdentity(100, " Ｃafé   Club ", "Área", ""));
    expect(play.hash).not.toBe(
      sourceIdentity(101, play.artist, play.track, ""),
    );
    expect(play.hash).not.toBe(
      sourceIdentity(100, play.artistNorm, play.trackNorm, ""),
    );
  });

  it("handles provider errors, canonical names and both Retry-After formats", () => {
    expect(parseUser({ user: { name: "Night-owl" } })).toBe("Night-owl");
    expect(() => checkProviderError({ error: "6" }, false, 60)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(() => checkProviderError({ error: 17 }, true, 60)).toThrow(
      expect.objectContaining({ code: "profile_unavailable" }),
    );
    expect(() => checkProviderError({ error: 10 }, false, 60)).toThrow(
      expect.objectContaining({ code: "provider_configuration" }),
    );
    expect(() => checkProviderError({ error: 29 }, true, 77)).toThrow(
      expect.objectContaining({ retryAfter: 77 }),
    );
    expect(retryDelay("23")).toBe(23);
    expect(
      retryDelay(
        "Wed, 21 Oct 2015 07:28:00 GMT",
        Date.parse("2015-10-21T07:27:52Z"),
      ),
    ).toBe(8);
    expect(retryDelay(null)).toBe(60);
  });
});

describe("shared validation and time", () => {
  it("validates invite IDs, requests, and literal Unicode history searches", () => {
    expect(allowedIds("123, 9876543210987654321")).toEqual([
      "123",
      "9876543210987654321",
    ]);
    expect(githubIdentityAllowed(123, ["123"])).toBe(true);
    for (const value of ["", "1,1", "01", "name", "1,", "-1", "1.5"])
      expect(() => allowedIds(value)).toThrow();
    expect(
      connectionInput.safeParse({
        username: "  Night_owl  ",
        confirmOwnership: true,
      }).success,
    ).toBe(true);
    expect(
      connectionInput.safeParse({ username: "owl", confirmOwnership: false })
        .success,
    ).toBe(false);
    expect(
      connectionInput.safeParse({
        username: "owl",
        confirmOwnership: true,
        owner: "forged",
      }).success,
    ).toBe(false);
    expect(
      preferencesInput.safeParse({
        timeZone: "America/New_York",
        reduceMotion: true,
      }).success,
    ).toBe(true);
    expect(
      preferencesInput.safeParse({ timeZone: "local", reduceMotion: true })
        .success,
    ).toBe(false);
    expect(historyFilters(null, ` ${"🎧".repeat(100)} `).q).toHaveLength(200);
    expect(() => historyFilters(null, "🎧".repeat(101))).toThrow();
    expect(literalSearch("100%_!")).toBe("%100!%!_!!%");
  });

  it("builds local midnight boundaries through both DST changes", () => {
    const spring = rangeWindow(
      "7d",
      "America/New_York",
      new Date("2026-03-08T08:00:00Z"),
    );
    expect(spring.start.toISOString()).toBe("2026-03-02T05:00:00.000Z");
    expect(spring.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(spring.end.getTime() - spring.start.getTime()).toBe(167 * 3600_000);
    expect(spring.dates.at(-1)).toBe("2026-03-08");
    const fall = rangeWindow(
      "7d",
      "America/New_York",
      new Date("2026-11-01T12:00:00Z"),
    );
    expect(fall.end.getTime() - fall.start.getTime()).toBe(169 * 3600_000);
  });

  it("permits only approved cover hosts, paths and URL lengths", () => {
    expect(approvedCover(valid)).toBe(valid);
    for (const url of [
      valid + "?q=1",
      valid + "#x",
      valid.replace("https", "http"),
      valid.replace(".net/", ".net:8443/"),
      valid.replace("//", "//user@"),
      valid.replace(".net", ".net.example"),
      valid.replace("/i/u/", "/i/v/"),
      valid.replace(".webp", ".svg"),
      "https://lastfm.freetls.fastly.net/i/u/" + "a".repeat(2050) + ".jpg",
      valid.replace("cover", "😀".repeat(220)),
    ])
      expect(approvedCover(url)).toBeNull();
  });
});
