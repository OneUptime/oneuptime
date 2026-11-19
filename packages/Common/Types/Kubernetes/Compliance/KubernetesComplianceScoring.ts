import { ComplianceRequirementStatus } from "../../DataSecurity/ComplianceRequirementCatalog";
import {
  CIS_SCORED_CONTROLS,
  CisEvaluation,
  checkCisPodControl,
  evaluateCisClusterControl,
} from "./CisKubernetesBenchmark";
import {
  ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS,
  KUBERNETES_COMPLIANCE_FRAMEWORK_INFO,
  KubernetesComplianceControlInfo,
  KubernetesComplianceFramework,
  getKubernetesComplianceControls,
} from "./KubernetesComplianceCatalog";
import {
  KubernetesComplianceDetail,
  KubernetesComplianceFinding,
  KubernetesComplianceObject,
  getComplianceDetailKey,
  getComplianceObjectKey,
} from "./KubernetesComplianceFinding";
import {
  KubernetesCompliancePod,
  KubernetesComplianceSnapshot,
} from "./KubernetesComplianceSnapshot";
import {
  PodSecurityControl,
  PodSecurityLevel,
  checkPodSecurityControl,
  getPodSecurityControls,
} from "./PodSecurityStandards";
import { PodSecurity } from "../KubernetesPodSecurity";

/*
 * HOW A CLUSTER STANDS AGAINST EACH KUBERNETES FRAMEWORK (#9627).
 *
 * Each control of the Pod Security Standards' Baseline and Restricted
 * policies and of the CIS Kubernetes Benchmark's scored policy controls is
 * evaluated over what the cluster runs and holds (KubernetesComplianceSnapshot):
 *
 *   - A pod control reads every pod, and says what fails by the workload the
 *     pod belongs to - the Deployment, StatefulSet, DaemonSet, Job, CronJob
 *     or DeploymentConfig whose page a person opens, or the pod itself when
 *     nothing owns it - with how many of its pods fail and why.
 *   - An RBAC, service account, namespace or network policy control says
 *     what fails by the binding, role, service account or namespace.
 *
 * A control passes when nothing fails it, fails when something does, and is
 * not evaluated when the cluster has not told what it needs: no pod read yet
 * (pods stored before their security fields were kept are read again within
 * the agent's next pull), or no RBAC from an agent that does not send it.
 * A framework's score is the share of its evaluated controls that pass, as
 * every compliance framework's is (ComplianceRequirementCatalog).
 *
 * What a person turned off applies here as on every Compliance page
 * (DataSecurityComplianceSetting), and can also name a namespace:
 *
 *   - a framework turned off for the cluster reads as turned off;
 *   - a control turned off for the cluster reads "Turned off" and counts
 *     neither way;
 *   - a framework turned off for a namespace - as Pod Security Admission
 *     exempts a namespace - leaves everything of that namespace out of it;
 *   - a control turned off for a namespace leaves that namespace out of it.
 *
 * Pure: the server scores with it, and its tests pin it.
 */

// The most objects one control's answer lists; how many fail is still counted.
export const MAX_FINDINGS_PER_CONTROL: number = 200;

// The most details one object of a control keeps.
const MAX_DETAILS_PER_FINDING: number = 25;

export enum KubernetesComplianceNotEvaluatedReason {
  // The agent has reported no pod of the cluster.
  NoPods = "NoPods",
  // Every namespace that runs pods is turned off for the framework.
  NoPodsInScope = "NoPodsInScope",
  // Its pods were stored before their security fields were kept: read again at the next pull.
  PodsNotRead = "PodsNotRead",
  // The agent does not send RBAC, service accounts and network policies.
  PolicyObjectsNotRead = "PolicyObjectsNotRead",
}

// A compliance setting, as the scoring reads one: oldest first, the last wins.
export interface KubernetesComplianceSetting {
  framework: KubernetesComplianceFramework;
  // A control of the framework; "" for the whole framework.
  requirement: string;
  // A namespace of the cluster; "" for the whole cluster.
  namespace: string;
  isEnabled: boolean;
}

export interface KubernetesComplianceRequirementResult {
  requirement: string;
  title: string;
  status: ComplianceRequirementStatus;
  notEvaluatedReason?: KubernetesComplianceNotEvaluatedReason | undefined;
  // How many objects fail it, with what is turned off left out.
  failingCount: number;
  // The objects that fail it, at most MAX_FINDINGS_PER_CONTROL.
  findings: Array<KubernetesComplianceFinding>;
  // The namespaces it is turned off for.
  turnedOffNamespaces: Array<string>;
}

export interface KubernetesComplianceFrameworkResult {
  framework: KubernetesComplianceFramework;
  fullName: string;
  scope: string;
  // 0 to 100, or null when nothing could be evaluated.
  score: number | null;
  // Turned off for the whole cluster.
  isTurnedOff: boolean;
  // Controls turned off for the whole cluster.
  turnedOffRequirements: Array<string>;
  // Namespaces the whole framework is turned off for.
  turnedOffNamespaces: Array<string>;
  // Workloads whose pods were read, outside the namespaces turned off.
  workloadsEvaluated: number;
  // Of those, the ones no pod control fails.
  workloadsPassing: number;
  // Pods stored before their security fields were kept, read at the next pull.
  podsNotRead: number;
  // Failing objects by namespace, to say which namespaces hold what fails.
  failingByNamespace: Record<string, number>;
  requirements: Array<KubernetesComplianceRequirementResult>;
}

interface Exclusions {
  isTurnedOff: boolean;
  turnedOffRequirements: Set<string>;
  turnedOffNamespaces: Set<string>;
  // Control -> the namespaces it is turned off for.
  requirementNamespaces: Map<string, Set<string>>;
}

function getSettingKey(setting: KubernetesComplianceSetting): string {
  return [
    setting.framework,
    setting.requirement.trim(),
    setting.namespace.trim(),
  ].join("|");
}

// What one framework's settings turn off, the last setting for each thing winning.
export function getKubernetesComplianceExclusions(
  framework: KubernetesComplianceFramework,
  settings: ReadonlyArray<KubernetesComplianceSetting>,
): Exclusions {
  const effective: Map<string, KubernetesComplianceSetting> = new Map();

  for (const setting of settings) {
    if (setting.framework === framework) {
      effective.set(getSettingKey(setting), setting);
    }
  }

  const exclusions: Exclusions = {
    isTurnedOff: false,
    turnedOffRequirements: new Set<string>(),
    turnedOffNamespaces: new Set<string>(),
    requirementNamespaces: new Map<string, Set<string>>(),
  };

  for (const setting of effective.values()) {
    if (setting.isEnabled) {
      continue;
    }

    const requirement: string = setting.requirement.trim();
    const namespace: string = setting.namespace.trim();

    if (!requirement && !namespace) {
      exclusions.isTurnedOff = true;
    } else if (!namespace) {
      exclusions.turnedOffRequirements.add(requirement);
    } else if (!requirement) {
      exclusions.turnedOffNamespaces.add(namespace);
    } else {
      const namespaces: Set<string> =
        exclusions.requirementNamespaces.get(requirement) || new Set<string>();
      namespaces.add(namespace);
      exclusions.requirementNamespaces.set(requirement, namespaces);
    }
  }

  return exclusions;
}

function isLeftOut(
  exclusions: Exclusions,
  requirement: string,
  namespace: string,
): boolean {
  return (
    Boolean(namespace) &&
    (exclusions.turnedOffNamespaces.has(namespace) ||
      Boolean(
        exclusions.requirementNamespaces.get(requirement)?.has(namespace),
      ))
  );
}

// The Pod Security Standards level a framework is, or null for the CIS benchmark.
function getPodSecurityLevel(
  framework: KubernetesComplianceFramework,
): PodSecurityLevel | null {
  if (framework === KubernetesComplianceFramework.PssBaseline) {
    return PodSecurityLevel.Baseline;
  }

  if (framework === KubernetesComplianceFramework.PssRestricted) {
    return PodSecurityLevel.Restricted;
  }

  return null;
}

// The controls a framework is scored on, at the cluster's version.
function getScoredControls(
  framework: KubernetesComplianceFramework,
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceControlInfo> {
  const level: PodSecurityLevel | null = getPodSecurityLevel(framework);
  const controls: Array<KubernetesComplianceControlInfo> =
    getKubernetesComplianceControls(framework);

  if (!level) {
    return controls;
  }

  const atVersion: Array<PodSecurityControl> = getPodSecurityControls(
    level,
    snapshot.version,
  );

  return controls.filter(
    (control: KubernetesComplianceControlInfo): boolean => {
      return atVersion.includes(control.requirement as PodSecurityControl);
    },
  );
}

function isPodControl(
  framework: KubernetesComplianceFramework,
  requirement: string,
): boolean {
  return (
    getPodSecurityLevel(framework) !== null ||
    CIS_SCORED_CONTROLS[requirement] === CisEvaluation.Pods
  );
}

// What a pod fails a pod control by.
function checkPod(
  framework: KubernetesComplianceFramework,
  requirement: string,
  pod: KubernetesCompliancePod,
  security: PodSecurity,
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceDetail> {
  const level: PodSecurityLevel | null = getPodSecurityLevel(framework);

  if (level) {
    return checkPodSecurityControl(
      requirement as PodSecurityControl,
      security,
      { level, version: snapshot.version },
    );
  }

  return checkCisPodControl(requirement, security, {
    namespace: pod.namespace,
    version: snapshot.version,
  });
}

interface WorkloadFinding {
  object: KubernetesComplianceObject;
  details: Map<string, KubernetesComplianceDetail>;
  podCount: number;
}

// The pods' failures of one control, one finding per workload.
function getPodControlFindings(
  framework: KubernetesComplianceFramework,
  requirement: string,
  pods: ReadonlyArray<KubernetesCompliancePod>,
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceFinding> {
  const byWorkload: Map<string, WorkloadFinding> = new Map();

  for (const pod of pods) {
    if (!pod.security) {
      continue;
    }

    const details: Array<KubernetesComplianceDetail> = checkPod(
      framework,
      requirement,
      pod,
      pod.security,
      snapshot,
    );

    if (details.length === 0) {
      continue;
    }

    const key: string = getComplianceObjectKey(pod.workload);
    const finding: WorkloadFinding = byWorkload.get(key) || {
      object: pod.workload,
      details: new Map<string, KubernetesComplianceDetail>(),
      podCount: 0,
    };

    finding.podCount += 1;

    for (const detail of details) {
      if (finding.details.size < MAX_DETAILS_PER_FINDING) {
        finding.details.set(getComplianceDetailKey(detail), detail);
      }
    }

    byWorkload.set(key, finding);
  }

  return Array.from(byWorkload.values()).map(
    (finding: WorkloadFinding): KubernetesComplianceFinding => {
      return {
        object: finding.object,
        details: Array.from(finding.details.values()),
        podCount: finding.podCount,
      };
    },
  );
}

function compareFindings(
  a: KubernetesComplianceFinding,
  b: KubernetesComplianceFinding,
): number {
  return (
    a.object.namespace.localeCompare(b.object.namespace) ||
    a.object.kind.localeCompare(b.object.kind) ||
    a.object.name.localeCompare(b.object.name)
  );
}

// The pods a framework covers, and how many of them were read.
interface PodCounts {
  all: number;
  inScope: number;
  read: number;
}

function getNotEvaluatedReason(
  framework: KubernetesComplianceFramework,
  requirement: string,
  snapshot: KubernetesComplianceSnapshot,
  pods: PodCounts,
): KubernetesComplianceNotEvaluatedReason | null {
  const evaluation: CisEvaluation | undefined =
    getPodSecurityLevel(framework) !== null
      ? CisEvaluation.Pods
      : CIS_SCORED_CONTROLS[requirement];
  // What there is to look at: the pods, or for 5.3.2 the namespaces they run in.
  const needsPods: boolean =
    evaluation !== CisEvaluation.PolicyObjects || requirement === "5.3.2";

  if (
    evaluation === CisEvaluation.PolicyObjects &&
    !snapshot.hasPolicyObjects
  ) {
    return KubernetesComplianceNotEvaluatedReason.PolicyObjectsNotRead;
  }

  if (needsPods && pods.all === 0) {
    return KubernetesComplianceNotEvaluatedReason.NoPods;
  }

  if (needsPods && pods.inScope === 0) {
    return KubernetesComplianceNotEvaluatedReason.NoPodsInScope;
  }

  if (evaluation === CisEvaluation.Pods && pods.read === 0) {
    return KubernetesComplianceNotEvaluatedReason.PodsNotRead;
  }

  return null;
}

// One framework, over the cluster, with what is turned off of it.
export function scoreKubernetesFramework(
  framework: KubernetesComplianceFramework,
  snapshot: KubernetesComplianceSnapshot,
  settings: ReadonlyArray<KubernetesComplianceSetting>,
): KubernetesComplianceFrameworkResult {
  const exclusions: Exclusions = getKubernetesComplianceExclusions(
    framework,
    settings,
  );
  // The pods the framework covers: those of the namespaces not turned off for it.
  const pods: Array<KubernetesCompliancePod> = snapshot.pods.filter(
    (pod: KubernetesCompliancePod): boolean => {
      return !exclusions.turnedOffNamespaces.has(pod.namespace);
    },
  );
  const readPods: Array<KubernetesCompliancePod> = pods.filter(
    (pod: KubernetesCompliancePod): boolean => {
      return Boolean(pod.security);
    },
  );
  const failingWorkloads: Set<string> = new Set<string>();
  const failingByNamespace: Map<string, Set<string>> = new Map();

  const requirements: Array<KubernetesComplianceRequirementResult> =
    getScoredControls(framework, snapshot).map(
      (
        control: KubernetesComplianceControlInfo,
      ): KubernetesComplianceRequirementResult => {
        const requirement: string = control.requirement;
        const turnedOffNamespaces: Array<string> = Array.from(
          exclusions.requirementNamespaces.get(requirement) || [],
        ).sort();
        const base: {
          requirement: string;
          title: string;
          turnedOffNamespaces: Array<string>;
        } = { requirement, title: control.title, turnedOffNamespaces };

        if (exclusions.turnedOffRequirements.has(requirement)) {
          return {
            ...base,
            status: ComplianceRequirementStatus.TurnedOff,
            failingCount: 0,
            findings: [],
          };
        }

        const reason: KubernetesComplianceNotEvaluatedReason | null =
          getNotEvaluatedReason(framework, requirement, snapshot, {
            all: snapshot.pods.length,
            inScope: pods.length,
            read: readPods.length,
          });

        if (reason) {
          return {
            ...base,
            status: ComplianceRequirementStatus.NotEvaluated,
            notEvaluatedReason: reason,
            failingCount: 0,
            findings: [],
          };
        }

        const findings: Array<KubernetesComplianceFinding> = (
          isPodControl(framework, requirement)
            ? getPodControlFindings(
                framework,
                requirement,
                pods.filter((pod: KubernetesCompliancePod): boolean => {
                  return !isLeftOut(exclusions, requirement, pod.namespace);
                }),
                snapshot,
              )
            : evaluateCisClusterControl(requirement, snapshot).filter(
                (finding: KubernetesComplianceFinding): boolean => {
                  return !isLeftOut(
                    exclusions,
                    requirement,
                    finding.object.namespace,
                  );
                },
              )
        ).sort(compareFindings);

        for (const finding of findings) {
          const key: string = getComplianceObjectKey(finding.object);

          if (isPodControl(framework, requirement)) {
            failingWorkloads.add(key);
          }

          if (finding.object.namespace) {
            const keys: Set<string> =
              failingByNamespace.get(finding.object.namespace) ||
              new Set<string>();
            keys.add(key);
            failingByNamespace.set(finding.object.namespace, keys);
          }
        }

        return {
          ...base,
          status:
            findings.length > 0
              ? ComplianceRequirementStatus.Failing
              : ComplianceRequirementStatus.Passing,
          failingCount: findings.length,
          findings: findings.slice(0, MAX_FINDINGS_PER_CONTROL),
        };
      },
    );

  const scored: Array<KubernetesComplianceRequirementResult> =
    requirements.filter(
      (result: KubernetesComplianceRequirementResult): boolean => {
        return (
          result.status === ComplianceRequirementStatus.Passing ||
          result.status === ComplianceRequirementStatus.Failing
        );
      },
    );
  const passing: number = scored.filter(
    (result: KubernetesComplianceRequirementResult): boolean => {
      return result.status === ComplianceRequirementStatus.Passing;
    },
  ).length;
  const workloads: Set<string> = new Set<string>(
    readPods.map((pod: KubernetesCompliancePod): string => {
      return getComplianceObjectKey(pod.workload);
    }),
  );
  const failingCounts: Record<string, number> = {};

  for (const [namespace, keys] of failingByNamespace) {
    failingCounts[namespace] = keys.size;
  }

  return {
    framework,
    fullName: KUBERNETES_COMPLIANCE_FRAMEWORK_INFO[framework].fullName,
    scope: KUBERNETES_COMPLIANCE_FRAMEWORK_INFO[framework].scope,
    score:
      scored.length === 0 ? null : Math.round((passing / scored.length) * 100),
    isTurnedOff: exclusions.isTurnedOff,
    turnedOffRequirements: Array.from(exclusions.turnedOffRequirements).sort(),
    turnedOffNamespaces: Array.from(exclusions.turnedOffNamespaces).sort(),
    workloadsEvaluated: workloads.size,
    workloadsPassing: Array.from(workloads).filter((key: string): boolean => {
      return !failingWorkloads.has(key);
    }).length,
    podsNotRead: pods.length - readPods.length,
    failingByNamespace: failingCounts,
    requirements,
  };
}

// Every Kubernetes framework, over the cluster, in the catalog's order.
export function scoreKubernetesFrameworks(
  snapshot: KubernetesComplianceSnapshot,
  settings: ReadonlyArray<KubernetesComplianceSetting>,
): Array<KubernetesComplianceFrameworkResult> {
  return ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS.map(
    (
      framework: KubernetesComplianceFramework,
    ): KubernetesComplianceFrameworkResult => {
      return scoreKubernetesFramework(framework, snapshot, settings);
    },
  );
}
