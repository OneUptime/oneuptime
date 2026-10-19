import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityLogFormat from "../../../Types/SecurityEvent/SecurityLogFormat";
import {
  flattenPayload,
  parseEventTime,
  readNumber,
  readString,
  readStringArray,
  readValue,
} from "../NormalizerHelpers";
import {
  MAX_JSON_LINE_LENGTH,
  SecurityLogLine,
  buildLogSecurityEvent,
  readAttribute,
  readIpAddress,
} from "./SecurityLogLine";

/*
 * Kubernetes API server audit events (audit.k8s.io), one JSON document per
 * line - what the API server writes to --audit-log-path and what the
 * OneUptime Kubernetes agent ships with auditLogs.enabled.
 *
 * An audit log records every request, most of them a controller reading or
 * renewing a lease every few seconds. Only the ones a security team looks
 * at become security events:
 *
 *   - any request the API server refused (401, 403);
 *   - a shell or a tunnel into a pod (exec, attach, portforward);
 *   - secrets read or changed by anyone but the control plane;
 *   - changes to who may do what (roles and their bindings), to admission
 *     webhooks, custom resource definitions, network policies and service
 *     accounts, by anyone but the control plane;
 *   - a pod created by a person, or a privileged pod created by anyone;
 *   - a namespace or a node deleted.
 *
 * The event keeps the whole audit record as attributes, so the rule
 * library's Kubernetes rules (objectRef.resource, verb, user.username,
 * requestObject...) read it as they would from the source itself.
 */

export const KUBERNETES_API_ACTIVITY_CLASS_UID: number = 6003;

const AUDIT_API_VERSION_PREFIX: string = "audit.k8s.io/";

// Requests at these stages are written again when they complete.
const SKIPPED_STAGES: ReadonlyArray<string> = [
  "RequestReceived",
  "ResponseStarted",
];

const WRITE_VERBS: ReadonlyArray<string> = [
  "create",
  "update",
  "patch",
  "delete",
  "deletecollection",
];

const INTERACTIVE_SUBRESOURCES: ReadonlyArray<string> = [
  "exec",
  "attach",
  "portforward",
];

// Changing any of these changes who may do what in the cluster.
const SENSITIVE_RESOURCES: ReadonlyArray<string> = [
  "roles",
  "rolebindings",
  "clusterroles",
  "clusterrolebindings",
  "serviceaccounts",
  "mutatingwebhookconfigurations",
  "validatingwebhookconfigurations",
  "customresourcedefinitions",
  "networkpolicies",
];

// Deleting one of these is never routine.
const DELETION_RESOURCES: ReadonlyArray<string> = ["namespaces", "nodes"];

// The most attributes one audit record keeps: a pod spec can be long.
const MAX_AUDIT_ATTRIBUTES: number = 400;
const MAX_AUDIT_ATTRIBUTE_VALUE_LENGTH: number = 1000;

export function isKubernetesAuditRecord(record: JSONObject): boolean {
  const apiVersion: string = readString(record, "apiVersion");

  return (
    apiVersion.startsWith(AUDIT_API_VERSION_PREFIX) &&
    readString(record, "kind") === "Event"
  );
}

// The control plane's own accounts, whose routine writes are not news.
export function isControlPlaneUser(username: string): boolean {
  return (
    username.startsWith("system:node:") ||
    username.startsWith("system:kube-") ||
    username === "system:apiserver" ||
    username.startsWith("system:serviceaccount:kube-system:")
  );
}

function isTrue(value: JSONValue): boolean {
  return value === true || value === "true";
}

// A pod that can take over its node: privileged, or sharing the node's namespaces.
export function isPrivilegedPodRequest(record: JSONObject): boolean {
  const spec: JSONValue = readValue(record, "requestObject.spec");

  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return false;
  }

  const podSpec: JSONObject = spec as JSONObject;

  if (
    isTrue(podSpec["hostPID"] as JSONValue) ||
    isTrue(podSpec["hostNetwork"] as JSONValue) ||
    isTrue(podSpec["hostIPC"] as JSONValue)
  ) {
    return true;
  }

  for (const key of ["containers", "initContainers", "ephemeralContainers"]) {
    const containers: JSONValue = podSpec[key] as JSONValue;

    if (!Array.isArray(containers)) {
      continue;
    }

    for (const container of containers) {
      if (
        container &&
        typeof container === "object" &&
        !Array.isArray(container) &&
        isTrue(
          readValue(
            container as JSONObject,
            "securityContext.privileged",
          ) as JSONValue,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

export function isSecurityRelevantAuditRecord(record: JSONObject): boolean {
  const stage: string = readString(record, "stage");

  if (stage && SKIPPED_STAGES.includes(stage)) {
    return false;
  }

  const code: number | null = readNumber(record, "responseStatus.code");

  if (code === 401 || code === 403) {
    return true;
  }

  const subresource: string = readString(record, "objectRef.subresource");

  if (INTERACTIVE_SUBRESOURCES.includes(subresource)) {
    return true;
  }

  const username: string = readString(record, "user.username");
  const isControlPlane: boolean = isControlPlaneUser(username);
  const resource: string = readString(record, "objectRef.resource");
  const verb: string = readString(record, "verb").toLowerCase();

  if (resource === "secrets") {
    return !isControlPlane;
  }

  if (!WRITE_VERBS.includes(verb)) {
    return false;
  }

  if (resource === "pods" && verb === "create" && !subresource) {
    return !isControlPlane || isPrivilegedPodRequest(record);
  }

  if (SENSITIVE_RESOURCES.includes(resource)) {
    return !isControlPlane;
  }

  if (DELETION_RESOURCES.includes(resource) && verb.startsWith("delete")) {
    return !isControlPlane;
  }

  return false;
}

// The audit record's attributes, capped so one enormous request object stays bounded.
function boundedAttributes(record: JSONObject): JSONObject {
  const flattened: JSONObject = flattenPayload(record);
  const bounded: JSONObject = {};
  let count: number = 0;

  for (const key of Object.keys(flattened)) {
    if (count >= MAX_AUDIT_ATTRIBUTES) {
      break;
    }

    const value: string = String(flattened[key]);
    bounded[key] =
      value.length > MAX_AUDIT_ATTRIBUTE_VALUE_LENGTH
        ? value.slice(0, MAX_AUDIT_ATTRIBUTE_VALUE_LENGTH)
        : value;
    count++;
  }

  return bounded;
}

function describeTarget(record: JSONObject): string {
  const resource: string = readString(record, "objectRef.resource");
  const subresource: string = readString(record, "objectRef.subresource");
  const namespace: string = readString(record, "objectRef.namespace");
  const name: string = readString(record, "objectRef.name");
  const kind: string = subresource ? `${resource}/${subresource}` : resource;
  const object: string = [namespace, name]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join("/");

  return object ? `${kind} ${object}` : kind;
}

export function readKubernetesAuditRecord(
  line: SecurityLogLine,
): JSONObject | null {
  const body: string = (line.body || "").trim();

  if (
    body.startsWith("{") &&
    body.length <= MAX_JSON_LINE_LENGTH &&
    body.includes(AUDIT_API_VERSION_PREFIX)
  ) {
    try {
      const parsed: unknown = JSON.parse(body);

      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        isKubernetesAuditRecord(parsed as JSONObject)
      ) {
        return parsed as JSONObject;
      }
    } catch {
      // Not JSON after all: no audit record in this line.
    }
  }

  return null;
}

export default class KubernetesAuditLogParser {
  public static parse(line: SecurityLogLine): Array<NormalizedSecurityEvent> {
    const record: JSONObject | null = readKubernetesAuditRecord(line);

    if (!record || !isSecurityRelevantAuditRecord(record)) {
      return [];
    }

    const username: string = readString(record, "user.username");
    const verb: string = readString(record, "verb").toLowerCase();
    const auditId: string = readString(record, "auditID");
    const code: number | null = readNumber(record, "responseStatus.code");
    const isDenied: boolean = code !== null && code >= 400;
    const subresource: string = readString(record, "objectRef.subresource");
    const target: string = describeTarget(record);
    const sourceIp: string = readIpAddress(
      readStringArray(record, "sourceIPs")[0] || "",
    );
    const cluster: string = readAttribute(line.attributes, [
      "k8s.cluster.name",
      "resource.k8s.cluster.name",
    ]);

    let severity: OcsfSeverity = OcsfSeverity.Low;

    if (code === 401 || code === 403) {
      severity = OcsfSeverity.Medium;
    } else if (
      INTERACTIVE_SUBRESOURCES.includes(subresource) ||
      isPrivilegedPodRequest(record)
    ) {
      severity = OcsfSeverity.Medium;
    }

    const who: string = username || "Someone";
    const message: string = isDenied
      ? `${who} was refused ${verb} ${target}${cluster ? ` in ${cluster}` : ""} (${code})`
      : `${who} ${verb} ${target}${cluster ? ` in ${cluster}` : ""}`;

    return [
      buildLogSecurityEvent({
        line,
        format: SecurityLogFormat.KubernetesAudit,
        classUid: KUBERNETES_API_ACTIVITY_CLASS_UID,
        activityName: verb,
        statusName: isDenied ? "Failure" : "Success",
        severity,
        message,
        time:
          parseEventTime(readValue(record, "stageTimestamp")) ||
          parseEventTime(readValue(record, "requestReceivedTimestamp")) ||
          undefined,
        principalUser: username,
        principalIp: sourceIp,
        targetHost: cluster,
        targetResource: target,
        attributes: boundedAttributes(record),
        eventUid: auditId ? `k8s-audit:${auditId}` : undefined,
      }),
    ];
  }
}
