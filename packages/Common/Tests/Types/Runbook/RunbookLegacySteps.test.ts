import {
  getKubectlScriptForLegacyKubernetesStep,
  isSshPrivateKey,
} from "../../../Types/Runbook/RunbookLegacySteps";
import {
  KubernetesAction,
  KubernetesWorkloadKind,
  isLegacyKubernetesStepConfig,
  isLegacySSHStepConfig,
} from "../../../Types/Runbook/RunbookStep";
import { shellQuote } from "../../../Types/Runbook/ShellWord";
import { describe, expect, test } from "@jest/globals";
import { execFileSync } from "child_process";

/*
 * WHAT A STEP WRITTEN BEFORE RUNBOOK VARIABLES BECOMES.
 *
 * A Kubernetes step picked an action from dropdowns; it is a kubectl script
 * now. The script that replaces one makes the same change the Runner's
 * KubernetesExecutor made - the same PATCH, so a service account allowed
 * only "patch" still may - or fails the step with the reason the old one
 * failed for. An SSH step signs in with a secret variable now, a key or a
 * password - told apart by the value itself.
 */

// The lines bash runs: comments left out.
function commandsOf(script: string): string {
  return script
    .split("\n")
    .filter((line: string): boolean => {
      return !line.trim().startsWith("#");
    })
    .join("\n");
}

describe("getKubectlScriptForLegacyKubernetesStep", () => {
  test("a restart patches the pod template's restartedAt annotation, as kubectl rollout restart does", () => {
    const script: string = getKubectlScriptForLegacyKubernetesStep({
      action: KubernetesAction.RestartWorkload,
      workloadKind: KubernetesWorkloadKind.Deployment,
      namespace: "checkout",
      workloadName: "checkout-api",
    });

    expect(script).toContain("kubectl.kubernetes.io/restartedAt");
    expect(script).toContain(
      'kubectl patch deployment checkout-api --namespace checkout --patch "$patch"',
    );
    // Only patch: no get, no rollout.
    expect(commandsOf(script)).not.toMatch(/kubectl (get|rollout)/);
  });

  test("a restart with no action named is a restart, as the old default was", () => {
    expect(
      getKubectlScriptForLegacyKubernetesStep({
        workloadKind: KubernetesWorkloadKind.StatefulSet,
        namespace: "db",
        workloadName: "postgres",
      }),
    ).toContain("kubectl patch statefulset postgres --namespace db --patch");
  });

  test("a scale patches the scale subresource to the replica count, zero included", () => {
    expect(
      getKubectlScriptForLegacyKubernetesStep({
        action: KubernetesAction.ScaleWorkload,
        workloadKind: KubernetesWorkloadKind.Deployment,
        namespace: "web",
        workloadName: "api",
        replicas: 0,
      }),
    ).toContain(
      `kubectl patch deployment api --namespace web --subresource scale --patch '{"spec":{"replicas":0}}'`,
    );
  });

  test("names that are not plain words are quoted for the shell", () => {
    const script: string = getKubectlScriptForLegacyKubernetesStep({
      action: KubernetesAction.RestartWorkload,
      workloadKind: KubernetesWorkloadKind.DaemonSet,
      namespace: "ns; rm -rf /",
      workloadName: "it's",
    });

    expect(script).toContain(
      `kubectl patch daemonset ${shellQuote("it's")} --namespace ${shellQuote("ns; rm -rf /")}`,
    );
  });

  test.each([
    [
      "a DaemonSet scaled",
      {
        action: KubernetesAction.ScaleWorkload,
        workloadKind: KubernetesWorkloadKind.DaemonSet,
        namespace: "n",
        workloadName: "w",
        replicas: 2,
      },
      "A DaemonSet cannot be scaled",
    ],
    [
      "a scale with no replica count",
      {
        action: KubernetesAction.ScaleWorkload,
        workloadKind: KubernetesWorkloadKind.Deployment,
        namespace: "n",
        workloadName: "w",
      },
      "Scale step needs a replica count.",
    ],
    [
      "no namespace",
      {
        action: KubernetesAction.RestartWorkload,
        workloadKind: KubernetesWorkloadKind.Deployment,
        workloadName: "w",
      },
      "This step needs a namespace and a workload name.",
    ],
    [
      "a workload kind it never had",
      {
        action: KubernetesAction.RestartWorkload,
        workloadKind: "CronJob" as KubernetesWorkloadKind,
        namespace: "n",
        workloadName: "w",
      },
      "Unsupported workload kind: CronJob",
    ],
    [
      "an action it never had",
      {
        action: "delete-workload" as KubernetesAction,
        workloadKind: KubernetesWorkloadKind.Deployment,
        namespace: "n",
        workloadName: "w",
      },
      "Unsupported Kubernetes action: delete-workload",
    ],
  ])(
    "%s becomes a script that fails the step with the reason",
    (_label: string, config: Record<string, unknown>, reason: string) => {
      const script: string = getKubectlScriptForLegacyKubernetesStep(
        config as never,
      );

      expect(script).toContain(reason);
      expect(script).toContain("exit 1");
      expect(commandsOf(script)).not.toMatch(/^kubectl /m);

      // And it does fail, saying why, when bash runs it.
      let failed: boolean = false;
      try {
        execFileSync("bash", ["-c", script], { stdio: "pipe" });
      } catch (err) {
        failed = true;
        expect(String((err as { stderr: Buffer }).stderr)).toContain(reason);
      }
      expect(failed).toBe(true);
    },
  );

  test("the restart script builds a valid patch when bash runs it", () => {
    const script: string = getKubectlScriptForLegacyKubernetesStep({
      action: KubernetesAction.RestartWorkload,
      workloadKind: KubernetesWorkloadKind.Deployment,
      namespace: "web",
      workloadName: "api",
    });

    // kubectl swapped for echo: what it would have been handed.
    const printed: string = execFileSync(
      "bash",
      ["-c", `kubectl() { printf '%s\\n' "$@"; }\n${script}`],
      { encoding: "utf8" },
    );

    const args: Array<string> = printed.trim().split("\n");
    expect(args.slice(0, 5)).toEqual([
      "patch",
      "deployment",
      "api",
      "--namespace",
      "web",
    ]);
    expect(args[5]).toBe("--patch");

    const patch: {
      spec: {
        template: { metadata: { annotations: Record<string, string> } };
      };
    } = JSON.parse(args[6]!);
    expect(
      patch.spec.template.metadata.annotations[
        "kubectl.kubernetes.io/restartedAt"
      ],
    ).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe("isSshPrivateKey: a key or a password, by its value", () => {
  test.each([
    "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n-----END OPENSSH PRIVATE KEY-----",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----",
    "-----BEGIN EC PRIVATE KEY-----\nMHcC\n-----END EC PRIVATE KEY-----",
    "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
    "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIF\n-----END ENCRYPTED PRIVATE KEY-----",
    "  \n-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----\n",
    "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none",
  ])("a key: %s", (value: string) => {
    expect(isSshPrivateKey(value)).toBe(true);
  });

  test.each([
    "hunter2",
    "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----",
    "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----",
    "my -----BEGIN OPENSSH PRIVATE KEY----- password",
    "",
  ])("a password: %s", (value: string) => {
    expect(isSshPrivateKey(value)).toBe(false);
  });

  test("nothing is not a key", () => {
    expect(isSshPrivateKey(undefined)).toBe(false);
    expect(isSshPrivateKey(null)).toBe(false);
  });
});

describe("which steps were written before variables", () => {
  test("an SSH or Kubernetes step that names a credential and has no script", () => {
    expect(
      isLegacySSHStepConfig({ credentialId: "c1", command: "ls", agentId: "" }),
    ).toBe(true);
    expect(
      isLegacyKubernetesStepConfig({
        credentialId: "c1",
        action: KubernetesAction.RestartWorkload,
        agentId: "",
      }),
    ).toBe(true);
  });

  test("a step with a script is a script step, whatever else it carries", () => {
    expect(
      isLegacySSHStepConfig({ credentialId: "c1", script: "ls", agentId: "" }),
    ).toBe(false);
    expect(
      isLegacyKubernetesStepConfig({
        credentialId: "c1",
        script: "kubectl get pods",
        agentId: "",
      }),
    ).toBe(false);
  });

  test("a step that names no credential is a script step", () => {
    expect(isLegacySSHStepConfig({ command: "ls", agentId: "" })).toBe(false);
    expect(isLegacySSHStepConfig({ credentialId: "  ", agentId: "" })).toBe(
      false,
    );
    expect(isLegacyKubernetesStepConfig({ agentId: "" })).toBe(false);
  });
});
