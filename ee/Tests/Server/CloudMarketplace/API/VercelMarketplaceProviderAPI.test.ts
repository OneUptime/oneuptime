import VercelMarketplaceProviderAPI from "../../../../Server/CloudMarketplace/API/VercelMarketplaceProviderAPI";
import MarketplaceApiError from "../../../../Server/CloudMarketplace/MarketplaceApiError";
import MarketplaceConfig from "../../../../Server/CloudMarketplace/MarketplaceConfig";
import VercelMarketplaceAuth, {
  VercelAuthError,
  VercelMarketplaceCaller,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceAuth";
import VercelMarketplaceProvider, {
  VercelProviderError,
} from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceProvider";
import VercelMarketplaceWebhooks from "../../../../Server/CloudMarketplace/Vercel/VercelMarketplaceWebhooks";
import logger from "Common/Server/Utils/Logger";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The routes Vercel calls under /api/marketplace/vercel: each provider API
 * call is authenticated with Vercel's token before it reaches the provider,
 * refusals are answered in Vercel's error shape, and webhooks are checked
 * against their signature first.
 */

type Handler = (req: unknown, res: unknown) => Promise<void>;

interface RecordedRoute {
  method: string;
  path: string;
  handler: Handler;
}

const routes: Array<RecordedRoute> = [];

const record: (method: string) => (path: string, handler: Handler) => void = (
  method: string,
) => {
  return (path: string, handler: Handler): void => {
    routes.push({ method: method, path: path, handler: handler });
  };
};

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return {
          get: record("GET"),
          put: record("PUT"),
          post: record("POST"),
          patch: record("PATCH"),
          delete: record("DELETE"),
        };
      },
    },
  };
});

interface FakeResponse {
  statusCode: number;
  body: unknown;
  ended: boolean;
  status: (code: number) => FakeResponse;
  json: (body: unknown) => FakeResponse;
  end: () => FakeResponse;
}

const response: () => FakeResponse = (): FakeResponse => {
  const res: FakeResponse = {
    statusCode: 0,
    body: undefined,
    ended: false,
    status: (code: number): FakeResponse => {
      res.statusCode = code;
      return res;
    },
    json: (body: unknown): FakeResponse => {
      res.body = body;
      return res;
    },
    end: (): FakeResponse => {
      res.ended = true;
      return res;
    },
  };
  return res;
};

const CALLER: VercelMarketplaceCaller = {
  kind: "user",
  accountId: "team_acme",
  installationId: "icfg_acme",
  userId: "user_ada",
  userRole: "ADMIN",
};

let auth: { verifyAuthorizationHeader: jest.Mock };

const route: (method: string, path: string) => Handler = (
  method: string,
  path: string,
): Handler => {
  const found: RecordedRoute | undefined = routes.find(
    (each: RecordedRoute) => {
      return each.method === method && each.path === path;
    },
  );

  if (!found) {
    throw new Error(`No route ${method} ${path}`);
  }

  return found.handler;
};

const call: (
  method: string,
  path: string,
  req: Record<string, unknown>,
) => Promise<FakeResponse> = async (
  method: string,
  path: string,
  req: Record<string, unknown>,
): Promise<FakeResponse> => {
  const res: FakeResponse = response();
  await route(method, path)(
    {
      method: method,
      path: path,
      headers: { authorization: "Bearer token" },
      params: {},
      body: {},
      ...req,
    },
    res,
  );
  return res;
};

const INSTALLATION: string =
  "/marketplace/vercel/v1/installations/:installationId";
const RESOURCE: string = `${INSTALLATION}/resources/:resourceId`;

beforeEach(() => {
  routes.length = 0;
  auth = { verifyAuthorizationHeader: jest.fn().mockResolvedValue(CALLER) };
  new VercelMarketplaceProviderAPI({
    auth: auth as unknown as VercelMarketplaceAuth,
  });

  jest.spyOn(MarketplaceConfig, "isVercelConfigured").mockReturnValue(true);
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("VercelMarketplaceProviderAPI routes", () => {
  it("serves the provider API at Vercel's paths, and the webhook", () => {
    expect(
      routes.map((each: RecordedRoute) => {
        return `${each.method} ${each.path}`;
      }),
    ).toEqual([
      `PUT ${INSTALLATION}`,
      `GET ${INSTALLATION}`,
      `PATCH ${INSTALLATION}`,
      `DELETE ${INSTALLATION}`,
      `GET ${INSTALLATION}/plans`,
      "GET /marketplace/vercel/v1/products/:productSlug/plans",
      `POST ${INSTALLATION}/resources`,
      `GET ${RESOURCE}`,
      `PATCH ${RESOURCE}`,
      `DELETE ${RESOURCE}`,
      `GET ${RESOURCE}/plans`,
      `POST ${RESOURCE}/secrets/rotate`,
      "POST /marketplace/vercel/webhook",
    ]);
  });

  it("answers 404 on a server that does not sell through Vercel, without reading the token", async () => {
    jest.spyOn(MarketplaceConfig, "isVercelConfigured").mockReturnValue(false);

    const res: FakeResponse = await call("GET", INSTALLATION, {});

    expect(res.statusCode).toBe(404);
    expect(auth.verifyAuthorizationHeader).not.toHaveBeenCalled();
  });

  it("refuses a call whose token is not Vercel's with 403", async () => {
    auth.verifyAuthorizationHeader.mockRejectedValue(
      new VercelAuthError("The token is not valid: jwt expired"),
    );
    const provider: jest.SpyInstance = jest.spyOn(
      VercelMarketplaceProvider,
      "getInstallation",
    );

    const res: FakeResponse = await call("GET", INSTALLATION, {});

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: {
        code: "forbidden",
        message: "The token is not valid: jwt expired",
      },
    });
    expect(provider).not.toHaveBeenCalled();
  });

  it("hands the caller, path and body to the provider, and answers with what it returns", async () => {
    const provision: jest.SpyInstance = jest
      .spyOn(VercelMarketplaceProvider, "provisionResource")
      .mockResolvedValue({ id: "res_1", secrets: [] });

    const res: FakeResponse = await call("POST", `${INSTALLATION}/resources`, {
      params: { installationId: "icfg_acme" },
      headers: { authorization: "Bearer token", "idempotency-key": "idem-1" },
      body: { name: "Storefront" },
    });

    expect(provision).toHaveBeenCalledWith({
      caller: CALLER,
      installationId: "icfg_acme",
      body: { name: "Storefront" },
      idempotencyKey: "idem-1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ id: "res_1", secrets: [] });

    jest
      .spyOn(VercelMarketplaceProvider, "upsertInstallation")
      .mockResolvedValue(undefined);

    const upserted: FakeResponse = await call("PUT", INSTALLATION, {
      params: { installationId: "icfg_acme" },
    });
    expect(upserted.statusCode).toBe(204);
    expect(upserted.ended).toBe(true);
  });

  it("answers a refusal in Vercel's error shape, and anything else as a 500 to retry", async () => {
    jest.spyOn(VercelMarketplaceProvider, "getResource").mockRejectedValue(
      new VercelProviderError({
        code: "not_found",
        message: "Resource not found.",
      }),
    );

    const missing: FakeResponse = await call("GET", RESOURCE, {
      params: { installationId: "icfg_acme", resourceId: "res_x" },
    });

    expect(missing.statusCode).toBe(404);
    expect(missing.body).toEqual({
      error: { code: "not_found", message: "Resource not found." },
    });

    jest
      .spyOn(VercelMarketplaceProvider, "deleteResource")
      .mockRejectedValue(new Error("database down"));

    const failed: FakeResponse = await call("DELETE", RESOURCE, {
      params: { installationId: "icfg_acme", resourceId: "res_1" },
    });

    expect(failed.statusCode).toBe(500);
    expect(JSON.stringify(failed.body)).not.toContain("database down");
  });

  it("lists the plans, the same for a product and for a resource", async () => {
    jest.spyOn(VercelMarketplaceProvider, "listPlans").mockReturnValue({
      plans: [],
    });
    jest
      .spyOn(VercelMarketplaceProvider, "getResource")
      .mockResolvedValue({ id: "res_1" });

    const product: FakeResponse = await call(
      "GET",
      "/marketplace/vercel/v1/products/:productSlug/plans",
      { params: { productSlug: "oneuptime" } },
    );
    const forResource: FakeResponse = await call("GET", `${RESOURCE}/plans`, {
      params: { installationId: "icfg_acme", resourceId: "res_1" },
    });

    expect(product.body).toEqual({ plans: [] });
    expect(forResource.body).toEqual({ plans: [] });
  });

  it("answers no installation-level plans, for the token's own installation only", async () => {
    const own: FakeResponse = await call("GET", `${INSTALLATION}/plans`, {
      params: { installationId: "icfg_acme" },
    });
    expect(own.body).toEqual({ plans: [] });

    const other: FakeResponse = await call("GET", `${INSTALLATION}/plans`, {
      params: { installationId: "icfg_other" },
    });
    expect(other.statusCode).toBe(403);
  });
});

describe("VercelMarketplaceProviderAPI webhook", () => {
  const WEBHOOK: string = "/marketplace/vercel/webhook";

  it("refuses a webhook whose signature does not match its raw body", async () => {
    const handle: jest.SpyInstance = jest.spyOn(
      VercelMarketplaceWebhooks,
      "handle",
    );

    const res: FakeResponse = await call("POST", WEBHOOK, {
      rawBody: '{"type":"x"}',
      headers: { "x-vercel-signature": "0".repeat(40) },
      body: { type: "x" },
    });

    expect(res.statusCode).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it("acts on a signed webhook, and asks for it again when Vercel could not be reached", async () => {
    jest
      .spyOn(VercelMarketplaceWebhooks, "isSignatureValid")
      .mockReturnValue(true);
    const handle: jest.SpyInstance = jest
      .spyOn(VercelMarketplaceWebhooks, "handle")
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new MarketplaceApiError({
          message: "Vercel 503",
          status: 503,
          isRetryable: true,
        }),
      )
      .mockRejectedValueOnce(
        new MarketplaceApiError({
          message: "Vercel 400",
          status: 400,
          isRetryable: false,
        }),
      );

    const body: Record<string, unknown> = {
      id: "evt_1",
      type: "marketplace.invoice.paid",
      payload: {},
    };

    const handled: FakeResponse = await call("POST", WEBHOOK, { body: body });
    const retry: FakeResponse = await call("POST", WEBHOOK, { body: body });
    const refused: FakeResponse = await call("POST", WEBHOOK, { body: body });

    expect(handle).toHaveBeenCalledWith({
      id: "evt_1",
      type: "marketplace.invoice.paid",
      payload: {},
    });
    expect(handled.statusCode).toBe(200);
    expect(retry.statusCode).toBe(503);
    // A refusal a retry will not cure is acknowledged, not redelivered for a day.
    expect(refused.statusCode).toBe(200);
  });

  it("answers 400 to a signed body that is not a webhook", async () => {
    jest
      .spyOn(VercelMarketplaceWebhooks, "isSignatureValid")
      .mockReturnValue(true);

    const res: FakeResponse = await call("POST", WEBHOOK, {
      body: { nothing: true },
    });

    expect(res.statusCode).toBe(400);
  });
});
