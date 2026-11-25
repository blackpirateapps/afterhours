import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { approvedCover } from "@/shared/media";
import { usernameSchema } from "@/shared/validation";
import { AppError } from "../errors";

export class ProviderError extends AppError {
  constructor(
    code: string,
    message: string,
    readonly kind: "temporary" | "permanent" | "rate" | "shrunk",
    status = 503,
    retryAfter?: number,
  ) {
    super(status, code, message, retryAfter);
  }
}

export const malformed = () =>
  new ProviderError(
    "provider_payload",
    "Last.fm returned unexpected data. Try again later.",
    "permanent",
  );

export const providerBusy = (seconds: number) =>
  new ProviderError(
    "provider_rate",
    "Last.fm is limiting requests. Try again after the delay.",
    "rate",
    503,
    seconds,
  );

const natural = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .refine((value) => Number.isSafeInteger(value) && value >= 0);
const text = z
  .string()
  .transform((value) => value.trim().normalize("NFC"))
  .refine((value) => !value.includes("\0") && [...value].length <= 500);
const requiredText = text.refine((value) => normalizeGroup(value).length > 0);
const artist = z.union([
  requiredText,
  z.object({ "#text": requiredText }).transform((value) => value["#text"]),
]);
const album = z
  .union([
    text,
    z.object({ "#text": text }).transform((value) => value["#text"]),
  ])
  .nullish();
const track = z.object({
  name: requiredText,
  artist,
  album,
  date: z.object({ uts: natural }),
  image: z.unknown().optional(),
});
const envelope = z.object({
  recenttracks: z.object({
    track: z.union([
      z.array(z.unknown()).max(201),
      z.record(z.string(), z.unknown()).transform((value) => [value]),
    ]),
    "@attr": z.object({
      total: natural,
      page: natural,
      perPage: natural,
      totalPages: natural,
    }),
  }),
});
const nowPlaying = z.object({
  "@attr": z.object({
    nowplaying: z.union([
      z.literal("true"),
      z.literal(true),
      z.literal("1"),
      z.literal(1),
    ]),
  }),
});
const art = z.object({ size: z.string(), "#text": z.string() });
const artPriority = ["mega", "extralarge", "large", "medium", "small"];

export function normalizeGroup(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

export function sourceIdentity(
  unixSecond: number,
  artist: string,
  track: string,
  album: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        unixSecond,
        ...[artist, track, album].map((value) => value.trim().normalize("NFC")),
      ]),
    )
    .digest("hex");
}

function cover(input: unknown): string | null {
  if (!Array.isArray(input)) return null;
  for (const size of artPriority) {
    for (const item of input) {
      const result = art.safeParse(item);
      if (result.success && result.data.size === size) {
        const valid = approvedCover(result.data["#text"]);
        if (valid) return valid;
      }
    }
  }
  return null;
}

export type Play = {
  unixSecond: number;
  artist: string;
  track: string;
  album: string;
  artistNorm: string;
  trackNorm: string;
  albumNorm: string;
  hash: string;
  cover: string | null;
};

export function makePlay(
  unixSecond: number,
  artist: string,
  track: string,
  album: string,
  url: string | null = null,
): Play {
  const [artistText, trackText, albumText] = [artist, track, album].map(
    (value) => value.trim().normalize("NFC"),
  );
  return {
    unixSecond,
    artist: artistText,
    track: trackText,
    album: albumText,
    artistNorm: normalizeGroup(artistText),
    trackNorm: normalizeGroup(trackText),
    albumNorm: normalizeGroup(albumText),
    hash: sourceIdentity(unixSecond, artistText, trackText, albumText),
    cover: normalizeGroup(albumText) ? approvedCover(url) : null,
  };
}

export const LIMIT = 200;
export type Window = { from: number; to: number; page: number };
export type Page = { plays: Play[]; end: boolean };

export function parsePage(body: unknown, window: Window): Page {
  const result = envelope.safeParse(body);
  if (!result.success) throw malformed();
  const { track: records, "@attr": metadata } = result.data.recenttracks;
  const { page, total, totalPages, perPage } = metadata;
  if (
    page < 1 ||
    perPage < 1 ||
    perPage > LIMIT ||
    totalPages !== Math.ceil(total / perPage)
  )
    throw malformed();
  if (
    window.page > 1 &&
    window.page > totalPages &&
    (page === window.page || page === Math.max(totalPages, 1))
  ) {
    throw new ProviderError(
      "provider_page_shrank",
      "Last.fm changed its page listing. Retry the import.",
      "shrunk",
    );
  }
  if (page !== window.page) throw malformed();

  let completed = 0;
  let playing = 0;
  const plays: Play[] = [];
  for (const record of records) {
    if (nowPlaying.safeParse(record).success) {
      playing++;
      continue;
    }
    const parsed = track.safeParse(record);
    if (!parsed.success || parsed.data.date.uts > 8_640_000_000_000)
      throw malformed();
    completed++;
    const { date, artist, name, album, image } = parsed.data;
    if (date.uts >= window.from && date.uts < window.to) {
      plays.push(makePlay(date.uts, artist, name, album ?? "", cover(image)));
    }
  }
  if (
    playing > 1 ||
    completed > perPage ||
    completed > total ||
    (!completed && total > 0)
  )
    throw malformed();
  return {
    plays: plays.sort((a, b) => b.unixSecond - a.unixSecond),
    end: !completed || page >= totalPages,
  };
}

export function parseUser(body: unknown): string {
  const result = z
    .object({ user: z.object({ name: usernameSchema }) })
    .safeParse(body);
  if (!result.success) throw malformed();
  return result.data.user.name;
}

const errorEnvelope = z.object({ error: natural });

export function checkProviderError(
  body: unknown,
  recent: boolean,
  retryAfter: number,
): void {
  const result = errorEnvelope.safeParse(body);
  if (!result.success) return;
  switch (result.data.error) {
    case 29:
      throw providerBusy(retryAfter);
    case 8:
    case 11:
    case 16:
      throw new ProviderError(
        "provider_temporary",
        "Last.fm is temporarily unavailable. Try again later.",
        "temporary",
      );
    case 6:
    case 7:
    case 17:
      if (!recent && result.data.error === 6) {
        throw new ProviderError(
          "lastfm_user_unknown",
          "That Last.fm username could not be found.",
          "permanent",
          404,
        );
      }
      throw unavailableProfile();
    case 4:
    case 9:
    case 10:
    case 13:
    case 14:
    case 15:
    case 26:
      throw new ProviderError(
        "provider_configuration",
        "The Last.fm connection needs operator attention.",
        "permanent",
      );
    default:
      throw new ProviderError(
        "provider_failure",
        "Last.fm could not complete the request.",
        "permanent",
      );
  }
}

export function unavailableProfile() {
  return new ProviderError(
    "profile_unavailable",
    "Last.fm history is private or unavailable. Check your account in Profile.",
    "permanent",
  );
}
