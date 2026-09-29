import { ExecutorOptions } from "./ResourceExecutor";
import UnavailableExecutor from "./UnavailableExecutor";

/*
 * The executor for Proxmox clusters: "pvesh" commands executed as calls to
 * the Proxmox VE HTTPS API with the agent's own API token. See
 * ResourceExecutor for the contract every executor keeps.
 *
 * PLACEHOLDER until the proxmox kit lands: a command passes PrepareGuard (the
 * policy re-check, the write switch and scope, the identity) and is then
 * refused as "not available in this build", and the posture reports the
 * resource as unreachable for that reason. The kit replaces this file
 * wholesale, keeping `export default class ProxmoxExecutor` and the uniform
 * constructor(options: ExecutorOptions) that ExecutorFactory calls.
 */
export default class ProxmoxExecutor extends UnavailableExecutor {
  public constructor(options: ExecutorOptions) {
    super(options);
  }
}
