import { JSONObject } from "../../../Types/JSON";
import {
  KUBERNETES_FAILING_WAIT_REASONS,
  KubernetesHealthAssessment,
  KubernetesHealthRow,
  KubernetesHealthSeverity,
  KubernetesHealthText,
  KubernetesPodStatusBucket,
  assessKubernetesCronJobWithRuns,
  assessKubernetesJob,
  assessKubernetesNode,
  assessKubernetesPod,
  getKubernetesHealthSeverity,
  getKubernetesPodStatusBucket,
} from "../../../Types/Kubernetes/KubernetesHealth";
import { describe, expect, test } from "@jest/globals";

/*
 * What a list of what failed says about each pod and node besides its
 * verdict (#9537): when the problem began (since), which container it is
 * about, and how a container's own run ended, exit code and all. And how
 * the cluster's hero counts each pod once, by what kubectl's STATUS says
 * (getKubernetesPodStatusBucket), so a crash-looping pod is never counted
 * Running.
 */

const SEEN: Date = new Date("2026-11-01T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function ago(minutes: number): string {
  return new Date(SEEN.getTime() - minutes * MINUTE).toISOString();
}

function at(minutes: number): number {
  return SEEN.getTime() - minutes * MINUTE;
}

interface ContainerFields {
  name?: string;
  ready?: boolean;
  state?: string;
  reason?: string;
  message?: string;
  exitCode?: number | null;
  restartCount?: number;
  lastTerminationReason?: string;
  lastTerminationExitCode?: number | null;
  lastTerminatedAt?: string;
}

function container(fields: ContainerFields = {}): JSONObject {
  return {
    name: fields.name ?? "app",
    ready: fields.ready ?? true,
    restartCount: fields.restartCount ?? 0,
    state: fields.state ?? "running",
    reason: fields.reason ?? "",
    image: "registry.example.com/app:1.4.2",
    ...(fields.message !== undefined ? { message: fields.message } : {}),
    ...(fields.exitCode !== undefined ? { exitCode: fields.exitCode } : {}),
    ...(fields.lastTerminationReason !== undefined
      ? {
          lastTerminationReason: fields.lastTerminationReason,
          lastTerminationExitCode: fields.lastTerminationExitCode ?? null,
          lastTerminatedAt: fields.lastTerminatedAt ?? "",
        }
      : {}),
  } as unknown as JSONObject;
}

function condition(
  type: string,
  status: string,
  fields: { reason?: string; message?: string; at?: string } = {},
): JSONObject {
  return {
    type: type,
    status: status,
    reason: fields.reason ?? "",
    message: fields.message ?? "",
    lastTransitionTime: fields.at ?? ago(600),
  } as unknown as JSONObject;
}

function owners(...items: Array<[string, string]>): JSONObject {
  return {
    items: items.map(([kind, name]: [string, string]) => {
      return { kind: kind, name: name, uid: `${kind}-${name}` };
    }),
  } as unknown as JSONObject;
}

function pod(
  fields: {
    phase?: string | null;
    containers?: Array<JSONObject>;
    initContainers?: Array<JSONObject>;
    conditions?: Array<JSONObject>;
    reason?: string;
    message?: string;
    ownerReferences?: JSONObject;
    createdMinutesAgo?: number;
  } = {},
): KubernetesHealthRow {
  const phase: string | null =
    fields.phase === undefined ? "Running" : fields.phase;
  return {
    kind: "Pod",
    namespaceKey: "payments",
    name: "checkout-7d9f8b6c5-x2k4q",
    phase: phase,
    labels: {} as JSONObject,
    ownerReferences: fields.ownerReferences ?? owners(),
    spec: { nodeName: "node-1", containers: [] } as unknown as JSONObject,
    status: {
      ...(phase ? { phase: phase } : {}),
      conditions: fields.conditions ?? [condition("Ready", "True")],
      containerStatuses: fields.containers ?? [container()],
      initContainerStatuses: fields.initContainers ?? [],
      ...(fields.reason ? { reason: fields.reason } : {}),
      ...(fields.message ? { message: fields.message } : {}),
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(fields.createdMinutesAgo ?? 600),
  };
}

function node(
  conditions: Array<JSONObject>,
  isReady: boolean,
): KubernetesHealthRow {
  return {
    kind: "Node",
    namespaceKey: "",
    name: "node-3",
    isReady: isReady,
    hasMemoryPressure: false,
    hasDiskPressure: false,
    hasPidPressure: false,
    spec: { unschedulable: false } as unknown as JSONObject,
    status: { conditions: conditions } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(60 * 24 * 30),
  };
}

function words(value: KubernetesHealthText): string {
  let filled: string = value.plural
    ? value.plural.count === 1
      ? value.plural.one
      : value.text
    : value.text;
  for (const [key, replacement] of Object.entries(value.values || {})) {
    filled = filled.split(`{{${key}}}`).join(replacement);
  }
  return filled;
}

function reasonWords(assessment: KubernetesHealthAssessment): Array<string> {
  return assessment.reasons.map(words);
}

describe("since when a pod has been failing", () => {
  test("a crash loop: since the pod stopped being ready", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "CrashLoopBackOff",
            lastTerminationReason: "Error",
            lastTerminationExitCode: 1,
            lastTerminatedAt: ago(2),
          }),
        ],
        conditions: [condition("Ready", "False", { at: ago(95) })],
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(assessment.since).toBe(at(95));
  });

  test("a crash loop with no Ready condition falls back to ContainersReady, then to the last run, then to its creation", () => {
    const fromContainersReady: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "CrashLoopBackOff",
          }),
        ],
        conditions: [condition("ContainersReady", "False", { at: ago(40) })],
      }),
    );
    expect(fromContainersReady.since).toBe(at(40));

    const fromLastRun: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "CrashLoopBackOff",
            lastTerminationReason: "OOMKilled",
            lastTerminationExitCode: 137,
            lastTerminatedAt: ago(7),
          }),
        ],
        conditions: [],
      }),
    );
    expect(fromLastRun.since).toBe(at(7));

    const fromCreation: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "ImagePullBackOff",
          }),
        ],
        conditions: [],
        createdMinutesAgo: 30,
      }),
    );
    expect(fromCreation.since).toBe(at(30));
  });

  test("a failed pod: since it failed", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Failed",
        reason: "Evicted",
        message: "The node was low on resource: memory.",
        containers: [container({ ready: false, state: "terminated" })],
        conditions: [condition("Ready", "False", { at: ago(60 * 24 * 3) })],
      }),
    );
    // History by now, but still says when.
    expect(assessment.severity).toBeNull();
    expect(assessment.since).toBe(at(60 * 24 * 3));
  });

  test("a failed pod that says no time has no since", () => {
    expect(
      assessKubernetesPod(pod({ phase: "Failed", conditions: [] })).since,
    ).toBeUndefined();
  });

  test("a pod the scheduler cannot place: since it found no node", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Pending",
        containers: [],
        conditions: [
          condition("PodScheduled", "False", {
            reason: "Unschedulable",
            message: "0/3 nodes are available: 3 Insufficient memory.",
            at: ago(12),
          }),
        ],
        createdMinutesAgo: 20,
      }),
    );
    expect(reasonWords(assessment)).toEqual(["Can't be scheduled"]);
    expect(assessment.since).toBe(at(12));
  });

  test("any other pending pod: since it was created, even while it is still starting", () => {
    const starting: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Pending",
        containers: [],
        conditions: [],
        createdMinutesAgo: 2,
      }),
    );
    expect(starting.severity).toBeNull();
    expect(starting.since).toBe(at(2));
  });

  test("a container that just ended, and a pod not ready for long: since it stopped being ready", () => {
    const ended: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            ready: false,
            state: "terminated",
            reason: "Error",
            exitCode: 2,
          }),
        ],
        conditions: [condition("Ready", "False", { at: ago(1) })],
      }),
    );
    expect(ended.since).toBe(at(1));

    const notReady: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [container({ ready: false, name: "sidecar" })],
        conditions: [condition("Ready", "False", { at: ago(25) })],
      }),
    );
    expect(reasonWords(notReady)).toEqual(["Not ready"]);
    expect(notReady.since).toBe(at(25));
    expect(notReady.container).toBe("sidecar");
  });

  test("an OOM kill it came back from: since the kill", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            restartCount: 3,
            lastTerminationReason: "OOMKilled",
            lastTerminationExitCode: 137,
            lastTerminatedAt: ago(9),
          }),
        ],
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Warning);
    expect(assessment.since).toBe(at(9));
    expect(assessment.container).toBe("app");
  });

  test("a pod in phase Unknown: since it stopped being ready", () => {
    expect(
      assessKubernetesPod(
        pod({
          phase: "Unknown",
          conditions: [condition("Ready", "Unknown", { at: ago(18) })],
        }),
      ).since,
    ).toBe(at(18));
  });

  test("a healthy pod has no since", () => {
    expect(assessKubernetesPod(pod()).since).toBeUndefined();
  });
});

describe("which container a pod's verdict is about", () => {
  test("the one that cannot run, of several", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({ name: "proxy" }),
          container({
            name: "worker",
            ready: false,
            state: "waiting",
            reason: "ImagePullBackOff",
            message: 'Back-off pulling image "registry.example.com/worker:9.9"',
          }),
        ],
        conditions: [condition("Ready", "False", { at: ago(4) })],
      }),
    );
    expect(assessment.container).toBe("worker");
    expect(assessment.message).toBe(
      'Back-off pulling image "registry.example.com/worker:9.9"',
    );
  });

  test("an init container that cannot run", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Pending",
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "PodInitializing",
          }),
        ],
        initContainers: [
          container({
            name: "migrate",
            ready: false,
            state: "waiting",
            reason: "CrashLoopBackOff",
          }),
        ],
      }),
    );
    expect(words(assessment.status)).toBe("Init:CrashLoopBackOff");
    expect(assessment.container).toBe("migrate");
  });

  test("the container a failed pod's failure ended", () => {
    expect(
      assessKubernetesPod(
        pod({
          phase: "Failed",
          containers: [
            container({
              name: "proxy",
              state: "terminated",
              reason: "Completed",
              exitCode: 0,
            }),
            container({
              name: "job",
              state: "terminated",
              reason: "Error",
              exitCode: 1,
            }),
          ],
          conditions: [condition("Ready", "False", { at: ago(5) })],
        }),
      ).container,
    ).toBe("job");
  });
});

describe("how a container's own run ended, exit code and all", () => {
  test("a failed pod says the container's exit code", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Failed",
        containers: [
          container({
            ready: false,
            state: "terminated",
            reason: "Error",
            exitCode: 1,
            message: "panic: config not found",
          }),
        ],
        conditions: [condition("Ready", "False", { at: ago(3) })],
      }),
    );
    expect(reasonWords(assessment)).toEqual(["Failed", "Error, exit code 1"]);
    // Kubernetes' word stays a value: drawn as written in every language.
    expect(assessment.reasons[1]?.values).toEqual({
      reason: "Error",
      code: "1",
    });
  });

  test("an OOM kill's code and a clean exit's say nothing more than the word", () => {
    const oom: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Failed",
        containers: [
          container({
            ready: false,
            state: "terminated",
            reason: "OOMKilled",
            exitCode: 137,
          }),
        ],
        conditions: [condition("Ready", "False", { at: ago(3) })],
      }),
    );
    expect(reasonWords(oom)).toEqual(["Failed", "OOMKilled"]);

    const clean: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Failed",
        containers: [
          container({
            ready: false,
            state: "terminated",
            reason: "DeadlineExceeded",
            exitCode: 0,
          }),
        ],
        conditions: [condition("Ready", "False", { at: ago(3) })],
      }),
    );
    expect(reasonWords(clean)).toEqual(["Failed", "DeadlineExceeded"]);
  });

  test("a container that just ended says its code beside its word", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            ready: false,
            state: "terminated",
            reason: "Error",
            exitCode: 143,
          }),
        ],
        conditions: [condition("Ready", "False", { at: ago(0) })],
      }),
    );
    expect(words(assessment.status)).toBe("Error");
    expect(reasonWords(assessment)).toEqual(["Error, exit code 143"]);
  });

  test("an init container that failed says how", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        phase: "Pending",
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "PodInitializing",
          }),
        ],
        initContainers: [
          container({
            name: "migrate",
            ready: false,
            state: "terminated",
            reason: "Error",
            exitCode: 3,
          }),
        ],
      }),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(words(assessment.status)).toBe("Init:Error");
    expect(reasonWords(assessment)).toEqual(["Init:Error, exit code 3"]);
  });

  test("a crash loop still says how its last run ended", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesPod(
      pod({
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "CrashLoopBackOff",
            lastTerminationReason: "Error",
            lastTerminationExitCode: 1,
            lastTerminatedAt: ago(1),
          }),
        ],
      }),
    );
    expect(reasonWords(assessment)).toEqual([
      "CrashLoopBackOff",
      "Last restart: Error, exit code 1",
    ]);
  });
});

describe("since when a node, a Job and a CronJob's run have been wrong", () => {
  test("a node not ready: since its Ready condition changed", () => {
    const assessment: KubernetesHealthAssessment = assessKubernetesNode(
      node(
        [
          condition("Ready", "Unknown", {
            at: ago(33),
            message: "Kubelet stopped posting node status.",
          }),
        ],
        false,
      ),
    );
    expect(assessment.severity).toBe(KubernetesHealthSeverity.Critical);
    expect(assessment.since).toBe(at(33));
  });

  test("a node whose network is unavailable, and one under pressure", () => {
    expect(
      assessKubernetesNode(
        node(
          [
            condition("Ready", "True"),
            condition("NetworkUnavailable", "True", { at: ago(14) }),
          ],
          true,
        ),
      ).since,
    ).toBe(at(14));

    expect(
      assessKubernetesNode(
        node(
          [
            condition("Ready", "True"),
            condition("DiskPressure", "True", { at: ago(21) }),
          ],
          true,
        ),
      ).since,
    ).toBe(at(21));
  });

  test("a ready node has no since", () => {
    expect(
      assessKubernetesNode(node([condition("Ready", "True")], true)).since,
    ).toBeUndefined();
  });

  test("a failed Job, and a CronJob whose newest run failed: since the failure", () => {
    const job: KubernetesHealthRow = {
      kind: "Job",
      namespaceKey: "payments",
      name: "nightly-29001000",
      ownerReferences: owners(["CronJob", "nightly"]),
      spec: {} as JSONObject,
      status: {
        conditions: [
          condition("Failed", "True", {
            reason: "BackoffLimitExceeded",
            message: "Job has reached the specified backoff limit",
            at: ago(50),
          }),
        ],
      } as unknown as JSONObject,
      lastSeenAt: SEEN,
      resourceCreationTimestamp: ago(70),
    };
    expect(assessKubernetesJob(job).since).toBe(at(50));

    const cronJob: KubernetesHealthRow = {
      kind: "CronJob",
      namespaceKey: "payments",
      name: "nightly",
      spec: { suspend: false } as unknown as JSONObject,
      status: {} as JSONObject,
      lastSeenAt: SEEN,
      resourceCreationTimestamp: ago(60 * 24 * 90),
    };
    expect(assessKubernetesCronJobWithRuns(cronJob, [job]).since).toBe(at(50));
  });
});

describe("how the cluster's hero counts a pod: once, as kubectl's STATUS says it", () => {
  test("a crash-looping pod is CrashLoopBackOff, never Running", () => {
    expect(
      getKubernetesPodStatusBucket(
        pod({
          containers: [
            container({
              ready: false,
              state: "waiting",
              reason: "CrashLoopBackOff",
            }),
          ],
        }),
      ),
    ).toEqual({
      bucket: KubernetesPodStatusBucket.CannotRun,
      reason: "CrashLoopBackOff",
    });
  });

  test("a pending pod whose image will not pull is ImagePullBackOff, never Pending", () => {
    expect(
      getKubernetesPodStatusBucket(
        pod({
          phase: "Pending",
          containers: [
            container({
              ready: false,
              state: "waiting",
              reason: "ImagePullBackOff",
            }),
          ],
        }),
      ),
    ).toEqual({
      bucket: KubernetesPodStatusBucket.CannotRun,
      reason: "ImagePullBackOff",
    });
  });

  test("an init container that cannot run is counted by its Init: word", () => {
    expect(
      getKubernetesPodStatusBucket(
        pod({
          phase: "Pending",
          containers: [],
          initContainers: [
            container({
              name: "migrate",
              ready: false,
              state: "terminated",
              reason: "Error",
              exitCode: 1,
            }),
          ],
        }),
      ),
    ).toEqual({
      bucket: KubernetesPodStatusBucket.CannotRun,
      reason: "Init:Error",
    });
  });

  test("every wait that means a container cannot run is counted so", () => {
    for (const reason of KUBERNETES_FAILING_WAIT_REASONS) {
      expect(
        getKubernetesPodStatusBucket(
          pod({
            containers: [
              container({ ready: false, state: "waiting", reason: reason }),
            ],
          }),
        ),
      ).toEqual({
        bucket: KubernetesPodStatusBucket.CannotRun,
        reason: reason,
      });
    }
  });

  test("a container that is starting is not a pod that cannot run", () => {
    expect(
      getKubernetesPodStatusBucket(
        pod({
          phase: "Pending",
          containers: [
            container({
              ready: false,
              state: "waiting",
              reason: "ContainerCreating",
            }),
          ],
        }),
      ).bucket,
    ).toBe(KubernetesPodStatusBucket.Pending);
  });

  test("the rest by phase: Running, Pending, Failed, Succeeded, Unknown", () => {
    expect(getKubernetesPodStatusBucket(pod()).bucket).toBe(
      KubernetesPodStatusBucket.Running,
    );
    expect(
      getKubernetesPodStatusBucket(pod({ phase: "Pending", containers: [] }))
        .bucket,
    ).toBe(KubernetesPodStatusBucket.Pending);
    expect(
      getKubernetesPodStatusBucket(
        pod({
          phase: "Failed",
          containers: [
            container({
              ready: false,
              state: "terminated",
              reason: "Error",
              exitCode: 1,
            }),
          ],
        }),
      ).bucket,
    ).toBe(KubernetesPodStatusBucket.Failed);
    expect(
      getKubernetesPodStatusBucket(
        pod({
          phase: "Succeeded",
          containers: [
            container({
              ready: false,
              state: "terminated",
              reason: "Completed",
              exitCode: 0,
            }),
          ],
        }),
      ).bucket,
    ).toBe(KubernetesPodStatusBucket.Succeeded);
    expect(getKubernetesPodStatusBucket(pod({ phase: "Unknown" })).bucket).toBe(
      KubernetesPodStatusBucket.Unknown,
    );
  });

  test("a pod with no phase yet is no data, never Kubernetes' Unknown", () => {
    expect(
      getKubernetesPodStatusBucket(pod({ phase: null, containers: [] })).bucket,
    ).toBe(KubernetesPodStatusBucket.NoData);
  });

  test("a pod is counted unable to run exactly when ingest stores it critical", () => {
    const rows: Array<KubernetesHealthRow> = [
      pod(),
      pod({
        containers: [
          container({
            ready: false,
            state: "waiting",
            reason: "CrashLoopBackOff",
          }),
        ],
      }),
      pod({
        phase: "Pending",
        containers: [
          container({ ready: false, state: "waiting", reason: "ErrImagePull" }),
        ],
      }),
      pod({ phase: "Pending", containers: [], createdMinutesAgo: 30 }),
      pod({
        phase: "Failed",
        containers: [
          container({
            ready: false,
            state: "terminated",
            reason: "Error",
            exitCode: 1,
          }),
        ],
        conditions: [condition("Ready", "False", { at: ago(2) })],
      }),
      pod({ phase: "Unknown" }),
    ];
    for (const row of rows) {
      const isCannotRun: boolean =
        getKubernetesPodStatusBucket(row).bucket ===
        KubernetesPodStatusBucket.CannotRun;
      expect(isCannotRun).toBe(
        getKubernetesHealthSeverity(row) === KubernetesHealthSeverity.Critical,
      );
    }
  });
});
