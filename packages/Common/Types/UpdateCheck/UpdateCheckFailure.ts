/*
 * Why the last daily update check could not reach GitHub, as the Admin
 * Dashboard says it (GlobalConfig.updateCheckLastFailure). A short code, never
 * text GitHub or the network wrote, so the notice words it in the reader's
 * language and nothing from outside is shown as it came.
 */
enum UpdateCheckFailure {
  /*
   * GitHub refused the request for its limit: 60 requests an hour from one
   * address without a token (403 with x-ratelimit-remaining 0, or 429).
   */
  RateLimited = "rate-limited",
  // No answer at all: no route out, DNS, a refused connection, a firewall.
  Unreachable = "unreachable",
  // No answer within the time the check waits.
  TimedOut = "timed-out",
  // An HTTP error other than the rate limit: a 404 from a mirror, a 5xx.
  HttpError = "http-error",
  // An answer, but not the shape GitHub sends.
  MalformedResponse = "malformed-response",
}

export const parseUpdateCheckFailure: (
  value: unknown,
) => UpdateCheckFailure | null = (
  value: unknown,
): UpdateCheckFailure | null => {
  return (Object.values(UpdateCheckFailure) as Array<unknown>).includes(value)
    ? (value as UpdateCheckFailure)
    : null;
};

export default UpdateCheckFailure;
