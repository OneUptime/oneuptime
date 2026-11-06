import {
  CLOUD_ACCOUNTS,
  CLOUD_RESOURCES,
  CLOUD_STREAMING,
} from "./CloudDocsPages";
import {
  DocsFence,
  NAV_PAGES,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { boldLabels, detailsBlocks, tables } from "./DocsPageShape";
import { AWS_LOG_GROUP_RULES } from "Common/Types/Cloud/CloudLogGroups";
import {
  CLOUD_STREAM_ACTIVE_WINDOW_MS,
  CLOUD_STREAM_BUFFER_INTERVAL_SECONDS,
  CLOUD_STREAM_BUFFER_SIZE_MIB,
  CLOUD_STREAM_FAILED_DELIVERY_DAYS,
  CLOUD_STREAM_LOGS_PATH,
  CLOUD_STREAM_MAX_DECODED_BYTES,
  CLOUD_STREAM_MAX_PREVIOUS_KEYS,
  CLOUD_STREAM_MAX_REQUEST_BYTES,
  CLOUD_STREAM_METRICS_PATH,
  CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
  CLOUD_STREAM_REQUESTS_PER_MINUTE,
  CLOUD_STREAM_RETRY_DURATION_SECONDS,
  CLOUD_STREAM_URL_PREFIX,
  FIREHOSE_ACCESS_KEY_HEADER,
  FIREHOSE_MAX_RECORDS,
} from "Common/Types/CloudConnection/CloudStream";
import {
  CLOUD_STREAM_MAX_LOG_GROUPS,
  CLOUD_STREAM_MAX_LOG_GROUP_REGIONS,
  CLOUD_STREAM_MAX_REGIONS,
  CLOUD_STREAM_TEMPLATE_FILE,
  getAwsCloudStreamDeleteCommand,
  getCloudStreamNames,
} from "Common/Types/CloudConnection/CloudStreamTemplate";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Stream CloudWatch Metrics and Logs, held to the code that streams: the
 * endpoints and the header Firehose sends the key in (CloudStream), the
 * stack, its names, the command that deletes it and the limits of what
 * one command sets up (CloudStreamTemplate), the log groups filed under a
 * resource (CloudLogGroups), the answers the endpoint gives Firehose, and
 * the dialog's and the list's words the page names. Its translations are
 * held to it by CloudDocsTranslations.
 *
 * App tests read no React module, so the Dashboard's words are read from
 * its sources as text, and so are the server's answers.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const SOURCES: Record<string, string> = {
  dialog: `${DASHBOARD}/Components/Cloud/Connect/CloudStreamDialog.tsx`,
  setup: `${DASHBOARD}/Components/Cloud/Connect/CloudStreamSetup.ts`,
  words: `${DASHBOARD}/Components/Cloud/Connect/CloudStreamWords.ts`,
  table: `${DASHBOARD}/Components/Cloud/Connect/CloudConnectionsTable.tsx`,
  resourceMenu: `${DASHBOARD}/Pages/Cloud/View/SideMenu.tsx`,
  ingest:
    "packages/App/FeatureSet/Telemetry/Services/AwsFirehoseIngestService.ts",
  authentication:
    "packages/Common/Server/Utils/CloudConnection/CloudStreamAuthentication.ts",
  folded: "packages/Common/UI/Components/FoldedSection/FoldedSectionTitles.ts",
};

// The connection id the page's examples are written for.
const EXAMPLE_CONNECTION_ID: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const EXAMPLE_REGIONS: Array<string> = ["us-east-1", "eu-west-1"];

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const MIB: number = 1024 * 1024;

function source(name: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8");
}

function page(): string {
  return readPage("en", CLOUD_STREAMING);
}

// The page's prose, its fences left out.
function prose(): string {
  return page().replace(/```[\s\S]*?```/g, "");
}

function tableWithHeader(header: string): Array<Array<string>> {
  const found: Array<Array<string>> | undefined = tables(page()).find(
    (table: Array<Array<string>>): boolean => {
      return table[0]?.[0] === header;
    },
  );

  expect(found).toBeDefined();

  return found!;
}

// A cell's inline code, without its backticks.
function code(cell: string): string {
  return cell.replace(/^`|`$/g, "");
}

describe("Stream CloudWatch Metrics and Logs", () => {
  it("is in the docs, at the end of the Cloud group, linked from the account and resource pages", () => {
    expect(NAV_PAGES).toContain(CLOUD_STREAMING);
    expect(NAV_PAGES.indexOf(CLOUD_STREAMING)).toBe(
      NAV_PAGES.indexOf("telemetry/cloud-costs") + 1,
    );
    expect(readPage("en", CLOUD_ACCOUNTS)).toContain(
      "](/docs/telemetry/cloud-streaming): ",
    );
    expect(readPage("en", CLOUD_RESOURCES)).toContain(
      "](/docs/telemetry/cloud-streaming)",
    );
  });

  it("is where the streaming dialog's guide link lands", () => {
    expect(source("setup")).toContain(
      'CLOUD_STREAM_DOCS_PATH: string = "/docs/telemetry/cloud-streaming"',
    );
    expect(source("dialog")).toContain(
      "cloudConnectionDocsUrl(CLOUD_STREAM_DOCS_PATH)",
    );
  });

  it("gives the endpoints and the header Firehose sends the key in, as the endpoint serves them", () => {
    const settings: Array<Array<string>> = tableWithHeader("Setting");
    const value: (name: string) => string = (name: string): string => {
      const row: Array<string> | undefined = settings.find(
        (cells: Array<string>): boolean => {
          return cells[0] === name;
        },
      );

      expect(row).toBeDefined();

      return row![1] as string;
    };

    expect(value("Metrics endpoint")).toBe(
      `\`https://oneuptime.com${CLOUD_STREAM_URL_PREFIX}${CLOUD_STREAM_METRICS_PATH}\``,
    );
    expect(value("Logs endpoint")).toBe(
      `\`https://oneuptime.com${CLOUD_STREAM_URL_PREFIX}${CLOUD_STREAM_LOGS_PATH}\``,
    );
    expect(value("Access key").toLowerCase()).toContain(
      `\`${FIREHOSE_ACCESS_KEY_HEADER}\``,
    );
    expect(value("Content encoding")).toBe("`GZIP`");
    expect(value("Buffer")).toBe(
      `${CLOUD_STREAM_BUFFER_SIZE_MIB} MiB or ${CLOUD_STREAM_BUFFER_INTERVAL_SECONDS} seconds`,
    );
    expect(value("Retry duration")).toContain(
      `${CLOUD_STREAM_RETRY_DURATION_SECONDS} seconds`,
    );
  });

  it("states the times streaming keeps, as the code keeps them", () => {
    const text: string = prose();

    expect(CLOUD_STREAM_ACTIVE_WINDOW_MS).toBe(15 * MINUTE_MS);
    expect(text).toContain("after 15 minutes without a delivery");
    expect(CLOUD_STREAM_RETRY_DURATION_SECONDS).toBe(3600);
    expect(text).toContain("for up to an hour");
    expect(text).toContain(`for ${CLOUD_STREAM_FAILED_DELIVERY_DAYS} days`);
    expect(CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS).toBe(24 * HOUR_MS);
    expect(text).toContain("keeps working for 24 hours");
    expect(text).toContain(
      `At most ${CLOUD_STREAM_MAX_PREVIOUS_KEYS} replaced keys work at once`,
    );
  });

  it("states what one command sets up at most, as the dialog holds the choices to it", () => {
    const text: string = prose();

    expect(text).toContain(
      `at most ${CLOUD_STREAM_MAX_LOG_GROUPS} log groups by name, in at most ${CLOUD_STREAM_MAX_LOG_GROUP_REGIONS} Regions`,
    );
    expect(text).toContain(`At most ${CLOUD_STREAM_MAX_REGIONS} |`);
  });

  it("names the stack, its streams and its log group as the template names them", () => {
    const names: ReturnType<typeof getCloudStreamNames> = getCloudStreamNames(
      EXAMPLE_CONNECTION_ID,
    );
    const text: string = prose();

    expect(names.stackName).toBe("OneUptimeStream-6f1c3a2e");
    expect(text).toContain(
      "The stack is named `OneUptimeStream-` and the first 8 characters of the connection's ID",
    );
    expect(names.metricsDeliveryStream).toBe("OneUptime-6f1c3a2e-metrics");
    expect(text).toContain("`OneUptime-<suffix>-metrics`");
    expect(names.logsDeliveryStream).toBe("OneUptime-6f1c3a2e-logs");
    expect(text).toContain("`OneUptime-<suffix>-logs`");
    expect(names.deliveryLogGroup).toBe(
      "/aws/kinesisfirehose/OneUptime-6f1c3a2e",
    );
    expect(text).toContain("`/aws/kinesisfirehose/OneUptime-<suffix>`");
    expect(text).toContain(`\`${CLOUD_STREAM_TEMPLATE_FILE}\``);
    expect(text).toContain(
      `\`aws cloudformation describe-stacks --stack-name ${names.stackName}\``,
    );
  });

  it("shows the command that deletes the stacks word for word, as the list's Stop streaming shows it", () => {
    const bash: Array<DocsFence> = scanMarkdown(page()).fences.filter(
      (fence: DocsFence): boolean => {
        return fence.lang === "bash";
      },
    );

    expect(bash).toHaveLength(1);
    expect(bash[0]!.code.trim()).toBe(
      getAwsCloudStreamDeleteCommand({
        connectionId: EXAMPLE_CONNECTION_ID,
        regions: EXAMPLE_REGIONS,
      }),
    );
    expect(source("table")).toContain("getAwsCloudStreamDeleteCommand({");
  });

  it("lists the log groups filed under a resource, rule by rule, in the order they are tried", () => {
    const rows: Array<Array<string>> = tableWithHeader("Log group").slice(1);

    expect(rows).toHaveLength(AWS_LOG_GROUP_RULES.length);

    rows.forEach((row: Array<string>, index: number) => {
      const rule: (typeof AWS_LOG_GROUP_RULES)[number] =
        AWS_LOG_GROUP_RULES[index]!;

      expect({ group: code(row[0]!).startsWith(rule.prefix) }).toEqual({
        group: true,
      });
      expect(code(row[1]!)).toBe(rule.type);
    });
  });

  it("names the answers the endpoint gives Firehose, and only those", () => {
    const answers: Array<string> = tableWithHeader("Answer")
      .slice(1)
      .map((row: Array<string>): string => {
        return code(row[0]!);
      });
    const ingest: string = source("ingest");
    const authentication: string = source("authentication");
    const text: string = prose();

    expect(answers).toEqual(["200", "400", "401", "402", "403", "413", "429"]);

    for (const status of ["400", "413", "429"]) {
      expect({
        status,
        answered: ingest.includes(`answer(${status},`),
      }).toEqual({ status, answered: true });
    }

    for (const status of ["401", "402", "403"]) {
      expect({
        status,
        answered: authentication.includes(`status: ${status},`),
      }).toEqual({ status, answered: true });
    }

    expect(CLOUD_STREAM_MAX_REQUEST_BYTES).toBe(4 * MIB);
    expect(CLOUD_STREAM_MAX_DECODED_BYTES).toBe(32 * MIB);
    expect(text).toContain(
      "larger than 4 MiB, or decompresses to more than 32 MiB",
    );
    expect(FIREHOSE_MAX_RECORDS).toBe(10_000);
    expect(text).toContain("more than 10,000 records");
    expect(text).toContain(
      `more than ${CLOUD_STREAM_REQUESTS_PER_MINUTE} deliveries in a minute`,
    );
  });

  it("names the dialog's and the list's words as they draw them", () => {
    const labels: Array<string> = boldLabels(page());
    const drawnBy: Record<string, string> = {
      "Stream metrics and logs": "table",
      "Stop streaming": "table",
      "Make a stream key": "dialog",
      "Make a new key": "dialog",
      "Download the template": "dialog",
      "Set it up another way": "dialog",
      "Every metric, not only the key ones": "dialog",
      Regions: "dialog",
      "Log groups": "dialog",
      Region: "dialog",
      "Every log group of the account, new ones too": "dialog",
      Metrics: "setup",
      "Metrics and logs": "setup",
      Logs: "setup",
      Streaming: "words",
      "More fields": "folded",
    };

    for (const [label, file] of Object.entries(drawnBy)) {
      expect({ label, onThePage: labels.includes(label) }).toEqual({
        label,
        onThePage: true,
      });
      expect({ label, drawn: source(file).includes(`"${label}"`) }).toEqual({
        label,
        drawn: true,
      });
    }

    // A resource's Logs tab, in its own menu.
    expect(source("resourceMenu")).toContain('title: "Logs"');
    // The refusal the troubleshooting names, as the list says it.
    expect(source("words")).toContain('translationKey("Stream refused")');
    expect(
      detailsBlocks(page()).some((block: { summary: string }): boolean => {
        return block.summary === "The connection says Stream refused";
      }),
    ).toBe(true);
  });
});
