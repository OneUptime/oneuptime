// Tremor Raw chartColors [v0.1.0]

export type ColorUtility = "bg" | "stroke" | "fill" | "text";

export const chartColors: {
  [color: string]: {
    [key in ColorUtility]: string;
  } & { hex: string };
} = {
  blue: {
    bg: "bg-blue-500",
    stroke: "stroke-blue-500",
    fill: "fill-blue-500",
    text: "text-blue-500",
    hex: "#3b82f6",
  },
  emerald: {
    bg: "bg-emerald-500",
    stroke: "stroke-emerald-500",
    fill: "fill-emerald-500",
    text: "text-emerald-500",
    hex: "#10b981",
  },
  violet: {
    bg: "bg-violet-500",
    stroke: "stroke-violet-500",
    fill: "fill-violet-500",
    text: "text-violet-500",
    hex: "#8b5cf6",
  },
  amber: {
    bg: "bg-amber-500",
    stroke: "stroke-amber-500",
    fill: "fill-amber-500",
    text: "text-amber-500",
    hex: "#f59e0b",
  },
  gray: {
    bg: "bg-gray-500",
    stroke: "stroke-gray-500",
    fill: "fill-gray-500",
    text: "text-gray-500",
    hex: "#6b7280",
  },
  cyan: {
    bg: "bg-cyan-500",
    stroke: "stroke-cyan-500",
    fill: "fill-cyan-500",
    text: "text-cyan-500",
    hex: "#06b6d4",
  },
  pink: {
    bg: "bg-pink-500",
    stroke: "stroke-pink-500",
    fill: "fill-pink-500",
    text: "text-pink-500",
    hex: "#ec4899",
  },
  lime: {
    bg: "bg-lime-500",
    stroke: "stroke-lime-500",
    fill: "fill-lime-500",
    text: "text-lime-500",
    hex: "#84cc16",
  },
  fuchsia: {
    bg: "bg-fuchsia-500",
    stroke: "stroke-fuchsia-500",
    fill: "fill-fuchsia-500",
    text: "text-fuchsia-500",
    hex: "#d946ef",
  },
  indigo: {
    bg: "bg-indigo-500",
    stroke: "stroke-indigo-500",
    fill: "fill-indigo-500",
    text: "text-indigo-500",
    hex: "#6366f1",
  },
  rose: {
    bg: "bg-rose-500",
    stroke: "stroke-rose-500",
    fill: "fill-rose-500",
    text: "text-rose-500",
    hex: "#f43f5e",
  },
};

export type AvailableChartColorsKeys = keyof typeof chartColors;

export const AvailableChartColors: AvailableChartColorsKeys[] = Object.keys(
  chartColors,
) as Array<AvailableChartColorsKeys>;

/*
 * A chart color value can be either a named palette key (e.g. "indigo") or
 * a raw hex string (e.g. "#6366f1"). Named keys resolve to Tailwind classes;
 * hex values are applied via inline styles by the chart renderers. This lets
 * users pick arbitrary custom/brand colors per series while the default
 * palette continues to use theme-safe named colors.
 */
export type ChartColorValue = AvailableChartColorsKeys | string;

/*
 * True when the value is a raw hex color rather than a named palette key.
 * The chart renderers use this to decide between an inline style (hex) and
 * a Tailwind color class (named key). Accepts ChartColorValue (which widens
 * to `string | number` because `chartColors` has a string index signature) —
 * only actual `#…` strings return true.
 */
export const isHexColorValue: (
  color: ChartColorValue | undefined | null,
) => boolean = (color: ChartColorValue | undefined | null): boolean => {
  return typeof color === "string" && color.trim().startsWith("#");
};

export const constructCategoryColors: (
  categories: string[],
  colors: Array<ChartColorValue>,
) => Map<string, ChartColorValue> = (
  categories: string[],
  colors: Array<ChartColorValue>,
): Map<string, ChartColorValue> => {
  const categoryColors: Map<string, ChartColorValue> = new Map<
    string,
    ChartColorValue
  >();
  categories.forEach((category: string, index: number) => {
    categoryColors.set(category, colors[index % colors.length]!);
  });
  return categoryColors;
};

export const getColorClassName: (
  color: ChartColorValue,
  type: ColorUtility,
) => string = (color: ChartColorValue, type: ColorUtility): string => {
  const fallbackColor: {
    bg: string;
    stroke: string;
    fill: string;
    text: string;
  } = {
    bg: "bg-gray-500",
    stroke: "stroke-gray-500",
    fill: "fill-gray-500",
    text: "text-gray-500",
  };
  /*
   * Hex values have no Tailwind class — callers apply them via inline style,
   * so return an empty string here rather than the gray fallback (which would
   * otherwise paint a custom-colored series gray).
   */
  if (isHexColorValue(color)) {
    return "";
  }
  return chartColors[color]?.[type] ?? fallbackColor[type];
};

/*
 * Resolve any chart color value to a concrete hex string. Named palette keys
 * map to their `chartColors` hex; raw hex values pass through unchanged. Used
 * for SVG fill/stroke and inline style props where a class name won't work.
 */
export const getColorHex: (color: ChartColorValue) => string = (
  color: ChartColorValue,
): string => {
  if (isHexColorValue(color)) {
    return color as string;
  }
  return chartColors[color]?.hex ?? "#6b7280";
};
