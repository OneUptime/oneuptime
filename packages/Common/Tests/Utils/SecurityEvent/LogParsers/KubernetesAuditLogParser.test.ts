import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import KubernetesAuditLogParser, {
  isControlPlaneUser,
  isPrivilegedPodRequest,
  isSecurityRelevantAuditRecord,
} from "../../../../Utils/SecurityEvent/LogParsers/KubernetesAuditLogParser";
import { auditEvent, logLine } from "./LogParserFixtures";

function parse(
  record: JSONObject,
  attributes: JSONObject = {},
): Array<NormalizedSecurityEvent> {
  return KubernetesAuditLogParser.parse(
    logLine(JSON.stringify(record), attributes),
  );
}

const EXEC: JSONObject = auditEvent({
  verb: "create",
  requestURI: "/api/v1/namespaces/default/pods/web-7d9/exec?command=sh",
  objectRef: {
    resource: "pods",
    namespace: "default",
    name: "web-7d9",
    subresource: "exec",
    apiVersion: "v1",
  },
  responseStatus: { metadata: {}, code: 101 },
});

const PRIVILEGED_POD_FROM_CONTROLLER: JSONObject = auditEvent({
  verb: "create",
  user: {
    username: "system:serviceaccount:kube-system:daemon-set-controller",
  },
  objectRef: { resource: "pods", namespace: "monitoring", apiVersion: "v1" },
  requestObject: {
    kind: "Pod",
    spec: {
      containers: [{ name: "agent", securityContext: { privileged: true } }],
    },
  },
  responseStatus: { metadata: {}, code: 201 },
});

const CLUSTER_ADMIN_GRANTED: JSONObject = auditEvent({
  verb: "create",
  objectRef: {
    resource: "clusterrolebindings",
    name: "ops-admin",
    apiGroup: "rbac.authorization.k8s.io",
  },
  requestObject: {
    kind: "ClusterRoleBinding",
    roleRef: { kind: "ClusterRole", name: "cluster-admin" },
  },
  responseStatus: { metadata: {}, code: 201 },
});

/*
 * An audit log records every request the API server sees, most of them the
 * control plane renewing leases every few seconds. Only what a security
 * team looks at becomes an event, with the whole record kept as attributes
 * so the rule library's Kubernetes rules (objectRef.resource, verb,
 * user.username, requestObject...) read it as written.
 */
describe("KubernetesAuditLogParser", () => {
  test("a shell opened in a pod is a Medium API Activity event with the record as attributes", () => {
    const events: Array<NormalizedSecurityEvent> = parse(EXEC, {
      "k8s.cluster.name": "prod-eu",
    });

    expect(events).toHaveLength(1);

    const event: NormalizedSecurityEvent = events[0]!;

    expect(event.classUid).toBe(6003);
    expect(event.className).toBe("API Activity");
    expect(event.categoryName).toBe("Application Activity");
    expect(event.activityName).toBe("create");
    expect(event.statusName).toBe("Success");
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.principalUser).toBe("alice@example.com");
    expect(event.principalIp).toBe("198.51.100.20");
    expect(event.targetHost).toBe("prod-eu");
    expect(event.targetResource).toBe("pods/exec default/web-7d9");
    expect(event.message).toBe(
      "alice@example.com create pods/exec default/web-7d9 in prod-eu",
    );
    expect(event.vendorName).toBe("Kubernetes");
    expect(event.productName).toBe("Kubernetes audit log");
    expect(event.eventUid).toBe(
      "k8s-audit:1d2c7f0e-6c3a-4c1e-9a55-000000000001",
    );
    expect(event.time.toISOString()).toBe("2026-10-19T10:00:00.000Z");
    expect(event.attributes["objectRef.resource"]).toBe("pods");
    expect(event.attributes["objectRef.subresource"]).toBe("exec");
    expect(event.attributes["verb"]).toBe("create");
    expect(event.attributes["user.username"]).toBe("alice@example.com");
  });

  test("a privileged pod a controller created is kept, flattened the way the rule reads it", () => {
    const event: NormalizedSecurityEvent = parse(
      PRIVILEGED_POD_FROM_CONTROLLER,
    )[0]!;

    expect(event).toBeDefined();
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(
      event.attributes[
        "requestObject.spec.containers.0.securityContext.privileged"
      ],
    ).toBe("true");
  });

  test("cluster-admin granted to someone is kept", () => {
    const event: NormalizedSecurityEvent = parse(CLUSTER_ADMIN_GRANTED)[0]!;

    expect(event.attributes["objectRef.resource"]).toBe("clusterrolebindings");
    expect(event.attributes["requestObject.roleRef.name"]).toBe(
      "cluster-admin",
    );
    expect(event.targetResource).toBe("clusterrolebindings ops-admin");
  });

  test("a refused request is a Medium failure whoever made it", () => {
    const event: NormalizedSecurityEvent = parse(
      auditEvent({
        verb: "list",
        user: { username: "system:serviceaccount:default:app" },
        objectRef: { resource: "secrets", namespace: "kube-system" },
        responseStatus: { metadata: {}, code: 403 },
      }),
    )[0]!;

    expect(event.statusName).toBe("Failure");
    expect(event.severityName).toBe(OcsfSeverity.Medium);
    expect(event.message).toBe(
      "system:serviceaccount:default:app was refused list secrets kube-system (403)",
    );
  });

  test.each<[string, JSONObject, boolean]>([
    ["exec", EXEC, true],
    [
      "attach",
      auditEvent({
        verb: "create",
        objectRef: { resource: "pods", subresource: "attach" },
      }),
      true,
    ],
    [
      "port-forward",
      auditEvent({
        verb: "create",
        objectRef: { resource: "pods", subresource: "portforward" },
      }),
      true,
    ],
    [
      "401 from anyone",
      auditEvent({
        user: { username: "system:anonymous" },
        responseStatus: { code: 401 },
      }),
      true,
    ],
    [
      "secrets read by a workload",
      auditEvent({
        verb: "get",
        user: { username: "system:serviceaccount:monitoring:prom" },
        objectRef: { resource: "secrets" },
      }),
      true,
    ],
    [
      "secrets read by the controller manager",
      auditEvent({
        verb: "get",
        user: { username: "system:kube-controller-manager" },
        objectRef: { resource: "secrets" },
      }),
      false,
    ],
    [
      "a person creating a pod",
      auditEvent({ verb: "create", objectRef: { resource: "pods" } }),
      true,
    ],
    [
      "a controller creating an ordinary pod",
      auditEvent({
        verb: "create",
        user: {
          username: "system:serviceaccount:kube-system:replicaset-controller",
        },
        objectRef: { resource: "pods" },
      }),
      false,
    ],
    [
      "a role binding by a person",
      auditEvent({ verb: "create", objectRef: { resource: "rolebindings" } }),
      true,
    ],
    [
      "a webhook changed",
      auditEvent({
        verb: "patch",
        objectRef: { resource: "mutatingwebhookconfigurations" },
      }),
      true,
    ],
    [
      "a namespace deleted",
      auditEvent({
        verb: "delete",
        objectRef: { resource: "namespaces", name: "prod" },
      }),
      true,
    ],
    [
      "a kubelet renewing its lease",
      auditEvent({
        verb: "update",
        user: { username: "system:node:node-1" },
        objectRef: { resource: "leases" },
      }),
      false,
    ],
    [
      "a person reading pods",
      auditEvent({ verb: "get", objectRef: { resource: "pods" } }),
      false,
    ],
    [
      "a person scaling a deployment",
      auditEvent({ verb: "patch", objectRef: { resource: "deployments" } }),
      false,
    ],
    [
      "a request still being received",
      auditEvent({
        stage: "RequestReceived",
        verb: "create",
        objectRef: { resource: "pods", subresource: "exec" },
      }),
      false,
    ],
  ])("%s -> kept: %s", (_name: string, record: JSONObject, kept: boolean) => {
    expect(isSecurityRelevantAuditRecord(record)).toBe(kept);
    expect(parse(record).length > 0).toBe(kept);
  });

  test("the control plane's own accounts", () => {
    expect(isControlPlaneUser("system:node:ip-10-0-0-1")).toBe(true);
    expect(isControlPlaneUser("system:kube-scheduler")).toBe(true);
    expect(isControlPlaneUser("system:apiserver")).toBe(true);
    expect(
      isControlPlaneUser("system:serviceaccount:kube-system:job-controller"),
    ).toBe(true);
    expect(isControlPlaneUser("system:serviceaccount:argocd:argocd")).toBe(
      false,
    );
    expect(isControlPlaneUser("alice@example.com")).toBe(false);
  });

  test.each<[string, JSONObject, boolean]>([
    [
      "privileged",
      {
        requestObject: {
          spec: { containers: [{ securityContext: { privileged: true } }] },
        },
      },
      true,
    ],
    [
      "privileged init container",
      {
        requestObject: {
          spec: {
            initContainers: [{ securityContext: { privileged: "true" } }],
          },
        },
      },
      true,
    ],
    [
      "host PID",
      { requestObject: { spec: { hostPID: true, containers: [] } } },
      true,
    ],
    ["host network", { requestObject: { spec: { hostNetwork: true } } }, true],
    ["host IPC", { requestObject: { spec: { hostIPC: true } } }, true],
    [
      "ordinary",
      {
        requestObject: {
          spec: { containers: [{ securityContext: { privileged: false } }] },
        },
      },
      false,
    ],
    ["no request object", {}, false],
  ])(
    "isPrivilegedPodRequest: %s",
    (_name: string, record: JSONObject, privileged: boolean) => {
      expect(isPrivilegedPodRequest(record)).toBe(privileged);
    },
  );

  test("lines that are not an audit record are no event", () => {
    for (const body of [
      "",
      "not json audit.k8s.io/v1",
      JSON.stringify({ apiVersion: "audit.k8s.io/v1", kind: "Policy" }),
      JSON.stringify({ apiVersion: "v1", kind: "Event", verb: "create" }),
      `{"apiVersion":"audit.k8s.io/v1","kind":"Event"`,
    ]) {
      expect(KubernetesAuditLogParser.parse(logLine(body))).toEqual([]);
    }
  });

  test("a record bigger than a JSON line may be is skipped, not parsed", () => {
    const huge: string = JSON.stringify(
      auditEvent({
        verb: "create",
        objectRef: { resource: "pods", subresource: "exec" },
        requestObject: { blob: "x".repeat(300 * 1024) },
      }),
    );

    expect(KubernetesAuditLogParser.parse(logLine(huge))).toEqual([]);
  });

  test("a request object's many fields are kept to a bounded number", () => {
    // More fields than are kept, one of them longer than a value may be.
    const fields: JSONObject = { longest: "z".repeat(5000) };

    for (let index: number = 0; index < 600; index++) {
      fields[`field${index}`] = "y".repeat(300);
    }

    const event: NormalizedSecurityEvent = parse(
      auditEvent({
        verb: "create",
        objectRef: { resource: "pods", subresource: "exec" },
        requestObject: fields,
      }),
    )[0]!;

    // 400 from the record, plus the three every log event carries.
    expect(Object.keys(event.attributes).length).toBeLessThanOrEqual(404);

    for (const value of Object.values(event.attributes)) {
      expect(String(value).length).toBeLessThanOrEqual(1000);
    }
  });
});
