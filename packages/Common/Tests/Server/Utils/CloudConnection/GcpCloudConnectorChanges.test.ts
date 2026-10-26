import { describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import {
  CloudChange,
  CloudChangesOptions,
  CloudChangesResult,
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import GcpCloudConnector from "../../../../Server/Utils/CloudConnection/Gcp/GcpCloudConnector";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  bodyOf,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * What changed in a Google Cloud project, read from its Admin Activity
 * audit log, and what Service Health says about it - against a fake
 * Google Cloud: a call that changed something is a change and a read is
 * not, a failed call says so, each read starts a little before the last
 * one stopped and writes nothing twice, a project whose Logging API is off
 * says how to turn it on, and Service Health that is not allowed is asked
 * again a day later.
 */

const PROJECT_ID: string = "acme-prod";
const OTHER_PROJECT: string = "acme-staging";
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const KEY: string = JSON.stringify({
  type: "service_account",
  project_id: PROJECT_ID,
  client_email: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

const connector: GcpCloudConnector = new GcpCloudConnector();

function settings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.GCP,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.GcpServiceAccountKey,
      ...config,
    },
    secrets: { serviceAccountJson: KEY },
  };
}

interface FakeGcpActivity extends FakeProviderApi {
  auditCalls: Array<JSONObject>;
  healthCalls: Array<URL>;
}

function createFakeGcpActivity(options: {
  entries?: Record<string, Array<JSONObject>>;
  auditErrors?: Record<string, FakeResponse>;
  healthEvents?: Record<string, Array<JSONObject>>;
  healthError?: FakeResponse;
}): FakeGcpActivity {
  const auditCalls: Array<JSONObject> = [];
  const healthCalls: Array<URL> = [];

  const api: FakeProviderApi = createFakeProviderApi([
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "ya29.token", expires_in: 3599 });
      },
    },
    {
      host: "logging.googleapis.com",
      path: "/v2/entries:list",
      method: "POST",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        const body: JSONObject = bodyOf(request);
        auditCalls.push(body);
        const project: string = String(
          (body["resourceNames"] as Array<string>)[0],
        ).replace("projects/", "");

        if (options.auditErrors?.[project]) {
          return options.auditErrors[project]!;
        }

        return json({ entries: options.entries?.[project] || [] });
      },
    },
    {
      host: "servicehealth.googleapis.com",
      path: /^\/v1\/projects\/[^/]+\/locations\/global\/events$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        healthCalls.push(url);

        if (options.healthError) {
          return options.healthError;
        }

        const project: string = url.pathname.split("/")[3]!;
        return json({ events: options.healthEvents?.[project] || [] });
      },
    },
  ]);

  return { ...api, auditCalls, healthCalls };
}

function changeOptions(
  fake: FakeProviderApi,
  state: CloudConnectionPullState,
  extra: Partial<CloudChangesOptions> = {},
  now: Date = NOW,
): CloudChangesOptions {
  return {
    transport: fake.transport,
    now: () => {
      return now;
    },
    sleep: async () => {},
    state,
    connectionId: "33333333-3333-4333-8333-333333333333",
    budget: new CloudReadBudget({ maxRequests: 300, maxDurationMs: 60000 }),
    ...extra,
  };
}

function auditEntry(data: {
  id: string;
  method: string;
  at: string;
  service?: string;
  resourceName?: string;
  code?: number;
}): JSONObject {
  return {
    insertId: data.id,
    timestamp: data.at,
    resource: {
      type: "gce_instance",
      labels: { project_id: PROJECT_ID, zone: "europe-west1-b" },
    },
    protoPayload: {
      "@type": "type.googleapis.com/google.cloud.audit.AuditLog",
      methodName: data.method,
      serviceName: data.service ?? "compute.googleapis.com",
      resourceName:
        data.resourceName ??
        `projects/${PROJECT_ID}/zones/europe-west1-b/instances/web-1`,
      authenticationInfo: { principalEmail: "deployer@acme.com" },
      request: { metadata: { items: [{ key: "secret", value: "hunter2" }] } },
      ...(data.code !== undefined ? { status: { code: data.code } } : {}),
    },
  };
}

describe("what changed in a Google Cloud project", () => {
  test("a call that changed something is a change; a read and an operation poll are not", async () => {
    const fake: FakeGcpActivity = createFakeGcpActivity({
      entries: {
        [PROJECT_ID]: [
          auditEntry({
            id: "log-insert",
            method: "v1.compute.instances.insert",
            at: "2026-10-21T11:00:00Z",
          }),
          auditEntry({
            id: "log-get",
            method: "v1.compute.instances.get",
            at: "2026-10-21T11:01:00Z",
          }),
          auditEntry({
            id: "log-poll",
            method: "google.longrunning.Operations.GetOperation",
            at: "2026-10-21T11:02:00Z",
          }),
          auditEntry({
            id: "log-iam",
            method: "SetIamPolicy",
            service: "cloudresourcemanager.googleapis.com",
            resourceName: `projects/${PROJECT_ID}`,
            at: "2026-10-21T11:03:00Z",
            code: 7,
          }),
        ],
      },
    });
    const state: CloudConnectionPullState = {};

    const result: CloudChangesResult = await connector.readChanges(
      settings(),
      changeOptions(fake, state),
    );

    expect(
      result.changes.filter((change: CloudChange): boolean => {
        return change.kind === "change";
      }),
    ).toEqual([
      {
        kind: "change",
        provider: CloudProvider.GCP,
        accountId: PROJECT_ID,
        region: "europe-west1",
        time: new Date("2026-10-21T11:00:00Z"),
        eventId: "log-insert",
        operation: "v1.compute.instances.insert",
        actor: "deployer@acme.com",
        resources: [
          {
            id: `//compute.googleapis.com/projects/${PROJECT_ID}/zones/europe-west1-b/instances/web-1`,
            type: "gce_instance",
          },
        ],
        failed: false,
      },
      {
        kind: "change",
        provider: CloudProvider.GCP,
        accountId: PROJECT_ID,
        region: "europe-west1",
        time: new Date("2026-10-21T11:03:00Z"),
        eventId: "log-iam",
        operation: "SetIamPolicy",
        actor: "deployer@acme.com",
        resources: [
          {
            id: `//cloudresourcemanager.googleapis.com/projects/${PROJECT_ID}`,
            type: "gce_instance",
          },
        ],
        failed: true,
      },
    ]);
    expect(JSON.stringify(result.changes)).not.toContain("hunter2");

    const call: JSONObject = fake.auditCalls[0]!;
    expect(call["resourceNames"]).toEqual([`projects/${PROJECT_ID}`]);
    expect(call["filter"]).toBe(
      `logName="projects/${PROJECT_ID}/logs/cloudaudit.googleapis.com%2Factivity" AND timestamp>="2026-10-21T10:07:00.000Z" AND timestamp<"${NOW.toISOString()}"`,
    );
    expect(call["orderBy"]).toBe("timestamp asc");
    expect(state.changeCursors).toEqual({
      [PROJECT_ID]: NOW.toISOString(),
      [`${PROJECT_ID}|health`]: NOW.toISOString(),
    });
  });

  test("the next read starts twenty minutes before the last one stopped and writes nothing twice", async () => {
    const seen: JSONObject = auditEntry({
      id: "log-a",
      method: "v1.compute.instances.setMachineType",
      at: "2026-10-21T12:00:00Z",
    });
    const state: CloudConnectionPullState = {};

    await connector.readChanges(
      settings(),
      changeOptions(
        createFakeGcpActivity({ entries: { [PROJECT_ID]: [seen] } }),
        state,
      ),
    );

    const later: Date = new Date("2026-10-21T12:12:00Z");
    const fake: FakeGcpActivity = createFakeGcpActivity({
      entries: {
        [PROJECT_ID]: [
          seen,
          auditEntry({
            id: "log-b",
            method: "v1.compute.instances.stop",
            at: "2026-10-21T12:08:00Z",
          }),
        ],
      },
    });

    const second: CloudChangesResult = await connector.readChanges(
      settings(),
      changeOptions(fake, state, {}, later),
    );

    expect(
      second.changes.map((change: CloudChange): string => {
        return change.eventId;
      }),
    ).toEqual(["log-b"]);
    expect(String(fake.auditCalls[0]!["filter"])).toContain(
      'timestamp>="2026-10-21T11:47:00.000Z"',
    );
  });

  test("a project whose Logging API is off says how to turn it on; one the account may not read is told once", async () => {
    const fake: FakeGcpActivity = createFakeGcpActivity({
      auditErrors: {
        [PROJECT_ID]: json(
          {
            error: {
              code: 403,
              message:
                "Cloud Logging API has not been used in project 123 before or it is disabled.",
              status: "PERMISSION_DENIED",
            },
          },
          403,
        ),
        [OTHER_PROJECT]: json(
          {
            error: {
              code: 403,
              message: "Permission denied: logging.logEntries.list",
              status: "PERMISSION_DENIED",
            },
          },
          403,
        ),
      },
    });
    const state: CloudConnectionPullState = {};

    const result: CloudChangesResult = await connector.readChanges(
      settings({ projectIds: `${PROJECT_ID},${OTHER_PROJECT}` }),
      changeOptions(fake, state),
    );

    expect(result.complete).toBe(false);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain(
      `Could not read what changed in ${PROJECT_ID}:`,
    );
    expect(result.warnings[0]).toContain(
      "gcloud services enable logging.googleapis.com",
    );
    expect(result.warnings[1]).toBe(
      "The service account may not read a project's audit log. Run the setup command again: it gives it the Logs Viewer role.",
    );
    expect(state.changeCursors?.[PROJECT_ID]).toBeUndefined();
    expect(state.changeCursors?.[OTHER_PROJECT]).toBeUndefined();
  });

  test("an investigation's look back reads only the projects it names and moves no cursor", async () => {
    const fake: FakeGcpActivity = createFakeGcpActivity({});
    const state: CloudConnectionPullState = {};
    const since: Date = new Date("2026-10-21T08:00:00Z");

    await connector.readChanges(
      settings({ projectIds: `${PROJECT_ID},${OTHER_PROJECT}` }),
      changeOptions(fake, state, {
        since,
        only: [{ accountId: OTHER_PROJECT }],
      }),
    );

    expect(fake.auditCalls).toHaveLength(1);
    expect(fake.auditCalls[0]!["resourceNames"]).toEqual([
      `projects/${OTHER_PROJECT}`,
    ]);
    expect(String(fake.auditCalls[0]!["filter"])).toContain(
      `timestamp>="${since.toISOString()}"`,
    );
    expect(state.changeCursors).toBeUndefined();
    expect(fake.healthCalls).toEqual([]);
  });
});

describe("what Google Cloud Service Health says about the project", () => {
  test("an incident that touches the project is a health event, in Google's words", async () => {
    const fake: FakeGcpActivity = createFakeGcpActivity({
      healthEvents: {
        [PROJECT_ID]: [
          {
            name: `projects/${PROJECT_ID}/locations/global/events/evt-1`,
            title: "Cloud SQL connectivity issues in europe-west1",
            description: "We are investigating connection failures.",
            category: "INCIDENT",
            state: "ACTIVE",
            updateTime: "2026-10-21T11:50:00Z",
            eventImpacts: [{ product: { productName: "Cloud SQL" } }],
          },
        ],
      },
    });
    const state: CloudConnectionPullState = {};

    const result: CloudChangesResult = await connector.readChanges(
      settings(),
      changeOptions(fake, state),
    );

    expect(
      result.changes.filter((change: CloudChange): boolean => {
        return change.kind === "health";
      }),
    ).toEqual([
      {
        kind: "health",
        provider: CloudProvider.GCP,
        accountId: PROJECT_ID,
        region: "",
        time: new Date("2026-10-21T11:50:00Z"),
        eventId: `projects/${PROJECT_ID}/locations/global/events/evt-1|ACTIVE|2026-10-21T11:50:00.000Z`,
        operation: "INCIDENT",
        actor: "",
        resources: [],
        failed: false,
        title:
          "Google Cloud Service Health: Cloud SQL connectivity issues in europe-west1 (active)",
        description: "We are investigating connection failures.",
      },
    ]);
    expect(fake.healthCalls[0]!.searchParams.get("filter")).toBe(
      `update_time>="${new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString()}"`,
    );
    expect(state.healthReadAt).toBe(NOW.toISOString());
  });

  test("Service Health that is off or not allowed is asked again a day later, without a warning", async () => {
    const fake: FakeGcpActivity = createFakeGcpActivity({
      healthError: json(
        {
          error: {
            code: 403,
            message:
              "Service Health API has not been used in project 123 before or it is disabled.",
          },
        },
        403,
      ),
    });
    const state: CloudConnectionPullState = {};

    const result: CloudChangesResult = await connector.readChanges(
      settings(),
      changeOptions(fake, state),
    );

    expect(result.warnings).toEqual([]);
    expect(state.healthPausedUntil).toBe(
      new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    );

    const later: FakeGcpActivity = createFakeGcpActivity({});
    await connector.readChanges(
      settings(),
      changeOptions(later, state, {}, new Date(NOW.getTime() + 60 * 60000)),
    );
    expect(later.healthCalls).toEqual([]);
  });
});
