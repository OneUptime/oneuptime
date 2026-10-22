import GitOpsInspector, {
  GitOpsCommandInspection,
  GitOpsReadCluster,
  KubectlObjectRead,
} from "../../../../Server/Utils/AI/Remediation/GitOpsInspector";
import KubectlJobRunner, {
  KubectlJobOutcome,
  KubectlRunState,
} from "../../../../Server/Utils/AI/ClusterAccess/KubectlJobRunner";
import KubernetesClusterAiAccessService from "../../../../Server/Services/KubernetesClusterAiAccessService";
import { AiRemediationRevertWatch } from "../../../../Types/AutoRemediation/AiRemediationGitOps";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * GitOpsInspector: the cluster side of GitOps on a kubectl fix. Every read
 * is `kubectl get <kind>/<name> -n <ns> -o json --show-managed-fields`
 * through the cluster's own access target, on the investigation lane. A
 * read that fails says nothing — nobody declares, nothing to watch — and
 * never fails what it accompanies.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const CLUSTER_ID: string = "33333333-3333-4333-8333-333333333333";
const RUNNER_ID: string = "44444444-4444-4444-8444-444444444444";

const CLUSTER: GitOpsReadCluster = {
  clusterId: CLUSTER_ID,
  runnerId: RUNNER_ID,
};

function deployment(
  data: {
    name?: string;
    replicas?: number;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: Array<JSONObject>;
    kind?: string;
  } = {},
): JSONObject {
  return {
    apiVersion: "apps/v1",
    kind: data.kind || "Deployment",
    metadata: {
      name: data.name || "web",
      namespace: "shop",
      labels: data.labels || {},
      annotations: data.annotations || {},
      ...(data.ownerReferences
        ? { ownerReferences: data.ownerReferences }
        : {}),
    },
    spec: { replicas: data.replicas ?? 1 },
  } as JSONObject;
}

const ARGO_ANNOTATIONS: Record<string, string> = {
  "argocd.argoproj.io/tracking-id": "shop:apps/Deployment:shop/web",
};

function printed(object: JSONObject): KubectlJobOutcome {
  return {
    jobId: "job",
    succeeded: true,
    exitCode: 0,
    output: `[stdout]\n${JSON.stringify(object, null, 2)}\n`,
    displayCommand: "kubectl get",
    executed: true,
    runState: KubectlRunState.Ran,
  };
}

function notFound(): KubectlJobOutcome {
  return {
    jobId: "job",
    succeeded: false,
    exitCode: 1,
    output:
      '[stderr]\nError from server (NotFound): deployments.apps "web" not found\n',
    errorMessage: "Exit code 1",
    displayCommand: "kubectl get",
    executed: true,
    runState: KubectlRunState.Ran,
  };
}

function unreachable(): KubectlJobOutcome {
  return {
    jobId: "job",
    succeeded: false,
    output: "",
    errorMessage: "No Runner picked the command up.",
    displayCommand: "kubectl get",
    executed: false,
    runState: KubectlRunState.NotRun,
    claimTimedOut: true,
  };
}

// The objects the cluster holds, by "<kind>/<name>"; reads answer from them.
function mockCluster(
  objects: Record<string, JSONObject | "unreachable">,
): SpyInstance<typeof KubectlJobRunner.run> {
  return jest
    .spyOn(KubectlJobRunner, "run")
    .mockImplementation(
      async (data: { command: string }): Promise<KubectlJobOutcome> => {
        const key: string = data.command.split(" ")[2] || "";
        const object: JSONObject | "unreachable" | undefined = objects[key];

        if (object === "unreachable") {
          return unreachable();
        }

        return object ? printed(object) : notFound();
      },
    );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GitOpsInspector.getWatchTarget", () => {
  it("is the one object a kubectl write names, in the namespace it gives", () => {
    expect(
      GitOpsInspector.getWatchTarget(
        "kubectl scale deployment/web --replicas=3 -n shop",
      ),
    ).toMatchObject({
      namespace: "shop",
      target: { verb: "scale", kind: "deployment", name: "web" },
    });
  });

  it("is nothing for a read, a write with no -n, a pod, a Secret, a node or several objects", () => {
    for (const command of [
      "kubectl get deployment/web -n shop",
      "kubectl scale deployment/web --replicas=3",
      "kubectl delete pod web-1 -n shop",
      "kubectl cordon node-1",
      "kubectl rollout restart deployment -n shop",
      "kubectl exec web-1 -n shop -- sh",
    ]) {
      expect(GitOpsInspector.getWatchTarget(command)).toBeNull();
    }
  });
});

describe("GitOpsInspector.parseObjectOutput", () => {
  it("reads the object kubectl printed, with or without its section headers", () => {
    expect(
      GitOpsInspector.parseObjectOutput('[stdout]\n{"kind":"Deployment"}\n'),
    ).toEqual({ kind: "Deployment" });
    expect(
      GitOpsInspector.parseObjectOutput(
        '[stdout]\n{"kind":"Deployment"}\n\n[stderr]\nWarning: something\n',
      ),
    ).toEqual({ kind: "Deployment" });
    expect(GitOpsInspector.parseObjectOutput('{"kind":"Pod"}')).toEqual({
      kind: "Pod",
    });
  });

  it("is null for anything that is not one JSON object", () => {
    expect(GitOpsInspector.parseObjectOutput("")).toBeNull();
    expect(GitOpsInspector.parseObjectOutput("[stdout]\n[1,2]")).toBeNull();
    expect(
      GitOpsInspector.parseObjectOutput("[stdout]\n{truncated..."),
    ).toBeNull();
  });
});

describe("GitOpsInspector.readObject", () => {
  it("reads through the cluster's access target, as an investigation read under the AI run", async () => {
    const run: SpyInstance<typeof KubectlJobRunner.run> = mockCluster({
      "deployment/web": deployment(),
    });

    const read: KubectlObjectRead = await GitOpsInspector.readObject({
      projectId: PROJECT_ID,
      aiRunId: RUN_ID,
      cluster: CLUSTER,
      kind: "deployment",
      name: "web",
      namespace: "shop",
      stepId: "ai-gitops-1-before",
    });

    expect(read).toEqual({ found: true, object: deployment() });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        origin: RunnerJobOrigin.AiInvestigation,
        kubernetesClusterId: new ObjectID(CLUSTER_ID),
        targetRunnerId: new ObjectID(RUNNER_ID),
        command:
          "kubectl get deployment/web -n shop -o json --show-managed-fields",
        stepId: "ai-gitops-1-before",
      }),
    );
  });

  it("tells a missing object from a read that failed", async () => {
    mockCluster({ "deployment/api": "unreachable" });

    expect(
      await GitOpsInspector.readObject({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        cluster: CLUSTER,
        kind: "deployment",
        name: "web",
        namespace: "shop",
        stepId: "s",
      }),
    ).toEqual({ found: false, notFound: true });

    expect(
      await GitOpsInspector.readObject({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        cluster: CLUSTER,
        kind: "deployment",
        name: "api",
        namespace: "shop",
        stepId: "s",
      }),
    ).toEqual({
      found: false,
      notFound: false,
      reason: "No Runner picked the command up.",
    });
  });

  it("turns an enqueue that throws into a failed read", async () => {
    jest
      .spyOn(KubectlJobRunner, "run")
      .mockRejectedValue(new Error("hourly limit"));

    expect(
      await GitOpsInspector.readObject({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        cluster: CLUSTER,
        kind: "deployment",
        name: "web",
        namespace: "shop",
        stepId: "s",
      }),
    ).toEqual({ found: false, notFound: false, reason: "hourly limit" });
  });
});

describe("GitOpsInspector.inspectCommand", () => {
  it("reads the object a write names and says who declares it", async () => {
    mockCluster({
      "deployment/web": deployment({ annotations: ARGO_ANNOTATIONS }),
    });

    const inspection: GitOpsCommandInspection | null =
      await GitOpsInspector.inspectCommand({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        cluster: CLUSTER,
        command: "kubectl scale deployment/web --replicas=3 -n shop",
        stepIdPrefix: "ai-gitops-1",
      });

    expect(inspection?.before.found).toBe(true);
    expect(inspection?.gitOps).toMatchObject({
      controller: "ArgoCD",
      ownerName: "shop",
      objectKind: "deployment",
      objectName: "web",
      objectNamespace: "shop",
      putsBack: true,
      reconcilesOnItsOwn: true,
    });
  });

  it("follows a ReplicaSet to the Deployment that controls it", async () => {
    const run: SpyInstance<typeof KubectlJobRunner.run> = mockCluster({
      "replicaset/web-5b8c2d": deployment({
        kind: "ReplicaSet",
        name: "web-5b8c2d",
        ownerReferences: [
          { kind: "Deployment", name: "web", controller: true },
        ],
      }),
      "deployment/web": deployment({
        labels: {
          "kustomize.toolkit.fluxcd.io/name": "apps",
          "kustomize.toolkit.fluxcd.io/namespace": "flux-system",
        },
      }),
    });

    const inspection: GitOpsCommandInspection | null =
      await GitOpsInspector.inspectCommand({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        cluster: CLUSTER,
        command: "kubectl scale replicaset/web-5b8c2d --replicas=3 -n shop",
        stepIdPrefix: "ai-gitops-1",
      });

    expect(run).toHaveBeenCalledTimes(2);
    expect(inspection?.gitOps).toMatchObject({
      controller: "Flux",
      ownerKind: "Kustomization",
      objectKind: "deployment",
      objectName: "web",
    });
    // The watch is still of the object the command changes.
    expect(inspection?.watchTarget.target.name).toBe("web-5b8c2d");
  });

  it("says nobody declares an object with no markers, and keeps the read for the watch", async () => {
    mockCluster({ "deployment/web": deployment() });

    const inspection: GitOpsCommandInspection | null =
      await GitOpsInspector.inspectCommand({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        cluster: CLUSTER,
        command: "kubectl rollout restart deployment/web -n shop",
        stepIdPrefix: "ai-gitops-1",
      });

    expect(inspection?.gitOps).toBeUndefined();
    expect(inspection?.before).toEqual({ found: true, object: deployment() });
  });

  it("reads nothing for a command it does not watch", async () => {
    const run: SpyInstance<typeof KubectlJobRunner.run> = mockCluster({});

    expect(
      await GitOpsInspector.inspectCommand({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        cluster: CLUSTER,
        command: "kubectl delete pod web-1 -n shop",
        stepIdPrefix: "ai-gitops-1",
      }),
    ).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("GitOpsInspector.captureRevertWatch and checkRevertWatch", () => {
  const SCALE: string = "kubectl scale deployment/web --replicas=3 -n shop";

  async function inspectScale(): Promise<GitOpsCommandInspection> {
    mockCluster({ "deployment/web": deployment({ replicas: 1 }) });
    const inspection: GitOpsCommandInspection | null =
      await GitOpsInspector.inspectCommand({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        cluster: CLUSTER,
        command: SCALE,
        stepIdPrefix: "ai-gitops-1",
      });
    jest.restoreAllMocks();
    return inspection!;
  }

  it("records what the change did, read after it ran", async () => {
    const inspection: GitOpsCommandInspection = await inspectScale();
    mockCluster({ "deployment/web": deployment({ replicas: 3 }) });

    const watch: AiRemediationRevertWatch | null =
      await GitOpsInspector.captureRevertWatch({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        cluster: CLUSTER,
        inspection,
        stepId: "ai-gitops-1-after",
      });

    expect(watch).toMatchObject({
      kind: "deployment",
      name: "web",
      namespace: "shop",
      fields: [{ path: "spec.replicas", before: "1", after: "3" }],
    });
  });

  it("records nothing when the read after the change fails", async () => {
    const inspection: GitOpsCommandInspection = await inspectScale();
    mockCluster({ "deployment/web": "unreachable" });

    expect(
      await GitOpsInspector.captureRevertWatch({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        cluster: CLUSTER,
        inspection,
        stepId: "ai-gitops-1-after",
      }),
    ).toBeNull();
  });

  it("finds the change put back, holding, or cannot tell", async () => {
    const watch: AiRemediationRevertWatch = {
      kind: "deployment",
      name: "web",
      namespace: "shop",
      fields: [{ path: "spec.replicas", before: "1", after: "3" }],
      capturedAt: new Date().toISOString(),
    };

    for (const [object, expected] of [
      [deployment({ replicas: 1 }), ["spec.replicas"]],
      [deployment({ replicas: 3 }), []],
      ["unreachable", null],
    ] as Array<[JSONObject | "unreachable", Array<string> | null]>) {
      jest.restoreAllMocks();
      mockCluster({ "deployment/web": object });

      expect(
        await GitOpsInspector.checkRevertWatch({
          projectId: PROJECT_ID,
          aiRunId: RUN_ID,
          cluster: CLUSTER,
          watch,
          stepId: "ai-gitops-verify-1",
        }),
      ).toEqual(expected);
    }
  });
});

describe("GitOpsInspector on a cluster as it stands now", () => {
  it("reads through the access target the cluster's AI page resolves now, and gives up without one", async () => {
    const status: KubernetesClusterAiAccessStatus = {
      clusterId: CLUSTER_ID,
      clusterName: "prod",
      runner: {
        id: RUNNER_ID,
        name: "kubernetes-agent/prod",
        isOnline: true,
        canRunAiCommands: true,
      },
      accessMethod: "in_cluster",
      aiAgent: null,
      automaticInvestigation: { incidents: false, alerts: false },
      kubectlAllowlist: [],
      isInvestigationEnabled: true,
      isInvestigationReady: true,
      remediationMode: KubernetesAiRemediationMode.Automatic,
      isRemediationReady: true,
      gaps: [],
      evaluatedAt: new Date().toISOString(),
    } as unknown as KubernetesClusterAiAccessStatus;
    const getStatus: SpyInstance<
      typeof KubernetesClusterAiAccessService.getStatusForCluster
    > = jest
      .spyOn(KubernetesClusterAiAccessService, "getStatusForCluster")
      .mockResolvedValue(status);
    const run: SpyInstance<typeof KubectlJobRunner.run> = mockCluster({
      "deployment/web": deployment({ annotations: ARGO_ANNOTATIONS }),
    });

    const inspection: GitOpsCommandInspection | null =
      await GitOpsInspector.inspectCommandOnCluster({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        kubernetesClusterId: CLUSTER_ID,
        command: "kubectl rollout undo deployment/web -n shop",
        stepIdPrefix: "ai-gitops-approved-1",
      });

    expect(getStatus).toHaveBeenCalledWith({
      clusterId: new ObjectID(CLUSTER_ID),
      projectId: PROJECT_ID,
    });
    expect(inspection?.gitOps?.putsBack).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);

    getStatus.mockResolvedValue(null);
    expect(
      await GitOpsInspector.inspectCommandOnCluster({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        kubernetesClusterId: CLUSTER_ID,
        command: "kubectl rollout undo deployment/web -n shop",
        stepIdPrefix: "ai-gitops-approved-1",
      }),
    ).toBeNull();
    expect(
      await GitOpsInspector.checkRevertWatchOnCluster({
        projectId: PROJECT_ID,
        aiRunId: RUN_ID,
        kubernetesClusterId: "not-a-uuid",
        watch: {
          kind: "deployment",
          name: "web",
          namespace: "shop",
          fields: [{ path: "spec.replicas", before: "1", after: "3" }],
          capturedAt: new Date().toISOString(),
        },
        stepId: "ai-gitops-verify-1",
      }),
    ).toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
