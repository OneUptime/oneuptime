import { shellQuote } from "../../../Types/Runbook/ShellWord";
import {
  KUBECONFIG_CREDENTIAL_TYPE,
  RUNNER_FEATURES,
  RUNNER_FEATURE_KUBECTL_SCRIPT,
  RUNNER_FEATURE_SSH_HOST_KEY,
  readRunnerFeatures,
} from "../../../Types/Runbook/RunnerFeatures";
import {
  getRunbookJobSecretFields,
  getRunbookJobVariableReferences,
  getRunbookJobVariableTexts,
  jobUsesRunbookVariables,
} from "../../../Types/Runbook/RunbookJobVariableFields";
import {
  RunbookVariableProblemReason,
  describeRunbookVariableProblems,
} from "../../../Types/Runbook/RunbookVariableProblems";
import {
  RunbookVariableReference,
  RunbookVariableScope,
} from "../../../Types/Runbook/RunbookVariableReference";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
import { describe, expect, test } from "@jest/globals";
import { execFileSync } from "child_process";

/*
 * The small pieces SSH and kubectl steps that take a script are built on:
 * a script quoted for a shell, what a Runner says it can run, which fields
 * of a job may name variables, and the one sentence a step fails with when
 * it names one it cannot use.
 */

const global: (name: string) => RunbookVariableReference = (
  name: string,
): RunbookVariableReference => {
  return { scope: RunbookVariableScope.Global, name };
};

const local: (name: string) => RunbookVariableReference = (
  name: string,
): RunbookVariableReference => {
  return { scope: RunbookVariableScope.Local, name };
};

describe("shellQuote", () => {
  test("a plain word stays as it is", () => {
    expect(shellQuote("deploy")).toBe("deploy");
    expect(shellQuote("/var/log/syslog")).toBe("/var/log/syslog");
    expect(shellQuote("checkout-api.v2_1")).toBe("checkout-api.v2_1");
  });

  test("anything else is one single-quoted word", () => {
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("$HOME")).toBe("'$HOME'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  test.each([
    "hostname\nuptime",
    "echo 'single' \"double\" $HOME `id` $(date) \\ ; | & > <",
    "'''",
    "line one\n  line two\t\ttabs\n",
    "ünïcödé — 日本語",
  ])("a shell reads %j back exactly as it was", (word: string) => {
    expect(
      execFileSync("bash", ["-c", `printf '%s' ${shellQuote(word)}`], {
        encoding: "utf8",
      }),
    ).toBe(word);
  });
});

describe("what a Runner says it can run", () => {
  test("this build runs kubectl scripts, and checks an SSH machine's host key", () => {
    expect(RUNNER_FEATURES).toEqual([
      RUNNER_FEATURE_KUBECTL_SCRIPT,
      RUNNER_FEATURE_SSH_HOST_KEY,
    ]);
    expect(RUNNER_FEATURE_KUBECTL_SCRIPT).toBe("kubectl-script");
    expect(RUNNER_FEATURE_SSH_HOST_KEY).toBe("ssh-host-key");
    expect(KUBECONFIG_CREDENTIAL_TYPE).toBe("Kubeconfig");
  });

  test("a claim's list is read for known features only, each once", () => {
    expect(
      readRunnerFeatures([
        "kubectl-script",
        "kubectl-script",
        "teleport",
        7,
        "ssh-host-key",
      ]),
    ).toEqual(["kubectl-script", "ssh-host-key"]);
  });

  test("a claim from a Runner older than features names none", () => {
    expect(readRunnerFeatures(undefined)).toEqual([]);
    expect(readRunnerFeatures(null)).toEqual([]);
    expect(readRunnerFeatures("kubectl-script")).toEqual([]);
  });
});

describe("the fields of a job that may name variables", () => {
  test("a Bash or JavaScript step: its script", () => {
    for (const stepType of [RunbookStepType.Bash, RunbookStepType.JavaScript]) {
      const job: { stepType: RunbookStepType; script: string } = {
        stepType,
        script: "curl {{global.variables.URL}}",
      };

      expect(jobUsesRunbookVariables(job)).toBe(true);
      expect(getRunbookJobVariableTexts(job)).toEqual([
        "curl {{global.variables.URL}}",
      ]);
      expect(getRunbookJobSecretFields(job)).toEqual([]);
    }
  });

  test("an SSH step that takes a script: its machine, user, sign-in, passphrase and script", () => {
    const job: { stepType: RunbookStepType; payload: Record<string, string> } =
      {
        stepType: RunbookStepType.SSH,
        payload: {
          host: "{{global.variables.DB_HOST}}",
          username: "deploy",
          signIn: "{{global.variables.DB_KEY}}",
          passphrase: "{{local.variables.DB_KEY_PASSPHRASE}}",
          script: "psql -h {{global.variables.DB_HOST}}",
        },
      };

    expect(getRunbookJobVariableReferences(job)).toEqual([
      global("DB_HOST"),
      global("DB_KEY"),
      local("DB_KEY_PASSPHRASE"),
    ]);
    expect(getRunbookJobSecretFields(job)).toEqual([
      "{{global.variables.DB_KEY}}",
      "{{local.variables.DB_KEY_PASSPHRASE}}",
    ]);
  });

  test("a kubectl step that takes a script: its kubeconfig and script", () => {
    const job: { stepType: RunbookStepType; payload: Record<string, string> } =
      {
        stepType: RunbookStepType.Kubernetes,
        payload: {
          kubeconfig: "{{global.variables.PROD_KUBECONFIG}}",
          script: "kubectl -n {{local.variables.NS}} get pods",
        },
      };

    expect(getRunbookJobVariableReferences(job)).toEqual([
      global("PROD_KUBECONFIG"),
      local("NS"),
    ]);
    expect(getRunbookJobSecretFields(job)).toEqual([
      "{{global.variables.PROD_KUBECONFIG}}",
    ]);
  });

  test("a kubectl step on the Runner's own access names no secret field", () => {
    expect(
      getRunbookJobSecretFields({
        stepType: RunbookStepType.Kubernetes,
        payload: { kubeconfig: "  ", script: "kubectl get nodes" },
      }),
    ).toEqual([]);
  });

  test("a step written with a credential, and OneUptime AI's kubectl, take none", () => {
    for (const job of [
      {
        stepType: RunbookStepType.SSH,
        payload: { credentialId: "c1", command: "{{global.variables.X}}" },
      },
      {
        stepType: RunbookStepType.Kubernetes,
        payload: { credentialId: "c1", action: "restart-workload" },
      },
      { stepType: RunbookStepType.Kubectl, payload: { argv: ["get", "pods"] } },
      {
        stepType: RunbookStepType.HttpRequest,
        script: "{{global.variables.X}}",
      },
    ]) {
      expect(jobUsesRunbookVariables(job)).toBe(false);
      expect(getRunbookJobVariableTexts(job)).toEqual([]);
      expect(getRunbookJobVariableReferences(job)).toEqual([]);
    }
  });
});

describe("describeRunbookVariableProblems: why a step was not run", () => {
  test("nothing to say when there is no problem", () => {
    expect(describeRunbookVariableProblems([])).toBe("");
  });

  test("a variable that is not there says where variables are made", () => {
    expect(
      describeRunbookVariableProblems([
        {
          reference: global("DB_HOST"),
          reason: RunbookVariableProblemReason.Missing,
        },
        {
          reference: local("NS"),
          reason: RunbookVariableProblemReason.Missing,
        },
      ]),
    ).toBe(
      'This step names variables it cannot use, so it was not run: there is no global variable named "DB_HOST" (Runbooks → Settings → Global Variables); this runbook has no variable named "NS" (the runbook\'s Settings → Variables).',
    );
  });

  test("one clause per kind of problem, each naming its variables and what to do", () => {
    expect(
      describeRunbookVariableProblems([
        {
          reference: global("C"),
          reason: RunbookVariableProblemReason.NotForGlobalRunners,
        },
        {
          reference: global("A"),
          reason: RunbookVariableProblemReason.NotForThisRunner,
        },
        {
          reference: global("B"),
          reason: RunbookVariableProblemReason.NotForThisRunner,
        },
        {
          reference: global("D"),
          reason: RunbookVariableProblemReason.NoValue,
        },
        {
          reference: global("E"),
          reason: RunbookVariableProblemReason.NotSecret,
        },
        {
          reference: local("F"),
          reason: RunbookVariableProblemReason.NoRunbook,
        },
      ]),
    ).toBe(
      [
        "This step names variables it cannot use, so it was not run: ",
        '"F" is a runbook\'s own variable, and this step is not part of a runbook run; ',
        '"E" is not a secret variable (keep a key, a password or a kubeconfig in a secret variable); ',
        'the secret "D" has no value (replace its value); ',
        'this Runner may not use the secrets "A", "B" (add it to the Runners of those variables, or pick one of their Runners for the step); ',
        'global Runners may not use the secret "C" (turn on "Global Runners can use it" for it, or pick one of your own Runners for the step).',
      ].join(""),
    );
  });

  test("lists five names and counts the rest, and cuts a long name", () => {
    const message: string = describeRunbookVariableProblems(
      ["A", "B", "C", "D", "E", "F", "G", "N".repeat(500)].map(
        (name: string) => {
          return {
            reference: global(name),
            reason: RunbookVariableProblemReason.NoValue,
          };
        },
      ),
    );

    expect(message).toContain(
      'the secrets "A", "B", "C", "D", "E" and 3 more have no value',
    );

    const long: string = describeRunbookVariableProblems([
      {
        reference: global("N".repeat(500)),
        reason: RunbookVariableProblemReason.NoValue,
      },
    ]);
    expect(long).toContain(`"${"N".repeat(80)}…"`);
    expect(long.length).toBeLessThan(250);
  });
});
