import {
  KubernetesHealthAssessment,
  KubernetesHealthRow,
  KubernetesHealthSeverity,
  KubernetesPodStatusBucket,
  assessKubernetesJob,
  assessKubernetesPod,
  getKubernetesJobCronJob,
  getKubernetesPodStatusBucket,
  getNewestKubernetesJobs,
  kubernetesObjectKey,
} from "Common/Types/Kubernetes/KubernetesHealth";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  getResourceAttentionTone,
} from "../../../Components/ResourcePart/ResourceAttention";
import type { ResourceAttentionDialogRead } from "../../../Components/ResourcePart/ResourceAttentionDialog";
import { ResourcePartChipAttention } from "../../../Components/ResourcePart/ResourcePartTypes";
import type { KubernetesProblemRowsLoader } from "./KubernetesProblemLoader";
import {
  KubernetesPartRouteFor,
  toKubernetesAttentionItem,
} from "./KubernetesAttention";
import {
  KubernetesNamespaceAttention,
  KubernetesPartRead,
  KubernetesPartRow,
} from "./KubernetesPartFacts";
import {
  KubernetesProblemKind,
  buildKubernetesProblemItems,
} from "./KubernetesProblemItems";
import {
  KUBERNETES_FAILED_PODS_EMPTY,
  KUBERNETES_POD_HINT,
  KUBERNETES_PODS_WHAT_FAILED,
} from "./KubernetesPodStatus";

/*
 * THE COUNTS OF SOMETHING WRONG ON A KUBERNETES OBJECT'S OWN PAGE.
 *
 * A Job's "3 pods failed", a CronJob's failed runs, a namespace's workloads
 * and pods that need attention: each opens exactly what it counts and why
 * (ResourceAttentionPill), the way the cluster's hero counts do (#9537) -
 * a failed pod's container and exit code, a run's backoff limit or
 * deadline, each a step from its own page, with what Kubernetes reported
 * about it lately, read when the dialog opens. A Job's chip and its
 * Failed count in its details open the same list (#9595).
 *
 * React-free (pages hand in the translator and routeFor), so App tests can
 * read it.
 */

// What a count's dialog says once nothing it counted needs attention any more.
const NOTHING_NOW: string = translationKey("Nothing needs attention now.");

const JOB_FAILED_PODS_DESCRIPTION: string = translationKey(
  "The pods this Job ran that failed, the newest first, each with how it ended.",
);

const FAILED_PODS_TITLE: PluralTemplate = {
  one: "{{count}} failed pod",
  other: "{{count}} failed pods",
};

const FAILED_RUNS: PluralTemplate = {
  one: "{{count}} run failed",
  other: "{{count}} runs failed",
};
const RUNS_HINT: string = translationKey("Show which runs and why");
const CRONJOB_FAILED_RUNS_DESCRIPTION: string = translationKey(
  "This CronJob's runs that failed, the newest first, each with why Kubernetes stopped it.",
);
const SINCE_RUN_FAILED: string = translationKey("Failed {{time}}");

const NAMESPACE_WORKLOADS: PluralTemplate = {
  one: "{{count}} workload needs attention",
  other: "{{count}} workloads need attention",
};
const NAMESPACE_PODS: PluralTemplate = {
  one: "{{count}} pod needs attention",
  other: "{{count}} pods need attention",
};
const WORKLOADS_HINT: string = translationKey("Show which workloads and why");

// A pod as the tone of a count of pods reads it: critical, or a look.
function podSeverity(pod: KubernetesPartRow): {
  severity: ResourceAttentionSeverity;
} {
  return {
    severity:
      assessKubernetesPod(pod).severity === KubernetesHealthSeverity.Critical
        ? ResourceAttentionSeverity.Critical
        : ResourceAttentionSeverity.Warning,
  };
}

function readFirst(
  rows: Array<KubernetesHealthRow>,
  kind: KubernetesProblemKind,
  routeFor: KubernetesPartRouteFor,
  loadRows: KubernetesProblemRowsLoader | undefined,
): {
  items?: Array<ResourceAttentionItem> | undefined;
  load?: (() => Promise<ResourceAttentionDialogRead>) | undefined;
} {
  if (!loadRows) {
    return {
      items: buildKubernetesProblemItems({
        rows: rows,
        query: { kind: kind },
        routeFor: routeFor,
      }),
    };
  }
  return {
    load: async (): Promise<ResourceAttentionDialogRead> => {
      return { items: await loadRows({ rows: rows, kind: kind }) };
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * A Job's failed pods
 * ---------------------------------------------------------------------------
 *
 * Kubernetes counts every pod a Job ran that failed (status.failed); the
 * dialog lists the ones it still keeps, why each ended. Red once the Job
 * itself failed (its backoff limit or deadline reached), amber while it
 * still retries.
 */
export function getKubernetesJobFailedPods(
  read: KubernetesPartRead,
): Array<KubernetesPartRow> {
  const job: KubernetesPartRow | null = read.part;
  if (!job || job.kind !== "Job") {
    return [];
  }
  // Its own pods that failed, whether or not the Job has given up yet.
  return read.pods.filter((pod: KubernetesPartRow): boolean => {
    return (
      getKubernetesPodStatusBucket(pod).bucket ===
      KubernetesPodStatusBucket.Failed
    );
  });
}

export function getKubernetesJobFailedPodsAttention(data: {
  read: KubernetesPartRead;
  translator: Translator;
  routeFor: KubernetesPartRouteFor;
  loadRows?: KubernetesProblemRowsLoader | undefined;
}): ResourcePartChipAttention | undefined {
  const job: KubernetesPartRow | null = data.read.part;
  if (!job || job.kind !== "Job") {
    return undefined;
  }
  const failedPods: Array<KubernetesPartRow> = getKubernetesJobFailedPods(
    data.read,
  );
  const hasFailed: boolean = assessKubernetesJob(job).severity !== null;

  return {
    tone: hasFailed ? "danger" : "warning",
    hint: KUBERNETES_POD_HINT,
    testId: "kubernetes-job-failed-pods",
    dialog: {
      title: data.translator.translatePlural(
        FAILED_PODS_TITLE,
        failedPods.length,
      ),
      description: JOB_FAILED_PODS_DESCRIPTION,
      ...readFirst(
        failedPods,
        KubernetesProblemKind.Failed,
        data.routeFor,
        data.loadRows,
      ),
      emptyMessage: KUBERNETES_FAILED_PODS_EMPTY,
      whatFailed: KUBERNETES_PODS_WHAT_FAILED,
      showKind: false,
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * A CronJob's failed runs
 * ---------------------------------------------------------------------------
 */
export function getKubernetesCronJobFailedRuns(
  read: KubernetesPartRead,
): Array<KubernetesPartRow> {
  const cronJob: KubernetesPartRow | null = read.part;
  if (!cronJob || cronJob.kind !== "CronJob") {
    return [];
  }
  return read.jobs.filter((job: KubernetesPartRow): boolean => {
    const owner: { name: string } | null = getKubernetesJobCronJob(job);
    return (
      Boolean(owner) &&
      owner!.name === cronJob.name &&
      assessKubernetesJob(job).severity !== null
    );
  });
}

export function getKubernetesCronJobFailedRunsChip(data: {
  read: KubernetesPartRead;
  translator: Translator;
  routeFor: KubernetesPartRouteFor;
}): {
  label: string;
  attention: ResourcePartChipAttention;
} | null {
  const failedRuns: Array<KubernetesPartRow> = getKubernetesCronJobFailedRuns(
    data.read,
  );
  if (failedRuns.length === 0) {
    return null;
  }

  /*
   * The newest run failed: the CronJob needs a look ("Last run failed"). A
   * run that failed before a newer one went well is history, grey.
   */
  const cronJob: KubernetesPartRow = data.read.part as KubernetesPartRow;
  const newest: KubernetesHealthRow | undefined = getNewestKubernetesJobs(
    data.read.jobs,
  ).get(
    kubernetesObjectKey(
      "CronJob",
      cronJob.namespaceKey || "",
      cronJob.name || "",
    ),
  );
  const isNewestFailed: boolean = Boolean(
    newest &&
      failedRuns.some((run: KubernetesPartRow): boolean => {
        return run.name === newest.name;
      }),
  );

  const items: Array<ResourceAttentionItem> = [...failedRuns]
    .map((run: KubernetesPartRow): ResourceAttentionItem => {
      const assessment: KubernetesHealthAssessment = assessKubernetesJob(run);
      const item: ResourceAttentionItem = toKubernetesAttentionItem(
        {
          key: kubernetesObjectKey(
            "Job",
            run.namespaceKey || "",
            run.name || "",
          ),
          kind: "Job",
          namespace: run.namespaceKey || "",
          name: run.name || "",
          // A Job that failed is worth a look, as the rules say of one.
          severity: KubernetesHealthSeverity.Warning,
          reasons: assessment.reasons,
          message: assessment.message,
        },
        data.routeFor,
      );
      // Its CronJob's page names the namespace already.
      delete item.detail;
      if (assessment.since !== undefined) {
        item.since = {
          at: new Date(assessment.since),
          template: SINCE_RUN_FAILED,
        };
      }
      return item;
    })
    .sort((a: ResourceAttentionItem, b: ResourceAttentionItem): number => {
      return (b.since?.at.getTime() ?? 0) - (a.since?.at.getTime() ?? 0);
    });

  const label: string = data.translator.translatePlural(
    FAILED_RUNS,
    failedRuns.length,
  );

  return {
    label: label,
    attention: {
      tone: isNewestFailed ? "warning" : "neutral",
      hint: RUNS_HINT,
      testId: "kubernetes-cronjob-failed-runs",
      dialog: {
        title: label,
        description: CRONJOB_FAILED_RUNS_DESCRIPTION,
        items: items,
        emptyMessage: NOTHING_NOW,
        showKind: false,
      },
    },
  };
}

/*
 * ---------------------------------------------------------------------------
 * A namespace's workloads and pods that need attention
 * ---------------------------------------------------------------------------
 */
export interface KubernetesNamespaceCountChip {
  key: string;
  label: string;
  attention: ResourcePartChipAttention;
}

export function getKubernetesNamespaceCountChips(data: {
  attention: KubernetesNamespaceAttention;
  translator: Translator;
  routeFor: KubernetesPartRouteFor;
  loadRows?: KubernetesProblemRowsLoader | undefined;
}): Array<KubernetesNamespaceCountChip> {
  const chips: Array<KubernetesNamespaceCountChip> = [];
  const workloads: Array<ResourceAttentionItem> = data.attention.workloads;
  const pods: Array<KubernetesPartRow> = data.attention.pods;

  if (workloads.length > 0) {
    const label: string = data.translator.translatePlural(
      NAMESPACE_WORKLOADS,
      workloads.length,
    );
    chips.push({
      key: "workloads",
      label: label,
      attention: {
        tone: getResourceAttentionTone(workloads),
        hint: WORKLOADS_HINT,
        testId: "kubernetes-namespace-workloads",
        dialog: {
          title: label,
          items: workloads,
          emptyMessage: NOTHING_NOW,
        },
      },
    });
  }

  if (pods.length > 0) {
    const label: string = data.translator.translatePlural(
      NAMESPACE_PODS,
      pods.length,
    );
    chips.push({
      key: "pods",
      label: label,
      attention: {
        tone: getResourceAttentionTone(pods.map(podSeverity)),
        hint: KUBERNETES_POD_HINT,
        testId: "kubernetes-namespace-pods",
        dialog: {
          title: label,
          ...readFirst(
            pods,
            KubernetesProblemKind.NeedsAttention,
            data.routeFor,
            data.loadRows,
          ),
          emptyMessage: NOTHING_NOW,
          whatFailed: KUBERNETES_PODS_WHAT_FAILED,
          showKind: false,
        },
      },
    });
  }

  return chips;
}
