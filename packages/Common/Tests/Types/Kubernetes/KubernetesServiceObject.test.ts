import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesServiceObject,
  parseServiceObject,
} from "../../../Types/Kubernetes/KubernetesObjectParser";
import {
  ExtractedInventoryRecord,
  INVENTORIED_RESOURCE_TYPES,
  extractInventoryResource,
  kindFromResourceType,
} from "../../../Types/Kubernetes/KubernetesInventoryExtractor";
import {
  PlainValue,
  toOtlpAnyValue,
} from "../../Helpers/KubernetesEventRecords";
import { describe, expect, test } from "@jest/globals";

/*
 * A core Service, as the kubernetes-agent chart's openshift preset pulls it
 * for the Routes that send traffic to it. The fixtures are written as `oc
 * get service -o json` prints them and encoded the way the collector encodes
 * them. Like every parser on the ingest path, this one returns null on
 * garbage and never throws.
 */

function asKvList(object: PlainValue): JSONObject {
  return toOtlpAnyValue(object)["kvlistValue"] as JSONObject;
}

const FRONTEND: PlainValue = {
  apiVersion: "v1",
  kind: "Service",
  metadata: {
    name: "frontend",
    namespace: "shop",
    uid: "9f3c1f6e-4a02-4e0b-9d39-1c7f2a6b1c11",
    creationTimestamp: "2026-10-01T10:00:00Z",
    labels: { app: "frontend" },
    annotations: {
      "service.alpha.openshift.io/serving-cert-secret-name": "frontend-tls",
    },
  },
  spec: {
    type: "ClusterIP",
    clusterIP: "172.30.14.2",
    clusterIPs: ["172.30.14.2"],
    sessionAffinity: "None",
    selector: { app: "frontend", deploymentconfig: "frontend" },
    ports: [
      { name: "http", protocol: "TCP", port: 8080, targetPort: 8080 },
      { name: "https", protocol: "TCP", port: 8443, targetPort: "https" },
    ],
  },
  status: { loadBalancer: {} },
};

const LOAD_BALANCER: PlainValue = {
  apiVersion: "v1",
  kind: "Service",
  metadata: {
    name: "router-default",
    namespace: "openshift-ingress",
  },
  spec: {
    type: "LoadBalancer",
    clusterIP: "172.30.200.9",
    sessionAffinity: "None",
    selector: { "ingresscontroller.operator.openshift.io/deployment": "x" },
    ports: [
      {
        name: "http",
        protocol: "TCP",
        port: 80,
        targetPort: "http",
        nodePort: 31080,
      },
    ],
  },
  status: {
    loadBalancer: {
      ingress: [
        { hostname: "a1b2.elb.amazonaws.com" },
        { ip: "203.0.113.10" },
        {},
      ],
    },
  },
};

describe("parseServiceObject", () => {
  const service: KubernetesServiceObject = parseServiceObject(
    asKvList(FRONTEND),
  )!;

  test("reads the service's identity", () => {
    expect(service.metadata.name).toBe("frontend");
    expect(service.metadata.namespace).toBe("shop");
    expect(service.metadata.labels).toEqual({ app: "frontend" });
  });

  test("reads what it is and which pods it sends traffic to", () => {
    expect(service.spec.type).toBe("ClusterIP");
    expect(service.spec.clusterIP).toBe("172.30.14.2");
    expect(service.spec.sessionAffinity).toBe("None");
    expect(service.spec.selector).toEqual({
      app: "frontend",
      deploymentconfig: "frontend",
    });
  });

  test("reads every port, a target port by number or by name", () => {
    expect(service.spec.ports).toEqual([
      {
        name: "http",
        protocol: "TCP",
        port: 8080,
        targetPort: "8080",
        nodePort: 0,
      },
      {
        name: "https",
        protocol: "TCP",
        port: 8443,
        targetPort: "https",
        nodePort: 0,
      },
    ]);
  });

  test("a ClusterIP service has no load balancer", () => {
    expect(service.status.loadBalancerIngress).toEqual([]);
  });

  test("reads a LoadBalancer's addresses and its node port, and drops an empty entry", () => {
    const parsed: KubernetesServiceObject = parseServiceObject(
      asKvList(LOAD_BALANCER),
    )!;

    expect(parsed.spec.type).toBe("LoadBalancer");
    expect(parsed.spec.ports[0]?.nodePort).toBe(31080);
    expect(parsed.status.loadBalancerIngress).toEqual([
      "a1b2.elb.amazonaws.com",
      "203.0.113.10",
    ]);
  });

  test("reads an ExternalName service, which selects no pods", () => {
    const parsed: KubernetesServiceObject = parseServiceObject(
      asKvList({
        metadata: { name: "billing", namespace: "shop" },
        spec: { type: "ExternalName", externalName: "billing.example.com" },
      }),
    )!;

    expect(parsed.spec.externalName).toBe("billing.example.com");
    expect(parsed.spec.selector).toEqual({});
    expect(parsed.spec.ports).toEqual([]);
    expect(parsed.status.loadBalancerIngress).toEqual([]);
  });

  test("reads a headless service as written", () => {
    const parsed: KubernetesServiceObject = parseServiceObject(
      asKvList({
        metadata: { name: "kafka", namespace: "shop" },
        spec: { type: "ClusterIP", clusterIP: "None" },
      }),
    )!;

    expect(parsed.spec.clusterIP).toBe("None");
  });

  test("returns null with no metadata, and never throws on garbage", () => {
    expect(parseServiceObject(asKvList({ spec: {} }))).toBeNull();
    expect(parseServiceObject({} as JSONObject)).toBeNull();
    expect(
      parseServiceObject({ values: "nonsense" } as unknown as JSONObject),
    ).toBeNull();
  });

  test("reads the protobuf encoding (snake_case) as well as JSON", () => {
    const protobuf: JSONObject = JSON.parse(
      JSON.stringify(asKvList(FRONTEND))
        .replace(/stringValue/g, "string_value")
        .replace(/intValue/g, "int_value")
        .replace(/kvlistValue/g, "kvlist_value")
        .replace(/arrayValue/g, "array_value"),
    ) as JSONObject;

    const parsed: KubernetesServiceObject | null = parseServiceObject(protobuf);

    expect(parsed?.metadata.name).toBe("frontend");
    expect(
      parsed?.spec.ports.map((port: { port: number }) => {
        return port.port;
      }),
    ).toEqual([8080, 8443]);
  });
});

describe("a Service in inventory", () => {
  const record: ExtractedInventoryRecord | null = extractInventoryResource({
    resourceType: "services",
    logBody: JSON.stringify({
      kvlistValue: asKvList(FRONTEND),
    }),
    lastSeenAt: new Date("2026-11-01T10:00:00Z"),
  });

  test("is a resource type ingest stores, under the kind Service", () => {
    expect(INVENTORIED_RESOURCE_TYPES).toContain("services");
    expect(kindFromResourceType("services")).toBe("Service");
    expect(kindFromResourceType("Services")).toBe("Service");
  });

  test("stores its namespace, its spec and no health of its own", () => {
    expect(record?.resource.kind).toBe("Service");
    expect(record?.resource.namespaceKey).toBe("shop");
    expect(record?.resource.name).toBe("frontend");
    expect(record?.resource.phase).toBeNull();
    expect(record?.resource.isReady).toBeNull();
    expect(record?.containers).toEqual([]);
    expect(
      (record?.resource.spec as unknown as { selector: unknown }).selector,
    ).toEqual({ app: "frontend", deploymentconfig: "frontend" });
  });
});
