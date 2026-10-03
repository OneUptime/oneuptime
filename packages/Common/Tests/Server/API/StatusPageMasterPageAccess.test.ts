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
import {
  getStatusPageAccess,
  StatusPageAccess,
  StatusPageAccessState,
} from "../../../Types/StatusPage/StatusPageAccess";
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
import type { SpyInstance } from "jest-mock";

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
 * The master-page answer is the first thing the status page app loads: its
 * enableMasterPassword decides whether visitors of a private page are sent
 * to the master password prompt or to sign in.
 *
 * It says yes exactly when the server asks for the password (Types/
 * StatusPage/StatusPageAccess): not public, the switch on and a password
 * set. The switch alone used to say yes on a private page with no password
 * set, so the app sent every visitor - private users included - to a
 * prompt that could never let anyone in, while the server treated the page
 * as a sign-in page. And the password's hash and salt, read to answer that,
 * never leave the server.
 */

const MASTER_PAGE_ROUTE: string = "/status-page/master-page/:statusPageId";

type Row = [string, StatusPageAccessState];

const STATES: Array<Row> = [
  [
    "public",
    {
      isPublicStatusPage: true,
      enableMasterPassword: false,
      hasMasterPassword: false,
    },
  ],
  [
    "public, with a password switched on and set",
    {
      isPublicStatusPage: true,
      enableMasterPassword: true,
      hasMasterPassword: true,
    },
  ],
  [
    "private, signing in",
    {
      isPublicStatusPage: false,
      enableMasterPassword: false,
      hasMasterPassword: false,
    },
  ],
  [
    "private, a password set but switched off",
    {
      isPublicStatusPage: false,
      enableMasterPassword: false,
      hasMasterPassword: true,
    },
  ],
  [
    "private, the switch on and no password",
    {
      isPublicStatusPage: false,
      enableMasterPassword: true,
      hasMasterPassword: false,
    },
  ],
  [
    "private, the switch on and a password set",
    {
      isPublicStatusPage: false,
      enableMasterPassword: true,
      hasMasterPassword: true,
    },
  ],
];

describe("StatusPageAPI master-page: whether the page asks for the master password", () => {
  let statusPageId: ObjectID;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    statusPageId = ObjectID.generate();

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

  const loadMasterPage: (state: StatusPageAccessState) => Promise<{
    payload: JSONObject;
    select: Record<string, unknown>;
  }> = async (
    state: StatusPageAccessState,
  ): Promise<{ payload: JSONObject; select: Record<string, unknown> }> => {
    const statusPage: StatusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.pageTitle = "Acme Status";
    statusPage.isPublicStatusPage = state.isPublicStatusPage === true;
    statusPage.enableMasterPassword = state.enableMasterPassword === true;
    statusPage.isArchived = false;

    if (state.hasMasterPassword) {
      statusPage.masterPassword = new HashedString(
        "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
        true,
      );
      statusPage.masterPasswordSalt = "salt-that-must-stay-home";
    }

    const findOneById: SpyInstance = jest
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
      payload: responseCall[2] as JSONObject,
      select: ((findCall[0] as { select: Record<string, unknown> }).select ||
        {}) as Record<string, unknown>,
    };
  };

  it.each(STATES)(
    "%s: asks for the password exactly when the server would",
    async (_label: string, state: StatusPageAccessState) => {
      const { payload } = await loadMasterPage(state);
      const page: JSONObject = payload["statusPage"] as JSONObject;

      expect(Boolean(page["enableMasterPassword"])).toBe(
        getStatusPageAccess(state) === StatusPageAccess.Password,
      );
      expect(Boolean(page["isPublicStatusPage"])).toBe(
        state.isPublicStatusPage === true,
      );
    },
  );

  it("a private page with the switch on but no password set is a sign-in page for the app too", async () => {
    const { payload } = await loadMasterPage({
      isPublicStatusPage: false,
      enableMasterPassword: true,
      hasMasterPassword: false,
    });

    const page: JSONObject = payload["statusPage"] as JSONObject;

    expect(page["isPublicStatusPage"]).toBe(false);
    expect(page["enableMasterPassword"]).toBe(false);
  });

  it.each(STATES)(
    "%s: the password's hash and salt are read to answer, and never sent",
    async (_label: string, state: StatusPageAccessState) => {
      const { payload, select } = await loadMasterPage(state);
      const page: JSONObject = payload["statusPage"] as JSONObject;

      expect(select["masterPassword"]).toBe(true);
      expect(page).not.toHaveProperty("masterPassword");
      expect(page).not.toHaveProperty("masterPasswordSalt");
      expect(JSON.stringify(payload)).not.toContain(
        "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
      );
      expect(JSON.stringify(payload)).not.toContain("salt-that-must-stay-home");
    },
  );
});
