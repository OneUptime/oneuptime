import Dictionary from "../../../Types/Dictionary";
import { ServerInstallKind } from "../../../Types/ServerSetup/ServerSetupChecklist";
import { isRunningInKubernetes } from "../Telemetry/KubernetesResourceAttributes";

/*
 * HOW THIS SERVER WAS INSTALLED, AS FAR AS IT CAN TELL (#9378).
 *
 * Some of the setup checklist's steps differ by install: `npm run backup`
 * runs on the Docker Compose server only, and a Kubernetes install backs up
 * its volumes instead (the Helm chart's production checklist). The
 * checklist used to send every install to the Docker Compose steps.
 *
 * Each is told by a sign only it gives:
 *
 *   - Kubernetes hands every pod the API server's address
 *     (KUBERNETES_SERVICE_HOST), and the Helm chart names each of its pods
 *     (POD_NAME): the sign OneUptime's own telemetry already reads
 *     (Telemetry/KubernetesResourceAttributes);
 *   - Docker Compose sets INSTALLED_WITH=docker-compose on the app
 *     (docker-compose.base.yml), which nothing else sets.
 *
 * Neither, or both, is unknown - never a guess: the checklist then offers
 * both sets of steps, each named. A docker-compose.yml from before the mark
 * reads as unknown until it is updated.
 */

// The mark docker-compose.base.yml sets on the app.
export const DOCKER_COMPOSE_INSTALL_MARK: { name: string; value: string } = {
  name: "INSTALLED_WITH",
  value: "docker-compose",
};

export const getServerInstallKind: (
  env: Dictionary<string | undefined>,
) => ServerInstallKind = (
  env: Dictionary<string | undefined>,
): ServerInstallKind => {
  const isKubernetes: boolean = isRunningInKubernetes(env);
  const isDockerCompose: boolean =
    (env[DOCKER_COMPOSE_INSTALL_MARK.name] || "").trim().toLowerCase() ===
    DOCKER_COMPOSE_INSTALL_MARK.value;

  if (isKubernetes && !isDockerCompose) {
    return ServerInstallKind.Kubernetes;
  }

  if (isDockerCompose && !isKubernetes) {
    return ServerInstallKind.DockerCompose;
  }

  return ServerInstallKind.Unknown;
};
