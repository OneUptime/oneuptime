/*
 * PromQL durations: `5m`, `1h30m`, `500ms`, `2w`.
 *
 * Written the way Prometheus reads them (common/model.ParseDuration): one or
 * more whole numbers, each with a unit, the units largest first and each used
 * once. A year is 365 days and a week 7, as there.
 */

const UNIT_MILLISECONDS: Record<string, number> = {
  y: 365 * 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  s: 1000,
  ms: 1,
};

// Largest first: the order the units must be written in.
const UNIT_ORDER: ReadonlyArray<string> = ["y", "w", "d", "h", "m", "s", "ms"];

const DURATION_PART_REGEX: RegExp = /(\d+)(ms|y|w|d|h|m|s)/y;

/*
 * The duration a string spells, in milliseconds, or undefined when it is not
 * one. "0s" is a duration (of nothing); "" and "5" are not.
 */
export const parsePromQLDuration: (text: string) => number | undefined = (
  text: string,
): number | undefined => {
  if (text.length === 0) {
    return undefined;
  }

  let total: number = 0;
  let position: number = 0;
  let lastUnitIndex: number = -1;

  while (position < text.length) {
    DURATION_PART_REGEX.lastIndex = position;
    const match: RegExpExecArray | null = DURATION_PART_REGEX.exec(text);

    if (!match) {
      return undefined;
    }

    const amount: number = Number(match[1]);
    const unit: string = match[2]!;
    const unitIndex: number = UNIT_ORDER.indexOf(unit);

    // `5m1h` and `1m1m` are refused, as Prometheus refuses them.
    if (unitIndex <= lastUnitIndex) {
      return undefined;
    }

    lastUnitIndex = unitIndex;
    total += amount * UNIT_MILLISECONDS[unit]!;
    position = DURATION_PART_REGEX.lastIndex;
  }

  if (!Number.isFinite(total)) {
    return undefined;
  }

  return total;
};

/*
 * A duration written the shortest way PromQL reads it: 90000 is "1m30s",
 * 0 is "0s". Negative durations keep their sign: -300000 is "-5m".
 */
export const formatPromQLDuration: (milliseconds: number) => string = (
  milliseconds: number,
): string => {
  if (milliseconds === 0) {
    return "0s";
  }

  const sign: string = milliseconds < 0 ? "-" : "";
  let remaining: number = Math.abs(Math.round(milliseconds));
  let text: string = "";

  for (const unit of UNIT_ORDER) {
    const size: number = UNIT_MILLISECONDS[unit]!;
    const amount: number = Math.floor(remaining / size);

    if (amount > 0) {
      text += `${amount}${unit}`;
      remaining -= amount * size;
    }
  }

  return `${sign}${text}`;
};
