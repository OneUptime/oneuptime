import OneUptimeDate from "Common/Types/Date";
import { ComplianceRequirementStatus } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import {
  KubernetesComplianceAcceptanceEntry,
  KubernetesComplianceFrameworkResponse,
  KubernetesComplianceNamespace,
  KubernetesComplianceResponse,
  KubernetesComplianceTurnedOff,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceApiTypes";
import {
  KubernetesComplianceControlInfo,
  findKubernetesComplianceControl,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceCatalog";
import {
  KubernetesComplianceFinding,
  KubernetesComplianceObject,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFinding";
import { KubernetesComplianceFramework } from "Common/Types/Kubernetes/Compliance/KubernetesComplianceFramework";
import {
  KubernetesComplianceNotEvaluatedReason,
  KubernetesComplianceRequirementResult,
} from "Common/Types/Kubernetes/Compliance/KubernetesComplianceScoring";
import type {
  PluralTemplate,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

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

/*
 * ---------------------------------------------------------------------------
 * A finding accepted for one object (#9874)
 * ---------------------------------------------------------------------------
 *
 * A finding a workload - or a binding, a namespace - fails on purpose is
 * accepted for that object alone, for one control or the whole framework,
 * with why: it is listed under the control as accepted, apart from what
 * fails, and counts as passing. Accepting is turning the control off for one
 * object, so it is a compliance setting that names the object, with the
 * same permissions and audit log as every switch here, and revoking it is
 * turning it on again.
 */

// What an acceptance is for: the control the finding fails, or every control.
export enum KubernetesAcceptScope {
  Control = "control",
  Framework = "framework",
}

/*
 * How long it holds, as the dialog offers it: until revoked, or for a while -
 * an exception until a vendor's fix ships - after which the finding fails
 * again. Presets rather than a date: a day picked in a calendar is read in
 * one zone and stored in another.
 */
export enum KubernetesAcceptanceExpiry {
  Never = "never",
  Month = "month",
  ThreeMonths = "three-months",
  SixMonths = "six-months",
  Year = "year",
}

export const ACCEPTANCE_EXPIRY_OPTIONS: ReadonlyArray<{
  value: KubernetesAcceptanceExpiry;
  label: string;
}> = [
  {
    value: KubernetesAcceptanceExpiry.Never,
    label: translationKey("Until it is revoked"),
  },
  {
    value: KubernetesAcceptanceExpiry.Month,
    label: translationKey("For a month"),
  },
  {
    value: KubernetesAcceptanceExpiry.ThreeMonths,
    label: translationKey("For three months"),
  },
  {
    value: KubernetesAcceptanceExpiry.SixMonths,
    label: translationKey("For six months"),
  },
  {
    value: KubernetesAcceptanceExpiry.Year,
    label: translationKey("For a year"),
  },
];

// When an acceptance made now with this expiry fails again; null for never.
export function getAcceptanceExpiryDate(
  expiry: KubernetesAcceptanceExpiry | string | null | undefined,
  now: Date,
): Date | null {
  switch (expiry) {
    case KubernetesAcceptanceExpiry.Month:
      return OneUptimeDate.addRemoveMonths(now, 1);
    case KubernetesAcceptanceExpiry.ThreeMonths:
      return OneUptimeDate.addRemoveMonths(now, 3);
    case KubernetesAcceptanceExpiry.SixMonths:
      return OneUptimeDate.addRemoveMonths(now, 6);
    case KubernetesAcceptanceExpiry.Year:
      return OneUptimeDate.addRemoveYears(now, 1);
    default:
      return null;
  }
}

/*
 * One acceptance's key: its framework, the control it is for ("" for every
 * control of the framework) and its object - one setting each.
 */
export function getKubernetesAcceptanceKey(data: {
  framework: KubernetesComplianceFramework | string;
  requirement?: string | null | undefined;
  object: Pick<KubernetesComplianceObject, "kind" | "namespace" | "name">;
}): string {
  return [
    data.framework,
    (data.requirement || "").trim(),
    data.object.kind,
    data.object.namespace || "",
    data.object.name,
  ].join("|");
}

// The acceptance an accepted finding is listed under.
export function findAcceptanceEntry(
  framework: Pick<KubernetesComplianceFrameworkResponse, "acceptances">,
  acceptanceId: string,
): KubernetesComplianceAcceptanceEntry | undefined {
  return (framework.acceptances || []).find(
    (entry: KubernetesComplianceAcceptanceEntry): boolean => {
      return entry.id === acceptanceId;
    },
  );
}

/*
 * A framework's acceptances as its fold lists them: those in force first,
 * then the ones that expired - which fail again - then the ones whose object
 * is gone; the latest first within each.
 */
export function sortAcceptancesForPage(
  entries: ReadonlyArray<KubernetesComplianceAcceptanceEntry>,
): Array<KubernetesComplianceAcceptanceEntry> {
  const rank: (entry: KubernetesComplianceAcceptanceEntry) => number = (
    entry: KubernetesComplianceAcceptanceEntry,
  ): number => {
    if (!entry.isOnCluster) {
      return 2;
    }

    return entry.isExpired ? 1 : 0;
  };

  return [...entries].sort(
    (
      a: KubernetesComplianceAcceptanceEntry,
      b: KubernetesComplianceAcceptanceEntry,
    ): number => {
      return (
        rank(a) - rank(b) ||
        (b.acceptedAt || "").localeCompare(a.acceptedAt || "")
      );
    },
  );
}

export const ACCEPTED_BY_ON: string = translationKey(
  "Accepted by {{name}} on {{date}}",
);

export const ACCEPTED_ON: string = translationKey("Accepted on {{date}}");

export const ACCEPTED: string = translationKey("Accepted");

export const FAILS_AGAIN_ON: string = translationKey("Fails again on {{date}}");

export const EXPIRED_ON: string = translationKey(
  "Expired on {{date}}: it fails again.",
);

export const NOT_ON_CLUSTER: string = translationKey(
  "Not on this cluster now: it accepts nothing until the object is back.",
);

/*
 * Who accepted it and when, in the reader's words: "Accepted by Jane Doe on
 * 12 Nov 2026", "Accepted on 12 Nov 2026" for an API key, or "Accepted".
 */
export function getAcceptedLine(
  entry: Pick<KubernetesComplianceAcceptanceEntry, "acceptedAt" | "acceptedBy">,
  translator: Translator,
): string {
  if (!entry.acceptedAt) {
    return translator.translateText(ACCEPTED) || ACCEPTED;
  }

  const date: string = OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    entry.acceptedAt,
    true,
  );

  return entry.acceptedBy
    ? translator.translateTemplate(ACCEPTED_BY_ON, {
        name: entry.acceptedBy,
        date,
      })
    : translator.translateTemplate(ACCEPTED_ON, { date });
}

// When it fails again - or that it did - in the reader's words; null when it never expires.
export function getAcceptanceExpiryLine(
  entry: Pick<KubernetesComplianceAcceptanceEntry, "expiresAt" | "isExpired">,
  translator: Translator,
): string | null {
  if (!entry.expiresAt) {
    return null;
  }

  const date: string = OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
    entry.expiresAt,
    true,
  );

  return translator.translateTemplate(
    entry.isExpired ? EXPIRED_ON : FAILS_AGAIN_ON,
    { date },
  );
}

/*
 * A setting row of the cluster that accepts one object's finding: it names
 * the object. The switches' rows name none.
 */
export function isAcceptanceRow(row: {
  objectName?: string | null | undefined;
}): boolean {
  return Boolean((row.objectName || "").trim());
}
