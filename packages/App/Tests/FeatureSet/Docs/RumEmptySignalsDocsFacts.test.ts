import {
  RUM_EMPTY_SIGNALS_DOCS_URL,
  RUM_ERRORS_DOCS_URL,
  RUM_LOGS_DOCS_URL,
  RUM_LOG_PACKAGES,
  getRumErrorTestSnippet,
  getRumLogPipelineSnippet,
  getRumLogRecordSnippet,
} from "../../../FeatureSet/Dashboard/src/Components/Rum/RumSignalSetupGuide";
import {
  RUM_BROWSER_PACKAGES,
  getRumBrowserTelemetryFile,
  getRumErrorHandlersSnippet,
} from "../../../FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide";
import {
  EXCEPTIONS_NOT_SET_UP_TITLE,
  EXCEPTIONS_QUIET_TITLE,
  EXCEPTIONS_REFUSED_TITLE,
  LOGS_NOT_SET_UP_TITLE,
  LOGS_QUIET_TITLE,
  LOGS_REFUSED_TITLE,
  NOTHING_ARRIVED_TITLE,
  SDK_MISSING_TITLE,
  SETUP_CHECK_TITLE,
  SET_UP_EXCEPTIONS,
  SET_UP_LOGS,
} from "../../../FeatureSet/Dashboard/src/Components/Rum/SetupCheck/RumSignalWords";
import {
  INGEST_REFUSAL_FIX_LABELS,
  REFUSALS_TITLE,
} from "../../../FeatureSet/Dashboard/src/Components/Telemetry/IngestRefusalWords";
import {
  DocsAnchorAlias,
  getEnglishAnchorAliases,
} from "../../../FeatureSet/Docs/Utils/AnchorAliases";
import {
  DocsFence,
  DocsHeading,
  DocsPageLink,
  ScannedPage,
  TRANSLATED_LANGUAGES,
  anchorsOf,
  parseDocsLink,
  readPage,
  scanPage,
} from "./DocsContentSupport";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
} from "Common/Types/Telemetry/TelemetryIngestSurface";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * RUM Troubleshooting's "Exceptions or logs are empty" (issue #5770), held
 * to the product it describes. An empty Exceptions or Logs chart links to
 * this section, and the Set up exceptions and Set up logs dialogs link to
 * Browser Setup's error and log sections: each link lands on a heading, in
 * every language. The answers its table lists are the ones the charts give,
 * worded as the charts word them; the test error it has you throw and the
 * log record sample Browser Setup adds are the dialogs' own code; and what
 * it says the SDK sends - page loads and requests, but no exceptions and no
 * logs - is what the setup guide's telemetry file sets up.
 *
 * RumDocsTranslations holds the translations to the English pages line for
 * line, bold labels as each language's Dashboard draws them included.
 */

const TROUBLESHOOTING: string = "rum/troubleshooting";
const BROWSER_SETUP: string = "rum/browser-setup";

const OTEL_INGEST_ROUTES: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Telemetry/API/OTelIngest.ts",
);

const BOLD_SPAN: RegExp = /\*\*([^*]+)\*\*/g;
const TABLE_SEPARATOR: RegExp = /^\|(?:\s*-+\s*\|)+$/;

function headingLink(url: string): { page: string; anchor: string } {
  const link: DocsPageLink | null = parseDocsLink(url);

  if (!link || !link.anchor) {
    throw new Error(`${url} is not a link to a docs heading`);
  }

  return { page: link.page, anchor: link.anchor };
}

/*
 * The heading a page in this language has where the English page has the
 * heading with this anchor: the one that answers the English anchor
 * (AnchorAliases), or null when none does.
 */
function headingFor(
  language: string,
  page: string,
  englishAnchor: string,
): DocsHeading | null {
  const scanned: ScannedPage = scanPage(language, page);

  if (language === "en") {
    return (
      scanned.headings.find((heading: DocsHeading): boolean => {
        return heading.slug === englishAnchor;
      }) || null
    );
  }

  const alias: DocsAnchorAlias | undefined = getEnglishAnchorAliases(
    readPage("en", page),
    readPage(language, page),
  ).find((candidate: DocsAnchorAlias): boolean => {
    return candidate.englishAnchor === englishAnchor;
  });

  if (!alias || !anchorsOf(language, page).has(alias.anchor)) {
    return null;
  }

  return (
    scanned.headings.find((heading: DocsHeading): boolean => {
      return heading.slug === alias.anchor;
    }) || null
  );
}

interface DocsSection {
  heading: DocsHeading;
  // The section's lines, its heading's line first (1-based line numbers).
  lines: Array<string>;
  fences: Array<DocsFence>;
}

// A heading's section: its lines up to the next heading of its level or above.
function sectionOf(
  language: string,
  page: string,
  englishAnchor: string,
): DocsSection {
  const heading: DocsHeading | null = headingFor(language, page, englishAnchor);

  if (!heading) {
    throw new Error(`${language}/${page} has no heading for #${englishAnchor}`);
  }

  const scanned: ScannedPage = scanPage(language, page);
  const next: DocsHeading | undefined = scanned.headings.find(
    (candidate: DocsHeading): boolean => {
      return candidate.line > heading.line && candidate.level <= heading.level;
    },
  );
  const end: number = next ? next.line : scanned.lines.length + 1;

  return {
    heading,
    lines: scanned.lines.slice(heading.line - 1, end - 1),
    fences: scanned.fences.filter((fence: DocsFence): boolean => {
      return fence.line > heading.line && fence.line < end;
    }),
  };
}

function boldSpansOf(text: string): Array<string> {
  return Array.from(text.matchAll(BOLD_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// A section's table body: each row's cells, without the header row.
function tableRows(section: DocsSection): Array<Array<string>> {
  const tableLines: Array<string> = section.lines.filter(
    (line: string): boolean => {
      return line.startsWith("|");
    },
  );

  return tableLines
    .slice(1)
    .filter((line: string): boolean => {
      return !TABLE_SEPARATOR.test(line);
    })
    .map((line: string): Array<string> => {
      return line
        .slice(1, -1)
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        });
    });
}

function fenceCodes(section: DocsSection, lang: string): Array<string> {
  return section.fences
    .filter((fence: DocsFence): boolean => {
      return fence.lang === lang;
    })
    .map((fence: DocsFence): string => {
      return fence.code;
    });
}

const EMPTY_SIGNALS: { page: string; anchor: string } = headingLink(
  RUM_EMPTY_SIGNALS_DOCS_URL,
);
const ERRORS: { page: string; anchor: string } =
  headingLink(RUM_ERRORS_DOCS_URL);
const LOGS: { page: string; anchor: string } = headingLink(RUM_LOGS_DOCS_URL);

describe("RUM docs: why Exceptions or Logs are empty (issue #5770)", () => {
  test("an empty chart's help link opens this section, in every language", () => {
    expect(EMPTY_SIGNALS).toEqual({
      page: TROUBLESHOOTING,
      anchor: "exceptions-or-logs-are-empty",
    });

    const english: DocsSection = sectionOf(
      "en",
      TROUBLESHOOTING,
      EMPTY_SIGNALS.anchor,
    );
    expect({
      level: english.heading.level,
      text: english.heading.text,
    }).toEqual({ level: 2, text: "Exceptions or logs are empty" });

    const unanswered: Array<string> = TRANSLATED_LANGUAGES.filter(
      (language: string): boolean => {
        return !headingFor(language, TROUBLESHOOTING, EMPTY_SIGNALS.anchor);
      },
    );
    expect(unanswered).toEqual([]);
  });

  test("the dialogs' Browser setup links open the errors and logs sections, in every language", () => {
    expect(ERRORS).toEqual({
      page: BROWSER_SETUP,
      anchor: "report-uncaught-errors",
    });
    expect(LOGS).toEqual({
      page: BROWSER_SETUP,
      anchor: "add-logs-and-metrics",
    });

    const unanswered: Array<string> = ["en", ...TRANSLATED_LANGUAGES].flatMap(
      (language: string): Array<string> => {
        return [ERRORS.anchor, LOGS.anchor]
          .filter((anchor: string): boolean => {
            return !headingFor(language, BROWSER_SETUP, anchor);
          })
          .map((anchor: string): string => {
            return `${language}#${anchor}`;
          });
      },
    );
    expect(unanswered).toEqual([]);
  });

  test("its table lists the answers the charts give, as the charts word them", () => {
    const section: DocsSection = sectionOf(
      "en",
      TROUBLESHOOTING,
      EMPTY_SIGNALS.anchor,
    );
    const rows: Array<Array<string>> = tableRows(section);

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return boldSpansOf(row[0]!);
      }),
    ).toEqual([
      [EXCEPTIONS_NOT_SET_UP_TITLE, LOGS_NOT_SET_UP_TITLE],
      [EXCEPTIONS_QUIET_TITLE, LOGS_QUIET_TITLE],
      [NOTHING_ARRIVED_TITLE],
      [SDK_MISSING_TITLE],
      [EXCEPTIONS_REFUSED_TITLE, LOGS_REFUSED_TITLE],
    ]);

    // Not set up: the chart's button opens the code that sends them.
    expect(boldSpansOf(rows[0]![1]!)).toEqual([SET_UP_EXCEPTIONS, SET_UP_LOGS]);

    // Refused (issue #6378): its buttons are the refusal fixes, every one.
    expect(boldSpansOf(rows[4]![1]!)).toEqual(
      Object.values(INGEST_REFUSAL_FIX_LABELS),
    );

    // The setup check is named as its card is titled.
    expect(boldSpansOf(section.lines.join("\n"))).toContain(SETUP_CHECK_TITLE);
  });

  test("the key check names where refusals are counted, as the Dashboard titles them (issue #6378)", () => {
    const spans: Array<string> = boldSpansOf(
      sectionOf("en", TROUBLESHOOTING, "check-the-key").lines.join("\n"),
    );

    // The key's page card, and the setup check that says which kind is refused.
    expect(spans).toEqual(
      expect.arrayContaining([REFUSALS_TITLE, SETUP_CHECK_TITLE]),
    );

    /*
     * The refused row names what a refusal can be: a key off or expired,
     * an origin, a limit or a budget, or billing.
     */
    const refusedRow: string = tableRows(
      sectionOf("en", TROUBLESHOOTING, EMPTY_SIGNALS.anchor),
    )[4]![1]!;

    for (const phrase of [
      "switched off or expired",
      "origin",
      "a limit or a budget",
      "payment method",
    ]) {
      expect({ phrase, listed: refusedRow.includes(phrase) }).toEqual({
        phrase,
        listed: true,
      });
    }
  });

  test("its answers send nothing-arrived to the key check and a missing SDK to Browser Setup", () => {
    const rows: Array<Array<string>> = tableRows(
      sectionOf("en", TROUBLESHOOTING, EMPTY_SIGNALS.anchor),
    );

    expect(rows[2]![1]).toContain("](#check-the-key)");
    expect(headingFor("en", TROUBLESHOOTING, "check-the-key")).not.toBeNull();
    expect(rows[3]![1]).toContain("](/docs/rum/browser-setup)");
  });

  test("the test error it has you throw is the one Set up exceptions shows, in every language", () => {
    const mismatched: Array<string> = ["en", ...TRANSLATED_LANGUAGES].filter(
      (language: string): boolean => {
        const codes: Array<string> = fenceCodes(
          sectionOf(language, TROUBLESHOOTING, EMPTY_SIGNALS.anchor),
          "js",
        );

        return codes.length !== 1 || codes[0] !== getRumErrorTestSnippet();
      },
    );
    expect(mismatched).toEqual([]);
  });

  test("Browser Setup's error handlers are the ones Set up exceptions adds, in every language", () => {
    const mismatched: Array<string> = ["en", ...TRANSLATED_LANGUAGES].filter(
      (language: string): boolean => {
        const codes: Array<string> = fenceCodes(
          sectionOf(language, BROWSER_SETUP, ERRORS.anchor),
          "ts",
        );

        return codes[0] !== getRumErrorHandlersSnippet();
      },
    );
    expect(mismatched).toEqual([]);
  });

  test("Browser Setup writes a log record as Set up logs does, after installing the same packages, in every language", () => {
    const mismatched: Array<string> = ["en", ...TRANSLATED_LANGUAGES].filter(
      (language: string): boolean => {
        const section: DocsSection = sectionOf(
          language,
          BROWSER_SETUP,
          LOGS.anchor,
        );
        const install: string = fenceCodes(section, "bash").join("\n");
        const samples: Array<string> = fenceCodes(section, "ts");

        return (
          !RUM_LOG_PACKAGES.every((name: string): boolean => {
            return install.includes(name);
          }) || samples[samples.length - 1] !== getRumLogRecordSnippet()
        );
      },
    );
    expect(mismatched).toEqual([]);
  });

  test("the log pipeline Set up logs adds is Browser Setup's, with this install's URL and the Browser key", () => {
    const dialog: string = getRumLogPipelineSnippet({
      oneuptimeUrl: "https://oneuptime.example.com",
      apiKey: "browser-key-secret",
    });
    const docs: string = fenceCodes(
      sectionOf("en", BROWSER_SETUP, LOGS.anchor),
      "ts",
    ).find((code: string): boolean => {
      return code.includes("new LoggerProvider(");
    })!;

    for (const shape of [
      "new LoggerProvider({",
      "resource: resource,",
      "new BatchLogRecordProcessor({",
      "exporter: new OTLPLogExporter({",
      "/otlp/v1/logs",
    ]) {
      expect({ shape, docs: docs.includes(shape) }).toEqual({
        shape,
        docs: true,
      });
      expect({ shape, dialog: dialog.includes(shape) }).toEqual({
        shape,
        dialog: true,
      });
    }

    expect(dialog).toContain(
      'url: "https://oneuptime.example.com/otlp/v1/logs"',
    );
    expect(dialog).toContain('"x-oneuptime-token": "browser-key-secret"');
  });

  test("the SDK the setup guide installs sends page loads and requests, but no exceptions and no logs", () => {
    expect(RUM_BROWSER_PACKAGES).toEqual(
      expect.arrayContaining([
        "@opentelemetry/instrumentation-document-load",
        "@opentelemetry/instrumentation-fetch",
      ]),
    );
    expect(
      RUM_LOG_PACKAGES.filter((name: string): boolean => {
        return RUM_BROWSER_PACKAGES.includes(name);
      }),
    ).toEqual([]);

    const telemetryFile: string = getRumBrowserTelemetryFile({
      oneuptimeUrl: "https://oneuptime.example.com",
      apiKey: "browser-key-secret",
      appName: "storefront-web",
    });
    expect(telemetryFile).toContain("new DocumentLoadInstrumentation()");
    expect(telemetryFile).toContain("new FetchInstrumentation(");
    expect(telemetryFile).not.toContain("addEventListener");
    expect(telemetryFile).not.toContain("recordException");
    expect(telemetryFile).not.toContain("LoggerProvider");
  });

  test("the Browser key that lets page loads through lets exceptions and logs through too", () => {
    const routes: string = fs.readFileSync(OTEL_INGEST_ROUTES, "utf8");
    const surfaceOf: (route: string) => string | undefined = (
      route: string,
    ): string | undefined => {
      const start: number = routes.indexOf(`"${route}",`);
      const match: RegExpMatchArray | null = routes
        .slice(start)
        .match(/forSurface\(TelemetryIngestSurface\.(\w+)\)/);

      return start === -1 || !match ? undefined : match[1];
    };

    // Exceptions are span events: they travel with the traces.
    expect(surfaceOf("/otlp/v1/traces")).toBe("OtelTraces");
    expect(surfaceOf("/otlp/v1/logs")).toBe("OtelLogs");
    expect(
      BROWSER_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.OtelTraces),
    ).toBe(true);
    expect(
      BROWSER_ALLOWED_INGEST_SURFACES.has(TelemetryIngestSurface.OtelLogs),
    ).toBe(true);
  });
});
