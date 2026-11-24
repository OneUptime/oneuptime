import { AxiosError } from "axios";
import {
  ERROR_REFERENCE_FIELD,
  getUnexplainedServerErrorMessage,
  isEmptyErrorPhrase,
  isErrorPage,
  isErrorReference,
  SERVER_DOWN_SENTENCE,
  UNEXPLAINED_ERROR_MESSAGES,
} from "./unexplainedError";

/*
 * What the app says for a failure it cannot put into words itself (#7275):
 * the app's own code failed, outside any request. The Dashboard's "page"
 * sentence tells a reader to reload the page, which an app has no way to.
 */
export const APP_PROBLEM_SENTENCE: string =
  "The app ran into a problem, so this did not finish. Try again, and if it keeps happening, close the app and open it again.";

/*
 * No answer at all: the phone is offline, or the server address is wrong -
 * which on this app looks the same at the transport, and self-hosted
 * people mistype the address, so both are named (#7275: OneUptime could not
 * be reached, the Dashboard's "unreachable").
 */
export const UNREACHABLE_SENTENCE: string =
  "OneUptime could not be reached, so this did not finish. Check your internet connection and the server URL, then try again.";

// The app's own timeout fired before the server answered.
export const TIMED_OUT_SENTENCE: string =
  "The request timed out, so this did not finish. Check your internet connection, then try again.";

// A refusal the server answered with only its status.
export function getStatusOnlySentence(status: number): string {
  return `The server refused this request with status ${status}, so this did not finish. Try again, and if it keeps failing, tell your OneUptime administrator.`;
}

/**
 * Extracts a user-friendly error message from various error types.
 * Inspired by Common/UI/Utils/API/API.ts -> getFriendlyMessage()
 *
 * For Axios errors (e.g. 400 Bad Request), extracts the server's
 * descriptive message instead of showing generic "Request failed with
 * status code 400". A failure nobody explained is said as the server and
 * the Dashboard say it (utils/unexplainedError), with its reference when
 * the server gave one, and never as "Server Error" (#7275).
 */
export function getFriendlyErrorMessage(err: unknown): string {
  if (!err) {
    return APP_PROBLEM_SENTENCE;
  }

  // Handle Axios errors (most common case for API calls)
  if (isAxiosError(err)) {
    const axiosError: AxiosError = err as AxiosError;

    // Check for network / timeout errors first (no response from server)
    if (!axiosError.response) {
      if (
        axiosError.code === "ECONNABORTED" ||
        axiosError.code === "ETIMEDOUT"
      ) {
        return TIMED_OUT_SENTENCE;
      }

      return UNREACHABLE_SENTENCE;
    }

    const { status, data } = axiosError.response;

    /*
     * Extract message from response body — server sends { message: "..." }
     * Also check "data" and "error" fields (matching Common/Types/API/HTTPErrorResponse.ts)
     */
    const serverMessage: string | undefined = extractMessageFromData(data);

    // A message that says something, kept as the server wrote it.
    if (
      serverMessage &&
      !isEmptyErrorPhrase(serverMessage) &&
      !isErrorPage(serverMessage)
    ) {
      return serverMessage;
    }

    // A gateway's 502 or 504: the server is down or restarting.
    if (status === 502 || status === 504) {
      return SERVER_DOWN_SENTENCE;
    }

    // What was sent was larger than the server, or a proxy, takes.
    if (status === 413) {
      return UNEXPLAINED_ERROR_MESSAGES.tooLarge;
    }

    if (status === 403) {
      return "You do not have permission to do this. Ask a Project Owner or Project Admin for access, then try again.";
    }

    if (status === 404) {
      return "The server did not find what was asked for. Check the server URL, then try again.";
    }

    /*
     * The server failed, or said only an empty phrase ("Server Error"):
     * its sentence for a failure nobody explained, with its reference.
     */
    if (status >= 500 || (serverMessage && !isErrorPage(serverMessage))) {
      return getUnexplainedServerErrorMessage(getErrorReference(err));
    }

    return getStatusOnlySentence(status);
  }

  // Handle standard Error objects
  if (err instanceof Error) {
    return err.message || APP_PROBLEM_SENTENCE;
  }

  // Handle string errors
  if (typeof err === "string") {
    return err;
  }

  return APP_PROBLEM_SENTENCE;
}

/*
 * The reference a failure nobody explained carries - the start of the
 * request's id, which the server's log names - or null: for the person to
 * copy and give to whoever runs the server, or to OneUptime support.
 */
export function getErrorReference(err: unknown): string | null {
  if (!isAxiosError(err)) {
    return null;
  }

  const data: unknown = (err as AxiosError).response?.data;

  if (!data || typeof data !== "object") {
    return null;
  }

  const reference: unknown = (data as Record<string, unknown>)[
    ERROR_REFERENCE_FIELD
  ];

  return isErrorReference(reference) ? reference : null;
}

/**
 * Extracts a human-readable message from Axios response data.
 * The server may return the message in different fields:
 *   - { message: "..." }
 *   - { data: "..." }
 *   - { error: "..." }
 * This matches the logic in Common/Types/API/HTTPErrorResponse.ts
 */
function extractMessageFromData(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    if (typeof data === "string" && data.length > 0) {
      return data;
    }
    return undefined;
  }

  const obj: Record<string, unknown> = data as Record<string, unknown>;

  if (typeof obj["message"] === "string" && obj["message"].length > 0) {
    return obj["message"];
  }

  if (typeof obj["data"] === "string" && obj["data"].length > 0) {
    return obj["data"];
  }

  if (typeof obj["error"] === "string" && obj["error"].length > 0) {
    return obj["error"];
  }

  return undefined;
}

/**
 * Type guard to check if an error is an Axios error.
 */
function isAxiosError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "isAxiosError" in err &&
    (err as AxiosError).isAxiosError === true
  );
}
