/*
 * WHAT A VALUE AXIS'S TICK SAYS, READ BACK (issues #10079, #10117, #10118).
 *
 * The value axes' tests check what each tick reads, not only where it is:
 * that it reads its own value to its last figure, that the axis steps in
 * round steps of the unit each tick is written in, and that no figure could
 * be left off. This reads a tick ValueFormatter wrote in English back into
 * the value it says, in the axis's unit:
 *
 *   - a figure and its unit: "17.205 GB" (17.205e9 bytes), "119.20B",
 *     "99.995%", "250 ms", "1.25 sec";
 *   - a span of time in units: "1 h 30 min", "2 d 12 h", "1 min 30.5 sec";
 *   - a span of time as a clock: "1:30:02", "12 d 05:30", "0:59:58.5".
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export const NBSP: string = "\u00A0";

// What one of a unit's figures stands for, as the formatter scales it.
const FIGURE_SCALE: Record<string, number> = {
  B: 1,
  KB: 1e3,
  MB: 1e6,
  GB: 1e9,
  TB: 1e12,
  PB: 1e15,
  "B/s": 1,
  "KB/s": 1e3,
  "MB/s": 1e6,
  "GB/s": 1e9,
  "TB/s": 1e12,
  "°C": 1,
};

const SCALE_LETTER: Record<string, number> = {
  "": 1,
  K: 1e3,
  M: 1e6,
  B: 1e9,
  T: 1e12,
  P: 1e15,
};

// The seconds each unit of time a tick is written in stands for.
export const TIME_UNIT_SECONDS: Record<string, number> = {
  d: 86400,
  h: 3600,
  min: 60,
  sec: 1,
  ms: 1e-3,
  µs: 1e-6,
  ns: 1e-9,
};

// The units of time an axis writes without decimals of the unit above them.
const WHOLE_TIME_UNITS: ReadonlyArray<string> = ["d", "h", "min"];

export type TickKind = "figure" | "units" | "clock";

export interface ReadTick {
  // The value the tick says, in the axis's unit.
  value: number;
  // What one unit of its last figure stands for, in the axis's unit.
  resolution: number;
  // How many figures its last number has after the point.
  decimals: number;
  // What one of the figures of the unit it is written in stands for, in the axis's unit.
  unitScale: number;
  // The unit its last figure is in: "GB", "%", "min", "sec", "clock-seconds".
  lastUnit: string;
  kind: TickKind;
}

export interface ReadTickOptions {
  // For a 0-1 fraction drawn in percent: what one percent is, 0.01.
  percentScale?: number | undefined;
  // For an axis of spans of time: the seconds one of its values stands for.
  durationUnitInSeconds?: number | undefined;
}

const FIGURE_LABEL: RegExp =
  /^(-?\d+)(?:\.(\d+))?([KMBTP]?)(?:\u00A0(\S+))?(%?)$/;

const CLOCK_LABEL: RegExp =
  /^(-?)(?:(\d+)\u00A0d\u00A0)?(\d+):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;

const UNIT_PART: RegExp = /^(-?\d+)(?:\.(\d+))?$/;

function fractionOf(digits: string | undefined): number {
  return digits ? Number(`0.${digits}`) : 0;
}

function readClock(match: RegExpExecArray, unitInSeconds: number): ReadTick {
  const sign: number = match[1] === "-" ? -1 : 1;
  const days: number = Number(match[2] || 0);
  const hours: number = Number(match[3]);
  const minutes: number = Number(match[4]);
  const hasSeconds: boolean = match[5] !== undefined;
  const decimals: number = (match[6] || "").length;
  const seconds: number = hasSeconds
    ? Number(match[5]) + fractionOf(match[6])
    : 0;
  const total: number =
    sign * (days * 86400 + hours * 3600 + minutes * 60 + seconds);
  const resolutionInSeconds: number = hasSeconds ? Math.pow(10, -decimals) : 60;

  return {
    value: total / unitInSeconds,
    resolution: resolutionInSeconds / unitInSeconds,
    decimals: decimals,
    unitScale: (hasSeconds ? 1 : 60) / unitInSeconds,
    lastUnit: hasSeconds ? "clock-seconds" : "clock-minutes",
    kind: "clock",
  };
}

function readUnits(label: string, unitInSeconds: number): ReadTick | null {
  const tokens: Array<string> = label.split(NBSP);

  if (tokens.length < 2 || tokens.length % 2 !== 0) {
    return null;
  }

  let total: number = 0;
  let sign: number = 1;
  let lastUnit: string = "";
  let decimals: number = 0;

  for (let index: number = 0; index < tokens.length; index += 2) {
    const figure: RegExpExecArray | null = UNIT_PART.exec(
      tokens[index] as string,
    );
    const unit: string = tokens[index + 1] as string;
    const seconds: number | undefined = TIME_UNIT_SECONDS[unit];

    if (!figure || seconds === undefined) {
      return null;
    }

    if (index === 0 && (figure[1] as string).startsWith("-")) {
      sign = -1;
    }

    const amount: number = Math.abs(Number(figure[1])) + fractionOf(figure[2]);

    // Only seconds and what is smaller take figures after the point.
    if (figure[2] && WHOLE_TIME_UNITS.includes(unit)) {
      return null;
    }

    total += amount * seconds;
    lastUnit = unit;
    decimals = (figure[2] || "").length;
  }

  const lastSeconds: number = TIME_UNIT_SECONDS[lastUnit] as number;

  return {
    value: (sign * total) / unitInSeconds,
    resolution: (lastSeconds * Math.pow(10, -decimals)) / unitInSeconds,
    decimals: decimals,
    unitScale: lastSeconds / unitInSeconds,
    lastUnit: lastUnit,
    kind: tokens.length > 2 ? "units" : "figure",
  };
}

/*
 * What an English tick says. Throws for a text the formatter does not
 * write, so a test never passes over a tick it could not read.
 */
export function readTick(label: string, options?: ReadTickOptions): ReadTick {
  const unitInSeconds: number | undefined = options?.durationUnitInSeconds;

  if (unitInSeconds !== undefined) {
    const clock: RegExpExecArray | null = CLOCK_LABEL.exec(label);

    if (clock) {
      return readClock(clock, unitInSeconds);
    }

    const units: ReadTick | null = readUnits(label, unitInSeconds);

    if (units) {
      return units;
    }

    throw new Error(`Not a span of time the formatter writes: ${label}`);
  }

  const match: RegExpExecArray | null = FIGURE_LABEL.exec(label);

  if (!match) {
    throw new Error(`Not a tick the formatter writes: ${label}`);
  }

  const fraction: string = match[2] || "";
  const unit: string = match[4] || "";
  const unitScale: number =
    (match[5] === "%" ? options?.percentScale ?? 1 : FIGURE_SCALE[unit] ?? 1) *
    (SCALE_LETTER[match[3] || ""] as number);

  return {
    value: Number(`${match[1]}${fraction ? `.${fraction}` : ""}`) * unitScale,
    decimals: fraction.length,
    resolution: Math.pow(10, -fraction.length) * unitScale,
    unitScale: unitScale,
    lastUnit: `${match[3] || ""}${unit}${match[5] || ""}`,
    kind: "figure",
  };
}

// Whether every two neighbouring ticks read apart.
export function areLabelsApart(labels: ReadonlyArray<string>): boolean {
  return labels.every((label: string, index: number): boolean => {
    return index === 0 || label !== labels[index - 1];
  });
}

// Every tick reads the value it marks, to its last figure.
export function isEveryTickExact(
  ticks: ReadonlyArray<number>,
  labels: ReadonlyArray<string>,
  options?: ReadTickOptions,
): boolean {
  return ticks.every((tick: number, index: number): boolean => {
    const read: ReadTick = readTick(labels[index] as string, options);

    return (
      Math.abs(read.value - tick) <=
      read.resolution / 2 + Math.abs(tick) * 1e-12
    );
  });
}

/*
 * The resolution one figure coarser than a tick's: a figure after the
 * point fewer, or, for a span of time written in whole seconds, minutes or
 * hours, the unit above. Undefined where nothing is coarser: a figure with
 * none after the point, days.
 */
function getCoarserResolution(
  read: ReadTick,
  options?: ReadTickOptions,
): number | undefined {
  if (read.decimals > 0) {
    return read.resolution * 10;
  }

  const unitInSeconds: number | undefined = options?.durationUnitInSeconds;

  if (unitInSeconds === undefined) {
    return undefined;
  }

  const coarser: Record<string, number> = {
    sec: 60,
    "clock-seconds": 60,
    min: 3600,
    "clock-minutes": 3600,
    h: 86400,
  };
  const seconds: number | undefined = coarser[read.lastUnit];

  return seconds === undefined ? undefined : seconds / unitInSeconds;
}

/*
 * THE FEWEST FIGURES. The ticks written in one unit take as many figures as
 * the axis's step needs in it, and no more: written one figure coarser - a
 * figure after the point fewer, or a unit of time up - two values a step
 * apart would read alike, or one of them would no longer read its own
 * value. The values are each tick of that unit and, with the axis's
 * `step`, the ticks a step either side of it, which the axis would write in
 * that unit too: "1.00 MB" beside "750 KB" keeps its two figures, as "1.25
 * MB" a step up needs them. A unit with nothing coarser (a figure with no
 * figure after the point, days) is as coarse as it can be.
 */
export function isOneFigureFewerWorse(
  ticks: ReadonlyArray<number>,
  labels: ReadonlyArray<string>,
  options?: ReadTickOptions,
  step?: number,
): boolean {
  const groups: Map<string, { coarser: number; values: Array<number> }> =
    new Map();

  ticks.forEach((tick: number, index: number): void => {
    const read: ReadTick = readTick(labels[index] as string, options);
    const coarser: number | undefined = getCoarserResolution(read, options);

    if (coarser === undefined) {
      return;
    }

    const group: { coarser: number; values: Array<number> } = groups.get(
      read.lastUnit,
    ) || { coarser: coarser, values: [] };

    group.values.push(
      ...(step === undefined ? [tick] : [tick - step, tick, tick + step]),
    );
    groups.set(read.lastUnit, group);
  });

  for (const group of groups.values()) {
    const values: Array<number> = Array.from(
      new Set<number>(group.values),
    ).sort((a: number, b: number): number => {
      return a - b;
    });
    const rounded: Array<string> = values.map((value: number): string => {
      return String(Math.round(value / group.coarser));
    });
    const isCoarserExact: boolean = values.every((value: number): boolean => {
      return (
        Math.abs(Math.round(value / group.coarser) * group.coarser - value) <=
        Math.abs(value) * 1e-12 + group.coarser * 1e-9
      );
    });

    // This unit's figures could be one fewer: too many.
    if (areLabelsApart(rounded) && isCoarserExact) {
      return false;
    }
  }

  return true;
}

// A step's first figures: 2.5 for 0.025.
export function getMantissa(step: number): number {
  return Number(
    (
      Math.abs(step) / Math.pow(10, Math.floor(Math.log10(Math.abs(step))))
    ).toPrecision(6),
  );
}

// Whether a step is 1, 2, 2.5 or 5 times a power of ten.
export function isRoundDecimalStep(step: number): boolean {
  return [1, 2, 2.5, 5, 10].includes(getMantissa(step));
}
