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
 * script also carries it as the command an older Runner sends. A kubectl
 * step is failed on a Runner that does not name "kubectl-script", saying to
 * update the Runner - the Kubernetes steps the data migration moved from an
 * action included: the runbook credential they kept for such a Runner went
 * with runbook credentials. An SSH step that names the machine's host keys
 * is failed on a Runner that does not name "ssh-host-key": an older Runner
 * would sign in without checking them, which is what naming them prevents.
 */

// A kubectl step that takes a script and a kubeconfig (RunbookStepType.Kubernetes).
export const RUNNER_FEATURE_KUBECTL_SCRIPT: string = "kubectl-script";

/*
 * An SSH step that names the machine's host keys (SSHStepConfig.hostKey):
 * the Runner signs in only when the machine presents one of them
 * (credential.hostKeys).
 */
export const RUNNER_FEATURE_SSH_HOST_KEY: string = "ssh-host-key";

/*
 * How a claim's `credential` says what it holds: { credentialType, ... }.
 *
 * An SSH step's sign-in is sent as { credentialType: "SSH", hostname, port,
 * username, privateKey (and passphrase) or password }, filled in from its
 * secret runbook variables (RunbookJobVariables) - the shape every Runner
 * reads, an older one included, since runbook credentials were sent in it -
 * and, when the step names the machine's host keys, hostKeys: [{
 * fingerprint, keyType }], which only a Runner that names "ssh-host-key"
 * is handed.
 * A kubectl step's kubeconfig is sent as { credentialType: "Kubeconfig",
 * kubeconfig }. ("Kubernetes", an API server URL and a token, is what a
 * runbook credential was sent as; OneUptime sends it no more.)
 */
export const SSH_CREDENTIAL_TYPE: string = "SSH";

export const KUBECONFIG_CREDENTIAL_TYPE: string = "Kubeconfig";

// Every feature this build of the Runner has.
export const RUNNER_FEATURES: ReadonlyArray<string> = [
  RUNNER_FEATURE_KUBECTL_SCRIPT,
  RUNNER_FEATURE_SSH_HOST_KEY,
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
