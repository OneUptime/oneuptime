import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
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
import HashedString from "../../../Types/HashedString";
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

/*
 * The master-page answer tells the status page app whether its sign-in page
 * offers "Email me a sign-in link" (#5600): enableMagicLinkLogin, worked out
 * by the rule Identity signs in with (Types/StatusPage/StatusPageMagicLink) -
 * a page visitors sign in to, that does not require SSO, with the switch on -
 * rather than the switch as stored, so the app never offers a link the server
 * would refuse.
 */

const MASTER_PAGE_ROUTE: string = "/status-page/master-page/:statusPageId";

interface PageState {
  isPublicStatusPage: boolean;
  enableMasterPassword: boolean;
  hasMasterPassword: boolean;
  requireSsoForLogin: boolean;
  enableMagicLinkLogin: boolean;
}

const SIGN_IN_PAGE: PageState = {
  isPublicStatusPage: false,
  enableMasterPassword: false,
  hasMasterPassword: false,
  requireSsoForLogin: false,
  enableMagicLinkLogin: true,
};

describe("StatusPageAPI master-page: whether the sign-in page offers a sign-in link", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest
      .spyOn(StatusPageSsoService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));
    jest.spyOn(StatusPageFooterLinkService, "findBy").mockResolvedValue([]);
    jest.spyOn(StatusPageHeaderLinkService, "findBy").mockResolvedValue([]);
    jest.spyOn(StatusPageDomainService, "findOneBy").mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const loadMasterPage: (state: PageState) => Promise<{
    page: JSONObject;
    select: Record<string, unknown>;
  }> = async (
    state: PageState,
  ): Promise<{ page: JSONObject; select: Record<string, unknown> }> => {
    const statusPageId: ObjectID = ObjectID.generate();
    const statusPage: StatusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.pageTitle = "Acme Status";
    statusPage.isArchived = false;
    statusPage.isPublicStatusPage = state.isPublicStatusPage;
    statusPage.enableMasterPassword = state.enableMasterPassword;
    statusPage.requireSsoForLogin = state.requireSsoForLogin;
    statusPage.enableMagicLinkLogin = state.enableMagicLinkLogin;

    if (state.hasMasterPassword) {
      statusPage.masterPassword = new HashedString("stored-hash", true);
    }

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

    const responseCall: Array<unknown> = (
      Response.sendJsonObjectResponse as jest.Mock
    ).mock.calls[0] as Array<unknown>;
    const findCall: Array<unknown> = findOneById.mock
      .calls[0] as Array<unknown>;

    return {
      page: (responseCall[2] as JSONObject)["statusPage"] as JSONObject,
      select: ((findCall[0] as { select: Record<string, unknown> }).select ||
        {}) as Record<string, unknown>,
    };
  };

  it("reads the switch and everything else the rule needs", async () => {
    const { select } = await loadMasterPage(SIGN_IN_PAGE);

    expect(select).toMatchObject({
      enableMagicLinkLogin: true,
      requireSsoForLogin: true,
      isPublicStatusPage: true,
      enableMasterPassword: true,
      masterPassword: true,
    });
  });

  it("a page visitors sign in to, with the switch on, offers the link", async () => {
    const { page } = await loadMasterPage(SIGN_IN_PAGE);

    expect(page["enableMagicLinkLogin"]).toBe(true);
  });

  it.each([
    ["has turned links off", { enableMagicLinkLogin: false }],
    ["requires SSO", { requireSsoForLogin: true }],
    ["is public", { isPublicStatusPage: true }],
    [
      "asks visitors for its master password",
      { enableMasterPassword: true, hasMasterPassword: true },
    ],
  ])(
    "a page that %s offers none",
    async (_name: string, change: Partial<PageState>) => {
      const { page } = await loadMasterPage({ ...SIGN_IN_PAGE, ...change });

      expect(page["enableMagicLinkLogin"]).toBe(false);
    },
  );

  it("a private page whose master password switch is on but holds no password is a sign-in page, and offers it", async () => {
    const { page } = await loadMasterPage({
      ...SIGN_IN_PAGE,
      enableMasterPassword: true,
    });

    expect(page["enableMagicLinkLogin"]).toBe(true);
    expect(page["enableMasterPassword"]).toBe(false);
  });

  it("the master password's hash still never leaves the server", async () => {
    const { page } = await loadMasterPage({
      ...SIGN_IN_PAGE,
      enableMasterPassword: true,
      hasMasterPassword: true,
    });

    expect(page).not.toHaveProperty("masterPassword");
    expect(page["enableMasterPassword"]).toBe(true);
  });
});
