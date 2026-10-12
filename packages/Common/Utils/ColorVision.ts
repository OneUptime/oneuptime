import Color, { RGB } from "../Types/Color";
import { parseColor } from "./ColorContrast";

/*
 * How a colour looks to someone who is colour-blind, and how far apart two
 * colours look with full colour vision and without it.
 *
 * About one man in twelve has red-green colour blindness (protanopia,
 * deuteranopia and their milder forms). To them a green and a red of about
 * the same lightness are one colour: the Operational green (#2ab57d) and the
 * Offline red (#fd625e) every project starts with are 31 apart with full
 * colour vision and 6 apart to a deuteranope, where 2 is just noticeable. A
 * status page's uptime history drawn in those two colours reads as a row of
 * identical bars to them (issue #486).
 *
 * The simulation is Machado, Oliveira and Fernandes (2009) at full severity,
 * the worst case of each kind, applied to linear sRGB. A difference is the
 * distance between two colours in OKLab, x100. The same arithmetic holds the
 * trace status colours apart (App/Tests/Dashboard/SpanStatusPresentation).
 *
 * Pure and React-free: the dashboard warns with it about colours someone
 * picked, and the tests hold OneUptime's own palettes to it.
 */

export enum ColorVision {
  Full = "Full",
  // No working red cones.
  Protanopia = "Protanopia",
  // No working green cones, the most common kind.
  Deuteranopia = "Deuteranopia",
  // No working blue cones. Rare.
  Tritanopia = "Tritanopia",
}

// The kinds of red-green colour blindness, the common ones, in that order.
export const RED_GREEN_COLOR_VISIONS: ReadonlyArray<ColorVision> = [
  ColorVision.Deuteranopia,
  ColorVision.Protanopia,
];

// Two colours closer than this are one colour to the eye.
export const JUST_NOTICEABLE_COLOR_DIFFERENCE: number = 2;

/*
 * Two colours need to be at least this far apart to read as different at a
 * glance, side by side, as two bars of a chart or two dots of a legend.
 */
export const DISTINCT_COLOR_DIFFERENCE: number = 15;

/*
 * The same, under simulated red-green colour blindness at full severity.
 * Lower than the bar for full colour vision: full severity is the worst
 * case, and most colour-blind people see more than it does.
 */
export const COLOR_BLIND_DISTINCT_COLOR_DIFFERENCE: number = 8;

type Channels = [number, number, number];
type Matrix = [Channels, Channels, Channels];

const SIMULATIONS: Record<ColorVision, Matrix> = {
  [ColorVision.Full]: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  [ColorVision.Protanopia]: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  [ColorVision.Deuteranopia]: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  [ColorVision.Tritanopia]: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const LINEAR_SRGB_TO_LMS: Matrix = [
  [0.4122214708, 0.5363325363, 0.0514459929],
  [0.2119034982, 0.6806995451, 0.1073969566],
  [0.0883024619, 0.2817188376, 0.6299787005],
];

const LMS_TO_OKLAB: Matrix = [
  [0.2104542553, 0.793617785, -0.0040720468],
  [1.9779984951, -2.428592205, 0.4505937099],
  [0.0259040371, 0.7827717662, -0.808675766],
];

type MultiplyFunction = (matrix: Matrix, vector: Channels) => Channels;

const multiply: MultiplyFunction = (
  matrix: Matrix,
  vector: Channels,
): Channels => {
  const row: (weights: Channels) => number = (weights: Channels): number => {
    return (
      weights[0] * vector[0] + weights[1] * vector[1] + weights[2] * vector[2]
    );
  };

  return [row(matrix[0]), row(matrix[1]), row(matrix[2])];
};

type ChannelFunction = (channel: number) => number;

const toLinear: ChannelFunction = (channel: number): number => {
  const encoded: number = channel / 255;

  return encoded <= 0.04045
    ? encoded / 12.92
    : Math.pow((encoded + 0.055) / 1.055, 2.4);
};

const toEncoded: ChannelFunction = (linear: number): number => {
  const clamped: number = Math.min(1, Math.max(0, linear));
  const encoded: number =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;

  return Math.round(encoded * 255);
};

// The colour as the given colour vision sees it, in linear sRGB.
type SeenFunction = (color: RGB, vision: ColorVision) => Channels;

const getSeenLinear: SeenFunction = (
  color: RGB,
  vision: ColorVision,
): Channels => {
  const seen: Channels = multiply(SIMULATIONS[vision], [
    toLinear(color.red),
    toLinear(color.green),
    toLinear(color.blue),
  ]);

  // Clamped to what a screen can show: a simulated colour can fall outside.
  return [
    Math.min(1, Math.max(0, seen[0])),
    Math.min(1, Math.max(0, seen[1])),
    Math.min(1, Math.max(0, seen[2])),
  ];
};

type OkLabFunction = (color: RGB, vision: ColorVision) => Channels;

const toOkLab: OkLabFunction = (color: RGB, vision: ColorVision): Channels => {
  const lms: Channels = multiply(
    LINEAR_SRGB_TO_LMS,
    getSeenLinear(color, vision),
  );

  return multiply(LMS_TO_OKLAB, [
    Math.cbrt(lms[0]),
    Math.cbrt(lms[1]),
    Math.cbrt(lms[2]),
  ]);
};

/**
 * The colour a person with the given colour vision sees in place of `color`,
 * as a colour a screen can show - what a preview of their view draws.
 */
export function simulateColorVision(color: RGB, vision: ColorVision): RGB {
  const seen: Channels = getSeenLinear(color, vision);

  return {
    red: toEncoded(seen[0]),
    green: toEncoded(seen[1]),
    blue: toEncoded(seen[2]),
  };
}

/**
 * How far apart two colours look to a person with the given colour vision
 * (full colour vision when none is given): their OKLab distance, x100. 0 is
 * the same colour, about 2 is just noticeable.
 */
export function getColorDifference(
  first: RGB,
  second: RGB,
  vision: ColorVision = ColorVision.Full,
): number {
  const a: Channels = toOkLab(first, vision);
  const b: Channels = toOkLab(second, vision);

  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
}

/**
 * How far apart two colours look with red-green colour blindness: the
 * closer of the two kinds, protanopia and deuteranopia.
 */
export function getRedGreenColorBlindDifference(
  first: RGB,
  second: RGB,
): number {
  return Math.min(
    ...RED_GREEN_COLOR_VISIONS.map((vision: ColorVision): number => {
      return getColorDifference(first, second, vision);
    }),
  );
}

/**
 * Whether two colours that people with full colour vision tell apart look
 * alike to people with red-green colour blindness. Colours that look alike
 * to everyone are not: whoever picked them can see that for themselves, and
 * may have meant it. Anything that is not a colour is never one.
 */
export function looksAlikeWithRedGreenColorBlindness(
  first: Color | string | null | undefined,
  second: Color | string | null | undefined,
): boolean {
  const a: RGB | null = parseColor(first);
  const b: RGB | null = parseColor(second);

  if (!a || !b) {
    return false;
  }

  return (
    getColorDifference(a, b) >= COLOR_BLIND_DISTINCT_COLOR_DIFFERENCE &&
    getRedGreenColorBlindDifference(a, b) <
      COLOR_BLIND_DISTINCT_COLOR_DIFFERENCE
  );
}
