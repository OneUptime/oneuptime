import {
  ExtractedInventoryRecord,
  INVENTORIED_RESOURCE_TYPES,
  extractInventoryResource,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import {
  OPENSHIFT_KIND_BY_RESOURCE_TYPE,
  OpenShiftResourceType,
  getOpenShiftInventoryState,
} from "../../../Types/Kubernetes/OpenShiftObjectParser";
import {
  PlainValue,
  toOtlpAnyValue,
} from "../../Helpers/KubernetesEventRecords";
import { describe, expect, test } from "@jest/globals";

/*
 * The openshift preset's k8sobjects/openshift receiver pulls Routes,
 * DeploymentConfigs, ClusterOperators and the ClusterVersion every pull
 * interval. Ingest turns each record into a KubernetesResource row with
 * extractInventoryResource, as it does the upstream kinds: these pin the
 * row each OpenShift object becomes - its kind, namespace, name, the state
 * in its phase and whether that state is healthy in isReady - and that a
 * Route's TLS key never reaches it.
 *
 * The bodies are the records the collector sends: the pulled object, as an
 * OTLP AnyValue, as JSON.
 */

const LAST_SEEN: Date = new Date("2026-11-01T10:00:00.000Z");

function record(
  resourceType: string,
  object: PlainValue,
): ExtractedInventoryRecord | null {
  return extractInventoryResource({
    resourceType: resourceType,
    logBody: JSON.stringify(toOtlpAnyValue(object)),
    lastSeenAt: LAST_SEEN,
  });
}

function operator(name: string, statuses: Record<string, string>): PlainValue {
  return {
    apiVersion: "config.openshift.io/v1",
    kind: "ClusterOperator",
    metadata: {
      name: name,
      uid: `uid-${name}`,
      creationTimestamp: "2025-01-20T09:00:00Z",
    },
    status: {
      conditions: Object.keys(statuses).map((type: string) => {
        return { type: type, status: statuses[type]! };
      }),
      versions: [{ name: "operator", version: "4.18.12" }],
    },
  };
}

describe("OpenShift's resource types are inventoried", () => {
  test("every one of them, under its Kind", () => {
    for (const resourceType of Object.values(OpenShiftResourceType)) {
      expect(INVENTORIED_RESOURCE_TYPES).toContain(resourceType);
    }
  });
});

describe("a ClusterOperator's row", () => {
  test("is cluster-scoped, named, and Available when healthy", () => {
    const extracted: ExtractedInventoryRecord = record(
      "clusteroperators",
      operator("authentication", {
        Available: "True",
        Progressing: "False",
        Degraded: "False",
      }),
    )!;

    expect(extracted.containers).toEqual([]);
    expect(extracted.resource.kind).toBe("ClusterOperator");
    expect(extracted.resource.namespaceKey).toBe("");
    expect(extracted.resource.name).toBe("authentication");
    expect(extracted.resource.uid).toBe("uid-authentication");
    expect(extracted.resource.phase).toBe("Available");
    expect(extracted.resource.isReady).toBe(true);
    expect(extracted.resource.lastSeenAt).toBe(LAST_SEEN);
    expect(extracted.resource.resourceCreationTimestamp?.toISOString()).toBe(
      "2025-01-20T09:00:00.000Z",
    );
  });

  test("an operator rolling out is Progressing, and still healthy", () => {
    const extracted: ExtractedInventoryRecord = record(
      "clusteroperators",
      operator("kube-apiserver", {
        Available: "True",
        Progressing: "True",
        Degraded: "False",
      }),
    )!;

    expect(extracted.resource.phase).toBe("Progressing");
    expect(extracted.resource.isReady).toBe(true);
  });

  test("a degraded operator is Degraded, and not healthy, even while available", () => {
    const extracted: ExtractedInventoryRecord = record(
      "clusteroperators",
      operator("ingress", { Available: "True", Degraded: "True" }),
    )!;

    expect(extracted.resource.phase).toBe("Degraded");
    expect(extracted.resource.isReady).toBe(false);
  });

  test("an unavailable operator is Unavailable, and not healthy", () => {
    const extracted: ExtractedInventoryRecord = record(
      "clusteroperators",
      operator("console", { Available: "False", Degraded: "False" }),
    )!;

    expect(extracted.resource.phase).toBe("Unavailable");
    expect(extracted.resource.isReady).toBe(false);
  });

  test("its conditions and versions are in the status the pages read", () => {
    const extracted: ExtractedInventoryRecord = record(
      "clusteroperators",
      operator("dns", { Available: "True", Degraded: "False" }),
    )!;
    const status: Record<string, unknown> = extracted.resource.status as Record<
      string,
      unknown
    >;

    expect(status["versions"]).toEqual([
      { name: "operator", version: "4.18.12" },
    ]);
    expect(
      (status["conditions"] as Array<{ type: string; status: string }>).map(
        (condition: { type: string; status: string }) => {
          return [condition.type, condition.status];
        },
      ),
    ).toEqual([
      ["Available", "True"],
      ["Degraded", "False"],
    ]);
  });
});

describe("the ClusterVersion's row", () => {
  function clusterVersion(statuses: Record<string, string>): PlainValue {
    return {
      kind: "ClusterVersion",
      metadata: { name: "version", uid: "uid-version" },
      spec: { channel: "stable-4.18", desiredUpdate: { version: "4.18.13" } },
      status: {
        desired: { version: "4.18.13" },
        history: [
          { version: "4.18.13", state: "Partial" },
          { version: "4.18.12", state: "Completed" },
        ],
        conditions: Object.keys(statuses).map((type: string) => {
          return { type: type, status: statuses[type]! };
        }),
      },
    };
  }

  test("an update under way is Updating, and healthy", () => {
    const extracted: ExtractedInventoryRecord = record(
      "clusterversions",
      clusterVersion({
        Available: "True",
        Failing: "False",
        Progressing: "True",
      }),
    )!;

    expect(extracted.resource.kind).toBe("ClusterVersion");
    expect(extracted.resource.namespaceKey).toBe("");
    expect(extracted.resource.name).toBe("version");
    expect(extracted.resource.phase).toBe("Updating");
    expect(extracted.resource.isReady).toBe(true);
    expect(
      (extracted.resource.status as Record<string, unknown>)["currentVersion"],
    ).toBe("4.18.12");
    expect(
      (extracted.resource.spec as Record<string, unknown>)["channel"],
    ).toBe("stable-4.18");
  });

  test("a failing one is Failing, and not healthy", () => {
    const extracted: ExtractedInventoryRecord = record(
      "clusterversions",
      clusterVersion({ Available: "True", Failing: "True" }),
    )!;

    expect(extracted.resource.phase).toBe("Failing");
    expect(extracted.resource.isReady).toBe(false);
  });
});

describe("a Route's row", () => {
  const route: PlainValue = {
    kind: "Route",
    metadata: { name: "frontend", namespace: "shop", uid: "uid-frontend" },
    spec: {
      host: "frontend-shop.apps.ocp.example.com",
      to: { kind: "Service", name: "frontend", weight: 100 },
      tls: {
        termination: "reencrypt",
        key: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
        certificate:
          "-----BEGIN CERTIFICATE-----\nMIID\n-----END CERTIFICATE-----",
        destinationCACertificate:
          "-----BEGIN CERTIFICATE-----\nMIIC\n-----END CERTIFICATE-----",
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

  test("is namespaced, Admitted and healthy once a router admits it", () => {
    const extracted: ExtractedInventoryRecord = record("routes", route)!;

    expect(extracted.resource.kind).toBe("Route");
    expect(extracted.resource.namespaceKey).toBe("shop");
    expect(extracted.resource.name).toBe("frontend");
    expect(extracted.resource.phase).toBe("Admitted");
    expect(extracted.resource.isReady).toBe(true);
    expect(
      (extracted.resource.spec as Record<string, unknown>)["tlsTermination"],
    ).toBe("reencrypt");
  });

  test("never stores its TLS key or certificates", () => {
    const stored: string = JSON.stringify(record("routes", route));

    expect(stored).not.toContain("PRIVATE KEY");
    expect(stored).not.toContain("CERTIFICATE");
    expect(stored).not.toContain("MIIEowIBAAKCAQEA");
  });

  test("a route no router answered is Pending, and not healthy yet", () => {
    const extracted: ExtractedInventoryRecord = record("routes", {
      kind: "Route",
      metadata: { name: "new", namespace: "shop" },
      spec: { host: "new.example.com", to: { kind: "Service", name: "new" } },
    })!;

    expect(extracted.resource.phase).toBe("Pending");
    expect(extracted.resource.isReady).toBe(false);
  });
});

describe("a DeploymentConfig's row", () => {
  function deploymentConfig(replicas: number, available: number): PlainValue {
    return {
      kind: "DeploymentConfig",
      metadata: { name: "legacy-api", namespace: "shop", uid: "uid-dc" },
      spec: { replicas: replicas, selector: { app: "legacy-api" } },
      status: {
        latestVersion: 4,
        replicas: replicas,
        availableReplicas: available,
        readyReplicas: available,
      },
    };
  }

  test("every replica available is Available, and healthy", () => {
    const extracted: ExtractedInventoryRecord = record(
      "deploymentconfigs",
      deploymentConfig(3, 3),
    )!;

    expect(extracted.resource.kind).toBe("DeploymentConfig");
    expect(extracted.resource.namespaceKey).toBe("shop");
    expect(extracted.resource.phase).toBe("Available");
    expect(extracted.resource.isReady).toBe(true);
    expect(
      (extracted.resource.spec as Record<string, unknown>)["selector"],
    ).toEqual({
      app: "legacy-api",
    });
  });

  test("scaled to zero is healthy too: nothing is wanted", () => {
    const extracted: ExtractedInventoryRecord = record(
      "deploymentconfigs",
      deploymentConfig(0, 0),
    )!;

    expect(extracted.resource.phase).toBe("Scaled to zero");
    expect(extracted.resource.isReady).toBe(true);
  });

  test("none available is Unavailable, and not healthy", () => {
    const extracted: ExtractedInventoryRecord = record(
      "deploymentconfigs",
      deploymentConfig(2, 0),
    )!;

    expect(extracted.resource.phase).toBe("Unavailable");
    expect(extracted.resource.isReady).toBe(false);
  });
});

describe("what is not inventoried", () => {
  test("a record without a name", () => {
    expect(
      record("clusteroperators", { kind: "ClusterOperator", metadata: {} }),
    ).toBeNull();
    expect(record("routes", { kind: "Route", spec: { host: "x" } })).toBeNull();
  });

  test("a body that is not an object", () => {
    expect(
      extractInventoryResource({
        resourceType: "clusteroperators",
        logBody: "not json",
        lastSeenAt: LAST_SEEN,
      }),
    ).toBeNull();
    expect(
      extractInventoryResource({
        resourceType: "routes",
        logBody: JSON.stringify({ stringValue: "hello" }),
        lastSeenAt: LAST_SEEN,
      }),
    ).toBeNull();
  });

  test("an OpenShift object the chart does not pull", () => {
    expect(
      record("imagestreams", {
        kind: "ImageStream",
        metadata: { name: "legacy-api", namespace: "shop" },
      }),
    ).toBeNull();
  });
});

describe("the upstream kinds keep their own state columns", () => {
  test("a Deployment's row has no OpenShift state", () => {
    const extracted: ExtractedInventoryRecord = record("deployments", {
      kind: "Deployment",
      metadata: { name: "web", namespace: "shop" },
      spec: { replicas: 2 },
      status: { availableReplicas: 2 },
    })!;

    expect(extracted.resource.phase).toBeNull();
    expect(extracted.resource.isReady).toBeNull();
  });

  test("getOpenShiftInventoryState answers only for OpenShift's kinds", () => {
    for (const kind of ["Pod", "Node", "Deployment", "Namespace", ""]) {
      expect(
        getOpenShiftInventoryState(
          kind,
          {} as unknown as Parameters<typeof getOpenShiftInventoryState>[1],
        ),
      ).toBeNull();
    }
    for (const kind of Object.values(OPENSHIFT_KIND_BY_RESOURCE_TYPE)) {
      expect(kind).toMatch(/^[A-Z][A-Za-z]+$/);
    }
  });
});
