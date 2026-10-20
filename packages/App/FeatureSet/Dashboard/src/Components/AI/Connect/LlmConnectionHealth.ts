import LlmObservabilityConnection from "Common/Models/DatabaseModels/LlmObservabilityConnection";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How a connection is doing, from its last reads: off, waiting for its
 * first read, working, or not working - with the reason when it is not.
 * And what its last read brought in, in a few words.
 *
 * Labels are English translation keys; the table translates them. An
 * error is the server's own text, with secrets removed before it was
 * stored, and is shown as it is.
 */

export interface LlmConnectionHealth {
  key: "off" | "waiting" | "working" | "failing";
  label: string;
  color: Color;
  // A translation key, or the stored error itself for "failing".
  tooltip: string;
  tooltipIsError: boolean;
}

function toTime(value: Date | string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const time: number = OneUptimeDate.fromString(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

export function getLlmConnectionHealth(
  connection: LlmObservabilityConnection,
): LlmConnectionHealth {
  if (connection.isEnabled === false) {
    return {
      key: "off",
      label: translationKey("Off"),
      color: Gray500,
      tooltip: translationKey(
        "Turned off: it is not read until it is turned on.",
      ),
      tooltipIsError: false,
    };
  }

  const lastPulledAt: number | undefined = toTime(connection.lastPulledAt);
  const lastSuccessAt: number | undefined = toTime(
    connection.lastSuccessfulPullAt,
  );

  if (
    connection.lastError &&
    (lastSuccessAt === undefined ||
      (lastPulledAt !== undefined && lastPulledAt > lastSuccessAt))
  ) {
    return {
      key: "failing",
      label: translationKey("Not working"),
      color: Red,
      tooltip: connection.lastError,
      tooltipIsError: true,
    };
  }

  if (lastSuccessAt !== undefined) {
    return {
      key: "working",
      label: translationKey("Working"),
      color: Green,
      tooltip: translationKey("Its last read finished without a problem."),
      tooltipIsError: false,
    };
  }

  return {
    key: "waiting",
    label: translationKey("Waiting for the first read"),
    color: Yellow,
    tooltip: translationKey(
      "The first read starts within a minute of connecting, and can take a few minutes.",
    ),
    tooltipIsError: false,
  };
}

function readNumber(result: JSONObject, key: string): number | undefined {
  const value: JSONValue | undefined = result[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/*
 * What the last read brought in, as a translation template and its
 * values: "{{count}} new conversations" for a company AI tool, "{{cost}}
 * over {{days}} days" for a provider account. Undefined before the first
 * read, or when it brought nothing in.
 */
export function getLlmConnectionLastReadSummary(
  connection: LlmObservabilityConnection,
): { template: string; values: Record<string, string> } | undefined {
  const result: JSONObject | undefined = connection.lastPullResult;

  if (!result || result["status"] === "failed") {
    return undefined;
  }

  if (result["kind"] === "conversations") {
    const turns: number = readNumber(result, "turnsImported") || 0;
    const conversations: number =
      readNumber(result, "conversationsImported") || 0;

    if (turns === 0) {
      return { template: translationKey("No new chats"), values: {} };
    }

    return {
      template: translationKey(
        "{{turns}} answers in {{conversations}} conversations",
      ),
      values: { turns: String(turns), conversations: String(conversations) },
    };
  }

  if (result["kind"] === "usage") {
    const days: number = readNumber(result, "days") || 0;
    const cost: number | undefined = readNumber(result, "costUsd");
    const tokens: number =
      (readNumber(result, "inputTokens") || 0) +
      (readNumber(result, "outputTokens") || 0);

    if (cost !== undefined && cost > 0) {
      return {
        template: translationKey("${{cost}} over the last {{days}} days"),
        // "12,345.67": the template has the dollar sign.
        values: {
          cost: cost.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
          days: String(days),
        },
      };
    }

    if (tokens > 0) {
      return {
        template: translationKey(
          "{{tokens}} tokens over the last {{days}} days",
        ),
        values: { tokens: tokens.toLocaleString("en-US"), days: String(days) },
      };
    }

    return { template: translationKey("No usage yet"), values: {} };
  }

  return undefined;
}
