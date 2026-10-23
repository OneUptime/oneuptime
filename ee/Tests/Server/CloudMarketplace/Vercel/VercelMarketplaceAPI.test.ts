import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import VercelMarketplaceAPI, {
  VercelInstallationCredentials,
  VercelInvoiceResult,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAPI";
import {
  FakeHttpClient,
  createFakeHttpClient,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * What OneUptime sends Vercel for an installation, with the token Vercel
 * gave it, and the sign-in code exchange made with the integration's own
 * credentials.
 */

const INSTALLATION: VercelInstallationCredentials = {
  installationId: "icfg_1",
  accessToken: "vercel-access-token",
};

const apiWith: (http: FakeHttpClient) => VercelMarketplaceAPI = (
  http: FakeHttpClient,
): VercelMarketplaceAPI => {
  return new VercelMarketplaceAPI({
    httpClient: http.client,
    clientId: "oac_client",
    clientSecret: "client-secret",
  });
};

describe("VercelMarketplaceAPI", () => {
  it("sends the period's running totals to the installation's billing endpoint", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 201, body: "" },
    ]);

    await apiWith(http).submitBillingData(INSTALLATION, {
      timestamp: "2026-10-18T10:15:00.000Z",
      eod: "2026-10-18T10:15:00.000Z",
      period: {
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-11-01T00:00:00.000Z",
      },
      billing: [],
      usage: [],
    });

    expect(http.requests[0]).toMatchObject({
      method: "POST",
      url: "https://api.vercel.com/v1/installations/icfg_1/billing",
      headers: {
        Authorization: "Bearer vercel-access-token",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(http.requests[0]!.body!)).toMatchObject({
      period: { start: "2026-10-01T00:00:00.000Z" },
    });
  });

  it("sends an invoice, and takes one Vercel already has as sent", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: { invoiceId: "inv_1" } },
      {
        status: 409,
        body: { error: { code: "conflict", message: "externalId exists" } },
      },
    ]);

    const invoice: Parameters<VercelMarketplaceAPI["submitInvoice"]>[1] = {
      externalId: "oneuptime-icfg_1-2026-10",
      invoiceDate: "2026-10-31T23:59:59.000Z",
      period: {
        start: "2026-10-01T00:00:00.000Z",
        end: "2026-11-01T00:00:00.000Z",
      },
      items: [],
    };

    const first: VercelInvoiceResult = await apiWith(http).submitInvoice(
      INSTALLATION,
      invoice,
    );
    const again: VercelInvoiceResult = await apiWith(http).submitInvoice(
      INSTALLATION,
      invoice,
    );

    expect(first).toEqual({ invoiceId: "inv_1", isDuplicate: false });
    expect(again).toEqual({ invoiceId: null, isDuplicate: true });
    expect(http.requests[0]!.url).toBe(
      "https://api.vercel.com/v1/installations/icfg_1/billing/invoices",
    );
  });

  it("says whether a refusal is worth sending again, and Vercel's own error code", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 503, body: "busy" },
      {
        status: 400,
        body: { error: { code: "validation_error", message: "bad period" } },
      },
      new Error("socket hang up"),
    ]);

    const retryable: unknown = await apiWith(http)
      .finalizeBilling(INSTALLATION)
      .catch((err: unknown) => {
        return err;
      });
    expect(retryable).toBeInstanceOf(MarketplaceApiError);
    expect((retryable as MarketplaceApiError).isRetryable).toBe(true);
    expect((retryable as MarketplaceApiError).status).toBe(503);

    const refused: unknown = await apiWith(http)
      .finalizeBilling(INSTALLATION)
      .catch((err: unknown) => {
        return err;
      });
    expect((refused as MarketplaceApiError).isRetryable).toBe(false);
    expect((refused as MarketplaceApiError).code).toBe("validation_error");

    const unreachable: unknown = await apiWith(http)
      .finalizeBilling(INSTALLATION)
      .catch((err: unknown) => {
        return err;
      });
    expect((unreachable as MarketplaceApiError).isRetryable).toBe(true);
    expect((unreachable as MarketplaceApiError).status).toBeNull();

    // The token never reaches an error message.
    for (const err of [retryable, refused, unreachable]) {
      expect((err as Error).message).not.toContain("vercel-access-token");
    }
  });

  it("tells Vercel a resource changed, replaces its secrets and deletes it", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 201, body: "" },
      { status: 201, body: "" },
      { status: 204, body: "" },
      { status: 404, body: { error: { code: "not_found" } } },
    ]);

    await apiWith(http).sendResourceUpdated(INSTALLATION, "res_1");
    await apiWith(http).updateResourceSecrets(INSTALLATION, "res_1", [
      { name: "OTEL_EXPORTER_OTLP_HEADERS", value: "x-oneuptime-token=new" },
    ]);
    await apiWith(http).deleteResource(INSTALLATION, "res_1");
    // Already deleted: nothing to do.
    await apiWith(http).deleteResource(INSTALLATION, "res_1");

    expect(
      http.requests.map((request: { method: string; url: string }) => {
        return `${request.method} ${request.url}`;
      }),
    ).toEqual([
      "POST https://api.vercel.com/v1/installations/icfg_1/events",
      "PUT https://api.vercel.com/v1/installations/icfg_1/resources/res_1/secrets",
      "DELETE https://api.vercel.com/v1/installations/icfg_1/resources/res_1",
      "DELETE https://api.vercel.com/v1/installations/icfg_1/resources/res_1",
    ]);
    expect(JSON.parse(http.requests[0]!.body!)).toEqual({
      event: { type: "resource.updated", resourceId: "res_1" },
    });
    expect(JSON.parse(http.requests[1]!.body!)).toEqual({
      secrets: [
        { name: "OTEL_EXPORTER_OTLP_HEADERS", value: "x-oneuptime-token=new" },
      ],
    });
  });

  it("reads a project's production domain: the team's own before .vercel.app, never a redirect", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      {
        status: 200,
        body: {
          domains: [
            { name: "storefront.vercel.app", verified: true },
            { name: "www.acme.com", verified: true, redirect: "acme.com" },
            { name: "pending.acme.com", verified: false },
            { name: "Shop.Acme.com", verified: true, redirect: null },
          ],
          pagination: { count: 4, next: null, prev: null },
        },
      },
      {
        status: 200,
        body: { domains: [{ name: "storefront.vercel.app", verified: true }] },
      },
      { status: 200, body: { domains: [] } },
    ]);

    expect(await apiWith(http).getProductionDomain(INSTALLATION, "prj_1")).toBe(
      "shop.acme.com",
    );
    expect(await apiWith(http).getProductionDomain(INSTALLATION, "prj_1")).toBe(
      "storefront.vercel.app",
    );
    expect(
      await apiWith(http).getProductionDomain(INSTALLATION, "prj_1"),
    ).toBeNull();

    expect(http.requests[0]!.url).toBe(
      "https://api.vercel.com/v9/projects/prj_1/domains?production=true&verified=true&redirects=false&order=ASC&limit=100",
    );
  });

  it("exchanges a sign-in code for an ID token with the integration's credentials", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 200, body: { id_token: "id.token.value", access_token: null } },
      { status: 200, body: { access_token: null } },
    ]);

    expect(
      await apiWith(http).exchangeSsoCode({ code: "code-1", state: "state-1" }),
    ).toBe("id.token.value");

    expect(http.requests[0]!.url).toBe(
      "https://api.vercel.com/v1/integrations/sso/token",
    );
    expect(http.requests[0]!.headers?.["Authorization"]).toBeUndefined();
    expect(JSON.parse(http.requests[0]!.body!)).toEqual({
      grant_type: "authorization_code",
      code: "code-1",
      state: "state-1",
      client_id: "oac_client",
      client_secret: "client-secret",
    });

    await expect(
      apiWith(http).exchangeSsoCode({ code: "code-2" }),
    ).rejects.toThrow("did not return an ID token");
  });

  it("exchanges no code on a server without the integration's credentials", async () => {
    const http: FakeHttpClient = createFakeHttpClient([]);

    await expect(
      new VercelMarketplaceAPI({
        httpClient: http.client,
        clientId: null,
        clientSecret: null,
      }).exchangeSsoCode({ code: "code" }),
    ).rejects.toThrow("not set up");

    expect(http.requests).toHaveLength(0);
  });
});
