/*
 * What an NTP step uses when it sets nothing itself, in a module that imports
 * nothing. MonitorCriteriaInstance builds a new NTP monitor's default
 * criteria with the clock offset below, and every frontend loads it before
 * its first page draws (through SerializableObjectDictionary, which JSON
 * reading loads). Read from NtpMonitorUtil, it brought along the probe's
 * failure causes that NtpMonitorUtil writes its sentences from
 * (ProbeFailureCauses), which no sign-in page or status page runs
 * (packages/Common/Scripts/first-load-budgets.js). NtpMonitorUtil exports
 * all three as before.
 */

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
