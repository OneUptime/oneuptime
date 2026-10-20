import fs from "fs";
import path from "path";
import KubectlExecutor from "./KubectlExecutor";
import { BashRunResult, runBash } from "../Utils/RunBash";

/*
 * A kubectl step: the runbook author's bash script of kubectl commands, run
 * on this Runner with KUBECONFIG pointing at the cluster's kubeconfig.
 *
 * It is a Bash step aimed at a cluster - the same trust: the runbook's
 * author wrote it, and it runs with bash on this host as a Bash step does
 * (RunBash), with the run's inputs in its environment. The difference is the
 * kubeconfig: the server hands over the one the step names (a secret runbook
 * variable) only to the Runner the step picked, and it lives here only while
 * the script runs - written to a private file (0600) in a private directory
 * (0700) of its own, under the directory KubectlExecutor keeps for every
 * kubeconfig this Runner writes, so one a crash left behind is swept at the
 * next start and on shutdown, then removed when the script ends, whatever
 * way it ends.
 *
 * A step that names no kubeconfig uses the Runner's own access - its
 * KUBECONFIG or ~/.kube/config, or its service account when it runs inside
 * the cluster - as kubectl in a Bash step would.
 *
 * Not to be confused with KubectlExecutor, which runs ONE kubectl command
 * OneUptime AI composed, as an argv under the AI command policy.
 */
export default class KubectlScriptExecutor {
  public static async execute(data: {
    script: string;
    // The cluster's kubeconfig; empty: the Runner's own access.
    kubeconfig?: string | undefined;
    timeoutInMs: number;
    // The environment to start from; left out, the Runner's own.
    environment?: NodeJS.ProcessEnv | undefined;
  }): Promise<BashRunResult> {
    if (!data.script || !data.script.trim()) {
      return {
        success: false,
        output: "",
        errorMessage: "kubectl step has no script to run.",
      };
    }

    const kubeconfig: string = data.kubeconfig || "";

    if (!kubeconfig.trim()) {
      return runBash({
        script: data.script,
        timeoutInMs: data.timeoutInMs,
        environment: data.environment,
      });
    }

    let dir: string | null = null;
    let kubeconfigPath: string;

    try {
      dir = KubectlExecutor.createKubeconfigDir();
      kubeconfigPath = path.join(dir, "config");
      fs.writeFileSync(kubeconfigPath, kubeconfig, { mode: 0o600 });
    } catch (err) {
      KubectlExecutor.cleanup(dir);

      return {
        success: false,
        output: "",
        errorMessage: `Could not prepare the kubeconfig for this step: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    try {
      return await runBash({
        script: data.script,
        timeoutInMs: data.timeoutInMs,
        environment: {
          ...(data.environment || process.env),
          KUBECONFIG: kubeconfigPath,
        },
      });
    } finally {
      KubectlExecutor.cleanup(dir);
    }
  }
}
