import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { AUDIT_LOG_EXPORT } from "./AdministrationDocsPages";
import { drawnAdminPath } from "./DocsAdminDashboard";
import {
  DocsFence,
  DocsHeading,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import {
  PACKAGES_DIR,
  readCommonSource,
  stringConstant,
} from "./DocsDashboardMenus";
import { PATH_SEPARATOR, boldPaths, tables } from "./DocsPageShape";
import { escapeRegExp } from "./DocsTranslationChecks";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { AUDIT_LOG_REDACTED_VALUE } from "Common/Types/AuditLog/AuditLogRedaction";
import {
  AUDIT_LOG_EXPORT_DEFAULT_FOLDER,
  AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_PORT,
  AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_UDP_MESSAGE_SIZE,
  AUDIT_LOG_EXPORT_DEFAULT_WEBHOOK_HEADER,
  AUDIT_LOG_EXPORT_DOCS_PATH,
  AUDIT_LOG_EXPORT_MAX_SYSLOG_UDP_MESSAGE_SIZE,
  AUDIT_LOG_EXPORT_MIN_SYSLOG_UDP_MESSAGE_SIZE,
  AUDIT_LOG_EXPORT_SYSLOG_UDP_PORT,
  AuditLogExportDestinationCatalog,
  AuditLogExportDestinationDefinition,
  AuditLogExportDestinationField,
  AuditLogExportDestinationKind,
  AuditLogExportSyslogFraming,
  AuditLogExportSyslogProtocol,
  AuditLogExportWebhookBodyFormat,
  getAuditLogExportFieldDefault,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AUDIT_LOG_EXPORT_FIRST_SCHEMA_VERSION,
  AUDIT_LOG_EXPORT_RECORD_KEYS,
  AUDIT_LOG_EXPORT_SCHEMA_VERSION,
  AUDIT_LOG_EXPORT_SCHEMA_VERSIONS,
  AUDIT_LOG_EXPORT_SUMMARY_SCHEMA_VERSION,
  AUDIT_LOG_EXPORT_TEST_ACTION,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import Permission from "Common/Types/Permission";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/FoldedSection/FoldedSectionTitles";
import { readAuditLogValue } from "Common/Utils/AuditLog/AuditLogTypedValues";
import {
  describeLargeJson,
  limitText,
} from "Common/Utils/AuditLog/AuditLogValues";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE AUDIT LOG EXPORT PAGE SAYS WHAT THE EXPORTER DOES.
 *
 * docs/configuration/audit-log-export tells a project's owners and admins,
 * and master admins, how to send the audit log to their own storage or
 * SIEM: the destinations and what each one asks for, what one entry holds,
 * how often entries leave and what happens when a destination fails.
 * Markdown is not compiled, so these hold the English page to the product,
 * and AdministrationDocsTranslations holds every language to the English
 * page, line by line:
 *
 *   - the destinations: the catalog's titles and order, every field, the
 *     folded ones, the defaults and the batch limits (Common/Types/AuditLog/
 *     Export), and the anchor each destination's Setup guide link opens;
 *   - an entry: its keys in the order the record writes them, the schema
 *     version, the actions, the test entry's action and the redaction mark;
 *   - who may set one up: the model's permissions, and the service's rule
 *     that only a master admin exports the whole instance;
 *   - the instance's page, in every language, by the Admin Dashboard's own
 *     words (drawnAdminPath);
 *   - and the Enterprise half: the screens' buttons and states, the
 *     exporter's timings and retries, who a failing export emails and when,
 *     the webhook's headers, the syslog line and the files' names.
 *
 * The exporter, its destinations and its screens are the Enterprise
 * Edition's (ee/), read as text as the other docs facts read ee/. That half
 * runs where ee/ is checked out, which is the Enterprise Edition Test
 * workflow (.github/workflows/test.ee.yaml): the App Test job deletes ee/.
 */

const REPO_DIR: string = path.resolve(PACKAGES_DIR, "..");
const EE_DIR: string = path.join(REPO_DIR, "ee");

const describeWhenEnterprisePresent: typeof describe.skip = fs.existsSync(
  EE_DIR,
)
  ? describe
  : describe.skip;

const DESTINATIONS_HEADING: string = "## Destinations";
const WHAT_IS_SENT_HEADING: string = "## What is sent";
const WHEN_SENT_HEADING: string = "## When entries are sent";
const WHEN_FAILS_HEADING: string = "## When a destination fails";

const CODE_SPAN: RegExp = /`([^`\n]+)`/g;
const LINKED_TITLE: RegExp = /^\[([^\]]+)\]\(#([^)]+)\)$/;
const SENTENCE_BREAK: string = ". ";
const SYSLOG_SAMPLE: RegExp =
  /^<(\d+)>1 \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z \S+ (\S+) - (\S+) - (\{.*\})$/;

// The instance's page in the Admin Dashboard: Settings, then the page's title.
const INSTANCE_PAGE_KEYS: ReadonlyArray<string> = [
  "breadcrumbs.settings",
  "Audit Log Export",
];

// What arrives at each destination, as the Destinations table says.
const WHAT_ARRIVES: Record<AuditLogExportDestinationType, string> = {
  [AuditLogExportDestinationType.AmazonS3]: "Compressed NDJSON files",
  [AuditLogExportDestinationType.S3Compatible]: "Compressed NDJSON files",
  [AuditLogExportDestinationType.GoogleCloudStorage]: "Compressed NDJSON files",
  [AuditLogExportDestinationType.AzureBlobStorage]: "Compressed NDJSON files",
  [AuditLogExportDestinationType.Webhook]: "HTTPS requests",
  [AuditLogExportDestinationType.Syslog]: "RFC 5424 messages",
};

function english(): string {
  return readPage("en", AUDIT_LOG_EXPORT);
}

function readEe(relative: string): string {
  return fs.readFileSync(path.join(EE_DIR, relative), "utf8");
}

/*
 * A section of the page: from its heading's line to the next heading of the
 * same level or higher.
 */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);
  const level: number = heading.indexOf(" ");

  if (start < 0) {
    throw new Error(`No section ${heading}`);
  }

  const end: number = lines.findIndex(
    (line: string, index: number): boolean => {
      const lineLevel: number = line.startsWith("#") ? line.indexOf(" ") : -1;

      return index > start && lineLevel > 0 && lineLevel <= level;
    },
  );

  return lines.slice(start, end < 0 ? lines.length : end).join("\n");
}

function catalogEntry(
  type: AuditLogExportDestinationType,
): AuditLogExportDestinationDefinition {
  return AuditLogExportDestinationCatalog.find(
    (definition: AuditLogExportDestinationDefinition): boolean => {
      return definition.type === type;
    },
  ) as AuditLogExportDestinationDefinition;
}

// A destination's own section, under its title in Destinations.
function destinationSection(type: AuditLogExportDestinationType): string {
  return section(english(), `### ${catalogEntry(type).title}`);
}

/*
 * Where the page names a destination's fields: its section, and for
 * S3-compatible storage the Amazon S3 section too ("The same fields as
 * Amazon S3, after an Endpoint").
 */
function fieldsText(definition: AuditLogExportDestinationDefinition): string {
  const own: string = destinationSection(definition.type);

  return definition.type === AuditLogExportDestinationType.S3Compatible
    ? `${own}\n${destinationSection(AuditLogExportDestinationType.AmazonS3)}`
    : own;
}

function allFields(
  definition: AuditLogExportDestinationDefinition,
): Array<AuditLogExportDestinationField> {
  return [...definition.configFields, ...definition.secretFields];
}

function fieldDefault(
  type: AuditLogExportDestinationType,
  key: string,
): unknown {
  return catalogEntry(type).configFields.find(
    (field: AuditLogExportDestinationField): boolean => {
      return field.key === key;
    },
  )?.defaultValue;
}

// A table's body rows: the rows under its header.
function bodyRows(markdown: string): Array<Array<string>> {
  return (tables(markdown)[0] || []).slice(1);
}

function codeSpans(text: string): Array<string> {
  return Array.from(text.matchAll(CODE_SPAN)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// "5,000": how the English page writes a count.
function englishCount(value: number): string {
  return value.toLocaleString("en-US");
}

// A `NAME: number = 5 * 60;` constant of a source, multiplied out.
function numberConstant(source: string, name: string): number {
  const match: RegExpExecArray | null = new RegExp(
    `${escapeRegExp(name)}:\\s*number\\s*=\\s*([\\d\\s*]+);`,
  ).exec(source);

  if (!match) {
    throw new Error(`No number constant ${name}`);
  }

  return (match[1] as string)
    .split("*")
    .reduce((product: number, factor: string): number => {
      return product * Number(factor.trim());
    }, 1);
}

describe("the Audit Log Export page's destinations", () => {
  it("gives every destination a section, in the catalog's order, under the anchor its Setup guide link opens", () => {
    const headings: Array<DocsHeading> = scanMarkdown(english()).headings;
    const destinations: Array<string> = section(english(), DESTINATIONS_HEADING)
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("### ");
      })
      .map((line: string): string => {
        return line.slice("### ".length);
      });

    expect(destinations).toEqual(
      AuditLogExportDestinationCatalog.map(
        (definition: AuditLogExportDestinationDefinition): string => {
          return definition.title;
        },
      ),
    );

    for (const definition of AuditLogExportDestinationCatalog) {
      const heading: DocsHeading | undefined = headings.find(
        (candidate: DocsHeading): boolean => {
          return candidate.level === 3 && candidate.text === definition.title;
        },
      );

      expect(definition.docsPath).toBe(
        `${AUDIT_LOG_EXPORT_DOCS_PATH}#${heading?.slug}`,
      );
    }
  });

  it("lists the destinations in the catalog's order, each linked to its section, with what arrives", () => {
    const table: Array<Array<string>> = tables(
      section(english(), DESTINATIONS_HEADING),
    )[0] as Array<Array<string>>;
    const rows: Array<Array<string>> = table.slice(1);

    expect(table[0]).toEqual(["Destination", "What arrives", "Signs in with"]);
    expect(rows).toHaveLength(AuditLogExportDestinationCatalog.length);

    AuditLogExportDestinationCatalog.forEach(
      (definition: AuditLogExportDestinationDefinition, index: number) => {
        const row: Array<string> = rows[index] as Array<string>;
        const link: RegExpExecArray | null = LINKED_TITLE.exec(
          row[0] as string,
        );

        expect(link?.[1]).toBe(definition.title);
        expect(`${AUDIT_LOG_EXPORT_DOCS_PATH}#${link?.[2]}`).toBe(
          definition.docsPath,
        );
        expect(row[1]).toBe(WHAT_ARRIVES[definition.type]);
        expect(definition.kind === AuditLogExportDestinationKind.Files).toBe(
          row[1] === "Compressed NDJSON files",
        );
      },
    );
  });

  it("names every field of each destination in bold where the destination is described", () => {
    for (const definition of AuditLogExportDestinationCatalog) {
      const text: string = fieldsText(definition);
      const missing: Array<string> = allFields(definition)
        .map((field: AuditLogExportDestinationField): string => {
          return field.title;
        })
        .filter((title: string): boolean => {
          return !text.includes(`**${title}**`);
        });

      expect({ destination: definition.title, missing }).toEqual({
        destination: definition.title,
        missing: [],
      });
    }
  });

  it("says each folded field waits under More fields, and no other field does", () => {
    const moreFields: string = `**${MORE_FIELDS_SECTION_TITLE}**`;

    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");

    for (const definition of AuditLogExportDestinationCatalog) {
      const paragraphs: Array<string> = fieldsText(definition).split("\n");
      const sentences: Array<string> = paragraphs.flatMap(
        (paragraph: string): Array<string> => {
          return paragraph.split(SENTENCE_BREAK);
        },
      );

      for (const field of allFields(definition)) {
        const bold: string = `**${field.title}**`;
        const withMoreFields: (text: string) => boolean = (
          text: string,
        ): boolean => {
          return text.includes(bold) && text.includes(moreFields);
        };

        expect({
          destination: definition.title,
          field: field.title,
          folded: field.isAdvanced
            ? paragraphs.some(withMoreFields)
            : sentences.some(withMoreFields),
        }).toEqual({
          destination: definition.title,
          field: field.title,
          folded: Boolean(field.isAdvanced),
        });
      }
    }
  });

  it("lists Amazon S3's fields in its table, with the defaults the catalog sets", () => {
    const amazon: AuditLogExportDestinationDefinition = catalogEntry(
      AuditLogExportDestinationType.AmazonS3,
    );
    const rows: Array<Array<string>> = bodyRows(
      destinationSection(AuditLogExportDestinationType.AmazonS3),
    );
    const row: (title: string) => string = (title: string): string => {
      return (
        rows.find((candidate: Array<string>): boolean => {
          return candidate[0] === `**${title}**`;
        }) || []
      ).join(" | ");
    };

    expect(
      rows
        .map((candidate: Array<string>): string => {
          return candidate[0] as string;
        })
        .sort(),
    ).toEqual(
      allFields(amazon)
        .map((field: AuditLogExportDestinationField): string => {
          return `**${field.title}**`;
        })
        .sort(),
    );
    expect(row("Region")).toContain(
      `It starts on \`${fieldDefault(AuditLogExportDestinationType.AmazonS3, "region")}\`.`,
    );
    expect(row("Folder")).toContain(
      `Left empty, the files go to \`${AUDIT_LOG_EXPORT_DEFAULT_FOLDER}\`.`,
    );
  });

  it("states the webhook's and syslog's defaults as the catalog sets them", () => {
    const webhook: string = destinationSection(
      AuditLogExportDestinationType.Webhook,
    );
    const syslog: string = destinationSection(
      AuditLogExportDestinationType.Syslog,
    );

    expect(
      fieldDefault(AuditLogExportDestinationType.Webhook, "bodyFormat"),
    ).toBe(AuditLogExportWebhookBodyFormat.JsonArray);
    expect(webhook).toContain(
      "as a JSON array (`application/json`) or one entry per line (`application/x-ndjson`), as **Body format** says",
    );
    expect(webhook).toContain(
      `\`${AUDIT_LOG_EXPORT_DEFAULT_WEBHOOK_HEADER}\` unless you change it.`,
    );

    expect(fieldDefault(AuditLogExportDestinationType.Syslog, "port")).toBe(
      AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_PORT,
    );
    expect(fieldDefault(AuditLogExportDestinationType.Syslog, "protocol")).toBe(
      AuditLogExportSyslogProtocol.Tls,
    );
    expect(fieldDefault(AuditLogExportDestinationType.Syslog, "framing")).toBe(
      AuditLogExportSyslogFraming.OctetCounting,
    );
    expect(syslog).toContain(
      `over TLS on port \`${AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_PORT}\` unless **Protocol** says TCP or UDP`,
    );
    expect(syslog).toContain(
      "Over TLS and TCP, messages are framed by octet counting (RFC 5425) unless **Framing** says one message per line.",
    );
  });

  it("says where syslog over UDP starts, what it frames and how long a message may be, as the catalog sets them", () => {
    const syslog: string = destinationSection(
      AuditLogExportDestinationType.Syslog,
    );
    const field: (key: string) => AuditLogExportDestinationField = (
      key: string,
    ): AuditLogExportDestinationField => {
      return catalogEntry(
        AuditLogExportDestinationType.Syslog,
      ).configFields.find((candidate: AuditLogExportDestinationField) => {
        return candidate.key === key;
      }) as AuditLogExportDestinationField;
    };
    const port: (protocol: AuditLogExportSyslogProtocol) => unknown = (
      protocol: AuditLogExportSyslogProtocol,
    ): unknown => {
      return getAuditLogExportFieldDefault({ protocol }, field("port"));
    };

    // The port follows the protocol: UDP's own, and TLS's for TCP, which has none.
    expect(port(AuditLogExportSyslogProtocol.Udp)).toBe(
      AUDIT_LOG_EXPORT_SYSLOG_UDP_PORT,
    );
    expect(port(AuditLogExportSyslogProtocol.Tls)).toBe(
      AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_PORT,
    );
    expect(port(AuditLogExportSyslogProtocol.Tcp)).toBe(
      AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_PORT,
    );
    expect(syslog).toContain(
      `Over UDP, **Port** starts on \`${AUDIT_LOG_EXPORT_SYSLOG_UDP_PORT}\`, and each message is a datagram of its own (RFC 5426), so none is framed.`,
    );

    // Framing is TLS's and TCP's alone, and the size UDP's.
    expect(field("framing").showWhen?.values).toEqual([
      AuditLogExportSyslogProtocol.Tls,
      AuditLogExportSyslogProtocol.Tcp,
    ]);
    expect(field("maxMessageSize").showWhen?.values).toEqual([
      AuditLogExportSyslogProtocol.Udp,
    ]);

    // An export that names no size sends the default; the form takes the range.
    expect(field("maxMessageSize").defaultValue).toBeUndefined();
    expect(field("maxMessageSize").placeholder).toBe(
      String(AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_UDP_MESSAGE_SIZE),
    );
    expect(field("maxMessageSize").minValue).toBe(
      AUDIT_LOG_EXPORT_MIN_SYSLOG_UDP_MESSAGE_SIZE,
    );
    expect(field("maxMessageSize").maxValue).toBe(
      AUDIT_LOG_EXPORT_MAX_SYSLOG_UDP_MESSAGE_SIZE,
    );
    expect(syslog).toContain(
      `Each message over UDP is at most **Maximum message size** bytes: \`${AUDIT_LOG_EXPORT_DEFAULT_SYSLOG_UDP_MESSAGE_SIZE}\` unless you change it under **More fields**, from \`${AUDIT_LOG_EXPORT_MIN_SYSLOG_UDP_MESSAGE_SIZE}\` to \`${AUDIT_LOG_EXPORT_MAX_SYSLOG_UDP_MESSAGE_SIZE}\`.`,
    );
  });

  it("states the batch limits the catalog sets", () => {
    const limit: (
      kind: AuditLogExportDestinationKind,
      read: (definition: AuditLogExportDestinationDefinition) => number,
    ) => number = (
      kind: AuditLogExportDestinationKind,
      read: (definition: AuditLogExportDestinationDefinition) => number,
    ): number => {
      const values: Set<number> = new Set(
        AuditLogExportDestinationCatalog.filter(
          (definition: AuditLogExportDestinationDefinition): boolean => {
            return definition.kind === kind;
          },
        ).map(read),
      );

      // One limit for every destination of the kind: the page states one.
      expect(values.size).toBe(1);

      return Array.from(values)[0] as number;
    };
    const fileEntries: number = limit(
      AuditLogExportDestinationKind.Files,
      (definition: AuditLogExportDestinationDefinition): number => {
        return definition.maxEntriesPerBatch;
      },
    );
    const fileMegabytes: number = limit(
      AuditLogExportDestinationKind.Files,
      (definition: AuditLogExportDestinationDefinition): number => {
        return definition.maxBytesPerBatch / (1024 * 1024);
      },
    );
    const streamEntries: number = limit(
      AuditLogExportDestinationKind.Stream,
      (definition: AuditLogExportDestinationDefinition): number => {
        return definition.maxEntriesPerBatch;
      },
    );

    expect(section(english(), WHEN_SENT_HEADING)).toContain(
      `up to ${englishCount(fileEntries)} entries or ${fileMegabytes} MB per file, and ${englishCount(streamEntries)} entries per webhook request or syslog connection.`,
    );
  });
});

describe("the Audit Log Export page's entries", () => {
  it("lists every key of an entry, in the order an entry writes them", () => {
    const rows: Array<Array<string>> = bodyRows(
      section(english(), WHAT_IS_SENT_HEADING),
    );

    expect(
      rows.flatMap((row: Array<string>): Array<string> => {
        return codeSpans(row[0] as string);
      }),
    ).toEqual([...AUDIT_LOG_EXPORT_RECORD_KEYS]);
    expect(rows[0]?.[1]).toContain(
      `\`${AUDIT_LOG_EXPORT_SCHEMA_VERSION}\` for a new export, \`${AUDIT_LOG_EXPORT_FIRST_SCHEMA_VERSION}\` for one saved before version ${AUDIT_LOG_EXPORT_SUMMARY_SCHEMA_VERSION}.`,
    );
    expect(rows[rows.length - 1]?.[1]).toContain(
      `and in version ${AUDIT_LOG_EXPORT_SUMMARY_SCHEMA_VERSION} \`summary\`.`,
    );
    expect(rows[4]?.[0]).toBe("`action`");
    expect(codeSpans(rows[4]?.[1] as string)).toEqual(
      Object.values(AuditLogAction),
    );
  });

  /*
   * Issue #6247: each export sends a version of the entry. The page lists
   * every version the record has, newest first, says what version 2 adds,
   * and says what the product does: a new export sends the newest (the
   * service's default), one saved before keeps 1 (the migration's
   * default), and the choice is the form's Record version, under More
   * fields - the form is ee/'s, so the Enterprise half below holds it to
   * that.
   */
  it("says which record version each export sends, and what version 2 adds, as the record and the service do", () => {
    const versions: string = section(english(), "## Record versions");
    const rows: Array<Array<string>> = bodyRows(versions);
    const service: string = readCommonSource(
      "Server/Services/AuditLogExportService.ts",
    );
    const migration: string = readCommonSource(
      "Server/Infrastructure/Postgres/SchemaMigrations/1808996130000-AddAuditLogExportSchemaVersion.ts",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return codeSpans(row[0] as string)[0] as string;
      }),
    ).toEqual([...AUDIT_LOG_EXPORT_SCHEMA_VERSIONS].reverse().map(String));
    expect(rows[0]?.[1]).toContain("Each change also carries `summary`");
    expect(rows[0]?.[1]).toContain("never values.");
    expect(rows[1]?.[1]).toContain("without `summary`");

    expect(versions).toContain(
      `A new export sends version ${AUDIT_LOG_EXPORT_SCHEMA_VERSION}.`,
    );
    expect(service).toContain("? AUDIT_LOG_EXPORT_SCHEMA_VERSION");
    expect(versions).toContain(
      `An export saved before version ${AUDIT_LOG_EXPORT_SUMMARY_SCHEMA_VERSION} keeps sending version ${AUDIT_LOG_EXPORT_FIRST_SCHEMA_VERSION}, so whatever reads it needs no change`,
    );
    expect(migration).toContain(
      `ALTER TABLE "AuditLogExport" ADD "schemaVersion" integer NOT NULL DEFAULT '${AUDIT_LOG_EXPORT_FIRST_SCHEMA_VERSION}'`,
    );

    expect(versions).toContain(
      `choose version ${AUDIT_LOG_EXPORT_SCHEMA_VERSION} in **Record version**, under **${MORE_FIELDS_SECTION_TITLE}**.`,
    );
  });

  /*
   * Issue #6325: a phone number, an email address or a URL goes out as its
   * text, a port as its number - as the audit log records them now, and as
   * the export reads an entry recorded before, which held the value as
   * { "_type": "Phone", "value": ... }. No key changed, so no version did.
   */
  it("says a typed value goes out as its text and a port as its number, as the audit log reads them", () => {
    const sent: string = section(english(), WHAT_IS_SENT_HEADING);

    expect(sent).toContain(
      "Each `oldValue` and `newValue` is the field's value: text, a number, `true` or `false`, or JSON for a setting with several parts.",
    );
    expect(sent).toContain(
      "A phone number, an email address or a URL is its text, such as `+14155550100`, and a port is its number.",
    );
    expect(readAuditLogValue({ _type: "Phone", value: "+14155550100" })).toBe(
      "+14155550100",
    );
    expect(readAuditLogValue({ _type: "Email", value: "a@example.com" })).toBe(
      "a@example.com",
    );
    expect(
      readAuditLogValue({ _type: "URL", value: "https://a.example" }),
    ).toBe("https://a.example");
    expect(readAuditLogValue({ _type: "Port", value: 587 })).toBe(587);
    // No version was added for it: a version only ever adds keys.
    expect(AUDIT_LOG_EXPORT_SCHEMA_VERSION).toBe(2);
  });

  it("names the test entry's action and the mark a secret is recorded as", () => {
    expect(english()).toContain(
      `one entry whose action is \`${AUDIT_LOG_EXPORT_TEST_ACTION}\``,
    );
    expect(section(english(), WHAT_IS_SENT_HEADING)).toContain(
      `they are recorded as \`${AUDIT_LOG_REDACTED_VALUE}\``,
    );
  });
});

describe("who may export, and where", () => {
  it("lets a project's owners and admins set up its exports, as the model allows", () => {
    const model: AuditLogExport = new AuditLogExport();

    for (const permissions of [
      model.createRecordPermissions,
      model.readRecordPermissions,
      model.updateRecordPermissions,
      model.deleteRecordPermissions,
    ]) {
      expect(permissions).toEqual([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
      ]);
    }

    expect(english()).toContain(
      "- **A Project Owner or Project Admin** to export a project's audit log, or a master admin to export the instance's.",
    );
  });

  it("leaves the instance's export to master admins, and the destination as first chosen, as the service does", () => {
    const service: string = readCommonSource(
      "Server/Services/AuditLogExportService.ts",
    );

    expect(service).toContain(
      '"Only a master admin can export the audit log of the whole instance.',
    );
    expect(service).toContain("if (!props.isRoot && !props.isMasterAdmin) {");
    expect(english()).toContain(
      "master admins export every project's from the Admin Dashboard",
    );

    expect(service).toContain(
      'if (incoming["destinationType"] !== undefined) {',
    );
    expect(english()).toContain(
      "An export's destination cannot be changed later.",
    );
  });

  it("names the two pages by their menus, the instance's in every language by the Admin Dashboard's own words", () => {
    expect(
      boldPaths(english()).map((segments: Array<string>): string => {
        return segments.join(PATH_SEPARATOR);
      }),
    ).toEqual([
      "Project Settings → Audit Logs → Export",
      "Settings → Audit Log Export",
    ]);
    expect(drawnAdminPath("en", INSTANCE_PAGE_KEYS)).toBe(
      "**Settings → Audit Log Export**",
    );

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({
        language,
        named: readPage(language, AUDIT_LOG_EXPORT).includes(
          drawnAdminPath(language, INSTANCE_PAGE_KEYS),
        ),
      }).toEqual({ language, named: true });
    }
  });
});

describeWhenEnterprisePresent(
  "the Enterprise half, where ee/ is checked out",
  () => {
    it("sends every entry's typed values as the page says, after its secrets are redacted, in every version", () => {
      const exporter: string = readEe(
        "Server/AuditLogExport/AuditLogExporter.ts",
      );
      const toBatch: string = exporter.slice(
        exporter.indexOf("public static toBatch("),
      );

      expect(toBatch).toContain(
        "readAuditLogExportTypedValues(\n        redactAuditLogExportRecord(read),\n      )",
      );
      // Read whatever version the export sends: not inside toAuditLogExportRecord's versions.
      expect(
        toBatch.slice(0, toBatch.indexOf("readAuditLogExportTypedValues")),
      ).toContain(
        "toAuditLogExportRecord(\n        row,\n        data.schemaVersion,\n      )",
      );
    });

    it("names the screens' buttons and states as the export screens draw them", () => {
      const copy: string = readEe(
        "Dashboard/AuditLogExport/AuditLogExportCopy.ts",
      );
      const modal: string = readEe(
        "Dashboard/AuditLogExport/AuditLogExportFormModal.tsx",
      );
      const footer: string = readCommonSource(
        "UI/Components/Forms/Utils/SteppedFormFooter.ts",
      );
      const page: string = english();

      for (const label of [
        "Add export",
        "Write a test file",
        "Send a test entry",
        "Start exporting",
        "Send a test",
        "View Error",
        "Turn off",
        "Turn on",
        "Export from",
        "Exporting",
        "Failing",
        "Paused",
        "Waiting for entries",
        "Starting",
      ]) {
        expect({
          label,
          drawn: copy.includes(`translationKey("${label}")`),
          named: page.includes(`**${label}**`),
        }).toEqual({ label, drawn: true, named: true });
      }

      expect(stringConstant(modal, "AUDIT_LOG_EXPORT_SETUP_GUIDE_TEXT")).toBe(
        "Setup guide",
      );
      expect(page).toContain(
        "**Setup guide** opens the destination's section on this page.",
      );
      expect(stringConstant(footer, "NEXT_BUTTON_TEXT")).toBe("Next");
      expect(page).toContain(
        "Click **Next**, name the export, and click **Start exporting**.",
      );
      /*
       * An export is paused and resumed from its row - Turn off in its
       * menu, Turn on as the button of one that is off - and the edit form
       * has no switch of its own.
       */
      expect(copy).toContain('turnOffAction: translationKey("Turn off"),');
      expect(copy).toContain('turnOnAction: translationKey("Turn on"),');
      expect(modal).not.toContain("FormFieldSchemaType.Toggle");
      expect(page).toContain(
        "To pause an export, choose **Turn off** in its row's menu: it keeps its place, and **Turn on** sends what was recorded meanwhile.",
      );
    });

    it("chooses the record version where the page says: the form's Record version, under More fields", () => {
      const modal: string = readEe(
        "Dashboard/AuditLogExport/AuditLogExportFormModal.tsx",
      );
      const copy: string = readEe(
        "Dashboard/AuditLogExport/AuditLogExportCopy.ts",
      );

      expect(section(english(), "## Record versions")).toContain(
        `choose version ${AUDIT_LOG_EXPORT_SCHEMA_VERSION} in **Record version**, under **${MORE_FIELDS_SECTION_TITLE}**.`,
      );
      expect(copy).toContain(
        'schemaVersionField: translationKey("Record version")',
      );
      expect(modal).toContain("title: AuditLogExportCopy.schemaVersionField");
      expect(
        modal.slice(modal.indexOf("field: { schemaVersion: true }")),
      ).toContain("collapsibleSection: advancedSection");
    });

    it("names the Admin Dashboard's Settings entry for the instance's page", () => {
      expect(
        stringConstant(
          readEe("AdminDashboard/AuditLogExport/AuditLogExportPaths.ts"),
          "AUDIT_LOG_EXPORT_SETTINGS_PAGE_TITLE",
        ),
      ).toBe(INSTANCE_PAGE_KEYS[1]);
    });

    it("says how often entries leave, and how a failing destination is retried, as the exporter runs", () => {
      const exporter: string = readEe(
        "Server/AuditLogExport/AuditLogExporter.ts",
      );
      const job: string = readEe(
        "Server/AuditLogExport/Jobs/ExportAuditLogs.ts",
      );
      const sent: string = section(english(), WHEN_SENT_HEADING);
      const fails: string = section(english(), WHEN_FAILS_HEADING);

      // Every minute, the entries more than a minute old.
      expect(job).toContain("schedule: EVERY_MINUTE,");
      expect(
        numberConstant(exporter, "AUDIT_LOG_EXPORT_SETTLE_IN_SECONDS"),
      ).toBe(60);
      expect(sent).toContain(
        "- **Every minute.** Entries recorded more than a minute ago are read oldest first",
      );

      // A file waits five minutes for its batch to fill.
      expect(
        numberConstant(exporter, "AUDIT_LOG_EXPORT_FILE_WAIT_IN_SECONDS"),
      ).toBe(5 * 60);
      expect(sent).toContain(
        "A file is written when a batch is full or its first entry is five minutes old.",
      );

      // Three tries a few seconds apart, then 1, 2, 4... minutes, up to an hour.
      expect(
        numberConstant(exporter, "AUDIT_LOG_EXPORT_DELIVERY_ATTEMPTS"),
      ).toBe(3);
      expect(exporter).toContain(
        "AUDIT_LOG_EXPORT_RETRY_DELAYS_IN_MS: ReadonlyArray<number> = [\n  1000, 4000,\n];",
      );
      expect(
        numberConstant(exporter, "AUDIT_LOG_EXPORT_MAX_BACKOFF_IN_MINUTES"),
      ).toBe(60);
      expect(exporter).toContain("Math.pow(2, failures - 1),");
      expect(fails).toContain(
        "A batch is tried three times, a few seconds apart, then the export waits before trying again: one minute, then two, four and so on, up to an hour.",
      );
    });

    it("says who is emailed about a failing export, and when, as the notifications send it", () => {
      const notifications: string = readEe(
        "Server/AuditLogExport/AuditLogExportNotifications.ts",
      );
      const exporter: string = readEe(
        "Server/AuditLogExport/AuditLogExporter.ts",
      );
      const recorder: string = readEe("Server/AuditLog/AuditLogRecorder.ts");
      const fails: string = section(english(), WHEN_FAILS_HEADING);

      // A project's owners for a project's export, every master admin for the instance's.
      expect(notifications).toContain(
        "await ProjectService.getOwners(projectId);",
      );
      expect(notifications).toContain(
        "await sendInstanceHealthNotificationToMasterAdmins({",
      );
      expect(fails).toContain(
        "A failing export emails the people who can fix it: the project's owners for a project's export, and every master admin for the instance's.",
      );

      /*
       * After 30 minutes, then a day before the first of the unsent entries
       * is deleted: the soonest retentionDate stamped on them (#6563), read
       * whenever an email can be due, or reckoned only when it cannot be.
       */
      expect(
        numberConstant(
          notifications,
          "AUDIT_LOG_EXPORT_FAILING_NOTICE_AFTER_IN_MINUTES",
        ),
      ).toBe(30);
      expect(
        numberConstant(
          notifications,
          "AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS",
        ),
      ).toBe(24);
      expect(exporter).toContain(
        "await this.recordFailure(item, result.failure, batch.firstCreatedAt);",
      );
      expect(exporter).toContain("? await this.findSoonestRetentionDate(data)");
      expect(exporter).toContain(
        "this.reader.findSoonestRetentionDateForExport(",
      );
      expect(notifications).toContain(
        "return new Date(data.soonestRetentionDate);",
      );
      expect(fails).toContain(
        "The first email goes after 30 minutes of failures, with what the destination answered. A second goes a day before the first of the entries the export has not sent is deleted, with when entries start to be lost.",
      );

      /*
       * #7185: when that moment has already passed, the second email is due
       * with the first (never sooner than 30 minutes) and goes in its place,
       * as the more pressing one, and says entries are being lost now: the
       * email reads the date against the time of the try.
       */
      expect(notifications).toContain(
        "lostAt - AUDIT_LOG_EXPORT_LOSING_NOTICE_LEAD_IN_HOURS * HOUR_IN_MS,",
      );
      expect(notifications).toContain(
        "return AuditLogExportFailureNotice.LosingEntries;\n  }\n\n  const failingAt: number =",
      );
      expect(notifications).toContain(
        "lostAt.getTime() <= new Date(data.now).getTime()",
      );
      expect(notifications).toContain('lost: "is losing entries",');
      expect(exporter).toContain(
        "entriesLostAt,\n        now: data.now,\n        error: data.message,",
      );
      expect(fails).toContain(
        "If that moment has already passed, as when **Export from** reaches back further than the retention, the second email takes the place of the first, 30 minutes in, and says entries are being lost now.",
      );

      // Once each while the failures go on: a delivery that works clears failingSince.
      expect(exporter).toContain(
        "failingSince: null as unknown as Date,\n            consecutiveFailureCount: 0,",
      );
      expect(fails).toContain(
        "Each is sent once while the failures go on, and a delivery that works resets both.",
      );

      /*
       * An entry keeps the retention it was recorded with, so a longer one
       * does not keep the entries already waiting.
       */
      expect(recorder).toContain(
        "auditLog.retentionDate = this.computeRetentionDate(params.retentionInDays);",
      );
      expect(fails).toContain(
        "Each entry is still deleted once it is older than the audit log retention it was recorded with, sent or not, so fix a failing export within that time. A longer retention keeps only the entries recorded after you change it.",
      );
    });

    it("names the webhook's headers and answers as the webhook destination sends them", () => {
      const webhook: string = readEe(
        "Server/AuditLogExport/Destinations/WebhookDestination.ts",
      );
      const rows: Array<Array<string>> = bodyRows(
        destinationSection(AuditLogExportDestinationType.Webhook),
      );
      const headers: Array<string> = rows.map((row: Array<string>): string => {
        return codeSpans(row[0] as string)[0] as string;
      });

      expect(headers).toEqual([
        "X-OneUptime-Event",
        "X-OneUptime-Batch-Id",
        "X-OneUptime-Entry-Count",
        "X-OneUptime-Signature",
      ]);

      for (const header of headers) {
        expect(webhook).toContain(`"${header}"`);
      }

      expect(stringConstant(webhook, "AUDIT_LOG_EXPORT_WEBHOOK_EVENT")).toBe(
        codeSpans(rows[0]?.[1] as string)[0],
      );
      expect(webhook).toContain(
        'return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;',
      );
      expect(rows[3]?.[1]).toContain(
        "`sha256=` and the HMAC-SHA256 of the body",
      );
      expect(webhook).toContain('contentType: "application/x-ndjson",');
      expect(webhook).toContain('contentType: "application/json",');
      expect(webhook).toContain(
        "if (answer.status === 413 && data.records.length > 1) {",
      );
      expect(english()).toContain(
        "Any 2xx answer is a delivery. A `413` splits the batch in two, and any other refusal sends the whole batch again later.",
      );
    });

    it("writes the syslog sample as the syslog destination frames an entry", () => {
      const syslog: string = readEe(
        "Server/AuditLogExport/Destinations/SyslogDestination.ts",
      );
      const sample: string = (
        scanMarkdown(english()).fences.find((fence: DocsFence): boolean => {
          return fence.lang === "text";
        }) as DocsFence
      ).code.trim();
      const parts: RegExpExecArray | null = SYSLOG_SAMPLE.exec(sample);
      const priority: number = numberConstant(
        syslog,
        "AUDIT_LOG_EXPORT_SYSLOG_PRIORITY",
      );

      expect(syslog).toContain(
        "return `<${AUDIT_LOG_EXPORT_SYSLOG_PRIORITY}>1 ${data.record.createdAt} ${data.hostName} ${AUDIT_LOG_EXPORT_SYSLOG_APP_NAME} - ${AUDIT_LOG_EXPORT_SYSLOG_MESSAGE_ID} - ${serializeAuditLogExportRecord(",
      );
      // Facility 13 (log audit) times 8, plus severity 6 (informational).
      expect(priority).toBe(13 * 8 + 6);
      expect(english()).toContain(
        "with facility 13 (log audit) and severity 6 (informational):",
      );
      expect(parts?.[1]).toBe(String(priority));
      expect(parts?.[2]).toBe(
        stringConstant(syslog, "AUDIT_LOG_EXPORT_SYSLOG_APP_NAME"),
      );
      expect(parts?.[3]).toBe(
        stringConstant(syslog, "AUDIT_LOG_EXPORT_SYSLOG_MESSAGE_ID"),
      );
      expect(
        parts?.[4]?.startsWith(
          `{"schemaVersion":${AUDIT_LOG_EXPORT_SCHEMA_VERSION},"id":`,
        ),
      ).toBe(true);
    });

    it("names the marks a shortened UDP message carries, and what a test over UDP tells, as the syslog destination writes them", () => {
      const syslog: string = readEe(
        "Server/AuditLogExport/Destinations/SyslogDestination.ts",
      );
      const api: string = readEe(
        "Server/AuditLogExport/API/AuditLogExportAPI.ts",
      );
      const page: string = destinationSection(
        AuditLogExportDestinationType.Syslog,
      );
      const marks: Array<string> = codeSpans(page).filter(
        (span: string): boolean => {
          return span.startsWith("[");
        },
      );

      expect(marks).toHaveLength(3);

      // A value is cut as the audit log cuts one: text keeps its start, JSON says its size.
      expect(syslog).toContain("return limitText(value, limit);");
      expect(syslog).toContain(
        "return length > limit ? describeLargeJson(length) : value;",
      );
      expect(limitText("a".repeat(1000 + 1234), 1000)).toBe(
        `${"a".repeat(1000)} ${marks[0]}`,
      );
      expect(describeLargeJson(12595)).toBe(marks[1]);

      // The changes left out are counted in one change of their own.
      expect(syslog).toContain(
        'const noun: string = data.count === 1 ? "change" : "changes";',
      );
      expect(syslog).toContain(
        'field: `[… ${formatCount(data.count)} ${data.isAfterKept ? "more " : ""}${noun}]`,',
      );
      expect(marks[2]).toBe("[… 12 more changes]");

      // A closed port fails the batch, which is tried again; a test that passes asks for a look.
      expect(syslog).toContain(
        "its host answered that the port is closed (ECONNREFUSED). Check the host, the port and the protocol. It is retried automatically.`,\n        { retryable: true },",
      );
      expect(page).toContain(
        "when the receiver's host answers that its port is closed, the batch fails and is tried again, but a message lost on the way is not sent again.",
      );
      expect(api).toContain(
        "UDP does not confirm delivery, so check that it arrived.",
      );
      expect(page).toContain(
        "After a test over UDP, check that the test entry arrived.",
      );
    });

    it("names the files as a file destination writes them", () => {
      const files: string = readEe(
        "Server/AuditLogExport/AuditLogExportFiles.ts",
      );
      const extension: string = stringConstant(
        files,
        "AUDIT_LOG_EXPORT_FILE_EXTENSION",
      );

      expect(english()).toContain(
        `Storage gets the file \`${stringConstant(files, "AUDIT_LOG_EXPORT_TEST_FILE_NAME")}\` in its folder`,
      );
      // <folder>YYYY/MM/DD/HH/<first entry's time>_<first entry id>.ndjson.gz
      expect(files).toContain(
        "return `${data.folder}${date.getUTCFullYear()}/${pad(\n    date.getUTCMonth() + 1,\n  )}/${pad(date.getUTCDate())}/${pad(date.getUTCHours())}/${toCompactUtcTimestamp(\n    date,\n  )}_${data.batch.id}${AUDIT_LOG_EXPORT_FILE_EXTENSION}`;",
      );
      expect(section(english(), WHAT_IS_SENT_HEADING)).toContain(
        `filed by the hour of its first entry: \`${AUDIT_LOG_EXPORT_DEFAULT_FOLDER}2026/10/24/09/20261024T091503Z_<first entry id>${extension}\`.`,
      );
    });
  },
);
