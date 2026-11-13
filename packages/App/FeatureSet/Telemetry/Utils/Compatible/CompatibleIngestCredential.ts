import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
  headerValueToString,
} from "Common/Server/Utils/Express";

/*
 * THE INGESTION KEY, WHERE ANOTHER TOOL'S CLIENT PUTS ITS CREDENTIAL.
 *
 * Every ingest route checks the project's ingestion key in the
 * x-oneuptime-token header (TelemetryIngest). A client that speaks another
 * tool's protocol cannot always be told to send that header - Splunk's
 * Docker logging driver sends its token as `Authorization: Splunk <token>`
 * and nothing else, a Sentry SDK puts its key in X-Sentry-Auth or the query
 * string, the Datadog Agent in DD-API-KEY - so each compatible endpoint
 * names the schemes its clients use, and the key found in one is passed on
 * as x-oneuptime-token. An x-oneuptime-token the request already carries
 * wins: a client that can send it should not be second-guessed.
 *
 * Nothing here decides whether a key is valid; TelemetryIngest does, with
 * the same refusals as on every other route.
 *
 * Ingestion keys are UUIDs. Sentry's DSN parser refuses a key with hyphens
 * in it, and Datadog's API keys are 32 hex digits, so a key may also be
 * written as its 32 hex digits without hyphens; it is put back in UUID form
 * here.
 */

export enum CompatibleCredentialScheme {
  // Authorization: Bearer <key> (Prometheus, Loki clients, Grafana Alloy).
  Bearer = "Bearer",
  /*
   * Authorization: Basic base64(<user>:<key>) - the username can be
   * anything (Grafana Cloud's style is an instance ID). A key given as the
   * username with no password is read too.
   */
  Basic = "Basic",
  // Authorization: Splunk <key> (Splunk HTTP Event Collector clients).
  Splunk = "Splunk",
  // DD-API-KEY: <key> (the Datadog Agent and Datadog's HTTP API clients).
  DatadogApiKey = "DatadogApiKey",
  /*
   * X-Sentry-Auth: Sentry sentry_key=<key>, ... (server SDKs), or
   * ?sentry_key=<key> (browser SDKs, which put it in the URL so a report is
   * a simple request with no CORS preflight).
   */
  SentryKey = "SentryKey",
}

// The headers TelemetryIngest reads the key from, in its order.
const ONEUPTIME_KEY_HEADERS: ReadonlyArray<string> = [
  "x-oneuptime-token",
  "x-oneuptime-service-token",
  "x-oneuptime-ingestion-key",
];

const UUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNDASHED_UUID: RegExp = /^[0-9a-f]{32}$/i;

// A key longer than this is not one; it is not passed on.
const MAX_KEY_LENGTH: number = 256;

export interface CredentialSource {
  headers: Record<string, string | Array<string> | undefined>;
  query?: Record<string, unknown> | undefined;
}

export default class CompatibleIngestCredential {
  /*
   * A key as the ingestion key check reads it: trimmed, and in UUID form
   * when it was written as 32 hex digits without hyphens.
   */
  public static normalizeKey(raw: string): string {
    const key: string = raw.trim();

    if (UNDASHED_UUID.test(key)) {
      const hex: string = key.toLowerCase();

      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    return key;
  }

  // A key written as 32 hex digits, as Sentry DSNs and Datadog API keys need it.
  public static undashedKey(key: string): string {
    return UUID.test(key.trim()) ? key.trim().replace(/-/g, "") : key.trim();
  }

  /*
   * The key the request carries in one of `schemes`, or null. Schemes are
   * tried in the order given.
   */
  public static fromRequest(
    source: CredentialSource,
    schemes: ReadonlyArray<CompatibleCredentialScheme>,
  ): string | null {
    for (const scheme of schemes) {
      const key: string | null = CompatibleIngestCredential.fromScheme(
        source,
        scheme,
      );

      if (key) {
        return CompatibleIngestCredential.normalizeKey(key);
      }
    }

    return null;
  }

  /*
   * Express middleware: passes the key a compatible client sent on as
   * x-oneuptime-token, for the TelemetryIngest guard after it.
   */
  public static middleware(
    schemes: ReadonlyArray<CompatibleCredentialScheme>,
  ): RequestHandler {
    return (
      req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ): void => {
      CompatibleIngestCredential.apply(req, schemes);
      next();
    };
  }

  public static apply(
    req: ExpressRequest,
    schemes: ReadonlyArray<CompatibleCredentialScheme>,
  ): void {
    const headers: Record<string, string | Array<string> | undefined> =
      req.headers as Record<string, string | Array<string> | undefined>;

    const existing: string | undefined = ONEUPTIME_KEY_HEADERS.map(
      (name: string): string | undefined => {
        return headerValueToString(headers[name]);
      },
    ).find((value: string | undefined): boolean => {
      return Boolean(value && value.trim());
    });

    if (existing) {
      headers["x-oneuptime-token"] =
        CompatibleIngestCredential.normalizeKey(existing);
      return;
    }

    const key: string | null = CompatibleIngestCredential.fromRequest(
      {
        headers: headers,
        query: req.query as Record<string, unknown> | undefined,
      },
      schemes,
    );

    if (key) {
      headers["x-oneuptime-token"] = key;
    }
  }

  private static fromScheme(
    source: CredentialSource,
    scheme: CompatibleCredentialScheme,
  ): string | null {
    switch (scheme) {
      case CompatibleCredentialScheme.Bearer:
        return CompatibleIngestCredential.fromAuthorization(source, "bearer");
      case CompatibleCredentialScheme.Splunk:
        return CompatibleIngestCredential.fromAuthorization(source, "splunk");
      case CompatibleCredentialScheme.Basic:
        return CompatibleIngestCredential.fromBasic(source);
      case CompatibleCredentialScheme.DatadogApiKey:
        return CompatibleIngestCredential.usable(
          headerValueToString(source.headers["dd-api-key"]),
        );
      case CompatibleCredentialScheme.SentryKey:
        return (
          CompatibleIngestCredential.fromSentryAuthHeader(source) ||
          CompatibleIngestCredential.fromQuery(source, "sentry_key")
        );
      default:
        return null;
    }
  }

  private static fromAuthorization(
    source: CredentialSource,
    expectedScheme: string,
  ): string | null {
    const header: string | undefined = headerValueToString(
      source.headers["authorization"],
    );

    if (!header) {
      return null;
    }

    const match: RegExpMatchArray | null = header
      .trim()
      .match(/^(\S+)\s+(.+)$/);

    if (!match || match[1]!.toLowerCase() !== expectedScheme) {
      return null;
    }

    return CompatibleIngestCredential.usable(match[2]);
  }

  private static fromBasic(source: CredentialSource): string | null {
    const encoded: string | null = CompatibleIngestCredential.fromAuthorization(
      source,
      "basic",
    );

    if (!encoded) {
      return null;
    }

    let decoded: string;

    try {
      decoded = Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      return null;
    }

    const separator: number = decoded.indexOf(":");
    const username: string =
      separator === -1 ? decoded : decoded.slice(0, separator);
    const password: string =
      separator === -1 ? "" : decoded.slice(separator + 1);

    const isKey: (value: string) => boolean = (value: string): boolean => {
      const normalized: string = CompatibleIngestCredential.normalizeKey(value);
      return UUID.test(normalized);
    };

    /*
     * The password is the key, whatever the username is - unless only the
     * username looks like one (a key pasted into the wrong field).
     */
    if (password && !isKey(password) && isKey(username)) {
      return CompatibleIngestCredential.usable(username);
    }

    return CompatibleIngestCredential.usable(password || username);
  }

  /*
   * X-Sentry-Auth: "Sentry sentry_version=7, sentry_client=x/1.0,
   * sentry_key=<key>" - comma-separated pairs, after an optional "Sentry".
   */
  private static fromSentryAuthHeader(source: CredentialSource): string | null {
    const header: string | undefined = headerValueToString(
      source.headers["x-sentry-auth"],
    );

    if (!header) {
      return null;
    }

    const pairs: string = header.trim().replace(/^sentry\s+/i, "");

    for (const pair of pairs.split(",")) {
      const separator: number = pair.indexOf("=");

      if (separator === -1) {
        continue;
      }

      const name: string = pair.slice(0, separator).trim().toLowerCase();

      if (name === "sentry_key") {
        return CompatibleIngestCredential.usable(pair.slice(separator + 1));
      }
    }

    return null;
  }

  private static fromQuery(
    source: CredentialSource,
    name: string,
  ): string | null {
    const value: unknown = source.query ? source.query[name] : undefined;

    if (typeof value === "string") {
      return CompatibleIngestCredential.usable(value);
    }

    if (Array.isArray(value) && typeof value[0] === "string") {
      return CompatibleIngestCredential.usable(value[0]);
    }

    return null;
  }

  private static usable(value: string | undefined | null): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed: string = value.trim();

    if (!trimmed || trimmed.length > MAX_KEY_LENGTH) {
      return null;
    }

    return trimmed;
  }
}
