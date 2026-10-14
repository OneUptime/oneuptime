/*
 * Whether a failed run's message says a request to the source timed out.
 *
 * The poller halves the next window after a timeout (a window too heavy to
 * answer in time would time out on every retry), so it has to recognize a
 * timeout in every way the connectors and the HTTP clients under them word
 * one:
 *
 *  - "timed out after N seconds", a client's own deadline (Microsoft
 *    Sentinel, AWS Security Hub, Google SecOps);
 *  - "timeout of Nms exceeded", axios's own words;
 *  - "Timeout Error", the same axios timeout as the shared data source fetch
 *    words it ("Could not reach data source: Timeout Error.", through
 *    API.getFriendlyErrorMessage). This is what a timed-out request of the
 *    Splunk, Elastic Security, Okta, Defender XDR and Falcon clients says in
 *    production, inside their own "... did not complete: ..." or "... could
 *    not be completed: ...". Without it their timeouts were never
 *    recognized, and the same window was retried on every poll;
 *  - "ETIMEDOUT", a socket that could not connect in time.
 */
const REQUEST_TIMEOUT_PATTERN: RegExp =
  /timed out|timeout of \d+ms exceeded|Timeout Error|ETIMEDOUT/i;

export function isRequestTimeoutMessage(message: string | undefined): boolean {
  return REQUEST_TIMEOUT_PATTERN.test(message || "");
}

export default isRequestTimeoutMessage;
