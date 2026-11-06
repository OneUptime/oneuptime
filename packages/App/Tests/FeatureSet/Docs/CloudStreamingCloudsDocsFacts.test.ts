import {
  CLOUD_ACCOUNTS,
  CLOUD_STREAMING,
  CLOUD_STREAMING_AZURE,
  CLOUD_STREAMING_GOOGLE_CLOUD,
} from "./CloudDocsPages";
import {
  DocsFence,
  NAV_PAGES,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { boldLabels, detailsBlocks, tables } from "./DocsPageShape";
import {
  AZURE_TYPES_WITHOUT_RESOURCE_LOGS,
  GCP_TYPES_WITHOUT_LOGS,
} from "Common/Types/Cloud/CloudLogGroups";
import {
  CLOUD_STREAM_ACTIVE_WINDOW_MS,
  CLOUD_STREAM_MAX_PREVIOUS_KEYS,
  CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
  CLOUD_STREAM_PUBSUB_ACK_DEADLINE_SECONDS,
  CLOUD_STREAM_PUBSUB_LOGS_PATH,
  CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES,
  CLOUD_STREAM_PUBSUB_MAX_REQUEST_BYTES,
  CLOUD_STREAM_PUBSUB_MAX_RETRY_SECONDS,
  CLOUD_STREAM_PUBSUB_MIN_RETRY_SECONDS,
  CLOUD_STREAM_PUBSUB_REQUESTS_PER_MINUTE,
  CLOUD_STREAM_PUBSUB_RETENTION_SECONDS,
  CLOUD_STREAM_URL_PREFIX,
  getCloudStreamPushServiceAccountId,
} from "Common/Types/CloudConnection/CloudStream";
import {
  AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS,
  AZURE_CLOUD_STREAM_PARTITIONS,
  AZURE_CLOUD_STREAM_SKU,
  AZURE_CLOUD_STREAM_TAG,
  AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE,
  AZURE_EVENT_HUBS_KAFKA_PORT,
  AZURE_EVENT_HUBS_SEND_RULE,
  getAzureCloudStreamCommand,
  getAzureCloudStreamDeleteCommand,
  getAzureCloudStreamNames,
} from "Common/Types/CloudConnection/CloudStreamAzure";
import {
  GCP_CLOUD_STREAM_EVERY_LOG_FILTER,
  GCP_CLOUD_STREAM_MAX_PROJECTS,
  GCP_CLOUD_STREAM_WARNINGS_FILTER,
  GCP_PUSH_TOKEN_ROLE,
  GCP_SINK_WRITER_ROLE,
  getGcpCloudStreamDeleteCommand,
  getGcpCloudStreamNames,
} from "Common/Types/CloudConnection/CloudStreamGcp";
import { LOG_RESOURCE_TYPE_ALIASES } from "../../../FeatureSet/Telemetry/Utils/GcpPubSub/CloudLoggingEntries";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Stream Azure Monitor Metrics and Logs, and Stream Google Cloud Logs, held
 * to the code that streams: the names, the roles and the limits of what
 * each cloud's command makes (CloudStreamAzure, CloudStreamGcp), the
 * command Stop streaming hands over, word for word, the push endpoint and
 * the answers it gives Pub/Sub, which resources have a Logs tab
 * (CloudLogGroups), and the dialogs' and the list's words the pages name.
 * Their translations are held to them by CloudDocsTranslations.
 *
 * App tests read no React module, so the Dashboard's words are read from
 * its sources as text, and so are the server's answers.
 */

const REPO_DIR: string = path.resolve(__dirname, "../../../../..");
const CONNECT: string =
  "packages/App/FeatureSet/Dashboard/src/Components/Cloud/Connect";

const SOURCES: Record<string, string> = {
  azureDialog: `${CONNECT}/CloudStreamAzureDialog.tsx`,
  azureSetup: `${CONNECT}/CloudStreamAzureSetup.ts`,
  gcpDialog: `${CONNECT}/CloudStreamGcpDialog.tsx`,
  gcpSetup: `${CONNECT}/CloudStreamGcpSetup.ts`,
  words: `${CONNECT}/CloudStreamWords.ts`,
  table: `${CONNECT}/CloudConnectionsTable.tsx`,
  awsDialog: `${CONNECT}/CloudStreamDialog.tsx`,
  awsSetup: `${CONNECT}/CloudStreamSetup.ts`,
  folded: "packages/Common/UI/Components/FoldedSection/FoldedSectionTitles.ts",
  ingest:
    "packages/App/FeatureSet/Telemetry/Services/GcpPubSubIngestService.ts",
  authentication:
    "packages/Common/Server/Utils/CloudConnection/CloudStreamAuthentication.ts",
};

// The connection, subscriptions and projects the pages' examples are written for.
const EXAMPLE_CONNECTION_ID: string = "6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f";
const EXAMPLE_SUBSCRIPTIONS: Array<string> = [
  "11111111-aaaa-4aaa-8aaa-111111111111",
  "22222222-bbbb-4bbb-8bbb-222222222222",
];
const EXAMPLE_HOST_PROJECT: string = "acme-prod";
const EXAMPLE_PROJECTS: Array<string> = ["acme-prod", "acme-data"];

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const KIB: number = 1024;
const MIB: number = 1024 * KIB;

function source(name: string): string {
  return fs.readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8");
}

// A page's prose, its fences left out.
function prose(page: string): string {
  return readPage("en", page).replace(/```[\s\S]*?```/g, "");
}

function tableWithHeader(page: string, header: string): Array<Array<string>> {
  const found: Array<Array<string>> | undefined = tables(
    readPage("en", page),
  ).find((table: Array<Array<string>>): boolean => {
    return table[0]?.[0] === header;
  });

  expect(found).toBeDefined();

  return found!;
}

// A table's second cell, by its first.
function valueOf(table: Array<Array<string>>, name: string): string {
  const row: Array<string> | undefined = table.find(
    (cells: Array<string>): boolean => {
      return cells[0] === name;
    },
  );

  expect({ name, found: Boolean(row) }).toEqual({ name, found: true });

  return row![1] as string;
}

function bashFences(page: string): Array<DocsFence> {
  return scanMarkdown(readPage("en", page)).fences.filter(
    (fence: DocsFence): boolean => {
      return fence.lang === "bash";
    },
  );
}

// Each label the page names, drawn by the source it is drawn from.
function expectDrawn(page: string, drawnBy: Record<string, string>): void {
  const labels: Array<string> = boldLabels(readPage("en", page));

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
}

describe("the streaming pages of Azure and Google Cloud", () => {
  it("are in the docs, after AWS's, and linked from the account page and each other", () => {
    expect(NAV_PAGES.indexOf(CLOUD_STREAMING_AZURE)).toBe(
      NAV_PAGES.indexOf(CLOUD_STREAMING) + 1,
    );
    expect(NAV_PAGES.indexOf(CLOUD_STREAMING_GOOGLE_CLOUD)).toBe(
      NAV_PAGES.indexOf(CLOUD_STREAMING) + 2,
    );

    const accounts: string = readPage("en", CLOUD_ACCOUNTS);

    expect(accounts).toContain("](/docs/telemetry/cloud-streaming-azure): ");
    expect(accounts).toContain(
      "](/docs/telemetry/cloud-streaming-google-cloud): ",
    );
    expect(readPage("en", CLOUD_STREAMING_AZURE)).toContain(
      "](/docs/telemetry/cloud-streaming-google-cloud): ",
    );
    expect(readPage("en", CLOUD_STREAMING_GOOGLE_CLOUD)).toContain(
      "](/docs/telemetry/cloud-streaming-azure): ",
    );
  });

  it("are where each dialog's guide link lands", () => {
    expect(source("azureSetup")).toContain(
      '"/docs/telemetry/cloud-streaming-azure"',
    );
    expect(source("azureDialog")).toContain(
      "cloudConnectionDocsUrl(AZURE_STREAM_DOCS_PATH)",
    );
    expect(source("gcpSetup")).toContain(
      '"/docs/telemetry/cloud-streaming-google-cloud"',
    );
    expect(source("gcpDialog")).toContain(
      "cloudConnectionDocsUrl(GCP_STREAM_DOCS_PATH)",
    );
  });
});

describe("Stream Azure Monitor Metrics and Logs", () => {
  const page: string = CLOUD_STREAMING_AZURE;
  const names: ReturnType<typeof getAzureCloudStreamNames> =
    getAzureCloudStreamNames(EXAMPLE_CONNECTION_ID);

  it("names what the command makes as the command names it", () => {
    const text: string = prose(page);
    const command: string = getAzureCloudStreamCommand({
      connectionId: EXAMPLE_CONNECTION_ID,
      appId: "00001111-aaaa-2222-bbbb-3333cccc4444",
      subscriptionIds: EXAMPLE_SUBSCRIPTIONS,
      metrics: true,
      logs: true,
    });

    expect(names).toEqual({
      resourceGroup: "oneuptime-stream-6f1c3a2e",
      namespacePrefix: "oneuptime-6f1c3a2e-",
      eventHub: "oneuptime",
      diagnosticSetting: "OneUptime-6f1c3a2e",
    });
    expect(text).toContain(
      "The resource group is named `oneuptime-stream-` and the first 8 characters of the connection's ID",
    );
    expect(text).toContain("`oneuptime-stream-<suffix>`");
    expect(text).toContain("`oneuptime-<suffix>-<region>`");
    expect(text).toContain(`\`${names.eventHub}\``);
    expect(text).toContain("`OneUptime-<suffix>`");
    expect(text).toContain(`\`${AZURE_CLOUD_STREAM_TAG}\``);
    expect(text).toContain(`\`${AZURE_EVENT_HUBS_SEND_RULE}\``);
    // The tier, the throughput unit and the partitions, as the command asks for them.
    expect(text).toContain(
      `on the ${AZURE_CLOUD_STREAM_SKU} tier with 1 throughput unit`,
    );
    expect(command).toContain(`--sku ${AZURE_CLOUD_STREAM_SKU} --capacity 1`);
    expect(text).toContain(`with ${AZURE_CLOUD_STREAM_PARTITIONS} partitions`);
    expect(text).toContain(
      `\`az eventhubs namespace list --resource-group ${names.resourceGroup}\``,
    );
  });

  it("names the one role the app is given, on the group alone, as the command gives it", () => {
    const labels: Array<string> = boldLabels(readPage("en", page));

    expect(AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE).toBe(
      "Azure Event Hubs Data Receiver",
    );
    expect(labels).toContain(AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE);
    expect(
      getAzureCloudStreamCommand({
        connectionId: EXAMPLE_CONNECTION_ID,
        appId: "00001111-aaaa-2222-bbbb-3333cccc4444",
        subscriptionIds: EXAMPLE_SUBSCRIPTIONS,
        metrics: true,
        logs: false,
      }),
    ).toContain(
      `--role "${AZURE_EVENT_HUBS_DATA_RECEIVER_ROLE}" --scope "/subscriptions/$HOST/resourceGroups/$GROUP"`,
    );
  });

  it("states the limits and times as the code keeps them", () => {
    const text: string = prose(page);

    expect(AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS).toBe(50);
    expect(
      valueOf(tableWithHeader(page, "Field"), "**Subscriptions**"),
    ).toContain(`At most ${AZURE_CLOUD_STREAM_MAX_SUBSCRIPTIONS}`);
    expect(AZURE_EVENT_HUBS_KAFKA_PORT).toBe(9093);
    expect(text).toContain(`on port ${AZURE_EVENT_HUBS_KAFKA_PORT}`);
    expect(CLOUD_STREAM_ACTIVE_WINDOW_MS).toBe(15 * MINUTE_MS);
    expect(text).toContain("after 15 minutes without an event");
  });

  it("shows the command that deletes what the command made word for word, as the list's Stop streaming shows it", () => {
    const bash: Array<DocsFence> = bashFences(page);

    expect(bash).toHaveLength(1);
    expect(bash[0]!.code.trim()).toBe(
      getAzureCloudStreamDeleteCommand({
        connectionId: EXAMPLE_CONNECTION_ID,
        subscriptionIds: EXAMPLE_SUBSCRIPTIONS,
      }),
    );
    expect(source("table")).toContain("getAzureStreamStopCommand({");
    expect(source("azureSetup")).toContain(
      "getAzureCloudStreamDeleteCommand({",
    );
  });

  it("names the kinds of resource with no Logs tab, every kind CloudLogGroups names", () => {
    const paragraph: string = prose(page).toLowerCase();
    // Each type, as the page words it.
    const worded: Record<string, string> = {
      "microsoft.compute/virtualmachines": "virtual machines",
      "microsoft.compute/virtualmachinescalesets": "scale sets",
      "microsoft.compute/disks": "disks",
      "microsoft.network/networkinterfaces": "network interfaces",
      "microsoft.network/virtualnetworks": "virtual networks",
      "microsoft.network/privateendpoints": "private endpoints",
      "microsoft.network/natgateways": "nat gateways",
      "microsoft.network/dnszones": "dns zones",
      "microsoft.web/serverfarms": "app service plans",
      "microsoft.storage/storageaccounts":
        "a storage account's logs are its services'",
      "microsoft.app/containerapps": "a container app's are its environment's",
    };

    expect(Array.from(AZURE_TYPES_WITHOUT_RESOURCE_LOGS).sort()).toEqual(
      Object.keys(worded).sort(),
    );

    for (const [type, words] of Object.entries(worded)) {
      expect({ type, said: paragraph.includes(words) }).toEqual({
        type,
        said: true,
      });
    }
  });

  it("names the dialog's and the list's words as they draw them", () => {
    expectDrawn(page, {
      "Stream metrics and logs": "table",
      "Stop streaming": "table",
      "Turn on reading": "azureDialog",
      "Read them there": "azureDialog",
      "Set it up another way": "azureDialog",
      Subscriptions: "azureDialog",
      Metrics: "azureSetup",
      "Metrics and logs": "azureSetup",
      Logs: "azureSetup",
      Streaming: "words",
      "More fields": "folded",
    });

    // The failing read the troubleshooting names, as the list says it.
    expect(source("words")).toContain('translationKey("Stream failing")');
    expect(
      detailsBlocks(readPage("en", page)).some(
        (block: { summary: string }): boolean => {
          return block.summary === "The connection says Stream failing";
        },
      ),
    ).toBe(true);
  });
});

describe("Stream Google Cloud Logs", () => {
  const page: string = CLOUD_STREAMING_GOOGLE_CLOUD;
  const names: ReturnType<typeof getGcpCloudStreamNames> =
    getGcpCloudStreamNames(EXAMPLE_CONNECTION_ID);

  it("names what the command makes as the command names it", () => {
    const text: string = prose(page);

    expect(names).toEqual({
      topic: "oneuptime-stream-6f1c3a2e",
      subscription: "oneuptime-stream-6f1c3a2e-push",
      sink: "oneuptime-stream-6f1c3a2e",
      pushServiceAccountId: "oneuptime-push-6f1c3a2e",
    });
    expect(getCloudStreamPushServiceAccountId(EXAMPLE_CONNECTION_ID)).toBe(
      names.pushServiceAccountId,
    );
    expect(text).toContain(
      "Its resources are named after the first 8 characters of the connection's ID",
    );
    expect(text).toContain("`oneuptime-push-<suffix>`");
    expect(text).toContain("`oneuptime-stream-<suffix>`");
    expect(text).toContain("`oneuptime-stream-<suffix>-push`");
    expect(text).toContain(
      "`oneuptime-push-<suffix>@<project>.iam.gserviceaccount.com`",
    );
    expect(text).toContain(
      `\`gcloud pubsub subscriptions describe ${names.subscription} --project acme-prod\``,
    );
  });

  it("names the two roles the command grants, each on one thing alone", () => {
    const labels: Array<string> = boldLabels(readPage("en", page));

    expect(GCP_PUSH_TOKEN_ROLE).toBe(
      "roles/iam.serviceAccountOpenIdTokenCreator",
    );
    expect(labels).toContain(
      "Service Account OpenID Connect Identity Token Creator",
    );
    expect(GCP_SINK_WRITER_ROLE).toBe("roles/pubsub.publisher");
    expect(labels).toContain("Pub/Sub Publisher");
  });

  it("gives the push endpoint as the endpoint serves it, and the subscription's settings as the command sets them", () => {
    const settings: Array<Array<string>> = tableWithHeader(page, "Setting");

    expect(valueOf(settings, "Push endpoint")).toBe(
      `\`https://oneuptime.com${CLOUD_STREAM_URL_PREFIX}${CLOUD_STREAM_PUBSUB_LOGS_PATH}\``,
    );
    expect(CLOUD_STREAM_PUBSUB_ACK_DEADLINE_SECONDS).toBe(60);
    expect(valueOf(settings, "Acknowledgement deadline")).toBe("60 seconds");
    expect(CLOUD_STREAM_PUBSUB_RETENTION_SECONDS).toBe(24 * 60 * 60);
    expect(valueOf(settings, "Message retention")).toBe("1 day");
    expect(prose(page)).toContain("with a 60 second acknowledgement deadline");
  });

  it("states the limits and times as the code keeps them", () => {
    const text: string = prose(page);

    expect(CLOUD_STREAM_PUBSUB_MIN_RETRY_SECONDS).toBe(10);
    expect(CLOUD_STREAM_PUBSUB_MAX_RETRY_SECONDS).toBe(10 * 60);
    expect(text).toContain("waiting from 10 seconds up to 10 minutes");
    expect(GCP_CLOUD_STREAM_MAX_PROJECTS).toBe(100);
    expect(valueOf(tableWithHeader(page, "Field"), "**Projects**")).toContain(
      `At most ${GCP_CLOUD_STREAM_MAX_PROJECTS}`,
    );
    expect(CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS).toBe(24 * HOUR_MS);
    expect(text).toContain("keeps working for 24 hours");
    expect(text).toContain(
      `At most ${CLOUD_STREAM_MAX_PREVIOUS_KEYS} replaced keys work at once`,
    );
  });

  it("says what each choice of logs streams, as its filter does", () => {
    const text: string = prose(page);

    expect(GCP_CLOUD_STREAM_WARNINGS_FILTER).toBe("severity>=WARNING");
    expect(text).toContain("every entry of severity `WARNING` or above");
    expect(GCP_CLOUD_STREAM_EVERY_LOG_FILTER).toContain(
      "cloudaudit.googleapis.com/data_access",
    );
    expect(text).toContain("every entry but the Data Access audit logs");
  });

  it("shows the command that deletes what the command made word for word, as the list's Stop streaming shows it", () => {
    const bash: Array<DocsFence> = bashFences(page);

    expect(bash).toHaveLength(1);
    expect(bash[0]!.code.trim()).toBe(
      getGcpCloudStreamDeleteCommand({
        connectionId: EXAMPLE_CONNECTION_ID,
        hostProjectId: EXAMPLE_HOST_PROJECT,
        projectIds: EXAMPLE_PROJECTS,
      }),
    );
    expect(source("table")).toContain("getGcpStreamStopCommand({");
    expect(source("gcpSetup")).toContain("getGcpCloudStreamDeleteCommand({");
  });

  it("names the answers the endpoint gives Pub/Sub, and only those", () => {
    const answers: Array<string> = tableWithHeader(page, "Answer")
      .slice(1)
      .map((row: Array<string>): string => {
        return (row[0] as string).replace(/^`|`$/g, "");
      });
    const ingest: string = source("ingest");
    const authentication: string = source("authentication");
    const text: string = prose(page);

    expect(answers).toEqual([
      "204",
      "400",
      "401",
      "402",
      "403",
      "413",
      "429",
      "503",
    ]);

    for (const status of ["204", "400", "401", "413", "429", "503"]) {
      expect({ status, answered: ingest.includes(`answer(${status}`) }).toEqual(
        { status, answered: true },
      );
    }

    for (const status of ["401", "402", "403", "503"]) {
      expect({
        status,
        answered: authentication.includes(`status: ${status},`),
      }).toEqual({ status, answered: true });
    }

    expect(CLOUD_STREAM_PUBSUB_MAX_REQUEST_BYTES).toBe(MIB);
    expect(CLOUD_STREAM_PUBSUB_MAX_MESSAGE_BYTES).toBe(512 * KIB);
    expect(text).toContain(
      "larger than 1 MiB, or its entry larger than 512 KiB",
    );
    expect(CLOUD_STREAM_PUBSUB_REQUESTS_PER_MINUTE).toBe(12_000);
    expect(text).toContain("more than 12,000 entries in a minute");
  });

  it("says which logs land on a resource's page, as the ingest files them", () => {
    const text: string = prose(page);

    expect(Array.from(GCP_TYPES_WITHOUT_LOGS)).toEqual(["instance_group"]);
    expect(text).toContain("An instance group's logs are its VMs'");
    expect(LOG_RESOURCE_TYPE_ALIASES).toEqual({
      http_load_balancer: "https_lb_rule",
    });
    expect(text).toContain(
      "written under `http_load_balancer`, are filed under its URL map, the `https_lb_rule`",
    );
  });

  it("names the dialog's and the list's words as they draw them", () => {
    expectDrawn(page, {
      "Stream logs": "table",
      "Stop streaming": "table",
      "Make a stream key": "gcpDialog",
      "Make a new key": "gcpDialog",
      "Set it up another way": "gcpDialog",
      Projects: "gcpDialog",
      Filter: "gcpDialog",
      "Warnings and errors": "gcpSetup",
      "Every log": "gcpSetup",
      "A filter of your own": "gcpSetup",
      Streaming: "words",
      "More fields": "folded",
    });

    expect(source("words")).toContain('translationKey("Stream refused")');
    expect(
      detailsBlocks(readPage("en", page)).some(
        (block: { summary: string }): boolean => {
          return block.summary === "The connection says Stream refused";
        },
      ),
    ).toBe(true);
  });
});
