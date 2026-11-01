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

import OtelLogsIngestService from "../../FeatureSet/Telemetry/Services/OtelLogsIngestService";
import LogDropFilterService from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import LogPipelineService from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import KubernetesResourceService from "Common/Server/Services/KubernetesResourceService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import Dictionary from "Common/Types/Dictionary";
import { ParsedKubernetesResource } from "Common/Types/Kubernetes/KubernetesInventoryExtractor";
import { OpenShiftObjectAttribute } from "Common/Types/Kubernetes/OpenShiftObjectAttributes";
import {
  PlainValue,
  toOtlpAnyValue,
} from "Common/Tests/Helpers/KubernetesEventRecords";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The kubernetes-agent chart's openshift preset pulls OpenShift's own
 * objects - Routes, DeploymentConfigs, ClusterOperators and the
 * ClusterVersion - every pull interval, as log records of the cluster
 * collector's k8sobjects/openshift receiver. These tests drive the REAL
 * OTLP walk (processLogsFromQueue) with those records, every backend
 * touchpoint mocked, and read what ingest hands the log writer and the
 * inventory upsert:
 *
 *   - a ClusterOperator's and the ClusterVersion's records are stamped with
 *     their state, conditions and versions, which the OpenShift alert
 *     templates filter on;
 *   - every one of the four becomes an inventory row of its Kind, with its
 *     state and health, and a Route's row carries no TLS key;
 *   - nothing else is stamped.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const CLUSTER_ID: ObjectID = ObjectID.generate();
const CLUSTER_NAME: string = "ocp-prod-eu";
const SERVICE_NAME: string = `kubernetes-agent-${CLUSTER_NAME}`;
const OBSERVED_TIME_NANO: string = "1792656300000000000";

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
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

type OtlpAttribute = { key: string; value: { stringValue: string } };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

// One pulled object's record, as the agent's collector exports it.
function pulledRecord(resourceName: string, object: PlainValue): JSONObject {
  return {
    observedTimeUnixNano: OBSERVED_TIME_NANO,
    severityNumber: 9,
    severityText: "INFO",
    attributes: [
      stringAttribute("event.domain", "k8s"),
      stringAttribute("k8s.resource.name", resourceName),
    ],
    body: toOtlpAnyValue(object),
  };
}

function agentRequest(records: Array<JSONObject>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceLogs: [
        {
          resource: {
            attributes: [
              stringAttribute("k8s.cluster.name", CLUSTER_NAME),
              stringAttribute("service.name", SERVICE_NAME),
              stringAttribute("oneuptime.kubernetes.distribution", "openshift"),
            ],
          },
          scopeLogs: [
            {
              scope: {
                name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/k8sobjectsreceiver",
              },
              logRecords: records,
            },
          ],
        },
      ],
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

interface Captured {
  rows: Array<JSONObject>;
  inventory: Array<ParsedKubernetesResource>;
}

function setupIngestMocks(): Captured {
  const captured: Captured = { rows: [], inventory: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelLogsIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }
  // The cluster is known, so the inventory hook runs.
  jest
    .spyOn(service, "autoDiscoverKubernetesCluster")
    .mockResolvedValue(CLUSTER_ID);
  jest
    .spyOn(service, "writeForDiscoveredResource")
    .mockImplementation(async (...args: Array<unknown>): Promise<void> => {
      const input: { write: (id: ObjectID) => Promise<void> } = args[0] as {
        write: (id: ObjectID) => Promise<void>;
      };
      await input.write(CLUSTER_ID);
    });

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: SERVICE_NAME,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });

  jest
    .spyOn(service, "submitLogsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      captured.rows.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });
  jest
    .spyOn(service, "submitExceptionsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      rows.splice(0, rows.length);
      return Promise.resolve();
    });

  jest
    .spyOn(KubernetesResourceService, "bulkUpsert")
    .mockImplementation(async (...args: Array<unknown>): Promise<void> => {
      const input: { resources: Array<ParsedKubernetesResource> } = args[0] as {
        resources: Array<ParsedKubernetesResource>;
      };
      captured.inventory.push(...input.resources);
    });

  jest.spyOn(LogDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(LogScrubRuleService, "loadScrubRules")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(LogPipelineService, "loadPipelines")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);

  return captured;
}

afterEach(() => {
  jest.restoreAllMocks();
});

function attributesOf(row: JSONObject): JSONObject {
  return row["attributes"] as JSONObject;
}

function rowFor(rows: Array<JSONObject>, resourceName: string): JSONObject {
  const row: JSONObject | undefined = rows.find((candidate: JSONObject) => {
    return attributesOf(candidate)["k8s.resource.name"] === resourceName;
  });
  expect(row).toBeDefined();
  return row!;
}

function inventoryFor(
  inventory: Array<ParsedKubernetesResource>,
  kind: string,
  name: string,
): ParsedKubernetesResource {
  const row: ParsedKubernetesResource | undefined = inventory.find(
    (candidate: ParsedKubernetesResource) => {
      return candidate.kind === kind && candidate.name === name;
    },
  );
  expect(row).toBeDefined();
  return row!;
}

const DEGRADED_INGRESS_OPERATOR: PlainValue = {
  apiVersion: "config.openshift.io/v1",
  kind: "ClusterOperator",
  metadata: { name: "ingress", uid: "uid-ingress" },
  status: {
    conditions: [
      {
        type: "Degraded",
        status: "True",
        reason: "IngressDegraded",
        message: 'The "default" ingress controller reports Degraded=True',
      },
      { type: "Available", status: "True" },
      { type: "Progressing", status: "False" },
    ],
    versions: [{ name: "operator", version: "4.18.12" }],
  },
};

const FAILING_CLUSTER_VERSION: PlainValue = {
  apiVersion: "config.openshift.io/v1",
  kind: "ClusterVersion",
  metadata: { name: "version", uid: "uid-version" },
  spec: { channel: "stable-4.18", desiredUpdate: { version: "4.18.13" } },
  status: {
    desired: { version: "4.18.13" },
    history: [
      { version: "4.18.13", state: "Partial" },
      { version: "4.18.12", state: "Completed" },
    ],
    conditions: [
      { type: "Available", status: "True" },
      {
        type: "Failing",
        status: "True",
        message: "Cluster operator machine-config is not available",
      },
      { type: "Progressing", status: "True" },
    ],
  },
};

const ROUTE: PlainValue = {
  apiVersion: "route.openshift.io/v1",
  kind: "Route",
  metadata: { name: "frontend", namespace: "shop", uid: "uid-route" },
  spec: {
    host: "frontend-shop.apps.ocp.example.com",
    to: { kind: "Service", name: "frontend", weight: 100 },
    tls: {
      termination: "edge",
      key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----",
    },
  },
  status: {
    ingress: [
      {
        host: "frontend-shop.apps.ocp.example.com",
        routerName: "default",
        conditions: [{ type: "Admitted", status: "True" }],
      },
    ],
  },
};

const DEPLOYMENT_CONFIG: PlainValue = {
  apiVersion: "apps.openshift.io/v1",
  kind: "DeploymentConfig",
  metadata: { name: "legacy-api", namespace: "shop", uid: "uid-dc" },
  spec: { replicas: 2, selector: { app: "legacy-api" } },
  status: { latestVersion: 3, replicas: 2, availableReplicas: 1 },
};

describe("a pulled ClusterOperator's record", () => {
  test("is stamped with the operator, its state and every condition it reports", async () => {
    const captured: Captured = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        pulledRecord("clusteroperators", DEGRADED_INGRESS_OPERATOR),
      ]),
    );

    const attributes: JSONObject = attributesOf(
      rowFor(captured.rows, "clusteroperators"),
    );

    expect(attributes[OpenShiftObjectAttribute.ObjectKind]).toBe(
      "ClusterOperator",
    );
    expect(attributes[OpenShiftObjectAttribute.ObjectName]).toBe("ingress");
    expect(attributes[OpenShiftObjectAttribute.State]).toBe("Degraded");
    expect(attributes[OpenShiftObjectAttribute.Degraded]).toBe("True");
    expect(attributes[OpenShiftObjectAttribute.Available]).toBe("True");
    expect(attributes[OpenShiftObjectAttribute.Progressing]).toBe("False");
    expect(attributes[OpenShiftObjectAttribute.CurrentVersion]).toBe("4.18.12");
  });

  test("lists the stamped keys among the row's attribute keys", async () => {
    const captured: Captured = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        pulledRecord("clusteroperators", DEGRADED_INGRESS_OPERATOR),
      ]),
    );

    const row: JSONObject = rowFor(captured.rows, "clusteroperators");
    const keys: Array<string> = (row["attributeKeys"] as Array<string>) || [];

    expect(keys).toEqual(
      expect.arrayContaining([
        OpenShiftObjectAttribute.State,
        OpenShiftObjectAttribute.Degraded,
        OpenShiftObjectAttribute.ObjectName,
      ]),
    );
  });

  test("becomes an inventory row: cluster-scoped, Degraded, not healthy", async () => {
    const captured: Captured = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        pulledRecord("clusteroperators", DEGRADED_INGRESS_OPERATOR),
      ]),
    );

    const row: ParsedKubernetesResource = inventoryFor(
      captured.inventory,
      "ClusterOperator",
      "ingress",
    );

    expect(row.namespaceKey).toBe("");
    expect(row.phase).toBe("Degraded");
    expect(row.isReady).toBe(false);
  });
});

describe("the pulled ClusterVersion's record", () => {
  test("is stamped Failing, with the version it runs and the one it moves to", async () => {
    const captured: Captured = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([pulledRecord("clusterversions", FAILING_CLUSTER_VERSION)]),
    );

    const attributes: JSONObject = attributesOf(
      rowFor(captured.rows, "clusterversions"),
    );

    expect(attributes[OpenShiftObjectAttribute.ObjectKind]).toBe(
      "ClusterVersion",
    );
    expect(attributes[OpenShiftObjectAttribute.State]).toBe("Failing");
    expect(attributes[OpenShiftObjectAttribute.Failing]).toBe("True");
    expect(attributes[OpenShiftObjectAttribute.CurrentVersion]).toBe("4.18.12");
    expect(attributes[OpenShiftObjectAttribute.DesiredVersion]).toBe("4.18.13");

    expect(
      inventoryFor(captured.inventory, "ClusterVersion", "version").phase,
    ).toBe("Failing");
  });
});

describe("a pulled Route's and DeploymentConfig's records", () => {
  test("become inventory rows, the Route's without its TLS key", async () => {
    const captured: Captured = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        pulledRecord("routes", ROUTE),
        pulledRecord("deploymentconfigs", DEPLOYMENT_CONFIG),
      ]),
    );

    const route: ParsedKubernetesResource = inventoryFor(
      captured.inventory,
      "Route",
      "frontend",
    );
    expect(route.namespaceKey).toBe("shop");
    expect(route.phase).toBe("Admitted");
    expect(route.isReady).toBe(true);
    expect(JSON.stringify(route)).not.toContain("PRIVATE KEY");

    const deploymentConfig: ParsedKubernetesResource = inventoryFor(
      captured.inventory,
      "DeploymentConfig",
      "legacy-api",
    );
    expect(deploymentConfig.namespaceKey).toBe("shop");
    expect(deploymentConfig.phase).toBe("Progressing");
    expect(deploymentConfig.isReady).toBe(false);
  });

  test("are not stamped with OpenShift status attributes", async () => {
    const captured: Captured = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        pulledRecord("routes", ROUTE),
        pulledRecord("deploymentconfigs", DEPLOYMENT_CONFIG),
      ]),
    );

    for (const resourceName of ["routes", "deploymentconfigs"]) {
      const attributes: JSONObject = attributesOf(
        rowFor(captured.rows, resourceName),
      );
      for (const key of Object.keys(attributes)) {
        expect({
          resourceName,
          key,
          openshift: key.startsWith("openshift."),
        }).toEqual({
          resourceName,
          key,
          openshift: false,
        });
      }
    }
  });
});

describe("stampOpenShiftStatus", () => {
  function bodyOf(object: PlainValue): string {
    return JSON.stringify(toOtlpAnyValue(object));
  }

  test("writes the object's own values over stale ones the record carried", () => {
    const attributes: Dictionary<string> = {
      "k8s.resource.name": "clusteroperators",
      [OpenShiftObjectAttribute.State]: "Available",
      [OpenShiftObjectAttribute.ObjectName]: "something-else",
    };

    expect(
      OtelLogsIngestService.stampOpenShiftStatus({
        attributes: attributes,
        body: bodyOf(DEGRADED_INGRESS_OPERATOR),
      }),
    ).toBe(true);
    expect(attributes[OpenShiftObjectAttribute.State]).toBe("Degraded");
    expect(attributes[OpenShiftObjectAttribute.ObjectName]).toBe("ingress");
  });

  test("leaves a record whose body is not an object untouched", () => {
    for (const body of [
      "",
      "plain text",
      JSON.stringify({ stringValue: "x" }),
    ]) {
      const attributes: Dictionary<string> = {
        "k8s.resource.name": "clusteroperators",
      };

      expect(
        OtelLogsIngestService.stampOpenShiftStatus({
          attributes: attributes,
          body: body,
        }),
      ).toBe(false);
      expect(attributes).toEqual({ "k8s.resource.name": "clusteroperators" });
    }
  });

  test("leaves a record of another resource type untouched", () => {
    const attributes: Dictionary<string> = { "k8s.resource.name": "routes" };

    expect(
      OtelLogsIngestService.stampOpenShiftStatus({
        attributes: attributes,
        body: bodyOf(DEGRADED_INGRESS_OPERATOR),
      }),
    ).toBe(false);
    expect(attributes).toEqual({ "k8s.resource.name": "routes" });
  });
});

describe("what is not OpenShift's is left alone", () => {
  test("a pulled Pod spec is inventoried as before, and stamped with nothing of OpenShift's", async () => {
    const captured: Captured = setupIngestMocks();

    await OtelLogsIngestService.processLogsFromQueue(
      agentRequest([
        pulledRecord("pods", {
          kind: "Pod",
          metadata: { name: "web-1", namespace: "shop", uid: "uid-pod" },
          spec: { containers: [{ name: "web", image: "nginx:1.27" }] },
          status: { phase: "Running" },
        }),
      ]),
    );

    expect(inventoryFor(captured.inventory, "Pod", "web-1").phase).toBe(
      "Running",
    );
    const attributes: JSONObject = attributesOf(rowFor(captured.rows, "pods"));
    expect(
      Object.keys(attributes).some((key: string) => {
        return key.startsWith("openshift.");
      }),
    ).toBe(false);
  });
});
