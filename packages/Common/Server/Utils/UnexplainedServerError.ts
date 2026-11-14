import { ExpressRequest, ExpressResponse, OneUptimeRequest } from "./Express";
import logger, { getLogAttributesFromRequest } from "./Logger";
import StatusCode from "../../Types/API/StatusCode";
import { JSONObject } from "../../Types/JSON";
import {
  ERROR_REFERENCE_FIELD,
  getUnexplainedServerErrorMessage,
  toErrorReference,
} from "../../Types/Exception/UnexplainedError";

/**
 * The answer to a request that failed in a way nothing explained (#6836):
 * instead of "Server Error", a sentence that says the server failed and what
 * to do next, with a reference the person can give to their administrator or
 * to support (Common/Types/Exception/UnexplainedError).
 *
 * The reference is the start of the request's id, which every log record of
 * the request carries (StartServer seeds it into TelemetryContext). This
 * writes one more log line that names it beside the request's method and
 * path, so `docker compose logs app | grep <reference>` finds the failure.
 * The error itself was logged by the caller, just before.
 *
 * Used by StartServer's last-resort handler, which answers with `error`, and
 * by Response.sendErrorResponse, which answers with `message`.
 */
export const sendUnexplainedError: (
  req: ExpressRequest | undefined,
  res: ExpressResponse,
  options: { status: number; errorField: "error" | "message" },
) => void = (
  req: ExpressRequest | undefined,
  res: ExpressResponse,
  options: { status: number; errorField: "error" | "message" },
): void => {
  const request: OneUptimeRequest | undefined = req as
    | OneUptimeRequest
    | undefined;

  const reference: string | null = toErrorReference(request?.requestId);

  // The path only: a query string can hold a token.
  const requestPath: string =
    String(request?.originalUrl || request?.url || "").split("?")[0] || "/";

  logger.error(
    `Unexplained error${reference ? `, reference ${reference}` : ""}: ${request?.method || "a request to"} ${requestPath} failed with the error logged before this line, and its answer says only that the server ran into a problem.`,
    getLogAttributesFromRequest(request),
  );

  /*
   * Only a status that is an error: a 2xx or 3xx with an error in it would
   * read as a success to the client.
   */
  const status: number =
    StatusCode.isValidStatusCode(options.status) && options.status >= 400
      ? options.status
      : 500;

  const body: JSONObject = {
    [options.errorField]: getUnexplainedServerErrorMessage(reference),
  };

  if (reference) {
    body[ERROR_REFERENCE_FIELD] = reference;
  }

  res.status(status);
  res.send(body);
};

export default sendUnexplainedError;
