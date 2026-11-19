import { JSONObject } from "../JSON";
import {
  KubernetesObjectMetadata,
  getKvValue,
  kvListToPlainObject,
  parseMetadata,
} from "./KubernetesObjectParser";

/*
 * WHO MAY DO WHAT IN A CLUSTER, AND WHO MAY TALK TO WHOM (#9627).
 *
 * The CIS Kubernetes Benchmark's first policy controls are about RBAC - who
 * is bound to cluster-admin, which roles use wildcards, who may read
 * Secrets or create pods - and the default service accounts, and its
 * network controls about NetworkPolicies. The agent reads these objects
 * with the other resource specs (the chart's resourceSpecs.compliance), and
 * the inventory keeps each one's few fields those controls read:
 *
 *   - a Role or ClusterRole: its rules;
 *   - a RoleBinding or ClusterRoleBinding: the role it grants, and to whom;
 *   - a ServiceAccount: whether its token is mounted into pods by default;
 *   - a NetworkPolicy: which pods it selects and which ways it limits.
 *
 * Nothing else is kept: no Secret is ever read (a ServiceAccount's list of
 * token Secrets is left out too), and a NetworkPolicy's peers are counted,
 * not stored. The stored spec keeps the names Kubernetes gives the fields,
 * so the readers below read an object off the wire and a stored row alike.
 * Pure: the ingest, the server's scoring and their tests read it.
 */

// The most rules, subjects or values one object keeps: none is this large.
const MAX_LIST_LENGTH: number = 200;

export interface KubernetesPolicyRule {
  apiGroups: Array<string>;
  resources: Array<string>;
  verbs: Array<string>;
  resourceNames?: Array<string> | undefined;
  nonResourceURLs?: Array<string> | undefined;
}

export interface KubernetesRoleSpec {
  rules: Array<KubernetesPolicyRule>;
  // A ClusterRole whose rules the controller fills from the roles it selects.
  isAggregated?: boolean | undefined;
}

export interface KubernetesRoleRef {
  // "Role" or "ClusterRole".
  kind: string;
  name: string;
}

export interface KubernetesSubject {
  // "User", "Group" or "ServiceAccount".
  kind: string;
  name: string;
  // A ServiceAccount's namespace.
  namespace?: string | undefined;
}

export interface KubernetesRoleBindingSpec {
  roleRef: KubernetesRoleRef;
  subjects: Array<KubernetesSubject>;
}

export interface KubernetesServiceAccountSpec {
  automountServiceAccountToken?: boolean | undefined;
}

export interface KubernetesNetworkPolicySpec {
  // Whether its podSelector is empty: it selects every pod of its namespace.
  selectsAllPods: boolean;
  policyTypes: Array<string>;
  ingressRuleCount: number;
  egressRuleCount: number;
}

// An object off the wire: its metadata, and the spec the inventory keeps.
export interface KubernetesPolicyObject<T> {
  metadata: KubernetesObjectMetadata;
  spec: T;
}

type Plain = Record<string, unknown>;

function asObject(value: unknown): Plain {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Plain)
    : {};
}

function asArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function readTexts(value: unknown): Array<string> {
  return asArray(value)
    .filter((item: unknown): item is string => {
      return typeof item === "string";
    })
    .slice(0, MAX_LIST_LENGTH);
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true") {
    return true;
  }

  if (value === false || value === "false") {
    return false;
  }

  return undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Readers: an object's plain JSON, or a stored spec
 * ---------------------------------------------------------------------------
 */

export function readPolicyRule(value: unknown): KubernetesPolicyRule {
  const rule: Plain = asObject(value);
  const resourceNames: Array<string> = readTexts(rule["resourceNames"]);
  const nonResourceURLs: Array<string> = readTexts(rule["nonResourceURLs"]);
  const result: KubernetesPolicyRule = {
    apiGroups: readTexts(rule["apiGroups"]),
    resources: readTexts(rule["resources"]),
    verbs: readTexts(rule["verbs"]),
  };

  if (resourceNames.length > 0) {
    result.resourceNames = resourceNames;
  }

  if (nonResourceURLs.length > 0) {
    result.nonResourceURLs = nonResourceURLs;
  }

  return result;
}

// A Role's or a ClusterRole's rules, from the object or a stored spec.
export function readRoleSpec(value: unknown): KubernetesRoleSpec {
  const role: Plain = asObject(value);
  const spec: KubernetesRoleSpec = {
    rules: asArray(role["rules"]).slice(0, MAX_LIST_LENGTH).map(readPolicyRule),
  };

  if (role["aggregationRule"] || role["isAggregated"] === true) {
    spec.isAggregated = true;
  }

  return spec;
}

export function readSubject(value: unknown): KubernetesSubject | null {
  const subject: Plain = asObject(value);
  const kind: string = readText(subject["kind"]);
  const name: string = readText(subject["name"]);

  if (!kind || !name) {
    return null;
  }

  const namespace: string = readText(subject["namespace"]);

  return namespace ? { kind, name, namespace } : { kind, name };
}

// A binding's role and subjects, from the object or a stored spec.
export function readRoleBindingSpec(value: unknown): KubernetesRoleBindingSpec {
  const binding: Plain = asObject(value);
  const roleRef: Plain = asObject(binding["roleRef"]);

  return {
    roleRef: {
      kind: readText(roleRef["kind"]),
      name: readText(roleRef["name"]),
    },
    subjects: asArray(binding["subjects"])
      .slice(0, MAX_LIST_LENGTH)
      .map(readSubject)
      .filter(
        (subject: KubernetesSubject | null): subject is KubernetesSubject => {
          return Boolean(subject);
        },
      ),
  };
}

// A ServiceAccount's token automounting, from the object or a stored spec.
export function readServiceAccountSpec(
  value: unknown,
): KubernetesServiceAccountSpec {
  const automount: boolean | undefined = readBoolean(
    asObject(value)["automountServiceAccountToken"],
  );

  return automount === undefined
    ? {}
    : { automountServiceAccountToken: automount };
}

// A NetworkPolicy's spec, as Kubernetes writes it, to the few fields kept.
export function readNetworkPolicySpec(
  value: unknown,
): KubernetesNetworkPolicySpec {
  const spec: Plain = asObject(value);
  const selector: Plain = asObject(spec["podSelector"]);

  return {
    selectsAllPods:
      Object.keys(asObject(selector["matchLabels"])).length === 0 &&
      asArray(selector["matchExpressions"]).length === 0,
    policyTypes: readTexts(spec["policyTypes"]),
    ingressRuleCount: asArray(spec["ingress"]).length,
    egressRuleCount: asArray(spec["egress"]).length,
  };
}

// A stored NetworkPolicy spec read back; null when it is not one.
export function toNetworkPolicySpec(
  value: unknown,
): KubernetesNetworkPolicySpec | null {
  const stored: Plain = asObject(value);

  if (typeof stored["selectsAllPods"] !== "boolean") {
    return null;
  }

  return {
    selectsAllPods: stored["selectsAllPods"],
    policyTypes: readTexts(stored["policyTypes"]),
    ingressRuleCount:
      typeof stored["ingressRuleCount"] === "number"
        ? stored["ingressRuleCount"]
        : 0,
    egressRuleCount:
      typeof stored["egressRuleCount"] === "number"
        ? stored["egressRuleCount"]
        : 0,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Parsers: an object as the agent sends it (an OTLP kvlist)
 * ---------------------------------------------------------------------------
 */

function parsePolicyObject<T>(
  objectKvList: JSONObject,
  readSpec: (plain: Plain) => T,
): KubernetesPolicyObject<T> | null {
  try {
    const metadataKv: string | JSONObject | null = getKvValue(
      objectKvList,
      "metadata",
    );

    if (!metadataKv || typeof metadataKv === "string") {
      return null;
    }

    return {
      metadata: parseMetadata(metadataKv),
      spec: readSpec(kvListToPlainObject(objectKvList)),
    };
  } catch {
    return null;
  }
}

// A Role or a ClusterRole: its rules are at the object's top level.
export function parseRoleObject(
  objectKvList: JSONObject,
): KubernetesPolicyObject<KubernetesRoleSpec> | null {
  return parsePolicyObject(objectKvList, readRoleSpec);
}

// A RoleBinding or a ClusterRoleBinding: roleRef and subjects, top level.
export function parseRoleBindingObject(
  objectKvList: JSONObject,
): KubernetesPolicyObject<KubernetesRoleBindingSpec> | null {
  return parsePolicyObject(objectKvList, readRoleBindingSpec);
}

// A ServiceAccount: whether its token is mounted, at the top level.
export function parseServiceAccountObject(
  objectKvList: JSONObject,
): KubernetesPolicyObject<KubernetesServiceAccountSpec> | null {
  return parsePolicyObject(objectKvList, readServiceAccountSpec);
}

// A NetworkPolicy: its spec.
export function parseNetworkPolicyObject(
  objectKvList: JSONObject,
): KubernetesPolicyObject<KubernetesNetworkPolicySpec> | null {
  return parsePolicyObject(objectKvList, (plain: Plain) => {
    return readNetworkPolicySpec(plain["spec"]);
  });
}

/*
 * The resource types the agent pulls these objects as (k8s.resource.name),
 * and their Kinds.
 */
export enum KubernetesPolicyResourceType {
  Roles = "roles",
  ClusterRoles = "clusterroles",
  RoleBindings = "rolebindings",
  ClusterRoleBindings = "clusterrolebindings",
  ServiceAccounts = "serviceaccounts",
  NetworkPolicies = "networkpolicies",
}

export const POLICY_KIND_BY_RESOURCE_TYPE: Readonly<Record<string, string>> = {
  [KubernetesPolicyResourceType.Roles]: "Role",
  [KubernetesPolicyResourceType.ClusterRoles]: "ClusterRole",
  [KubernetesPolicyResourceType.RoleBindings]: "RoleBinding",
  [KubernetesPolicyResourceType.ClusterRoleBindings]: "ClusterRoleBinding",
  [KubernetesPolicyResourceType.ServiceAccounts]: "ServiceAccount",
  [KubernetesPolicyResourceType.NetworkPolicies]: "NetworkPolicy",
};

export const POLICY_RESOURCE_TYPES: ReadonlyArray<string> = Object.values(
  KubernetesPolicyResourceType,
);

export type AnyKubernetesPolicyObject = KubernetesPolicyObject<
  | KubernetesRoleSpec
  | KubernetesRoleBindingSpec
  | KubernetesServiceAccountSpec
  | KubernetesNetworkPolicySpec
>;

// The object a policy resource type's record holds, or null for another type.
export function parsePolicyObjectByResourceType(
  resourceType: string,
  objectKvList: JSONObject,
): AnyKubernetesPolicyObject | null {
  switch (resourceType.toLowerCase()) {
    case KubernetesPolicyResourceType.Roles:
    case KubernetesPolicyResourceType.ClusterRoles:
      return parseRoleObject(objectKvList);
    case KubernetesPolicyResourceType.RoleBindings:
    case KubernetesPolicyResourceType.ClusterRoleBindings:
      return parseRoleBindingObject(objectKvList);
    case KubernetesPolicyResourceType.ServiceAccounts:
      return parseServiceAccountObject(objectKvList);
    case KubernetesPolicyResourceType.NetworkPolicies:
      return parseNetworkPolicyObject(objectKvList);
    default:
      return null;
  }
}
