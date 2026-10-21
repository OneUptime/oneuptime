import MonitorType from "Common/Types/Monitor/MonitorType";
import { DEFAULT_NTP_REQUEST_TIMEOUT_IN_MS } from "Common/Types/Monitor/NtpMonitor/NtpMonitorUtil";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

export const PROBE_DEFAULT_RETRY_COUNT_LABEL: string =
  "Probe default (usually 3)";

/*
 * What the two fields say under their titles: one line each. Their exact
 * rules - what counts as an attempt, what is retried and what is not, the
 * default - ran to four or five lines under the field (up to about 400
 * characters for Website and API), so they moved into the (i) beside the
 * title (FieldLabel's `tooltip`), word for word: the variants below.
 */
export const RETRIES_ON_FAILURE_DESCRIPTION: string = translationKey(
  "How many times to try again before the check fails. Up to 3.",
);

export const REQUEST_TIMEOUT_SHORT_DESCRIPTION: string = translationKey(
  "How long to wait for each attempt, up to 60 seconds.",
);

export const REQUEST_TIMEOUT_DESCRIPTION: string = translationKey(
  "How long to wait for a response on each request or connection attempt. Each retry gets a new timeout. Defaults to 60 seconds. Maximum is 60 seconds.",
);

/*
 * Help text for the "Retries on Failure" field on probe-based monitor steps.
 *
 * The variants name the failures relevant to each monitor type. Every string
 * is also its own i18n key in all seventeen Dashboard locale files.
 *
 * What every variant states, and where the probe says so:
 *
 * - The value counts retries AFTER the first attempt: MonitorRetry.canRetry
 *   returns attemptNumber <= retries, and every monitor util starts its
 *   attempt counter at 1. So 0 runs the check once and 2 runs it up to three
 *   times.
 *
 * - A blank field is not "3", it is "whatever the probe is configured for":
 *   MonitorUtil.resolveRetryCount falls through to PROBE_MONITOR_RETRY_LIMIT,
 *   which is 3 only because that is the env var's default (Probe/Config.ts).
 *   A self-hosted probe can set any value, and that value is used unclamped.
 *
 * - The maximum is 3 for anything this form saves: the input clamps to 3 and
 *   MonitorStep.setRetryCount runs it through clampMonitorRetryCount, which
 *   caps at MAX_MONITOR_RETRY_COUNT.
 */

/*
 * Website and API (WebsiteMonitor.ts, ApiMonitor.ts).
 *
 * A successful response slower than 10 seconds re-runs the check from the same
 * budget, so 0 also switches that re-check off. HTTP error responses and
 * timeouts use this same budget, with a fresh timeout for every request.
 * Invalid targets and protective size/redirect limits still stop retries.
 */
export const HTTP_RETRIES_ON_FAILURE_DESCRIPTION: string = translationKey(
  "How many times to retry after a failed attempt: 0 means one attempt, 2 means up to 3. Leave blank to use the probe's default (usually 3). Maximum is 3. It also limits re-checks of a successful response slower than 10 seconds. Connection failures, timeouts, and HTTP 4xx and 5xx responses are retried. Each request attempt gets a new timeout. Invalid or blocked targets, oversized responses, and too many redirects are not retried.",
);

/*
 * Ping, IP and Port (PingMonitor.ts, PortMonitor.ts; Ping and IP take the same
 * path, and fall back to a port check when the probe's host blocks ICMP).
 *
 * Both retry every failed attempt with no exclusions - a timeout is classified
 * only once the retries are spent - and both re-run a successful check whose
 * response took longer than 10 seconds.
 */
export const NETWORK_RETRIES_ON_FAILURE_DESCRIPTION: string = translationKey(
  "How many times to retry after a failed attempt: 0 means one attempt, 2 means up to 3. Leave blank to use the probe's default (usually 3). Maximum is 3. Every failure is retried, including timeouts, and it also limits re-checks of a successful response slower than 10 seconds.",
);

/*
 * SSL Certificate (SslMonitor.ts).
 *
 * Connection errors, failed certificate validation and handshake timeouts
 * share one retry budget. There is no slow-response re-check on this type.
 */
export const SSL_RETRIES_ON_FAILURE_DESCRIPTION: string = translationKey(
  "How many times to retry after a failed attempt: 0 means one attempt, 2 means up to 3. Leave blank to use the probe's default (usually 3). Maximum is 3. Connection failures, certificate validation failures, and timeouts are retried.",
);

/*
 * NTP (NtpMonitor.ts). Silence and errors are retried with a fresh request;
 * any answer ends the check - a kiss-o'-death or an unsynchronized server has
 * answered, and a RATE kiss asks for fewer requests, not more. There is no
 * slow-response re-check.
 */
export const NTP_RETRIES_ON_FAILURE_DESCRIPTION: string = translationKey(
  "How many times to retry after a failed attempt: 0 means one attempt, 2 means up to 3. Leave blank to use the probe's default (usually 3). Maximum is 3. No reply, a refused port and a failed lookup are retried, each with a new request. A server that answers is never asked again, even when it answers that it is not synchronized.",
);

/*
 * NTP waits 5 seconds per attempt by default (DEFAULT_NTP_REQUEST_TIMEOUT_IN_MS),
 * not the 60 seconds of the TCP and HTTP checks.
 */
export const NTP_REQUEST_TIMEOUT_DESCRIPTION: string = translationKey(
  "How long to wait for the server's reply on each attempt, including the DNS lookup. Each retry gets a new timeout. Defaults to 5 seconds. Maximum is 60 seconds.",
);

/*
 * The field is rendered for seven monitor types (the API, Website and
 * Ping/IP/Port/SSL/NTP advanced sections of the monitor step form). Anything
 * else gets the network text, which is the plainest of them. This is the
 * full rule, shown in the field's (i): see getRetriesOnFailureField.
 */
export const getRetriesOnFailureDescription: (
  monitorType: MonitorType,
) => string = (monitorType: MonitorType): string => {
  if (monitorType === MonitorType.Website || monitorType === MonitorType.API) {
    return HTTP_RETRIES_ON_FAILURE_DESCRIPTION;
  }

  if (monitorType === MonitorType.SSLCertificate) {
    return SSL_RETRIES_ON_FAILURE_DESCRIPTION;
  }

  if (monitorType === MonitorType.NTP) {
    return NTP_RETRIES_ON_FAILURE_DESCRIPTION;
  }

  return NETWORK_RETRIES_ON_FAILURE_DESCRIPTION;
};

// What a field of the monitor step form says: one line, and the (i)'s rule.
export interface MonitorStepFieldHelp {
  description: string;
  tooltip: string;
}

// The retries field's line, and the rule for the monitor's type in its (i).
export const getRetriesOnFailureField: (
  monitorType: MonitorType,
) => MonitorStepFieldHelp = (
  monitorType: MonitorType,
): MonitorStepFieldHelp => {
  return {
    description: RETRIES_ON_FAILURE_DESCRIPTION,
    tooltip: getRetriesOnFailureDescription(monitorType),
  };
};

/*
 * The timeout field's line, its rule (in the (i)), and the number it shows
 * when nothing is set: 5 seconds for NTP, 60 for the TCP and HTTP checks.
 */
export const getRequestTimeoutField: (
  monitorType: MonitorType,
) => MonitorStepFieldHelp & {
  defaultSeconds: number;
} = (
  monitorType: MonitorType,
): MonitorStepFieldHelp & {
  defaultSeconds: number;
} => {
  if (monitorType === MonitorType.NTP) {
    return {
      description: REQUEST_TIMEOUT_SHORT_DESCRIPTION,
      tooltip: NTP_REQUEST_TIMEOUT_DESCRIPTION,
      defaultSeconds: DEFAULT_NTP_REQUEST_TIMEOUT_IN_MS / 1000,
    };
  }

  return {
    description: REQUEST_TIMEOUT_SHORT_DESCRIPTION,
    tooltip: REQUEST_TIMEOUT_DESCRIPTION,
    defaultSeconds: 60,
  };
};
