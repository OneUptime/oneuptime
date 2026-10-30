import { PROBE_API_REQUEST_TIMEOUT_IN_MS, PROBE_KEY } from "../Config";
import ProbeUtil from "./Probe";
import ProbeApiDiagnostics from "./ProbeApiDiagnostics";
import ProxyConfig from "./ProxyConfig";
import URL from "Common/Types/API/URL";
import { RequestOptions, RequestOutcome } from "Common/Utils/API";
import { JSONObject } from "Common/Types/JSON";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";

/*
 * What this probe build can do, declared on every control-plane request so
 * the server can tailor what it hands out to what the caller understands.
 *
 * "networkDevicePing": the network-device poll job pings devices and
 * reports a top-level isOnline plus pingResponse, so the server may hand
 * this probe credential-less (ping-only) devices. A probe WITHOUT this
 * capability would receive such a device as an SNMP config with no
 * community, default it to "public", fail the walk, and report the device
 * Down — so the server drops ping-mode devices from an old probe's batch
 * instead.
 *
 * "snmpTables": a device's walk covers the SNMP tables its config lists,
 * and the walk's response always carries `tableResults` for them
 * (SnmpMonitor.walkTables). The server reads a walk without them from a
 * probe that does not declare this as a probe that cannot walk tables, and
 * says so on the device's Wi-Fi and SNMP Tables pages.
 *
 * "snmpWalk": the diagnostic job runs SNMP Walk diagnostics with the
 * credentials the server hands it (Jobs/NetworkDevice/FetchDiagnostics). The
 * server hands a walk, and the device's credentials, only to a probe that
 * declares this, and settles an older probe's walks with a sentence saying
 * to update it.
 *
 * "dataSecurityScan": the probe scans the databases Data Security assigns
 * it (Jobs/DataSecurity/ScanDatabases), reading each one's connection
 * string from the environment variable the store names. The server hands
 * data-security work only to a probe that declares this.
 *
 * Add to this list only when the code that honours the new capability
 * ships in the same build.
 */
export const PROBE_CAPABILITIES: Array<string> = [
  ProbeCapability.NetworkDevicePing,
  ProbeCapability.SnmpTables,
  ProbeCapability.SnmpWalk,
  ProbeCapability.DataSecurityScan,
];

export default class ProbeAPIRequest {
  public static getDefaultRequestBody(): JSONObject {
    return {
      probeKey: PROBE_KEY,
      probeId: ProbeUtil.getProbeId().toString(),
      probeCapabilities: [...PROBE_CAPABILITIES],
    };
  }

  /*
   * Every control-plane request to the server goes through this: proxy
   * agents when a proxy is configured, plus an explicit timeout so a
   * non-responding server produces a logged failure instead of an
   * infinitely hung request (axios's default timeout is 0 = no timeout,
   * and a hung request from a cron tick piles onto the next tick's).
   *
   * It is also the one place every probe→server request passes through, so
   * the diagnostics observer is attached here rather than at fourteen call
   * sites: whatever route is added next gets the same failure reporting for
   * free. `timeout` may be overridden by callers with their own deadline
   * (the syslog/NetFlow/SNMP-trap forwarders flush on a much shorter one).
   *
   * Every one of those requests carries the probe's key, so a redirect is
   * followed only while it stays on the server it was sent to
   * (sameServerRedirectsOnly): an HTTP client hands a redirected request's
   * headers, and a 307 or 308's body, to wherever the redirect points.
   */
  public static getDefaultRequestOptions(
    url: URL,
    options?: { timeout?: number },
  ): RequestOptions {
    const inFlightRequestId: number = ProbeApiDiagnostics.beginRequest(url);

    return {
      ...ProxyConfig.getRequestProxyAgents(url),
      sameServerRedirectsOnly: true,
      timeout: options?.timeout ?? PROBE_API_REQUEST_TIMEOUT_IN_MS,
      onRequestComplete: (outcome: RequestOutcome): void => {
        ProbeApiDiagnostics.onRequestComplete(inFlightRequestId, outcome);
      },
    };
  }
}
