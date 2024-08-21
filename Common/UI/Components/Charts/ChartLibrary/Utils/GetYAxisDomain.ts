// Tremor Raw getYAxisDomain [v0.0.0]

export const getYAxisDomain: (autoMinValue: boolean, minValue: number | undefined, maxValue: number | undefined) => (number | "auto")[] = (
  autoMinValue: boolean,
  minValue: number | undefined,
  maxValue: number | undefined,
): (number | "auto")[] => {
  const minDomain: number | "auto" = autoMinValue ? "auto" : minValue ?? 0;
  const maxDomain: number | "auto" = maxValue ?? "auto";
  return [minDomain, maxDomain];
};
