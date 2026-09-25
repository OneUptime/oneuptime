import { ExpressRequest, headerValueToString } from "Common/Server/Utils/Express";
import ObjectID from "Common/Types/ObjectID";

/*
 * Pyroscope clients cannot send OneUptime's x-oneuptime-token header by
 * default — they send an Authorization header, and which scheme depends on
 * the client and its version:
 *
 *   - Bearer <token>: the `authToken` / `auth_token` option of the Go, Java
 *     and Node SDKs, and pyroscope-dotnet up to 1.4 (PYROSCOPE_AUTH_TOKEN).
 *   - Basic base64(user:password): pyroscope-dotnet 1.5+ removed
 *     PYROSCOPE_AUTH_TOKEN and only sends PYROSCOPE_BASIC_AUTH_USER /
 *     PYROSCOPE_BASIC_AUTH_PASSWORD, as do current pyroscope-rs based SDKs
 *     (Python, Ruby, Rust) and Alloy's basic_auth block.
 *
 * The ingestion key rides in either one. For Basic, the password is the
 * conventional slot (Grafana Cloud's shape: user = instance id, password =
 * token), but both halves are considered because the .NET SDK only sends
 * Basic when BOTH halves are non-empty, which invites the key in the user
 * field with a placeholder password.
 */

/*
 * Headers that already carry an explicit OneUptime ingestion key.
 * TelemetryIngest reads them in this order; an Authorization header must
 * never override any of them, or an unrelated credential (an auth proxy's
 * Basic login, say) would shadow the key the caller actually chose.
 */
export const EXPLICIT_INGEST_TOKEN_HEADERS: Array<string> = [
  "x-oneuptime-token",
  "x-oneuptime-service-token",
  "x-oneuptime-ingestion-key",
];

export function extractIngestTokenFromAuthorizationHeader(
  authorization: string | undefined,
): string | undefined {
  if (!authorization) {
    return undefined;
  }

  const match: RegExpMatchArray | null = authorization
    .trim()
    .match(/^(\S+)\s+(\S.*)$/);

  if (!match) {
    return undefined;
  }

  // Auth schemes are case-insensitive (RFC 9110 section 11.1).
  const scheme: string = match[1]!.toLowerCase();
  const credentials: string = match[2]!.trim();

  if (scheme === "bearer") {
    return credentials || undefined;
  }

  if (scheme !== "basic") {
    return undefined;
  }

  const decoded: string = Buffer.from(credentials, "base64").toString("utf8");
  const separator: number = decoded.indexOf(":");

  /*
   * No separator: a URL userinfo with only a user part
   * (https://KEY@host/pyroscope), which the .NET SDK encodes on its own.
   */
  const candidates: Array<string> = (
    separator === -1
      ? [decoded]
      : [decoded.substring(separator + 1), decoded.substring(0, separator)]
  )
    .map((value: string) => {
      return value.trim();
    })
    .filter((value: string) => {
      return value.length > 0;
    });

  if (candidates.length === 0) {
    return undefined;
  }

  /*
   * Ingestion keys are UUIDs, so pick the half that is one. Otherwise hand
   * over the conventional half and let TelemetryIngest reject it with its
   * usual "invalid ingestion token" answer.
   */
  return (
    candidates.find((value: string) => {
      return ObjectID.isValidUUID(value);
    }) || candidates[0]
  );
}

/*
 * Copy the ingestion key out of the Authorization header into
 * x-oneuptime-token, which is where TelemetryIngest looks for it. A request
 * that already names its key explicitly is left untouched.
 */
export function mapAuthorizationToIngestToken(req: ExpressRequest): void {
  const hasExplicitToken: boolean = EXPLICIT_INGEST_TOKEN_HEADERS.some(
    (header: string) => {
      return Boolean(headerValueToString(req.headers[header]));
    },
  );

  if (hasExplicitToken) {
    return;
  }

  const token: string | undefined = extractIngestTokenFromAuthorizationHeader(
    headerValueToString(req.headers["authorization"]),
  );

  if (token) {
    req.headers["x-oneuptime-token"] = token;
  }
}
