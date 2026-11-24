import { PROBE_API_REQUEST_TIMEOUT_IN_MS, PROBE_KEY } from "../Config";
import ProbeUtil from "./Probe";
import ProbeApiDiagnostics from "./ProbeApiDiagnostics";
import ProxyConfig from "./ProxyConfig";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import { RequestOptions, RequestOutcome } from "Common/Utils/API";
import { JSONObject } from "Common/Types/JSON";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import ProbeKeyHeaders from "Common/Types/Probe/ProbeKeyHeaders";
import { AppVersion } from "Common/Server/EnvironmentConfig";

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
 * "dataObservabilityCollect": the probe collects the table health of the
 * databases Data Observability assigns it (Jobs/DataObservability/
 * CollectTableHealth) from their catalogs, with the same environment
 * variables. The server hands table-health work only to a probe that
 * declares this.
 *
 * "retryWhenBusy": the monitor, monitor test and network device fetches
 * read a 429 as "the server is too busy to hand out work now, ask again at
 * the next tick" (Utils/ServerBusy). The server answers a busy fetch from a
 * probe that declares this with a 429, and an older probe's with an empty
 * batch.
 *
 * "retryAllWorkWhenBusy": so do the other work fetches - discovery scans,
 * device diagnostics, packet captures, VMware and OpenStack collections,
 * OpenStack checks, Data Security and Data Observability. The server
 * answers those with a 429 only to a probe that declares this: before it,
 * they logged a 429 as a failed request every tick.
 *
 * "totpCodes": the monitor jobs make the one-time codes of TOTP monitor
 * secrets from the parameters a step carries (MonitorStep.totpSecrets), as
 * each check uses them. The server hands a step that needs a code only to
 * a probe that declares this, and fails it on an older custom probe with a
 * sentence saying to update the probe (issue #9759).
 *
 * "anyRequestBody": the API check sends a step's request body as the step
 * says - any JSON value as written, an array or a single value too, and a
 * text body byte for byte (MonitorRequestBody, #9737, #10736). The server
 * hands a step with such a body only to a probe that declares this, and
 * fails it on an older custom probe with a sentence saying to update the
 * probe (issue #10737).
 *
 * Add to this list only when the code that honours the new capability
 * ships in the same build.
 */
export const PROBE_CAPABILITIES: Array<string> = [
  ProbeCapability.NetworkDevicePing,
  ProbeCapability.SnmpTables,
  ProbeCapability.SnmpWalk,
  ProbeCapability.DataSecurityScan,
  ProbeCapability.DataObservabilityCollect,
  ProbeCapability.RetryWhenBusy,
  ProbeCapability.RetryAllWorkWhenBusy,
  ProbeCapability.TotpCodes,
  ProbeCapability.AnyRequestBody,
];

/*
 * What every request says of this probe's build: what it can do, and the
 * release it runs (APP_VERSION, baked into the image; "unknown" for a
 * build without one). OneUptime keeps the release with the probe's
 * liveness stamp, so the probe's page and the monitor forms can say when a
 * custom probe is too old for something (issue #9759).
 */
export function getProbeBuildDeclaration(): JSONObject {
  return {
    probeCapabilities: [...PROBE_CAPABILITIES],
    probeVersion: AppVersion,
  };
}

export default class ProbeAPIRequest {
  /*
   * The key and the id come first, in this order: OneUptime reads them off
   * the start of a collection's bytes, before it parses the rest, from a
   * probe that does not send them in headers too (ProbeReportOpening).
   */
  public static getDefaultRequestBody(): JSONObject {
    return {
      probeKey: PROBE_KEY,
      probeId: ProbeUtil.getProbeId().toString(),
      ...getProbeBuildDeclaration(),
    };
  }

  /*
   * The probe's id and key as headers, for a request whose body is too large
   * to be read before the key is checked - a vCenter's or an OpenStack
   * cloud's collection (#10222). OneUptime checks them before it reads a
   * byte of the body. The body keeps them too, for a OneUptime from before
   * these headers.
   */
  public static getProbeKeyHeaders(): Dictionary<string> {
    return ProbeKeyHeaders.build({
      probeId: ProbeUtil.getProbeId().toString(),
      probeKey: PROBE_KEY,
    });
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
