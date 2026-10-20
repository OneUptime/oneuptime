import jwt from "jsonwebtoken";
import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../../Types/LlmObservability/LlmConnectionTest";
import GoogleSecOpsClient from "../../../SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import { LlmConnectorTransport } from "../../LlmConnectorTypes";
import LlmProviderError from "../../LlmProviderError";
import LlmProviderHttp, { readText } from "../../LlmProviderHttp";

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
 */

const TOKEN_LIFETIME_IN_SECONDS: number = 3600;
// Signed this far in the past, so a fast clock here is not "not yet valid".
const CLOCK_SKEW_IN_SECONDS: number = 60;
const EXPIRY_SLACK_IN_MS: number = 60 * 1000;

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
      const failure: LlmProviderError = LlmProviderError.from({
        error,
        step: "sign-in",
        providerTitle: this.options.providerTitle,
        secretValues: [this.privateKey, assertion],
      });

      // Google answers a revoked or deleted key with 400 invalid_grant.
      if (failure.statusCode === 400 || failure.statusCode === 401) {
        throw new LlmProviderError({
          message: failure.message,
          kind: LlmConnectionFailureKind.Authentication,
          statusCode: failure.statusCode,
        });
      }

      throw failure;
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
