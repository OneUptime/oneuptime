import KubernetesResourceModel from "Common/Models/DatabaseModels/KubernetesResource";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  KubernetesContainerAssessment,
  KubernetesHealthRow,
  KubernetesHealthText,
  getKubernetesLastRestartReason,
} from "Common/Types/Kubernetes/KubernetesHealth";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { kubernetesHealthTextInEnglish } from "./KubernetesResourceUtils";

/*
 * WHY, UNDER A ROW OF THE CONTAINERS LIST (#9732).
 *
 * The list reads each container's own row (KubernetesContainer: its state,
 * reason, readiness and restarts), which holds no exit code and no last
 * termination, so "NotReady" and "CrashLoopBackOff" said nothing more -
 * where the Pods, Deployments and Jobs lists say why under their status.
 * The pod's status holds the rest. The list reads the pods of its rows that
 * are not running and ready, in one read of those pods alone, and asks the
 * pod's own rules about each container (assessKubernetesContainer), as the
 * container's page does, so the list and the page say the same:
 *
 *   - waiting (CrashLoopBackOff, ImagePullBackOff): how its last run ended,
 *     "Last restart: Error, exit code 2";
 *   - ended (Error): its exit code, where the word says less, "Exit code 1";
 *   - running but not ready: how its last run ended, when it ran before.
 *
 * Never the row's own word again, and nothing while the pod's own status
 * says the container runs and is ready: the row is a moment behind it.
 *
 * React-free, so tests read it.
 */

/*
 * How many pods one read of the list asks for, the rows in trouble being
 * few: past that, a row says its state alone, as it did.
 */
export const KUBERNETES_CONTAINER_LIST_POD_READS: number = 200;

// An ended run's exit code, under the word Kubernetes ended it with.
const REASON_EXIT_CODE: string = translationKey("Exit code {{code}}");

// A row of the Containers list as it is read.
export interface KubernetesContainerListRow {
  name?: string | null | undefined;
  podName?: string | null | undefined;
  podNamespaceKey?: string | null | undefined;
  state?: string | null | undefined;
  isReady?: boolean | null | undefined;
}

// Whether a row is one to say why about: anything but running and ready.
export function isKubernetesContainerRowToExplain(
  row: Pick<KubernetesContainerListRow, "state" | "isReady">,
): boolean {
  return !(row.state === "running" && row.isReady === true);
}

// A pod's place in the cluster: its namespace, then its name.
export function getKubernetesContainerPodKey(
  namespace: string | null | undefined,
  pod: string | null | undefined,
): string {
  return `${namespace || ""}/${pod || ""}`;
}

/*
 * The pods of the rows to say why about: each once, in the list's order, at
 * most KUBERNETES_CONTAINER_LIST_POD_READS of them.
 */
export function getKubernetesContainerPodsToRead(
  rows: Array<KubernetesContainerListRow>,
): Array<string> {
  const names: Array<string> = [];
  const seen: Set<string> = new Set<string>();
  for (const row of rows) {
    if (!row.podName || !isKubernetesContainerRowToExplain(row)) {
      continue;
    }
    if (seen.has(row.podName)) {
      continue;
    }
    seen.add(row.podName);
    names.push(row.podName);
    if (names.length >= KUBERNETES_CONTAINER_LIST_POD_READS) {
      break;
    }
  }
  return names;
}

/*
 * Those pods, as the cluster's rules read them, by namespace and name: one
 * read, by name, of the cluster's pods (a name may repeat in another
 * namespace, which the key tells apart).
 */
export async function loadKubernetesContainerPods(data: {
  clusterId: ObjectID;
  podNames: Array<string>;
}): Promise<Map<string, KubernetesHealthRow>> {
  const pods: Map<string, KubernetesHealthRow> = new Map();
  if (data.podNames.length === 0) {
    return pods;
  }
  const result: ListResult<KubernetesResourceModel> =
    await ModelAPI.getList<KubernetesResourceModel>({
      modelType: KubernetesResourceModel,
      query: {
        kubernetesClusterId: data.clusterId,
        kind: "Pod",
        name: new Includes(data.podNames),
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: {
        kind: true,
        name: true,
        namespaceKey: true,
        phase: true,
        isReady: true,
        status: true,
        lastSeenAt: true,
        resourceCreationTimestamp: true,
      },
      sort: {},
    });
  for (const pod of result.data) {
    pods.set(getKubernetesContainerPodKey(pod.namespaceKey, pod.name), pod);
  }
  return pods;
}

// Words compared as words: "NotReady" is "Not ready".
function asComparable(words: string): string {
  return words.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/*
 * Why a container is not running and ready, under the list's word for it
 * (rowStatus), from its pod's rules. Empty when the pod was not read, or
 * says the container is fine.
 */
export function getKubernetesContainerListReasons(data: {
  rowStatus: string;
  assessment: KubernetesContainerAssessment | null;
}): Array<KubernetesHealthText> {
  const assessment: KubernetesContainerAssessment | null = data.assessment;
  if (!assessment) {
    return [];
  }
  if (assessment.state === "running" && assessment.ready) {
    return [];
  }

  if (assessment.state === "terminated") {
    /*
     * The word says how it ended ("Error"); its exit code says the rest. An
     * OOM kill's code (137) and a clean exit's (0) add nothing.
     */
    const word: string = data.rowStatus;
    if (
      assessment.exitCode !== null &&
      assessment.exitCode !== 0 &&
      !word.endsWith("OOMKilled")
    ) {
      return [
        {
          text: REASON_EXIT_CODE,
          values: { code: String(assessment.exitCode) },
        },
      ];
    }
    return [];
  }

  const said: Set<string> = new Set<string>([
    asComparable(data.rowStatus),
    asComparable(kubernetesHealthTextInEnglish(assessment.status)),
  ]);
  const reasons: Array<KubernetesHealthText> = assessment.reasons.filter(
    (reason: KubernetesHealthText): boolean => {
      return !said.has(asComparable(kubernetesHealthTextInEnglish(reason)));
    },
  );

  // Not ready, and the rules name nothing else: how its last run ended.
  if (reasons.length === 0 && assessment.lastTermination) {
    reasons.push(
      getKubernetesLastRestartReason({
        reason: assessment.lastTermination.reason,
        exitCode: assessment.lastTermination.exitCode,
      }),
    );
  }

  return reasons;
}
