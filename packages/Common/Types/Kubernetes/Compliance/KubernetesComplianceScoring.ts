import { ComplianceRequirementStatus } from "../../DataSecurity/ComplianceRequirementCatalog";
import {
  CIS_SCORED_CONTROLS,
  CisEvaluation,
  checkCisPodControl,
  evaluateCisClusterControl,
} from "./CisKubernetesBenchmark";
import { OneUptimeAgentComponent } from "./KubernetesAgentWorkloads";
import {
  ALL_KUBERNETES_COMPLIANCE_FRAMEWORKS,
  CIS_SCOPE_WITH_NODE_BENCHMARK,
  KUBERNETES_COMPLIANCE_FRAMEWORK_INFO,
  KubernetesComplianceControlInfo,
  KubernetesComplianceFramework,
  getKubernetesComplianceControls,
  toNodeControlInfo,
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
import { getNodeBenchmarkControlInfo } from "./KubernetesNodeBenchmarkCatalog";
import {
  NodeBenchmarkCheckResult,
  NodeBenchmarkScope,
  getNodeBenchmarkCheckResult,
  getNodeBenchmarkScope,
  getNodeFinding,
  isManagedNodeBenchmarkFamily,
} from "./KubernetesNodeBenchmarkScoring";
import {
  NsaCisaControl,
  NsaCisaSource,
  findNsaCisaControl,
} from "./NsaCisaHardening";
import {
  PodSecurityControl,
  PodSecurityLevel,
  checkPodSecurityControl,
  getPodSecurityControls,
} from "./PodSecurityStandards";
import {
  NodeBenchmarkFamily,
  getNodeBenchmarkRequirement,
  readNodeBenchmarkRequirement,
} from "../KubernetesNodeBenchmark";
import { PodSecurity } from "../KubernetesPodSecurity";
import { KUBERNETES_CLOUD_PLATFORM_PROVIDERS } from "../KubernetesClusterProvider";
import { withMeaningKeyAsItsWord } from "../../MeaningKeys";

/*
 * HOW A CLUSTER STANDS AGAINST EACH KUBERNETES FRAMEWORK (#9627).
 *
 * Each control of the Pod Security Standards' Baseline and Restricted
 * policies, of the CIS Kubernetes Benchmark's scored policy controls, and of
 * the NSA/CISA Kubernetes Hardening Guide (#9875) is evaluated over what the
 * cluster runs and holds (KubernetesComplianceSnapshot):
 *
 *   - A pod control reads every pod, and says what fails by the workload the
 *     pod belongs to - the Deployment, StatefulSet, DaemonSet, Job, CronJob
 *     or DeploymentConfig whose page a person opens, or the pod itself when
 *     nothing owns it - with how many of its pods fail and why. A workload
 *     that runs no pod now - scaled to zero, a CronJob between runs, a
 *     DaemonSet on no node - is read from its pod template instead, and its
 *     finding says so (#9880). One that runs pods is read from them alone:
 *     they are what was admitted, mutating webhooks included, and a rollout
 *     under way still runs some on the old template. A workload the
 *     OneUptime agent's chart made says whose it is (#9929).
 *   - An RBAC, service account, namespace or network policy control says
 *     what fails by the binding, role, service account or namespace.
 *   - A node or control plane control - the CIS benchmark's, as kube-bench
 *     reads them on the nodes (#9873), and the guide's that they answer -
 *     says what fails by the node.
 *
 * A control passes when nothing fails it, fails when something does, and is
 * not evaluated when the cluster has not told what it needs: no pod read yet
 * (pods stored before their security fields were kept are read again within
 * the agent's next pull), no RBAC from an agent that does not send it, no
 * kube-bench run, or a control plane the provider runs. A framework's score
 * is the share of its evaluated controls that pass, as every compliance
 * framework's is (ComplianceRequirementCatalog).
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
 * A node belongs to no namespace: only turning a control off, or accepting
 * its node, leaves it out.
 *
 * And a finding can be accepted for its one object (#9874) - a workload, a
 * binding, a namespace, a node - for one control or the whole framework,
 * with a reason, as Kyverno's PolicyException and Gatekeeper's exclusions
 * do: the object is listed under the control as accepted, apart from what
 * fails, and counts as passing. The next object that fails the control in
 * the same namespace still fails it. The server hands only acceptances in
 * force: an expired one fails again.
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
  // kube-bench does not run on the cluster: compliance.nodeBenchmark is off (#9873).
  NodeBenchmarkNotRun = "NodeBenchmarkNotRun",
  // kube-bench ran, but checked it on no node: no run on a control plane node, say.
  NodeBenchmarkNotChecked = "NodeBenchmarkNotChecked",
  // The benchmark kube-bench ran leaves it to a person's review.
  NodeBenchmarkManual = "NodeBenchmarkManual",
  // The provider runs the cluster's control plane, which no pod reaches.
  ManagedControlPlane = "ManagedControlPlane",
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

// The Pod Security Standards level a framework is, or null for any other.
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

/*
 * The family of a managed platform's own benchmark, by the provider the
 * agent names: its control plane is the provider's.
 */
function getProviderNodeBenchmarkFamily(
  provider: string | null,
): NodeBenchmarkFamily | null {
  if (provider === KUBERNETES_CLOUD_PLATFORM_PROVIDERS["aws_eks"]) {
    return NodeBenchmarkFamily.Eks;
  }

  if (
    provider === KUBERNETES_CLOUD_PLATFORM_PROVIDERS["gcp_kubernetes_engine"]
  ) {
    return NodeBenchmarkFamily.Gke;
  }

  if (provider === KUBERNETES_CLOUD_PLATFORM_PROVIDERS["azure_aks"]) {
    return NodeBenchmarkFamily.Aks;
  }

  return null;
}

/*
 * The controls a framework is scored on, at the cluster's version: for the
 * CIS benchmark, its API controls and then the node and control plane
 * controls kube-bench scored, in the benchmark's order.
 */
function getScoredControls(
  framework: KubernetesComplianceFramework,
  snapshot: KubernetesComplianceSnapshot,
  nodeScope: NodeBenchmarkScope | null,
): Array<KubernetesComplianceControlInfo> {
  const level: PodSecurityLevel | null = getPodSecurityLevel(framework);
  const controls: Array<KubernetesComplianceControlInfo> =
    getKubernetesComplianceControls(framework);

  if (framework === KubernetesComplianceFramework.CisKubernetes) {
    return nodeScope
      ? [
          ...controls,
          ...nodeScope.checks.map(
            (checkId: string): KubernetesComplianceControlInfo => {
              return toNodeControlInfo(
                getNodeBenchmarkControlInfo(nodeScope.family, checkId),
              );
            },
          ),
        ]
      : controls;
  }

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

// What a pod - or a pod template - of a namespace fails a pod control by.
type PodCheck = (
  security: PodSecurity,
  namespace: string,
) => Array<KubernetesComplianceDetail>;

/*
 * A Pod Security Standards control, or a CIS pod control, as a pod check: the
 * pod's own fields, read as the standard reads them, at the cluster's version.
 */
function getStandardPodCheck(
  framework: KubernetesComplianceFramework,
  requirement: string,
  snapshot: KubernetesComplianceSnapshot,
): PodCheck {
  const level: PodSecurityLevel | null = getPodSecurityLevel(framework);

  return (
    security: PodSecurity,
    namespace: string,
  ): Array<KubernetesComplianceDetail> => {
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
  };
}

interface WorkloadFinding {
  object: KubernetesComplianceObject;
  details: Map<string, KubernetesComplianceDetail>;
  podCount: number;
  agentComponent?: OneUptimeAgentComponent | undefined;
}

// A workload the agent's chart made says whose it is (#9929).
function withAgentComponent(
  finding: KubernetesComplianceFinding,
  component: OneUptimeAgentComponent | undefined,
): KubernetesComplianceFinding {
  return component
    ? { ...finding, oneUptimeAgent: { nodesProxyReasons: [], component } }
    : finding;
}

/*
 * The failures of one pod check, one finding per workload: its pods', or for
 * a workload that runs none, its pod template's (#9880), said to be so.
 */
function getPodControlFindings(
  check: PodCheck,
  pods: ReadonlyArray<KubernetesCompliancePod>,
  templates: ReadonlyArray<KubernetesComplianceTemplate>,
): Array<KubernetesComplianceFinding> {
  const byWorkload: Map<string, WorkloadFinding> = new Map();

  for (const pod of pods) {
    if (!pod.security) {
      continue;
    }

    const details: Array<KubernetesComplianceDetail> = check(
      pod.security,
      pod.namespace,
    );

    if (details.length === 0) {
      continue;
    }

    const key: string = getComplianceObjectKey(pod.workload);
    const finding: WorkloadFinding = byWorkload.get(key) || {
      object: pod.workload,
      details: new Map<string, KubernetesComplianceDetail>(),
      podCount: 0,
      agentComponent: pod.agentComponent,
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
    return withAgentComponent(
      {
        object: finding.object,
        details: Array.from(finding.details.values()),
        podCount: finding.podCount,
      },
      finding.agentComponent,
    );
  });

  for (const template of templates) {
    if (!template.security) {
      continue;
    }

    const details: Map<string, KubernetesComplianceDetail> = new Map();

    for (const detail of check(
      template.security,
      template.workload.namespace,
    )) {
      if (details.size < MAX_DETAILS_PER_FINDING) {
        details.set(getComplianceDetailKey(detail), detail);
      }
    }

    if (details.size > 0) {
      findings.push(
        withAgentComponent(
          {
            object: template.workload,
            details: Array.from(details.values()),
            isFromTemplate: true,
          },
          template.agentComponent,
        ),
      );
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

/*
 * Why a control read from one source cannot be scored yet, or null when it
 * can: the pods, the policy objects, or the namespaces pods run in.
 */
function getSourceNotEvaluatedReason(
  evaluation: CisEvaluation,
  needsPods: boolean,
  snapshot: KubernetesComplianceSnapshot,
  pods: PodCounts,
): KubernetesComplianceNotEvaluatedReason | null {
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

// What evaluating one control found: why it cannot be scored, or what fails it.
interface ControlEvaluation {
  notEvaluatedReason?: KubernetesComplianceNotEvaluatedReason | undefined;
  findings: Array<KubernetesComplianceFinding>;
  // Its findings are workloads: they count toward "workloads passing".
  isPodControl: boolean;
}

// What one framework's controls are evaluated over.
interface EvaluationContext {
  framework: KubernetesComplianceFramework;
  snapshot: KubernetesComplianceSnapshot;
  exclusions: Exclusions;
  // The pods and templates of the namespaces the framework is not turned off for.
  pods: Array<KubernetesCompliancePod>;
  templates: Array<KubernetesComplianceTemplate>;
  podCounts: PodCounts;
  workloadCounts: PodCounts;
  nodeScope: NodeBenchmarkScope | null;
}

/*
 * A pod check over the pods and templates a control covers: those of the
 * namespaces it is not turned off for, and of them, those whose block holds
 * what the check reads.
 */
function evaluatePodCheck(
  context: EvaluationContext,
  requirement: string,
  check: PodCheck,
  isRead: (security: PodSecurity) => boolean = (): boolean => {
    return true;
  },
): ControlEvaluation {
  const isReadPod: (security: PodSecurity | null) => boolean = (
    security: PodSecurity | null,
  ): boolean => {
    return Boolean(security) && isRead(security!);
  };
  const reason: KubernetesComplianceNotEvaluatedReason | null =
    getSourceNotEvaluatedReason(CisEvaluation.Pods, true, context.snapshot, {
      ...context.workloadCounts,
      read:
        context.pods.filter((pod: KubernetesCompliancePod): boolean => {
          return isReadPod(pod.security);
        }).length +
        context.templates.filter(
          (template: KubernetesComplianceTemplate): boolean => {
            return isReadPod(template.security);
          },
        ).length,
    });

  if (reason) {
    return { notEvaluatedReason: reason, findings: [], isPodControl: true };
  }

  return {
    findings: getPodControlFindings(
      check,
      context.pods.filter((pod: KubernetesCompliancePod): boolean => {
        return (
          isReadPod(pod.security) &&
          !isLeftOut(context.exclusions, requirement, pod.namespace)
        );
      }),
      context.templates.filter(
        (template: KubernetesComplianceTemplate): boolean => {
          return (
            isReadPod(template.security) &&
            !isLeftOut(
              context.exclusions,
              requirement,
              template.workload.namespace,
            )
          );
        },
      ),
    ),
    isPodControl: true,
  };
}

// A cluster check's findings, outside the namespaces the control is turned off for.
function evaluateClusterCheck(
  context: EvaluationContext,
  requirement: string,
  evaluation: CisEvaluation,
  needsPods: boolean,
  evaluate: () => Array<KubernetesComplianceFinding>,
): ControlEvaluation {
  const reason: KubernetesComplianceNotEvaluatedReason | null =
    getSourceNotEvaluatedReason(
      evaluation,
      needsPods,
      context.snapshot,
      context.podCounts,
    );

  if (reason) {
    return { notEvaluatedReason: reason, findings: [], isPodControl: false };
  }

  return {
    findings: evaluate().filter(
      (finding: KubernetesComplianceFinding): boolean => {
        return !isLeftOut(
          context.exclusions,
          requirement,
          finding.object.namespace,
        );
      },
    ),
    isPodControl: false,
  };
}

/*
 * One CIS node or control plane control (#9873): failing by each node
 * kube-bench failed it on, passing when it passed it on some and failed it
 * on none, and not evaluated when it could check it on none.
 */
function evaluateNodeControl(
  context: EvaluationContext,
  requirement: string,
): ControlEvaluation {
  const named: { family: NodeBenchmarkFamily; checkId: string } | null =
    readNodeBenchmarkRequirement(requirement);

  if (!context.nodeScope || !named) {
    return {
      notEvaluatedReason:
        KubernetesComplianceNotEvaluatedReason.NodeBenchmarkNotRun,
      findings: [],
      isPodControl: false,
    };
  }

  const result: NodeBenchmarkCheckResult = getNodeBenchmarkCheckResult(
    context.nodeScope,
    named.checkId,
  );

  if (result.failing.length === 0 && result.passing.length === 0) {
    return {
      notEvaluatedReason:
        KubernetesComplianceNotEvaluatedReason.NodeBenchmarkNotChecked,
      findings: [],
      isPodControl: false,
    };
  }

  return {
    findings: result.failing.map(
      (node: string): KubernetesComplianceFinding => {
        return getNodeFinding(node);
      },
    ),
    isPodControl: false,
  };
}

/*
 * A guide control kube-bench's checks answer (#9875): failing by each node
 * that fails one of them, said by the check's number; not evaluated when
 * kube-bench does not run, when the provider runs the control plane they
 * read, when its benchmark leaves them to a person, or when no node checked
 * them.
 */
function evaluateNodeChecks(
  context: EvaluationContext,
  checksByFamily: Partial<Record<NodeBenchmarkFamily, ReadonlyArray<string>>>,
): ControlEvaluation {
  const notEvaluated: (
    reason: KubernetesComplianceNotEvaluatedReason,
  ) => ControlEvaluation = (
    reason: KubernetesComplianceNotEvaluatedReason,
  ): ControlEvaluation => {
    return { notEvaluatedReason: reason, findings: [], isPodControl: false };
  };
  const scope: NodeBenchmarkScope | null = context.nodeScope;
  const providerFamily: NodeBenchmarkFamily | null =
    getProviderNodeBenchmarkFamily(context.snapshot.provider);
  const family: NodeBenchmarkFamily =
    scope?.family || providerFamily || NodeBenchmarkFamily.Cis;
  const checks: ReadonlyArray<string> = checksByFamily[family] || [];
  const isProviders: boolean =
    isManagedNodeBenchmarkFamily(family) || providerFamily !== null;

  // What only the control plane answers, on a control plane the provider runs.
  if (checks.length === 0 && isProviders) {
    return notEvaluated(
      KubernetesComplianceNotEvaluatedReason.ManagedControlPlane,
    );
  }

  if (!scope) {
    return notEvaluated(
      KubernetesComplianceNotEvaluatedReason.NodeBenchmarkNotRun,
    );
  }

  const scored: Array<string> = checks.filter((checkId: string): boolean => {
    return scope.checks.includes(checkId);
  });

  if (scored.length === 0) {
    if (
      checks.some((checkId: string): boolean => {
        return scope.manual.includes(checkId);
      })
    ) {
      return notEvaluated(
        KubernetesComplianceNotEvaluatedReason.NodeBenchmarkManual,
      );
    }

    return notEvaluated(
      providerFamily
        ? KubernetesComplianceNotEvaluatedReason.ManagedControlPlane
        : KubernetesComplianceNotEvaluatedReason.NodeBenchmarkNotChecked,
    );
  }

  const failingByNode: Map<string, Array<string>> = new Map();
  let isChecked: boolean = false;

  for (const checkId of scored) {
    const result: NodeBenchmarkCheckResult = getNodeBenchmarkCheckResult(
      scope,
      checkId,
    );

    isChecked =
      isChecked || result.failing.length > 0 || result.passing.length > 0;

    for (const node of result.failing) {
      failingByNode.set(node, [...(failingByNode.get(node) || []), checkId]);
    }
  }

  if (!isChecked) {
    return notEvaluated(
      KubernetesComplianceNotEvaluatedReason.NodeBenchmarkNotChecked,
    );
  }

  return {
    findings: Array.from(failingByNode.entries()).map(
      ([node, failed]: [
        string,
        Array<string>,
      ]): KubernetesComplianceFinding => {
        return getNodeFinding(
          node,
          failed.map((checkId: string): KubernetesComplianceDetail => {
            return { field: getNodeBenchmarkCheckLabel(family, checkId) };
          }),
        );
      },
    ),
    isPodControl: false,
  };
}

/*
 * A kube-bench check as a guide control's finding names it: by the CIS
 * benchmark it is of, "CIS 4.2.1", or a managed platform's, "EKS 3.2.1".
 */
export function getNodeBenchmarkCheckLabel(
  family: NodeBenchmarkFamily,
  checkId: string,
): string {
  return family === NodeBenchmarkFamily.Cis
    ? `CIS ${checkId}`
    : getNodeBenchmarkRequirement(family, checkId);
}

const NSA_CISA_SOURCE_EVALUATIONS: Readonly<
  Record<Exclude<NsaCisaSource, NsaCisaSource.Nodes>, CisEvaluation>
> = {
  [NsaCisaSource.Pods]: CisEvaluation.Pods,
  [NsaCisaSource.PolicyObjects]: CisEvaluation.PolicyObjects,
  [NsaCisaSource.Namespaces]: CisEvaluation.Namespaces,
};

// One of the NSA/CISA guide's controls, from the source it is answered from (#9875).
function evaluateNsaCisaControl(
  context: EvaluationContext,
  control: NsaCisaControl,
): ControlEvaluation {
  if (control.source === NsaCisaSource.Nodes) {
    return evaluateNodeChecks(context, control.nodeChecks || {});
  }

  if (control.source === NsaCisaSource.Pods && control.checkPod) {
    const checkPod: NonNullable<NsaCisaControl["checkPod"]> = control.checkPod;

    return evaluatePodCheck(
      context,
      control.requirement,
      (security: PodSecurity, namespace: string) => {
        return checkPod(security, {
          namespace,
          version: context.snapshot.version,
        });
      },
      control.isPodRead,
    );
  }

  const evaluate: NonNullable<NsaCisaControl["evaluate"]> =
    control.evaluate ||
    ((): Array<KubernetesComplianceFinding> => {
      return [];
    });

  return evaluateClusterCheck(
    context,
    control.requirement,
    NSA_CISA_SOURCE_EVALUATIONS[
      control.source as Exclude<NsaCisaSource, NsaCisaSource.Nodes>
    ],
    control.source === NsaCisaSource.Namespaces || Boolean(control.needsPods),
    (): Array<KubernetesComplianceFinding> => {
      return evaluate(context.snapshot);
    },
  );
}

// One control of a framework, from what it reads.
function evaluateControl(
  context: EvaluationContext,
  control: KubernetesComplianceControlInfo,
): ControlEvaluation {
  const requirement: string = control.requirement;

  if (control.isNodeControl) {
    return evaluateNodeControl(context, requirement);
  }

  if (context.framework === KubernetesComplianceFramework.NsaCisaHardening) {
    const nsaControl: NsaCisaControl | undefined =
      findNsaCisaControl(requirement);

    return nsaControl
      ? evaluateNsaCisaControl(context, nsaControl)
      : { findings: [], isPodControl: false };
  }

  const evaluation: CisEvaluation | undefined =
    getPodSecurityLevel(context.framework) !== null
      ? CisEvaluation.Pods
      : CIS_SCORED_CONTROLS[requirement];

  if (evaluation === CisEvaluation.Pods) {
    return evaluatePodCheck(
      context,
      requirement,
      getStandardPodCheck(context.framework, requirement, context.snapshot),
    );
  }

  // What there is to look at: for 5.3.2 and 5.2.1, the namespaces running pods.
  return evaluateClusterCheck(
    context,
    requirement,
    evaluation || CisEvaluation.PolicyObjects,
    evaluation !== CisEvaluation.PolicyObjects || requirement === "5.3.2",
    (): Array<KubernetesComplianceFinding> => {
      return evaluateCisClusterControl(requirement, context.snapshot);
    },
  );
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
  const context: EvaluationContext = {
    framework,
    snapshot,
    exclusions,
    pods,
    templates,
    podCounts,
    workloadCounts: {
      all: podCounts.all + allTemplates.length,
      inScope: podCounts.inScope + templates.length,
      read: podCounts.read + readTemplates.length,
    },
    nodeScope: getNodeBenchmarkScope(snapshot.nodeBenchmarks),
  };
  const failingWorkloads: Set<string> = new Set<string>();
  const failingByNamespace: Map<string, Set<string>> = new Map();

  const requirements: Array<KubernetesComplianceRequirementResult> =
    getScoredControls(framework, snapshot, context.nodeScope).map(
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

        const evaluation: ControlEvaluation = evaluateControl(context, control);

        if (evaluation.notEvaluatedReason) {
          return {
            ...base,
            status: ComplianceRequirementStatus.NotEvaluated,
            notEvaluatedReason: evaluation.notEvaluatedReason,
            failingCount: 0,
            findings: [],
          };
        }

        const found: Array<KubernetesComplianceFinding> =
          evaluation.findings.sort(compareFindings);
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

          if (evaluation.isPodControl) {
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
    scope:
      framework === KubernetesComplianceFramework.CisKubernetes &&
      context.nodeScope
        ? CIS_SCOPE_WITH_NODE_BENCHMARK
        : KUBERNETES_COMPLIANCE_FRAMEWORK_INFO[framework].scope,
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
