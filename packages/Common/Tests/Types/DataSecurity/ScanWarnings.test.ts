import { describe, expect, test } from "@jest/globals";
import { BINARY_SIGNATURES } from "../../../Server/Utils/DataSecurity/Content/ContentClassifier";
import { UNREAD_EXTENSIONS } from "../../../Server/Utils/DataSecurity/Content/ObjectStoreSampler";
import {
  describeScanDuration,
  formatScanDuration,
  MAX_READ_SCAN_WARNING_LENGTH,
  readScanDuration,
  ReadScanWarning,
  readScanWarning,
  SCAN_FORMAT_NAMES,
  SCAN_WARNINGS,
  ScanWarningKey,
  ScanWarningTemplate,
  ScanWarningValueKind,
  ScanWarningValues,
  translateScanWarning,
  writeScanWarning,
} from "../../../Types/DataSecurity/ScanWarnings";
import { createTranslator, Translator } from "../../../Types/Translator";

/*
 * A DATA SECURITY SCAN'S WARNINGS, IN THE READER'S LANGUAGE (#10930).
 *
 * Every warning a content scan, the telemetry scan or the names-and-
 * addresses model writes is one of a set of templates: written in English
 * as scans always wrote it, read back from that English into its template
 * and its values, and drawn in the reader's language. These hold the set
 * together: every template reads back what it writes, whatever its values
 * hold; none reads another's; the words scans wrote before this read back
 * too; and a reader in another language reads every word of it in theirs -
 * counts in their digits, durations in their words, formats translated -
 * or, where their language has no wording yet, all of it in English.
 */

// Two values with nothing between them: no reading could tell them apart.
const ADJACENT_VALUES: RegExp = /\}\}\{\{/;

const KEYS: Array<ScanWarningKey> = Object.keys(
  SCAN_WARNINGS,
) as Array<ScanWarningKey>;

/*
 * A sentence as it reads: without the isolate marks a page sets values
 * apart with, and with the no-break spaces that keep a number with its
 * unit ("6 seconds") read as the spaces they look like.
 */
function withoutIsolates(text: string): string {
  return text.replace(/[\u2066-\u2069]/g, "").replace(/[\u00A0\u202F]/g, " ");
}

/*
 * Values that make writing and reading a template back hard: names with
 * dots, slashes, stars, colons and accents; errors with colons, full stops
 * and line breaks. A name never holds what separates it from the next
 * value in a sentence (": ", " of "), as a table, a pattern or a store's
 * name does not.
 */
function trickyValue(
  kind: ScanWarningValueKind,
  index: number,
): string | number {
  switch (kind) {
    case ScanWarningValueKind.Count:
      return [0, 1, 7, 42, 1234, 52428800][index % 6]!;
    case ScanWarningValueKind.Duration:
      return [6000, 60000, 120000, 1000, 90000][index % 5]!;
    case ScanWarningValueKind.Format:
      return SCAN_FORMAT_NAMES[index % SCAN_FORMAT_NAMES.length]!;
    case ScanWarningValueKind.Name:
      return [
        "public.users",
        "exports/*/users-*.csv",
        "s3://acme-data",
        "proj.dataset_1",
        "attributes.http.request.body",
        "Ünïcödé-name, with things",
        "sheet 3 (copy)",
      ][index % 7]!;
    default:
      return [
        "permission denied for table users",
        "AccessDenied: the role may not read this object",
        "connect ECONNREFUSED 10.0.0.4:5432",
        "line 1\nline 2: more",
        "timeout after 30s.",
      ][index % 5]!;
  }
}

function valuesFor(
  key: ScanWarningKey,
  seed: number,
): Record<string, string | number> {
  const template: ScanWarningTemplate = SCAN_WARNINGS[key];
  const values: Record<string, string | number> = {};

  Object.entries(template.values).forEach(
    ([name, kind]: [string, ScanWarningValueKind], index: number): void => {
      values[name] = trickyValue(kind, seed + index);
    },
  );

  return values;
}

describe("the templates", () => {
  test("each names exactly the values it says it has, each once", () => {
    for (const key of KEYS) {
      const template: ScanWarningTemplate = SCAN_WARNINGS[key];
      const named: Array<string> = Array.from(
        template.english.matchAll(/\{\{(\w+)\}\}/g),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect({ key, named: [...named].sort() }).toEqual({
        key,
        named: Object.keys(template.values).sort(),
      });
      expect({ key, once: new Set(named).size === named.length }).toEqual({
        key,
        once: true,
      });
    }
  });

  test("no two say the same thing", () => {
    const sentences: Set<string> = new Set(
      KEYS.map((key: ScanWarningKey): string => {
        return SCAN_WARNINGS[key].english;
      }),
    );

    expect(sentences.size).toBe(KEYS.length);
  });

  test("no two values of a sentence sit side by side with nothing between them to tell them apart", () => {
    for (const key of KEYS) {
      expect({
        key,
        adjacent: ADJACENT_VALUES.test(SCAN_WARNINGS[key].english),
      }).toEqual({ key, adjacent: false });
    }
  });

  test("the formats a warning names are each one name, once", () => {
    expect(new Set(SCAN_FORMAT_NAMES).size).toBe(SCAN_FORMAT_NAMES.length);
  });

  test("every format a content scan names is one of them: by an object's extension, and by its first bytes", () => {
    const named: Set<string> = new Set([
      ...UNREAD_EXTENSIONS.values(),
      ...BINARY_SIGNATURES.map((signature: { format: string }): string => {
        return signature.format;
      }),
      "a ZIP archive",
      "binary content",
    ]);

    for (const format of named) {
      expect({ format, known: SCAN_FORMAT_NAMES.includes(format) }).toEqual({
        format,
        known: true,
      });
    }
  });
});

describe("written, then read back", () => {
  test("every template reads back what it writes, its values as they were", () => {
    for (const key of KEYS) {
      for (let seed: number = 0; seed < 7; seed++) {
        const values: Record<string, string | number> = valuesFor(key, seed);
        const written: string = writeScanWarning(key, values);
        const read: ReadScanWarning | null = readScanWarning(written);

        expect({ key, seed, read }).toEqual({
          key,
          seed,
          read: { key, values },
        });
      }
    }
  });

  test("a sentence with no values is written as it reads", () => {
    expect(writeScanWarning("databaseTimeLimitBeforeConnecting")).toBe(
      "The scan reached its time limit before it could connect.",
    );
    expect(writeScanWarning("telemetryServiceGone")).toBe(
      "No service with this ID exists any more; its telemetry is kept until its retention ends.",
    );
  });

  test("counts are written as whole digits, durations in words", () => {
    expect(
      writeScanWarning("modelStoreTimeRanOut", {
        read: 120,
        total: 500,
        limit: 6000,
      }),
    ).toBe(
      "Names and street addresses were looked for in 120 of 500 free-text values: this store's 6 seconds of model time ran out.",
    );
    expect(
      writeScanWarning("modelScanTimeRanOut", {
        read: 3.4,
        total: 6,
        limit: 120000,
      }),
    ).toBe(
      "Names and street addresses were looked for in 3 of 6 free-text values: the scan's 2 minutes of model time ran out.",
    );
    expect(
      writeScanWarning("databaseBytesAfterTables", {
        bytes: 52428800,
        read: 3,
        total: 10,
      }),
    ).toBe("The scan read its 52428800 bytes after 3 of 10 tables.");
  });

  test("a value not given is written as nothing, one not named is left out", () => {
    expect(writeScanWarning("databaseCouldNotListTables", {})).toBe(
      "Could not list the tables: ",
    );
    expect(
      writeScanWarning("telemetryCouldNotClassify", {
        location: "body",
        other: "ignored",
      }),
    ).toBe("Could not classify body.");
  });

  test("an error that names another warning's words is still its own warning's", () => {
    const written: string = writeScanWarning("databaseCouldNotSampleTable", {
      table: "public.orders",
      error:
        "Could not read table x of y: not scanned: PDF is not supported yet",
    });

    expect(readScanWarning(written)).toEqual({
      key: "databaseCouldNotSampleTable",
      values: {
        table: "public.orders",
        error:
          "Could not read table x of y: not scanned: PDF is not supported yet",
      },
    });
  });

  test("a BigQuery table that could not be read is not read as a bucket's object", () => {
    expect(
      readScanWarning(
        "Could not read table events of acme-prod.analytics: 403 Access Denied",
      ),
    ).toEqual({
      key: "bigQueryCouldNotReadTable",
      values: {
        table: "events",
        dataset: "acme-prod.analytics",
        error: "403 Access Denied",
      },
    });
    expect(readScanWarning("Could not read exports/a.csv: NoSuchKey")).toEqual({
      key: "objectsCouldNotRead",
      values: { key: "exports/a.csv", error: "NoSuchKey" },
    });
  });

  test("a store's and a scan's model time tell apart", () => {
    expect(
      readScanWarning(
        "Names and street addresses were looked for in 920 of 23400 free-text values: the scan's 1 minute of model time ran out.",
      ),
    ).toEqual({
      key: "modelScanTimeRanOut",
      values: { read: 920, total: 23400, limit: 60000 },
    });
  });
});

describe("warnings written before this change", () => {
  // Word for word as the scanner wrote them before it wrote them from the templates.
  const BEFORE: Array<[string, ScanWarningKey, ScanWarningValues]> = [
    [
      "Names and street addresses were looked for in 120 of 500 free-text values: this store's 6 seconds of model time ran out.",
      "modelStoreTimeRanOut",
      { read: 120, total: 500, limit: 6000 },
    ],
    [
      "Names and street addresses in free text were not looked for: the model's model_quantized.onnx is not installed on this probe.",
      "modelNotInstalledOnProbe",
      { file: "model_quantized.onnx" },
    ],
    [
      "Names and street addresses in free text were not looked for: the model's vocab.txt is not the pinned file on this server.",
      "modelNotPinnedOnServer",
      { file: "vocab.txt" },
    ],
    [
      "Names and street addresses in free text were not looked for: the model could not start on this server.",
      "modelCouldNotStartOnServer",
      {},
    ],
    [
      "Names and street addresses in free text were not looked for: the model stopped part-way through this scan.",
      "modelStoppedPartWay",
      {},
    ],
    [
      "12 tables were not sampled: the scan reads at most 200 tables.",
      "databaseTablesNotSampled",
      { count: 12, max: 200 },
    ],
    [
      "The scan reached its time limit after 40 of 200 tables.",
      "databaseTimeLimitAfterTables",
      { read: 40, total: 200 },
    ],
    [
      "The scan stopped after 5 tables in a row could not be read.",
      "databaseFailuresInARow",
      { count: 5 },
    ],
    [
      "Could not sample public.users: permission denied for table users",
      "databaseCouldNotSampleTable",
      { table: "public.users", error: "permission denied for table users" },
    ],
    [
      "exports/*/report-*.png: not scanned: PNG image is not supported yet",
      "patternFormatNotSupported",
      { pattern: "exports/*/report-*.png", format: "PNG image" },
    ],
    [
      "logs/*.gz: read in part: it inflates past 4194304 bytes",
      "patternInflatesPast",
      { pattern: "logs/*.gz", bytes: 4194304 },
    ],
    [
      "uploads/*.docx: word/document.xml could not be read: unexpected end of data",
      "patternPartUnreadable",
      {
        pattern: "uploads/*.docx",
        part: "word/document.xml",
        error: "unexpected end of data",
      },
    ],
    [
      "reports/*.xlsx: Only the first 50 of the workbook's 80 sheets were read.",
      "patternFirstSheets",
      { pattern: "reports/*.xlsx", read: 50, total: 80 },
    ],
    [
      "The scan reached its time limit while listing s3://acme-data, after 1000 objects.",
      "objectsTimeLimitWhileListing",
      { store: "s3://acme-data", count: 1000 },
    ],
    [
      "acme-prod.analytics has more tables than one sample reads: the first 200 were read.",
      "bigQueryMoreTables",
      { dataset: "acme-prod.analytics", count: 200 },
    ],
    [
      "Could not read this RUM application's sessions in this scan; the next scan reads them again.",
      "telemetryApplicationSessionsUnread",
      {},
    ],
    [
      "More than 200 different attributes: the ones after them were not read.",
      "telemetryTooManyAttributes",
      { max: 200 },
    ],
    [
      "Could not classify attributes.user.email.",
      "telemetryCouldNotClassify",
      { location: "attributes.user.email" },
    ],
  ];

  test("are read back as they were written, and written the same again", () => {
    for (const [text, key, values] of BEFORE) {
      expect({ text, read: readScanWarning(text) }).toEqual({
        text,
        read: { key, values },
      });
      expect(writeScanWarning(key, values)).toBe(text);
    }
  });

  test("a warning no template matches is not read: it is drawn as written", () => {
    for (const text of [
      "The read reached its limit for this run before every data store was read.",
      "Could not sign in to account 1234 (1234): its role is not there yet.",
      "Names and street addresses were looked for in many free-text values.",
      "exports/*.bin: not scanned: Klingon hologram is not supported yet",
      "",
    ]) {
      expect({ text, read: readScanWarning(text) }).toEqual({
        text,
        read: null,
      });
    }

    expect(readScanWarning(undefined)).toBeNull();
    expect(readScanWarning(42)).toBeNull();
    expect(
      readScanWarning(
        `Could not sample t: ${"x".repeat(MAX_READ_SCAN_WARNING_LENGTH)}`,
      ),
    ).toBeNull();
  });
});

describe("durations", () => {
  test("whole minutes as minutes, anything else as seconds, at least one", () => {
    const cases: Array<[number, string]> = [
      [0, "1 second"],
      [400, "1 second"],
      [1000, "1 second"],
      [6000, "6 seconds"],
      [59_000, "59 seconds"],
      [60_000, "1 minute"],
      [90_000, "90 seconds"],
      [120_000, "2 minutes"],
      [3_600_000, "60 minutes"],
    ];

    for (const [milliseconds, text] of cases) {
      expect(describeScanDuration(milliseconds)).toBe(text);
      expect(readScanDuration(text)).toBe(
        Math.max(1, Math.round(milliseconds / 1000)) * 1000,
      );
    }

    expect(readScanDuration("six seconds")).toBeNull();
    expect(readScanDuration("6 hours")).toBeNull();
  });

  test("in the reader's words, the number held to its unit", () => {
    const cases: Array<[number, string, string]> = [
      [6000, "en", "6 seconds"],
      [120_000, "en", "2 minutes"],
      [6000, "de", "6 Sekunden"],
      [60_000, "de", "1 Minute"],
      [120_000, "fr", "2 minutes"],
    ];

    for (const [milliseconds, language, words] of cases) {
      const written: string = formatScanDuration(milliseconds, language);

      expect(withoutIsolates(written)).toBe(words);
      expect(written).not.toContain(" ");
    }
  });
});

describe("in the reader's language", () => {
  const GERMAN: Record<string, string> = {
    [SCAN_WARNINGS.modelStoreTimeRanOut.english]:
      "Namen und Anschriften wurden in {{read}} von {{total}} Freitextwerten gesucht: Die {{limit}} Modellzeit dieses Speichers sind abgelaufen.",
    [SCAN_WARNINGS.patternFormatNotSupported.english]:
      "{{pattern}}: nicht gescannt: {{format}} wird noch nicht unterstützt",
    [SCAN_WARNINGS.databaseCouldNotSampleTable.english]:
      "{{table}} konnte nicht abgetastet werden: {{error}}",
    "PNG image": "PNG-Bild",
  };

  function german(): Translator {
    return createTranslator((text: string): string | undefined => {
      return GERMAN[text];
    }, "de");
  }

  test("a model warning reads in German, its counts in German digits and its time in German words", () => {
    expect(
      withoutIsolates(
        translateScanWarning(
          "Names and street addresses were looked for in 1234 of 23400 free-text values: this store's 6 seconds of model time ran out.",
          german(),
        ),
      ),
    ).toBe(
      "Namen und Anschriften wurden in 1.234 von 23.400 Freitextwerten gesucht: Die 6 Sekunden Modellzeit dieses Speichers sind abgelaufen.",
    );
  });

  test("a format's name is translated with the sentence, and a pattern drawn as written", () => {
    expect(
      withoutIsolates(
        translateScanWarning(
          "exports/*/report-*.png: not scanned: PNG image is not supported yet",
          german(),
        ),
      ),
    ).toBe(
      "exports/*/report-*.png: nicht gescannt: PNG-Bild wird noch nicht unterstützt",
    );
  });

  test("a format named for its maker keeps its capital, in English and in German", () => {
    for (const format of [
      "Parquet",
      "Java class file",
      "Office 97-2003 document",
      "SQLite database",
    ]) {
      const text: string = writeScanWarning("patternFormatNotSupported", {
        pattern: "data/*.bin",
        format,
      });

      expect(
        withoutIsolates(
          translateScanWarning(text, createTranslator(undefined)),
        ),
      ).toBe(text);
      expect(withoutIsolates(translateScanWarning(text, german()))).toBe(
        `data/*.bin: nicht gescannt: ${format} wird noch nicht unterstützt`,
      );
    }
  });

  test("a database's own words are drawn as it wrote them", () => {
    expect(
      withoutIsolates(
        translateScanWarning(
          "Could not sample public.users: permission denied for table users",
          german(),
        ),
      ),
    ).toBe(
      "public.users konnte nicht abgetastet werden: permission denied for table users",
    );
  });

  test("where the reader's language has no wording yet, the whole sentence is English, its time in English too", () => {
    expect(
      withoutIsolates(
        translateScanWarning(
          "Names and street addresses were looked for in 120 of 500 free-text values: the scan's 1 minute of model time ran out.",
          german(),
        ),
      ),
    ).toBe(
      "Names and street addresses were looked for in 120 of 500 free-text values: the scan's 1 minute of model time ran out.",
    );
  });

  test("in English, a warning reads as it was written, its counts grouped", () => {
    const english: Translator = createTranslator(undefined);

    expect(
      withoutIsolates(
        translateScanWarning(
          "Names and street addresses were looked for in 920 of 23400 free-text values: the scan's 1 minute of model time ran out.",
          english,
        ),
      ),
    ).toBe(
      "Names and street addresses were looked for in 920 of 23,400 free-text values: the scan's 1 minute of model time ran out.",
    );
    expect(
      translateScanWarning(
        "The scan reached its time limit before it could connect.",
        english,
      ),
    ).toBe("The scan reached its time limit before it could connect.");
  });

  test("a warning no template matches is drawn as written, in any language", () => {
    const text: string =
      "The read reached its limit for this run before every data store was read.";

    expect(translateScanWarning(text, german())).toBe(text);
  });

  test("a warning carries counts, durations, names and an error's words: nothing a scan read", () => {
    for (const key of KEYS) {
      for (const kind of Object.values(SCAN_WARNINGS[key].values)) {
        expect([
          ScanWarningValueKind.Count,
          ScanWarningValueKind.Duration,
          ScanWarningValueKind.Name,
          ScanWarningValueKind.Text,
          ScanWarningValueKind.Format,
        ]).toContain(kind);
      }
    }
  });
});
