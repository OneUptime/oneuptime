import { dashboardLocale, drawnActionLabel } from "./DocsDashboardLabels";

/*
 * How each docs language names the Network area's labels on the network
 * device, sites and vendor guide pages (docs overhaul task 17b).
 *
 * A translated page names a label the way that language's Dashboard draws
 * it (drawnActionLabel, Persian included). A few labels on these pages are
 * drawn from a longer string, and the page names only its start:
 *
 *   - a dropdown option that explains itself after a dash ("Bound monitor
 *     — an existing monitor's status is ...");
 *   - a field whose title or placeholder ends in a parenthetical
 *     ("Target Prefix (optional)", "Value labels (optional, e.g., ...)");
 *   - a button or switch whose text carries a count ("Import Selected
 *     ({{count}})", the vendor template switch "... (recommended) —
 *     {{count}} hosts").
 *
 * A menu path is drawn segment by segment. Every language but Persian
 * writes it as one bold span with " → " between the segments; Persian,
 * written right to left, writes each segment in bold of its own with " > "
 * between them, because ">" is mirrored with the text and "→" is not.
 */

export const NETWORK_DEVICE_PAGE: string = "monitor/network-device-monitor";
export const NETWORK_SITES_PAGE: string = "monitor/network-sites";
export const NETWORK_VENDOR_GUIDES_PAGE: string =
  "monitor/network-vendor-guides";

export const NETWORK_DOCS_PAGES: ReadonlyArray<string> = [
  NETWORK_DEVICE_PAGE,
  NETWORK_SITES_PAGE,
  NETWORK_VENDOR_GUIDES_PAGE,
];

export const PATH_SEPARATOR: string = " → ";
export const PERSIAN_PATH_SEPARATOR: string = " > ";

export enum LabelTail {
  // The text after the first dash or colon: an option's explanation, a count.
  Explanation = "explanation",
  // A parenthetical at the end: "(optional)", "({{count}})".
  Parenthetical = "parenthetical",
}

export interface LabelWithATail {
  // The whole string, as the Dashboard's English locale keys it.
  key: string;
  tail: LabelTail;
}

// The labels these pages name by the start of a longer Dashboard string.
export const LABELS_WITH_A_TAIL: Readonly<Record<string, LabelWithATail>> = {
  "Bound monitor": {
    key: "Bound monitor — an existing monitor's status is this device's status (override)",
    tail: LabelTail.Explanation,
  },
  "Apply each SNMP host's vendor template on its first poll (recommended)": {
    key: "Apply each SNMP host's vendor template on its first poll (recommended) — {{count}} hosts",
    tail: LabelTail.Explanation,
  },
  "Import Selected": {
    key: "Import Selected ({{count}})",
    tail: LabelTail.Parenthetical,
  },
  "Target Prefix": {
    key: "Target Prefix (optional)",
    tail: LabelTail.Parenthetical,
  },
  "Value labels": {
    key: "Value labels (optional, e.g., 0=inactive, 1=active)",
    tail: LabelTail.Parenthetical,
  },
  "Healthy values": {
    key: "Healthy values (optional, e.g., 1)",
    tail: LabelTail.Parenthetical,
  },
};

// Labels drawn from a template with a value in it: the site hero's tile.
export const FILLED_TEMPLATES: Readonly<
  Record<string, { key: string; values: Record<string, string> }>
> = {
  "Uptime (24h)": { key: "Uptime ({{hours}}h)", values: { hours: "24" } },
};

/*
 * The Overview's verdicts the device page quotes, with a number in them, and
 * the plural key each is drawn from.
 */
export const VERDICT_HEADLINES: Readonly<Record<string, string>> = {
  "3 devices are down": "{{count}} devices are down",
  "2 sites need attention": "{{count}} sites need attention",
  "5 interfaces are down": "{{count}} interfaces are down",
  "2 devices are not reporting their details":
    "{{count}} devices are not reporting their details",
  "Waiting for the first check": "Waiting for the first check",
  "All 40 devices are up": "All {{count}} devices are up",
};

const EXPLANATION_START: RegExp = /\s*[—–]\s*|:\s+/;
const TRAILING_PARENTHETICAL: RegExp = /\s*[(（][^()（）]*[)）]\s*$/;
const PLURAL_SUFFIX: RegExp = /_(?:zero|one|two|few|many|other)$/;
const REGEX_SPECIAL: RegExp = /[.*+?^${}()|[\]\\]/g;
// "{{count}}" once escaped for a pattern.
const ESCAPED_COUNT: RegExp = /\\\{\\\{count\\\}\\\}/g;

// A flat key's value in a language's Dashboard locale, or the English.
export function localeValue(language: string, key: string): string {
  const value: unknown = dashboardLocale(language)[key];

  return typeof value === "string" && value.trim() ? value : key;
}

// The start of a longer Dashboard string, as a language draws it.
export function drawnStart(language: string, label: LabelWithATail): string {
  const value: string = localeValue(language, label.key);

  if (label.tail === LabelTail.Explanation) {
    return (value.split(EXPLANATION_START)[0] as string).trim();
  }

  return value.replace(TRAILING_PARENTHETICAL, "").trim();
}

/*
 * What a page in a language writes, in bold, for a label the English page
 * writes in bold.
 */
export function drawnNetworkLabel(language: string, english: string): string {
  const withATail: LabelWithATail | undefined = LABELS_WITH_A_TAIL[english];

  if (withATail) {
    return language === "en" ? english : drawnStart(language, withATail);
  }

  const filled: { key: string; values: Record<string, string> } | undefined =
    FILLED_TEMPLATES[english];

  if (filled) {
    let text: string = localeValue(language, filled.key);

    for (const [name, value] of Object.entries(filled.values)) {
      text = text.split(`{{${name}}}`).join(value);
    }

    return text;
  }

  return drawnActionLabel(language, english);
}

// A Dashboard path, as a page in a language writes it.
export function drawnPath(language: string, segments: Array<string>): string {
  const drawn: Array<string> = segments.map((segment: string): string => {
    return drawnNetworkLabel(language, segment);
  });

  if (language === "fa") {
    return drawn
      .map((segment: string): string => {
        return `**${segment}**`;
      })
      .join(PERSIAN_PATH_SEPARATOR);
  }

  return `**${drawn.join(PATH_SEPARATOR)}**`;
}

/*
 * A verdict headline as a pattern any count satisfies, in each form the
 * language's locale has for it (one, few, many, other).
 */
export function verdictPatterns(
  language: string,
  english: string,
): Array<RegExp> {
  const key: string | undefined = VERDICT_HEADLINES[english];

  if (!key) {
    throw new Error(`Not a verdict the page quotes: ${english}`);
  }

  const locale: Record<string, unknown> = dashboardLocale(language);
  const forms: Array<string> = Object.keys(locale)
    .filter((candidate: string): boolean => {
      return (
        candidate === key || candidate.replace(PLURAL_SUFFIX, "") === key
      );
    })
    .map((candidate: string): string => {
      return localeValue(language, candidate);
    });

  if (forms.length === 0) {
    forms.push(key);
  }

  return forms.map((form: string): RegExp => {
    return new RegExp(
      `^${form.replace(REGEX_SPECIAL, "\\$&").replace(ESCAPED_COUNT, "\\d+")}$`,
    );
  });
}

// The verdict forms, read back: whether a sentence is one of a verdict's forms.
export function isVerdict(
  language: string,
  english: string,
  sentence: string,
): boolean {
  return verdictPatterns(language, english).some((pattern: RegExp): boolean => {
    return pattern.test(sentence);
  });
}
