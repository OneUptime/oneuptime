import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import {
  CLOSE_ALERTS_WHEN_CASE_CLOSES_KEY,
  ConnectorField,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  ELASTIC_DEFAULT_DATA_STREAM,
  MICROSOFT_SENTINEL_DEFAULT_STREAM_NAME,
  SPLUNK_DEFAULT_SOURCE_TYPE,
  SecurityEventDestinationCatalog,
  SecurityEventDestinationDefinition,
} from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import {
  DETECTION_RULE_TYPE_DEFINITIONS,
  DetectionRuleDefinition,
  DetectionRuleType,
  SigmaCorrelationType,
} from "Common/Types/SecurityEvent/SigmaCorrelation";
import { SENTINEL_TABLE_COLUMNS } from "Common/Utils/SecurityEvent/Destinations/SiemEventMappers";
import SigmaRuleSetParser from "Common/Utils/SecurityEvent/Sigma/SigmaRuleSetParser";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The English pages for what this change added, held to the product:
 *
 *   - each SIEM OneUptime sends to has a "Send security events to <SIEM>"
 *     section where its destination form links, naming every field the
 *     catalog asks for, the batch size its sender sends, what it never
 *     sends back, and - for Microsoft Sentinel and Elastic - the table's
 *     columns and the key's privileges as the sender writes them;
 *   - Security Events' correlation rules, as the parser reads them;
 *   - closing a case closes its Google SecOps alerts, as the closer does.
 *
 * The translations are held to these pages line for line by
 * IntegrationsDocsTranslations and AiToolingAndSecurityDocsTranslations.
 */

const LINE_BREAK: RegExp = /\r?\n/;
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../..");

function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

function fence(markdown: string, language: string): string {
  const found: { lang: string; code: string } | undefined = scanMarkdown(
    markdown,
  ).fences.find((entry: { lang: string }): boolean => {
    return entry.lang === language;
  });

  expect({ language, found: found !== undefined }).toEqual({
    language,
    found: true,
  });

  return (found as { code: string }).code;
}

function source(relative: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relative), "utf8");
}

const SEND_HEADINGS: Record<string, string> = {
  "google-secops": "Send security events to Google SecOps",
  splunk: "Send security events to Splunk",
  "microsoft-sentinel": "Send security events to Microsoft Sentinel",
  "elastic-security": "Send security events to Elastic Security",
};

describe("each SIEM OneUptime sends to", () => {
  it.each(
    SecurityEventDestinationCatalog.map(
      (
        definition: SecurityEventDestinationDefinition,
      ): [string, SecurityEventDestinationDefinition] => {
        return [definition.provider, definition];
      },
    ),
  )(
    "%s has the section its destination form links to",
    (_provider: string, definition: SecurityEventDestinationDefinition) => {
      const [pagePath, anchor] = definition.docsPath.split("#") as [
        string,
        string,
      ];
      const page: string = readPage("en", pagePath.replace("/docs/", ""));
      const heading: string = SEND_HEADINGS[definition.provider] as string;

      expect(anchor).toBe(heading.toLowerCase().split(" ").join("-"));

      const text: string = section(page, heading);

      // Every field the form asks for, as the form titles it.
      for (const field of [
        ...definition.configFields,
        ...definition.secretFields,
      ] as Array<ConnectorField>) {
        if (definition.provider === "google-secops" || field.key === "cloud") {
          continue;
        }

        expect({
          field: field.title,
          named: text.includes(`**${field.title}**`),
        }).toEqual({
          field: field.title,
          named: true,
        });
      }

      expect(text).toContain("**Add destination**");
      expect(text).toContain("**Send a test event**");
      expect(text).toContain("**Start sending**");
    },
  );

  it("the three new ones send in batches of the size their senders send", () => {
    for (const definition of SecurityEventDestinationCatalog) {
      if (definition.provider === "google-secops") {
        continue;
      }

      const page: string = readPage(
        "en",
        definition.docsPath.split("#")[0]!.replace("/docs/", ""),
      );

      expect(definition.maxEventsPerRequest).toBe(500);
      expect(section(page, SEND_HEADINGS[definition.provider]!)).toContain(
        "batches of up to 500",
      );
    }
  });

  it("never sends back what OneUptime imported from the same SIEM", () => {
    for (const [page, sentence] of [
      [
        "integrations/splunk",
        "Notable events OneUptime imported from Splunk are never sent back to it.",
      ],
      [
        "integrations/microsoft-sentinel",
        "Incidents OneUptime imported from Microsoft Sentinel are never sent back to it.",
      ],
      [
        "integrations/elastic-security",
        "Alerts OneUptime imported from Elastic Security are never sent back to it.",
      ],
    ] as Array<[string, string]>) {
      expect(readPage("en", page)).toContain(sentence);
    }

    expect(
      SecurityEventDestinationCatalog.map(
        (definition: SecurityEventDestinationDefinition): string => {
          return definition.importedProductNames.join(", ");
        },
      ),
    ).toEqual([
      "Google SecOps",
      "Splunk Enterprise Security",
      "Microsoft Sentinel",
      "Elastic Security",
    ]);
  });

  it("Splunk: the default sourcetype the sender writes", () => {
    const text: string = section(
      readPage("en", "integrations/splunk"),
      SEND_HEADINGS["splunk"]!,
    );

    expect(SPLUNK_DEFAULT_SOURCE_TYPE).toBe("oneuptime:security");
    expect(text).toContain("`oneuptime:security`");
    expect(text).toContain('`sourcetype="oneuptime:security"`');
  });

  it("Microsoft Sentinel: the sample has every column of the table the sender fills, in its order", () => {
    const page: string = readPage("en", "integrations/microsoft-sentinel");
    const rows: Array<Record<string, unknown>> = JSON.parse(
      fence(section(page, SEND_HEADINGS["microsoft-sentinel"]!), "json"),
    ) as Array<Record<string, unknown>>;

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!)).toEqual(
      SENTINEL_TABLE_COLUMNS.map((column: { name: string }): string => {
        return column.name;
      }),
    );
    expect(page).toContain(`\`${MICROSOFT_SENTINEL_DEFAULT_STREAM_NAME}\``);
    expect(MICROSOFT_SENTINEL_DEFAULT_STREAM_NAME).toBe(
      "Custom-OneUptimeSecurityEvents_CL",
    );
  });

  it("Elastic: the key's privileges cover the default data stream, as the sender creates documents", () => {
    const page: string = readPage("en", "integrations/elastic-security");
    const role: Record<
      string,
      { indices: Array<{ names: Array<string>; privileges: Array<string> }> }
    > = JSON.parse(
      fence(section(page, SEND_HEADINGS["elastic-security"]!), "json"),
    );
    const indices: { names: Array<string>; privileges: Array<string> } =
      role["oneuptime-writer"]!.indices[0]!;

    expect(
      ELASTIC_DEFAULT_DATA_STREAM.startsWith("logs-oneuptime.security-"),
    ).toBe(true);
    expect(indices.names).toEqual(["logs-oneuptime.security-*"]);
    expect(indices.privileges).toContain("create_doc");
    expect(
      source(
        "packages/Common/Server/Utils/SecurityEvent/Destinations/ElasticSecurity/ElasticSecuritySender.ts",
      ),
    ).toContain("create: {");
    expect(page).toContain(`\`${ELASTIC_DEFAULT_DATA_STREAM}\``);
  });
});

describe("Security Events' correlation rules", () => {
  const page: string = readPage("en", "telemetry/security-events");
  const text: string = section(page, "Correlation rules");

  it("lists the correlation types the parser takes, each by the kind the Dashboard shows", () => {
    const rows: Array<Array<string>> = tables(text)[0]!.slice(1);
    const titles: Record<string, string> = {};

    for (const definition of DETECTION_RULE_TYPE_DEFINITIONS) {
      titles[definition.type] = definition.title;
    }

    expect(
      rows.map((row: Array<string>): Array<string> => {
        return [row[0] as string, row[2] as string];
      }),
    ).toEqual([
      [
        `\`${SigmaCorrelationType.EventCount}\``,
        titles[DetectionRuleType.EventCount],
      ],
      [
        `\`${SigmaCorrelationType.ValueCount}\``,
        titles[DetectionRuleType.ValueCount],
      ],
      [
        `\`${SigmaCorrelationType.Temporal}\``,
        titles[DetectionRuleType.Temporal],
      ],
      [
        `\`${SigmaCorrelationType.TemporalOrdered}\``,
        titles[DetectionRuleType.TemporalOrdered],
      ],
      [
        `\`${SigmaCorrelationType.NewValue}\``,
        titles[DetectionRuleType.NewValue],
      ],
    ]);
  });

  it("its example is a correlation the parser reads, with the rules it reads", () => {
    const definition: DetectionRuleDefinition = SigmaRuleSetParser.parse(
      fence(text, "yaml"),
      {},
    );

    expect(definition.kind).toBe("correlation");

    if (definition.kind === "correlation") {
      expect(definition.correlation.type).toBe(
        SigmaCorrelationType.TemporalOrdered,
      );
      expect(definition.unresolvedReferences).toEqual([]);
      expect(definition.correlation.timespanInSeconds).toBe(600);
    }
  });

  it("names the types the parser refuses", () => {
    expect(text).toContain(
      "`value_sum`, `value_avg`, `value_percentile` and `value_median` are refused when you save.",
    );
  });
});

describe("closing a case closes its Google SecOps alerts", () => {
  it("is the connection's option, as the catalog names it, on the form's last step", () => {
    const page: string = readPage("en", "integrations/google-secops");
    const text: string = section(page, "Close alerts when their case closes");

    expect(CLOSE_ALERTS_WHEN_CASE_CLOSES_KEY).toBe("closeAlertsWhenCaseCloses");
    expect(text).toContain("`chronicle.legacies.legacyUpdateAlert`");
    expect(
      source(
        "packages/Common/Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient.ts",
      ),
    ).toContain("/legacy:legacyUpdateAlert");
    expect(readPage("en", "telemetry/security-cases")).toContain(
      "(/docs/integrations/google-secops#close-alerts-when-their-case-closes)",
    );
  });
});
