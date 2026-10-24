import DataSourceHttpFetch, {
  DataSourceHttpRequest,
} from "Common/Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "Common/Server/Utils/LlmObservability/LlmProviderError";
import {
  DestinationAnswer,
  describeAnswerBody,
  isRetryableStatus,
  requestAnswer,
} from "Common/Server/Utils/SecurityEvent/Destinations/BatchSender";
import EgressGuardException, {
  EgressFailureReason,
} from "Common/Types/Exception/EgressGuardException";
import {
  AuditLogExportDeliveryError,
  AuditLogExportHttpTransport,
} from "./Types";

/*
 * One HTTP request of a destination: sent through the transport, answered
 * as what the service said (DestinationAnswer, the SIEM destinations'
 * reading of an answer), or a delivery error when there was no answer at
 * all. Every message is redacted of the export's secrets.
 */

// How long one upload or one batch may take before it counts as no answer.
export const AUDIT_LOG_EXPORT_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;

export const defaultAuditLogExportHttpTransport: AuditLogExportHttpTransport =
  (request: DataSourceHttpRequest) => {
    return DataSourceHttpFetch.fetch(request);
  };

// A message without any of the secrets in it, and nothing secret-looking.
export function redactDeliveryMessage(
  message: string,
  secretValues: Array<string>,
): string {
  return LlmProviderError.redact(message, secretValues);
}

/*
 * An error's own words, without a closing full stop (the sentence adds its
 * own). Read by shape: an error Node's own http code made can come from
 * another realm than this module's (a sandbox), where instanceof Error is
 * false.
 */
function errorText(error: unknown): string {
  const message: unknown =
    error && typeof error === "object"
      ? (error as { message?: unknown }).message
      : undefined;
  let text: string =
    typeof message === "string" && message ? message : String(error);

  text = text.trim();

  while (text.endsWith(".")) {
    text = text.slice(0, -1);
  }

  return text;
}

/*
 * Sends one request and hands back the answer, whatever its status. Throws
 * an AuditLogExportDeliveryError only when there was no answer: the egress
 * policy refused the address (not retryable: a setting to change), or the
 * service could not be reached or did not answer in time (retryable).
 */
export async function sendDestinationRequest(data: {
  transport: AuditLogExportHttpTransport;
  request: DataSourceHttpRequest;
  serviceTitle: string;
  secretValues: Array<string>;
  // What to check when it cannot be reached at all: "Check the storage account name."
  unreachableHint?: string | undefined;
}): Promise<DestinationAnswer> {
  try {
    return await requestAnswer(data.transport, {
      timeoutInMs: AUDIT_LOG_EXPORT_REQUEST_TIMEOUT_IN_MS,
      ...data.request,
    });
  } catch (error) {
    if (error instanceof EgressGuardException) {
      const isUnreachable: boolean =
        error.reason === EgressFailureReason.Unreachable ||
        error.reason === EgressFailureReason.ResolutionFailed;

      throw new AuditLogExportDeliveryError(
        redactDeliveryMessage(error.message, data.secretValues),
        { retryable: isUnreachable },
      );
    }

    throw new AuditLogExportDeliveryError(
      redactDeliveryMessage(
        `Could not reach ${data.serviceTitle}: ${errorText(error)}.${
          data.unreachableHint ? ` ${data.unreachableHint}` : ""
        } It is retried automatically.`,
        data.secretValues,
      ),
      { retryable: true },
    );
  }
}

/*
 * The error for an answer that refused the delivery, worded by the
 * destination (describe) and marked retryable for a 408, a 429 or a 5xx.
 */
export function toDeliveryError(data: {
  answer: DestinationAnswer;
  message: string;
  secretValues: Array<string>;
}): AuditLogExportDeliveryError {
  return new AuditLogExportDeliveryError(
    redactDeliveryMessage(data.message, data.secretValues),
    {
      retryable: isRetryableStatus(data.answer.status),
      status: data.answer.status,
    },
  );
}

// What the service said, short and without anything secret-looking, or "".
export function describeAnswer(answer: DestinationAnswer): string {
  return describeAnswerBody(answer);
}

export function describeUnexpectedAnswer(
  serviceTitle: string,
  answer: DestinationAnswer,
): string {
  const detail: string = describeAnswer(answer);

  return `${serviceTitle} did not accept the audit log entries (HTTP ${answer.status})${
    detail ? `: ${detail}` : "."
  }`;
}
