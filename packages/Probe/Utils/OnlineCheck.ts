import PingMonitor from "./Monitors/MonitorTypes/PingMonitor";
import PortMonitor from "./Monitors/MonitorTypes/PortMonitor";
import WebsiteMonitor from "./Monitors/MonitorTypes/WebsiteMonitor";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import Port from "Common/Types/Port";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";

const REFERENCE_DOMAINS: Array<string> = [
  "google.com",
  "facebook.com",
  "microsoft.com",
  "youtube.com",
  "apple.com",
];

/*
 * Five TCP references can each take five 5-second attempts plus retry waits
 * (about 145 seconds total). Allow five minutes before new callers stop sharing
 * unusually old work. Original callers still receive their original verdict.
 */
export const ONLINE_CHECK_MAX_SHARING_AGE_IN_MS: number = 5 * 60 * 1000;

interface InProgressCheck {
  promise: Promise<boolean>;
  startedAt: number;
}

type OnlineCheckProtocol = "website" | "ping" | "port";
type ReferenceProbe = (domain: string) => Promise<{ isOnline: boolean } | null>;

export default class OnlineCheck {
  /*
   * A probe outage can fail hundreds of monitors together. They all need the
   * same connectivity verdict: share the reference checks already in flight
   * instead of starting up to five extra network requests per failed monitor.
   * Keep protocols independent, since HTTP connectivity does not prove that
   * ICMP or TCP checks work. Settled results are immediately released so the
   * next monitor checks current connectivity, including after recovery.
   */
  private static checksInProgress: Map<OnlineCheckProtocol, InProgressCheck> =
    new Map();

  public static canProbeMonitorWebsiteMonitors(): Promise<boolean> {
    return OnlineCheck.checkOnline("website", (domain: string) => {
      return WebsiteMonitor.ping(URL.fromString(`https://${domain}`), {
        isOnlineCheckRequest: true,
      });
    });
  }

  public static canProbeMonitorPingMonitors(): Promise<boolean> {
    return OnlineCheck.checkOnline("ping", (domain: string) => {
      return PingMonitor.ping(new Hostname(domain), {
        isOnlineCheckRequest: true,
      });
    });
  }

  public static canProbeMonitorPortMonitors(): Promise<boolean> {
    return OnlineCheck.checkOnline("port", (domain: string) => {
      return PortMonitor.ping(new Hostname(domain), new Port(80), {
        isOnlineCheckRequest: true,
      });
    });
  }

  private static checkOnline(
    protocol: OnlineCheckProtocol,
    probe: ReferenceProbe,
  ): Promise<boolean> {
    if (!IsBillingEnabled) {
      // Self-hosted probes do not require public internet connectivity.
      return Promise.resolve(true);
    }

    const now: number = Date.now();
    const inProgress: InProgressCheck | undefined =
      OnlineCheck.checksInProgress.get(protocol);

    if (
      inProgress &&
      now >= inProgress.startedAt &&
      now - inProgress.startedAt < ONLINE_CHECK_MAX_SHARING_AGE_IN_MS
    ) {
      return inProgress.promise;
    }

    /*
     * Defer execution until the shared promise is registered. Synchronous
     * errors also become rejections, and finally releases either outcome.
     */
    const check: Promise<boolean> = Promise.resolve()
      .then(async (): Promise<boolean> => {
        for (const domain of REFERENCE_DOMAINS) {
          if ((await probe(domain))?.isOnline) {
            return true;
          }
        }

        return false;
      })
      .finally(() => {
        // An older operation can finish after its replacement has started.
        if (OnlineCheck.checksInProgress.get(protocol)?.promise === check) {
          OnlineCheck.checksInProgress.delete(protocol);
        }
      });

    OnlineCheck.checksInProgress.set(protocol, {
      promise: check,
      startedAt: now,
    });
    return check;
  }
}
