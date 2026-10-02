export interface TelemetryItemLabels {
  singular: string;
  plural: string;
}

/*
 * Callers pass a plural label ("traces", "spans"). The singular is only
 * used for a one-row result set, where trimming a trailing "s" is right
 * for every label these views pass.
 */
export function getTelemetryItemLabels(
  itemLabel?: string | undefined,
): TelemetryItemLabels {
  const plural: string = itemLabel || "results";
  const singular: string = plural.endsWith("s") ? plural.slice(0, -1) : plural;

  return { singular, plural };
}
