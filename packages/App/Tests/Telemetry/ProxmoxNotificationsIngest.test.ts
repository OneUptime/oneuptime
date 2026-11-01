/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it — including all full-loop telemetry suites. Nothing in
 * this suite touches password hashing; stub the module before the service
 * import graph drags it into compilation.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import Handlebars from "handlebars";
import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import ProxmoxResourceService, {
  ProxmoxGuestBackupResult,
} from "Common/Server/Services/ProxmoxResourceService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import LogSeverity from "Common/Types/Log/LogSeverity";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import {
  PROXMOX_NOTIFICATION_WEBHOOK_BODY,
  PROXMOX_NOTIFICATION_WEBHOOK_HEADERS,
  ProxmoxNotificationAttribute,
} from "Common/Utils/Proxmox/ProxmoxNotifications";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Proxmox VE's own notifications - a backup job's result, a fencing, root's
 * mail - sent to OneUptime by the webhook target the cluster's setup guide
 * creates (Common/Utils/Proxmox/ProxmoxNotifications).
 *
 * Proxmox VE renders the target's body with Handlebars (proxmox-notify,
 * handlebars-rust 5): no HTML escaping, and three helpers of its own - json
 * writes a value as JSON, escape writes a string JSON-escaped without its
 * quotes, url-encode percent-encodes. This suite renders the shipped
 * template the same way with handlebars.js and those helpers (the builder
 * also rendered it with handlebars-rust 5 and proxmox-notify's helpers,
 * byte for byte the same), then drives the REAL OTLP logs walk
 * (processLogsFromQueue) with what came out, every backend touchpoint
 * mocked, and reads the rows it hands the writer and the inventory writes
 * it makes.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const CLUSTER_NAME: string = "pve-prod";
const INGESTION_KEY: string = "5a000000-0000-4000-8000-000000000001";

// 2026-11-01T01:04:20Z, when the backup job ended.
const JOB_ENDED_AT_SECONDS: number = 1793581460;

interface Notification {
  title: string;
  message: string;
  severity: string;
  timestamp: number;
  fields: Record<string, string>;
}

/*
 * A Handlebars engine set up as proxmox-notify sets up its webhook's:
 * src/endpoints/webhook.rs, setup_handlebars().
 */
function proxmoxHandlebars(): typeof Handlebars {
  const engine: typeof Handlebars = Handlebars.create();
  engine.registerHelper("json", (value: unknown): string => {
    return JSON.stringify(value === undefined ? null : value);
  });
  engine.registerHelper("escape", (value: unknown): string => {
    const json: string = JSON.stringify(String(value));
    return json.substring(1, json.length - 1);
  });
  engine.registerHelper("url-encode", (value: unknown): string => {
    return encodeURIComponent(String(value));
  });
  return engine;
}

function render(template: string, notification: Notification): string {
  return proxmoxHandlebars().compile(template, {
    noEscape: true,
    strict: false,
  })({
    title: notification.title,
    message: notification.message,
    severity: notification.severity,
    timestamp: notification.timestamp,
    fields: notification.fields,
    secrets: { token: INGESTION_KEY, cluster: CLUSTER_NAME },
  });
}

const FAILED_JOB_MESSAGE: string = [
  "job errors",
  "Details",
  "=======",
  "VMID    Name        Status    Time      Size        Filename                                       ",
  "100     web-01      ok        3m 32s    18.4 GiB    vzdump-qemu-100-2026_11_01-01_00_02.vma.zst    ",
  "102     db-01       err       41s       0 B         null                                           ",
  "",
  "Total running time: 4m 13s",
  "Total size: 18.4 GiB",
  "",
  "Logs",
  "====",
  "vzdump 100 102 --mode snapshot --storage pbs-offsite --notes-template '{{guestname}}'",
  "",
  '102: 2026-11-01 01:03:39 ERROR: Backup of VM 102 failed - "got timeout" \\ {{{ }}}',
  "Ünïcödé — 集群 🚀",
].join("\n");

const FAILED_JOB: Notification = {
  title: "vzdump backup status (pve1.example.com): backup failed",
  message: FAILED_JOB_MESSAGE,
  severity: "error",
  timestamp: JOB_ENDED_AT_SECONDS,
  fields: {
    type: "vzdump",
    hostname: "pve1",
    "job-id": "backup-6c6a2f1e-2b4d",
  },
};

const RUN_NOW_SUCCESS: Notification = {
  title: "vzdump backup status (pve2): backup successful",
  message:
    "Details\n=======\nVMID    Name      Status    Time    Size       Filename\n101     web-02    ok        18s     1.2 GiB    vzdump-qemu-101.vma.zst\n\nTotal running time: 18s\nTotal size: 1.2 GiB\n",
  severity: "info",
  timestamp: JOB_ENDED_AT_SECONDS + 600,
  // "Run now": Proxmox VE sends no job-id.
  fields: { type: "vzdump", hostname: "pve2" },
};

const FENCING: Notification = {
  title: "FENCE: Try to fence node 'pve3'",
  message: "The node 'pve3' failed and needs manual intervention.",
  severity: "error",
  timestamp: JOB_ENDED_AT_SECONDS + 1200,
  fields: { type: "fencing", hostname: "pve1" },
};

const ROOT_MAIL: Notification = {
  title: "Mail for root",
  message: "Subject: cron output",
  severity: "unknown",
  timestamp: JOB_ENDED_AT_SECONDS - 60,
  fields: { type: "system-mail" },
};

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverStorageArray",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

interface IngestMocks {
  rows: Array<JSONObject>;
  backupWrites: Array<{
    proxmoxClusterId: string;
    results: Array<ProxmoxGuestBackupResult>;
  }>;
  notificationWrites: Array<{ proxmoxClusterId: string; receivedAt: Date }>;
}

function setupIngestMocks(
  options: { clusterFound?: boolean; backupWriteFails?: boolean } = {},
): IngestMocks {
  const mocks: IngestMocks = {
    rows: [],
    backupWrites: [],
    notificationWrites: [],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelLogsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null as never);
  }
  jest
    .spyOn(service, "autoDiscoverProxmoxCluster")
    .mockResolvedValue(
      (options.clusterFound === false ? null : CLUSTER_ID) as never,
    );

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: `proxmox/${CLUSTER_NAME}`,
    primaryEntityId: CLUSTER_ID,
    primaryEntityType: ServiceType.ProxmoxCluster,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  } as never);

  jest.spyOn(service, "submitLogsBuffer").mockImplementation(((
    ...args: Array<unknown>
  ): Promise<void> => {
    const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
    mocks.rows.push(...rows.splice(0, rows.length));
    return Promise.resolve();
  }) as never);
  jest.spyOn(service, "submitExceptionsBuffer").mockImplementation(((
    ...args: Array<unknown>
  ): Promise<void> => {
    const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
    rows.splice(0, rows.length);
    return Promise.resolve();
  }) as never);

  jest
    .spyOn(LogDropFilterService, "loadDropFilters")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    .mockResolvedValue([] as never);

  jest
    .spyOn(ProxmoxResourceService, "recordBackupResults")
    .mockImplementation((async (data: {
      proxmoxClusterId: ObjectID;
      results: Array<ProxmoxGuestBackupResult>;
    }): Promise<number> => {
      if (options.backupWriteFails) {
        throw new Error("connection terminated");
      }
      mocks.backupWrites.push({
        proxmoxClusterId: data.proxmoxClusterId.toString(),
        results: data.results,
      });
      return data.results.length;
    }) as never);
  jest
    .spyOn(ProxmoxClusterService, "recordNotificationReceived")
    .mockImplementation((async (data: {
      proxmoxClusterId: ObjectID;
      receivedAt: Date;
    }): Promise<void> => {
      mocks.notificationWrites.push({
        proxmoxClusterId: data.proxmoxClusterId.toString(),
        receivedAt: data.receivedAt,
      });
    }) as never);

  return mocks;
}

afterEach(() => {
  jest.restoreAllMocks();
});

function requestOf(bodies: Array<string>): TelemetryRequest {
  /*
   * One notification per request, as Proxmox VE sends them; several are
   * merged into one batch here only to drive one walk.
   */
  const parsed: Array<JSONObject> = bodies.map((body: string) => {
    return JSON.parse(body) as JSONObject;
  });
  return {
    projectId: PROJECT_ID,
    body: {
      resourceLogs: parsed.flatMap((body: JSONObject) => {
        return body["resourceLogs"] as Array<JSONObject>;
      }),
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

function attributesOf(row: JSONObject): JSONObject {
  return row["attributes"] as JSONObject;
}

describe("the webhook body, as Proxmox VE renders it", () => {
  test("is one valid OpenTelemetry logs request, whatever the message holds", () => {
    const body: JSONObject = JSON.parse(
      render(PROXMOX_NOTIFICATION_WEBHOOK_BODY, FAILED_JOB),
    ) as JSONObject;

    const resourceLog: JSONObject = (
      body["resourceLogs"] as Array<JSONObject>
    )[0]!;
    expect(
      (resourceLog["resource"] as JSONObject)[
        "attributes"
      ] as Array<JSONObject>,
    ).toEqual([
      { key: "proxmox.cluster.name", value: { stringValue: CLUSTER_NAME } },
      { key: "proxmox.node.name", value: { stringValue: "pve1" } },
    ]);

    const scopeLog: JSONObject = (
      resourceLog["scopeLogs"] as Array<JSONObject>
    )[0]!;
    expect(scopeLog["scope"]).toEqual({ name: "proxmox-ve-notifications" });
    const record: JSONObject = (
      scopeLog["logRecords"] as Array<JSONObject>
    )[0]!;
    expect(record["timeUnixNano"]).toBe(`${JOB_ENDED_AT_SECONDS}000000000`);
    // Quotes, backslashes, braces, newlines and Unicode arrive as sent.
    expect(record["body"]).toEqual({ stringValue: FAILED_JOB_MESSAGE });
    expect(record["attributes"]).toEqual([
      {
        key: ProxmoxNotificationAttribute.Type,
        value: { stringValue: "vzdump" },
      },
      {
        key: ProxmoxNotificationAttribute.Severity,
        value: { stringValue: "error" },
      },
      {
        key: ProxmoxNotificationAttribute.Title,
        value: { stringValue: FAILED_JOB.title },
      },
      {
        key: ProxmoxNotificationAttribute.JobId,
        value: { stringValue: "backup-6c6a2f1e-2b4d" },
      },
    ]);
  });

  test("a notification without a job id or a node leaves those attributes out, never null", () => {
    const body: string = render(PROXMOX_NOTIFICATION_WEBHOOK_BODY, ROOT_MAIL);
    expect(body).not.toContain("null");
    const parsed: JSONObject = JSON.parse(body) as JSONObject;
    const resourceLog: JSONObject = (
      parsed["resourceLogs"] as Array<JSONObject>
    )[0]!;
    expect(
      (resourceLog["resource"] as JSONObject)[
        "attributes"
      ] as Array<JSONObject>,
    ).toHaveLength(1);
    expect(
      render(PROXMOX_NOTIFICATION_WEBHOOK_BODY, RUN_NOW_SUCCESS),
    ).not.toContain(ProxmoxNotificationAttribute.JobId);
  });

  test("a cluster name with quotes, braces and a backslash stays one JSON string", () => {
    const body: string = proxmoxHandlebars().compile(
      PROXMOX_NOTIFICATION_WEBHOOK_BODY,
      { noEscape: true },
    )({
      ...FAILED_JOB,
      secrets: { token: INGESTION_KEY, cluster: 'pve "prod" \\ {{x}}' },
    });
    const parsed: JSONObject = JSON.parse(body) as JSONObject;
    expect(
      (
        (
          (parsed["resourceLogs"] as Array<JSONObject>)[0]![
            "resource"
          ] as JSONObject
        )["attributes"] as Array<JSONObject>
      )[0],
    ).toEqual({
      key: "proxmox.cluster.name",
      value: { stringValue: 'pve "prod" \\ {{x}}' },
    });
  });

  test("the headers send JSON and the ingestion key from the target's secret", () => {
    expect(
      PROXMOX_NOTIFICATION_WEBHOOK_HEADERS.map(
        (header: { name: string; value: string }): [string, string] => {
          return [header.name, render(header.value, FAILED_JOB)];
        },
      ),
    ).toEqual([
      ["Content-Type", "application/json"],
      ["x-oneuptime-token", INGESTION_KEY],
    ]);
  });
});

describe("Proxmox VE's notifications through the OTLP logs walk", () => {
  test("each is stored with Proxmox's severity, its own time and its message as sent", async () => {
    const mocks: IngestMocks = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      requestOf(
        [FAILED_JOB, RUN_NOW_SUCCESS, FENCING, ROOT_MAIL].map(
          (notification: Notification): string => {
            return render(PROXMOX_NOTIFICATION_WEBHOOK_BODY, notification);
          },
        ),
      ),
    );

    expect(mocks.rows).toHaveLength(4);
    expect(
      mocks.rows.map((row: JSONObject) => {
        return [row["severityNumber"], row["severityText"]];
      }),
    ).toEqual([
      [17, LogSeverity.Error],
      [9, LogSeverity.Information],
      [17, LogSeverity.Error],
      [0, LogSeverity.Unspecified],
    ]);
    expect(mocks.rows[0]!["body"]).toBe(FAILED_JOB_MESSAGE);
    expect(mocks.rows[0]!["timeUnixNano"]).toBe(
      String(OneUptimeDate.toUnixNano(new Date(JOB_ENDED_AT_SECONDS * 1000))),
    );
    expect(attributesOf(mocks.rows[0]!)).toMatchObject({
      "resource.proxmox.cluster.name": CLUSTER_NAME,
      "resource.proxmox.node.name": "pve1",
      [ProxmoxNotificationAttribute.Type]: "vzdump",
      [ProxmoxNotificationAttribute.Severity]: "error",
      [ProxmoxNotificationAttribute.JobId]: "backup-6c6a2f1e-2b4d",
    });
  });

  test("a backup job's guests become their last backup, at the time the job ended", async () => {
    const mocks: IngestMocks = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      requestOf([
        render(PROXMOX_NOTIFICATION_WEBHOOK_BODY, FAILED_JOB),
        render(PROXMOX_NOTIFICATION_WEBHOOK_BODY, RUN_NOW_SUCCESS),
        render(PROXMOX_NOTIFICATION_WEBHOOK_BODY, FENCING),
      ]),
    );

    expect(mocks.backupWrites).toHaveLength(1);
    expect(mocks.backupWrites[0]!.proxmoxClusterId).toBe(CLUSTER_ID.toString());
    expect(mocks.backupWrites[0]!.results).toEqual([
      {
        vmid: 100,
        status: "ok",
        finishedAt: new Date(JOB_ENDED_AT_SECONDS * 1000),
        bytes: Math.round(18.4 * 1024 ** 3),
        durationSeconds: 212,
      },
      {
        vmid: 102,
        status: "failed",
        finishedAt: new Date(JOB_ENDED_AT_SECONDS * 1000),
        bytes: 0,
        durationSeconds: 41,
      },
      {
        vmid: 101,
        status: "ok",
        finishedAt: new Date((JOB_ENDED_AT_SECONDS + 600) * 1000),
        bytes: Math.round(1.2 * 1024 ** 3),
        durationSeconds: 18,
      },
    ]);
    // The newest notification of the batch: the fencing, 20 minutes later.
    expect(mocks.notificationWrites).toEqual([
      {
        proxmoxClusterId: CLUSTER_ID.toString(),
        receivedAt: new Date((JOB_ENDED_AT_SECONDS + 1200) * 1000),
      },
    ]);
  });

  test("a notification of a cluster OneUptime cannot resolve is stored, and writes no inventory", async () => {
    const mocks: IngestMocks = setupIngestMocks({ clusterFound: false });

    await OtelLogsIngestService.processLogsFromQueue(
      requestOf([render(PROXMOX_NOTIFICATION_WEBHOOK_BODY, FAILED_JOB)]),
    );

    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0]!["severityNumber"]).toBe(17);
    expect(mocks.backupWrites).toEqual([]);
    expect(mocks.notificationWrites).toEqual([]);
  });

  test("a failed inventory write never fails the batch: the logs are kept", async () => {
    const mocks: IngestMocks = setupIngestMocks({ backupWriteFails: true });

    await expect(
      OtelLogsIngestService.processLogsFromQueue(
        requestOf([render(PROXMOX_NOTIFICATION_WEBHOOK_BODY, FAILED_JOB)]),
      ),
    ).resolves.not.toThrow();

    expect(mocks.rows).toHaveLength(1);
    // The notification time is still recorded after the backup write failed.
    expect(mocks.notificationWrites).toHaveLength(1);
  });

  test("an ordinary log of the cluster is neither restamped nor read as a backup", async () => {
    const mocks: IngestMocks = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue({
      projectId: PROJECT_ID,
      body: {
        resourceLogs: [
          {
            resource: {
              attributes: [
                {
                  key: "proxmox.cluster.name",
                  value: { stringValue: CLUSTER_NAME },
                },
              ],
            },
            scopeLogs: [
              {
                scope: { name: "journald" },
                logRecords: [
                  {
                    timeUnixNano: `${JOB_ENDED_AT_SECONDS}000000000`,
                    severityNumber: 9,
                    body: { stringValue: FAILED_JOB_MESSAGE },
                    attributes: [],
                  },
                ],
              },
            ],
          },
        ],
      },
      headers: {},
    } as unknown as TelemetryRequest);

    expect(mocks.rows).toHaveLength(1);
    expect(mocks.rows[0]!["severityNumber"]).toBe(9);
    expect(mocks.backupWrites).toEqual([]);
    expect(mocks.notificationWrites).toEqual([]);
  });
});
