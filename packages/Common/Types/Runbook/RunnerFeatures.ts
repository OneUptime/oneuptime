/*
 * WHAT A RUNNER CAN RUN, SAID BY THE RUNNER WHEN IT ASKS FOR WORK.
 *
 * A Runner is installed by its owner and updated on their schedule, so the
 * server can be newer than the Runners that take its steps. A step shape an
 * older Runner cannot run is handed only to a Runner that names the feature
 * on its claim (`features` in the claim-next-job body); any other Runner
 * that takes it gets the step failed with what to do - update the Runner -
 * rather than a confusing error from the old code path.
 *
 * Steps an older Runner runs fine need no feature: an SSH step that takes a
 * script also carries it as the command an older Runner sends.
 */

// A kubectl step that takes a script and a kubeconfig (RunbookStepType.Kubernetes).
export const RUNNER_FEATURE_KUBECTL_SCRIPT: string = "kubectl-script";

/*
 * How a kubectl step's kubeconfig is sent in a claim's `credential`
 * ({ credentialType, kubeconfig }), beside the SSH and Kubernetes shapes a
 * runbook credential is sent in. Never a RunbookCredential's own type.
 */
export const KUBECONFIG_CREDENTIAL_TYPE: string = "Kubeconfig";

// Every feature this build of the Runner has.
export const RUNNER_FEATURES: ReadonlyArray<string> = [
  RUNNER_FEATURE_KUBECTL_SCRIPT,
];

// The features a claim body names, read defensively: only known strings.
export function readRunnerFeatures(raw: unknown): Array<string> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const features: Array<string> = [];

  for (const item of raw) {
    if (
      typeof item === "string" &&
      RUNNER_FEATURES.includes(item) &&
      !features.includes(item)
    ) {
      features.push(item);
    }
  }

  return features;
}
