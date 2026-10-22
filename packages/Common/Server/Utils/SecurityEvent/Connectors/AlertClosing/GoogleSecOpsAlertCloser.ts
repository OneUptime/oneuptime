import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import SecurityCaseVerdict from "../../../../../Types/SecurityCase/SecurityCaseVerdict";
import GoogleSecOpsClient, {
  FetchLike,
  GoogleSecOpsImportResult,
} from "../GoogleSecOps/GoogleSecOpsClient";
import { SecurityConnectorSettings } from "../Types";
import {
  SecurityAlertCloser,
  SOURCE_ALERTS_PER_CLOSE_LIMIT,
  SourceAlertCloseResult,
  SourceAlertClosing,
  emptySourceAlertCloseResult,
  sourceAlertClosingComment,
} from "./SecurityAlertCloser";

/*
 * Closes Google SecOps alerts through the Chronicle API's
 * legacyUpdateAlert: status CLOSED, the reason and verdict the case's
 * verdict reads as, and a comment with the closing note and a link back to
 * the case. Each answer is read for what to do next:
 *
 *   - 200: closed;
 *   - 404: Google SecOps has no such alert - a rule detection that never
 *     raised one - so there is nothing to close;
 *   - 400: refused for that one alert. Once, before giving up on it, the
 *     alert is sent again without a verdict, the one value whose spelling
 *     a Google update could change;
 *   - 403: the key cannot update alerts: nothing more can be closed, and
 *     the case says what role to grant;
 *   - 429, 5xx, no answer: tried twice more after a pause, then the
 *     closing stops and is tried again later (retryable).
 */

export const GOOGLE_SECOPS_CLOSE_ATTEMPTS: number = 3;
export const GOOGLE_SECOPS_CLOSE_RETRY_DELAYS_IN_MS: ReadonlyArray<number> = [
  1000, 4000,
];

export type CloseSleepFunction = (delayInMs: number) => Promise<void>;

const defaultSleep: CloseSleepFunction = (delayInMs: number): Promise<void> => {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, delayInMs);
  });
};

function readSetting(values: JSONObject, key: string): string {
  const value: JSONValue | undefined = values[key];

  return typeof value === "string" ? value.trim() : "";
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

/*
 * The feedback a closed case gives its Google SecOps alerts. Reasons are
 * Google's Reason enum; verdicts its alert feedback's TRUE_POSITIVE and
 * FALSE_POSITIVE. A benign positive is a real detection of harmless
 * activity: not malicious, with no verdict either way.
 */
export function googleSecOpsClosingFeedback(
  closing: SourceAlertClosing,
  options: { withVerdict: boolean } = { withVerdict: true },
): JSONObject {
  const feedback: JSONObject = {
    status: "CLOSED",
    comment: sourceAlertClosingComment(closing),
  };

  switch (closing.verdict) {
    case SecurityCaseVerdict.TruePositive:
      feedback["reason"] = "REASON_MALICIOUS";
      if (options.withVerdict) {
        feedback["verdict"] = "TRUE_POSITIVE";
      }
      break;
    case SecurityCaseVerdict.FalsePositive:
      feedback["reason"] = "REASON_NOT_MALICIOUS";
      if (options.withVerdict) {
        feedback["verdict"] = "FALSE_POSITIVE";
      }
      break;
    case SecurityCaseVerdict.BenignPositive:
      feedback["reason"] = "REASON_NOT_MALICIOUS";
      break;
    default:
      break;
  }

  return feedback;
}

// What a person must fix when Google SecOps refuses to close every alert.
export function describeGoogleSecOpsCloseFailure(
  answer: Pick<GoogleSecOpsImportResult, "status" | "errorText">,
): string {
  const detail: string = answer.errorText ? ` ${answer.errorText}` : "";

  if (answer.status === 401) {
    return `Google SecOps refused the service account's token (HTTP 401). The key may be revoked, or this server's clock may be wrong.${detail}`;
  }

  if (answer.status === 403) {
    return `The service account cannot update alerts in this Google SecOps instance (HTTP 403). Grant it chronicle.legacies.legacyUpdateAlert, for example with the Chronicle API Editor role.${detail}`;
  }

  if (answer.status === 429) {
    return `Google SecOps is rate limiting this service account (HTTP 429). OneUptime tries again later.${detail}`;
  }

  return `Google SecOps did not close the alert (HTTP ${answer.status}).${detail}`;
}

export default class GoogleSecOpsAlertCloser implements SecurityAlertCloser {
  private readonly fetchImplementation: FetchLike | undefined;
  private readonly sleep: CloseSleepFunction;

  public constructor(
    options: {
      fetchImplementation?: FetchLike | undefined;
      sleep?: CloseSleepFunction | undefined;
    } = {},
  ) {
    this.fetchImplementation = options.fetchImplementation;
    this.sleep = options.sleep || defaultSleep;
  }

  public createClient(settings: SecurityConnectorSettings): GoogleSecOpsClient {
    return new GoogleSecOpsClient({
      region: readSetting(settings.config, "region"),
      instanceResourceName: readSetting(
        settings.config,
        "instanceResourceName",
      ),
      serviceAccountJson: readSetting(settings.secrets, "serviceAccountJson"),
      fetchImplementation: this.fetchImplementation,
    });
  }

  public async closeAlerts(data: {
    settings: SecurityConnectorSettings;
    alertIds: Array<string>;
    closing: SourceAlertClosing;
  }): Promise<SourceAlertCloseResult> {
    const result: SourceAlertCloseResult = emptySourceAlertCloseResult();
    const alertIds: Array<string> = Array.from(
      new Set(
        data.alertIds
          .map((alertId: string): string => {
            return alertId.trim();
          })
          .filter((alertId: string): boolean => {
            return alertId.length > 0;
          }),
      ),
    ).slice(0, SOURCE_ALERTS_PER_CLOSE_LIMIT);

    if (alertIds.length === 0) {
      return result;
    }

    const client: GoogleSecOpsClient = this.createClient(data.settings);
    const feedback: JSONObject = googleSecOpsClosingFeedback(data.closing);
    const hasVerdict: boolean = feedback["verdict"] !== undefined;

    for (let index: number = 0; index < alertIds.length; index++) {
      const alertId: string = alertIds[index]!;
      let answer: GoogleSecOpsImportResult | null =
        await this.updateWithRetries(client, alertId, feedback);

      // Once without the verdict: the one value Google could spell differently.
      if (hasVerdict && answer && answer.status === 400 && !answer.ok) {
        answer = await this.updateWithRetries(
          client,
          alertId,
          googleSecOpsClosingFeedback(data.closing, { withVerdict: false }),
        );
      }

      if (!answer) {
        result.notTried = alertIds.length - index;
        result.failure = "Could not reach Google SecOps.";
        result.retryable = true;
        return result;
      }

      if (answer.ok) {
        result.closed++;
        continue;
      }

      if (answer.status === 404) {
        result.notFound++;
        continue;
      }

      if (answer.status === 400) {
        result.refused++;
        continue;
      }

      result.notTried = alertIds.length - index;
      result.failure = describeGoogleSecOpsCloseFailure(answer);
      result.retryable = isRetryableStatus(answer.status);
      return result;
    }

    return result;
  }

  // One alert's update, tried again after a pause when the answer says to; null when nothing answered.
  private async updateWithRetries(
    client: GoogleSecOpsClient,
    alertId: string,
    feedback: JSONObject,
  ): Promise<GoogleSecOpsImportResult | null> {
    let lastAnswer: GoogleSecOpsImportResult | null = null;

    for (
      let attempt: number = 1;
      attempt <= GOOGLE_SECOPS_CLOSE_ATTEMPTS;
      attempt++
    ) {
      try {
        const answer: GoogleSecOpsImportResult =
          await client.updateAlertFeedback({ alertId, feedback });

        if (answer.ok || !isRetryableStatus(answer.status)) {
          return answer;
        }

        lastAnswer = answer;
      } catch {
        // No answer at all: a timeout, a refused connection, a bad token exchange.
        lastAnswer = null;
      }

      if (attempt < GOOGLE_SECOPS_CLOSE_ATTEMPTS) {
        await this.sleep(
          GOOGLE_SECOPS_CLOSE_RETRY_DELAYS_IN_MS[attempt - 1] ||
            GOOGLE_SECOPS_CLOSE_RETRY_DELAYS_IN_MS[
              GOOGLE_SECOPS_CLOSE_RETRY_DELAYS_IN_MS.length - 1
            ]!,
        );
      }
    }

    return lastAnswer;
  }
}
