/*
 * The Queue infrastructure module pulls in BullMQ at import time; the
 * telemetry queue is replaced by the jobs it would have been handed.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService",
  () => {
    return {
      __esModule: true,
      default: { addMetricIngestJob: jest.fn() },
    };
  },
);

jest.mock("../../FeatureSet/Telemetry/Services/Queue/LogsQueueService", () => {
  return {
    __esModule: true,
    default: { addLogIngestJob: jest.fn() },
  };
});

import net from "net";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Redis from "Common/Server/Infrastructure/Redis";
import CloudConnectionService from "Common/Server/Services/CloudConnectionService";
import PayAsYouGoBillingService from "Common/Server/Services/PayAsYouGoBillingService";
import ProjectService from "Common/Server/Services/ProjectService";
import CloudStreamActivity from "Common/Server/Utils/CloudConnection/CloudStreamActivity";
import CloudStreamReader, {
  CloudStreamReadOutcome,
} from "Common/Server/Utils/CloudConnection/CloudStreamReader";
import { CloudConnectionSettings } from "Common/Server/Utils/CloudConnection/CloudConnectorTypes";
import { KafkaSocketFactory } from "Common/Server/Utils/CloudConnection/Kafka/KafkaClient";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "Common/Server/Utils/DataSource/HttpFetch";
import LlmConnectionPullRunner from "Common/Server/Utils/LlmObservability/LlmConnectionPullRunner";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { CloudStreamSummary } from "Common/Types/CloudConnection/CloudStream";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import { FakeEventHubsBroker } from "Common/Tests/Server/Utils/CloudConnection/Helpers/FakeEventHubs";
import AzureEventHubsIngestService from "../../FeatureSet/Telemetry/Services/AzureEventHubsIngestService";
import LogsQueueService from "../../FeatureSet/Telemetry/Services/Queue/LogsQueueService";
import MetricsQueueService from "../../FeatureSet/Telemetry/Services/Queue/MetricsQueueService";
import {
  SITE_ID,
  SUBSCRIPTION,
  VAULT_ID,
  VM_ID,
  appServiceConsoleRecord,
  eventOf,
  metricRecord,
  vaultAuditRecord,
} from "./Helpers/AzureDiagnosticEvents";

/*
 * A FAKE EVENT HUBS NAMESPACE, READ BY THE REAL READER, INTO THE REAL
 * INGEST SERVICE.
 *
 * Each connection's namespace is a fake Kafka broker on a real socket,
 * holding events as Azure Monitor's diagnostic settings write them -
 * platform metrics and resource logs, several to a batch - and Resource
 * Manager and Entra are a fake transport. The real reader reads them and
 * the real ingest service decodes and queues them; the telemetry queue is
 * replaced by the jobs it is handed. Pinned:
 *
 *   - each event's metrics and logs land as the connection's project's
 *     OTLP jobs, under its service and id, filed under the resource they
 *     are about - the key metrics in the very series the read writes;
 *   - an event read and queued is never queued again, whichever read reads
 *     the event hub next;
 *   - two connections of two projects read side by side, each into its own
 *     project only, whatever their events say.
 *
 * `jest` is the global one.
 */

const PROJECT_A: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_B: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const CONNECTION_A: ObjectID = new ObjectID("6f1c3a2e-9b8d-4c7e-a1f0-2d3c4b5a6e7f");
const CONNECTION_B: ObjectID = new ObjectID("7a2d4b3f-0c9e-4d8f-b2a1-3e4d5c6b7a8f");

let brokers: Map<string, FakeEventHubsBroker>;
let rows: Map<string, CloudConnection>;
let metricJobs: Array<{ projectId: string; body: JSONObject; productType: string }>;
let logJobs: Array<{ projectId: string; body: JSONObject; productType: string }>;
let redis: Map<string, string>;
let summaries: Map<string, CloudStreamSummary>;

function namespaceOf(connectionId: ObjectID): string {
  return `oneuptime-${connectionId.toString().slice(0, 8)}-eastus`;
}

function connectionRow(connectionId: ObjectID, projectId: ObjectID): CloudConnection {
  const connection: CloudConnection = new CloudConnection();
  connection.id = connectionId;
  connection.projectId = projectId;
  connection.provider = CloudProvider.Azure;
  connection.isEnabled = true;
  connection.name = "Azure";
  connection.streamKeyCreatedAt = new Date("2026-11-06T09:00:00.000Z");
  connection.streamState = { hostSubscriptionId: SUBSCRIPTION, offsets: {} };
  connection.pullState = {
    azureMetricDefinitions: {
      "microsoft.compute/virtualmachines": {
        at: "2026-11-06T09:00:00.000Z",
        metrics: [{ name: "Percentage CPU", unit: "Percent", aggregation: "Average", grain: "PT1M" }],
      },
      "microsoft.web/sites": {
        at: "2026-11-06T09:00:00.000Z",
        metrics: [{ name: "Requests", unit: "Count", aggregation: "Total", grain: "PT1M" }],
      },
    },
  };
  return connection;
}

function resourceRow(id: string, type: string, name: string, region: string): CloudResource {
  const resource: CloudResource = new CloudResource();
  resource.name = name;
  resource.providerResourceId = id;
  resource.telemetryAttributes = { "azuremonitor.resource_id": id };
  resource.cloudRegion = region;
  resource.cloudResourceType = type;
  resource.cloudResourceGroup = id.split("/")[4]!;
  resource.cloudAccountId = SUBSCRIPTION;
  return resource;
}

// Resource Manager lists each connection's own namespace; Entra signs in each app.
function transportFor(connectionId: ObjectID): (request: DataSourceHttpRequest) => Promise<DataSourceHttpResponse> {
  return async (request: DataSourceHttpRequest): Promise<DataSourceHttpResponse> => {
    if (request.url.includes("/oauth2/v2.0/token")) {
      return {
        statusCode: 200,
        bodyText: "",
        bodyJson: { access_token: `token-${connectionId.toString()}`, expires_in: 3600 },
      };
    }

    const body: JSONObject = {
      value: [
        {
          name: namespaceOf(connectionId),
          location: "eastus",
          properties: { provisioningState: "Succeeded" },
        },
      ],
    };

    return { statusCode: 200, bodyText: JSON.stringify(body), bodyJson: body };
  };
}

async function read(connectionId: ObjectID): Promise<CloudStreamReadOutcome> {
  return await CloudStreamReader.readAzure(connectionId, {
    deliver: AzureEventHubsIngestService.deliver,
    transport: transportFor(connectionId),
    socketFactoryFor: async (host: string): Promise<KafkaSocketFactory> => {
      return (): net.Socket => {
        return brokers.get(host)!.connect();
      };
    },
  });
}

function resourceAttribute(resource: JSONObject, key: string): string | undefined {
  const found: JSONObject | undefined = (
    (resource["resource"] as JSONObject)["attributes"] as Array<JSONObject>
  ).find((attribute: JSONObject) => {
    return attribute["key"] === key;
  });
  return found ? ((found["value"] as JSONObject)["stringValue"] as string) : undefined;
}

function metricNames(jobs: Array<{ body: JSONObject }>): Array<string> {
  return jobs.flatMap((job: { body: JSONObject }) => {
    return (job.body["resourceMetrics"] as Array<JSONObject>).flatMap((resource: JSONObject) => {
      return ((resource["scopeMetrics"] as Array<JSONObject>)[0]!["metrics"] as Array<JSONObject>).map(
        (metric: JSONObject) => {
          return metric["name"] as string;
        },
      );
    });
  });
}

function logResources(jobs: Array<{ body: JSONObject }>): Array<JSONObject> {
  return jobs.flatMap((job: { body: JSONObject }) => {
    return job.body["resourceLogs"] as Array<JSONObject>;
  });
}

beforeEach(async () => {
  brokers = new Map();
  rows = new Map();
  metricJobs = [];
  logJobs = [];
  redis = new Map();
  summaries = new Map();
  CloudStreamReader.reset();
  CloudStreamActivity.reset();

  for (const [connectionId, projectId] of [
    [CONNECTION_A, PROJECT_A],
    [CONNECTION_B, PROJECT_B],
  ] as Array<[ObjectID, ObjectID]>) {
    const broker: FakeEventHubsBroker = new FakeEventHubsBroker();
    broker.host = `${namespaceOf(connectionId)}.servicebus.windows.net`;
    broker.token = `token-${connectionId.toString()}`;
    await broker.start();
    brokers.set(broker.host, broker);
    rows.set(connectionId.toString(), connectionRow(connectionId, projectId));
  }

  jest.spyOn(CloudConnectionService, "findOneById").mockImplementation((async (data: { id: ObjectID }) => {
    return rows.get(data.id.toString()) || null;
  }) as never);
  jest
    .spyOn(CloudConnectionService, "getConnectorSettings")
    .mockImplementation(async (connection: CloudConnection): Promise<CloudConnectionSettings> => {
      return {
        provider: CloudProvider.Azure,
        projectId: connection.projectId!.toString(),
        config: {
          tenantId: "22222222-bbbb-4bbb-8bbb-222222222222",
          clientId: "0b9f6c1e-2d3a-4b5c-8d7e-9f0a1b2c3d4e",
          cloud: "public",
        },
        secrets: { clientSecret: "app-secret" },
      };
    });
  jest
    .spyOn(CloudConnectionService, "ensureTelemetryService")
    .mockImplementation(async (connection: CloudConnection) => {
      return {
        serviceId: ObjectID.generate(),
        serviceName: connection.id!.toString() === CONNECTION_A.toString() ? "Production Azure" : "Staging Azure",
      };
    });
  jest
    .spyOn(CloudConnectionService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      rows.get(data.id.toString())!.streamState = data.data["streamState"] as JSONObject;
    }) as never);
  CloudStreamReader.loadResources = async (): Promise<Array<CloudResource>> => {
    return [
      resourceRow(VM_ID, "Microsoft.Compute/virtualMachines", "web-01", "eastus"),
      resourceRow(SITE_ID, "Microsoft.Web/sites", "checkout", "eastus"),
      resourceRow(VAULT_ID, "Microsoft.KeyVault/vaults", "acme-secrets", "westeurope"),
    ];
  };
  jest.spyOn(LlmConnectionPullRunner, "isTelemetryAllowed").mockResolvedValue(true);
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(PayAsYouGoBillingService, "requirePayAsYouGo").mockResolvedValue(undefined);
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
  jest.spyOn(Redis, "getClient").mockReturnValue({
    get: async (key: string): Promise<string | null> => {
      return redis.get(key) ?? null;
    },
    mget: async (keys: Array<string>): Promise<Array<string | null>> => {
      return keys.map((key: string) => {
        return redis.get(key) ?? null;
      });
    },
    set: async (key: string, value: string): Promise<string> => {
      redis.set(key, value);
      return "OK";
    },
  } as never);

  (MetricsQueueService.addMetricIngestJob as jest.Mock).mockImplementation(async (job: unknown) => {
    const request: JSONObject = job as JSONObject;
    metricJobs.push({
      projectId: (request["projectId"] as ObjectID).toString(),
      body: request["body"] as JSONObject,
      productType: request["productType"] as string,
    });
  });
  (LogsQueueService.addLogIngestJob as jest.Mock).mockImplementation(async (job: unknown) => {
    const request: JSONObject = job as JSONObject;
    logJobs.push({
      projectId: (request["projectId"] as ObjectID).toString(),
      body: request["body"] as JSONObject,
      productType: request["productType"] as string,
    });
  });

  CloudStreamActivity.readSummary = async (id: ObjectID): Promise<CloudStreamSummary> => {
    return summaries.get(id.toString()) || { metricSources: [], logSources: [] };
  };
  CloudStreamActivity.writeSummary = async (data: {
    connectionId: ObjectID;
    summary: CloudStreamSummary;
  }): Promise<void> => {
    summaries.set(data.connectionId.toString(), data.summary);
  };
});

afterEach(async () => {
  jest.restoreAllMocks();
  (MetricsQueueService.addMetricIngestJob as jest.Mock).mockReset();
  (LogsQueueService.addLogIngestJob as jest.Mock).mockReset();

  for (const broker of brokers.values()) {
    await broker.stop();
  }
});

function brokerOf(connectionId: ObjectID): FakeEventHubsBroker {
  return brokers.get(`${namespaceOf(connectionId)}.servicebus.windows.net`)!;
}

describe("an Azure connection's event hub", () => {
  test("its metrics and logs land as the connection's project's jobs, filed under the resources they are about", async () => {
    brokerOf(CONNECTION_A).addEvents(0, [
      eventOf([
        metricRecord({ resourceId: VM_ID, metricName: "Percentage CPU", total: 48, count: 4, minimum: 6, maximum: 20 }),
        metricRecord({ resourceId: SITE_ID, metricName: "Requests", total: 930, count: 60, minimum: 0, maximum: 31 }),
      ]),
      eventOf([vaultAuditRecord(), appServiceConsoleRecord()]),
    ]);

    const outcome: CloudStreamReadOutcome = await read(CONNECTION_A);

    expect(outcome).toEqual({ status: "read", events: 2 });
    expect(metricJobs.map((job: { projectId: string; productType: string }) => {
      return [job.projectId, job.productType];
    })).toEqual([[PROJECT_A.toString(), ProductType.Metrics]]);
    expect(metricNames(metricJobs).sort()).toEqual([
      "azure_percentage_cpu_average",
      "azure_requests_total",
    ]);
    expect(logJobs.map((job: { projectId: string; productType: string }) => {
      return [job.projectId, job.productType];
    })).toEqual([[PROJECT_A.toString(), ProductType.Logs]]);

    const logs: Array<JSONObject> = logResources(logJobs);
    expect(
      logs.map((resource: JSONObject) => {
        return [
          resourceAttribute(resource, "service.name"),
          resourceAttribute(resource, "cloud.resource_id"),
          resourceAttribute(resource, "cloud.account.id"),
        ];
      }),
    ).toEqual([
      ["Production Azure", VAULT_ID, SUBSCRIPTION],
      ["Production Azure", SITE_ID, SUBSCRIPTION],
    ]);

    // The namespace was signed in to with the connection's own app, for itself alone.
    expect(brokerOf(CONNECTION_A).tokens).toEqual([`token-${CONNECTION_A.toString()}`]);
  });

  test("an event read and queued is never queued again, whichever read comes next", async () => {
    brokerOf(CONNECTION_A).addEvents(0, [eventOf([vaultAuditRecord()])]);

    await read(CONNECTION_A);
    expect(logJobs).toHaveLength(1);

    // The next minute's read, and one after Postgres lost its offsets: Redis has them.
    await read(CONNECTION_A);
    rows.get(CONNECTION_A.toString())!.streamState = { hostSubscriptionId: SUBSCRIPTION, offsets: {} };
    await read(CONNECTION_A);
    expect(logJobs).toHaveLength(1);

    // A new event is read on its own.
    brokerOf(CONNECTION_A).addEvents(0, [eventOf([appServiceConsoleRecord()])]);
    await read(CONNECTION_A);
    expect(logJobs).toHaveLength(2);
    expect(resourceAttribute(logResources([logJobs[1]!])[0]!, "cloud.resource_id")).toBe(SITE_ID);
  });

  test("two connections of two projects read side by side, each into its own project only", async () => {
    brokerOf(CONNECTION_A).addEvents(0, [eventOf([vaultAuditRecord()])]);
    brokerOf(CONNECTION_B).addEvents(1, [eventOf([vaultAuditRecord(), vaultAuditRecord()])]);

    await Promise.all([read(CONNECTION_A), read(CONNECTION_B)]);

    const byProject: Record<string, Array<string | undefined>> = {};

    for (const job of logJobs) {
      for (const resource of job.body["resourceLogs"] as Array<JSONObject>) {
        (byProject[job.projectId] = byProject[job.projectId] || []).push(
          resourceAttribute(resource, "service.name"),
        );
      }
    }

    expect(byProject).toEqual({
      [PROJECT_A.toString()]: ["Production Azure"],
      [PROJECT_B.toString()]: ["Staging Azure"],
    });
    // Each namespace was asked by its own connection's token only.
    expect(brokerOf(CONNECTION_B).tokens).toEqual([`token-${CONNECTION_B.toString()}`]);
  });

  test("what came is said on the connection: from which subscription and region, of which types and categories", async () => {
    brokerOf(CONNECTION_A).addEvents(0, [
      eventOf([
        metricRecord({ resourceId: VM_ID, metricName: "Percentage CPU", total: 4, count: 1, minimum: 4, maximum: 4 }),
        vaultAuditRecord(),
      ]),
    ]);

    await read(CONNECTION_A);
    await CloudStreamActivity.flushAll(new Date());

    const summary: CloudStreamSummary = summaries.get(CONNECTION_A.toString())!;
    expect(summary.lastDeliveryAt).toBeDefined();
    expect(summary.metricSources).toEqual([
      expect.objectContaining({
        accountId: SUBSCRIPTION,
        region: "eastus",
        namespaces: ["Microsoft.Compute/virtualMachines"],
      }),
    ]);
    expect(summary.logSources).toEqual([
      expect.objectContaining({
        accountId: SUBSCRIPTION,
        region: "westeurope",
        logGroups: ["AuditEvent"],
      }),
    ]);
  });
});
