import {
  KubernetesContainerAssessment,
  KubernetesHealthRow,
  KubernetesHealthSeverity,
  KubernetesHealthText,
} from "Common/Types/Kubernetes/KubernetesHealth";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionFact,
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../Components/ResourcePart/ResourceAttention";
import {
  KubernetesPartRouteFor,
  getKubernetesKindChip,
  getKubernetesKindIcon,
} from "./KubernetesAttention";
import { KUBERNETES_PROBLEM_FACT_LABELS } from "./KubernetesProblemItems";

/*
 * ONE CONTAINER OF A POD, ON ITS OWN PAGE.
 *
 * The Containers list's "NotReady" row opened a page that said the
 * container's name and its cluster (#9595). Its pod's status says the rest,
 * read by the pod's own rules (KubernetesHealth.assessKubernetesContainer):
 * its waiting or terminated reason in Kubernetes' word, its exit code, how
 * its last run ended, its restarts and since when. When it needs attention,
 * the hero's status opens that, in the row every list of what failed draws,
 * with the pod and the node it runs on a step away.
 *
 * React-free (pages hand in routeFor), so App tests can read it.
 */

export const KUBERNETES_CONTAINER_ATTENTION_DESCRIPTION: string =
  translationKey("What about this container is broken or needs a look.");

const SINCE_FAILING: string = translationKey("Failing since {{time}}");
const SINCE_FAILED: string = translationKey("Failed {{time}}");
const SINCE_NOT_READY: string = translationKey("Not ready since {{time}}");
// A run that ended lately, for a container running again since.
const SINCE_ENDED: string = translationKey("Ended {{time}}");

/*
 * A container's state as a list of containers says it, from its own row
 * (KubernetesContainer): Running, NotReady, or Kubernetes' reason for a
 * wait or an end ("CrashLoopBackOff", "Completed").
 */
export function getKubernetesContainerRowStatus(row: {
  state?: string | null | undefined;
  reason?: string | null | undefined;
  isReady?: boolean | null | undefined;
}): string {
  const reason: string = row.reason || "";
  const state: string = row.state || "";
  if (state === "running") {
    return row.isReady ? "Running" : "NotReady";
  }
  if (state === "waiting") {
    return reason || "Waiting";
  }
  if (state === "terminated") {
    return reason || "Terminated";
  }
  if (state) {
    return state.charAt(0).toUpperCase() + state.slice(1);
  }
  return "Unknown";
}

// Unique among a cluster's containers: its pod's namespace and name, then its own.
export function getKubernetesContainerKey(
  pod: Pick<KubernetesHealthRow, "namespaceKey" | "name">,
  container: string,
): string {
  return `Container:${pod.namespaceKey || ""}/${pod.name || ""}/${container}`;
}

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

function sinceTemplateOf(assessment: KubernetesContainerAssessment): string {
  if (assessment.severity === KubernetesHealthSeverity.Critical) {
    return SINCE_FAILING;
  }
  if (assessment.state === "terminated") {
    return SINCE_FAILED;
  }
  if (!assessment.ready) {
    return SINCE_NOT_READY;
  }
  return SINCE_ENDED;
}

/*
 * The container as its page's lists of what needs attention draw it: why,
 * in Kubernetes' words, which pod and node it runs on (each a step away),
 * its restarts and since when. Nothing when it is fine.
 */
export function getKubernetesContainerAttentionItems(data: {
  pod: KubernetesHealthRow;
  assessment: KubernetesContainerAssessment | null;
  routeFor: KubernetesPartRouteFor;
}): Array<ResourceAttentionItem> {
  const assessment: KubernetesContainerAssessment | null = data.assessment;
  if (!assessment || !assessment.severity) {
    return [];
  }

  const pod: KubernetesHealthRow = data.pod;
  const namespace: string = pod.namespaceKey || "";
  const spec: Record<string, unknown> =
    pod.spec && typeof pod.spec === "object"
      ? (pod.spec as Record<string, unknown>)
      : {};
  const nodeName: string =
    typeof spec["nodeName"] === "string" ? (spec["nodeName"] as string) : "";

  const facts: Array<ResourceAttentionFact> = [];
  if (pod.name) {
    facts.push({
      key: "pod",
      label: translationKey("Pod"),
      value: pod.name,
      route: data.routeFor({
        kind: "Pod",
        name: pod.name,
        namespace: namespace,
      }),
    });
  }
  if (nodeName) {
    facts.push({
      key: "node",
      label: KUBERNETES_PROBLEM_FACT_LABELS.node,
      value: nodeName,
      route: data.routeFor({ kind: "Node", name: nodeName, namespace: "" }),
    });
  }
  if (assessment.restarts > 0) {
    facts.push({
      key: "restarts",
      label: KUBERNETES_PROBLEM_FACT_LABELS.restarts,
      value: String(assessment.restarts),
      isCount: true,
    });
  }

  const item: ResourceAttentionItem = {
    key: getKubernetesContainerKey(pod, assessment.container),
    kind: getKubernetesKindChip("Container"),
    kindAsWritten: true,
    icon: getKubernetesKindIcon("Container"),
    name: assessment.container,
    severity:
      assessment.severity === KubernetesHealthSeverity.Critical
        ? ResourceAttentionSeverity.Critical
        : ResourceAttentionSeverity.Warning,
    reasons: assessment.reasons.map(toAttentionText),
    message: assessment.message || undefined,
    facts: facts,
  };

  if (assessment.since !== undefined) {
    item.since = {
      at: new Date(assessment.since),
      template: sinceTemplateOf(assessment),
    };
  }

  return [item];
}
