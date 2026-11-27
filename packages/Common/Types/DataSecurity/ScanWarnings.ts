import escapeRegExp from "../../Utils/RegExpEscape";
import { formatUnitAmount } from "../DateLanguage";
import { withDurationWordsHeld } from "../NoBreakSpaces";
import {
  describeScanDuration,
  readScanDuration,
  SCAN_DURATION_PATTERN,
} from "./ScanWarningDuration";
import {
  composedValue,
  TemplateValue,
  TemplateValues,
  translatableTerm,
  translationKey,
  Translator,
} from "../Translator";

/*
 * WHAT A DATA SECURITY SCAN COULD NOT READ, IN THE READER'S LANGUAGE (#10930).
 *
 * A scan says what it could not read, and why, in its warnings
 * (DataSecurityScan.warnings): English sentences, the text the API, the MCP
 * server and OneUptime AI have always read. Each one a content scan, the
 * hourly telemetry scan or the names-and-addresses model writes is one of
 * the templates here with its values filled in - counts, durations, names,
 * an error's own words - never what was read:
 *
 *  - the scanner writes it with writeScanWarning, so its English is the
 *    template's, word for word;
 *  - the Dashboard reads it back with readScanWarning - which template, and
 *    its values - and draws it with translateScanWarning in the reader's
 *    language, the template's English being its translation key, as every
 *    Dashboard string's is. A count is written in the reader's digits, a
 *    duration in their words, a format's name translated;
 *  - a warning no template matches - one a probe of an older release worded
 *    otherwise, a configuration read's, which keeps the cloud connector's
 *    own words - is drawn as it was written. Nothing is stored twice: a
 *    warning written before this is read back as one written after.
 *
 * Only the words this file marks with translationKey are extracted into the
 * Dashboard's locales (scripts/i18n/ExtractStrings.ts reads it as "keys"):
 * the server writes the same file's English.
 */

export enum ScanWarningValueKind {
  // A whole number: written as digits, drawn in the reader's.
  Count = "count",
  // A length of time: written "6 seconds", drawn in the reader's words.
  Duration = "duration",
  // A table, an object, a pattern, a store, a file: drawn as written.
  Name = "name",
  // An error's own words, from the database or the cloud: drawn as written.
  Text = "text",
  // A format's name (SCAN_FORMAT_NAMES): drawn translated.
  Format = "format",
}

export interface ScanWarningTemplate {
  // The sentence, each value a {{placeholder}}: its English is its translation key.
  readonly english: string;
  readonly values: Readonly<Record<string, ScanWarningValueKind>>;
}

const COUNT: ScanWarningValueKind = ScanWarningValueKind.Count;
const DURATION: ScanWarningValueKind = ScanWarningValueKind.Duration;
const NAME: ScanWarningValueKind = ScanWarningValueKind.Name;
const TEXT: ScanWarningValueKind = ScanWarningValueKind.Text;
const FORMAT: ScanWarningValueKind = ScanWarningValueKind.Format;

/*
 * The formats a content scan does not read, as its warnings name them: by
 * an object's extension (ObjectStoreSampler) or its first bytes
 * (ContentClassifier.getBinaryFormat). Translated as a word of the sentence.
 */
export const SCAN_FORMAT_NAMES: ReadonlyArray<string> = [
  translationKey("PNG image"),
  translationKey("JPEG image"),
  translationKey("GIF image"),
  translationKey("WebP image"),
  translationKey("BMP image"),
  translationKey("icon"),
  translationKey("TIFF image"),
  translationKey("HEIC image"),
  translationKey("MP4 video"),
  translationKey("QuickTime video"),
  translationKey("AVI video"),
  translationKey("Matroska video"),
  translationKey("WebM video"),
  translationKey("MP3 audio"),
  translationKey("WAV audio"),
  translationKey("FLAC audio"),
  translationKey("Ogg media"),
  translationKey("M4A audio"),
  translationKey("Parquet"),
  translationKey("Avro"),
  translationKey("ORC"),
  translationKey("Arrow"),
  translationKey("Feather"),
  translationKey("PDF"),
  translationKey("tar archive"),
  translationKey("7z archive"),
  translationKey("RAR archive"),
  translationKey("bzip2"),
  translationKey("xz"),
  translationKey("Zstandard"),
  translationKey("executable"),
  translationKey("library"),
  translationKey("Java class file"),
  translationKey("Java archive"),
  translationKey("Python bytecode"),
  translationKey("WebAssembly"),
  translationKey("disk image"),
  translationKey("font"),
  translationKey("SQLite database"),
  translationKey("Office 97-2003 document"),
  translationKey("ELF executable"),
  translationKey("a ZIP archive"),
  translationKey("binary content"),
];

export type ScanWarningKey =
  | "modelStoreTimeRanOut"
  | "modelScanTimeRanOut"
  | "modelNotInstalledOnServer"
  | "modelNotInstalledOnProbe"
  | "modelNotPinnedOnServer"
  | "modelNotPinnedOnProbe"
  | "modelCouldNotStartOnServer"
  | "modelCouldNotStartOnProbe"
  | "modelStoppedPartWay"
  | "databaseTimeLimitBeforeConnecting"
  | "databaseCouldNotListTables"
  | "databaseTablesNotSampled"
  | "databaseTimeLimitAfterTables"
  | "databaseBytesAfterTables"
  | "databaseFailuresInARow"
  | "databaseCouldNotSampleTable"
  | "bigQueryTablesNotListedAtLimit"
  | "bigQueryCouldNotListTables"
  | "bigQueryTablesNotReadAtLimit"
  | "bigQueryCouldNotReadTable"
  | "bigQueryMoreTables"
  | "objectsTimeLimitWhileListing"
  | "objectsCouldNotList"
  | "objectsListedFirst"
  | "objectsPatternsNotSampled"
  | "objectsTimeLimitAfterObjects"
  | "objectsBytesAfterObjects"
  | "objectsCouldNotRead"
  | "objectsCouldNotClassify"
  | "patternFormatNotSupported"
  | "patternInflatesPast"
  | "patternGzipNotInflated"
  | "patternZipBomb"
  | "patternZipUnreadableBecause"
  | "patternZipUnreadable"
  | "patternSharedStringsUnreadable"
  | "patternFirstSheets"
  | "patternSheetUnreadable"
  | "patternPartUnreadable"
  | "telemetryRestrictedConversations"
  | "telemetryServiceLogsUnread"
  | "telemetryServiceSpansUnread"
  | "telemetryServiceExceptionsUnread"
  | "telemetryServiceAiCallsUnread"
  | "telemetryApplicationLogsUnread"
  | "telemetryApplicationSpansUnread"
  | "telemetryApplicationSessionsUnread"
  | "telemetryServiceMetricsUnread"
  | "telemetrySomeMetricsUnread"
  | "telemetryMetricsOutOfBudget"
  | "telemetrySampleOutOfBudget"
  | "telemetryCouldNotClassify"
  | "telemetryApplicationGone"
  | "telemetryServiceGone"
  | "telemetryTooManyAttributes";

/*
 * Every warning a content or telemetry scan writes, and the model's. The
 * order is the order they are tried in when one is read back: a template
 * whose words another's could hold comes first.
 */
export const SCAN_WARNINGS: Readonly<
  Record<ScanWarningKey, ScanWarningTemplate>
> = {
  // The names-and-addresses model (Server/Utils/DataSecurity/Model).
  modelStoreTimeRanOut: {
    english: translationKey(
      "Names and street addresses were looked for in {{read}} of {{total}} free-text values: this store's {{limit}} of model time ran out.",
    ),
    values: { read: COUNT, total: COUNT, limit: DURATION },
  },
  modelScanTimeRanOut: {
    english: translationKey(
      "Names and street addresses were looked for in {{read}} of {{total}} free-text values: the scan's {{limit}} of model time ran out.",
    ),
    values: { read: COUNT, total: COUNT, limit: DURATION },
  },
  modelNotInstalledOnServer: {
    english: translationKey(
      "Names and street addresses in free text were not looked for: the model's {{file}} is not installed on this server.",
    ),
    values: { file: NAME },
  },
  modelNotInstalledOnProbe: {
    english: translationKey(
      "Names and street addresses in free text were not looked for: the model's {{file}} is not installed on this probe.",
    ),
    values: { file: NAME },
  },
  modelNotPinnedOnServer: {
    english: translationKey(
      "Names and street addresses in free text were not looked for: the model's {{file}} is not the pinned file on this server.",
    ),
    values: { file: NAME },
  },
  modelNotPinnedOnProbe: {
    english: translationKey(
      "Names and street addresses in free text were not looked for: the model's {{file}} is not the pinned file on this probe.",
    ),
    values: { file: NAME },
  },
  modelCouldNotStartOnServer: {
    english: translationKey(
      "Names and street addresses in free text were not looked for: the model could not start on this server.",
    ),
    values: {},
  },
  modelCouldNotStartOnProbe: {
    english: translationKey(
      "Names and street addresses in free text were not looked for: the model could not start on this probe.",
    ),
    values: {},
  },
  modelStoppedPartWay: {
    english: translationKey(
      "Names and street addresses in free text were not looked for: the model stopped part-way through this scan.",
    ),
    values: {},
  },

  // A database's content scan, on a worker or a probe (Content/DatabaseSampler).
  databaseTimeLimitBeforeConnecting: {
    english: translationKey(
      "The scan reached its time limit before it could connect.",
    ),
    values: {},
  },
  databaseCouldNotListTables: {
    english: translationKey("Could not list the tables: {{error}}"),
    values: { error: TEXT },
  },
  databaseTablesNotSampled: {
    english: translationKey(
      "{{count}} tables were not sampled: the scan reads at most {{max}} tables.",
    ),
    values: { count: COUNT, max: COUNT },
  },
  databaseTimeLimitAfterTables: {
    english: translationKey(
      "The scan reached its time limit after {{read}} of {{total}} tables.",
    ),
    values: { read: COUNT, total: COUNT },
  },
  databaseBytesAfterTables: {
    english: translationKey(
      "The scan read its {{bytes}} bytes after {{read}} of {{total}} tables.",
    ),
    values: { bytes: COUNT, read: COUNT, total: COUNT },
  },
  databaseFailuresInARow: {
    english: translationKey(
      "The scan stopped after {{count}} tables in a row could not be read.",
    ),
    values: { count: COUNT },
  },
  databaseCouldNotSampleTable: {
    english: translationKey("Could not sample {{table}}: {{error}}"),
    values: { table: NAME, error: TEXT },
  },

  /*
   * A BigQuery dataset's content scan (Cloud/Gcp/GcpDataSecurityReader):
   * before a bucket's, whose "Could not read {{key}}: ..." would hold
   * "Could not read table ... of ...: ...".
   */
  bigQueryTablesNotListedAtLimit: {
    english: translationKey(
      "The tables of {{dataset}} were not listed: the read reached its limit.",
    ),
    values: { dataset: NAME },
  },
  bigQueryCouldNotListTables: {
    english: translationKey(
      "Could not list the tables of {{dataset}}: {{error}}",
    ),
    values: { dataset: NAME, error: TEXT },
  },
  bigQueryTablesNotReadAtLimit: {
    english: translationKey(
      "The read reached its limit: {{count}} tables of {{dataset}} were not read.",
    ),
    values: { count: COUNT, dataset: NAME },
  },
  bigQueryCouldNotReadTable: {
    english: translationKey(
      "Could not read table {{table}} of {{dataset}}: {{error}}",
    ),
    values: { table: NAME, dataset: NAME, error: TEXT },
  },
  bigQueryMoreTables: {
    english: translationKey(
      "{{dataset}} has more tables than one sample reads: the first {{count}} were read.",
    ),
    values: { dataset: NAME, count: COUNT },
  },

  // A bucket's or a storage account's content scan (Content/ObjectStoreSampler).
  objectsTimeLimitWhileListing: {
    english: translationKey(
      "The scan reached its time limit while listing {{store}}, after {{count}} objects.",
    ),
    values: { store: NAME, count: COUNT },
  },
  objectsCouldNotList: {
    english: translationKey(
      "Could not list the objects of {{store}}: {{error}}",
    ),
    values: { store: NAME, error: TEXT },
  },
  objectsListedFirst: {
    english: translationKey(
      "Listed the first {{count}} objects of {{store}}; the patterns of the objects after them were not sampled.",
    ),
    values: { count: COUNT, store: NAME },
  },
  objectsPatternsNotSampled: {
    english: translationKey(
      "{{count}} patterns were not sampled: the scan reads at most {{max}} objects.",
    ),
    values: { count: COUNT, max: COUNT },
  },
  objectsTimeLimitAfterObjects: {
    english: translationKey(
      "The scan reached its time limit after reading {{read}} of {{total}} objects.",
    ),
    values: { read: COUNT, total: COUNT },
  },
  objectsBytesAfterObjects: {
    english: translationKey(
      "The scan read its {{bytes}} bytes after {{read}} of {{total}} objects.",
    ),
    values: { bytes: COUNT, read: COUNT, total: COUNT },
  },
  objectsCouldNotRead: {
    english: translationKey("Could not read {{key}}: {{error}}"),
    values: { key: NAME, error: TEXT },
  },
  objectsCouldNotClassify: {
    english: translationKey("Could not classify {{key}}: {{error}}"),
    values: { key: NAME, error: TEXT },
  },

  // What a pattern's object held that could not be read (Content/ContentClassifier, OfficeDocuments).
  patternFormatNotSupported: {
    english: translationKey(
      "{{pattern}}: not scanned: {{format}} is not supported yet",
    ),
    values: { pattern: NAME, format: FORMAT },
  },
  patternInflatesPast: {
    english: translationKey(
      "{{pattern}}: read in part: it inflates past {{bytes}} bytes",
    ),
    values: { pattern: NAME, bytes: COUNT },
  },
  patternGzipNotInflated: {
    english: translationKey(
      "{{pattern}}: not scanned: the gzip data could not be inflated",
    ),
    values: { pattern: NAME },
  },
  patternZipBomb: {
    english: translationKey(
      "{{pattern}}: not scanned: refused as a zip bomb ({{error}})",
    ),
    values: { pattern: NAME, error: TEXT },
  },
  patternZipUnreadableBecause: {
    english: translationKey(
      "{{pattern}}: not scanned: the ZIP archive could not be read ({{error}})",
    ),
    values: { pattern: NAME, error: TEXT },
  },
  patternZipUnreadable: {
    english: translationKey(
      "{{pattern}}: not scanned: the ZIP archive could not be read",
    ),
    values: { pattern: NAME },
  },
  patternSharedStringsUnreadable: {
    english: translationKey(
      "{{pattern}}: The workbook's shared strings could not be read.",
    ),
    values: { pattern: NAME },
  },
  patternFirstSheets: {
    english: translationKey(
      "{{pattern}}: Only the first {{read}} of the workbook's {{total}} sheets were read.",
    ),
    values: { pattern: NAME, read: COUNT, total: COUNT },
  },
  patternSheetUnreadable: {
    english: translationKey(
      "{{pattern}}: The sheet {{sheet}} could not be read.",
    ),
    values: { pattern: NAME, sheet: NAME },
  },
  patternPartUnreadable: {
    english: translationKey(
      "{{pattern}}: {{part}} could not be read: {{error}}",
    ),
    values: { pattern: NAME, part: NAME, error: TEXT },
  },

  // The hourly telemetry scan (Telemetry/TelemetryDataScanner).
  telemetryRestrictedConversations: {
    english: translationKey(
      "Not read: this service holds a company AI tool's conversations, which only Project Owners and Project Admins may read, and findings are read by everyone with access to Data Security.",
    ),
    values: {},
  },
  telemetryServiceLogsUnread: {
    english: translationKey(
      "Could not read this service's logs in this scan; the next scan reads them again.",
    ),
    values: {},
  },
  telemetryServiceSpansUnread: {
    english: translationKey(
      "Could not read this service's spans in this scan; the next scan reads them again.",
    ),
    values: {},
  },
  telemetryServiceExceptionsUnread: {
    english: translationKey(
      "Could not read this service's exceptions in this scan; the next scan reads them again.",
    ),
    values: {},
  },
  telemetryServiceAiCallsUnread: {
    english: translationKey(
      "Could not read this service's AI calls in this scan; the next scan reads them again.",
    ),
    values: {},
  },
  telemetryApplicationLogsUnread: {
    english: translationKey(
      "Could not read this RUM application's logs in this scan; the next scan reads them again.",
    ),
    values: {},
  },
  telemetryApplicationSpansUnread: {
    english: translationKey(
      "Could not read this RUM application's spans in this scan; the next scan reads them again.",
    ),
    values: {},
  },
  telemetryApplicationSessionsUnread: {
    english: translationKey(
      "Could not read this RUM application's sessions in this scan; the next scan reads them again.",
    ),
    values: {},
  },
  telemetryServiceMetricsUnread: {
    english: translationKey(
      "Could not read this service's metrics in this scan; the next scan reads them again.",
    ),
    values: {},
  },
  telemetrySomeMetricsUnread: {
    english: translationKey(
      "Could not read some of this service's metrics in this scan; the next scan reads them again.",
    ),
    values: {},
  },
  telemetryMetricsOutOfBudget: {
    english: translationKey(
      "The scan read as much as it may this time: some of this service's metrics were not read.",
    ),
    values: {},
  },
  telemetrySampleOutOfBudget: {
    english: translationKey(
      "The scan read as much as it may this time: part of this sample was not classified.",
    ),
    values: {},
  },
  telemetryCouldNotClassify: {
    english: translationKey("Could not classify {{location}}."),
    values: { location: NAME },
  },
  telemetryApplicationGone: {
    english: translationKey(
      "No RUM application with this ID exists any more; its telemetry is kept until its retention ends.",
    ),
    values: {},
  },
  telemetryServiceGone: {
    english: translationKey(
      "No service with this ID exists any more; its telemetry is kept until its retention ends.",
    ),
    values: {},
  },
  telemetryTooManyAttributes: {
    english: translationKey(
      "More than {{max}} different attributes: the ones after them were not read.",
    ),
    values: { max: COUNT },
  },
};

// A warning's values as it is written: a count or a duration in milliseconds as a number, the rest as text.
export type ScanWarningValues = Readonly<Record<string, string | number>>;

function writeValue(
  kind: ScanWarningValueKind,
  value: string | number,
): string {
  if (kind === ScanWarningValueKind.Count) {
    return String(Math.max(0, Math.round(Number(value) || 0)));
  }

  if (kind === ScanWarningValueKind.Duration) {
    return describeScanDuration(Number(value) || 0);
  }

  return String(value);
}

/*
 * The warning in English, as a scan writes it: the template with its
 * values filled in. A value the template does not name is left out; one it
 * names and is not given is written as nothing.
 */
export function writeScanWarning(
  key: ScanWarningKey,
  values: ScanWarningValues = {},
): string {
  const template: ScanWarningTemplate = SCAN_WARNINGS[key];

  return template.english.replace(
    /\{\{(\w+)\}\}/g,
    (whole: string, name: string): string => {
      const kind: ScanWarningValueKind | undefined = template.values[name];

      if (!kind) {
        return whole;
      }

      const value: string | number | undefined = values[name];

      return value === undefined ? "" : writeValue(kind, value);
    },
  );
}

// A warning read back: which template, and its values (counts and durations as numbers).
export interface ReadScanWarning {
  key: ScanWarningKey;
  values: Record<string, string | number>;
}

interface CompiledTemplate {
  key: ScanWarningKey;
  pattern: RegExp;
  names: Array<string>;
  kinds: Array<ScanWarningValueKind>;
}

const FORMAT_ALTERNATIVES: string = [...SCAN_FORMAT_NAMES]
  .sort((a: string, b: string): number => {
    return b.length - a.length;
  })
  .map((name: string): string => {
    return escapeRegExp(name);
  })
  .join("|");

function valuePattern(kind: ScanWarningValueKind, isLast: boolean): string {
  switch (kind) {
    case ScanWarningValueKind.Count:
      return "([0-9]{1,15})";
    case ScanWarningValueKind.Duration:
      return SCAN_DURATION_PATTERN;
    case ScanWarningValueKind.Format:
      return `(${FORMAT_ALTERNATIVES})`;
    default:
      // A name or an error's words: anything, as little as the rest of the sentence allows.
      return isLast ? "([\\s\\S]+)" : "([\\s\\S]+?)";
  }
}

let compiled: Array<CompiledTemplate> | null = null;

function getCompiledTemplates(): Array<CompiledTemplate> {
  if (compiled) {
    return compiled;
  }

  compiled = (Object.keys(SCAN_WARNINGS) as Array<ScanWarningKey>).map(
    (key: ScanWarningKey): CompiledTemplate => {
      const template: ScanWarningTemplate = SCAN_WARNINGS[key];
      const parts: Array<string> = template.english.split(/\{\{(\w+)\}\}/);
      const names: Array<string> = [];
      const kinds: Array<ScanWarningValueKind> = [];
      let source: string = "^";

      parts.forEach((part: string, index: number): void => {
        if (index % 2 === 0) {
          source += escapeRegExp(part);
          return;
        }

        const kind: ScanWarningValueKind =
          template.values[part] || ScanWarningValueKind.Text;

        names.push(part);
        kinds.push(kind);
        source += valuePattern(kind, index === parts.length - 2);
      });

      return { key, pattern: new RegExp(`${source}$`), names, kinds };
    },
  );

  return compiled;
}

// The longest warning read back: a scan keeps 500 characters of one.
export const MAX_READ_SCAN_WARNING_LENGTH: number = 2000;

/*
 * Which template a stored warning was written from, and its values - or
 * null for one no template matches, which is drawn as it was written.
 */
export function readScanWarning(text: unknown): ReadScanWarning | null {
  if (
    typeof text !== "string" ||
    text.length === 0 ||
    text.length > MAX_READ_SCAN_WARNING_LENGTH
  ) {
    return null;
  }

  for (const template of getCompiledTemplates()) {
    const match: RegExpMatchArray | null = text.match(template.pattern);

    if (!match) {
      continue;
    }

    const values: Record<string, string | number> = {};
    let isRead: boolean = true;

    template.names.forEach((name: string, index: number): void => {
      const raw: string = match[index + 1] || "";
      const kind: ScanWarningValueKind = template.kinds[index]!;

      if (kind === ScanWarningValueKind.Count) {
        values[name] = Number(raw);
      } else if (kind === ScanWarningValueKind.Duration) {
        const milliseconds: number | null = readScanDuration(raw);

        isRead = isRead && milliseconds !== null;
        values[name] = milliseconds ?? 0;
      } else {
        values[name] = raw;
      }
    });

    if (isRead) {
      return { key: template.key, values };
    }
  }

  return null;
}

/*
 * A duration in the words of `language` - "6 Sekunden", "2 minutes" -
 * whole minutes as minutes, as the English writes it, the number held to
 * its unit. Where Intl cannot write the unit, the English a scan stores,
 * held the same way: a page draws it.
 */
export function formatScanDuration(
  milliseconds: number,
  language: string,
): string {
  const seconds: number = Math.max(1, Math.round(milliseconds / 1000));
  const isMinutes: boolean = seconds % 60 === 0;

  return (
    formatUnitAmount({
      value: isMinutes ? seconds / 60 : seconds,
      unit: isMinutes ? "minute" : "second",
      unitDisplay: "long",
      maximumFractionDigits: 0,
      locale: language,
    }) || withDurationWordsHeld(describeScanDuration(milliseconds))
  );
}

/*
 * A stored warning as the reader reads it: its sentence in their language
 * when it is one of the templates here and their language words it, each
 * value written as they write it; as it was written otherwise. Every value
 * is set apart from the words around it, for a page to draw.
 */
export function translateScanWarning(
  text: string,
  translator: Translator,
): string {
  const read: ReadScanWarning | null = readScanWarning(text);

  if (!read) {
    return text;
  }

  const template: ScanWarningTemplate = SCAN_WARNINGS[read.key];
  const values: TemplateValues = {};

  for (const [name, value] of Object.entries(read.values)) {
    const kind: ScanWarningValueKind | undefined = template.values[name];
    let filled: TemplateValue;

    if (kind === ScanWarningValueKind.Count) {
      filled = composedValue((sentence: Translator): string => {
        return sentence.formatNumber(Number(value));
      });
    } else if (kind === ScanWarningValueKind.Duration) {
      filled = composedValue((sentence: Translator): string => {
        return formatScanDuration(Number(value), sentence.language);
      });
    } else if (kind === ScanWarningValueKind.Format) {
      /*
       * As its name is written - each is worded for the middle of the
       * sentence - so a format named for its maker keeps its capital:
       * "Parquet", "Java class file", never "parquet".
       */
      filled = translatableTerm(String(value));
    } else {
      filled = String(value);
    }

    values[name] = filled;
  }

  return translator.translateTemplate(template.english, values, {
    setsValuesApart: true,
  });
}
