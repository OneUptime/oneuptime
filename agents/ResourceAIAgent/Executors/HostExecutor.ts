import { ExecutorOptions } from "./ResourceExecutor";
import UnavailableExecutor from "./UnavailableExecutor";

/*
 * The executor for hosts: the host's own programs, run in its namespaces
 * through nsenter. See ResourceExecutor for the contract every executor
 * keeps.
 *
 * PLACEHOLDER until the host kit lands: a command passes PrepareGuard (the
 * policy re-check, the write switch and scope, the identity) and is then
 * refused as "not available in this build", and the posture reports the
 * resource as unreachable for that reason. The kit replaces this file
 * wholesale, keeping `export default class HostExecutor` and the uniform
 * constructor(options: ExecutorOptions) that ExecutorFactory calls.
 */
export default class HostExecutor extends UnavailableExecutor {
  public constructor(options: ExecutorOptions) {
    super(options);
  }
}
