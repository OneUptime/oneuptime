import {
  AiRemediationCommandGitOps,
  AiRemediationGitOpsOwner,
  GitOpsController,
  MAX_GITOPS_TEXT_CHARS,
} from "../../../Types/AutoRemediation/AiRemediationGitOps";
import { JSONObject } from "../../../Types/JSON";
import {
  GitOpsChangeEffect,
  buildOwnershipReadCommand,
  classifyGitOpsChange,
  declaresReplicas,
  describeGitOpsChange,
  describeGitOpsOwner,
  parseArgoCdTrackingId,
  readControllerReference,
  readGitOpsOwner,
} from "../../../Utils/AiRemediation/GitOpsOwnership";
import KubectlPolicy, {
  KubectlNamedObject,
  KubectlPolicyResult,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import { describe, expect, it } from "@jest/globals";

/*
 * Who declares a Kubernetes object, read from the markers Argo CD, Flux and
 * Helm leave on what they manage, and what that means for a kubectl fix of
 * it. The objects below carry the markers as the controllers write them
 * (HelmChart/Tests/suites/gitops-revert.sh reads them off real ones).
 */

function deployment(data: {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  managedFields?: Array<JSONObject>;
  ownerReferences?: Array<JSONObject>;
  spec?: JSONObject;
}): JSONObject {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: "web",
      namespace: "shop",
      labels: data.labels || {},
      annotations: data.annotations || {},
      ...(data.managedFields ? { managedFields: data.managedFields } : {}),
      ...(data.ownerReferences
        ? { ownerReferences: data.ownerReferences }
        : {}),
    } as JSONObject,
    spec: data.spec || { replicas: 1 },
  } as JSONObject;
}

function managed(manager: string, fields: JSONObject): JSONObject {
  return {
    manager,
    operation: manager === "helm" ? "Update" : "Apply",
    apiVersion: "apps/v1",
    fieldsType: "FieldsV1",
    fieldsV1: fields,
  } as JSONObject;
}

// The one object a kubectl write names, as the policy reads it.
function target(command: string): KubectlNamedObject {
  const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(command);
  expect(policy.tier).not.toBe(KubectlCommandTier.Denied);
  const named: KubectlNamedObject | null = KubectlPolicy.getNamedObject(
    policy.args,
  );
  expect(named).not.toBeNull();
  return named!;
}

const ARGO_OWNER: AiRemediationGitOpsOwner = {
  controller: GitOpsController.ArgoCD,
  ownerKind: "Application",
  ownerName: "shop",
  evidence: "annotation argocd.argoproj.io/tracking-id",
};

const FLUX_OWNER: AiRemediationGitOpsOwner = {
  controller: GitOpsController.Flux,
  ownerKind: "Kustomization",
  ownerName: "apps",
  ownerNamespace: "flux-system",
  evidence: "label kustomize.toolkit.fluxcd.io/name",
};

const HELM_OWNER: AiRemediationGitOpsOwner = {
  controller: GitOpsController.Helm,
  ownerKind: "release",
  ownerName: "web",
  ownerNamespace: "shop",
  evidence: "annotation meta.helm.sh/release-name",
};

describe("readGitOpsOwner: Argo CD", () => {
  it("reads the Application from its tracking annotation", () => {
    expect(
      readGitOpsOwner(
        deployment({
          annotations: {
            "argocd.argoproj.io/tracking-id": "shop:apps/Deployment:shop/web",
          },
        }),
      ),
    ).toEqual({
      controller: GitOpsController.ArgoCD,
      ownerKind: "Application",
      ownerName: "shop",
      evidence: "annotation argocd.argoproj.io/tracking-id",
    });
  });

  it("reads an Application outside Argo CD's namespace from <namespace>_<app>", () => {
    expect(
      parseArgoCdTrackingId("team-a_checkout:apps/Deployment:shop/web"),
    ).toEqual({ namespace: "team-a", name: "checkout" });
    expect(
      readGitOpsOwner(
        deployment({
          annotations: {
            "argocd.argoproj.io/tracking-id":
              "team-a_checkout:apps/Deployment:shop/web",
          },
        }),
      ),
    ).toMatchObject({ ownerName: "checkout", ownerNamespace: "team-a" });
  });

  it("reads the instance label Argo CD recommends instead of app.kubernetes.io/instance", () => {
    expect(
      readGitOpsOwner(
        deployment({ labels: { "argocd.argoproj.io/instance": "shop" } }),
      ),
    ).toMatchObject({
      controller: GitOpsController.ArgoCD,
      ownerName: "shop",
      evidence: "label argocd.argoproj.io/instance",
    });
  });

  it("reads Argo CD's field manager, naming the Application from the label it tracks by", () => {
    expect(
      readGitOpsOwner(
        deployment({
          labels: { "app.kubernetes.io/instance": "shop" },
          managedFields: [managed("argocd-controller", { "f:spec": {} })],
        }),
      ),
    ).toEqual({
      controller: GitOpsController.ArgoCD,
      ownerKind: "Application",
      ownerName: "shop",
      evidence: "field manager argocd-controller",
    });
  });

  it("wins over the managed-by: Helm label of a chart Argo CD renders", () => {
    expect(
      readGitOpsOwner(
        deployment({
          labels: { "app.kubernetes.io/managed-by": "Helm" },
          annotations: {
            "argocd.argoproj.io/tracking-id": "shop:apps/Deployment:shop/web",
          },
        }),
      )?.controller,
    ).toBe(GitOpsController.ArgoCD);
  });
});

describe("readGitOpsOwner: Flux", () => {
  it("reads a Kustomization from its labels", () => {
    expect(
      readGitOpsOwner(
        deployment({
          labels: {
            "kustomize.toolkit.fluxcd.io/name": "apps",
            "kustomize.toolkit.fluxcd.io/namespace": "flux-system",
          },
        }),
      ),
    ).toEqual(FLUX_OWNER);
  });

  it("reads a HelmRelease from its labels, over the Helm release annotations it also leaves", () => {
    expect(
      readGitOpsOwner(
        deployment({
          labels: {
            "helm.toolkit.fluxcd.io/name": "web",
            "helm.toolkit.fluxcd.io/namespace": "flux-system",
            "app.kubernetes.io/managed-by": "Helm",
          },
          annotations: {
            "meta.helm.sh/release-name": "shop-web",
            "meta.helm.sh/release-namespace": "shop",
          },
        }),
      ),
    ).toEqual({
      controller: GitOpsController.Flux,
      ownerKind: "HelmRelease",
      ownerName: "web",
      ownerNamespace: "flux-system",
      evidence: "label helm.toolkit.fluxcd.io/name",
    });
  });

  it("reads Flux's field managers when the labels are gone", () => {
    expect(
      readGitOpsOwner(
        deployment({
          managedFields: [managed("kustomize-controller", { "f:spec": {} })],
        }),
      ),
    ).toMatchObject({
      controller: GitOpsController.Flux,
      ownerKind: "Kustomization",
      ownerName: "",
      evidence: "field manager kustomize-controller",
    });
    expect(
      readGitOpsOwner(
        deployment({
          managedFields: [managed("helm-controller", { "f:spec": {} })],
        }),
      ),
    ).toMatchObject({
      controller: GitOpsController.Flux,
      ownerKind: "HelmRelease",
    });
  });
});

describe("readGitOpsOwner: Helm", () => {
  it("reads a release from its annotations", () => {
    expect(
      readGitOpsOwner(
        deployment({
          labels: { "app.kubernetes.io/managed-by": "Helm" },
          annotations: {
            "meta.helm.sh/release-name": "web",
            "meta.helm.sh/release-namespace": "shop",
          },
        }),
      ),
    ).toEqual(HELM_OWNER);
  });

  it("reads the managed-by label alone, naming the release from the instance label", () => {
    expect(
      readGitOpsOwner(
        deployment({
          labels: {
            "app.kubernetes.io/managed-by": "Helm",
            "app.kubernetes.io/instance": "web",
          },
        }),
      ),
    ).toEqual({
      controller: GitOpsController.Helm,
      ownerKind: "release",
      ownerName: "web",
      evidence: "label app.kubernetes.io/managed-by=Helm",
    });
  });

  it("reads Helm's field manager", () => {
    expect(
      readGitOpsOwner(
        deployment({ managedFields: [managed("helm", { "f:spec": {} })] }),
      ),
    ).toMatchObject({ controller: GitOpsController.Helm, ownerName: "" });
  });
});

describe("readGitOpsOwner: nobody", () => {
  it("says nothing for an object no controller marked", () => {
    expect(readGitOpsOwner(deployment({}))).toBeNull();
    expect(readGitOpsOwner({} as JSONObject)).toBeNull();
    expect(
      readGitOpsOwner({ metadata: "not an object" } as unknown as JSONObject),
    ).toBeNull();
  });

  it("does not take app.kubernetes.io/instance alone for Argo CD: Helm charts and hand-written manifests set it too", () => {
    expect(
      readGitOpsOwner(
        deployment({
          labels: { "app.kubernetes.io/instance": "shop" },
          annotations: {
            "kubectl.kubernetes.io/last-applied-configuration": "{}",
          },
          managedFields: [managed("kubectl-client-side-apply", {})],
        }),
      ),
    ).toBeNull();
  });

  it("cuts every value it takes from the cluster to a Kubernetes name's length", () => {
    const owner: AiRemediationGitOpsOwner | null = readGitOpsOwner(
      deployment({
        labels: {
          "kustomize.toolkit.fluxcd.io/name": "a".repeat(5000),
          "kustomize.toolkit.fluxcd.io/namespace": "b".repeat(5000),
        },
      }),
    );

    expect(owner?.ownerName).toHaveLength(253);
    expect(owner?.ownerNamespace).toHaveLength(253);
  });
});

describe("readControllerReference", () => {
  it("is the owner reference that controls the object", () => {
    expect(
      readControllerReference(
        deployment({
          ownerReferences: [
            { kind: "Something", name: "other", controller: false },
            { kind: "Deployment", name: "web", controller: true },
          ],
        }),
      ),
    ).toEqual({ kind: "deployment", name: "web" });
  });

  it("is null without one", () => {
    expect(readControllerReference(deployment({}))).toBeNull();
    expect(
      readControllerReference(
        deployment({ ownerReferences: [{ kind: "Deployment", name: "web" }] }),
      ),
    ).toBeNull();
  });
});

describe("declaresReplicas", () => {
  it("reads the owner's field manager: replicas declared, or left to the cluster", () => {
    expect(
      declaresReplicas(
        deployment({
          managedFields: [
            managed("kustomize-controller", {
              "f:spec": { "f:replicas": {}, "f:template": {} },
            }),
            managed("kube-controller-manager", {
              "f:status": {},
            }),
          ],
        }),
        FLUX_OWNER,
      ),
    ).toBe(true);
    expect(
      declaresReplicas(
        deployment({
          managedFields: [
            managed("kustomize-controller", { "f:spec": { "f:template": {} } }),
            // Someone else's scale says nothing about what git declares.
            managed("kubectl", { "f:spec": { "f:replicas": {} } }),
          ],
        }),
        FLUX_OWNER,
      ),
    ).toBe(false);
  });

  it("reads the manifest a client-side apply recorded when the owner's manager is not on the object", () => {
    expect(
      declaresReplicas(
        deployment({
          annotations: {
            "kubectl.kubernetes.io/last-applied-configuration": JSON.stringify({
              spec: { replicas: 2 },
            }),
          },
        }),
        ARGO_OWNER,
      ),
    ).toBe(true);
    expect(
      declaresReplicas(
        deployment({
          annotations: {
            "kubectl.kubernetes.io/last-applied-configuration": JSON.stringify({
              spec: { template: {} },
            }),
          },
        }),
        ARGO_OWNER,
      ),
    ).toBe(false);
  });

  it("says nothing when the object says neither way", () => {
    expect(declaresReplicas(deployment({}), ARGO_OWNER)).toBeUndefined();
    expect(
      declaresReplicas(
        deployment({
          annotations: {
            "kubectl.kubernetes.io/last-applied-configuration": "{not json",
          },
        }),
        ARGO_OWNER,
      ),
    ).toBeUndefined();
  });
});

describe("classifyGitOpsChange", () => {
  function effectOf(
    command: string,
    object: JSONObject = deployment({}),
  ): GitOpsChangeEffect {
    return classifyGitOpsChange({
      target: target(command),
      object,
      owner: ARGO_OWNER,
    });
  }

  it("puts back a change of what git declares", () => {
    for (const command of [
      "kubectl rollout undo deployment/web -n shop",
      "kubectl set image deployment/web app=web:2 -n shop",
      "kubectl set env deployment/web MODE=b -n shop",
      "kubectl set resources deployment/web -c app --limits=memory=1Gi -n shop",
      `kubectl patch deployment/web -n shop -p '{"spec":{"template":{"spec":{"terminationGracePeriodSeconds":7}}}}'`,
      "kubectl delete deployment/web -n shop",
    ]) {
      expect(effectOf(command).putsBack).toBe(true);
    }
  });

  it("keeps a change git does not declare", () => {
    for (const command of [
      "kubectl rollout restart deployment/web -n shop",
      "kubectl rollout pause deployment/web -n shop",
      "kubectl rollout resume deployment/web -n shop",
      "kubectl annotate deployment/web example.com/note=ai -n shop",
      "kubectl label deployment/web example.com/tier=hot -n shop",
    ]) {
      expect(effectOf(command).putsBack).toBe(false);
    }
  });

  it("puts a scale back when git declares replicas, or when nothing says it does not", () => {
    expect(
      effectOf(
        "kubectl scale deployment/web --replicas=3 -n shop",
        deployment({
          managedFields: [
            managed("argocd-controller", { "f:spec": { "f:replicas": {} } }),
          ],
        }),
      ),
    ).toEqual({ putsBack: true, edits: "its replica count" });
    expect(
      effectOf("kubectl scale deployment/web --replicas=3 -n shop").putsBack,
    ).toBe(true);
  });

  it("keeps a scale when git leaves replicas to the cluster", () => {
    expect(
      effectOf(
        "kubectl scale deployment/web --replicas=3 -n shop",
        deployment({
          managedFields: [
            managed("argocd-controller", { "f:spec": { "f:template": {} } }),
          ],
        }),
      ).putsBack,
    ).toBe(false);
  });
});

describe("describeGitOpsChange", () => {
  function describeFor(
    owner: AiRemediationGitOpsOwner,
    command: string,
  ): AiRemediationCommandGitOps {
    return describeGitOpsChange({
      owner,
      effect: classifyGitOpsChange({
        target: target(command),
        object: deployment({}),
        owner,
      }),
      objectKind: "deployment",
      objectName: "web",
      objectNamespace: "shop",
    });
  }

  it("calls a change Argo CD puts back a stopgap, and names git as where the lasting fix goes", () => {
    const gitOps: AiRemediationCommandGitOps = describeFor(
      ARGO_OWNER,
      "kubectl set image deployment/web app=web:2 -n shop",
    );

    expect(gitOps).toMatchObject({
      controller: GitOpsController.ArgoCD,
      ownerName: "shop",
      objectKind: "deployment",
      objectName: "web",
      objectNamespace: "shop",
      putsBack: true,
      reconcilesOnItsOwn: true,
    });
    expect(gitOps.summary).toBe(
      'Argo CD Application "shop" declares deployment/web (annotation argocd.argoproj.io/tracking-id), and this change edits a container image: Argo CD puts it back to what git declares: within seconds when the Application has self-heal on, otherwise at its next sync. Treat it as a stopgap - the lasting fix is the same change in git (the manifest, Helm values or Kustomize overlay it is built from).',
    );
  });

  it("says when Flux puts it back", () => {
    expect(
      describeFor(FLUX_OWNER, "kubectl rollout undo deployment/web -n shop")
        .summary,
    ).toContain(
      'Flux Kustomization "apps" (namespace flux-system) declares deployment/web',
    );
    expect(
      describeFor(FLUX_OWNER, "kubectl rollout undo deployment/web -n shop")
        .summary,
    ).toContain("at its next reconciliation");
  });

  it("says a Helm release puts it back at its next upgrade, and does not reconcile on its own", () => {
    const gitOps: AiRemediationCommandGitOps = describeFor(
      HELM_OWNER,
      "kubectl scale deployment/web --replicas=3 -n shop",
    );

    expect(gitOps.reconcilesOnItsOwn).toBe(false);
    expect(gitOps.putsBack).toBe(true);
    expect(gitOps.summary).toContain(
      "nothing puts it back on its own, but the release's next helm upgrade does",
    );
    expect(gitOps.summary).toContain("chart values");
  });

  it("says a restart stays", () => {
    const gitOps: AiRemediationCommandGitOps = describeFor(
      ARGO_OWNER,
      "kubectl rollout restart deployment/web -n shop",
    );

    expect(gitOps.putsBack).toBe(false);
    expect(gitOps.summary).toContain("so it stays");
  });

  it("keeps the summary to its cap whatever the names", () => {
    expect(
      describeFor(
        { ...ARGO_OWNER, ownerName: "x".repeat(5000) },
        "kubectl rollout undo deployment/web -n shop",
      ).summary.length,
    ).toBeLessThanOrEqual(MAX_GITOPS_TEXT_CHARS);
  });
});

describe("describeGitOpsOwner", () => {
  it("names each owner the way a sentence needs it", () => {
    expect(describeGitOpsOwner(ARGO_OWNER)).toBe('Argo CD Application "shop"');
    expect(describeGitOpsOwner(FLUX_OWNER)).toBe(
      'Flux Kustomization "apps" (namespace flux-system)',
    );
    expect(describeGitOpsOwner(HELM_OWNER)).toBe(
      'Helm release "web" (namespace shop)',
    );
    expect(describeGitOpsOwner({ ...HELM_OWNER, ownerName: "" })).toBe(
      "a Helm release",
    );
  });
});

describe("buildOwnershipReadCommand", () => {
  it("is a read the kubectl policy runs as one", () => {
    const command: string = buildOwnershipReadCommand({
      kind: "deployment",
      name: "web",
      namespace: "shop",
    });

    expect(command).toBe(
      "kubectl get deployment/web -n shop -o json --show-managed-fields",
    );
    expect(KubectlPolicy.evaluateCommand(command).tier).toBe(
      KubectlCommandTier.Read,
    );
  });
});
