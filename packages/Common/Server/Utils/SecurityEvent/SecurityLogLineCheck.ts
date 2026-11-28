import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { SecurityLogLineCheckResult } from "../../../Types/SecurityEvent/SecurityLogLineCheck";
import { checkSecurityLogLines } from "../../../Utils/SecurityEvent/SecurityLogLineCheck";
import { UNREAD_TRUSTED_PROXY_SOURCES } from "../../../Utils/SecurityEvent/TrustedProxySources";
import CaptureSpan from "../Telemetry/CaptureSpan";
import SecurityTrustedProxies, {
  TrustedProxySourcesRead,
} from "./SecurityTrustedProxies";

/*
 * CHECK A LOG LINE ON THE SERVER (#11046): a pasted line read with the
 * project's trusted proxies as the scans read them now - its Trusted
 * Proxies, the edges it connected, its own load balancers unless it turned
 * them off, and its Access Logs settings (SecurityTrustedProxies
 * .readSources, the reading every scan's trust is made of) - so the client
 * Check a log line names is the one the stored event names
 * (Utils/SecurityEvent/SecurityLogLineCheck).
 *
 * Read as OneUptime, as the scans read them: a proxy is trusted whoever
 * pastes the line. Nothing is stored, and the line is never logged.
 */
export default class SecurityLogLineCheckReader {
  @CaptureSpan()
  public static async check(data: {
    projectId: ObjectID;
    text: string;
  }): Promise<SecurityLogLineCheckResult> {
    const read: TrustedProxySourcesRead | null =
      await SecurityTrustedProxies.readSources(data.projectId);

    return checkSecurityLogLines({
      text: data.text,
      // A project that cannot be read trusts no proxy at all, as a scan of it would (#11389).
      sources: read ? read.sources : UNREAD_TRUSTED_PROXY_SOURCES,
      now: OneUptimeDate.getCurrentDate(),
    });
  }
}
