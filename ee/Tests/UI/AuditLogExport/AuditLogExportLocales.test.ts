import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  AUDIT_LOG_EXPORT_HEALTH_COPY,
  AUDIT_LOG_EXPORT_SCOPE_COPY,
  AuditLogExportCopy,
  AuditLogExportLicenseCopy,
  AuditLogExportProjectCopy,
} from "../../../Dashboard/AuditLogExport/AuditLogExportCopy";
import { AUDIT_LOG_EXPORT_SETUP_GUIDE_TEXT } from "../../../Dashboard/AuditLogExport/AuditLogExportFormModal";
import { AUDIT_LOG_EXPORT_SETTINGS_PAGE_TITLE } from "../../../AdminDashboard/AuditLogExport/AuditLogExportPaths";
import {
  AuditLogExportDestinationCatalog,
  AuditLogExportDestinationDefinition,
  AuditLogExportDestinationField,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";

/*
 * Every word the audit log export screens show is in both frontends'
 * locale files, in every language: the shared table, form and test render
 * in the Dashboard (a project's exports) and in the Admin Dashboard (the
 * instance's), each through its own locale files. The destinations' own
 * words come from the catalog, so a field added there is held here too.
 *
 * A translation keeps the English placeholders, and differs from the
 * English - except brand names and the few words a language writes the
 * same (Name, Status, Host...), which are listed.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const FRONTENDS: Record<string, string> = {
  Dashboard: path.join(
    REPOSITORY_ROOT,
    "packages",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Locales",
  ),
  AdminDashboard: path.join(
    REPOSITORY_ROOT,
    "packages",
    "App",
    "FeatureSet",
    "AdminDashboard",
    "src",
    "Locales",
  ),
};

const LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// Brands, and words some languages write as English does.
const MAY_READ_AS_ENGLISH: ReadonlySet<string> = new Set<string>([
  "Amazon S3",
  "Google Cloud Storage",
  "Azure Blob Storage",
  "Azure China",
  "Webhook",
  "Syslog",
  "TLS",
  "TCP",
  "URL",
  "Name",
  "Status",
  "Export",
  "Bucket",
  "Region",
  "Container",
  "Cloud",
  "Host",
  "Port",
  "Endpoint",
  "Destination",
  "Protocol",
  "Framing",
  "Connection",
  "Starting",
  "Paused",
  "Failing",
]);

const PLACEHOLDER: RegExp = /\{\{\w+\}\}/g;

const ACRONYM: RegExp = /^[A-Z0-9]+$/;

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

function catalogStrings(): Array<string> {
  const strings: Array<string> = [];

  for (const definition of AuditLogExportDestinationCatalog as Array<AuditLogExportDestinationDefinition>) {
    strings.push(definition.title, definition.description);

    for (const field of [
      ...definition.configFields,
      ...definition.secretFields,
    ] as Array<AuditLogExportDestinationField>) {
      strings.push(field.title, field.description);

      for (const option of field.options || []) {
        strings.push(option.label);
      }
    }
  }

  // A protocol's name (TLS, TCP) reads the same everywhere and needs no key.
  return strings.filter((text: string): boolean => {
    return !ACRONYM.test(text);
  });
}

function sharedStrings(): Array<string> {
  return Array.from(
    new Set<string>([
      ...Object.values(AuditLogExportCopy),
      ...Object.values(AUDIT_LOG_EXPORT_SCOPE_COPY).flatMap(
        (copy: { cardTitle: string; cardDescription: string }) => {
          return [copy.cardTitle, copy.cardDescription];
        },
      ),
      ...Object.values(AUDIT_LOG_EXPORT_HEALTH_COPY).flatMap(
        (copy: { title: string; description: string }) => {
          return [copy.title, copy.description];
        },
      ),
      ...Object.values(AuditLogExportLicenseCopy),
      AUDIT_LOG_EXPORT_SETUP_GUIDE_TEXT,
      ...catalogStrings(),
    ]),
  );
}

// Each frontend's words: the shared ones, and its own page's.
function stringsOf(frontend: string): Array<string> {
  return [
    ...sharedStrings(),
    ...(frontend === "AdminDashboard"
      ? [AUDIT_LOG_EXPORT_SETTINGS_PAGE_TITLE]
      : Object.values(AuditLogExportProjectCopy)),
  ];
}

function readLocale(frontend: string, locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(FRONTENDS[frontend]!, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

describe("the audit log export screens' words", () => {
  test("are read from the copy and the catalog (the scan is not empty)", () => {
    expect(sharedStrings().length).toBeGreaterThan(120);
  });

  test.each(Object.keys(FRONTENDS))(
    "are keys of the %s's English locale",
    (frontend: string) => {
      const english: Record<string, unknown> = readLocale(frontend, "en");

      expect(
        stringsOf(frontend).filter((text: string): boolean => {
          return english[text] !== text;
        }),
      ).toEqual([]);
    },
  );

  const cases: Array<[string, string]> = Object.keys(FRONTENDS).flatMap(
    (frontend: string): Array<[string, string]> => {
      return LOCALES.map((locale: string): [string, string] => {
        return [frontend, locale];
      });
    },
  );

  test.each(cases)(
    "are translated in the %s's %s locale, with the English placeholders",
    (frontend: string, locale: string) => {
      const translations: Record<string, unknown> = readLocale(
        frontend,
        locale,
      );
      const problems: Array<string> = [];

      for (const text of stringsOf(frontend)) {
        const translated: unknown = translations[text];

        if (typeof translated !== "string" || translated.trim() === "") {
          problems.push(`missing: ${text}`);
          continue;
        }

        if (translated === text && !MAY_READ_AS_ENGLISH.has(text)) {
          problems.push(`still English: ${text}`);
        }

        if (
          JSON.stringify(placeholdersOf(translated)) !==
          JSON.stringify(placeholdersOf(text))
        ) {
          problems.push(`placeholders: ${text}`);
        }
      }

      expect(problems).toEqual([]);
    },
  );
});
