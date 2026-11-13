import APIException from "../../../Types/Exception/ApiException";
import { AxiosError, InternalAxiosRequestConfig } from "axios";

/*
 * WHAT COMMON'S API.post THROWS FOR A REQUEST TO THE NOTIFICATION SERVICE
 * THAT GOT NO ANSWER, built without a network: an APIException
 * (API.getErrorResponse) holding the AxiosError, which holds the socket
 * error Node raised as its cause - or, for a timeout, none.
 *
 * Each is built the way axios builds it (AxiosError.from for a socket
 * error, new AxiosError for its own timeout), and
 * NotificationRequestFailure.test.ts holds each to the error a real request
 * makes - a refused port, a server that resets or hangs up, one that never
 * answers, a name that does not resolve - field by field
 * (NotificationRequestErrorsProbe, run in a plain Node process). Common's
 * suites run in jsdom, where axios would send through XMLHttpRequest, so
 * they use these.
 */

export const NOTIFICATION_SERVICE_URL: string =
  "http://app:3002/api/notification/sms/send";

// The socket error Node raises, with the fields it sets.
export function socketError(data: {
  message: string;
  code: string;
  syscall?: string | undefined;
  address?: string | undefined;
  port?: number | undefined;
}): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException & { address?: string; port?: number } =
    new Error(data.message);

  error.code = data.code;

  if (data.syscall) {
    error.syscall = data.syscall;
  }

  if (data.address) {
    error.address = data.address;
  }

  if (data.port) {
    error.port = data.port;
  }

  return error;
}

function requestConfig(): InternalAxiosRequestConfig {
  return {
    url: NOTIFICATION_SERVICE_URL,
    method: "post",
  } as unknown as InternalAxiosRequestConfig;
}

// As API.getErrorResponse wraps it.
function asApiException(axiosError: AxiosError): APIException {
  return new APIException(
    `Request failed to ${NOTIFICATION_SERVICE_URL}. ${axiosError.message}`,
    axiosError,
  );
}

// A socket error, as axios's http adapter hands it on (AxiosError.from).
export function requestFailedWith(cause: Error): APIException {
  return asApiException(
    AxiosError.from(
      cause,
      (cause as NodeJS.ErrnoException).code,
      requestConfig(),
    ),
  );
}

// Nothing listens on the port.
export function refusedRequestError(): APIException {
  return requestFailedWith(
    socketError({
      message: "connect ECONNREFUSED 10.0.0.5:3002",
      code: "ECONNREFUSED",
      syscall: "connect",
      address: "10.0.0.5",
      port: 3002,
    }),
  );
}

/*
 * A name with two addresses, refused on both: Node tries each in turn and
 * raises an AggregateError of the attempts, its code the first's.
 */
export function refusedOnEveryAddressRequestError(): APIException {
  const attempts: Array<Error> = [
    socketError({
      message: "connect ECONNREFUSED ::1:3002",
      code: "ECONNREFUSED",
      syscall: "connect",
      address: "::1",
      port: 3002,
    }),
    socketError({
      message: "connect ECONNREFUSED 127.0.0.1:3002",
      code: "ECONNREFUSED",
      syscall: "connect",
      address: "127.0.0.1",
      port: 3002,
    }),
  ];

  // Node's AggregateError, as far as anybody reads it (the target is ES2017).
  const aggregate: Error & { code?: string; errors?: Array<Error> } = new Error(
    attempts
      .map((attempt: Error): string => {
        return attempt.message;
      })
      .join("; "),
  );

  aggregate.name = "AggregateError";
  aggregate.errors = attempts;
  aggregate.code = "ECONNREFUSED";

  return requestFailedWith(aggregate);
}

// The service's name did not resolve: getaddrinfo's code.
export function unresolvedNameRequestError(
  code: "ENOTFOUND" | "EAI_AGAIN" = "ENOTFOUND",
): APIException {
  return requestFailedWith(
    socketError({
      message: `getaddrinfo ${code} app`,
      code: code,
      syscall: "getaddrinfo",
    }),
  );
}

// The connection was reset once the request had gone out.
export function resetRequestError(): APIException {
  return requestFailedWith(
    socketError({
      message: "read ECONNRESET",
      code: "ECONNRESET",
      syscall: "read",
    }),
  );
}

// The server closed the connection without answering.
export function hungUpRequestError(): APIException {
  return requestFailedWith(
    socketError({
      message: "socket hang up",
      code: "ECONNRESET",
    }),
  );
}

// No answer within the request's timeout: axios's own error, with no cause.
export function timedOutRequestError(): APIException {
  return asApiException(
    new AxiosError(
      "timeout of 300ms exceeded",
      AxiosError.ECONNABORTED,
      requestConfig(),
    ),
  );
}

/*
 * What a thrown request error is made of, as far as anybody reads it: the
 * wrapper, the AxiosError in it, and the socket error that is its cause -
 * with the attempts of an AggregateError.
 */
export interface RequestErrorShape {
  isAPIException: boolean;
  innerIsAxiosError: boolean;
  innerName: unknown;
  innerCode: unknown;
  innerSyscall: unknown;
  innerHasResponse: boolean;
  hasCause: boolean;
  causeName: unknown;
  causeCode: unknown;
  causeSyscall: unknown;
  causeAttempts: Array<{ code: unknown; syscall: unknown }> | null;
}

export function describeRequestError(error: unknown): RequestErrorShape {
  const inner: (AxiosError & { syscall?: unknown }) | null =
    error instanceof APIException && error.error
      ? (error.error as AxiosError & { syscall?: unknown })
      : null;

  const cause: {
    name?: unknown;
    code?: unknown;
    syscall?: unknown;
    errors?: unknown;
  } | null =
    (inner?.cause as {
      name?: unknown;
      code?: unknown;
      syscall?: unknown;
      errors?: unknown;
    }) || null;

  return {
    isAPIException: error instanceof APIException,
    innerIsAxiosError: inner?.isAxiosError === true,
    innerName: inner?.name,
    innerCode: inner?.code,
    innerSyscall: inner?.syscall,
    innerHasResponse: Boolean(inner?.response),
    hasCause: Boolean(cause),
    causeName: cause?.name,
    causeCode: cause?.code,
    causeSyscall: cause?.syscall,
    causeAttempts: Array.isArray(cause?.errors)
      ? (cause!.errors as Array<{ code?: unknown; syscall?: unknown }>).map(
          (attempt: { code?: unknown; syscall?: unknown }) => {
            return { code: attempt.code, syscall: attempt.syscall };
          },
        )
      : null,
  };
}
