import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import GoogleSecOpsAlertCloser from "./GoogleSecOpsAlertCloser";
import { SecurityAlertCloser } from "./SecurityAlertCloser";

/*
 * The products OneUptime can close alerts in, one closer each. Closers are
 * stateless, so one instance serves every connection of every project.
 * Tests swap one for a closer with a fake endpoint (setCloser).
 */
const CLOSERS: Map<SecurityEventConnectorProvider, SecurityAlertCloser> =
  new Map<SecurityEventConnectorProvider, SecurityAlertCloser>([
    [
      SecurityEventConnectorProvider.GoogleSecOps,
      new GoogleSecOpsAlertCloser(),
    ],
  ]);

export default class SecurityAlertCloserRegistry {
  public static getCloser(
    provider: SecurityEventConnectorProvider | string | undefined,
  ): SecurityAlertCloser | undefined {
    return CLOSERS.get(provider as SecurityEventConnectorProvider);
  }

  public static setCloser(
    provider: SecurityEventConnectorProvider,
    closer: SecurityAlertCloser,
  ): void {
    CLOSERS.set(provider, closer);
  }

  public static providers(): Array<SecurityEventConnectorProvider> {
    return Array.from(CLOSERS.keys());
  }
}
