import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { isSshPrivateKey } from "Common/Types/Runbook/RunbookLegacySteps";
import { getSshHostKeyProblem } from "Common/Types/Runbook/SshHostKey";
import {
  SshPinnedHostKey,
  getPinnedSshHostKeys,
} from "Common/Utils/Runbook/SshHostKeyFingerprint";
import {
  KUBECONFIG_CREDENTIAL_TYPE,
  SSH_CREDENTIAL_TYPE,
} from "Common/Types/Runbook/RunnerFeatures";
import {
  RunbookJobVariableSource,
  getRunbookJobSecretFields,
  getRunbookJobVariableReferences,
  jobUsesRunbookVariables,
} from "Common/Types/Runbook/RunbookJobVariableFields";
import {
  RunbookVariableReference,
  getRunbookVariableReferenceKey,
  parseSingleRunbookVariableReference,
} from "Common/Types/Runbook/RunbookVariableReference";
import {
  RunbookVariableProblem,
  RunbookVariableProblemReason,
  describeRunbookVariableProblems,
} from "Common/Types/Runbook/RunbookVariableProblems";
import RunbookVariableResolver, {
  ResolvedRunbookVariable,
  RunbookVariableAccess,
  RunbookVariableResolution,
} from "Common/Server/Utils/Runbook/RunbookVariableResolver";

/*
 * A RUNBOOK STEP'S VARIABLES, FILLED IN FOR THE RUNNER THAT TOOK IT.
 *
 * What the claim hands a Runner for a runbook's own step: the step with
 * every {{global.variables.NAME}} and {{local.variables.NAME}} it names
 * filled in - in its script, and for an SSH step in its host and user - and
 * the secret it signs in with:
 *
 *   - a Bash or JavaScript step: its script;
 *   - an SSH step that takes a script (no credentialId): its host, user and
 *     port, its script - also sent as `command`, which a Runner older than
 *     scripts runs - and, as `credential`, its key or password and the
 *     key's passphrase, in the shape every Runner reads (SSH_CREDENTIAL_TYPE),
 *     with the machine's host keys it names as fingerprints (hostKeys),
 *     which the claim hands only a Runner that checks them (RunnerIngress);
 *   - a kubectl step (Kubernetes, with a script): its script, and its
 *     kubeconfig as `credential` - none when it uses the Runner's own
 *     access.
 *
 * What it may have is RunbookVariableResolver's one rule. A step that names
 * a variable it may not have is refused with the reason, never handed over
 * with a placeholder where a value should be. The secrets handed over are
 * listed (secretValues), so the Runner hides them in what the step prints,
 * and the server does again (RunnerJobService.submitResult).
 *
 * A job that names a runbook credential - a step written before variables
 * and never moved - is not read here: runbook credentials are gone, and the
 * claim fails such a job, saying how to fix the step (RunnerIngress). Nor is
 * anything OneUptime AI composed: its commands are never filled in.
 */

export type PreparedJobVariables =
  | { isRefused: true; refusal: string }
  | {
      isRefused: false;
      script: string;
      payload?: JSONObject | undefined;
      credential?: JSONObject | undefined;
      secretValues: Array<string>;
    };

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default class RunbookJobVariables {
  /*
   * Whether a job's step takes variables: a script step, or an SSH or
   * kubectl step that takes a script (no credential).
   */
  public static usesVariables(job: RunnerJob): boolean {
    return jobUsesRunbookVariables(RunbookJobVariables.toSource(job));
  }

  // The variables a job names, each once.
  public static getReferences(job: RunnerJob): Array<RunbookVariableReference> {
    return getRunbookJobVariableReferences(RunbookJobVariables.toSource(job));
  }

  private static toSource(job: RunnerJob): RunbookJobVariableSource {
    return {
      stepType: job.stepType,
      script: job.script || "",
      payload: (job.payload as JSONObject | undefined) || {},
    };
  }

  public static async prepare(data: {
    job: RunnerJob;
    projectId: ObjectID;
    runbookId: ObjectID | null;
    access: RunbookVariableAccess;
  }): Promise<PreparedJobVariables> {
    const job: RunnerJob = data.job;
    const payload: JSONObject = (job.payload as JSONObject) || {};

    const resolution: RunbookVariableResolution =
      await RunbookVariableResolver.resolve({
        projectId: data.projectId,
        runbookId: data.runbookId,
        references: RunbookJobVariables.getReferences(job),
        access: data.access,
        includeValues: true,
      });

    const problems: Array<RunbookVariableProblem> = [...resolution.problems];

    // A field that takes a secret holds one reference, to a secret.
    for (const field of getRunbookJobSecretFields(
      RunbookJobVariables.toSource(job),
    )) {
      const reference: RunbookVariableReference | null =
        parseSingleRunbookVariableReference(field);

      if (!reference) {
        return {
          isRefused: true,
          refusal:
            "This step's key, password or kubeconfig is not one secret variable, so it was not run. Open the step and pick a secret variable.",
        };
      }

      const resolved: ResolvedRunbookVariable | undefined =
        resolution.variables.get(getRunbookVariableReferenceKey(reference));

      if (resolved && !resolved.isSecret) {
        problems.push({
          reference,
          reason: RunbookVariableProblemReason.NotSecret,
        });
      }
    }

    if (problems.length > 0) {
      return {
        isRefused: true,
        refusal: describeRunbookVariableProblems(problems),
      };
    }

    const fill: (text: string) => string = (text: string): string => {
      return RunbookVariableResolver.fill(text, resolution);
    };

    const secretOf: (field: string) => string = (field: string): string => {
      const reference: RunbookVariableReference | null =
        parseSingleRunbookVariableReference(field);

      if (!reference) {
        return "";
      }

      return (
        resolution.variables.get(getRunbookVariableReferenceKey(reference))
          ?.value || ""
      );
    };

    if (job.stepType === RunbookStepType.SSH) {
      const host: string = fill(asText(payload["host"])).trim();
      const username: string = fill(asText(payload["username"])).trim();
      const script: string = fill(asText(payload["script"]));
      const signIn: string = secretOf(asText(payload["signIn"]));
      const passphrase: string = secretOf(asText(payload["passphrase"]));
      const port: number =
        typeof payload["port"] === "number" && payload["port"] > 0
          ? (payload["port"] as number)
          : 22;

      if (!host || !username) {
        return {
          isRefused: true,
          refusal:
            "This SSH step has no machine to sign in to: its host or user is empty. Open the step and fill in SSH to.",
        };
      }

      if (!signIn) {
        return {
          isRefused: true,
          refusal:
            "This SSH step has nothing to sign in with. Open the step and pick the secret variable that holds its key or password.",
        };
      }

      // The machine's host keys, as the Runner checks them: fingerprints.
      const hostKeyText: string = asText(payload["hostKey"]);
      const hostKeyProblem: string | null = getSshHostKeyProblem(hostKeyText);

      if (hostKeyProblem) {
        return { isRefused: true, refusal: hostKeyProblem };
      }

      const hostKeys: Array<SshPinnedHostKey> =
        getPinnedSshHostKeys(hostKeyText);

      return {
        isRefused: false,
        script: "",
        payload: {
          host,
          username,
          port,
          script,
          // What a Runner older than SSH scripts runs: the same script.
          command: script,
        },
        credential: {
          credentialType: SSH_CREDENTIAL_TYPE,
          hostname: host,
          port,
          username,
          ...(isSshPrivateKey(signIn)
            ? {
                privateKey: signIn,
                ...(passphrase ? { passphrase } : {}),
              }
            : { password: signIn }),
          ...(hostKeys.length > 0
            ? {
                hostKeys: hostKeys.map((key: SshPinnedHostKey): JSONObject => {
                  return {
                    fingerprint: key.fingerprint,
                    ...(key.keyType ? { keyType: key.keyType } : {}),
                  };
                }),
              }
            : {}),
        },
        secretValues: resolution.secretValues,
      };
    }

    if (job.stepType === RunbookStepType.Kubernetes) {
      const kubeconfig: string = secretOf(asText(payload["kubeconfig"]));

      return {
        isRefused: false,
        script: "",
        payload: {
          script: fill(asText(payload["script"])),
        },
        ...(kubeconfig
          ? {
              credential: {
                credentialType: KUBECONFIG_CREDENTIAL_TYPE,
                kubeconfig,
              },
            }
          : {}),
        secretValues: resolution.secretValues,
      };
    }

    return {
      isRefused: false,
      script: fill(job.script || ""),
      secretValues: resolution.secretValues,
    };
  }
}
