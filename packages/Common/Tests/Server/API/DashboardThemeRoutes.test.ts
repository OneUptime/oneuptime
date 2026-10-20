/**
 * A public dashboard's theme on the two public routes that carry it.
 *
 *   - /seo: the two servers that render the public dashboard's HTML read the
 *     theme here, over internal HTTP, to send the page in it - a dark
 *     dashboard, and its password prompt, are dark before the first paint.
 *     The field is read the way the app reads it: one of Light, Dark or
 *     System, and Light for anything else, so the renderers never decide
 *     what an empty column means.
 *   - /metadata: the first thing the public dashboard app loads. It applies
 *     the dashboard's theme from here, so a dashboard whose /seo lookup
 *     failed is drawn in its own theme once it loads.
 *
 * Both answer a visitor the link lets in, or who it asks for the password.
 * A visitor the IP allowlist refuses gets no theme: Access Denied shows
 * nothing of the dashboard, and follows the visitor. The rest of what these
 * routes answer, for every way a dashboard is shared, is pinned in
 * PublicDashboardLinkAnswers.test.ts; this walks every stored value.
 */

import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardAPI from "../../../Server/API/DashboardAPI";
import DashboardService from "../../../Server/Services/DashboardService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import {
  PublicDashboardAccess,
  PublicDashboardAccessResult,
} from "../../../Server/Utils/Dashboard/PublicDashboardAccess";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardTheme, {
  DASHBOARD_THEMES,
  DASHBOARD_THEME_COLUMN,
} from "../../../Types/Dashboard/DashboardTheme";
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

jest.mock("../../../Server/Utils/Logger");

const SEO_ROUTE: string = "/dashboard/seo/:dashboardIdOrDomain";
const METADATA_ROUTE: string = "/dashboard/metadata/:dashboardId";

// What the column holds, what the routes answer for it, and the stored value.
const STORED_VALUES: Array<[string, DashboardTheme, unknown]> = [
  ["Light", DashboardTheme.Light, DashboardTheme.Light],
  ["Dark", DashboardTheme.Dark, DashboardTheme.Dark],
  ["System", DashboardTheme.System, DashboardTheme.System],
  [
    "no theme (a dashboard made before the setting)",
    DashboardTheme.Light,
    undefined,
  ],
  ["an emptied column", DashboardTheme.Light, null],
  ["a value no reader knows", DashboardTheme.Light, "Sepia"],
  ["another case", DashboardTheme.Light, "dark"],
];

const GRANTED: PublicDashboardAccessResult = {
  access: PublicDashboardAccess.Granted,
  isMasterPasswordRequired: false,
};

const PASSWORD_REQUIRED: PublicDashboardAccessResult = {
  access: PublicDashboardAccess.PasswordRequired,
  isMasterPasswordRequired: true,
  error: new ForbiddenException("Enter the password."),
} as unknown as PublicDashboardAccessResult;

const FORBIDDEN: PublicDashboardAccessResult = {
  access: PublicDashboardAccess.Forbidden,
  isMasterPasswordRequired: false,
  error: new ForbiddenException(
    "Your IP address 198.51.100.5 is blocked from accessing this dashboard.",
  ),
} as unknown as PublicDashboardAccessResult;

const VISITORS: Array<[string, PublicDashboardAccessResult]> = [
  ["a visitor the link lets in", GRANTED],
  ["a visitor asked for the password", PASSWORD_REQUIRED],
];

describe("DashboardAPI: the dashboard's theme on its public routes", () => {
  let dashboardId: ObjectID;
  let dashboard: Dashboard;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new DashboardAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    dashboardId = ObjectID.generate();
    dashboard = new Dashboard();
    dashboard._id = dashboardId.toString();
    dashboard.id = dashboardId;
    dashboard.projectId = ObjectID.generate();
    dashboard.name = "Checkout";
    dashboard.pageTitle = "Checkout status";

    jest.spyOn(DashboardService, "findOneById").mockResolvedValue(dashboard);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const decide: (access: PublicDashboardAccessResult) => void = (
    access: PublicDashboardAccessResult,
  ): void => {
    jest
      .spyOn(DashboardService, "getPublicAccessForEveryone")
      .mockResolvedValue(access);
    jest.spyOn(DashboardService, "getPublicAccess").mockResolvedValue(access);
  };

  const response: () => ExpressResponse = (): ExpressResponse => {
    return {
      set: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;
  };

  const answer: () => JSONObject = (): JSONObject => {
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

    const call: Array<unknown> = (Response.sendJsonObjectResponse as jest.Mock)
      .mock.calls[0] as Array<unknown>;

    return call[2] as JSONObject;
  };

  const select: () => Record<string, unknown> = (): Record<string, unknown> => {
    const call: Array<unknown> = (DashboardService.findOneById as jest.Mock)
      .mock.calls[0] as Array<unknown>;

    return (call[0] as { select: Record<string, unknown> }).select;
  };

  const call: (
    method: "get" | "post",
    route: string,
    params: Record<string, string>,
  ) => Promise<NextFunction> = async (
    method: "get" | "post",
    route: string,
    params: Record<string, string>,
  ): Promise<NextFunction> => {
    const request: ExpressRequest = {
      params,
      body: {},
      query: {},
      cookies: {},
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await mockRouter
      .match(method, route)
      .handlerFunction(request, response(), next);

    return next;
  };

  const callSeo: () => Promise<NextFunction> = (): Promise<NextFunction> => {
    return call("get", SEO_ROUTE, {
      dashboardIdOrDomain: dashboardId.toString(),
    });
  };

  const callMetadata: () => Promise<NextFunction> =
    (): Promise<NextFunction> => {
      return call("post", METADATA_ROUTE, {
        dashboardId: dashboardId.toString(),
      });
    };

  describe("/seo", () => {
    it.each(VISITORS)(
      "selects the theme for %s, or the answer could never carry it",
      async (_who: string, access: PublicDashboardAccessResult) => {
        decide(access);
        await callSeo();

        expect(select()[DASHBOARD_THEME_COLUMN]).toBe(true);
      },
    );

    describe.each(VISITORS)(
      "for %s",
      (_who: string, access: PublicDashboardAccessResult) => {
        it.each(STORED_VALUES)(
          "a dashboard with %s is sent as %s",
          async (_what: string, sent: DashboardTheme, stored: unknown) => {
            decide(access);
            dashboard.theme = stored as DashboardTheme;

            await callSeo();

            expect(answer()[DASHBOARD_THEME_COLUMN]).toBe(sent);
          },
        );
      },
    );

    it("only ever answers one of the three themes", async () => {
      decide(GRANTED);

      for (const stored of [
        undefined,
        null,
        "",
        "dark",
        0,
        ...DASHBOARD_THEMES,
      ]) {
        jest.clearAllMocks();
        dashboard.theme = stored as DashboardTheme;

        await callSeo();

        expect(DASHBOARD_THEMES).toContain(answer()[DASHBOARD_THEME_COLUMN]);
      }
    });

    it("keeps everything else it answered", async () => {
      decide(GRANTED);
      dashboard.theme = DashboardTheme.Dark;

      await callSeo();

      expect(answer()).toEqual({
        _id: dashboardId.toString(),
        title: "Checkout status",
        description: "View dashboard metrics and insights.",
        theme: DashboardTheme.Dark,
      });
    });

    it("names no theme behind an IP allowlist, and reads none", async () => {
      decide(FORBIDDEN);
      dashboard.theme = DashboardTheme.Dark;

      await callSeo();

      expect(answer()).not.toHaveProperty(DASHBOARD_THEME_COLUMN);
      expect(DashboardService.findOneById).not.toHaveBeenCalled();
    });
  });

  describe("/metadata", () => {
    it.each(VISITORS)(
      "selects the theme for %s",
      async (_who: string, access: PublicDashboardAccessResult) => {
        decide(access);
        await callMetadata();

        expect(select()[DASHBOARD_THEME_COLUMN]).toBe(true);
      },
    );

    describe.each(VISITORS)(
      "for %s",
      (_who: string, access: PublicDashboardAccessResult) => {
        it.each(STORED_VALUES)(
          "hands the app a dashboard with %s as %s",
          async (_what: string, sent: DashboardTheme, stored: unknown) => {
            decide(access);
            dashboard.theme = stored as DashboardTheme;

            const next: NextFunction = await callMetadata();

            expect(next).not.toHaveBeenCalled();
            expect(answer()[DASHBOARD_THEME_COLUMN]).toBe(sent);
          },
        );
      },
    );

    it("a password prompt carries the theme but still nothing the password guards", async () => {
      decide(PASSWORD_REQUIRED);
      dashboard.theme = DashboardTheme.System;
      dashboard.description = "Orders and payments";

      await callMetadata();

      const body: JSONObject = answer();

      expect(body[DASHBOARD_THEME_COLUMN]).toBe(DashboardTheme.System);
      expect(body["description"]).toBe("");
      expect(body["logoFile"]).toBeNull();
    });

    it("a visitor the IP allowlist refuses gets the refusal, and no theme", async () => {
      decide(FORBIDDEN);
      dashboard.theme = DashboardTheme.Dark;

      const next: NextFunction = await callMetadata();

      expect(next).toHaveBeenCalledWith(FORBIDDEN["error" as never]);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      expect(DashboardService.findOneById).not.toHaveBeenCalled();
    });
  });
});
