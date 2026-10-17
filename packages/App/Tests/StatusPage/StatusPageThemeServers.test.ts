/**
 * The status page servers' half of applying a page's theme before its first
 * paint.
 *
 * The status page API's /seo answers the page's theme - Light, Dark or System,
 * read the way the app reads it (Common/Tests/Server/API/
 * StatusPageThemeRoutes.test.ts). The two servers that render the page - the
 * standalone status-page container and the combined App container - read it
 * there and hand index.ejs what getStatusPageThemeHead works out for it, which
 * the template draws before any script or stylesheet runs (Common/Tests/App/
 * StatusPage/StatusPageIndexTheme.test.ts). Anything that is not an answer -
 * a page that does not exist, a lookup that failed, a URL that names no page
 * - is sent as the light page, the one every status page starts from; the app
 * applies the page's own theme once it has loaded.
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

import DashboardDomainService from "Common/Server/Services/DashboardDomainService";
import { ExpressRequest } from "Common/Server/Utils/Express";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import StatusPageTheme, {
  STATUS_PAGE_THEME_FALLBACK,
  STATUS_PAGE_THEME_VIEW_VARIABLE,
  getStatusPageThemeHead,
} from "Common/Types/StatusPage/StatusPageTheme";
import { getStatusPageData as getFrontendStatusPageData } from "../../FeatureSet/Frontend/Utils/StatusPage";
import { getStatusPageData as getStandaloneStatusPageData } from "../../FeatureSet/StatusPage/src/Server/Utils/StatusPage";
import {
  FakeResponse,
  PageRenderer,
  PageServers,
  SpiedApi,
  answerSeo,
  loadPageServers,
  pageRequest,
  spyOnApi,
} from "./PageServerHarness";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

const PAGE_ID: string = "5c000000-0000-4000-8000-000000000001";
const MISSING_PAGE_ID: string = "5c000000-0000-4000-8000-000000000002";
const DOMAIN: string = "status.acme.example";

const seoAnswer: (theme: unknown) => HTTPResponse<JSONObject> = (
  theme: unknown,
): HTTPResponse<JSONObject> => {
  const body: JSONObject = {
    _id: PAGE_ID,
    title: "Acme Status",
    description: "How Acme is doing.",
    enableSearchEngineIndexing: true,
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

const onPreviewUrl: (statusPageId: string) => ExpressRequest = (
  statusPageId: string,
): ExpressRequest => {
  return pageRequest({
    host: "oneuptime.example",
    path: `/status-page/${statusPageId}/incidents`,
  });
};

beforeEach(() => {
  apiGet = spyOnApi("get");
  answerSeo(apiGet, {
    [PAGE_ID]: seoAnswer(StatusPageTheme.Dark),
    [DOMAIN]: seoAnswer(StatusPageTheme.Dark),
    [MISSING_PAGE_ID]: new HTTPErrorResponse(
      404,
      { message: "Status Page not found" },
      {},
    ),
  });

  // A custom domain here is a status page's, not a public dashboard's.
  jest.spyOn(DashboardDomainService, "findOneBy").mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

type GetStatusPageData = typeof getFrontendStatusPageData;

const IMPLEMENTATIONS: Array<[string, GetStatusPageData]> = [
  ["standalone status-page container", getStandaloneStatusPageData],
  ["combined App container", getFrontendStatusPageData],
];

describe.each(IMPLEMENTATIONS)(
  "getStatusPageData (%s) reads the page's theme",
  (_name: string, getStatusPageData: GetStatusPageData) => {
    it.each([
      [StatusPageTheme.Light, StatusPageTheme.Light],
      [StatusPageTheme.Dark, StatusPageTheme.Dark],
      [StatusPageTheme.System, StatusPageTheme.System],
      // An older API that does not send one, and values no reader knows.
      [undefined, StatusPageTheme.Light],
      [null, StatusPageTheme.Light],
      ["dark", StatusPageTheme.Light],
      ["Sepia", StatusPageTheme.Light],
    ])(
      "/seo answering %p: %s",
      async (answered: unknown, read: StatusPageTheme) => {
        answerSeo(apiGet, {
          [DOMAIN]: seoAnswer(answered),
          [PAGE_ID]: seoAnswer(answered),
        });

        await expect(getStatusPageData(onCustomDomain())).resolves.toMatchObject(
          { theme: read },
        );
        await expect(
          getStatusPageData(onPreviewUrl(PAGE_ID)),
        ).resolves.toMatchObject({ theme: read });
      },
    );

    it("a preview URL whose lookup failed renders from its id, as the light page", async () => {
      answerSeo(apiGet, {
        [PAGE_ID]: new HTTPErrorResponse(500, {}, {}),
      });

      await expect(
        getStatusPageData(onPreviewUrl(PAGE_ID)),
      ).resolves.toMatchObject({ id: PAGE_ID, theme: StatusPageTheme.Light });
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
      return servers.combined.statusPage;
    },
    () => {
      return servers.combined.customDomain;
    },
  ],
  [
    "standalone status-page container",
    () => {
      return servers.standalone.statusPage;
    },
    () => {
      return servers.standalone.statusPage;
    },
  ],
];

const themeHeadOf: (res: FakeResponse) => unknown = (
  res: FakeResponse,
): unknown => {
  return res.rendered?.variables[STATUS_PAGE_THEME_VIEW_VARIABLE];
};

describe.each(SHELLS)(
  "the status page shell in the %s",
  (
    _name: string,
    previewShell: () => PageRenderer,
    customDomainShell: () => PageRenderer,
  ) => {
    it.each([
      StatusPageTheme.Light,
      StatusPageTheme.Dark,
      StatusPageTheme.System,
    ])(
      "hands the template the head of a %s page, on its custom domain and its own URL",
      async (theme: StatusPageTheme) => {
        answerSeo(apiGet, {
          [DOMAIN]: seoAnswer(theme),
          [PAGE_ID]: seoAnswer(theme),
        });

        const onDomain: FakeResponse =
          await customDomainShell()(onCustomDomain());
        const onPreview: FakeResponse = await previewShell()(
          onPreviewUrl(PAGE_ID),
        );

        expect(onDomain.statusCode).toBe(200);
        expect(themeHeadOf(onDomain)).toEqual(getStatusPageThemeHead(theme));
        expect(themeHeadOf(onPreview)).toEqual(getStatusPageThemeHead(theme));
      },
    );

    it("sends a page that does not exist as the light page", async () => {
      const res: FakeResponse = await previewShell()(
        onPreviewUrl(MISSING_PAGE_ID),
      );

      expect(res.statusCode).toBe(404);
      expect(themeHeadOf(res)).toEqual(
        getStatusPageThemeHead(STATUS_PAGE_THEME_FALLBACK),
      );
    });

    it("sends a custom domain whose lookup failed as the light page", async () => {
      answerSeo(apiGet, { [DOMAIN]: new HTTPErrorResponse(500, {}, {}) });

      const res: FakeResponse = await customDomainShell()(onCustomDomain());

      expect(themeHeadOf(res)).toEqual(
        getStatusPageThemeHead(StatusPageTheme.Light),
      );
    });
  },
);
