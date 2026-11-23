/*
 * What a probe build can do. A probe declares its capabilities on every
 * control-plane request (`probeCapabilities` in the request body), so the
 * server can tailor what it hands a probe, and read what comes back from
 * it, by what that probe understands. A probe that predates a capability
 * never declares it.
 *
 * Add a capability only in the build whose code honours it.
 */
enum ProbeCapability {
  /*
   * The network-device poll job pings devices and reports a top-level
   * isOnline plus pingResponse, so the server may hand this probe
   * credential-less (ping-only) devices.
   */
  NetworkDevicePing = "networkDevicePing",
  /*
   * The probe walks the SNMP tables a device's poll config lists, and every
   * SNMP walk it reports for such a config carries `tableResults`: one
   * entry per table, with its rows or why it could not be walked. A walk
   * WITHOUT `tableResults` from a probe that declares this was handed no
   * tables. Probes from before SNMP tables (version 14.0.18) walk a
   * device's OIDs and interfaces but not its tables; probes from 14.0.18
   * until this capability was added walk them but do not declare it.
   */
  SnmpTables = "snmpTables",
  /*
   * The probe runs SNMP Walk diagnostics (issue #5184): it walks a device's
   * OID tree with the credentials the server hands it and reports what it
   * read. The server hands a walk, and the device's credentials with it,
   * only to a probe that declares this; an older probe's walk is settled as
   * Failed with a sentence saying to upgrade it.
   */
  SnmpWalk = "snmpWalk",
  /*
   * The probe scans databases for Data Security (Jobs/DataSecurity/
   * ScanDatabases): it reads each store's connection string from the
   * environment variable the store names, samples the database read-only
   * and reports findings, never values. The server hands data-security
   * work only to a probe that declares this.
   */
  DataSecurityScan = "dataSecurityScan",
  /*
   * The probe collects table health for Data Observability (Jobs/
   * DataObservability/CollectTableHealth): it reads each store's connection
   * string from the environment variable the store names and reads the
   * database's catalog - columns, row counts, sizes, last changes - never a
   * row. The server hands table-health work only to a probe that declares
   * this.
   */
  DataObservabilityCollect = "dataObservabilityCollect",
  /*
   * The probe reads a 429 from a scheduling endpoint (/monitor/list,
   * /monitor-test/list, /probe/network-device/list) as "this server is busy
   * handing out work: ask again at the next tick" - nothing it would have
   * been handed is lost, it stays due - rather than as an error. The server
   * answers a busy request from a probe that declares this with a 429, and
   * one from an older probe with an empty batch, which it reads the same way
   * without a word (issue #7920).
   */
  RetryWhenBusy = "retryWhenBusy",
  /*
   * Every work fetch of the probe reads a 429 that way, not only the three
   * above: discovery scans, device diagnostics, packet captures, VMware and
   * OpenStack collections, OpenStack checks, Data Security scans and Data
   * Observability collections (issue #8051). The server answers a busy
   * request for that work with a 429 to a probe that declares this, and with
   * the endpoint's empty answer to any other: probes that declare only
   * RetryWhenBusy log a 429 from those fetches as a failed request, every
   * tick.
   */
  RetryAllWorkWhenBusy = "retryAllWorkWhenBusy",
  /*
   * The probe makes the one-time codes of TOTP monitor secrets (issue
   * #9703): it reads the codes' parameters a step carries
   * (MonitorStep.totpSecrets) and makes each code when the check uses it
   * (Common/Utils/Monitor/MonitorSecretTotp). A probe from before
   * FIRST_PROBE_VERSION_WITH_TOTP_CODES drops them and sends
   * {{monitorSecrets.NAME}} as written, so the site refuses the sign-in
   * with nothing to say why. The server hands a step that needs a code
   * only to a probe that declares this, and fails it, with a sentence
   * saying to update the probe, on any other custom probe (issue #9759).
   */
  TotpCodes = "totpCodes",
  /*
   * The probe sends an API step's request body as the step says (issues
   * #9737, #10736): any JSON value as written - an array or a single value
   * as well as an object - and, for a step whose body is text, the text
   * byte for byte (Common/Utils/Monitor/MonitorRequestBody). A probe from
   * before FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY reads every body as a
   * JSON object: it fails an array or a single value with "Expected
   * JSONObject, but got JSONArray", and sends a text body as JSON, if at
   * all. The server hands a step with such a body only to a probe that
   * declares this, and fails it, with a sentence saying to update the
   * probe, on any other custom probe (issue #10737).
   */
  AnyRequestBody = "anyRequestBody",
}

// The first probe release that walks SNMP tables.
export const FIRST_PROBE_VERSION_WITH_SNMP_TABLES: string = "14.0.18";

/*
 * HOW A FEATURE'S FIRST RELEASE IS KNOWN, AND WHY NO SENTENCE NAMES IT
 * BEFORE IT SHIPS.
 *
 * A release is cut from main as a branch (release-<version>, RELEASING.md)
 * and ships what main held at the cut: whatever main merges after it - a
 * new capability among it - waits for the next release, whose number is
 * decided only when it is cut. So the first release of a feature merged
 * after a cut is "the release after that one", at least its next patch
 * number, which every later number compares as at least - the number is
 * right for comparing a probe's release (ProbeReportedVersionUtil) - but
 * may never be a release at all: 17.0.1, the number one-time codes were
 * first given, was never released, and they shipped in 17.1.0. So the
 * sentences that tell someone to update a probe (the failure causes, the
 * monitor forms) name no release, and say to update to the latest one,
 * which always has every feature a release has shipped. A number is
 * written down here once its release is out, as one-time codes' is.
 */

/*
 * The first probe release that makes one-time codes (ProbeCapability.TotpCodes)
 * and reports its own version on every request (probeVersion in the body):
 * 17.1.0. The codes (#9721, #9778) were merged after 17.0.0 was cut from
 * main, and no 17.0.1 was ever released.
 */
export const FIRST_PROBE_VERSION_WITH_TOTP_CODES: string = "17.1.0";

/*
 * The first probe release that sends any request body
 * (ProbeCapability.AnyRequestBody): an array or a single value (#9737) and
 * a body sent as text (#10736). #10754, which brought the capability, was
 * merged into main on 2026-11-23, after release-17.2.0 was cut from it,
 * and a release branch never takes main's later commits (RELEASING.md):
 * so it ships in the release after 17.2.0, 17.2.1 or whatever later
 * number it is given, which compares as at least this. A 17.2.0 probe
 * never declares the capability, and is too old. Write the release here
 * once it is out.
 */
export const FIRST_PROBE_VERSION_WITH_ANY_REQUEST_BODY: string = "17.2.1";

// How many capabilities, of how many characters, a request is read for.
export const MAX_PROBE_CAPABILITIES: number = 32;
export const MAX_PROBE_CAPABILITY_LENGTH: number = 64;

export class ProbeCapabilityUtil {
  /*
   * The capabilities a request body declares, as the server keeps them:
   * strings only, trimmed, de-duplicated and bounded. Anything that is not
   * a list reads as no capabilities at all - an older probe sends none.
   */
  public static parse(value: unknown): Array<string> {
    if (!Array.isArray(value)) {
      return [];
    }

    const capabilities: Array<string> = [];

    for (const entry of value) {
      if (capabilities.length >= MAX_PROBE_CAPABILITIES) {
        break;
      }

      if (typeof entry !== "string") {
        continue;
      }

      const capability: string = entry.trim();

      if (
        !capability ||
        capability.length > MAX_PROBE_CAPABILITY_LENGTH ||
        capabilities.includes(capability)
      ) {
        continue;
      }

      capabilities.push(capability);
    }

    return capabilities;
  }

  public static has(
    capabilities: Array<string> | undefined,
    capability: ProbeCapability,
  ): boolean {
    return Array.isArray(capabilities) && capabilities.includes(capability);
  }
}

export default ProbeCapability;
