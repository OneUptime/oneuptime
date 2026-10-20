/**
 * The public dashboard servers' half of applying a dashboard's theme before
 * its first paint.
 *
 * The dashboard API's /seo answers the dashboard's theme - Light, Dark or
 * System, read the way the app reads it (Common/Tests/Server/API/
 * DashboardThemeRoutes.test.ts) - to a visitor the link lets in or asks
 * for the password, and none behind an IP allowlist. The two servers that
 * render the public dashboard - the standalone public-dashboard container
 * and the combined App container - read it there and hand index.ejs what
 * getDashboardThemeHead works out for it, which the template draws before
 * any script or stylesheet runs (Common/Tests/App/PublicDashboard/
 * PublicDashboardIndexTheme.test.ts).
 *
 * A page that knows no dashboard's theme - a dashboard that does not answer
 * (not found), an answer that names none (an IP allowlist), a lookup that
 * failed, a URL that names no dashboard - is sent the head that follows the
 * visitor: their own pick, else their device. The app applies the
 * dashboard's own theme once it has loaded.
 *
 * Everything runs against both servers, through their real renderers
 * (PageServerHarness).
 */

jest.mock("Common/Server/Utils/StartServer", () => {
  return {
    __esModule: true,
    default: {
      init: jest.fn(),
      addDefaultRoutes: jest.fn(),
    },
  };
});

import DashboardDomain from "Common/Models/DatabaseModels/DashboardDomain";
import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import DashboardTheme, {
  DASHBOARD_THEMES,
  DASHBOARD_THEME_VIEW_VARIABLE,
  getDashboardThemeHead,
} from "Common/Types/Dashboard/DashboardTheme";
import { getPublicDashboardData as getFrontendPublicDashboardData } from "../../FeatureSet/Frontend/Utils/PublicDashboard";
import { getPublicDashboardData as getStandalonePublicDashboardData } from "../../FeatureSet/PublicDashboard/src/Server/Utils/PublicDashboard";
import {
  FakeResponse,
  PageRenderer,
  PageServers,
  SpiedApi,
  answerSeo,
  loadPageServers,
  pageRequest,
  spyOnApi,
} from "../StatusPage/PageServerHarness";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

const DASHBOARD_ID: string = "da000000-0000-4000-8000-0000000000c1";
const MISSING_DASHBOARD_ID: string = "da000000-0000-4000-8000-0000000000c2";
const DOMAIN: string = "metrics.acme.example";

const seoAnswer: (theme: unknown) => HTTPResponse<JSONObject> = (
  theme: unknown,
): HTTPResponse<JSONObject> => {
  const body: JSONObject = {
    _id: DASHBOARD_ID,
    title: "Acme Metrics",
    description: "How Acme is doing.",
  };

  if (theme !== undefined) {
    body["theme"] = theme as string;
  }

  return new HTTPResponse<JSONObject>(200, body, {});
};

let apiGet: SpiedApi;

const onCustomDomain: () => ExpressRequest = (): ExpressRequest => {
  return pageRequest({ host: DOMAIN, path: "/" });
};

const onDashboardUrl: (dashboardId: string, path?: string) => ExpressRequest = (
  dashboardId: string,
  path: string = "",
): ExpressRequest => {
  return pageRequest({
    host: "oneuptime.example",
    path: `/public-dashboard/${dashboardId}${path}`,
  });
};

beforeEach(() => {
  apiGet = spyOnApi("get");
  answerSeo(apiGet, {
    [DASHBOARD_ID]: seoAnswer(DashboardTheme.Dark),
    [DOMAIN]: seoAnswer(DashboardTheme.Dark),
    [MISSING_DASHBOARD_ID]: new HTTPErrorResponse(
      404,
      { message: "Dashboard not found" },
      {},
    ),
  });

  // Every custom domain here is a dashboard's.
  jest
    .spyOn(DashboardDomainService, "findOneBy")
    .mockResolvedValue(new DashboardDomain());
});

afterEach(() => {
  jest.restoreAllMocks();
});

type GetPublicDashboardData = typeof getFrontendPublicDashboardData;

const IMPLEMENTATIONS: Array<[string, GetPublicDashboardData]> = [
  ["standalone public-dashboard container", getStandalonePublicDashboardData],
  ["combined App container", getFrontendPublicDashboardData],
];

describe.each(IMPLEMENTATIONS)(
  "getPublicDashboardData (%s) reads the dashboard's theme",
  (_name: string, getPublicDashboardData: GetPublicDashboardData) => {
    it.each([
      [DashboardTheme.Light, DashboardTheme.Light],
      [DashboardTheme.Dark, DashboardTheme.Dark],
      [DashboardTheme.System, DashboardTheme.System],
      // Values no reader knows are the light page, as the API reads them.
      [null, DashboardTheme.Light],
      ["dark", DashboardTheme.Light],
      ["Sepia", DashboardTheme.Light],
    ])(
      "/seo answering %p: %s, on its custom domain and its own URL",
      async (answered: unknown, read: DashboardTheme) => {
        answerSeo(apiGet, {
          [DOMAIN]: seoAnswer(answered),
          [DASHBOARD_ID]: seoAnswer(answered),
        });

        await expect(
          getPublicDashboardData(onCustomDomain()),
        ).resolves.toMatchObject({ theme: read });
        await expect(
          getPublicDashboardData(onDashboardUrl(DASHBOARD_ID)),
        ).resolves.toMatchObject({ theme: read });
      },
    );

    it("an answer that names no theme - an IP allowlist's - is no theme at all", async () => {
      answerSeo(apiGet, {
        [DOMAIN]: seoAnswer(undefined),
        [DASHBOARD_ID]: seoAnswer(undefined),
      });

      await expect(
        getPublicDashboardData(onCustomDomain()),
      ).resolves.toMatchObject({ id: DASHBOARD_ID, theme: null });
      await expect(
        getPublicDashboardData(onDashboardUrl(DASHBOARD_ID)),
      ).resolves.toMatchObject({ id: DASHBOARD_ID, theme: null });
    });

    it("a dashboard URL whose lookup failed renders from its id, with no theme", async () => {
      answerSeo(apiGet, {
        [DASHBOARD_ID]: new HTTPErrorResponse(500, {}, {}),
      });

      await expect(
        getPublicDashboardData(onDashboardUrl(DASHBOARD_ID)),
      ).resolves.toEqual({
        id: DASHBOARD_ID,
        title: "Dashboard",
        description: "View dashboard metrics and insights.",
        theme: null,
      });
    });

    it("its password prompt's URL is the dashboard's, with the dashboard's theme", async () => {
      await expect(
        getPublicDashboardData(
          onDashboardUrl(DASHBOARD_ID, "/master-password"),
        ),
      ).resolves.toMatchObject({ theme: DashboardTheme.Dark });
    });
  },
);

let servers: PageServers;

beforeAll(async () => {
  servers = await loadPageServers();
});

const SHELLS: Array<[string, () => PageRenderer, () => PageRenderer]> = [
  [
    "combined App container",
    () => {
      return servers.combined.publicDashboard;
    },
    () => {
      return servers.combined.customDomain;
    },
  ],
  [
    "standalone public-dashboard container",
    () => {
      return servers.standalone.publicDashboard;
    },
    () => {
      return servers.standalone.publicDashboard;
    },
  ],
];

const themeHeadOf: (res: FakeResponse) => unknown = (
  res: FakeResponse,
): unknown => {
  return res.rendered?.variables[DASHBOARD_THEME_VIEW_VARIABLE];
};

const FOLLOWS_THE_VISITOR: unknown = getDashboardThemeHead(null);

describe.each(SHELLS)(
  "the public dashboard shell in the %s",
  (
    _name: string,
    dashboardUrlShell: () => PageRenderer,
    customDomainShell: () => PageRenderer,
  ) => {
    it.each(
      DASHBOARD_THEMES.map((theme: DashboardTheme): Array<DashboardTheme> => {
        return [theme];
      }),
    )(
      "hands the template the head of a %s dashboard, on its custom domain, its own URL and its password prompt",
      async (theme: DashboardTheme) => {
        answerSeo(apiGet, {
          [DOMAIN]: seoAnswer(theme),
          [DASHBOARD_ID]: seoAnswer(theme),
        });

        const onDomain: FakeResponse =
          await customDomainShell()(onCustomDomain());
        const onUrl: FakeResponse = await dashboardUrlShell()(
          onDashboardUrl(DASHBOARD_ID),
        );
        const onPrompt: FakeResponse = await dashboardUrlShell()(
          onDashboardUrl(DASHBOARD_ID, "/master-password"),
        );

        expect(onDomain.statusCode).toBe(200);
        expect(themeHeadOf(onDomain)).toEqual(getDashboardThemeHead(theme));
        expect(themeHeadOf(onUrl)).toEqual(getDashboardThemeHead(theme));
        expect(themeHeadOf(onPrompt)).toEqual(getDashboardThemeHead(theme));
      },
    );

    it("a Dark dashboard's page is dark in the HTML: the dark class is what the template is handed", async () => {
      const res: FakeResponse = await dashboardUrlShell()(
        onDashboardUrl(DASHBOARD_ID),
      );

      expect(themeHeadOf(res)).toMatchObject({
        setting: "dark",
        htmlClassName: "dark",
      });
    });

    it("sends a dashboard that does not answer as a page that follows the visitor", async () => {
      const res: FakeResponse = await dashboardUrlShell()(
        onDashboardUrl(MISSING_DASHBOARD_ID),
      );

      expect(res.statusCode).toBe(404);
      expect(themeHeadOf(res)).toEqual(FOLLOWS_THE_VISITOR);
    });

    it("sends a dashboard behind an IP allowlist - an answer with no theme - as a page that follows the visitor", async () => {
      answerSeo(apiGet, {
        [DOMAIN]: seoAnswer(undefined),
        [DASHBOARD_ID]: seoAnswer(undefined),
      });

      expect(themeHeadOf(await customDomainShell()(onCustomDomain()))).toEqual(
        FOLLOWS_THE_VISITOR,
      );
      expect(
        themeHeadOf(await dashboardUrlShell()(onDashboardUrl(DASHBOARD_ID))),
      ).toEqual(FOLLOWS_THE_VISITOR);
    });

    it("sends a custom domain whose lookup failed as a page that follows the visitor", async () => {
      answerSeo(apiGet, { [DOMAIN]: new HTTPErrorResponse(500, {}, {}) });

      const res: FakeResponse = await customDomainShell()(onCustomDomain());

      expect(themeHeadOf(res)).toEqual(FOLLOWS_THE_VISITOR);
    });
  },
);
