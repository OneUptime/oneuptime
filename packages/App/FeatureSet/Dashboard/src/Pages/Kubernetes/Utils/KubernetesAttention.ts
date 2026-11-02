import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  KubernetesAttentionFinding,
  KubernetesHealthSeverity,
  KubernetesHealthText,
} from "Common/Types/Kubernetes/KubernetesHealth";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../Components/ResourcePart/ResourceAttention";

/*
 * WHAT NEEDS ATTENTION IN A KUBERNETES CLUSTER, AS THE PAGES DRAW IT.
 *
 * The findings come from Common/Types/Kubernetes/KubernetesHealth - the
 * Overview reads them from the server (POST
 * /kubernetes-resource/needs-attention/:clusterId), a workload's, a pod's
 * or a node's page works them out from the rows it reads - and become the
 * shared Needs attention card's items here: the kind as Kubernetes writes
 * it, an icon, the namespace under the name, Kubernetes' own message, and
 * the part's page, with its namespace, so two `checkout` Deployments of two
 * namespaces never open each other.
 *
 * React-free (pages hand in routeFor), so App tests can read it.
 */

/*
 * How the kinds read on a chip: as kubectl writes them, the long ones as
 * the side menu shortens them. Their icons are the side menu's.
 */
const KIND_CHIPS: Record<string, string> = {
  PersistentVolumeClaim: "PVC",
  PersistentVolume: "PV",
  HorizontalPodAutoscaler: "HPA",
  VerticalPodAutoscaler: "VPA",
};

const KIND_ICONS: Record<string, IconProp> = {
  Node: IconProp.Server,
  Pod: IconProp.Circle,
  Deployment: IconProp.Layers,
  StatefulSet: IconProp.Database,
  DaemonSet: IconProp.Settings,
  Job: IconProp.Play,
  CronJob: IconProp.Clock,
  DeploymentConfig: IconProp.Layers,
  PersistentVolumeClaim: IconProp.Disc,
  PersistentVolume: IconProp.Disc,
  HorizontalPodAutoscaler: IconProp.ChartBar,
};

// The kinds that live in a namespace: their pages need it to find them.
export const NAMESPACED_KUBERNETES_KINDS: ReadonlySet<string> = new Set<string>(
  [
    "Pod",
    "Deployment",
    "StatefulSet",
    "DaemonSet",
    "Job",
    "CronJob",
    "DeploymentConfig",
    "PersistentVolumeClaim",
    "HorizontalPodAutoscaler",
    "VerticalPodAutoscaler",
    "Service",
    "Route",
  ],
);

// How the part whose page this is reads in its own Needs attention card.
export const KUBERNETES_CURRENT_PART_LABELS: Record<string, string> = {
  Node: translationKey("This node"),
  Pod: translationKey("This pod"),
  Deployment: translationKey("This Deployment"),
  StatefulSet: translationKey("This StatefulSet"),
  DaemonSet: translationKey("This DaemonSet"),
  Job: translationKey("This Job"),
  CronJob: translationKey("This CronJob"),
  DeploymentConfig: translationKey("This DeploymentConfig"),
};

export function getKubernetesKindChip(kind: string): string {
  return KIND_CHIPS[kind] || kind;
}

export function getKubernetesKindIcon(kind: string): IconProp {
  return KIND_ICONS[kind] || IconProp.Cube;
}

export type KubernetesPartRouteFor = (part: {
  kind: string;
  name: string;
  namespace: string;
}) => Route | undefined;

function toAttentionText(text: KubernetesHealthText): ResourceAttentionText {
  const result: ResourceAttentionText = { text: text.text };
  if (text.values) {
    result.values = text.values;
  }
  if (text.plural) {
    result.plural = text.plural;
  }
  return result;
}

export function toKubernetesAttentionItem(
  finding: KubernetesAttentionFinding,
  routeFor: KubernetesPartRouteFor,
): ResourceAttentionItem {
  return {
    key: finding.key,
    kind: getKubernetesKindChip(finding.kind),
    kindAsWritten: true,
    icon: getKubernetesKindIcon(finding.kind),
    name: finding.name,
    detail: finding.namespace || undefined,
    severity:
      finding.severity === KubernetesHealthSeverity.Critical
        ? ResourceAttentionSeverity.Critical
        : ResourceAttentionSeverity.Warning,
    reasons: finding.reasons.map(toAttentionText),
    message: finding.message || undefined,
    route: routeFor({
      kind: finding.kind,
      name: finding.name,
      namespace: finding.namespace,
    }),
  };
}

/*
 * ---------------------------------------------------------------------------
 * Reading the server's answer
 * ---------------------------------------------------------------------------
 *
 * Defensive: an answer from an older or newer server, or one a proxy
 * mangled, never breaks the Overview - what cannot be read is left out.
 */

function readText(value: unknown): KubernetesHealthText | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source: Record<string, unknown> = value as Record<string, unknown>;
  if (typeof source["text"] !== "string" || !source["text"]) {
    return null;
  }
  const result: KubernetesHealthText = { text: source["text"] };
  const values: unknown = source["values"];
  if (values && typeof values === "object" && !Array.isArray(values)) {
    const strings: Record<string, string> = {};
    for (const [key, item] of Object.entries(
      values as Record<string, unknown>,
    )) {
      if (typeof item === "string" || typeof item === "number") {
        strings[key] = String(item);
      }
    }
    result.values = strings;
  }
  const plural: unknown = source["plural"];
  if (plural && typeof plural === "object") {
    const one: unknown = (plural as Record<string, unknown>)["one"];
    const count: unknown = (plural as Record<string, unknown>)["count"];
    if (typeof one === "string" && typeof count === "number") {
      result.plural = { one: one, count: count };
    }
  }
  return result;
}

export function parseKubernetesAttentionFindings(
  value: unknown,
): Array<KubernetesAttentionFinding> {
  if (!Array.isArray(value)) {
    return [];
  }

  const findings: Array<KubernetesAttentionFinding> = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const source: Record<string, unknown> = item as Record<string, unknown>;
    const severity: unknown = source["severity"];
    if (
      typeof source["key"] !== "string" ||
      typeof source["kind"] !== "string" ||
      typeof source["name"] !== "string" ||
      (severity !== KubernetesHealthSeverity.Critical &&
        severity !== KubernetesHealthSeverity.Warning)
    ) {
      continue;
    }
    const reasons: Array<KubernetesHealthText> = Array.isArray(
      source["reasons"],
    )
      ? (source["reasons"] as Array<unknown>)
          .map(readText)
          .filter(
            (
              text: KubernetesHealthText | null,
            ): text is KubernetesHealthText => {
              return text !== null;
            },
          )
      : [];
    const finding: KubernetesAttentionFinding = {
      key: source["key"],
      kind: source["kind"],
      namespace:
        typeof source["namespace"] === "string" ? source["namespace"] : "",
      name: source["name"],
      severity: severity as KubernetesHealthSeverity,
      reasons: reasons,
    };
    if (typeof source["message"] === "string" && source["message"]) {
      finding.message = source["message"];
    }
    if (typeof source["podCount"] === "number") {
      finding.podCount = source["podCount"];
    }
    findings.push(finding);
  }

  return findings;
}

export interface KubernetesNeedsAttentionRead {
  findings: Array<KubernetesAttentionFinding>;
  isTruncated: boolean;
}

export function parseKubernetesNeedsAttention(
  body: JSONObject | null | undefined,
): KubernetesNeedsAttentionRead {
  return {
    findings: parseKubernetesAttentionFindings(body?.["findings"]),
    isTruncated: body?.["isTruncated"] === true,
  };
}
