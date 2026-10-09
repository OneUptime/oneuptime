import NtpLeapIndicator from "./NtpLeapIndicator";
import NtpMonitorResponse from "./NtpMonitorResponse";

// The NTP port. A step that names no port is checked here.
export const DEFAULT_NTP_PORT: number = 123;

/*
 * How long one NTP attempt waits for its reply when the step sets no Request
 * Timeout. An NTP server answers in milliseconds and a reply that has not
 * come in five seconds is not coming, so this is far shorter than the
 * 60-second default of the TCP and HTTP checks: a dead server is retried and
 * reported in about 25 seconds instead of four minutes.
 */
export const DEFAULT_NTP_REQUEST_TIMEOUT_IN_MS: number = 5000;

/*
 * A new NTP monitor counts the server's time as good while its clock is
 * within this many milliseconds of the probe's, in either direction.
 *
 * A healthy NTP server is within a few milliseconds of UTC, and so is a probe
 * whose host keeps its clock synchronized, so one second leaves room for a
 * long, asymmetric internet path without hiding a server that serves wrong
 * time. TLS, Kerberos and log correlation all break well before a clock is
 * minutes out, so the bound is not loose either.
 */
export const DEFAULT_NTP_MAX_CLOCK_OFFSET_IN_MS: number = 1000;

// Stratum 1 is a primary server; 2 to 15 count hops from one.
export const NTP_MIN_SYNCHRONIZED_STRATUM: number = 1;
export const NTP_MAX_SYNCHRONIZED_STRATUM: number = 15;
// Not synchronized to any source.
export const NTP_UNSYNCHRONIZED_STRATUM: number = 16;

/*
 * The kiss codes of RFC 5905 (section 7.4) and RFC 8915, in the words an
 * operator acts on. A server sends one in the reference id of a stratum 0
 * reply - a "kiss-o'-death" - instead of the time.
 */
const KISS_CODE_DESCRIPTIONS: Record<string, string> = {
  ACST: "the association belongs to a unicast server",
  AUTH: "server authentication failed",
  AUTO: "the Autokey sequence failed",
  BCST: "the association belongs to a broadcast server",
  CRYP: "cryptographic authentication or identification failed",
  DENY: "the server denies access to this probe",
  DROP: "the server lost the association",
  RSTR: "the server's access rules refuse this probe",
  INIT: "the server has not synchronized its clock for the first time yet",
  MCST: "the association belongs to a dynamically discovered server",
  NKEY: "no authentication key was found for this probe",
  NTSN: "the server refused the Network Time Security (NTS) cookie",
  RATE: "the server is rate-limiting this probe and asks it to poll less often",
  RMOT: "the association was altered by a remote host",
  STEP: "the server's clock was just stepped and has not resynchronized yet",
};

export default class NtpMonitorUtil {
  /*
   * The stratum the criteria and the charts read. 0 on the wire (a
   * kiss-o'-death, or a server that does not know its stratum) and anything
   * above 15 both mean "not synchronized", so they count as 16 - the mapping
   * RFC 5905 (section 7.3) recommends. Without it "stratum at most 2" would
   * hold for a kiss-o'-death, whose 0 is the lowest number there is.
   */
  public static getEffectiveStratum(
    stratum: number | undefined | null,
  ): number | undefined {
    if (stratum === undefined || stratum === null || !isFinite(stratum)) {
      return undefined;
    }

    if (
      stratum < NTP_MIN_SYNCHRONIZED_STRATUM ||
      stratum > NTP_MAX_SYNCHRONIZED_STRATUM
    ) {
      return NTP_UNSYNCHRONIZED_STRATUM;
    }

    return stratum;
  }

  /*
   * Whether an answering server serves usable time: a real stratum, no
   * "unsynchronized" alarm in the leap indicator, and real timestamps in the
   * reply (a kiss-o'-death carries none). The probe decides this once, with
   * the timestamps in hand, and sends it as NtpMonitorResponse.isSynchronized.
   */
  public static isSynchronized(data: {
    stratum: number | undefined;
    leapIndicator: number | undefined;
    hasUsableTime: boolean;
  }): boolean {
    if (!data.hasUsableTime) {
      return false;
    }

    if (data.leapIndicator === NtpLeapIndicator.Unsynchronized) {
      return false;
    }

    if (data.stratum === undefined) {
      return false;
    }

    return (
      data.stratum >= NTP_MIN_SYNCHRONIZED_STRATUM &&
      data.stratum <= NTP_MAX_SYNCHRONIZED_STRATUM
    );
  }

  /*
   * How far the server's clock is from the probe's, whichever way: what the
   * "NTP Clock Offset" criteria compare and what its series records. A
   * server 500 ms behind is as wrong as one 500 ms ahead.
   */
  public static getAbsoluteClockOffsetInMs(
    response: Pick<NtpMonitorResponse, "clockOffsetInMs"> | undefined,
  ): number | undefined {
    const offset: number | undefined = response?.clockOffsetInMs;

    if (offset === undefined || offset === null || !isFinite(offset)) {
      return undefined;
    }

    return Math.abs(offset);
  }

  public static isKnownKissCode(code: string | undefined): boolean {
    return Boolean(code && KISS_CODE_DESCRIPTIONS[code]);
  }

  // "the server is rate-limiting this probe ..." for RATE, and so on.
  public static describeKissCode(code: string | undefined): string {
    if (!code) {
      return "the server answered without the time";
    }

    return (
      KISS_CODE_DESCRIPTIONS[code] ||
      `the server answered with the kiss code ${code} instead of the time`
    );
  }

  public static describeLeapIndicator(
    leapIndicator: number | undefined,
  ): string {
    switch (leapIndicator) {
      case NtpLeapIndicator.NoWarning:
        return "No leap second pending";
      case NtpLeapIndicator.LastMinuteHas61Seconds:
        return "A leap second will be added at the end of the day";
      case NtpLeapIndicator.LastMinuteHas59Seconds:
        return "A leap second will be removed at the end of the day";
      case NtpLeapIndicator.Unsynchronized:
        return "Alarm: the server's clock is not synchronized";
      default:
        return "Unknown";
    }
  }

  // "1 (primary)", "3 (secondary)", "16 (not synchronized)", ...
  public static describeStratum(
    stratum: number | undefined,
    kissCode?: string | undefined,
  ): string {
    if (stratum === undefined || stratum === null) {
      return "Unknown";
    }

    if (stratum === 0) {
      return kissCode
        ? `0 (kiss-o'-death ${kissCode})`
        : "0 (unspecified, not synchronized)";
    }

    if (stratum === NTP_MIN_SYNCHRONIZED_STRATUM) {
      return "1 (primary server)";
    }

    if (stratum <= NTP_MAX_SYNCHRONIZED_STRATUM) {
      return `${stratum} (secondary server)`;
    }

    return `${stratum} (not synchronized)`;
  }

  // 0.042 ms, 12.3 ms, 1,532 ms: three significant digits at most below 1 s.
  public static formatMilliseconds(value: number): string {
    const absolute: number = Math.abs(value);

    const maximumFractionDigits: number =
      absolute >= 100 ? 0 : absolute >= 10 ? 1 : absolute >= 1 ? 2 : 3;

    return `${value.toLocaleString("en-US", {
      maximumFractionDigits: maximumFractionDigits,
    })} ms`;
  }

  // "12.3 ms ahead of the probe", "1,532 ms behind the probe".
  public static describeClockOffset(clockOffsetInMs: number): string {
    if (clockOffsetInMs === 0) {
      return "in step with the probe";
    }

    const formatted: string = NtpMonitorUtil.formatMilliseconds(
      Math.abs(clockOffsetInMs),
    );

    return clockOffsetInMs > 0
      ? `${formatted} ahead of the probe`
      : `${formatted} behind the probe`;
  }

  /*
   * Why a server that answered is not serving synchronized time, in one
   * sentence for the check's failure cause, or "" when it is.
   */
  public static describeWhyNotSynchronized(
    response: Pick<
      NtpMonitorResponse,
      "isSynchronized" | "stratum" | "kissCode" | "leapIndicator"
    >,
    hasUsableTime: boolean,
  ): string {
    if (response.isSynchronized) {
      return "";
    }

    if (response.stratum === 0) {
      if (response.kissCode) {
        return `The server answered with a kiss-o'-death (${response.kissCode}): ${NtpMonitorUtil.describeKissCode(response.kissCode)}.`;
      }

      return "The server answered with stratum 0: it does not know its stratum, so it is not synchronized.";
    }

    if (!hasUsableTime) {
      return "The server answered, but its reply carried no usable time.";
    }

    if (response.leapIndicator === NtpLeapIndicator.Unsynchronized) {
      return "The server reports its clock as not synchronized (leap indicator 3, alarm).";
    }

    if (
      response.stratum !== undefined &&
      response.stratum > NTP_MAX_SYNCHRONIZED_STRATUM
    ) {
      return `The server reports stratum ${response.stratum}: it is not synchronized to a time source.`;
    }

    return "The server is not synchronized.";
  }
}
