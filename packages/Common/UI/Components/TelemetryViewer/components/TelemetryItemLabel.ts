import { PluralTemplate, translationKey } from "../../../../Types/Translator";

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

/*
 * HOW A LIST COUNTS ITS ROWS, IN EACH KIND'S OWN WORDS.
 *
 * The total at the head of a telemetry list: "1,234 spans", or "50+ spans"
 * when the total could not be counted. Each kind of row has a sentence of
 * its own for each, which every language words around its noun: Arabic
 * writes a count as a label and its count, "الامتدادات: 1,234" (Locales/
 * ARABIC.md), and Russian counts in the genitive, "Спанов: 1 234". Built from
 * a count and a noun that arrives with its article ("{{count}}
 * {{itemsName}}"), the same total read "1,234 الامتدادات" (issue #6474).
 *
 * The "+" form names no count of rows, only a least one, so it takes no
 * plural: one sentence per kind.
 */
export interface TelemetryTotalTemplates {
  // "1,234 spans", "1 span".
  exact: PluralTemplate;
  // "50+ spans".
  lowerBound: string;
}

// The kinds the telemetry lists count, by the label each list passes.
export const TELEMETRY_TOTAL_TEMPLATES: Readonly<
  Record<string, TelemetryTotalTemplates>
> = {
  results: {
    exact: { one: "{{count}} result", other: "{{count}} results" },
    lowerBound: translationKey("{{count}}+ results"),
  },
  traces: {
    exact: { one: "{{count}} trace", other: "{{count}} traces" },
    lowerBound: translationKey("{{count}}+ traces"),
  },
  spans: {
    exact: { one: "{{count}} span", other: "{{count}} spans" },
    lowerBound: translationKey("{{count}}+ spans"),
  },
  logs: {
    exact: { one: "{{count}} log", other: "{{count}} logs" },
    lowerBound: translationKey("{{count}}+ logs"),
  },
  metrics: {
    exact: { one: "{{count}} metric", other: "{{count}} metrics" },
    lowerBound: translationKey("{{count}}+ metrics"),
  },
  exceptions: {
    exact: { one: "{{count}} exception", other: "{{count}} exceptions" },
    lowerBound: translationKey("{{count}}+ exceptions"),
  },
  "security events": {
    exact: {
      one: "{{count}} security event",
      other: "{{count}} security events",
    },
    lowerBound: translationKey("{{count}}+ security events"),
  },
};

/*
 * A label no list passes yet: its noun put in after the count, which reads
 * right in English and in most languages, until the kind has words of its
 * own above.
 */
export const GENERAL_TELEMETRY_TOTAL_TEMPLATES: TelemetryTotalTemplates = {
  exact: {
    one: "{{count}} {{itemName}}",
    other: "{{count}} {{itemsName}}",
  },
  lowerBound: "{{count}}+ {{itemsName}}",
};

// The sentences a list's total is said in, by the label the list passes.
export function getTelemetryTotalTemplates(
  itemLabel?: string | undefined,
): TelemetryTotalTemplates {
  const kind: string = getTelemetryItemLabels(itemLabel).plural.toLowerCase();

  return Object.prototype.hasOwnProperty.call(TELEMETRY_TOTAL_TEMPLATES, kind)
    ? (TELEMETRY_TOTAL_TEMPLATES[kind] as TelemetryTotalTemplates)
    : GENERAL_TELEMETRY_TOTAL_TEMPLATES;
}
