import { lookupTable } from "../LookupTable";

/*
 * How LogQL reads a duration or a size in a label (issue #7700): a label
 * filter (`| duration > 1s`, `| size > 20MB`) and unwrap's conversions
 * (`| unwrap duration(took)`, `| unwrap bytes(size)`) read a label's value
 * as Loki does - a duration as Go's time.ParseDuration reads one, a size
 * as go-humanize's ParseBytes.
 */

const DURATION_UNIT_SECONDS: ReadonlyMap<string, number> = lookupTable<number>({
  ns: 1e-9,
  us: 1e-6,
  µs: 1e-6,
  μs: 1e-6,
  ms: 1e-3,
  s: 1,
  m: 60,
  h: 3600,
});

const DURATION_PART: RegExp = /([0-9]*(?:\.[0-9]*)?)([a-zµμ]+)/y;

/*
 * A duration in seconds, as Go's time.ParseDuration reads it: "1.5s",
 * "300ms", "1h30m", "-2m". Undefined when it is not one. A bare number is
 * none, except 0.
 */
export const parseLogQLDuration: (text: string) => number | undefined = (
  text: string,
): number | undefined => {
  let rest: string = text.trim();
  let sign: number = 1;

  if (rest.startsWith("-") || rest.startsWith("+")) {
    sign = rest.startsWith("-") ? -1 : 1;
    rest = rest.slice(1);
  }

  if (rest === "0") {
    return 0;
  }

  if (rest.length === 0) {
    return undefined;
  }

  let seconds: number = 0;
  let position: number = 0;

  while (position < rest.length) {
    DURATION_PART.lastIndex = position;
    const match: RegExpExecArray | null = DURATION_PART.exec(rest);

    if (!match || match[1] === "" || match[1] === ".") {
      return undefined;
    }

    const unit: number | undefined = DURATION_UNIT_SECONDS.get(match[2]!);

    if (unit === undefined) {
      return undefined;
    }

    seconds += Number(match[1]) * unit;
    position = DURATION_PART.lastIndex;
  }

  return sign * seconds;
};

// go-humanize's table: SI units by 1000, IEC units (with an i) by 1024.
const BYTE_UNITS: ReadonlyMap<string, number> = lookupTable<number>({
  "": 1,
  b: 1,
  k: 1e3,
  kb: 1e3,
  ki: 1024,
  kib: 1024,
  m: 1e6,
  mb: 1e6,
  mi: 1024 ** 2,
  mib: 1024 ** 2,
  g: 1e9,
  gb: 1e9,
  gi: 1024 ** 3,
  gib: 1024 ** 3,
  t: 1e12,
  tb: 1e12,
  ti: 1024 ** 4,
  tib: 1024 ** 4,
  p: 1e15,
  pb: 1e15,
  pi: 1024 ** 5,
  pib: 1024 ** 5,
  e: 1e18,
  eb: 1e18,
  ei: 1024 ** 6,
  eib: 1024 ** 6,
});

const BYTES: RegExp = /^([0-9]*\.?[0-9]+)\s*([a-zA-Z]*)$/;

/*
 * A size in bytes, as go-humanize's ParseBytes reads it: "20MB" (20
 * million), "1.5KiB" (1,536), "512", "4 kb". Undefined when it is not one.
 */
export const parseLogQLBytes: (text: string) => number | undefined = (
  text: string,
): number | undefined => {
  const match: RegExpMatchArray | null = text.trim().match(BYTES);

  if (!match) {
    return undefined;
  }

  const unit: number | undefined = BYTE_UNITS.get(match[2]!.toLowerCase());

  return unit === undefined ? undefined : Number(match[1]) * unit;
};
