import APIException from "../../../Types/Exception/ApiException";
import axios, { AxiosError } from "axios";

/*
 * HOW A REQUEST TO THE NOTIFICATION SERVICE THAT GOT NO ANSWER WENT
 * (issue #6873): never reached it, or no answer.
 *
 * Common's API.post hands back an answer that is an HTTP error rather than
 * throwing it. It throws for a request that got no answer at all, as an
 * APIException holding the AxiosError (API.getErrorResponse), whose cause
 * is the socket error Node raised - and that says which call failed:
 *
 *  - getaddrinfo, for a name that did not resolve (ENOTFOUND, EAI_AGAIN);
 *  - connect, for a connection that was not opened (ECONNREFUSED, and
 *    EHOSTUNREACH, ENETUNREACH, EADDRNOTAVAIL, ETIMEDOUT when connect()
 *    raised them). For a name with several addresses Node tries each in
 *    turn, and raises an AggregateError of the attempts;
 *  - read or write, or nothing at all - a reset, a hang-up, axios's own
 *    timeout - once the request may have gone out.
 *
 * Kept apart from what is written of it (OnCallSendFailure), with nothing
 * but axios and the exception it is wrapped in, so it can be held to what
 * a real request throws in a plain Node process
 * (Tests/Server/TestingUtils/NotificationRequestErrorsProbe.ts).
 */

export enum NotificationRequestFailureKind {
  // Never reached the Notification service: nothing was sent.
  NotReached = "NotReached",
  // May have reached it: whether it was sent is not known here.
  NoAnswer = "NoAnswer",
}

export interface NotificationRequestFailure {
  kind: NotificationRequestFailureKind;
  // The socket error's code - ECONNREFUSED, ENOTFOUND, ECONNRESET ...
  code: string;
}

/*
 * A name that did not resolve: getaddrinfo's codes. The request was never
 * sent anywhere.
 */
const NAME_NOT_RESOLVED_CODES: ReadonlyArray<string> = [
  "ENOTFOUND",
  "EAI_AGAIN",
  "EAI_FAIL",
  "EAI_NONAME",
  "EAI_NODATA",
];

/*
 * A connection that was never opened. Refused is always one. The others
 * are only when the error says connect() raised them: a host unreachable,
 * or a timeout, on a connection already open, may come after the request
 * went out.
 */
const CONNECTION_REFUSED_CODE: string = "ECONNREFUSED";

const CONNECT_ONLY_CODES: ReadonlyArray<string> = [
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EADDRNOTAVAIL",
  "ETIMEDOUT",
];

// How far into nested errors (an AggregateError's own) the codes are read.
const MAX_SOCKET_ERROR_DEPTH: number = 3;

interface SocketErrorShape {
  code?: unknown;
  syscall?: unknown;
  errors?: unknown;
}

/*
 * The code of a socket error that says the request never left: its name
 * did not resolve, or its connection was not opened. An AggregateError -
 * Node trying each address of a name in turn - only when every address
 * failed so. Null for anything else.
 */
function getNotReachedCode(error: unknown, depth: number): string | null {
  if (!error || typeof error !== "object" || depth > MAX_SOCKET_ERROR_DEPTH) {
    return null;
  }

  const socketError: SocketErrorShape = error as SocketErrorShape;

  if (Array.isArray(socketError.errors) && socketError.errors.length > 0) {
    let firstCode: string | null = null;

    for (const attempt of socketError.errors) {
      const code: string | null = getNotReachedCode(attempt, depth + 1);

      if (!code) {
        return null;
      }

      firstCode = firstCode || code;
    }

    return firstCode;
  }

  const code: string | null =
    typeof socketError.code === "string" ? socketError.code : null;

  if (!code) {
    return null;
  }

  if (
    NAME_NOT_RESOLVED_CODES.includes(code) ||
    code === CONNECTION_REFUSED_CODE
  ) {
    return code;
  }

  if (CONNECT_ONLY_CODES.includes(code) && socketError.syscall === "connect") {
    return code;
  }

  return null;
}

/*
 * How a request to the Notification service that threw went: never
 * reached it, or no answer. Null when the error is not a request that got
 * no answer - the send failed before the request was made, or (never
 * thrown by API.post) the service answered.
 *
 * Read from the AxiosError API.post wraps in an APIException
 * (API.getErrorResponse), and from the socket error axios keeps as its
 * cause, which says which call failed (syscall).
 */
export function classifyNotificationRequestFailure(
  error: unknown,
): NotificationRequestFailure | null {
  const requestError: unknown =
    error instanceof APIException ? error.error : error;

  if (!axios.isAxiosError(requestError) || requestError.response) {
    return null;
  }

  const axiosError: AxiosError = requestError;

  /*
   * Decided on the socket error when axios kept one: its own code is only
   * the first of an AggregateError's, and it carries no syscall.
   */
  const notReachedCode: string | null =
    axiosError.cause !== undefined && axiosError.cause !== null
      ? getNotReachedCode(axiosError.cause, 0)
      : getNotReachedCode(axiosError, 0);

  if (notReachedCode) {
    return {
      kind: NotificationRequestFailureKind.NotReached,
      code: notReachedCode,
    };
  }

  return {
    kind: NotificationRequestFailureKind.NoAnswer,
    code: axiosError.code || "no answer",
  };
}

/*
 * What a notification whose request never reached the Notification service
 * says: the code only - the error's own message names the service's
 * internal address, which is not for the person paged.
 */
export function getNotReachedStatusMessage(code: string): string {
  return `Could not reach the Notification service to send this (${code}).`;
}
