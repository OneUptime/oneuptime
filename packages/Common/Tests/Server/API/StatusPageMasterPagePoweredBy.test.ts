import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import StatusPageDomainService from "../../../Server/Services/StatusPageDomainService";
import StatusPageFooterLinkService from "../../../Server/Services/StatusPageFooterLinkService";
import StatusPageHeaderLinkService from "../../../Server/Services/StatusPageHeaderLinkService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSsoService from "../../../Server/Services/StatusPageSsoService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
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

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * The master-page answer tells the status page app whether to draw "Powered
 * by OneUptime" in its footer. Removing it is an Enterprise feature
 * (EnterpriseFeature.StatusPageBranding): the page's switch takes effect
 * only while the feature is active, so the Community Edition and a lapsed
 * self-hosted license answer false whatever the switch says, while the
 * switch itself is left as it is.
 */

const MASTER_PAGE_ROUTE: string = "/status-page/master-page/:statusPageId";

describe("StatusPageAPI master-page: whether the page hides Powered by OneUptime", () => {
  let statusPageId: ObjectID;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();
    statusPageId = ObjectID.generate();

    jest
      .spyOn(StatusPageSsoService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(StatusPageFooterLinkService, "findBy").mockResolvedValue([]);
    jest.spyOn(StatusPageHeaderLinkService, "findBy").mockResolvedValue([]);
    jest.spyOn(StatusPageDomainService, "findOneBy").mockResolvedValue(null);
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  const loadMasterPage: (hidePoweredBy: boolean) => Promise<{
    page: JSONObject;
    select: Record<string, unknown>;
    stored: StatusPage;
  }> = async (
    hidePoweredBy: boolean,
  ): Promise<{
    page: JSONObject;
    select: Record<string, unknown>;
    stored: StatusPage;
  }> => {
    const statusPage: StatusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.pageTitle = "Acme Status";
    statusPage.isPublicStatusPage = true;
    statusPage.isArchived = false;
    statusPage.hidePoweredByOneUptimeBranding = hidePoweredBy;

    const findOneById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPageService, "findOneById")
      .mockResolvedValue(statusPage);

    const request: ExpressRequest = {
      params: { statusPageId: statusPageId.toString() },
      body: {},
      query: {},
      cookies: {},
      headers: { host: "app.example.com" },
      get: (name: string): string | undefined => {
        return name.toLowerCase() === "host" ? "app.example.com" : undefined;
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

    const findCall: Array<unknown> = findOneById.mock
      .calls[0] as Array<unknown>;

    return {
      page: (responseCall[2] as JSONObject)["statusPage"] as JSONObject,
      select: ((findCall[0] as { select: Record<string, unknown> }).select ||
        {}) as Record<string, unknown>,
      stored: statusPage,
    };
  };

  it("reads the page's switch", async () => {
    const { select } = await loadMasterPage(true);

    expect(select["hidePoweredByOneUptimeBranding"]).toBe(true);
  });

  it("the Community Edition shows the line on a page whose switch hides it", async () => {
    const { page } = await loadMasterPage(true);

    expect(page["hidePoweredByOneUptimeBranding"]).toBe(false);
  });

  it("the Enterprise Edition with a license hides it", async () => {
    installFakeEnterpriseModule();

    const { page } = await loadMasterPage(true);

    expect(page["hidePoweredByOneUptimeBranding"]).toBe(true);
  });

  it("a page whose switch is off shows it in every edition", async () => {
    installFakeEnterpriseModule();

    const { page } = await loadMasterPage(false);

    expect(page["hidePoweredByOneUptimeBranding"]).toBe(false);
  });

  it("a lapsed license shows it again", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    const { page } = await loadMasterPage(true);

    expect(page["hidePoweredByOneUptimeBranding"]).toBe(false);
  });

  it("a license that leaves status page branding out shows it", async () => {
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshot({
        features: [EnterpriseFeature.IpAllowlists],
      }),
    });

    const { page } = await loadMasterPage(true);

    expect(page["hidePoweredByOneUptimeBranding"]).toBe(false);
  });

  it("an unknown license state keeps hiding it, as the runtime does", async () => {
    installFakeEnterpriseModule({ snapshot: null });

    const { page } = await loadMasterPage(true);

    expect(page["hidePoweredByOneUptimeBranding"]).toBe(true);
  });

  it("OneUptime Cloud hides it: the plan decides who may switch it", async () => {
    setTestBillingEnabled(true);
    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    const { page } = await loadMasterPage(true);

    expect(page["hidePoweredByOneUptimeBranding"]).toBe(true);
  });
});
