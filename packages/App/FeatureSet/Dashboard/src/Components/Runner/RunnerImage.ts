/*
 * The Runner's container: the image the setup command runs and the name it
 * gives the container. The Setup Instructions card (InstallInstructions) and
 * the upgrade dialog beside an outdated Runner version
 * (Components/AgentVersion) both read these, so the upgrade removes exactly
 * the container the setup command started.
 *
 * Pure on purpose (no React), so the App suites can read it.
 */

export const RUNNER_IMAGE: string = "oneuptime/runner:release";
export const RUNNER_CONTAINER_NAME: string = "oneuptime-runner";

/*
 * Moving a Runner to the newest image: pull it and remove the running
 * container. The setup command then starts it again on the new image.
 */
export function getRunnerUpgradeCommand(): string {
  return `docker pull ${RUNNER_IMAGE}\ndocker rm -f ${RUNNER_CONTAINER_NAME}`;
}
