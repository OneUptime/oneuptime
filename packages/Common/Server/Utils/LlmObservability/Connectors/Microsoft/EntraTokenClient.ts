import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../../Types/LlmObservability/LlmConnectionTest";
import { LlmConnectorTransport } from "../../LlmConnectorTypes";
import LlmProviderError from "../../LlmProviderError";
import LlmProviderHttp, { readText } from "../../LlmProviderHttp";

/*
 * A Microsoft Entra ID app registration signing in as itself (the OAuth 2.0
 * client credentials grant), for the two Microsoft connections: Azure
 * OpenAI / Foundry reads Azure Resource Manager, Microsoft 365 Copilot reads
 * Microsoft Graph.
 *
 *   POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
 *   grant_type=client_credentials, client_id, client_secret,
 *   scope=<resource>/.default
 *
 * Azure Government signs in at login.microsoftonline.us, with Resource
 * Manager at management.usgovcloudapi.net and Graph at graph.microsoft.us.
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow
 */

export type MicrosoftCloud = "public" | "usgov";

export interface MicrosoftCloudEndpoints {
  loginBaseUrl: string;
  managementBaseUrl: string;
  graphBaseUrl: string;
}

export const MICROSOFT_CLOUD_ENDPOINTS: Record<
  MicrosoftCloud,
  MicrosoftCloudEndpoints
> = {
  public: {
    loginBaseUrl: "https://login.microsoftonline.com",
    managementBaseUrl: "https://management.azure.com",
    graphBaseUrl: "https://graph.microsoft.com",
  },
  usgov: {
    loginBaseUrl: "https://login.microsoftonline.us",
    managementBaseUrl: "https://management.usgovcloudapi.net",
    graphBaseUrl: "https://graph.microsoft.us",
  },
};

const GUID_REGEX: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/*
 * A tenant may be named by its verified domain (contoso.onmicrosoft.com).
 * Labels of letters, digits and inner hyphens, at most 63 characters each,
 * bounded so the pattern reads in linear time.
 */
const TENANT_DOMAIN_REGEX: RegExp =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?){1,10}$/;

// Refresh a token this long before Entra says it expires.
const TOKEN_EXPIRY_SKEW_IN_MS: number = 60 * 1000;

export interface EntraTokenClientOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  cloud: MicrosoftCloud;
  transport: LlmConnectorTransport;
  providerTitle: string;
  requestTimeoutInMs?: number | undefined;
}

export default class EntraTokenClient {
  private options: EntraTokenClientOptions;
  private tokens: Map<string, { token: string; expiresAtMs: number }> =
    new Map();
  private requestCount: number = 0;

  public constructor(options: EntraTokenClientOptions) {
    EntraTokenClient.validateTenantId(options.tenantId);
    EntraTokenClient.validateGuid(options.clientId, "Application (client) ID");

    if (!options.clientSecret) {
      throw new BadDataException("Client secret is required.");
    }

    this.options = options;
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  public static resolveCloud(value: string | undefined): MicrosoftCloud {
    const normalized: string = (value || "public").trim().toLowerCase();

    if (normalized !== "public" && normalized !== "usgov") {
      throw new BadDataException(
        `Cloud must be "public" or "usgov"; received "${normalized}".`,
      );
    }

    return normalized;
  }

  public static getEndpoints(cloud: MicrosoftCloud): MicrosoftCloudEndpoints {
    return MICROSOFT_CLOUD_ENDPOINTS[cloud];
  }

  public static validateGuid(value: string, label: string): void {
    if (!value || !GUID_REGEX.test(value.trim())) {
      throw new BadDataException(
        `${label} must be a GUID such as 00000000-0000-0000-0000-000000000000.`,
      );
    }
  }

  public static validateTenantId(value: string): void {
    const trimmed: string = (value || "").trim();

    if (
      !trimmed ||
      trimmed.length > 253 ||
      (!GUID_REGEX.test(trimmed) && !TENANT_DOMAIN_REGEX.test(trimmed))
    ) {
      throw new BadDataException(
        "Directory (tenant) ID must be the tenant GUID or a verified domain such as contoso.onmicrosoft.com.",
      );
    }
  }

  public getTokenUrl(): string {
    return `${
      EntraTokenClient.getEndpoints(this.options.cloud).loginBaseUrl
    }/${encodeURIComponent(this.options.tenantId.trim())}/oauth2/v2.0/token`;
  }

  // A token for one resource ("https://management.azure.com"), cached until it expires.
  public async getAccessToken(resource: string): Promise<string> {
    const cached: { token: string; expiresAtMs: number } | undefined =
      this.tokens.get(resource);

    if (cached && cached.expiresAtMs - TOKEN_EXPIRY_SKEW_IN_MS > Date.now()) {
      return cached.token;
    }

    this.requestCount++;

    const body: JSONObject = await LlmProviderHttp.requestJson({
      transport: this.options.transport,
      method: "POST",
      url: this.getTokenUrl(),
      headers: { Accept: "application/json" },
      formUrlEncoded: true,
      body: {
        grant_type: "client_credentials",
        client_id: this.options.clientId.trim(),
        client_secret: this.options.clientSecret,
        scope: `${resource}/.default`,
      },
      timeoutInMs: this.options.requestTimeoutInMs,
      step: "sign-in",
      providerTitle: this.options.providerTitle,
      secretValues: [this.options.clientSecret],
    }).catch((error: unknown) => {
      /*
       * Entra answers a wrong secret, an unknown client or a disabled app
       * with 400/401 and an AADSTS code: all of them are the credential.
       */
      const failure: LlmProviderError = LlmProviderError.from({
        error,
        step: "sign-in",
        providerTitle: this.options.providerTitle,
        secretValues: [this.options.clientSecret],
      });

      if (failure.statusCode === 400 || failure.statusCode === 401) {
        throw new LlmProviderError({
          message: failure.message,
          kind: LlmConnectionFailureKind.Authentication,
          statusCode: failure.statusCode,
          responseBody: failure.responseBody,
        });
      }

      throw failure;
    });

    const accessToken: string = readText(body["access_token"]);

    if (!accessToken) {
      throw new LlmProviderError({
        message: `${this.options.providerTitle} sign-in returned no access token.`,
        kind: LlmConnectionFailureKind.Authentication,
      });
    }

    const expiresIn: number = Number(body["expires_in"]);

    this.tokens.set(resource, {
      token: accessToken,
      expiresAtMs:
        Date.now() +
        (Number.isFinite(expiresIn) && expiresIn > 0
          ? expiresIn * 1000
          : 5 * 60 * 1000),
    });

    return accessToken;
  }
}
