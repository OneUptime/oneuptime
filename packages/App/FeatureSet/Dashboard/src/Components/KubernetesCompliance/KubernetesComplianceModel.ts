import { ComplianceRequirementStatus } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import {
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceNamespace,
  KubernetesComplianceResponse,
  KubernetesComplianceTurnedOff,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import {
  KubernetesComplianceControlInfo,
  findKubernetesComplianceControl,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import { KubernetesComplianceFinding } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import { KubernetesComplianceFramework } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KubernetesComplianceNotEvaluatedReason,
  KubernetesComplianceRequirementResult,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import type { PluralTemplate } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A CLUSTER'S HARDENING SECTION DRAWS (#9627), worked out without React
 * so a plain test pins it: the order controls are listed in, what a control
 * that is not evaluated says, what the objects a control fails on are
 * called, and where each switch is set.
 */

/*
 * Marks an English sentence as a key of the Dashboard's locales, as
 * Common/UI/Utils/TranslateTemplate's translationKey does. Each is looked
 * up where it is drawn.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

// One switch: a framework or one of its controls, for the cluster or one namespace.
export interface KubernetesComplianceSwitchKey {
  framework: KubernetesComplianceFramework;
  requirement?: string | null | undefined;
  namespace?: string | null | undefined;
}

export function getKubernetesSwitchKey(
  key: KubernetesComplianceSwitchKey,
): string {
  return [
    key.framework,
    (key.requirement || "").trim(),
    (key.namespace || "").trim(),
  ].join("|");
}

// The status a page lists first: what fails, then what cannot be said yet.
const STATUS_ORDER: Readonly<Record<ComplianceRequirementStatus, number>> = {
  [ComplianceRequirementStatus.Failing]: 0,
  [ComplianceRequirementStatus.NotEvaluated]: 1,
  [ComplianceRequirementStatus.Passing]: 2,
  [ComplianceRequirementStatus.TurnedOff]: 3,
};

/*
 * A framework's controls as the page lists them: failing first, then not
 * evaluated, passing and turned off, each group in the standard's or the
 * benchmark's order. An export keeps that order instead.
 */
export function sortControlsForPage(
  requirements: ReadonlyArray<KubernetesComplianceRequirementResult>,
): Array<KubernetesComplianceRequirementResult> {
  return requirements
    .map(
      (
        requirement: KubernetesComplianceRequirementResult,
        index: number,
      ): {
        requirement: KubernetesComplianceRequirementResult;
        index: number;
      } => {
        return { requirement, index };
      },
    )
    .sort(
      (
        a: {
          requirement: KubernetesComplianceRequirementResult;
          index: number;
        },
        b: {
          requirement: KubernetesComplianceRequirementResult;
          index: number;
        },
      ): number => {
        return (
          STATUS_ORDER[a.requirement.status] -
            STATUS_ORDER[b.requirement.status] || a.index - b.index
        );
      },
    )
    .map(
      (item: {
        requirement: KubernetesComplianceRequirementResult;
      }): KubernetesComplianceRequirementResult => {
        return item.requirement;
      },
    );
}

export function getFailingControlCount(
  framework: Pick<KubernetesComplianceFrameworkResponse, "requirements">,
): number {
  return framework.requirements.filter(
    (requirement: KubernetesComplianceRequirementResult): boolean => {
      return requirement.status === ComplianceRequirementStatus.Failing;
    },
  ).length;
}

// The control's words from the catalog: its title, what fails it and the fix.
export function getControlInfo(
  framework: KubernetesComplianceFramework,
  requirement: string,
): KubernetesComplianceControlInfo | undefined {
  return findKubernetesComplianceControl(framework, requirement);
}

// Why a control is not evaluated, in a sentence.
export const NOT_EVALUATED_REASONS: Readonly<
  Record<KubernetesComplianceNotEvaluatedReason, string>
> = {
  [KubernetesComplianceNotEvaluatedReason.NoPods]: translationKey(
    "Scored once the Kubernetes agent reports this cluster's pods.",
  ),
  [KubernetesComplianceNotEvaluatedReason.NoPodsInScope]: translationKey(
    "Every namespace that runs pods is turned off for this framework.",
  ),
  [KubernetesComplianceNotEvaluatedReason.PodsNotRead]: translationKey(
    "Scored at the agent's next report of the cluster's pods, within five minutes by default.",
  ),
  [KubernetesComplianceNotEvaluatedReason.PolicyObjectsNotRead]: translationKey(
    "Needs the Kubernetes agent to read RBAC, service accounts and NetworkPolicies: upgrade it, with resourceSpecs.compliance on.",
  ),
};

// The kinds of object a control fails on, and how a count of them is said.
export const WORKLOAD_COUNT: PluralTemplate = {
  one: translationKey("{{count}} workload"),
  other: translationKey("{{count}} workloads"),
};

export const NAMESPACE_COUNT: PluralTemplate = {
  one: translationKey("{{count}} namespace"),
  other: translationKey("{{count}} namespaces"),
};

export const ROLE_COUNT: PluralTemplate = {
  one: translationKey("{{count}} role"),
  other: translationKey("{{count}} roles"),
};

export const BINDING_COUNT: PluralTemplate = {
  one: translationKey("{{count}} binding"),
  other: translationKey("{{count}} bindings"),
};

export const SERVICE_ACCOUNT_COUNT: PluralTemplate = {
  one: translationKey("{{count}} service account"),
  other: translationKey("{{count}} service accounts"),
};

export const POD_COUNT: PluralTemplate = {
  one: translationKey("{{count}} pod"),
  other: translationKey("{{count}} pods"),
};

// How a count of the objects a control fails on is said, by their kind.
export function getFailingCountTemplate(
  findings: ReadonlyArray<KubernetesComplianceFinding>,
): PluralTemplate {
  const kind: string = findings[0]?.object.kind || "";

  if (kind === "Namespace") {
    return NAMESPACE_COUNT;
  }

  if (kind === "Role" || kind === "ClusterRole") {
    return ROLE_COUNT;
  }

  if (kind === "RoleBinding" || kind === "ClusterRoleBinding") {
    return BINDING_COUNT;
  }

  if (kind === "ServiceAccount") {
    return SERVICE_ACCOUNT_COUNT;
  }

  return WORKLOAD_COUNT;
}

// An object as the page names it: "payments/api", a cluster-wide one by its name.
export function getObjectName(finding: KubernetesComplianceFinding): string {
  return finding.object.namespace && finding.object.kind !== "Namespace"
    ? `${finding.object.namespace}/${finding.object.name}`
    : finding.object.name;
}

// What is turned off of a framework for a control and a namespace, the latest first.
export function findTurnedOff(
  framework: Pick<KubernetesComplianceFrameworkResponse, "turnedOff">,
  key: Pick<KubernetesComplianceSwitchKey, "requirement" | "namespace">,
): KubernetesComplianceTurnedOff | undefined {
  const requirement: string = (key.requirement || "").trim();
  const namespace: string = (key.namespace || "").trim();

  return (framework.turnedOff || []).find(
    (entry: KubernetesComplianceTurnedOff): boolean => {
      return (
        (entry.requirement || "").trim() === requirement &&
        (entry.namespace || "").trim() === namespace
      );
    },
  );
}

// Whether a switch is on: a framework, a control, or either for a namespace.
export function isSwitchOn(
  framework: Pick<
    KubernetesComplianceFrameworkResponse,
    | "isTurnedOff"
    | "turnedOffRequirements"
    | "turnedOffNamespaces"
    | "requirements"
  >,
  key: Pick<KubernetesComplianceSwitchKey, "requirement" | "namespace">,
): boolean {
  const requirement: string = (key.requirement || "").trim();
  const namespace: string = (key.namespace || "").trim();

  if (!requirement && !namespace) {
    return !framework.isTurnedOff;
  }

  if (!namespace) {
    return !framework.turnedOffRequirements.includes(requirement);
  }

  if (!requirement) {
    return !framework.turnedOffNamespaces.includes(namespace);
  }

  return !framework.requirements.some(
    (each: KubernetesComplianceRequirementResult): boolean => {
      return (
        each.requirement === requirement &&
        each.turnedOffNamespaces.includes(namespace)
      );
    },
  );
}

// A Pod Security Admission level a namespace says, as its chip reads.
export const POD_SECURITY_ADMISSION_LEVELS: ReadonlyArray<string> = [
  "privileged",
  "baseline",
  "restricted",
];

// The namespaces that run pods, and those turned off that run none now, to turn on again.
export function getNamespaceRows(
  compliance: Pick<KubernetesComplianceResponse, "namespaces">,
  framework: Pick<KubernetesComplianceFrameworkResponse, "turnedOffNamespaces">,
): Array<KubernetesComplianceNamespace> {
  const listed: Set<string> = new Set<string>(
    compliance.namespaces.map(
      (namespace: KubernetesComplianceNamespace): string => {
        return namespace.name;
      },
    ),
  );

  return [
    ...compliance.namespaces,
    ...framework.turnedOffNamespaces
      .filter((name: string): boolean => {
        return !listed.has(name);
      })
      .map((name: string): KubernetesComplianceNamespace => {
        return { name, podCount: 0, enforce: null, audit: null, warn: null };
      }),
  ];
}
