import MonitorType from "Common/Types/Monitor/MonitorType";
import { translationKey } from "Common/Types/Translator";

/*
 * "Response content", on the Settings page of a Website, API or Incoming
 * Request monitor: whether the monitor keeps the content of its checks -
 * the body and headers of the response (or request) in its Monitoring Logs,
 * its status timeline and each probe's latest check, and, on the incidents
 * and alerts it opens, the excerpt of the response around what a filter
 * matched in their Evaluation details and the body in their Monitor
 * Summary. On by default. Secrets and personal data are masked either way
 * (MonitorRecordEvidence); this is for a monitor whose responses are
 * sensitive in themselves.
 *
 * It writes Monitor.keepResponseContent and saves when it is flipped. React-
 * free, so the card and App/Tests read the same strings.
 */

export interface ResponseContentSwitchCopyForType {
  cardTitle: string;
  cardDescription: string;
  switchTitle: string;
  onDescription: string;
  offDescription: string;
}

/*
 * The card's line says when to turn the switch off; the switch's own line
 * says what it keeps either way - and that secrets are masked, since a
 * phone shows the switch's line and not the card's.
 */

// A Website or API monitor reads the response it gets.
export const RESPONSE_CONTENT_SWITCH_COPY: ResponseContentSwitchCopyForType = {
  cardTitle: translationKey("Response content"),
  cardDescription: translationKey(
    "Turn this off for a monitor whose responses are sensitive.",
  ),
  switchTitle: translationKey("Keep response content"),
  onDescription: translationKey(
    "Monitoring logs, incidents and alerts show the part of the response that matched, and the response body, with secrets and personal data masked.",
  ),
  offDescription: translationKey(
    "Monitoring logs, incidents and alerts keep no part of the response: only which filters matched, the status code and the response time.",
  ),
};

// An Incoming Request monitor reads the request it receives.
export const REQUEST_CONTENT_SWITCH_COPY: ResponseContentSwitchCopyForType = {
  cardTitle: translationKey("Request content"),
  cardDescription: translationKey(
    "Turn this off for a monitor whose requests are sensitive.",
  ),
  switchTitle: translationKey("Keep request content"),
  onDescription: translationKey(
    "Monitoring logs, incidents and alerts show the part of the request that matched, and the request body, with secrets and personal data masked.",
  ),
  offDescription: translationKey(
    "Monitoring logs, incidents and alerts keep no part of the request: only which filters matched.",
  ),
};

// The monitor types whose Settings page has the card.
export const RESPONSE_CONTENT_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.Website,
  MonitorType.API,
  MonitorType.IncomingRequest,
];

export const getResponseContentSwitchCopy: (
  monitorType: MonitorType | undefined,
) => ResponseContentSwitchCopyForType | null = (
  monitorType: MonitorType | undefined,
): ResponseContentSwitchCopyForType | null => {
  if (!monitorType || !RESPONSE_CONTENT_MONITOR_TYPES.includes(monitorType)) {
    return null;
  }

  return monitorType === MonitorType.IncomingRequest
    ? REQUEST_CONTENT_SWITCH_COPY
    : RESPONSE_CONTENT_SWITCH_COPY;
};

// The column the switch writes.
export type ResponseContentSwitchColumn = "keepResponseContent";

export const RESPONSE_CONTENT_SWITCH_COLUMN: ResponseContentSwitchColumn =
  "keepResponseContent";

// The data-testid of the switch.
export const RESPONSE_CONTENT_SWITCH_TEST_ID: string =
  "monitor-response-content-switch";
