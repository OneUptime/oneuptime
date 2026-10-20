import {
  LEGACY_KUBERNETES_STEP_FIELDS,
  LEGACY_KUBERNETES_STEP_JOB_KEY,
  getKubectlScriptForLegacyKubernetesStep,
  getLegacyKubernetesFields,
  getLegacyKubernetesStepForOlderRunner,
  hasLegacyKubernetesFields,
  isMovedKubernetesStepConfig,
  mayKeepLegacyKubernetesFields,
  readLegacyKubernetesStepOfJob,
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
 * A KUBERNETES STEP MOVED TO A KUBECTL SCRIPT, ON A RUNNER OLDER THAN THAT.
 *
 * The data migration moved each Kubernetes step to the kubectl script its
 * action became, and kept its credential and action beside the script, so
 * a Runner older than kubectl scripts is still handed the step as it was
 * written. These are the rules that decide it, shared by the migration,
 * the Worker that dispatches the step, the claim and every save:
 *
 *   - which fields are the legacy ones, and what a moved step is;
 *   - what an older Runner is handed: exactly what such a step was always
 *     dispatched with, for every action the step could take - or nothing,
 *     when the step cannot be handed over that way;
 *   - what a job carries for it, read back with nothing else in it;
 *   - and that a step keeps them only while it is the moved step: its
 *     script, kubeconfig and legacy fields as the runbook holds them.
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

describe("what a Runner older than kubectl scripts is handed for a moved step", () => {
  test.each(LEGACY_SHAPES)(
    "%s: the action and the credential, exactly as such a step was always dispatched",
    (_label: string, legacy: JSONObject) => {
      expect(getLegacyKubernetesStepForOlderRunner(moved(legacy))).toEqual(
        legacy,
      );
    },
  );

  test("nothing of the script's: no script, no kubeconfig, no Runner, no timeouts", () => {
    const handed: JSONObject | null = getLegacyKubernetesStepForOlderRunner(
      moved(SCALE, { timeoutInMs: 60_000, claimTimeoutInMs: 90_000 }),
    );

    expect(Object.keys(handed!).sort()).toEqual(
      [
        "action",
        "credentialId",
        "namespace",
        "replicas",
        "workloadKind",
        "workloadName",
      ].sort(),
    );
  });

  test.each([
    ["one that kept no credential", moved(RESTART, { credentialId: "  " })],
    [
      "one with no credential at all",
      { ...moved(RESTART), credentialId: undefined },
    ],
    ["one with no namespace", moved({ ...RESTART, namespace: "" })],
    ["one with no workload", moved({ ...RESTART, workloadName: "" })],
    ["a scale with no replica count", moved({ ...SCALE, replicas: undefined })],
    [
      "a scale whose replica count is empty",
      moved({ ...SCALE, replicas: null }),
    ],
    [
      "one whose script was changed",
      moved(RESTART, { script: "kubectl get pods --namespace web" }),
    ],
    [
      "one whose script was changed by a character",
      moved(SCALE, {
        script: `${getKubectlScriptForLegacyKubernetesStep(SCALE as never)} `,
      }),
    ],
    [
      "one whose action no longer matches its script",
      {
        ...moved(SCALE),
        replicas: 4,
      },
    ],
    [
      "one with no script: a step written with a credential runs as written",
      { ...RESTART },
    ],
    [
      "a step written as a script",
      { kubeconfig: KUBECONFIG, script: "kubectl get pods" },
    ],
    ["nothing", undefined],
  ])("none for %s", (_label: string, config: unknown) => {
    expect(getLegacyKubernetesStepForOlderRunner(config)).toBeNull();
  });
});

describe("the step a kubectl step's job carries for an older Runner", () => {
  test("is read back under its key, as it was put there", () => {
    const legacyStep: JSONObject | null = getLegacyKubernetesStepForOlderRunner(
      moved(SCALE),
    );

    expect(LEGACY_KUBERNETES_STEP_JOB_KEY).toBe("legacyStep");
    expect(
      readLegacyKubernetesStepOfJob({
        kubeconfig: KUBECONFIG,
        script: "kubectl patch ...",
        [LEGACY_KUBERNETES_STEP_JOB_KEY]: legacyStep,
      }),
    ).toEqual(SCALE);
  });

  test("with its legacy fields only: nothing else stored beside them is handed over", () => {
    expect(
      readLegacyKubernetesStepOfJob({
        [LEGACY_KUBERNETES_STEP_JOB_KEY]: {
          ...RESTART,
          kubeconfig: KUBECONFIG,
          token: "sa-token",
          script: "cat /etc/shadow",
        },
      }),
    ).toEqual(RESTART);
  });

  test.each([
    ["a job that carries none", { kubeconfig: KUBECONFIG, script: "ls" }],
    [
      "one that names no credential",
      { [LEGACY_KUBERNETES_STEP_JOB_KEY]: { ...RESTART, credentialId: "" } },
    ],
    [
      "one that names no namespace",
      { [LEGACY_KUBERNETES_STEP_JOB_KEY]: { ...RESTART, namespace: "" } },
    ],
    [
      "one that names no workload",
      { [LEGACY_KUBERNETES_STEP_JOB_KEY]: { ...RESTART, workloadName: "" } },
    ],
    ["one that is not an object", { [LEGACY_KUBERNETES_STEP_JOB_KEY]: "x" }],
    // A step written with a credential carries it at the top: that is no moved step.
    ["a step written with a credential", { ...RESTART }],
    ["no payload", undefined],
  ])("none from %s", (_label: string, payload: unknown) => {
    expect(readLegacyKubernetesStepOfJob(payload)).toBeNull();
  });
});

describe("whether a saved step keeps them", () => {
  test.each(LEGACY_SHAPES)(
    "%s, saved as the runbook holds it: kept",
    (_label: string, legacy: JSONObject) => {
      expect(
        mayKeepLegacyKubernetesFields({
          config: moved(legacy),
          heldConfig: moved(legacy),
        }),
      ).toBe(true);
    },
  );

  test("its Runner, timeouts and a kubeconfig written with spaces change nothing it does: kept", () => {
    expect(
      mayKeepLegacyKubernetesFields({
        config: moved(RESTART, {
          agentId: "eeeeeeee-0000-4000-8000-000000000009",
          timeoutInMs: 120_000,
          claimTimeoutInMs: 30_000,
          kubeconfig: ` ${KUBECONFIG} `,
        }),
        heldConfig: moved(RESTART),
      }),
    ).toBe(true);
  });

  test.each([
    [
      "its script was changed",
      moved(RESTART, {
        script: "kubectl rollout restart deployment/api -n web",
      }),
    ],
    [
      "a line was added to its script",
      moved(RESTART, {
        script: `${getKubectlScriptForLegacyKubernetesStep(RESTART as never)}kubectl get pods -n web\n`,
      }),
    ],
    [
      "its kubeconfig is another variable",
      moved(RESTART, { kubeconfig: "{{global.variables.staging-kubeconfig}}" }),
    ],
    [
      "its kubeconfig is the Runner's own access",
      moved(RESTART, { kubeconfig: "" }),
    ],
    [
      "it names another credential",
      moved(RESTART, { credentialId: "cccccccc-0000-4000-8000-000000000009" }),
    ],
    [
      "its action and script were both changed to another action",
      moved({
        ...RESTART,
        action: KubernetesAction.ScaleWorkload,
        replicas: 1,
      }),
    ],
    [
      "its namespace and script were both changed",
      moved({ ...RESTART, namespace: "staging" }),
    ],
    [
      "its workload kind and script were both changed",
      moved({ ...RESTART, workloadKind: KubernetesWorkloadKind.StatefulSet }),
    ],
    [
      "its workload and script were both changed",
      moved({ ...RESTART, workloadName: "web" }),
    ],
    ["it gained a replica count", moved({ ...RESTART, replicas: 2 })],
  ])("%s: dropped", (_label: string, config: JSONObject) => {
    expect(
      mayKeepLegacyKubernetesFields({
        config,
        heldConfig: moved(RESTART),
      }),
    ).toBe(false);
  });

  test("a scale whose replica count and script were both changed: dropped", () => {
    expect(
      mayKeepLegacyKubernetesFields({
        config: moved({ ...SCALE, replicas: 10 }),
        heldConfig: moved(SCALE),
      }),
    ).toBe(false);
  });

  test.each([
    ["the runbook does not hold it", undefined],
    ["the runbook holds it as a step written with a credential", RESTART],
    [
      "the runbook holds it as a script with nothing kept",
      withoutLegacyKubernetesFields(moved(RESTART)),
    ],
    [
      "the runbook holds a script that is not the one its action became",
      moved(RESTART, { script: "kubectl get pods" }),
    ],
  ])(
    "a step the migration did not leave as it is: dropped, when %s",
    (_label: string, heldConfig: unknown) => {
      expect(
        mayKeepLegacyKubernetesFields({
          config: moved(RESTART),
          heldConfig,
        }),
      ).toBe(false);
    },
  );

  test("a step that holds a script that is not the one its action became keeps nothing, even unchanged", () => {
    const stale: JSONObject = moved(RESTART, { script: "kubectl get pods" });

    expect(
      mayKeepLegacyKubernetesFields({ config: stale, heldConfig: stale }),
    ).toBe(false);
  });
});
