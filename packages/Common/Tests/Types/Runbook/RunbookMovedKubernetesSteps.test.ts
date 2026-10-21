import * as LegacySteps from "../../../Types/Runbook/RunbookLegacySteps";
import {
  LEGACY_KUBERNETES_STEP_FIELDS,
  getKubectlScriptForLegacyKubernetesStep,
  getLegacyKubernetesFields,
  hasLegacyKubernetesFields,
  isMovedKubernetesStepConfig,
  withoutLegacyKubernetesFields,
} from "../../../Types/Runbook/RunbookLegacySteps";
import { JSONObject } from "../../../Types/JSON";
import {
  KubernetesAction,
  KubernetesWorkloadKind,
  isLegacyKubernetesStepConfig,
} from "../../../Types/Runbook/RunbookStep";
import { describe, expect, test } from "@jest/globals";

/*
 * A KUBERNETES STEP MOVED TO A KUBECTL SCRIPT.
 *
 * The data migration moved each Kubernetes step to the kubectl script its
 * action became. Its first release also kept the step's credential and
 * action beside the script, so a Runner older than kubectl scripts was
 * still handed the step as it was written. Runbook credentials are gone,
 * and that fallback with them: the removal's data migration takes the
 * kept fields off, and nothing hands a step to an older Runner any more.
 * What is left is shared by the migrations and the step editor:
 *
 *   - which fields are the legacy ones, and what a moved step that kept
 *     them is;
 *   - the kubectl script each action becomes;
 *   - taking the kept fields off, leaving everything else.
 */

const CREDENTIAL_ID: string = "cccccccc-0000-4000-8000-000000000002";
const KUBECONFIG: string = "{{global.variables.prod_cluster-kubeconfig}}";

// Every shape a Kubernetes step could be written with before kubectl scripts.
const LEGACY_SHAPES: Array<[string, JSONObject]> = [
  [
    "a Deployment restarted",
    {
      credentialId: CREDENTIAL_ID,
      action: KubernetesAction.RestartWorkload,
      workloadKind: KubernetesWorkloadKind.Deployment,
      namespace: "web",
      workloadName: "api",
    },
  ],
  [
    "a StatefulSet restarted",
    {
      credentialId: CREDENTIAL_ID,
      action: KubernetesAction.RestartWorkload,
      workloadKind: KubernetesWorkloadKind.StatefulSet,
      namespace: "db",
      workloadName: "postgres",
    },
  ],
  [
    "a DaemonSet restarted",
    {
      credentialId: CREDENTIAL_ID,
      action: KubernetesAction.RestartWorkload,
      workloadKind: KubernetesWorkloadKind.DaemonSet,
      namespace: "monitoring",
      workloadName: "node-exporter",
    },
  ],
  [
    "a restart with no action named",
    {
      credentialId: CREDENTIAL_ID,
      workloadKind: KubernetesWorkloadKind.Deployment,
      namespace: "web",
      workloadName: "api",
    },
  ],
  [
    "a Deployment scaled",
    {
      credentialId: CREDENTIAL_ID,
      action: KubernetesAction.ScaleWorkload,
      workloadKind: KubernetesWorkloadKind.Deployment,
      namespace: "web",
      workloadName: "api",
      replicas: 3,
    },
  ],
  [
    "a StatefulSet scaled to zero",
    {
      credentialId: CREDENTIAL_ID,
      action: KubernetesAction.ScaleWorkload,
      workloadKind: KubernetesWorkloadKind.StatefulSet,
      namespace: "jobs",
      workloadName: "workers",
      replicas: 0,
    },
  ],
  [
    "a restart that carried a replica count it never used",
    {
      credentialId: CREDENTIAL_ID,
      action: KubernetesAction.RestartWorkload,
      workloadKind: KubernetesWorkloadKind.Deployment,
      namespace: "web",
      workloadName: "api",
      replicas: 5,
    },
  ],
];

// A step as the migration leaves it: the script, the kubeconfig, and the legacy fields.
function moved(legacy: JSONObject, extra: JSONObject = {}): JSONObject {
  return {
    kubeconfig: KUBECONFIG,
    script: getKubectlScriptForLegacyKubernetesStep(legacy as never),
    agentId: "eeeeeeee-0000-4000-8000-000000000001",
    ...legacy,
    ...extra,
  };
}

const RESTART: JSONObject = LEGACY_SHAPES[0]![1];
const SCALE: JSONObject = LEGACY_SHAPES[4]![1];

describe("the legacy fields", () => {
  test("are the fields a Kubernetes step was written with", () => {
    expect(LEGACY_KUBERNETES_STEP_FIELDS).toEqual([
      "credentialId",
      "action",
      "workloadKind",
      "namespace",
      "workloadName",
      "replicas",
    ]);
  });

  test("are read as a step holds them, and nothing else", () => {
    expect(getLegacyKubernetesFields(moved(SCALE))).toEqual(SCALE);
    expect(
      getLegacyKubernetesFields({
        script: "kubectl get pods",
        kubeconfig: KUBECONFIG,
        timeoutInMs: 1000,
      }),
    ).toEqual({});
    // Zero is a replica count; an empty field (null) is none.
    expect(getLegacyKubernetesFields({ replicas: 0, namespace: null })).toEqual(
      { replicas: 0 },
    );
    expect(getLegacyKubernetesFields(undefined)).toEqual({});
    expect(getLegacyKubernetesFields("config")).toEqual({});
  });

  test("a moved step is a script that kept them; a step written with a credential has no script", () => {
    expect(isMovedKubernetesStepConfig(moved(RESTART))).toBe(true);
    expect(hasLegacyKubernetesFields(moved(RESTART))).toBe(true);

    // Written with a credential: no script. It runs as written, on every Runner.
    expect(isMovedKubernetesStepConfig(RESTART)).toBe(false);
    expect(isLegacyKubernetesStepConfig(RESTART)).toBe(true);

    // Written as a script: nothing kept.
    expect(
      isMovedKubernetesStepConfig({
        kubeconfig: KUBECONFIG,
        script: "kubectl get pods",
      }),
    ).toBe(false);
    expect(
      isMovedKubernetesStepConfig({ ...moved(RESTART), script: "  " }),
    ).toBe(false);
  });

  test("are taken out of a step, and everything else is left", () => {
    const step: JSONObject = moved(SCALE, { timeoutInMs: 60_000 });
    const without: JSONObject = withoutLegacyKubernetesFields(step);

    expect(without).toEqual({
      kubeconfig: KUBECONFIG,
      script: step["script"],
      agentId: step["agentId"],
      timeoutInMs: 60_000,
    });
    // The step itself is not changed.
    expect(step["credentialId"]).toBe(CREDENTIAL_ID);
    expect(isMovedKubernetesStepConfig(without)).toBe(false);
  });
});

/*
 * Every action a step could be written with becomes a kubectl script that
 * names its workload and namespace: the script is what runs now, on every
 * Runner that runs kubectl scripts.
 */
describe("the kubectl script a step's action became", () => {
  test.each(LEGACY_SHAPES)(
    "%s: a kubectl command on the workload, in its namespace",
    (_label: string, legacy: JSONObject) => {
      const script: string = getKubectlScriptForLegacyKubernetesStep(
        legacy as never,
      );

      expect(script).toContain("kubectl");
      expect(script).toContain(String(legacy["workloadName"]));
      expect(script).toContain(`--namespace ${String(legacy["namespace"])}`);
      // The script needs no credential: the kubeconfig variable signs in.
      expect(script).not.toContain(CREDENTIAL_ID);
    },
  );
});

/*
 * The first release of the move handed a moved step to a Runner older than
 * kubectl scripts - from the Worker that dispatched it, the claim and every
 * save. Runbook credentials are gone, and that fallback with them.
 */
describe("a Runner older than kubectl scripts", () => {
  test("is handed nothing any more: the fallback went with runbook credentials", () => {
    for (const gone of [
      "LEGACY_KUBERNETES_STEP_JOB_KEY",
      "getLegacyKubernetesStepForOlderRunner",
      "readLegacyKubernetesStepOfJob",
      "mayKeepLegacyKubernetesFields",
      "readKubeconfig",
    ]) {
      expect({ gone, exported: gone in LegacySteps }).toEqual({
        gone,
        exported: false,
      });
    }
  });
});
