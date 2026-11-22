/*
 * The code a failed request came with - Node's ECONNREFUSED,
 * DEPTH_ZERO_SELF_SIGNED_CERT, ERR_TLS_CERT_ALTNAME_INVALID and the like -
 * found under the errors it arrives wrapped in: axios's AxiosError (its
 * code, or its cause's) and the API client's APIException (its error's).
 * Undefined for an error that carries none.
 *
 * Browser-safe: it reads only what an error holds.
 */
export function getRequestErrorCode(
  error: unknown,
  depth: number = 0,
): string | undefined {
  if (!error || typeof error !== "object" || depth > 4) {
    return undefined;
  }

  const value: { code?: unknown; cause?: unknown; error?: unknown } = error as {
    code?: unknown;
    cause?: unknown;
    error?: unknown;
  };

  if (typeof value.code === "string" && value.code) {
    return value.code;
  }

  return (
    getRequestErrorCode(value.cause, depth + 1) ||
    getRequestErrorCode(value.error, depth + 1)
  );
}
