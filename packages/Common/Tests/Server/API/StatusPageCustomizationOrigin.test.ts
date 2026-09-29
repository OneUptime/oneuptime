import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageDomain from "../../../Models/DatabaseModels/StatusPageDomain";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import StatusPageFooterLinkService from "../../../Server/Services/StatusPageFooterLinkService";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSsoService from "../../../Server/Services/StatusPageSsoService";
import Select from "../../../Server/Types/Database/Select";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

const MASTER_PAGE_ROUTE: string = "/status-page/master-page/:statusPageId";

const CUSTOM_CSS: string = "body { background: url(https://evil.example); }";
const CUSTOM_JAVASCRIPT: string =
  "fetch('/api/project/get-list', { credentials: 'include' });";
const HEADER_HTML: string =
  '<img src="x" onerror="window.headerExecuted = true">';
const FOOTER_HTML: string = '<svg onload="window.footerExecuted = true"></svg>';

type InvocationResult = {
  payload: JSONObject;
  request: ExpressRequest;
  response: ExpressResponse;
  next: NextFunction;
};

describe("StatusPageAPI master-page customization origin boundary", () => {
  const originalHost: string | undefined = process.env["HOST"];
  let statusPageId: ObjectID;
  let statusPage: StatusPage;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env["HOST"] = "app.example.com";

    statusPageId = ObjectID.generate();
    statusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.pageTitle = "Customer Status";
    statusPage.pageDescription = "Everything is operational.";
    statusPage.customCSS = CUSTOM_CSS;
    statusPage.customJavaScript = CUSTOM_JAVASCRIPT;
    statusPage.headerHTML = HEADER_HTML;
    statusPage.footerHTML = FOOTER_HTML;

    jest.spyOn(StatusPageService, "findOneById").mockResolvedValue(statusPage);
    jest
      .spyOn(StatusPageSsoService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(StatusPageFooterLinkService, "findBy").mockResolvedValue([]);
    jest.spyOn(StatusPageHeaderLinkService, "findBy").mockResolvedValue([]);
    jest.spyOn(StatusPageDomainService, "findOneBy").mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalHost === undefined) {
      delete process.env["HOST"];
    } else {
      process.env["HOST"] = originalHost;
    }
  });

  const invokeMasterPage: (data: {
    host?: string | undefined;
    forwardedHost?: string | undefined;
    origin?: string | undefined;
    referer?: string | undefined;
    bodyDomain?: string | undefined;
  }) => Promise<InvocationResult> = async (data: {
    host?: string | undefined;
    forwardedHost?: string | undefined;
    origin?: string | undefined;
    referer?: string | undefined;
    bodyDomain?: string | undefined;
  }): Promise<InvocationResult> => {
    const headers: Record<string, string> = {};

    if (data.host !== undefined) {
      headers["host"] = data.host;
    }

    if (data.forwardedHost !== undefined) {
      headers["x-forwarded-host"] = data.forwardedHost;
    }

    if (data.origin !== undefined) {
      headers["origin"] = data.origin;
    }

    if (data.referer !== undefined) {
      headers["referer"] = data.referer;
    }

    const request: ExpressRequest = {
      params: {
        statusPageId: statusPageId.toString(),
      },
      body: data.bodyDomain ? { domain: data.bodyDomain } : {},
      query: {},
      cookies: {},
      headers,
      get: (name: string): string | undefined => {
        return headers[name.toLowerCase()];
      },
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    const response: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await mockRouter
      .match("post", MASTER_PAGE_ROUTE)
      .handlerFunction(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

    const responseCall: Array<unknown> = (
      Response.sendJsonObjectResponse as jest.Mock
    ).mock.calls[0] as Array<unknown>;

    return {
      payload: responseCall[2] as JSONObject,
      request,
      response,
      next,
    };
  };

  const expectCustomizationsDenied: (payload: JSONObject) => void = (
    payload: JSONObject,
  ): void => {
    expect(payload["allowStatusPageCustomizations"]).toBe(false);

    const serializedStatusPage: JSONObject = payload[
      "statusPage"
    ] as JSONObject;

    expect(serializedStatusPage).not.toHaveProperty("customCSS");
    expect(serializedStatusPage).not.toHaveProperty("customJavaScript");
    expect(serializedStatusPage).not.toHaveProperty("headerHTML");
    expect(serializedStatusPage).not.toHaveProperty("footerHTML");
  };

  it.each([
    ["the configured primary host", "app.example.com"],
    ["a normalized primary host", " APP.EXAMPLE.COM.:443 "],
    ["localhost", "localhost:3000"],
    ["the internal ingress name", "ingress"],
    ["a missing Host", undefined],
    ["a malformed Host", "app.example.com/path"],
    ["an unknown custom host", "unknown.customer.example"],
  ])(
    "omits executable customization fields for %s",
    async (_label: string, host: string | undefined) => {
      const result: InvocationResult = await invokeMasterPage({ host });

      expectCustomizationsDenied(result.payload);

      const findPageCall: Array<unknown> = (
        StatusPageService.findOneById as jest.Mock
      ).mock.calls[0] as Array<unknown>;
      const select: Select<StatusPage> = (
        findPageCall[0] as { select: Select<StatusPage> }
      ).select;

      expect(select).not.toHaveProperty("customCSS");
      expect(select).not.toHaveProperty("customJavaScript");
      expect(select).not.toHaveProperty("headerHTML");
      expect(select).not.toHaveProperty("footerHTML");
    },
  );

  it("returns all customization fields for a verified domain bound to this status page", async () => {
    const statusPageDomain: StatusPageDomain = new StatusPageDomain();
    statusPageDomain.id = ObjectID.generate();
    (StatusPageDomainService.findOneBy as jest.Mock).mockResolvedValue(
      statusPageDomain as never,
    );

    const result: InvocationResult = await invokeMasterPage({
      host: "STATUS.Customer.Example.:443",
    });

    expect(result.payload["allowStatusPageCustomizations"]).toBe(true);
    expect(result.payload["statusPage"]).toMatchObject({
      customCSS: CUSTOM_CSS,
      customJavaScript: CUSTOM_JAVASCRIPT,
      headerHTML: HEADER_HTML,
      footerHTML: FOOTER_HTML,
    });

    const findPageCall: Array<unknown> = (
      StatusPageService.findOneById as jest.Mock
    ).mock.calls[0] as Array<unknown>;
    const select: Select<StatusPage> = (
      findPageCall[0] as { select: Select<StatusPage> }
    ).select;

    expect(select).toEqual(
      expect.objectContaining({
        customCSS: true,
        customJavaScript: true,
        headerHTML: true,
        footerHTML: true,
      }),
    );

    expect(StatusPageDomainService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          fullDomain: "status.customer.example",
          statusPageId,
          isCnameVerified: true,
          domain: {
            isVerified: true,
          },
        },
      }),
    );
  });

  it("denies a domain record bound to a different status page", async () => {
    const otherStatusPageId: ObjectID = ObjectID.generate();
    const statusPageDomain: StatusPageDomain = new StatusPageDomain();
    statusPageDomain.id = ObjectID.generate();

    (StatusPageDomainService.findOneBy as jest.Mock).mockImplementation(
      (args: unknown) => {
        const queryStatusPageId: ObjectID = (
          args as { query: { statusPageId: ObjectID } }
        ).query.statusPageId;

        return Promise.resolve(
          queryStatusPageId.toString() === otherStatusPageId.toString()
            ? statusPageDomain
            : null,
        );
      },
    );

    const result: InvocationResult = await invokeMasterPage({
      host: "status.customer.example",
    });

    expectCustomizationsDenied(result.payload);
  });

  it("ignores forwarded-host, origin, referer, and body attempts to opt in", async () => {
    const statusPageDomain: StatusPageDomain = new StatusPageDomain();
    statusPageDomain.id = ObjectID.generate();
    (StatusPageDomainService.findOneBy as jest.Mock).mockResolvedValue(
      statusPageDomain as never,
    );

    const result: InvocationResult = await invokeMasterPage({
      host: "app.example.com",
      forwardedHost: "status.customer.example",
      origin: "https://status.customer.example",
      referer: "https://status.customer.example/",
      bodyDomain: "status.customer.example",
    });

    expectCustomizationsDenied(result.payload);
    expect(StatusPageDomainService.findOneBy).not.toHaveBeenCalled();
  });

  it("fails closed but still serves safe master-page data when domain lookup fails", async () => {
    (StatusPageDomainService.findOneBy as jest.Mock).mockRejectedValue(
      new Error("database unavailable") as never,
    );

    const result: InvocationResult = await invokeMasterPage({
      host: "status.customer.example",
    });

    expectCustomizationsDenied(result.payload);
    expect(result.payload["statusPage"]).toMatchObject({
      _id: statusPageId.toString(),
      pageTitle: "Customer Status",
      pageDescription: "Everything is operational.",
    });
    expect(result.payload["footerLinks"]).toEqual([]);
    expect(result.payload["headerLinks"]).toEqual([]);
    expect(result.payload["hasEnabledSSO"]).toBe(0);
  });

  it("explicitly redacts over-populated service results on denied origins", async () => {
    const result: InvocationResult = await invokeMasterPage({
      host: "app.example.com",
    });

    expectCustomizationsDenied(result.payload);
    expect(statusPage.customCSS).toBeUndefined();
    expect(statusPage.customJavaScript).toBeUndefined();
    expect(statusPage.headerHTML).toBeUndefined();
    expect(statusPage.footerHTML).toBeUndefined();
  });
});
