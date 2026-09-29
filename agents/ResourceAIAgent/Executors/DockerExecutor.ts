import { ExecutorOptions } from "./ResourceExecutor";
import UnavailableExecutor from "./UnavailableExecutor";

/*
 * The executor for Docker hosts, Podman hosts and Docker Swarm clusters:
 * the docker CLI against the engine socket (DOCKER_HOST). See
 * ResourceExecutor for the contract every executor keeps.
 *
 * PLACEHOLDER until the docker kit lands: a command passes PrepareGuard (the
 * policy re-check, the write switch and scope, the identity) and is then
 * refused as "not available in this build", and the posture reports the
 * resource as unreachable for that reason. The kit replaces this file
 * wholesale, keeping `export default class DockerExecutor` and the uniform
 * constructor(options: ExecutorOptions) that ExecutorFactory calls.
 */
export default class DockerExecutor extends UnavailableExecutor {
  public constructor(options: ExecutorOptions) {
    super(options);
  }
}
