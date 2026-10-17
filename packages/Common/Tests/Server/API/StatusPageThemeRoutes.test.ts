/**
 * A status page's theme on the two public routes that carry it.
 *
 *   - /seo: the two servers that render the page's HTML read the theme here,
 *     over internal HTTP, to send the page in it - a dark page is dark before
 *     its first paint. The field is read the way the app reads it: one of
 *     Light, Dark or System, and Light for anything else, so the renderers
 *     never decide what an empty column means.
 *   - master-page: the first thing the status page app loads. It applies the
 *     page's theme from here, so a page whose /seo lookup failed is drawn in
 *     its own theme once it loads.
 *
 * Both are public: a page's theme is how anyone who opens it sees it. So
 * this pins the wire format, not only the code path.
 */

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
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import StatusPageTheme, {
  STATUS_PAGE_THEMES,
  STATUS_PAGE_THEME_COLUMN,
} from "../../../Types/StatusPage/StatusPageTheme";
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

const SEO_ROUTE: string = "/status-page/seo/:statusPageIdOrDomain";
const MASTER_PAGE_ROUTE: string = "/status-page/master-page/:statusPageId";

// What the column holds, what /seo answers for it, and the stored value.
const STORED_VALUES: Array<[string, StatusPageTheme, unknown]> = [
  ["Light", StatusPageTheme.Light, StatusPageTheme.Light],
  ["Dark", StatusPageTheme.Dark, StatusPageTheme.Dark],
  ["System", StatusPageTheme.System, StatusPageTheme.System],
  [
    "no theme (a page made before the setting)",
    StatusPageTheme.Light,
    undefined,
  ],
  ["an emptied column", StatusPageTheme.Light, null],
  ["a value no reader knows", StatusPageTheme.Light, "Sepia"],
];

describe("StatusPageAPI: the page's theme on its public routes", () => {
  let statusPageId: ObjectID;
  let statusPage: StatusPage;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    statusPageId = ObjectID.generate();
    statusPage = new StatusPage();
    statusPage.id = statusPageId;
    statusPage.name = "Acme Status";
    statusPage.pageTitle = "Acme Status";
    statusPage.isArchived = false;

    jest
      .spyOn(StatusPageService, "resolveStatusPageIdOrNull")
      .mockResolvedValue(statusPageId);
    jest.spyOn(StatusPageService, "findOneBy").mockResolvedValue(statusPage);
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
  });

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

  const selectOf: (spy: unknown) => Record<string, unknown> = (
    spy: unknown,
  ): Record<string, unknown> => {
    const call: Array<unknown> = (spy as jest.Mock).mock
      .calls[0] as Array<unknown>;

    return (call[0] as { select: Record<string, unknown> }).select;
  };

  const callSeo: () => Promise<JSONObject> = async (): Promise<JSONObject> => {
    const request: ExpressRequest = {
      params: { statusPageIdOrDomain: statusPageId.toString() },
      headers: {},
      socket: {},
      ips: [],
    } as unknown as ExpressRequest;

    await mockRouter
      .match("get", SEO_ROUTE)
      .handlerFunction(request, response(), jest.fn() as NextFunction);

    return answer();
  };

  const callMasterPage: () => Promise<JSONObject> =
    async (): Promise<JSONObject> => {
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
      const next: NextFunction = jest.fn() as unknown as NextFunction;

      await mockRouter
        .match("post", MASTER_PAGE_ROUTE)
        .handlerFunction(request, response(), next);

      expect(next).not.toHaveBeenCalled();

      return answer();
    };

  describe("/seo", () => {
    it("selects the theme, or the answer could never carry it", async () => {
      await callSeo();

      expect(selectOf(StatusPageService.findOneBy)["theme"]).toBe(true);
    });

    it.each(STORED_VALUES)(
      "a page with %s is sent as %s",
      async (_what: string, sent: StatusPageTheme, stored: unknown) => {
        statusPage.theme = stored as StatusPageTheme;

        const body: JSONObject = await callSeo();

        expect(body[STATUS_PAGE_THEME_COLUMN]).toBe(sent);
      },
    );

    it("only ever answers one of the three themes", async () => {
      for (const stored of [
        undefined,
        null,
        "",
        "dark",
        0,
        ...STATUS_PAGE_THEMES,
      ]) {
        jest.clearAllMocks();
        statusPage.theme = stored as StatusPageTheme;

        const body: JSONObject = await callSeo();

        expect(STATUS_PAGE_THEMES).toContain(body[STATUS_PAGE_THEME_COLUMN]);
      }
    });

    it("keeps everything else it answered", async () => {
      statusPage.theme = StatusPageTheme.Dark;

      const body: JSONObject = await callSeo();

      expect(body["title"]).toBe("Acme Status");
      expect(body["_id"]).toBe(statusPageId.toString());
      expect(body).toHaveProperty("enableSearchEngineIndexing");
    });
  });

  describe("master-page", () => {
    it("selects the theme for the app", async () => {
      await callMasterPage();

      expect(selectOf(StatusPageService.findOneById)["theme"]).toBe(true);
    });

    it.each(
      STATUS_PAGE_THEMES.map(
        (theme: StatusPageTheme): Array<StatusPageTheme> => {
          return [theme];
        },
      ),
    )("hands the app the page's theme, %s", async (theme: StatusPageTheme) => {
      statusPage.theme = theme;

      const body: JSONObject = await callMasterPage();

      expect((body["statusPage"] as JSONObject)["theme"]).toBe(theme);
    });

    it("sends the theme on the shared host too, where the page's custom code is held back", async () => {
      /*
       * app.example.com is no custom domain of the page: custom CSS and
       * HTML stay home there (StatusPageCustomizationAccess). The theme is
       * not custom code, and is sent all the same.
       */
      statusPage.theme = StatusPageTheme.Dark;
      statusPage.customCSS = "body { background: hotpink; }";

      const body: JSONObject = await callMasterPage();
      const page: JSONObject = body["statusPage"] as JSONObject;

      expect(page["theme"]).toBe(StatusPageTheme.Dark);
      expect(page["customCSS"]).toBeUndefined();
      expect(body["allowStatusPageCustomizations"]).toBe(false);
    });
  });
});
