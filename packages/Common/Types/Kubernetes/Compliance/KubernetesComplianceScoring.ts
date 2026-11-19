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
  KubernetesComplianceAcceptedFinding,
  KubernetesComplianceDetail,
  KubernetesComplianceFinding,
  KubernetesComplianceObject,
  getComplianceDetailKey,
  getComplianceObjectKey,
} from "./KubernetesComplianceFinding";
import {
  KubernetesCompliancePod,
  KubernetesComplianceSnapshot,
  KubernetesComplianceTemplate,
  getTemplatesToScore,
} from "./KubernetesComplianceSnapshot";
import {
  PodSecurityControl,
  PodSecurityLevel,
  checkPodSecurityControl,
  getPodSecurityControls,
} from "./PodSecurityStandards";
import { PodSecurity } from "../KubernetesPodSecurity";
import { withMeaningKeyAsItsWord } from "../../MeaningKeys";

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
 *     nothing owns it - with how many of its pods fail and why. A workload
 *     that runs no pod now - scaled to zero, a CronJob between runs, a
 *     DaemonSet on no node - is read from its pod template instead, and its
 *     finding says so (#9880). One that runs pods is read from them alone:
 *     they are what was admitted, mutating webhooks included, and a rollout
 *     under way still runs some on the old template.
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
 * And a finding can be accepted for its one object (#9874) - a workload, a
 * binding, a namespace - for one control or the whole framework, with a
 * reason, as Kyverno's PolicyException and Gatekeeper's exclusions do: the
 * object is listed under the control as accepted, apart from what fails,
 * and counts as passing. The next object that fails the control in the same
 * namespace still fails it. The server hands only acceptances in force: an
 * expired one fails again.
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

/*
 * A finding accepted for one object (#9874), as the scoring reads one: a
 * setting in force - neither revoked nor expired - as the server reads it.
 */
export interface KubernetesComplianceAcceptance {
  // The setting that accepts it, which the page revokes it by.
  id: string;
  framework: KubernetesComplianceFramework;
  // A control of the framework; "" for every control of it.
  requirement: string;
  object: KubernetesComplianceObject;
}

export interface KubernetesComplianceRequirementResult {
  requirement: string;
  title: string;
  status: ComplianceRequirementStatus;
  notEvaluatedReason?: KubernetesComplianceNotEvaluatedReason | undefined;
  // How many objects fail it, with what is turned off or accepted left out.
  failingCount: number;
  // The objects that fail it, at most MAX_FINDINGS_PER_CONTROL.
  findings: Array<KubernetesComplianceFinding>;
  /*
   * The objects that fail it but are accepted (#9874), at most
   * MAX_FINDINGS_PER_CONTROL: they count as passing. Absent from an older
   * server's answer.
   */
  accepted?: Array<KubernetesComplianceAcceptedFinding> | undefined;
  // How many objects are accepted.
  acceptedCount?: number | undefined;
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
  /*
   * Workloads whose pods - or, running none, whose pod template (#9880) -
   * were read, outside the namespaces turned off.
   */
  workloadsEvaluated: number;
  // Of those, the ones no pod control fails, what is accepted left out.
  workloadsPassing: number;
  // Of those, the ones read from their pod template, running no pod (#9880).
  workloadsFromTemplates?: number | undefined;
  // Findings accepted, over every control (#9874).
  acceptedCount?: number | undefined;
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

// What a pod - or a pod template - of a namespace fails a pod control by.
function checkPodSecurity(
  framework: KubernetesComplianceFramework,
  requirement: string,
  namespace: string,
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
    namespace,
    version: snapshot.version,
  });
}

interface WorkloadFinding {
  object: KubernetesComplianceObject;
  details: Map<string, KubernetesComplianceDetail>;
  podCount: number;
}

/*
 * The failures of one control, one finding per workload: its pods', or for a
 * workload that runs none, its pod template's (#9880), said to be so.
 */
function getPodControlFindings(
  framework: KubernetesComplianceFramework,
  requirement: string,
  pods: ReadonlyArray<KubernetesCompliancePod>,
  templates: ReadonlyArray<KubernetesComplianceTemplate>,
  snapshot: KubernetesComplianceSnapshot,
): Array<KubernetesComplianceFinding> {
  const byWorkload: Map<string, WorkloadFinding> = new Map();

  for (const pod of pods) {
    if (!pod.security) {
      continue;
    }

    const details: Array<KubernetesComplianceDetail> = checkPodSecurity(
      framework,
      requirement,
      pod.namespace,
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

  const findings: Array<KubernetesComplianceFinding> = Array.from(
    byWorkload.values(),
  ).map((finding: WorkloadFinding): KubernetesComplianceFinding => {
    return {
      object: finding.object,
      details: Array.from(finding.details.values()),
      podCount: finding.podCount,
    };
  });

  for (const template of templates) {
    if (!template.security) {
      continue;
    }

    const details: Map<string, KubernetesComplianceDetail> = new Map();

    for (const detail of checkPodSecurity(
      framework,
      requirement,
      template.workload.namespace,
      template.security,
      snapshot,
    )) {
      if (details.size < MAX_DETAILS_PER_FINDING) {
        details.set(getComplianceDetailKey(detail), detail);
      }
    }

    if (details.size > 0) {
      findings.push({
        object: template.workload,
        details: Array.from(details.values()),
        isFromTemplate: true,
      });
    }
  }

  return findings;
}

/*
 * The acceptances of one framework (#9874), by the object each is for: the
 * control's own, and the one for every control of the framework.
 */
interface AcceptancesOfObject {
  byRequirement: Map<string, KubernetesComplianceAcceptance>;
  wholeFramework?: KubernetesComplianceAcceptance | undefined;
}

function indexAcceptances(
  framework: KubernetesComplianceFramework,
  acceptances: ReadonlyArray<KubernetesComplianceAcceptance>,
): Map<string, AcceptancesOfObject> {
  const byObject: Map<string, AcceptancesOfObject> = new Map();

  for (const acceptance of acceptances) {
    if (acceptance.framework !== framework) {
      continue;
    }

    const key: string = getComplianceObjectKey(acceptance.object);
    const entry: AcceptancesOfObject = byObject.get(key) || {
      byRequirement: new Map<string, KubernetesComplianceAcceptance>(),
    };
    const requirement: string = acceptance.requirement.trim();

    if (requirement) {
      entry.byRequirement.set(requirement, acceptance);
    } else {
      entry.wholeFramework = acceptance;
    }

    byObject.set(key, entry);
  }

  return byObject;
}

// What accepts an object's finding of a control: the control's own first.
function findAcceptance(
  index: Map<string, AcceptancesOfObject>,
  requirement: string,
  object: KubernetesComplianceObject,
): KubernetesComplianceAcceptance | undefined {
  const entry: AcceptancesOfObject | undefined = index.get(
    getComplianceObjectKey(object),
  );

  return entry?.byRequirement.get(requirement) || entry?.wholeFramework;
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

/*
 * One framework, over the cluster, with what is turned off of it and the
 * findings accepted for one object (#9874).
 */
export function scoreKubernetesFramework(
  framework: KubernetesComplianceFramework,
  snapshot: KubernetesComplianceSnapshot,
  settings: ReadonlyArray<KubernetesComplianceSetting>,
  acceptances: ReadonlyArray<KubernetesComplianceAcceptance> = [],
): KubernetesComplianceFrameworkResult {
  const exclusions: Exclusions = getKubernetesComplianceExclusions(
    framework,
    settings,
  );
  const accepting: Map<string, AcceptancesOfObject> = indexAcceptances(
    framework,
    acceptances,
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
  // And the templates of the workloads that run no pod (#9880), the same way.
  const allTemplates: Array<KubernetesComplianceTemplate> =
    getTemplatesToScore(snapshot);
  const templates: Array<KubernetesComplianceTemplate> = allTemplates.filter(
    (template: KubernetesComplianceTemplate): boolean => {
      return !exclusions.turnedOffNamespaces.has(template.workload.namespace);
    },
  );
  const readTemplates: Array<KubernetesComplianceTemplate> = templates.filter(
    (template: KubernetesComplianceTemplate): boolean => {
      return Boolean(template.security);
    },
  );
  /*
   * What there is to look at: for a pod control the pods and the templates
   * scored in their place; for 5.3.2, the namespaces running pods.
   */
  const podCounts: PodCounts = {
    all: snapshot.pods.length,
    inScope: pods.length,
    read: readPods.length,
  };
  const workloadCounts: PodCounts = {
    all: podCounts.all + allTemplates.length,
    inScope: podCounts.inScope + templates.length,
    read: podCounts.read + readTemplates.length,
  };
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
        /*
         * The title as English writes it - a key that names its meaning reads
         * as its word, "Capabilities" - for the API and the exports; the page
         * words the catalog's key in the reader's language.
         */
        const base: {
          requirement: string;
          title: string;
          turnedOffNamespaces: Array<string>;
        } = {
          requirement,
          title: withMeaningKeyAsItsWord(control.title),
          turnedOffNamespaces,
        };

        if (exclusions.turnedOffRequirements.has(requirement)) {
          return {
            ...base,
            status: ComplianceRequirementStatus.TurnedOff,
            failingCount: 0,
            findings: [],
          };
        }

        const reason: KubernetesComplianceNotEvaluatedReason | null =
          getNotEvaluatedReason(
            framework,
            requirement,
            snapshot,
            isPodControl(framework, requirement) ? workloadCounts : podCounts,
          );

        if (reason) {
          return {
            ...base,
            status: ComplianceRequirementStatus.NotEvaluated,
            notEvaluatedReason: reason,
            failingCount: 0,
            findings: [],
          };
        }

        const found: Array<KubernetesComplianceFinding> = (
          isPodControl(framework, requirement)
            ? getPodControlFindings(
                framework,
                requirement,
                pods.filter((pod: KubernetesCompliancePod): boolean => {
                  return !isLeftOut(exclusions, requirement, pod.namespace);
                }),
                templates.filter(
                  (template: KubernetesComplianceTemplate): boolean => {
                    return !isLeftOut(
                      exclusions,
                      requirement,
                      template.workload.namespace,
                    );
                  },
                ),
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
        // What is accepted for its object is listed apart, and passes (#9874).
        const findings: Array<KubernetesComplianceFinding> = [];
        const accepted: Array<KubernetesComplianceAcceptedFinding> = [];

        for (const finding of found) {
          const acceptance: KubernetesComplianceAcceptance | undefined =
            findAcceptance(accepting, requirement, finding.object);

          if (acceptance) {
            accepted.push({ ...finding, acceptanceId: acceptance.id });
          } else {
            findings.push(finding);
          }
        }

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
          acceptedCount: accepted.length,
          accepted: accepted.slice(0, MAX_FINDINGS_PER_CONTROL),
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
  const workloads: Set<string> = new Set<string>([
    ...readPods.map((pod: KubernetesCompliancePod): string => {
      return getComplianceObjectKey(pod.workload);
    }),
    ...readTemplates.map((template: KubernetesComplianceTemplate): string => {
      return getComplianceObjectKey(template.workload);
    }),
  ]);
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
    workloadsFromTemplates: readTemplates.length,
    acceptedCount: requirements.reduce(
      (sum: number, result: KubernetesComplianceRequirementResult): number => {
        return sum + (result.acceptedCount || 0);
      },
      0,
    ),
    podsNotRead: pods.length - readPods.length,
    failingByNamespace: failingCounts,
    requirements,
  };
}

// Every Kubernetes framework, over the cluster, in the catalog's order.
export function scoreKubernetesFrameworks(
  snapshot: KubernetesComplianceSnapshot,
  settings: ReadonlyArray<KubernetesComplianceSetting>,
  acceptances: ReadonlyArray<KubernetesComplianceAcceptance> = [],
): Array<KubernetesComplianceFrameworkResult> {
  return ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS.map(
    (
      framework: KubernetesComplianceFramework,
    ): KubernetesComplianceFrameworkResult => {
      return scoreKubernetesFramework(
        framework,
        snapshot,
        settings,
        acceptances,
      );
    },
  );
}
