import { MAX_NAME_PATTERN_LENGTH } from "../../../Types/NetworkDevice/DeviceNaming";

/*
 * A NAMING RULE'S NAME PATTERN (OneUptime issue #6619).
 *
 * The text of a device's name, with the parts that differ from device to
 * device in curly braces:
 *
 *   UN{site.code}MNUPLR01      the menu player of whichever unit it is in
 *   {site.code}-SW-{nn}        a switch, numbered 01, 02, ... in each site
 *   HQ-{discoveredName|upper}  the name discovery found, in capitals
 *
 * A placeholder is replaced by a value of the device (PLACEHOLDERS below). A
 * counter - {n}, {nn}, {nnn} or {nnnn} - is replaced by the lowest number
 * that makes the whole name one no other device has, written with at least
 * that many digits. A placeholder may be followed by filters that change its
 * value, one after the other: {vendor|first:3|upper} is "SAM" for "Samsung
 * Electronics Co.,Ltd". "{{" and "}}" stand for a brace of their own.
 *
 * A device lacking a value its pattern needs - no site code, no MAC, a
 * filter that leaves nothing - is not named by the rule, and the next rule
 * is tried (DeviceNamingPlanner). A name is never made up from part of a
 * pattern.
 *
 * Parsing scans the pattern character by character: it is written by
 * people, at most 255 characters long, and read on every import.
 *
 * The words of every problem are marked for the Dashboard's locales (this
 * file is a "keys" root of App/FeatureSet/Dashboard/scripts/i18n/
 * ExtractStrings.ts), so the rule form says them in the reader's language;
 * the server says them in English.
 */

/*
 * Marks an English sentence as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here so
 * this file stays free of the UI. It returns the text unchanged.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

export enum NamePlaceholder {
  DiscoveredName = "discoveredName",
  IpAddress = "ip",
  IpOctet1 = "ip.1",
  IpOctet2 = "ip.2",
  IpOctet3 = "ip.3",
  IpOctet4 = "ip.4",
  MacAddress = "mac",
  Vendor = "vendor",
  Site = "site",
  SiteCode = "site.code",
  Lookup = "lookup",
}

export enum NameFilter {
  Upper = "upper",
  Lower = "lower",
  First = "first",
  Last = "last",
  Digits = "digits",
  NoSpaces = "nospaces",
}

export interface NamePlaceholderInfo {
  placeholder: NamePlaceholder;
  // What the rule form's button and the docs call it.
  title: string;
  // One line: what it is replaced by.
  description: string;
  // What it is replaced by for the example device the form names.
  example: string;
}

/*
 * Every placeholder, in the order the rule form offers them: the site first
 * (names are mostly by location), then what the device itself says.
 */
export const NAME_PLACEHOLDERS: ReadonlyArray<NamePlaceholderInfo> = [
  {
    placeholder: NamePlaceholder.SiteCode,
    title: translationKey("Site code"),
    description: translationKey(
      "The code of the device's site, such as a store or unit number. Set it on the site's settings.",
    ),
    example: "1216",
  },
  {
    placeholder: NamePlaceholder.Site,
    title: translationKey("Site name"),
    description: translationKey("The name of the device's site."),
    example: "Unit 1216",
  },
  {
    placeholder: NamePlaceholder.DiscoveredName,
    title: translationKey("Discovered name"),
    description: translationKey(
      "The name discovery found: the device's SNMP or NetBIOS name, its DNS name, or its IP address.",
    ),
    example: "dmb-5",
  },
  {
    placeholder: NamePlaceholder.IpOctet4,
    title: translationKey("Last part of the IP address"),
    description: translationKey(
      "The last number of the device's IP address: 51 for 10.48.145.51. {ip.1}, {ip.2} and {ip.3} are the others.",
    ),
    example: "51",
  },
  {
    placeholder: NamePlaceholder.IpAddress,
    title: translationKey("IP address"),
    description: translationKey("The device's whole IP address."),
    example: "10.48.145.51",
  },
  {
    placeholder: NamePlaceholder.MacAddress,
    title: translationKey("MAC address"),
    description: translationKey(
      "The device's MAC address as 12 digits and letters, without separators.",
    ),
    example: "00050BB07FFC",
  },
  {
    placeholder: NamePlaceholder.Vendor,
    title: translationKey("Vendor"),
    description: translationKey(
      "Who made the device, from its MAC address or its SNMP answer.",
    ),
    example: "SICOM Systems",
  },
  {
    placeholder: NamePlaceholder.Lookup,
    title: translationKey("Lookup table value"),
    description: translationKey(
      "The value the rule's lookup table gives the device.",
    ),
    example: "MNUPLR01",
  },
  {
    placeholder: NamePlaceholder.IpOctet1,
    title: translationKey("First part of the IP address"),
    description: translationKey("The first number of the device's IP address."),
    example: "10",
  },
  {
    placeholder: NamePlaceholder.IpOctet2,
    title: translationKey("Second part of the IP address"),
    description: translationKey(
      "The second number of the device's IP address.",
    ),
    example: "48",
  },
  {
    placeholder: NamePlaceholder.IpOctet3,
    title: translationKey("Third part of the IP address"),
    description: translationKey("The third number of the device's IP address."),
    example: "145",
  },
];

// The counters, by the number of digits each writes at least.
export const NAME_COUNTERS: ReadonlyArray<{ token: string; width: number }> = [
  { token: "n", width: 1 },
  { token: "nn", width: 2 },
  { token: "nnn", width: 3 },
  { token: "nnnn", width: 4 },
];

export const NAME_COUNTER_TITLE: string = translationKey("Number");
export const NAME_COUNTER_DESCRIPTION: string = translationKey(
  "The lowest number that makes the name unique: {n} writes 1, 2, 3; {nn} writes 01, 02, 03.",
);

// The longest a filter may cut a value to, or keep of its end.
export const MAX_NAME_FILTER_COUNT: number = 80;

/*
 * The longest value a placeholder is read with. Every value is a name, an
 * address or a code, far shorter than this; one longer came from a probe
 * payload nobody checked, and is cut before a filter reads it.
 */
const MAX_VALUE_LENGTH: number = 500;

export interface NamePatternFilterStep {
  filter: NameFilter;
  // How many characters first and last keep.
  count?: number | undefined;
}

export type NamePatternSegment =
  | { kind: "text"; text: string }
  | {
      kind: "value";
      placeholder: NamePlaceholder;
      filters: Array<NamePatternFilterStep>;
    }
  | { kind: "counter"; width: number };

export interface ParsedNamePattern {
  segments: Array<NamePatternSegment>;
  // The placeholders the pattern uses, each once, in the order they appear.
  placeholders: Array<NamePlaceholder>;
  // The counter's width, or null when the pattern has none.
  counterWidth: number | null;
}

/*
 * What is wrong with a pattern: an English sentence with {{values}} in it,
 * and the values. The Dashboard looks the sentence up in the reader's
 * language before filling it in; formatNamePatternProblem fills it in
 * English.
 */
export interface NamePatternProblem {
  template: string;
  values: Record<string, string>;
}

export const NAME_PATTERN_PROBLEMS: {
  readonly empty: string;
  readonly tooLong: string;
  readonly controlCharacter: string;
  readonly unclosedBrace: string;
  readonly strayClosingBrace: string;
  readonly emptyPlaceholder: string;
  readonly unknownPlaceholder: string;
  readonly unknownFilter: string;
  readonly filterNeedsCount: string;
  readonly filterTakesNoCount: string;
  readonly filterCountOutOfRange: string;
  readonly twoCounters: string;
  readonly counterTakesNoFilters: string;
} = {
  empty: translationKey("Enter the name pattern devices are named by."),
  tooLong: translationKey(
    "The name pattern can be at most {{max}} characters long.",
  ),
  controlCharacter: translationKey(
    "The name pattern can't contain line breaks or other control characters.",
  ),
  unclosedBrace: translationKey(
    'Close the "{" of "{{piece}}" with "}". To put a brace in the name itself, write it twice.',
  ),
  strayClosingBrace: translationKey(
    'A "}" closes nothing. To put a brace in the name itself, write it twice.',
  ),
  emptyPlaceholder: translationKey(
    'Write a placeholder between the braces of "{}", such as {site.code}.',
  ),
  unknownPlaceholder: translationKey(
    '"{{placeholder}}" is not a placeholder. Use one of {{placeholders}}.',
  ),
  unknownFilter: translationKey(
    '"{{filter}}" is not a filter. Use upper, lower, first:3, last:3, digits or nospaces.',
  ),
  filterNeedsCount: translationKey(
    '"{{filter}}" needs how many characters to keep, such as {{example}}.',
  ),
  filterTakesNoCount: translationKey(
    '"{{filter}}" takes no number. Write it as "{{filterName}}".',
  ),
  filterCountOutOfRange: translationKey(
    '"{{filter}}" keeps from 1 to {{max}} characters.',
  ),
  twoCounters: translationKey(
    "A name pattern can have one number, {n}, {nn}, {nnn} or {nnnn}, not more.",
  ),
  counterTakesNoFilters: translationKey(
    'A number takes no filters: write "{{counter}}" without "|".',
  ),
};

export function formatNamePatternProblem(problem: NamePatternProblem): string {
  let text: string = problem.template;

  for (const [key, value] of Object.entries(problem.values)) {
    text = text.split(`{{${key}}}`).join(value);
  }

  return text;
}

const PLACEHOLDERS_BY_NAME: ReadonlyMap<string, NamePlaceholder> = new Map<
  string,
  NamePlaceholder
>(
  Object.values(NamePlaceholder).map(
    (placeholder: NamePlaceholder): [string, NamePlaceholder] => {
      return [placeholder.toLowerCase(), placeholder];
    },
  ),
);

const COUNTER_WIDTHS: ReadonlyMap<string, number> = new Map<string, number>(
  NAME_COUNTERS.map((counter: { token: string; width: number }) => {
    return [counter.token, counter.width];
  }),
);

const FILTERS_WITH_COUNT: ReadonlySet<NameFilter> = new Set<NameFilter>([
  NameFilter.First,
  NameFilter.Last,
]);

const FILTERS_BY_NAME: ReadonlyMap<string, NameFilter> = new Map<
  string,
  NameFilter
>(
  Object.values(NameFilter).map((filter: NameFilter): [string, NameFilter] => {
    return [filter, filter];
  }),
);

// "{site.code}, {site}, ..." - every placeholder, as the problem lists them.
function listPlaceholders(): string {
  return NAME_PLACEHOLDERS.map((info: NamePlaceholderInfo): string => {
    return `{${info.placeholder}}`;
  })
    .concat(["{nn}"])
    .join(", ");
}

function problem(
  template: string,
  values: Record<string, string> = {},
): { problem: NamePatternProblem } {
  return { problem: { template: template, values: values } };
}

function hasControlCharacter(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }

  return false;
}

function parseFilter(
  text: string,
): { step: NamePatternFilterStep } | { problem: NamePatternProblem } {
  const piece: string = text.trim();
  const colon: number = piece.indexOf(":");
  const filterName: string = (colon === -1 ? piece : piece.substring(0, colon))
    .trim()
    .toLowerCase();
  const filter: NameFilter | undefined = FILTERS_BY_NAME.get(filterName);

  if (!filter) {
    return problem(NAME_PATTERN_PROBLEMS.unknownFilter, { filter: piece });
  }

  if (!FILTERS_WITH_COUNT.has(filter)) {
    if (colon !== -1) {
      return problem(NAME_PATTERN_PROBLEMS.filterTakesNoCount, {
        filter: piece,
        filterName: filter,
      });
    }

    return { step: { filter: filter } };
  }

  const countText: string = colon === -1 ? "" : piece.substring(colon + 1);

  if (!/^\s*\d{1,3}\s*$/.test(countText)) {
    return problem(NAME_PATTERN_PROBLEMS.filterNeedsCount, {
      filter: piece,
      example: `${filter}:3`,
    });
  }

  const count: number = parseInt(countText.trim(), 10);

  if (count < 1 || count > MAX_NAME_FILTER_COUNT) {
    return problem(NAME_PATTERN_PROBLEMS.filterCountOutOfRange, {
      filter: piece,
      max: String(MAX_NAME_FILTER_COUNT),
    });
  }

  return { step: { filter: filter, count: count } };
}

/*
 * One placeholder's insides - "site.code", "vendor|first:3|upper", "nn" -
 * read into its segment.
 */
function parsePlaceholder(
  inside: string,
): { segment: NamePatternSegment } | { problem: NamePatternProblem } {
  const parts: Array<string> = inside.split("|");
  const name: string = (parts[0] || "").trim();

  if (!name) {
    return problem(NAME_PATTERN_PROBLEMS.emptyPlaceholder);
  }

  const lowerName: string = name.toLowerCase();
  const counterWidth: number | undefined = COUNTER_WIDTHS.get(lowerName);

  if (counterWidth !== undefined) {
    if (parts.length > 1) {
      return problem(NAME_PATTERN_PROBLEMS.counterTakesNoFilters, {
        counter: `{${lowerName}}`,
      });
    }

    return { segment: { kind: "counter", width: counterWidth } };
  }

  const placeholder: NamePlaceholder | undefined =
    PLACEHOLDERS_BY_NAME.get(lowerName);

  if (!placeholder) {
    return problem(NAME_PATTERN_PROBLEMS.unknownPlaceholder, {
      placeholder: `{${name}}`,
      placeholders: listPlaceholders(),
    });
  }

  const filters: Array<NamePatternFilterStep> = [];

  for (const filterText of parts.slice(1)) {
    const read: { step: NamePatternFilterStep } | { problem: NamePatternProblem } =
      parseFilter(filterText);

    if ("problem" in read) {
      return read;
    }

    filters.push(read.step);
  }

  return {
    segment: { kind: "value", placeholder: placeholder, filters: filters },
  };
}

/**
 * The pattern read into its pieces, or what is wrong with it. Accepts
 * `unknown`: the value comes out of a request body or a database row.
 */
export function parseNamePattern(
  pattern: unknown,
): { pattern: ParsedNamePattern } | { problem: NamePatternProblem } {
  if (typeof pattern !== "string" || pattern.trim().length === 0) {
    return problem(NAME_PATTERN_PROBLEMS.empty);
  }

  if (pattern.length > MAX_NAME_PATTERN_LENGTH) {
    return problem(NAME_PATTERN_PROBLEMS.tooLong, {
      max: String(MAX_NAME_PATTERN_LENGTH),
    });
  }

  if (hasControlCharacter(pattern)) {
    return problem(NAME_PATTERN_PROBLEMS.controlCharacter);
  }

  const segments: Array<NamePatternSegment> = [];
  const placeholders: Array<NamePlaceholder> = [];
  let counterWidth: number | null = null;
  let text: string = "";
  let index: number = 0;

  const flushText: () => void = (): void => {
    if (text) {
      segments.push({ kind: "text", text: text });
      text = "";
    }
  };

  while (index < pattern.length) {
    const character: string = pattern[index]!;

    if (character === "{" && pattern[index + 1] === "{") {
      text += "{";
      index += 2;
      continue;
    }

    if (character === "}" && pattern[index + 1] === "}") {
      text += "}";
      index += 2;
      continue;
    }

    if (character === "}") {
      return problem(NAME_PATTERN_PROBLEMS.strayClosingBrace);
    }

    if (character !== "{") {
      text += character;
      index++;
      continue;
    }

    const close: number = pattern.indexOf("}", index + 1);
    const nextOpen: number = pattern.indexOf("{", index + 1);

    if (close === -1 || (nextOpen !== -1 && nextOpen < close)) {
      return problem(NAME_PATTERN_PROBLEMS.unclosedBrace, {
        piece: pattern.substring(index, nextOpen === -1 ? undefined : nextOpen),
      });
    }

    const read: { segment: NamePatternSegment } | { problem: NamePatternProblem } =
      parsePlaceholder(pattern.substring(index + 1, close));

    if ("problem" in read) {
      return read;
    }

    if (read.segment.kind === "counter") {
      if (counterWidth !== null) {
        return problem(NAME_PATTERN_PROBLEMS.twoCounters);
      }

      counterWidth = read.segment.width;
    }

    if (
      read.segment.kind === "value" &&
      !placeholders.includes(read.segment.placeholder)
    ) {
      placeholders.push(read.segment.placeholder);
    }

    flushText();
    segments.push(read.segment);
    index = close + 1;
  }

  flushText();

  return {
    pattern: {
      segments: segments,
      placeholders: placeholders,
      counterWidth: counterWidth,
    },
  };
}

// What is wrong with the pattern, or null when it is a pattern.
export function getNamePatternProblem(
  pattern: unknown,
): NamePatternProblem | null {
  const read: { pattern: ParsedNamePattern } | { problem: NamePatternProblem } =
    parseNamePattern(pattern);

  return "problem" in read ? read.problem : null;
}

// The same, in English: the server's refusal.
export function getNamePatternError(pattern: unknown): string | null {
  const found: NamePatternProblem | null = getNamePatternProblem(pattern);

  return found ? formatNamePatternProblem(found) : null;
}

/*
 * The values of one device, as the planner read them. Every one is optional:
 * a device lacking one is not named by a rule whose pattern needs it.
 */
export interface NamePatternValues {
  discoveredName?: string | undefined;
  ipAddress?: string | undefined;
  macAddress?: string | undefined;
  vendor?: string | undefined;
  siteName?: string | undefined;
  siteCode?: string | undefined;
  lookupValue?: string | undefined;
}

/*
 * A name the pattern made for a device: the text before the counter and the
 * text after it (all of it in `prefix` when there is no counter), or the
 * placeholder the device had no value for.
 */
export type NamePatternRendering =
  | {
      isComplete: true;
      prefix: string;
      suffix: string;
      counterWidth: number | null;
    }
  | { isComplete: false; missing: NamePlaceholder };

// A value as text, without control characters or surrounding spaces.
function cleanValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  let cleaned: string = "";
  const limited: string =
    value.length > MAX_VALUE_LENGTH
      ? value.substring(0, MAX_VALUE_LENGTH)
      : value;

  for (let index: number = 0; index < limited.length; index++) {
    const code: number = limited.charCodeAt(index);

    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      continue;
    }

    cleaned += limited[index];
  }

  return cleaned.trim();
}

/*
 * The four numbers of an IPv4 address, each without leading zeros, or null
 * for anything else - an IPv6 address has no "last part" in this sense.
 */
export function readIpv4Octets(value: unknown): Array<string> | null {
  const text: string = cleanValue(value);
  const parts: Array<string> = text.split(".");

  if (parts.length !== 4) {
    return null;
  }

  const octets: Array<string> = [];

  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }

    const octet: number = parseInt(part, 10);

    if (octet > 255) {
      return null;
    }

    octets.push(String(octet));
  }

  return octets;
}

/*
 * A MAC address as its twelve hex digits, upper case and without separators,
 * whichever way it was written ("00:05:0b:b0:7f:fc", "0005.0BB0.7FFC",
 * "00-05-0B-B0-7F-FC"), or null when it is not one.
 */
export function readMacAddressDigits(value: unknown): string | null {
  const text: string = cleanValue(value);
  let digits: string = "";

  for (const character of text) {
    if (/[0-9a-fA-F]/.test(character)) {
      digits += character;
      continue;
    }

    if (character === ":" || character === "-" || character === ".") {
      continue;
    }

    return null;
  }

  return digits.length === 12 ? digits.toUpperCase() : null;
}

function readPlaceholderValue(
  placeholder: NamePlaceholder,
  values: NamePatternValues,
): string {
  switch (placeholder) {
    case NamePlaceholder.DiscoveredName:
      return cleanValue(values.discoveredName);
    case NamePlaceholder.IpAddress:
      return cleanValue(values.ipAddress);
    case NamePlaceholder.IpOctet1:
      return readIpv4Octets(values.ipAddress)?.[0] || "";
    case NamePlaceholder.IpOctet2:
      return readIpv4Octets(values.ipAddress)?.[1] || "";
    case NamePlaceholder.IpOctet3:
      return readIpv4Octets(values.ipAddress)?.[2] || "";
    case NamePlaceholder.IpOctet4:
      return readIpv4Octets(values.ipAddress)?.[3] || "";
    case NamePlaceholder.MacAddress:
      return readMacAddressDigits(values.macAddress) || "";
    case NamePlaceholder.Vendor:
      return cleanValue(values.vendor);
    case NamePlaceholder.Site:
      return cleanValue(values.siteName);
    case NamePlaceholder.SiteCode:
      return cleanValue(values.siteCode);
    case NamePlaceholder.Lookup:
      return cleanValue(values.lookupValue);
    default:
      return "";
  }
}

// One filter applied to a value. Characters are counted as people see them.
export function applyNameFilter(
  value: string,
  step: NamePatternFilterStep,
): string {
  switch (step.filter) {
    case NameFilter.Upper:
      return value.toUpperCase();
    case NameFilter.Lower:
      return value.toLowerCase();
    case NameFilter.First:
      return Array.from(value)
        .slice(0, step.count || 0)
        .join("");
    case NameFilter.Last: {
      const characters: Array<string> = Array.from(value);
      return characters
        .slice(Math.max(0, characters.length - (step.count || 0)))
        .join("");
    }
    case NameFilter.Digits: {
      let digits: string = "";

      for (const character of value) {
        if (character >= "0" && character <= "9") {
          digits += character;
        }
      }

      return digits;
    }
    case NameFilter.NoSpaces: {
      let compact: string = "";

      for (const character of value) {
        if (character.trim()) {
          compact += character;
        }
      }

      return compact;
    }
    default:
      return value;
  }
}

/**
 * The name the pattern makes for a device with these values, or the first
 * placeholder it has no value for. A placeholder whose value is empty -
 * missing, or emptied by its filters - is a missing value.
 */
export function renderNamePattern(
  pattern: ParsedNamePattern,
  values: NamePatternValues,
): NamePatternRendering {
  let prefix: string = "";
  let suffix: string = "";
  let isAfterCounter: boolean = false;

  for (const segment of pattern.segments) {
    let piece: string;

    if (segment.kind === "counter") {
      isAfterCounter = true;
      continue;
    }

    if (segment.kind === "text") {
      piece = segment.text;
    } else {
      let value: string = readPlaceholderValue(segment.placeholder, values);

      for (const step of segment.filters) {
        value = applyNameFilter(value, step);
      }

      value = value.trim();

      if (!value) {
        return { isComplete: false, missing: segment.placeholder };
      }

      piece = value;
    }

    if (isAfterCounter) {
      suffix += piece;
    } else {
      prefix += piece;
    }
  }

  if (pattern.counterWidth === null) {
    return {
      isComplete: true,
      prefix: prefix.trim(),
      suffix: "",
      counterWidth: null,
    };
  }

  return {
    isComplete: true,
    prefix: prefix.trimStart(),
    suffix: suffix.trimEnd(),
    counterWidth: pattern.counterWidth,
  };
}

// A counter's number, with at least `width` digits: 1 -> "01" for {nn}.
export function formatNameCounter(value: number, width: number): string {
  const digits: string = String(Math.max(0, Math.floor(value)));

  return digits.length >= width
    ? digits
    : "0".repeat(width - digits.length) + digits;
}

// The whole name: the rendering with its counter, when it has one, set to `value`.
export function composeName(
  rendering: Extract<NamePatternRendering, { isComplete: true }>,
  value: number = 1,
): string {
  if (rendering.counterWidth === null) {
    return rendering.prefix;
  }

  return (
    rendering.prefix +
    formatNameCounter(value, rendering.counterWidth) +
    rendering.suffix
  );
}

/*
 * The number a name already carries in a counter's place - "UN1216LANSWI03"
 * carries 3 for UN1216LANSWI{nn} - or null when the name is not one the
 * pattern makes. Compared without case; the digits must be at least the
 * counter's width, so "UN1216LANSWI3" does not follow {nn}.
 */
export function readNameCounter(
  name: string,
  rendering: Extract<NamePatternRendering, { isComplete: true }>,
): number | null {
  if (rendering.counterWidth === null) {
    return null;
  }

  const lowerName: string = name.toLowerCase();
  const prefix: string = rendering.prefix.toLowerCase();
  const suffix: string = rendering.suffix.toLowerCase();

  if (
    lowerName.length < prefix.length + suffix.length + rendering.counterWidth ||
    !lowerName.startsWith(prefix) ||
    !lowerName.endsWith(suffix)
  ) {
    return null;
  }

  const digits: string = lowerName.substring(
    prefix.length,
    lowerName.length - suffix.length,
  );

  if (!/^\d+$/.test(digits) || digits.length < rendering.counterWidth) {
    return null;
  }

  const value: number = parseInt(digits, 10);

  // "00" is not a number the counter writes: it starts at 1.
  if (value < 1 || formatNameCounter(value, rendering.counterWidth) !== digits) {
    return null;
  }

  return value;
}

/*
 * The example device the rule form names as it is typed: the values of
 * NAME_PLACEHOLDERS, with the lookup table's first value when it has one.
 */
export function getExampleNamePatternValues(
  lookupValue?: string | undefined,
): NamePatternValues {
  const example: (placeholder: NamePlaceholder) => string = (
    placeholder: NamePlaceholder,
  ): string => {
    return (
      NAME_PLACEHOLDERS.find((info: NamePlaceholderInfo): boolean => {
        return info.placeholder === placeholder;
      })?.example || ""
    );
  };

  return {
    discoveredName: example(NamePlaceholder.DiscoveredName),
    ipAddress: example(NamePlaceholder.IpAddress),
    macAddress: example(NamePlaceholder.MacAddress),
    vendor: example(NamePlaceholder.Vendor),
    siteName: example(NamePlaceholder.Site),
    siteCode: example(NamePlaceholder.SiteCode),
    lookupValue: lookupValue?.trim() || example(NamePlaceholder.Lookup),
  };
}

// The name a pattern gives the example device, or null for a pattern with a problem.
export function getExampleName(
  pattern: unknown,
  lookupValue?: string | undefined,
): string | null {
  const read: { pattern: ParsedNamePattern } | { problem: NamePatternProblem } =
    parseNamePattern(pattern);

  if ("problem" in read) {
    return null;
  }

  const rendering: NamePatternRendering = renderNamePattern(
    read.pattern,
    getExampleNamePatternValues(lookupValue),
  );

  return rendering.isComplete ? composeName(rendering, 1) : null;
}
