/*
 * THE SHAPE OF AN OBJECT'S NAME, SO A BUCKET IS SAMPLED BY KIND, NOT BY COUNT.
 *
 * A bucket of ten million objects is usually a handful of kinds written
 * many times: `exports/2026-10-27/users-0001.csv`, `exports/2026-10-28/
 * users-0002.csv`. Reading a few objects of each kind finds what the bucket
 * holds; reading the first thousand names in order finds one day's export.
 * So every name is turned into its pattern - dates, UUIDs, long hex runs
 * and numbers each become "*" - and a scan samples a few recent objects of
 * each pattern (ObjectStoreSampler.ts).
 */

const UUID: RegExp =
  /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
/*
 * A date, and a time after it, that is its own run of digits: in
 * 2026-10-27-00042 the 0004 of the sequence number is no time.
 */
const ISO_DATE: RegExp =
  /(?<![0-9])(?:19|20)[0-9]{2}-?(?:0[1-9]|1[0-2])-?(?:0[1-9]|[12][0-9]|3[01])(?:[T_ -]?[0-9]{2}[:-]?[0-9]{2}(?:[:-]?[0-9]{2})?(?:\.[0-9]{1,9})?Z?)?(?![0-9])/g;
const LONG_HEX: RegExp = /(?<![A-Za-z0-9])[0-9a-fA-F]{8,64}(?![A-Za-z0-9])/g;
const NUMBER: RegExp = /[0-9]{2,32}/g;
const KEY_VALUE_PARTITION: RegExp = /[=][^/]{1,128}/g;
const REPEATED_STARS: RegExp = /\*{2,64}/g;

// The most characters of a name that are read.
const MAX_NAME_LENGTH: number = 1024;

export function toPathPattern(name: string): string {
  return name
    .slice(0, MAX_NAME_LENGTH)
    .split("/")
    .map((segment: string) => {
      return segment
        .replace(UUID, "*")
        .replace(ISO_DATE, "*")
        .replace(LONG_HEX, "*")
        .replace(KEY_VALUE_PARTITION, "=*")
        .replace(NUMBER, "*")
        .replace(REPEATED_STARS, "*");
    })
    .join("/");
}

// The extension of an object name, lower-cased, without a compression suffix.
export function getObjectExtension(name: string): string {
  const base: string = name.slice(name.lastIndexOf("/") + 1).toLowerCase();
  const withoutCompression: string = base.endsWith(".gz")
    ? base.slice(0, -3)
    : base;
  const dot: number = withoutCompression.lastIndexOf(".");

  return dot > 0 ? withoutCompression.slice(dot + 1) : "";
}

export function isGzipName(name: string): boolean {
  return name.toLowerCase().endsWith(".gz");
}
