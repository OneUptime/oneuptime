import { KubernetesCondition } from "./KubernetesObjectParser";
import {
  OpenShiftClusterOperatorObject,
  OpenShiftClusterOperatorState,
  OpenShiftClusterVersionObject,
  OpenShiftClusterVersionState,
  OpenShiftClusterVersionUpdate,
  OpenShiftConditionStatus,
  OpenShiftOperandVersion,
  getClusterOperatorState,
  getClusterVersionState,
  getConditionStatus,
} from "Common/Types/Kubernetes/OpenShiftObjectParser";

/*
 * What an OpenShift cluster's overview says about its health, from its
 * ClusterOperators and its ClusterVersion (the openshift preset's snapshots).
 * On OpenShift these are the main signals: every part of the platform is an
 * operator, and a degraded one or a stuck update is what an admin looks for
 * first. Plain logic, free of React and of the API client, so App/Tests can
 * read it.
 */

export type KubernetesClusterHealth = "Healthy" | "Degraded" | "Unhealthy";

const HEALTH_ORDER: ReadonlyArray<KubernetesClusterHealth> = [
  "Healthy",
  "Degraded",
  "Unhealthy",
];

// The worse of two healths: what the cluster's hero says.
export function getWorseClusterHealth(
  first: KubernetesClusterHealth,
  second: KubernetesClusterHealth | undefined,
): KubernetesClusterHealth {
  if (!second) {
    return first;
  }

  return HEALTH_ORDER.indexOf(second) > HEALTH_ORDER.indexOf(first)
    ? second
    : first;
}

export interface OpenShiftOperatorHealth {
  name: string;
  state: OpenShiftClusterOperatorState;
  // Each condition's status - True, False, Unknown - or "" when not reported.
  available: string;
  progressing: string;
  degraded: string;
  version: string;
  // Why it is in this state, from the condition that put it there.
  reason: string;
  message: string;
  // When that condition last changed, as the operator wrote it.
  since: string;
}

export interface OpenShiftOperatorCounts {
  total: number;
  // Available and not Degraded, a rollout under way included.
  healthy: number;
  available: number;
  progressing: number;
  degraded: number;
  unavailable: number;
  unknown: number;
}

export interface OpenShiftClusterHealth {
  // What the cluster runs, and what it moves to; "" when not reported.
  version: string;
  desiredVersion: string;
  channel: string;
  updateState: OpenShiftClusterVersionState;
  // Why the update fails, or what it is doing.
  updateReason: string;
  updateMessage: string;
  // When the update under way started.
  updateStartedAt: string;
  availableUpdateCount: number;
  // The worst first, then by name.
  operators: Array<OpenShiftOperatorHealth>;
  // Those an admin should look at, the worst first.
  operatorsToReview: Array<OpenShiftOperatorHealth>;
  counts: OpenShiftOperatorCounts;
  health: KubernetesClusterHealth;
}

// Which operators come first.
const STATE_ORDER: ReadonlyArray<OpenShiftClusterOperatorState> = [
  OpenShiftClusterOperatorState.Unavailable,
  OpenShiftClusterOperatorState.Degraded,
  OpenShiftClusterOperatorState.Progressing,
  OpenShiftClusterOperatorState.Unknown,
  OpenShiftClusterOperatorState.Available,
];

function findCondition(
  conditions: ReadonlyArray<KubernetesCondition>,
  type: string,
): KubernetesCondition | undefined {
  return conditions.find((condition: KubernetesCondition): boolean => {
    return condition.type === type;
  });
}

/*
 * The condition that explains an operator's state: Available when it says it
 * is not, then Degraded when it says so, then Progressing when it rolls out.
 * The same order getClusterOperatorState reads them in.
 */
function explainingCondition(
  conditions: ReadonlyArray<KubernetesCondition>,
): KubernetesCondition | undefined {
  const candidates: Array<[string, OpenShiftConditionStatus]> = [
    ["Available", OpenShiftConditionStatus.False],
    ["Degraded", OpenShiftConditionStatus.True],
    ["Progressing", OpenShiftConditionStatus.True],
  ];

  for (const [type, status] of candidates) {
    const condition: KubernetesCondition | undefined = findCondition(
      conditions,
      type,
    );

    if (condition && condition.status === status) {
      return condition;
    }
  }

  return undefined;
}

export function getOpenShiftOperatorHealth(
  operator: Pick<OpenShiftClusterOperatorObject, "metadata" | "status">,
): OpenShiftOperatorHealth {
  const conditions: Array<KubernetesCondition> =
    operator.status.conditions || [];
  const explaining: KubernetesCondition | undefined =
    explainingCondition(conditions);

  return {
    name: operator.metadata.name,
    state: getClusterOperatorState(conditions),
    available: getConditionStatus(conditions, "Available"),
    progressing: getConditionStatus(conditions, "Progressing"),
    degraded: getConditionStatus(conditions, "Degraded"),
    version:
      (operator.status.versions || []).find(
        (version: OpenShiftOperandVersion): boolean => {
          return version.name === "operator";
        },
      )?.version || "",
    reason: explaining?.reason || "",
    message: explaining?.message || "",
    since: explaining?.lastTransitionTime || "",
  };
}

function compareOperators(
  first: OpenShiftOperatorHealth,
  second: OpenShiftOperatorHealth,
): number {
  return (
    STATE_ORDER.indexOf(first.state) - STATE_ORDER.indexOf(second.state) ||
    first.name.localeCompare(second.name)
  );
}

function countOperators(
  operators: ReadonlyArray<OpenShiftOperatorHealth>,
): OpenShiftOperatorCounts {
  const countIn: (state: OpenShiftClusterOperatorState) => number = (
    state: OpenShiftClusterOperatorState,
  ): number => {
    return operators.filter((operator: OpenShiftOperatorHealth): boolean => {
      return operator.state === state;
    }).length;
  };

  return {
    total: operators.length,
    healthy: operators.filter((operator: OpenShiftOperatorHealth): boolean => {
      return (
        operator.available === OpenShiftConditionStatus.True &&
        operator.degraded !== OpenShiftConditionStatus.True
      );
    }).length,
    available: countIn(OpenShiftClusterOperatorState.Available),
    progressing: countIn(OpenShiftClusterOperatorState.Progressing),
    degraded: countIn(OpenShiftClusterOperatorState.Degraded),
    unavailable: countIn(OpenShiftClusterOperatorState.Unavailable),
    unknown: countIn(OpenShiftClusterOperatorState.Unknown),
  };
}

/*
 * An unavailable operator is part of the platform down, as a NotReady node
 * is, so the cluster is Unhealthy. A degraded operator or a failing update
 * still serve: the cluster is Degraded. An update under way is neither.
 */
function getHealth(data: {
  counts: OpenShiftOperatorCounts;
  updateState: OpenShiftClusterVersionState;
}): KubernetesClusterHealth {
  if (data.counts.unavailable > 0) {
    return "Unhealthy";
  }

  if (
    data.counts.degraded > 0 ||
    data.updateState === OpenShiftClusterVersionState.Failing
  ) {
    return "Degraded";
  }

  return "Healthy";
}

/*
 * The cluster's health, or null when it has no ClusterOperators to read: not
 * OpenShift, or an agent that does not send them.
 */
export function getOpenShiftClusterHealth(data: {
  operators: ReadonlyArray<
    Pick<OpenShiftClusterOperatorObject, "metadata" | "status">
  >;
  clusterVersion?:
    | Pick<OpenShiftClusterVersionObject, "spec" | "status">
    | undefined;
}): OpenShiftClusterHealth | null {
  if (data.operators.length === 0) {
    return null;
  }

  const operators: Array<OpenShiftOperatorHealth> = data.operators
    .map(getOpenShiftOperatorHealth)
    .sort(compareOperators);

  const counts: OpenShiftOperatorCounts = countOperators(operators);

  const status: OpenShiftClusterVersionObject["status"] | undefined =
    data.clusterVersion?.status;
  const conditions: Array<KubernetesCondition> = status?.conditions || [];
  const updateState: OpenShiftClusterVersionState =
    getClusterVersionState(conditions);

  const updateCondition: KubernetesCondition | undefined = findCondition(
    conditions,
    updateState === OpenShiftClusterVersionState.Failing
      ? "Failing"
      : "Progressing",
  );

  const latestUpdate: OpenShiftClusterVersionUpdate | undefined =
    status?.history?.[0];

  return {
    version: status?.currentVersion || "",
    desiredVersion: status?.desiredVersion || "",
    channel: data.clusterVersion?.spec?.channel || "",
    updateState,
    updateReason:
      updateState === OpenShiftClusterVersionState.Failing
        ? updateCondition?.reason || ""
        : "",
    updateMessage:
      updateState === OpenShiftClusterVersionState.Failing ||
      updateState === OpenShiftClusterVersionState.Updating
        ? updateCondition?.message || ""
        : "",
    updateStartedAt:
      updateState === OpenShiftClusterVersionState.Updating
        ? latestUpdate?.startedTime || ""
        : "",
    availableUpdateCount: status?.availableUpdateCount || 0,
    operators,
    operatorsToReview: operators.filter(
      (operator: OpenShiftOperatorHealth): boolean => {
        return operator.state !== OpenShiftClusterOperatorState.Available;
      },
    ),
    counts,
    health: getHealth({ counts, updateState }),
  };
}
