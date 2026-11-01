import { JSONObject } from "../JSON";
import {
  KubernetesCondition,
  KubernetesObjectMetadata,
  getArrayValues,
  getKvListAsRecord,
  getKvStringValue,
  getKvValue,
  parseConditions,
  parseMetadata,
} from "./KubernetesObjectParser";

/*
 * ------------------------------------------------------------------
 * OpenShift's own objects, as the kubernetes-agent chart's openshift
 * preset pulls them (k8sobjects/openshift): Routes, DeploymentConfigs,
 * and the cluster's ClusterOperators and ClusterVersion.
 *
 * Like KubernetesObjectParser, each parser reads the OTLP kvlist the
 * k8sobjects receiver sends and keeps a projection: what the Kubernetes
 * pages show and alert on, never the raw object. A Route's TLS key and
 * certificates are never read - spec.tls is reduced to how the route
 * terminates TLS - so they cannot reach inventory even when a collector
 * did not strip them (the chart strips the key before it leaves the
 * cluster).
 *
 * The state functions are pure, shared by ingest (inventory phase, and
 * the attributes alert templates filter on) and the Dashboard.
 * ------------------------------------------------------------------
 */

// The plural resource names the chart pulls them under (k8s.resource.name).
export enum OpenShiftResourceType {
  Routes = "routes",
  DeploymentConfigs = "deploymentconfigs",
  ClusterOperators = "clusteroperators",
  ClusterVersions = "clusterversions",
}

// Their API groups, which the chart's k8sobjects/openshift receiver names.
export const OPENSHIFT_RESOURCE_GROUPS: Readonly<
  Record<OpenShiftResourceType, string>
> = {
  [OpenShiftResourceType.Routes]: "route.openshift.io",
  [OpenShiftResourceType.DeploymentConfigs]: "apps.openshift.io",
  [OpenShiftResourceType.ClusterOperators]: "config.openshift.io",
  [OpenShiftResourceType.ClusterVersions]: "config.openshift.io",
};

// The Kinds they are stored and shown under.
export enum OpenShiftKind {
  Route = "Route",
  DeploymentConfig = "DeploymentConfig",
  ClusterOperator = "ClusterOperator",
  ClusterVersion = "ClusterVersion",
}

export const OPENSHIFT_KIND_BY_RESOURCE_TYPE: Readonly<
  Record<OpenShiftResourceType, OpenShiftKind>
> = {
  [OpenShiftResourceType.Routes]: OpenShiftKind.Route,
  [OpenShiftResourceType.DeploymentConfigs]: OpenShiftKind.DeploymentConfig,
  [OpenShiftResourceType.ClusterOperators]: OpenShiftKind.ClusterOperator,
  [OpenShiftResourceType.ClusterVersions]: OpenShiftKind.ClusterVersion,
};

// A condition's status, as Kubernetes writes it.
export enum OpenShiftConditionStatus {
  True = "True",
  False = "False",
  Unknown = "Unknown",
}

export interface OpenShiftRouteBackend {
  kind: string;
  name: string;
  weight: number | null;
}

export interface OpenShiftRouteIngress {
  host: string;
  routerName: string;
  routerCanonicalHostname: string;
  conditions: Array<KubernetesCondition>;
}

export interface OpenShiftRouteObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    host: string;
    path: string;
    to: OpenShiftRouteBackend;
    alternateBackends: Array<OpenShiftRouteBackend>;
    // spec.port.targetPort: a port name or number, as written.
    targetPort: string;
    // spec.tls.termination: edge, passthrough, reencrypt, or "" (plain HTTP).
    tlsTermination: string;
    // spec.tls.insecureEdgeTerminationPolicy: Allow, Redirect, None or "".
    insecureEdgeTerminationPolicy: string;
    wildcardPolicy: string;
  };
  status: {
    ingress: Array<OpenShiftRouteIngress>;
  };
}

export interface OpenShiftDeploymentConfigObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    replicas: number;
    // spec.strategy.type: Rolling, Recreate or Custom.
    strategy: string;
    // A DeploymentConfig's selector is a plain label map, not matchLabels.
    selector: Record<string, string>;
    // spec.triggers[].type: ConfigChange, ImageChange.
    triggers: Array<string>;
    paused: boolean;
  };
  status: {
    latestVersion: number;
    replicas: number;
    readyReplicas: number;
    availableReplicas: number;
    unavailableReplicas: number;
    updatedReplicas: number;
    conditions: Array<KubernetesCondition>;
  };
}

export interface OpenShiftOperandVersion {
  name: string;
  version: string;
}

export interface OpenShiftClusterOperatorObject {
  metadata: KubernetesObjectMetadata;
  status: {
    conditions: Array<KubernetesCondition>;
    versions: Array<OpenShiftOperandVersion>;
  };
}

export interface OpenShiftClusterVersionUpdate {
  version: string;
  // Completed or Partial.
  state: string;
  startedTime: string;
  completionTime: string;
}

export interface OpenShiftClusterVersionObject {
  metadata: KubernetesObjectMetadata;
  spec: {
    channel: string;
    clusterID: string;
    // spec.desiredUpdate.version: what an admin asked to move to, if any.
    desiredUpdate: string;
  };
  status: {
    // status.desired.version: what the cluster is moving to or runs.
    desiredVersion: string;
    // The newest Completed update in status.history: what it runs.
    currentVersion: string;
    // status.history, newest first, at most MAX_CLUSTER_VERSION_HISTORY.
    history: Array<OpenShiftClusterVersionUpdate>;
    conditions: Array<KubernetesCondition>;
    availableUpdateCount: number;
  };
}

// How much of a ClusterVersion's update history is kept: the latest few.
export const MAX_CLUSTER_VERSION_HISTORY: number = 10;

function kvObject(
  kvList: JSONObject | undefined,
  key: string,
): JSONObject | undefined {
  const value: string | JSONObject | null = getKvValue(kvList, key);
  return value && typeof value !== "string" ? value : undefined;
}

function kvArray(
  kvList: JSONObject | undefined,
  key: string,
): Array<JSONObject> {
  const value: JSONObject | undefined = kvObject(kvList, key);
  return value ? getArrayValues(value) : [];
}

function kvInteger(kvList: JSONObject | undefined, key: string): number {
  return parseInt(getKvStringValue(kvList, key)) || 0;
}

function kvBoolean(kvList: JSONObject | undefined, key: string): boolean {
  return getKvStringValue(kvList, key) === "true";
}

function readMetadata(
  objectKvList: JSONObject,
): KubernetesObjectMetadata | null {
  const metadataKv: JSONObject | undefined = kvObject(objectKvList, "metadata");
  return metadataKv ? parseMetadata(metadataKv) : null;
}

function readConditions(
  statusKv: JSONObject | undefined,
): Array<KubernetesCondition> {
  const conditions: string | JSONObject | null = getKvValue(
    statusKv,
    "conditions",
  );
  return parseConditions(
    conditions && typeof conditions !== "string" ? conditions : null,
  );
}

function readBackend(kvList: JSONObject | undefined): OpenShiftRouteBackend {
  const weight: string = getKvStringValue(kvList, "weight");
  return {
    kind: getKvStringValue(kvList, "kind"),
    name: getKvStringValue(kvList, "name"),
    weight: weight === "" ? null : parseInt(weight) || 0,
  };
}

export function parseRouteObject(
  objectKvList: JSONObject,
): OpenShiftRouteObject | null {
  try {
    const metadata: KubernetesObjectMetadata | null =
      readMetadata(objectKvList);
    if (!metadata) {
      return null;
    }

    const specKv: JSONObject | undefined = kvObject(objectKvList, "spec");
    const statusKv: JSONObject | undefined = kvObject(objectKvList, "status");
    // How the route terminates TLS, and nothing else of spec.tls.
    const tlsKv: JSONObject | undefined = kvObject(specKv, "tls");
    const portKv: JSONObject | undefined = kvObject(specKv, "port");

    return {
      metadata: metadata,
      spec: {
        host: getKvStringValue(specKv, "host"),
        path: getKvStringValue(specKv, "path"),
        to: readBackend(kvObject(specKv, "to")),
        alternateBackends: kvArray(specKv, "alternateBackends").map(
          (backendKv: JSONObject): OpenShiftRouteBackend => {
            return readBackend(backendKv);
          },
        ),
        targetPort: getKvStringValue(portKv, "targetPort"),
        tlsTermination: getKvStringValue(tlsKv, "termination"),
        insecureEdgeTerminationPolicy: getKvStringValue(
          tlsKv,
          "insecureEdgeTerminationPolicy",
        ),
        wildcardPolicy: getKvStringValue(specKv, "wildcardPolicy"),
      },
      status: {
        ingress: kvArray(statusKv, "ingress").map(
          (ingressKv: JSONObject): OpenShiftRouteIngress => {
            return {
              host: getKvStringValue(ingressKv, "host"),
              routerName: getKvStringValue(ingressKv, "routerName"),
              routerCanonicalHostname: getKvStringValue(
                ingressKv,
                "routerCanonicalHostname",
              ),
              conditions: readConditions(ingressKv),
            };
          },
        ),
      },
    };
  } catch {
    return null;
  }
}

export function parseDeploymentConfigObject(
  objectKvList: JSONObject,
): OpenShiftDeploymentConfigObject | null {
  try {
    const metadata: KubernetesObjectMetadata | null =
      readMetadata(objectKvList);
    if (!metadata) {
      return null;
    }

    const specKv: JSONObject | undefined = kvObject(objectKvList, "spec");
    const statusKv: JSONObject | undefined = kvObject(objectKvList, "status");
    const selectorKv: JSONObject | undefined = kvObject(specKv, "selector");

    return {
      metadata: metadata,
      spec: {
        replicas: kvInteger(specKv, "replicas"),
        strategy: getKvStringValue(kvObject(specKv, "strategy"), "type"),
        selector: selectorKv ? getKvListAsRecord(selectorKv) : {},
        triggers: kvArray(specKv, "triggers")
          .map((triggerKv: JSONObject): string => {
            return getKvStringValue(triggerKv, "type");
          })
          .filter((type: string): boolean => {
            return type.length > 0;
          }),
        paused: kvBoolean(specKv, "paused"),
      },
      status: {
        latestVersion: kvInteger(statusKv, "latestVersion"),
        replicas: kvInteger(statusKv, "replicas"),
        readyReplicas: kvInteger(statusKv, "readyReplicas"),
        availableReplicas: kvInteger(statusKv, "availableReplicas"),
        unavailableReplicas: kvInteger(statusKv, "unavailableReplicas"),
        updatedReplicas: kvInteger(statusKv, "updatedReplicas"),
        conditions: readConditions(statusKv),
      },
    };
  } catch {
    return null;
  }
}

export function parseClusterOperatorObject(
  objectKvList: JSONObject,
): OpenShiftClusterOperatorObject | null {
  try {
    const metadata: KubernetesObjectMetadata | null =
      readMetadata(objectKvList);
    if (!metadata) {
      return null;
    }

    const statusKv: JSONObject | undefined = kvObject(objectKvList, "status");

    return {
      metadata: metadata,
      status: {
        conditions: readConditions(statusKv),
        versions: kvArray(statusKv, "versions").map(
          (versionKv: JSONObject): OpenShiftOperandVersion => {
            return {
              name: getKvStringValue(versionKv, "name"),
              version: getKvStringValue(versionKv, "version"),
            };
          },
        ),
      },
    };
  } catch {
    return null;
  }
}

export function parseClusterVersionObject(
  objectKvList: JSONObject,
): OpenShiftClusterVersionObject | null {
  try {
    const metadata: KubernetesObjectMetadata | null =
      readMetadata(objectKvList);
    if (!metadata) {
      return null;
    }

    const specKv: JSONObject | undefined = kvObject(objectKvList, "spec");
    const statusKv: JSONObject | undefined = kvObject(objectKvList, "status");

    // status.history is newest first, as the cluster-version operator writes it.
    const history: Array<OpenShiftClusterVersionUpdate> = kvArray(
      statusKv,
      "history",
    )
      .map((updateKv: JSONObject): OpenShiftClusterVersionUpdate => {
        return {
          version: getKvStringValue(updateKv, "version"),
          state: getKvStringValue(updateKv, "state"),
          startedTime: getKvStringValue(updateKv, "startedTime"),
          completionTime: getKvStringValue(updateKv, "completionTime"),
        };
      })
      .filter((update: OpenShiftClusterVersionUpdate): boolean => {
        return update.version.length > 0;
      });

    const desiredVersion: string = getKvStringValue(
      kvObject(statusKv, "desired"),
      "version",
    );

    const completed: OpenShiftClusterVersionUpdate | undefined = history.find(
      (update: OpenShiftClusterVersionUpdate): boolean => {
        return update.state === "Completed";
      },
    );

    return {
      metadata: metadata,
      spec: {
        channel: getKvStringValue(specKv, "channel"),
        clusterID: getKvStringValue(specKv, "clusterID"),
        desiredUpdate: getKvStringValue(
          kvObject(specKv, "desiredUpdate"),
          "version",
        ),
      },
      status: {
        desiredVersion: desiredVersion,
        currentVersion: completed ? completed.version : "",
        history: history.slice(0, MAX_CLUSTER_VERSION_HISTORY),
        conditions: readConditions(statusKv),
        availableUpdateCount: kvArray(statusKv, "availableUpdates").length,
      },
    };
  } catch {
    return null;
  }
}

/*
 * ------------------------------------------------------------------
 * State: one word per object, for the inventory's phase column, the
 * Dashboard's status, and the attributes alert templates filter on.
 * ------------------------------------------------------------------
 */

// A condition's status by type, or "" when the object does not report it.
export function getConditionStatus(
  conditions: ReadonlyArray<KubernetesCondition>,
  type: string,
): string {
  const condition: KubernetesCondition | undefined = conditions.find(
    (candidate: KubernetesCondition): boolean => {
      return candidate.type === type;
    },
  );
  return condition ? condition.status : "";
}

export enum OpenShiftClusterOperatorState {
  Available = "Available",
  Progressing = "Progressing",
  Degraded = "Degraded",
  Unavailable = "Unavailable",
  Unknown = "Unknown",
}

/*
 * An operator is Unavailable when it says it is not available, whatever else
 * it says: an operator that is down nearly always says Degraded too, and down
 * is the worse of the two. Then Degraded when it says so; then Progressing
 * while it rolls out; otherwise Available when it says so.
 */
export function getClusterOperatorState(
  conditions: ReadonlyArray<KubernetesCondition>,
): OpenShiftClusterOperatorState {
  if (
    getConditionStatus(conditions, "Available") ===
    OpenShiftConditionStatus.False
  ) {
    return OpenShiftClusterOperatorState.Unavailable;
  }
  if (
    getConditionStatus(conditions, "Degraded") === OpenShiftConditionStatus.True
  ) {
    return OpenShiftClusterOperatorState.Degraded;
  }
  if (
    getConditionStatus(conditions, "Progressing") ===
    OpenShiftConditionStatus.True
  ) {
    return OpenShiftClusterOperatorState.Progressing;
  }
  if (
    getConditionStatus(conditions, "Available") ===
    OpenShiftConditionStatus.True
  ) {
    return OpenShiftClusterOperatorState.Available;
  }
  return OpenShiftClusterOperatorState.Unknown;
}

export enum OpenShiftClusterVersionState {
  Available = "Available",
  Updating = "Updating",
  Failing = "Failing",
  Unknown = "Unknown",
}

/*
 * A cluster's version is Failing when the cluster-version operator says it
 * cannot reconcile or update (Failing=True), whatever else it says; then
 * Updating while it moves to a new version (Progressing=True); otherwise
 * Available when it says so.
 */
export function getClusterVersionState(
  conditions: ReadonlyArray<KubernetesCondition>,
): OpenShiftClusterVersionState {
  if (
    getConditionStatus(conditions, "Failing") === OpenShiftConditionStatus.True
  ) {
    return OpenShiftClusterVersionState.Failing;
  }
  if (
    getConditionStatus(conditions, "Progressing") ===
    OpenShiftConditionStatus.True
  ) {
    return OpenShiftClusterVersionState.Updating;
  }
  if (
    getConditionStatus(conditions, "Available") ===
    OpenShiftConditionStatus.True
  ) {
    return OpenShiftClusterVersionState.Available;
  }
  return OpenShiftClusterVersionState.Unknown;
}

export enum OpenShiftRouteState {
  Admitted = "Admitted",
  Rejected = "Rejected",
  Pending = "Pending",
}

/*
 * A route is Admitted when a router admitted it; Rejected when the routers
 * that answered all turned it down (a host another route claims, say); and
 * Pending until one answers.
 */
export function getRouteState(
  ingress: ReadonlyArray<OpenShiftRouteIngress>,
): OpenShiftRouteState {
  const answers: Array<string> = ingress.map(
    (router: OpenShiftRouteIngress): string => {
      return getConditionStatus(router.conditions, "Admitted");
    },
  );

  if (answers.includes(OpenShiftConditionStatus.True)) {
    return OpenShiftRouteState.Admitted;
  }
  if (answers.includes(OpenShiftConditionStatus.False)) {
    return OpenShiftRouteState.Rejected;
  }
  return OpenShiftRouteState.Pending;
}

export enum OpenShiftDeploymentConfigState {
  Available = "Available",
  Progressing = "Progressing",
  Unavailable = "Unavailable",
  ScaledToZero = "Scaled to zero",
  Paused = "Paused",
}

/*
 * As a Deployment reads: Paused when paused; Scaled to zero with no
 * replicas wanted; Available when every wanted replica is available;
 * Progressing while a rollout is under way (some available); otherwise
 * Unavailable.
 */
export function getDeploymentConfigState(
  deploymentConfig: Pick<OpenShiftDeploymentConfigObject, "spec" | "status">,
): OpenShiftDeploymentConfigState {
  if (deploymentConfig.spec.paused) {
    return OpenShiftDeploymentConfigState.Paused;
  }
  if (deploymentConfig.spec.replicas === 0) {
    return OpenShiftDeploymentConfigState.ScaledToZero;
  }
  if (
    deploymentConfig.status.availableReplicas >= deploymentConfig.spec.replicas
  ) {
    return OpenShiftDeploymentConfigState.Available;
  }
  if (deploymentConfig.status.availableReplicas > 0) {
    return OpenShiftDeploymentConfigState.Progressing;
  }
  return OpenShiftDeploymentConfigState.Unavailable;
}

export type AnyOpenShiftObject =
  | OpenShiftRouteObject
  | OpenShiftDeploymentConfigObject
  | OpenShiftClusterOperatorObject
  | OpenShiftClusterVersionObject;

// The parser for an OpenShift resource type, or null for any other type.
export function parseOpenShiftObject(
  resourceType: string,
  objectKvList: JSONObject,
): AnyOpenShiftObject | null {
  switch (resourceType.trim().toLowerCase()) {
    case OpenShiftResourceType.Routes:
      return parseRouteObject(objectKvList);
    case OpenShiftResourceType.DeploymentConfigs:
      return parseDeploymentConfigObject(objectKvList);
    case OpenShiftResourceType.ClusterOperators:
      return parseClusterOperatorObject(objectKvList);
    case OpenShiftResourceType.ClusterVersions:
      return parseClusterVersionObject(objectKvList);
    default:
      return null;
  }
}

/*
 * What an OpenShift object's inventory row stores in its hot columns: its
 * state as the phase, and whether that state is healthy as isReady, so the
 * pages can list and count unhealthy ones without reading spec or status.
 * Healthy is: an operator Available and not Degraded; the cluster's version
 * Available and not Failing (an update under way is healthy); a route
 * admitted; a DeploymentConfig with every wanted replica available, none
 * wanted included. Null for any other kind.
 */
export function getOpenShiftInventoryState(
  kind: string,
  object: AnyOpenShiftObject,
): { phase: string; isReady: boolean } | null {
  switch (kind) {
    case OpenShiftKind.ClusterOperator: {
      const conditions: Array<KubernetesCondition> = (
        object as OpenShiftClusterOperatorObject
      ).status.conditions;
      return {
        phase: getClusterOperatorState(conditions),
        isReady:
          getConditionStatus(conditions, "Available") ===
            OpenShiftConditionStatus.True &&
          getConditionStatus(conditions, "Degraded") !==
            OpenShiftConditionStatus.True,
      };
    }
    case OpenShiftKind.ClusterVersion: {
      const conditions: Array<KubernetesCondition> = (
        object as OpenShiftClusterVersionObject
      ).status.conditions;
      return {
        phase: getClusterVersionState(conditions),
        isReady:
          getConditionStatus(conditions, "Available") ===
            OpenShiftConditionStatus.True &&
          getConditionStatus(conditions, "Failing") !==
            OpenShiftConditionStatus.True,
      };
    }
    case OpenShiftKind.Route: {
      const state: OpenShiftRouteState = getRouteState(
        (object as OpenShiftRouteObject).status.ingress,
      );
      return { phase: state, isReady: state === OpenShiftRouteState.Admitted };
    }
    case OpenShiftKind.DeploymentConfig: {
      const state: OpenShiftDeploymentConfigState = getDeploymentConfigState(
        object as OpenShiftDeploymentConfigObject,
      );
      return {
        phase: state,
        isReady:
          state === OpenShiftDeploymentConfigState.Available ||
          state === OpenShiftDeploymentConfigState.ScaledToZero,
      };
    }
    default:
      return null;
  }
}
