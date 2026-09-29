import { ExecutorOptions } from "./ResourceExecutor";
import UnavailableExecutor from "./UnavailableExecutor";

/*
 * The executor for database servers: the "db" diagnostic catalog, run
 * through the database's own driver (never free SQL). See ResourceExecutor
 * for the contract every executor keeps.
 *
 * PLACEHOLDER until the database kit lands: a command passes PrepareGuard (the
 * policy re-check, the write switch and scope, the identity) and is then
 * refused as "not available in this build", and the posture reports the
 * resource as unreachable for that reason. The kit replaces this file
 * wholesale, keeping `export default class DatabaseExecutor` and the uniform
 * constructor(options: ExecutorOptions) that ExecutorFactory calls.
 */
export default class DatabaseExecutor extends UnavailableExecutor {
  public constructor(options: ExecutorOptions) {
    super(options);
  }
}
