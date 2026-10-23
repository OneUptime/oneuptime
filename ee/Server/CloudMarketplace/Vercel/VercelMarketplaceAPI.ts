import {
  VercelMarketplaceClientId,
  VercelMarketplaceClientSecret,
} from "Common/Server/EnvironmentConfig";
import MarketplaceApiError from "../MarketplaceApiError";
import {
  MarketplaceHttp,
  MarketplaceHttpClient,
  MarketplaceHttpMethod,
  MarketplaceHttpResponse,
  defaultMarketplaceHttpClient,
} from "Common/Server/Utils/Marketplace/MarketplaceHttp";

/*
 * The calls OneUptime makes to Vercel for an installation, with the access
 * token Vercel gave it when the team installed OneUptime
 * (https://vercel.com/docs/integrations/create-integration/marketplace-api/reference/vercel):
 *
 *   - the running totals of the current billing period, and the invoice at
 *     its end - Vercel charges the team's card and handles the tax;
 *   - "this resource changed", so Vercel reads it again (a plan changed in
 *     OneUptime, a resource suspended for an unpaid invoice);
 *   - a resource's new secrets (the environment variables of the Vercel
 *     projects connected to it);
 *   - deleting a resource whose OneUptime project was deleted;
 *   - a connected project's production domains, for its uptime monitor.
 *
 * And, with the integration's own credentials, turning the code a person
 * arrives with from Vercel into an ID token (SSO).
 *
 * Amounts are USD as decimal strings with two decimals ("12.30"), as
 * Vercel's billing API takes them.
 */

export const VERCEL_API_URL: string = "https://api.vercel.com";

export interface VercelInstallationCredentials {
  installationId: string;
  accessToken: string;
}

export interface VercelBillingItem {
  billingPlanId: string;
  resourceId?: string | undefined;
  start?: string | undefined;
  end?: string | undefined;
  name: string;
  details?: string | undefined;
  price: string;
  quantity: number;
  units: string;
  total: string;
}

export interface VercelUsageItem {
  resourceId?: string | undefined;
  name: string;
  type: "total" | "interval" | "rate";
  units: string;
  dayValue: number;
  periodValue: number;
}

export interface VercelPeriod {
  start: string;
  end: string;
}

export interface VercelBillingData {
  timestamp: string;
  eod: string;
  period: VercelPeriod;
  billing: Array<VercelBillingItem>;
  usage: Array<VercelUsageItem>;
}

export interface VercelInvoice {
  externalId: string;
  invoiceDate: string;
  memo?: string | undefined;
  period: VercelPeriod;
  items: Array<VercelBillingItem>;
  final?: boolean | undefined;
}

export interface VercelInvoiceResult {
  invoiceId: string | null;
  // Vercel already has an invoice with this externalId: this one was sent before.
  isDuplicate: boolean;
}

export interface VercelSecret {
  name: string;
  value: string;
}

export default class VercelMarketplaceAPI {
  private httpClient: MarketplaceHttpClient;
  private baseUrl: string;
  private clientId: string | null;
  private clientSecret: string | null;

  public constructor(options?: {
    httpClient?: MarketplaceHttpClient | undefined;
    baseUrl?: string | undefined;
    clientId?: string | null | undefined;
    clientSecret?: string | null | undefined;
  }) {
    this.httpClient = options?.httpClient || defaultMarketplaceHttpClient;
    this.baseUrl = (options?.baseUrl || VERCEL_API_URL).replace(/\/$/, "");
    this.clientId =
      options?.clientId !== undefined
        ? options.clientId
        : VercelMarketplaceClientId;
    this.clientSecret =
      options?.clientSecret !== undefined
        ? options.clientSecret
        : VercelMarketplaceClientSecret;
  }

  // Running totals of the period so far. Shown to the team; charges nothing.
  public async submitBillingData(
    installation: VercelInstallationCredentials,
    data: VercelBillingData,
  ): Promise<void> {
    await this.call(installation, {
      method: "POST",
      path: `/v1/installations/${encodeURIComponent(installation.installationId)}/billing`,
      body: data,
    });
  }

  /*
   * The invoice for a period, which Vercel charges. An invoice Vercel
   * already has (the same externalId - this one was sent before, and its
   * answer was lost) is not an error: it was sent.
   */
  public async submitInvoice(
    installation: VercelInstallationCredentials,
    invoice: VercelInvoice,
  ): Promise<VercelInvoiceResult> {
    try {
      const response: Record<string, unknown> | null = await this.call(
        installation,
        {
          method: "POST",
          path: `/v1/installations/${encodeURIComponent(installation.installationId)}/billing/invoices`,
          body: invoice,
        },
      );

      const invoiceId: unknown = response?.["invoiceId"];

      return {
        invoiceId: typeof invoiceId === "string" ? invoiceId : null,
        isDuplicate: false,
      };
    } catch (err) {
      if (err instanceof MarketplaceApiError && err.status === 409) {
        return { invoiceId: null, isDuplicate: true };
      }

      throw err;
    }
  }

  // The installation is being deleted, and its final invoice is sent: Vercel may let it go.
  public async finalizeBilling(
    installation: VercelInstallationCredentials,
  ): Promise<void> {
    await this.call(installation, {
      method: "POST",
      path: `/v1/installations/${encodeURIComponent(installation.installationId)}/billing/finalize`,
    });
  }

  // Something about the resource changed in OneUptime: Vercel reads it again.
  public async sendResourceUpdated(
    installation: VercelInstallationCredentials,
    resourceId: string,
  ): Promise<void> {
    await this.call(installation, {
      method: "POST",
      path: `/v1/installations/${encodeURIComponent(installation.installationId)}/events`,
      body: { event: { type: "resource.updated", resourceId: resourceId } },
    });
  }

  /*
   * Replace the resource's secrets - the environment variables of the
   * projects connected to it. Vercel does not redeploy them; the new values
   * reach a project's next deployment.
   */
  public async updateResourceSecrets(
    installation: VercelInstallationCredentials,
    resourceId: string,
    secrets: Array<VercelSecret>,
  ): Promise<void> {
    await this.call(installation, {
      method: "PUT",
      path: `/v1/installations/${encodeURIComponent(installation.installationId)}/resources/${encodeURIComponent(resourceId)}/secrets`,
      body: { secrets: secrets },
    });
  }

  // Delete the resource on Vercel's side: its OneUptime project is gone.
  public async deleteResource(
    installation: VercelInstallationCredentials,
    resourceId: string,
  ): Promise<void> {
    try {
      await this.call(installation, {
        method: "DELETE",
        path: `/v1/installations/${encodeURIComponent(installation.installationId)}/resources/${encodeURIComponent(resourceId)}`,
      });
    } catch (err) {
      // Already gone: nothing to delete.
      if (err instanceof MarketplaceApiError && err.isNotFound()) {
        return;
      }

      throw err;
    }
  }

  /*
   * The domain a Vercel project's production deployment is served on: a
   * verified production domain that is not a redirect, the team's own
   * before a .vercel.app one. Null when it has none yet.
   */
  public async getProductionDomain(
    installation: VercelInstallationCredentials,
    vercelProjectId: string,
  ): Promise<string | null> {
    const response: Record<string, unknown> | null = await this.call(
      installation,
      {
        method: "GET",
        path: `/v9/projects/${encodeURIComponent(vercelProjectId)}/domains?production=true&verified=true&redirects=false&order=ASC&limit=100`,
      },
    );

    const domains: unknown = response?.["domains"];

    if (!Array.isArray(domains)) {
      return null;
    }

    const names: Array<string> = [];

    for (const domain of domains) {
      if (!domain || typeof domain !== "object") {
        continue;
      }

      const record: Record<string, unknown> = domain as Record<string, unknown>;
      const name: unknown = record["name"];

      if (
        typeof name === "string" &&
        name &&
        record["verified"] !== false &&
        !record["redirect"]
      ) {
        names.push(name.toLowerCase());
      }
    }

    return (
      names.find((name: string): boolean => {
        return !name.endsWith(".vercel.app");
      }) ||
      names[0] ||
      null
    );
  }

  /*
   * The ID token for the code a person arrives with from Vercel ("Open in
   * OneUptime"). The token itself is checked by VercelMarketplaceAuth.
   */
  public async exchangeSsoCode(data: {
    code: string;
    state?: string | undefined;
    redirectUri?: string | undefined;
  }): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new MarketplaceApiError({
        message: "Vercel Marketplace is not set up on this server.",
        status: null,
        isRetryable: false,
      });
    }

    const response: MarketplaceHttpResponse = await this.send({
      method: "POST",
      url: `${this.baseUrl}/v1/integrations/sso/token`,
      body: {
        grant_type: "authorization_code",
        code: data.code,
        ...(data.state ? { state: data.state } : {}),
        client_id: this.clientId,
        client_secret: this.clientSecret,
        ...(data.redirectUri ? { redirect_uri: data.redirectUri } : {}),
      },
    });

    const body: Record<string, unknown> | null =
      MarketplaceHttp.parseJsonObject(response.body);
    const idToken: unknown = body?.["id_token"];

    if (typeof idToken !== "string" || !idToken) {
      throw new MarketplaceApiError({
        message: "Vercel did not return an ID token for the sign-in code.",
        status: response.status,
        isRetryable: false,
        body: MarketplaceHttp.summarize(response.body),
      });
    }

    return idToken;
  }

  private async call(
    installation: VercelInstallationCredentials,
    request: {
      method: MarketplaceHttpMethod;
      path: string;
      body?: unknown;
    },
  ): Promise<Record<string, unknown> | null> {
    const response: MarketplaceHttpResponse = await this.send({
      method: request.method,
      url: `${this.baseUrl}${request.path}`,
      accessToken: installation.accessToken,
      body: request.body,
    });

    return MarketplaceHttp.parseJsonObject(response.body);
  }

  // One request; an answer that is not a success is thrown as a MarketplaceApiError.
  private async send(request: {
    method: MarketplaceHttpMethod;
    url: string;
    accessToken?: string | undefined;
    body?: unknown;
  }): Promise<MarketplaceHttpResponse> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (request.accessToken) {
      headers["Authorization"] = `Bearer ${request.accessToken}`;
    }

    if (request.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: MarketplaceHttpResponse;

    try {
      response = await this.httpClient({
        method: request.method,
        url: request.url,
        headers: headers,
        ...(request.body !== undefined
          ? { body: JSON.stringify(request.body) }
          : {}),
      });
    } catch (err) {
      throw new MarketplaceApiError({
        message: `Vercel could not be reached: ${(err as Error).message}`,
        status: null,
        isRetryable: true,
      });
    }

    if (MarketplaceHttp.isSuccess(response.status)) {
      return response;
    }

    const body: Record<string, unknown> | null =
      MarketplaceHttp.parseJsonObject(response.body);
    const error: unknown = body?.["error"];
    const code: unknown =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)["code"]
        : undefined;

    throw new MarketplaceApiError({
      message: `Vercel answered ${request.method} ${new URL(request.url).pathname} with HTTP ${response.status}: ${MarketplaceHttp.summarize(response.body)}`,
      status: response.status,
      isRetryable: MarketplaceHttp.isRetryable(response.status),
      body: MarketplaceHttp.summarize(response.body),
      code: typeof code === "string" ? code : undefined,
    });
  }
}
