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

export const constructCategoryColors: (
  categories: string[],
  colors: AvailableChartColorsKeys[],
) => Map<string, AvailableChartColorsKeys> = (
  categories: string[],
  colors: AvailableChartColorsKeys[],
): Map<string, AvailableChartColorsKeys> => {
  const categoryColors: Map<string, AvailableChartColorsKeys> = new Map<
    string,
    AvailableChartColorsKeys
  >();
  categories.forEach((category: string, index: number) => {
    categoryColors.set(category, colors[index % colors.length]!);
  });
  return categoryColors;
};

export const getColorClassName: (
  color: AvailableChartColorsKeys,
  type: ColorUtility,
) => string = (color: AvailableChartColorsKeys, type: ColorUtility): string => {
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
  return chartColors[color]?.[type] ?? fallbackColor[type];
};

export const getColorHex: (color: AvailableChartColorsKeys) => string = (
  color: AvailableChartColorsKeys,
): string => {
  return chartColors[color]?.hex ?? "#6b7280";
};
