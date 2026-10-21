/*
 * The Runner's container, for a global Runner: the image the Admin
 * Dashboard's setup command runs, the name it gives the container, and the
 * command itself. A global Runner is the same image as any Runner, started
 * with its own id and key (from Admin Dashboard -> Settings -> Global
 * Runners); the server tells it that it is global.
 *
 * The Dashboard's project Runner setup keeps its own copy of the image name
 * (Dashboard/src/Components/Runner/RunnerImage.ts, which docs suites read as
 * written); a test holds the two to the same value.
 */

export const RUNNER_IMAGE_NAME: string = "oneuptime/runner:release";

export const GLOBAL_RUNNER_CONTAINER_NAME: string = "oneuptime-global-runner";

export function getGlobalRunnerDockerCommand(data: {
  runnerId: string;
  runnerKey: string;
  oneuptimeUrl: string;
}): string {
  return `docker run --name ${GLOBAL_RUNNER_CONTAINER_NAME} --restart unless-stopped \\
  -e ONEUPTIME_RUNNER_ID=${data.runnerId} \\
  -e ONEUPTIME_RUNNER_KEY=${data.runnerKey} \\
  -e ONEUPTIME_URL=${data.oneuptimeUrl} \\
  -d ${RUNNER_IMAGE_NAME}`;
}
