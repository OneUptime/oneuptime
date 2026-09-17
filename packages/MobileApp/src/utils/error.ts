import { AxiosError } from "axios";

/**
 * Extracts a user-friendly error message from various error types.
 * Inspired by Common/UI/Utils/API/API.ts -> getFriendlyMessage()
 *
 * For Axios errors (e.g. 400 Bad Request), extracts the server's
 * descriptive message instead of showing generic "Request failed with status code 400".
 */
export function getFriendlyErrorMessage(err: unknown): string {
  if (!err) {
    return "An unknown error occurred. Please try again.";
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
        return "Request timed out. Please check your connection and try again.";
      }
      if (axiosError.code === "ERR_NETWORK") {
        return "Network error. Please check your internet connection and server URL.";
      }
      return "Could not connect to the server. Please check your internet connection and server URL.";
    }

    const { status, data } = axiosError.response;

    /*
     * Extract message from response body — server sends { message: "..." }
     * Also check "data" and "error" fields (matching Common/Types/API/HTTPErrorResponse.ts)
     */
    const serverMessage: string | undefined = extractMessageFromData(data);

    if (serverMessage) {
      return serverMessage;
    }

    // Fallback to status-code-specific messages
    if (status === 502 || status === 504) {
      return "Error connecting to server. Please try again in a few minutes.";
    }

    if (status === 403) {
      return "Access denied. You do not have permission to perform this action.";
    }

    if (status === 404) {
      return "The requested resource was not found. Please check your server URL.";
    }

    if (status === 500) {
      return "Internal server error. Please try again later.";
    }

    return `Server error (${status}). Please try again.`;
  }

  // Handle standard Error objects
  if (err instanceof Error) {
    return err.message || "An unexpected error occurred.";
  }

  // Handle string errors
  if (typeof err === "string") {
    return err;
  }

  return "An unexpected error occurred. Please try again.";
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
