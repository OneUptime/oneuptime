import { TelemetryErrorClassEnabled } from "../EnvironmentConfig";
import StatusCode from "../../Types/API/StatusCode";
import { isEmptyErrorPhrase } from "../../Types/Exception/ErrorMessageRule";
import Exception from "../../Types/Exception/Exception";
import {
  DeclaredErrorClass,
  declaredErrorClass,
  isNonActionableErrorClass,
} from "../../Types/Telemetry/ErrorClass";

/*
 * WHICH REFUSALS ARE A CLIENT'S (#10768): the rule ClientRefusalLog logs
 * by - a refusal answered by Response.sendErrorResponse or the Express
 * error handler is logged at debug when it is one - and the @CaptureSpan
 * recorder too (Telemetry.recordExceptionOnSpan, #10797). Kept apart from
 * ClientRefusalLog, which reaches Express and the request metrics, so the
 * recorder can read it: Telemetry is imported before either.
 */

// Whether a status is a refusal of what the client sent: 4xx.
export const isClientErrorStatus: (status: number) => boolean = (
  status: number,
): boolean => {
  return Number.isInteger(status) && status >= 400 && status < 500;
};

/*
 * Whether an error answered with `status` is a client's refusal (see
 * ClientRefusalLog): a 4xx, its fault declared the client's, in words.
 */
export const isClientRefusal: (error: unknown, status: number) => boolean = (
  error: unknown,
  status: number,
): boolean => {
  if (!isClientErrorStatus(status) || !TelemetryErrorClassEnabled) {
    return false;
  }

  if (!(error instanceof Error) || isEmptyErrorPhrase(error.message)) {
    return false;
  }

  const declared: DeclaredErrorClass | null = declaredErrorClass(error);

  return declared !== null && isNonActionableErrorClass(declared.errorClass);
};

/*
 * The status a thrown value is answered with, when it reaches the answer:
 * an Exception's code when that is an HTTP status, as
 * Response.sendErrorResponse and the Express error handler answer one, and
 * 500 for anything else - another code, or no Exception at all, which the
 * error handler logs at error whatever it says.
 */
export const answeredStatusOf: (error: unknown) => number = (
  error: unknown,
): number => {
  return error instanceof Exception && StatusCode.isValidStatusCode(error.code)
    ? error.code
    : 500;
};

/*
 * Whether a value thrown inside a request is a client's refusal at the
 * status it is answered with: what the request's answer logs at debug.
 */
export const isAnsweredAsClientRefusal: (error: unknown) => boolean = (
  error: unknown,
): boolean => {
  return isClientRefusal(error, answeredStatusOf(error));
};
