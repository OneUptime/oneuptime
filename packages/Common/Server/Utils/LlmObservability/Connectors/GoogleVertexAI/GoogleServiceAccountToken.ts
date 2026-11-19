import jwt from "jsonwebtoken";
import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../../Types/LlmObservability/LlmConnectionTest";
import {
  MAX_PROVIDER_MESSAGE_LENGTH,
  describeFailedAnswer,
  readBodyText,
  readErrorCode,
} from "../../../DataSource/HttpFailure";
import GoogleSecOpsClient from "../../../SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import { LlmConnectorTransport } from "../../LlmConnectorTypes";
import LlmProviderError from "../../LlmProviderError";
import LlmProviderHttp, { readObject, readText } from "../../LlmProviderHttp";

/*
 * A Google Cloud service account signing in as itself (OAuth 2.0 for
 * server-to-server applications): an RS256 JWT assertion signed with the
 * key's private_key, exchanged at the key's token_uri for an access token.
 *
 * The key is read and checked by the parser the Google SecOps connection
 * already uses (GoogleSecOpsClient.parseServiceAccountJson): client_email
 * and private_key present, private_key a readable PEM key, token_uri an
 * https URL on a Google host - so the assertion, which proves the service
 * account's identity, is never sent anywhere else.
 * https://developers.google.com/identity/protocols/oauth2/service-account
 *
 * A sign-in Google refuses is said in Google's words, as every other
 * failed answer of a data source is (describeFailedAnswer, #9680): who
 * was refused, the status and Google's own error code, its description,
 * and what to do for the refusals whose cause Google's "JWT error codes"
 * name - never the raw JSON of its answer:
 *
 *   Google Cloud refused the service account oneuptime@acme.iam.gserviceaccount.com
 *   (400, invalid_grant) while signing in: Invalid JWT Signature. The key
 *   may have been deleted or disabled, or may have expired: create a new
 *   key and save it again.
 */

const TOKEN_LIFETIME_IN_SECONDS: number = 3600;
// Signed this far in the past, so a fast clock here is not "not yet valid".
const CLOCK_SKEW_IN_SECONDS: number = 60;
const EXPIRY_SLACK_IN_MS: number = 60 * 1000;

// What a sign-in is, as a failure says "while ...".
export const GOOGLE_SIGN_IN_OPERATION: string = "signing in";

/*
 * What Google's sign-in answered, read from its body: the OAuth 2.0 token
 * endpoint's `error` and `error_description` (RFC 6749, 5.2), or a Google
 * API's `{"error": {"status", "message"}}`. A body that is neither - a
 * proxy's HTML page, a line of text - says its words (readBodyText) and no
 * code; an empty one says nothing.
 */
export interface GoogleSignInAnswer {
  // Google's own code: invalid_grant, disabled_client, PERMISSION_DENIED.
  code: string | null;
  // Google's own words for it, its first line: "Invalid JWT Signature.".
  description: string;
}

function parseJsonObject(text: string): JSONObject | null {
  try {
    const parsed: unknown = JSON.parse(text);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JSONObject)
      : null;
  } catch {
    return null;
  }
}

export function readGoogleSignInAnswer(body: string): GoogleSignInAnswer {
  const text: string = (body || "").trim();
  const json: JSONObject | null = text ? parseJsonObject(text) : null;

  if (!json) {
    return { code: null, description: readBodyText(text) };
  }

  // The token endpoint's: {"error": "invalid_grant", "error_description": "..."}.
  if (typeof json["error"] === "string") {
    return {
      code: readErrorCode(json["error"]),
      description: readBodyText(readText(json["error_description"])),
    };
  }

  // A Google API's: {"error": {"code": 403, "status": "PERMISSION_DENIED", "message": "..."}}.
  const error: JSONObject = readObject(json["error"]);

  return {
    code: readErrorCode(error["status"]),
    description: readBodyText(readText(error["message"])),
  };
}

/*
 * The OAuth errors in which Google refuses the credential itself, whatever
 * the status they come with (Google's "JWT error codes"): a key or service
 * account it does not take, disabled or deleted, or one an organization's
 * policy keeps out. invalid_scope and invalid_request are none: they say
 * what OneUptime asked for.
 */
const GOOGLE_REFUSING_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  "invalid_grant",
  "invalid_client",
  "unauthorized_client",
  "disabled_client",
  "deleted_client",
  "access_denied",
  "admin_policy_enforced",
  "org_internal",
]);

// Google refuses a JWT whose iat and exp are not "in a reasonable timeframe": a clock that is off.
const GOOGLE_CLOCK_REFUSAL: RegExp = /timeframe|\biat\b|\bexp\b/i;

/*
 * What to do about a refusal, where Google's "JWT error codes" say what it
 * means; undefined where its own words are all there is to say.
 */
export function getGoogleSignInAdvice(
  answer: GoogleSignInAnswer,
): string | undefined {
  switch (answer.code) {
    case "invalid_grant":
      return GOOGLE_CLOCK_REFUSAL.test(answer.description)
        ? "The clock of the server OneUptime runs on may be off: check that it keeps the right time."
        : "The key may have been deleted or disabled, or may have expired: create a new key and save it again.";
    case "disabled_client":
      return "The service account or its key is disabled: enable it under IAM & Admin > Service Accounts, or create a new key and save it again.";
    case "deleted_client":
      return "The service account was deleted: restore it within 30 days of its deletion, or create a new one and save its key.";
    default:
      return undefined;
  }
}

/*
 * Google's words, cut after the last whole sentence that fits what an error
 * keeps of them (MAX_PROVIDER_MESSAGE_LENGTH) rather than mid-word: its
 * "Invalid JWT: Token must be a short-lived token (60 minutes) and in a
 * reasonable timeframe." is the part that says what went wrong.
 */
export function fitGoogleWords(text: string): string {
  if (text.length <= MAX_PROVIDER_MESSAGE_LENGTH) {
    return text;
  }

  const end: number = text
    .slice(0, MAX_PROVIDER_MESSAGE_LENGTH)
    .lastIndexOf(". ");

  return end > 0 ? text.slice(0, end + 1) : text;
}

/*
 * A sign-in Google answered outside 2xx, in one sentence (#9680): a
 * refusal of the service account with Google's code, its words and what to
 * do; any other answer (Google down, a proxy's page) as the status and
 * Google's words. Secrets and tokens are taken out (describeFailedAnswer).
 */
export function describeGoogleSignInFailure(data: {
  // The connection's title: "Google Cloud", "Google BigQuery".
  providerTitle: string;
  clientEmail: string;
  statusCode: number;
  // The answer's body, as the transport kept it.
  body: string;
  secrets: Array<string>;
}): string {
  const answer: GoogleSignInAnswer = readGoogleSignInAnswer(data.body);
  const email: string = (data.clientEmail || "").trim();

  return describeFailedAnswer({
    provider: data.providerTitle,
    statusCode: data.statusCode,
    errorCode: answer.code,
    operation: GOOGLE_SIGN_IN_OPERATION,
    message: fitGoogleWords(answer.description),
    attempts: 1,
    requestId: null,
    refused: {
      who: email ? `the service account ${email}` : "the service account",
      advice: getGoogleSignInAdvice(answer),
    },
    isRefusal: Boolean(
      answer.code && GOOGLE_REFUSING_ERROR_CODES.has(answer.code),
    ),
    secrets: data.secrets,
  }).message;
}

export interface GoogleServiceAccountTokenOptions {
  serviceAccountJson: string;
  scope: string;
  transport: LlmConnectorTransport;
  providerTitle: string;
  requestTimeoutInMs?: number | undefined;
}

export default class GoogleServiceAccountToken {
  private options: GoogleServiceAccountTokenOptions;
  private clientEmail: string;
  private privateKey: string;
  private tokenUri: string;
  private cached: { token: string; expiresAtMs: number } | null = null;
  private requestCount: number = 0;

  public constructor(options: GoogleServiceAccountTokenOptions) {
    const credentials: {
      clientEmail: string;
      privateKey: string;
      tokenUri: string;
    } = GoogleSecOpsClient.parseServiceAccountJson(options.serviceAccountJson);

    this.options = options;
    this.clientEmail = credentials.clientEmail;
    this.privateKey = credentials.privateKey;
    this.tokenUri = credentials.tokenUri;
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  public getClientEmail(): string {
    return this.clientEmail;
  }

  public async getAccessToken(): Promise<string> {
    if (
      this.cached &&
      this.cached.expiresAtMs - EXPIRY_SLACK_IN_MS > Date.now()
    ) {
      return this.cached.token;
    }

    const issuedAt: number =
      Math.floor(Date.now() / 1000) - CLOCK_SKEW_IN_SECONDS;

    const assertion: string = jwt.sign(
      {
        iss: this.clientEmail,
        scope: this.options.scope,
        aud: this.tokenUri,
        iat: issuedAt,
        exp: issuedAt + TOKEN_LIFETIME_IN_SECONDS,
      },
      this.privateKey,
      { algorithm: "RS256" },
    );

    this.requestCount++;

    let body: JSONObject;

    try {
      body = await LlmProviderHttp.requestJson({
        transport: this.options.transport,
        method: "POST",
        url: this.tokenUri,
        headers: { Accept: "application/json" },
        formUrlEncoded: true,
        body: {
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: assertion,
        },
        timeoutInMs: this.options.requestTimeoutInMs,
        step: "sign-in",
        providerTitle: this.options.providerTitle,
        secretValues: [this.privateKey, assertion],
      });
    } catch (error) {
      const secrets: Array<string> = [this.privateKey, assertion];
      const failure: LlmProviderError = LlmProviderError.from({
        error,
        step: "sign-in",
        providerTitle: this.options.providerTitle,
        secretValues: secrets,
      });

      /*
       * No answer at all (a timeout, a network that failed), or a 2xx that
       * was no JSON: said as it is. Only an answer outside 2xx is Google's
       * refusal or failure to sign in.
       */
      if (
        failure.statusCode === undefined ||
        (failure.statusCode >= 200 && failure.statusCode < 300)
      ) {
        throw failure;
      }

      throw new LlmProviderError({
        message: LlmProviderError.redact(
          describeGoogleSignInFailure({
            providerTitle: this.options.providerTitle,
            clientEmail: this.clientEmail,
            statusCode: failure.statusCode,
            body: failure.responseBody || "",
            secrets,
          }),
          secrets,
        ),
        // Google answers a revoked or deleted key with 400 invalid_grant.
        kind:
          failure.statusCode === 400 || failure.statusCode === 401
            ? LlmConnectionFailureKind.Authentication
            : failure.kind,
        statusCode: failure.statusCode,
        retryAfterSeconds: failure.retryAfterSeconds,
        responseBody: failure.responseBody,
      });
    }

    const token: string = readText(body["access_token"]);

    if (!token) {
      throw new LlmProviderError({
        message: `${this.options.providerTitle} sign-in returned no access token.`,
        kind: LlmConnectionFailureKind.Authentication,
      });
    }

    const expiresIn: number = Number(body["expires_in"]);

    this.cached = {
      token,
      expiresAtMs:
        Date.now() +
        (Number.isFinite(expiresIn) && expiresIn > 0
          ? expiresIn * 1000
          : 5 * 60 * 1000),
    };

    return token;
  }
}
