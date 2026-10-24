import { generateKeyPairSync, verify } from "crypto";
import GoogleCloudMarketplaceAPI, {
  GoogleCloudEntitlement,
  GoogleCloudUsageOperation,
  GoogleServiceAccountKey,
} from "../../../../Server/CloudMarketplace/GoogleCloud/GoogleCloudMarketplaceAPI";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import { MarketplaceHttpRequest } from "Common/Server/Utils/Marketplace/MarketplaceHttp";
import {
  FakeHttpClient,
  createFakeHttpClient,
} from "Common/Tests/Server/Utils/Marketplace/MarketplaceTestKeys";
import { describe, expect, it } from "@jest/globals";

/*
 * The Google Cloud APIs OneUptime calls for Google Cloud Marketplace: the
 * service-account token exchange, the Partner Procurement API (approve the
 * buyer's account, their orders and plan changes) and Service Control (usage).
 */

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const SERVICE_ACCOUNT_JSON: string = JSON.stringify({
  type: "service_account",
  client_email: "marketplace@oneuptime-marketplace.iam.gserviceaccount.com",
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

const KEY: GoogleServiceAccountKey =
  GoogleCloudMarketplaceAPI.parseServiceAccountKey(SERVICE_ACCOUNT_JSON)!;

/*
 * The claims of an RS256 JWT whose signature `key` verifies; throws for any
 * other token. With node's crypto, so ee needs no JWT library of its own.
 */
const verifyRs256: (token: string, key: string) => Record<string, unknown> = (
  token: string,
  key: string,
): Record<string, unknown> => {
  const [header, payload, signature] = token.split(".");

  if (!header || !payload || !signature) {
    throw new Error("not a JWT");
  }

  const algorithm: unknown = (
    JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >
  )["alg"];

  if (algorithm !== "RS256") {
    throw new Error(`signed with ${String(algorithm)}, not RS256`);
  }

  if (
    !verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      key,
      Buffer.from(signature, "base64url"),
    )
  ) {
    throw new Error("the signature does not verify");
  }

  return JSON.parse(
    Buffer.from(payload, "base64url").toString("utf8"),
  ) as Record<string, unknown>;
};

const TOKEN_ANSWER: { status: number; body: Record<string, unknown> } = {
  status: 200,
  body: { access_token: "ya29.token", expires_in: 3599 },
};

const ENTITLEMENT: Record<string, unknown> = {
  name: "providers/oneuptime-public/entitlements/ent-1",
  account: "providers/oneuptime-public/accounts/acct-1",
  provider: "oneuptime-public",
  productExternalName: "oneuptime.endpoints.oneuptime-public.cloud.goog",
  plan: "pay-as-you-go",
  state: "ENTITLEMENT_ACTIVE",
  usageReportingId: "project_number:123456789",
  createTime: "2026-10-16T09:00:00Z",
  updateTime: "2026-10-16T09:05:00Z",
};

const createApi: (http: FakeHttpClient) => GoogleCloudMarketplaceAPI = (
  http: FakeHttpClient,
): GoogleCloudMarketplaceAPI => {
  return new GoogleCloudMarketplaceAPI({
    providerId: "oneuptime-public",
    serviceAccountKey: KEY,
    serviceName: "oneuptime.gcpmarketplace.oneuptime.com",
    httpClient: http.client,
  });
};

describe("GoogleCloudMarketplaceAPI.parseServiceAccountKey", () => {
  it("reads the downloaded JSON key, and the same key base64-encoded", () => {
    expect(KEY.clientEmail).toBe(
      "marketplace@oneuptime-marketplace.iam.gserviceaccount.com",
    );
    expect(KEY.privateKey).toContain("PRIVATE KEY");

    expect(
      GoogleCloudMarketplaceAPI.parseServiceAccountKey(
        Buffer.from(SERVICE_ACCOUNT_JSON, "utf8").toString("base64"),
      ),
    ).toEqual(KEY);
  });

  it("only ever exchanges the assertion at Google's own token endpoint", () => {
    const key: GoogleServiceAccountKey | null =
      GoogleCloudMarketplaceAPI.parseServiceAccountKey(
        JSON.stringify({
          client_email: "a@b.iam.gserviceaccount.com",
          private_key: privateKey,
          token_uri: "https://attacker.example.com/token",
        }),
      );

    expect(key?.tokenUri).toBe("https://oauth2.googleapis.com/token");
  });

  it("refuses anything that is not a service account key", () => {
    for (const value of [
      undefined,
      null,
      "",
      "   ",
      "not json, not base64 json",
      "[]",
      JSON.stringify({ client_email: "a@b.com" }),
      JSON.stringify({ client_email: "a@b.com", private_key: "nope" }),
      JSON.stringify({ client_email: 42, private_key: privateKey }),
    ]) {
      expect(
        GoogleCloudMarketplaceAPI.parseServiceAccountKey(value),
      ).toBeNull();
    }
  });
});

describe("GoogleCloudMarketplaceAPI.parseEntitlement", () => {
  it("reads the entitlement and the account it belongs to", () => {
    const entitlement: GoogleCloudEntitlement | null =
      GoogleCloudMarketplaceAPI.parseEntitlement(ENTITLEMENT);

    expect(entitlement).toEqual({
      name: "providers/oneuptime-public/entitlements/ent-1",
      id: "ent-1",
      accountId: "acct-1",
      state: "ENTITLEMENT_ACTIVE",
      plan: "pay-as-you-go",
      newPendingPlan: null,
      product: "oneuptime.endpoints.oneuptime-public.cloud.goog",
      usageReportingId: "project_number:123456789",
      createTime: "2026-10-16T09:00:00Z",
      updateTime: "2026-10-16T09:05:00Z",
    });
  });

  it("is null without a name or an account", () => {
    expect(
      GoogleCloudMarketplaceAPI.parseEntitlement({ name: "x" }),
    ).toBeNull();
    expect(
      GoogleCloudMarketplaceAPI.parseEntitlement({ account: "x" }),
    ).toBeNull();
  });
});

describe("GoogleCloudMarketplaceAPI calls", () => {
  it("signs an RS256 assertion with the service account key, and caches the token", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 200, body: {} },
      { status: 200, body: {} },
    ]);
    const api: GoogleCloudMarketplaceAPI = createApi(http);

    await api.approveAccount("acct-1");
    await api.approveEntitlement("ent-1");

    // One token exchange for two calls.
    expect(http.requests).toHaveLength(3);

    const tokenRequest: MarketplaceHttpRequest = http.requests[0]!;
    expect(tokenRequest.url).toBe("https://oauth2.googleapis.com/token");

    const form: URLSearchParams = new URLSearchParams(tokenRequest.body);
    expect(form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );

    const claims: Record<string, unknown> = verifyRs256(
      form.get("assertion")!,
      publicKey,
    );

    expect(claims).toMatchObject({
      iss: "marketplace@oneuptime-marketplace.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
    });
  });

  it("approves the buyer's account with the signup approval", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 200, body: {} },
    ]);

    await createApi(http).approveAccount("acct-1");

    expect(http.requests[1]).toMatchObject({
      method: "POST",
      url: "https://cloudcommerceprocurement.googleapis.com/v1/providers/oneuptime-public/accounts/acct-1:approve",
    });
    expect(JSON.parse(http.requests[1]!.body!)).toEqual({
      approvalName: "signup",
    });
    expect(http.requests[1]!.headers!["Authorization"]).toBe(
      "Bearer ya29.token",
    );
  });

  it("approves an order and a plan change", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 200, body: {} },
      { status: 200, body: {} },
    ]);
    const api: GoogleCloudMarketplaceAPI = createApi(http);

    await api.approveEntitlement("ent-1");
    await api.approvePlanChange("ent-1", "scale");

    expect(http.requests[1]!.url).toBe(
      "https://cloudcommerceprocurement.googleapis.com/v1/providers/oneuptime-public/entitlements/ent-1:approve",
    );
    expect(http.requests[2]!.url).toBe(
      "https://cloudcommerceprocurement.googleapis.com/v1/providers/oneuptime-public/entitlements/ent-1:approvePlanChange",
    );
    expect(JSON.parse(http.requests[2]!.body!)).toEqual({
      pendingPlanName: "scale",
    });
  });

  it("reads an account's approvals", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      {
        status: 200,
        body: {
          name: "providers/oneuptime-public/accounts/acct-1",
          state: "ACCOUNT_ACTIVE",
          approvals: [{ name: "signup", state: "PENDING" }],
        },
      },
    ]);

    await expect(createApi(http).getAccount("acct-1")).resolves.toEqual({
      id: "acct-1",
      state: "ACCOUNT_ACTIVE",
      approvals: { signup: "PENDING" },
    });
  });

  it("answers null for an account or entitlement Google does not have", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 404, body: { error: { code: 404 } } },
      { status: 404, body: { error: { code: 404 } } },
    ]);
    const api: GoogleCloudMarketplaceAPI = createApi(http);

    await expect(api.getAccount("missing")).resolves.toBeNull();
    await expect(api.getEntitlement("missing")).resolves.toBeNull();
  });

  it("lists every entitlement of an account across pages, filtered by account", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      {
        status: 200,
        body: { entitlements: [ENTITLEMENT], nextPageToken: "page-2" },
      },
      {
        status: 200,
        body: {
          entitlements: [
            {
              ...ENTITLEMENT,
              name: "providers/oneuptime-public/entitlements/ent-2",
            },
            // Another account's entitlement is never handed back.
            {
              ...ENTITLEMENT,
              name: "providers/oneuptime-public/entitlements/ent-3",
              account: "providers/oneuptime-public/accounts/acct-2",
            },
          ],
        },
      },
    ]);

    const entitlements: Array<GoogleCloudEntitlement> =
      await createApi(http).listEntitlements("acct-1");

    expect(
      entitlements.map((entitlement: GoogleCloudEntitlement) => {
        return entitlement.id;
      }),
    ).toEqual(["ent-1", "ent-2"]);

    const firstUrl: URL = new URL(http.requests[1]!.url);
    expect(firstUrl.searchParams.get("filter")).toBe("account=acct-1");
    expect(new URL(http.requests[2]!.url).searchParams.get("pageToken")).toBe(
      "page-2",
    );
  });

  it("checks and reports usage to Service Control as one operation", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 200, body: { operationId: "op-1" } },
      { status: 200, body: {} },
    ]);
    const api: GoogleCloudMarketplaceAPI = createApi(http);

    const operation: GoogleCloudUsageOperation = {
      operationId: "op-1",
      operationName: "OneUptime usage",
      consumerId: "project_number:123456789",
      startTime: "2026-10-16T09:00:00.000Z",
      endTime: "2026-10-16T10:00:00.000Z",
      metricName: "oneuptime/usage_units",
      quantity: 1234,
      labels: { "cloudmarketplace.googleapis.com/resource_name": "p-1" },
    };

    await expect(api.checkUsage(operation)).resolves.toEqual([]);
    await expect(api.reportUsage(operation)).resolves.toEqual([]);

    expect(http.requests[1]!.url).toBe(
      "https://servicecontrol.googleapis.com/v1/services/oneuptime.gcpmarketplace.oneuptime.com:check",
    );
    expect(http.requests[2]!.url).toBe(
      "https://servicecontrol.googleapis.com/v1/services/oneuptime.gcpmarketplace.oneuptime.com:report",
    );

    const report: Record<string, unknown> = JSON.parse(http.requests[2]!.body!);
    expect(report).toEqual({
      operations: [
        {
          operationId: "op-1",
          operationName: "OneUptime usage",
          consumerId: "project_number:123456789",
          startTime: "2026-10-16T09:00:00.000Z",
          endTime: "2026-10-16T10:00:00.000Z",
          metricValueSets: [
            {
              metricName: "oneuptime/usage_units",
              metricValues: [{ int64Value: "1234" }],
            },
          ],
          userLabels: {
            "cloudmarketplace.googleapis.com/resource_name": "p-1",
          },
        },
      ],
    });
  });

  it("reads Service Control's check and report errors", () => {
    expect(
      GoogleCloudMarketplaceAPI.readServiceControlErrors([
        { code: "SERVICE_NOT_ACTIVATED", detail: "Service not enabled" },
        { operationId: "op-1", status: { code: 3, message: "bad metric" } },
        "noise",
      ]),
    ).toEqual([
      { code: "SERVICE_NOT_ACTIVATED", detail: "Service not enabled" },
      { code: "3", detail: "bad metric" },
    ]);
    expect(
      GoogleCloudMarketplaceAPI.readServiceControlErrors(undefined),
    ).toEqual([]);
  });

  it("marks throttling and Google's own failures as worth retrying, and nothing else", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 429, body: "slow down" },
      { status: 503, body: "unavailable" },
      { status: 403, body: "forbidden" },
      new Error("ECONNRESET"),
    ]);
    const api: GoogleCloudMarketplaceAPI = createApi(http);

    for (const retryable of [true, true, false, true]) {
      const error: unknown = await api
        .approveEntitlement("ent-1")
        .catch((err: unknown) => {
          return err;
        });

      expect(error).toBeInstanceOf(MarketplaceApiError);
      expect((error as MarketplaceApiError).isRetryable).toBe(retryable);
    }
  });

  it("reports a refused token exchange without the key in the message", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      { status: 400, body: { error: "invalid_grant" } },
    ]);

    const error: unknown = await createApi(http)
      .approveAccount("acct-1")
      .catch((err: unknown) => {
        return err;
      });

    expect(error).toBeInstanceOf(MarketplaceApiError);
    expect((error as Error).message).toContain("invalid_grant");
    expect((error as Error).message).not.toContain("PRIVATE KEY");
  });

  it("refuses to report usage without a Service Control service name", async () => {
    const api: GoogleCloudMarketplaceAPI = new GoogleCloudMarketplaceAPI({
      providerId: "oneuptime-public",
      serviceAccountKey: KEY,
      serviceName: null,
      httpClient: createFakeHttpClient([TOKEN_ANSWER]).client,
    });

    await expect(
      api.checkUsage({
        operationId: "op",
        operationName: "x",
        consumerId: "c",
        startTime: "s",
        endTime: "e",
        metricName: "m",
        quantity: 1,
      }),
    ).rejects.toThrow(/SERVICE_NAME/);
  });
});

/*
 * A provider, account or entitlement ID goes into a Procurement API path (or
 * the entitlements filter) only in the shape Google writes its IDs in, so no
 * value can send a request to another path of the API than the resource it
 * names. The refusal is not retryable: a redelivered message would carry the
 * same ID.
 */
describe("GoogleCloudMarketplaceAPI resource IDs in request paths", () => {
  it("names a resource whose ID is shaped the way Google writes it", () => {
    expect(
      GoogleCloudMarketplaceAPI.getEntitlementName("oneuptime-public", "ent-1"),
    ).toBe("providers/oneuptime-public/entitlements/ent-1");
    expect(
      GoogleCloudMarketplaceAPI.getAccountName("oneuptime-public", "acct_1"),
    ).toBe("providers/oneuptime-public/accounts/acct_1");
    expect(
      GoogleCloudMarketplaceAPI.getEntitlementName(
        "oneuptime-public",
        "0f8fad5b-d9cb-469f-a165-70867728950e",
      ),
    ).toBe(
      "providers/oneuptime-public/entitlements/0f8fad5b-d9cb-469f-a165-70867728950e",
    );
  });

  it.each([
    ["a step up the path", "../accounts/acct-2"],
    ["a dot segment", ".."],
    ["a slash", "ent-1/approve"],
    ["a query", "ent-1?view=full"],
    ["a fragment", "ent-1#x"],
    ["an encoded slash", "ent-1%2Fapprove"],
    ["a method suffix", "ent-1:approve"],
    ["a space", "ent 1"],
    ["nothing", ""],
  ])("refuses an entitlement ID with %s", (_label: string, id: string) => {
    let error: unknown = null;

    try {
      GoogleCloudMarketplaceAPI.getEntitlementName("oneuptime-public", id);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(MarketplaceApiError);
    expect((error as MarketplaceApiError).isRetryable).toBe(false);
  });

  it("refuses a provider ID it would put in a path the same way", () => {
    expect(() => {
      return GoogleCloudMarketplaceAPI.getAccountName("../v2", "acct-1");
    }).toThrow(MarketplaceApiError);
  });

  it("sends nothing, not even the token exchange, for an entitlement ID it refuses", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 200, body: ENTITLEMENT },
    ]);

    await expect(
      createApi(http).getEntitlement("../accounts/acct-2"),
    ).rejects.toBeInstanceOf(MarketplaceApiError);
    expect(http.requests).toHaveLength(0);
  });

  it("refuses an account ID that would add a clause to the entitlements filter", async () => {
    const http: FakeHttpClient = createFakeHttpClient([
      TOKEN_ANSWER,
      { status: 200, body: { entitlements: [] } },
    ]);

    await expect(
      createApi(http).listEntitlements("acct-1 OR provider=someone-else"),
    ).rejects.toBeInstanceOf(MarketplaceApiError);
    expect(http.requests).toHaveLength(0);
  });
});
