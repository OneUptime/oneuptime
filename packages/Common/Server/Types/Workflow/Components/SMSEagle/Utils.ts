import { RunOptions } from "../../ComponentCode";
import HTTPErrorResponse from "../../../../../Types/API/HTTPErrorResponse";
import APIException from "../../../../../Types/Exception/ApiException";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../../Types/JSON";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import axios from "axios";

// How long the device may take to answer. It queues the SMS or call at once.
export const SMSEAGLE_MAX_STEP_TIME_IN_MS: number = 30 * 1000;

// Less than this left of the workflow's own time, and the step does not start.
export const SMSEAGLE_MIN_STEP_TIME_IN_MS: number = 2 * 1000;

// Kept back from the workflow's time, so the run can still record the result.
const WORKFLOW_TIME_MARGIN_IN_MS: number = 2 * 1000;

export class SMSEagleComponentUtils {
  /*
   * How long the request may take: up to SMSEAGLE_MAX_STEP_TIME_IN_MS, and
   * always inside what is left of the workflow's own time.
   */
  public static getTimeoutInMs(options: RunOptions): number {
    const remainingInMs: number =
      options.getRemainingExecutionTimeInMs?.() ??
      SMSEAGLE_MAX_STEP_TIME_IN_MS + WORKFLOW_TIME_MARGIN_IN_MS;

    const timeoutInMs: number = Math.min(
      SMSEAGLE_MAX_STEP_TIME_IN_MS,
      Math.floor(remainingInMs - WORKFLOW_TIME_MARGIN_IN_MS),
    );

    if (timeoutInMs < SMSEAGLE_MIN_STEP_TIME_IN_MS) {
      throw new BadDataException(
        "Not enough of the workflow's run time is left to send the request to SMSEagle.",
      );
    }

    return timeoutInMs;
  }

  // Whether the device did not answer before the request's time ran out.
  public static isTimeoutError(error: unknown): boolean {
    const cause: unknown = error instanceof APIException ? error.error : error;
    const code: string =
      axios.isAxiosError(cause) && cause.code
        ? cause.code
        : (cause as NodeJS.ErrnoException | undefined)?.code ?? "";
    const message: string =
      cause instanceof Error ? (cause.message || "").toLowerCase() : "";

    return (
      code === "ECONNABORTED" ||
      code === "ETIMEDOUT" ||
      code === "ESOCKETTIMEDOUT" ||
      message.includes("timeout")
    );
  }

  // SMSEagle returns errors in 'message' field, one per parameter on 400
  @CaptureSpan()
  public static getErrorMessage(response: HTTPErrorResponse): string {
    const message: JSONValue | undefined = response.data?.["message"];

    if (message && typeof message === "object") {
      return Object.entries(message as JSONObject)
        .map(([parameter, error]: [string, JSONValue]) => {
          return `${parameter}: ${error}`;
        })
        .join("; ");
    }

    return (
      (message as string) ||
      `SMSEagle answered with HTTP ${response.statusCode}.`
    );
  }
}
