/**
 * The public dashboard servers' half of taking a blocked project's pages
 * down.
 *
 * Every public route of the dashboard API answers a dashboard of a project a
 * master admin blocked as it answers a dashboard that does not exist (see
 * Common/Tests/Server/API/BlockedProjectPublicRoutes.test.ts); its /seo
 * answers 404. The servers that render a public dashboard - the standalone
 * public-dashboard container and the combined App container - must then
 * answer as not found too, on a custom domain and on the dashboard's own
 * /public-dashboard/<id> URL alike: the page shell and its llms.txt answer
 * 404 with X-Robots-Tag: noindex. They used to look nothing up for the
 * dashboard's own URL at all, so they now ask /seo there too. A lookup that
 * FAILS is not that answer: they keep serving what they served before.
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
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { PUBLIC_PAGE_NOT_FOUND } from "Common/Server/Utils/PublicPageNotFound";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  getPublicDashboardData as getFrontendPublicDashboardData,
  handlePublicDashboardLlmsTxt as handleFrontendLlmsTxt,
} from "../../FeatureSet/Frontend/Utils/PublicDashboard";
import { handleLlmsTxt as handleStandaloneLlmsTxt } from "../../FeatureSet/PublicDashboard/src/Server/API/LlmsTxt";
import { getPublicDashboardData as getStandalonePublicDashboardData } from "../../FeatureSet/PublicDashboard/src/Server/Utils/PublicDashboard";
import {
  FakeResponse,
  PageRenderer,
  PageServers,
  SeoAnswers,
  SpiedApi,
  answerSeo,
  fakeResponse,
  loadPageServers,
  pageRequest,
  seoLookups,
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

const BLOCKED_DASHBOARD_ID: string = "da000000-0000-4000-8000-0000000000b1";
const LIVE_DASHBOARD_ID: string = "da000000-0000-4000-8000-0000000000a1";
const BLOCKED_DOMAIN: string = "metrics.pirated-films.example";
const LIVE_DOMAIN: string = "metrics.acme.example";

const LIVE_TITLE: string = "Acme Metrics";
const LIVE_DESCRIPTION: string = "How Acme is doing.";

const NOINDEX: string = "noindex, nofollow";

const LIVE_SEO: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
  200,
  {
    _id: LIVE_DASHBOARD_ID,
    title: LIVE_TITLE,
    description: LIVE_DESCRIPTION,
  },
  {},
);

// The API's answer for a dashboard of a blocked project: as for no dashboard.
const NOT_FOUND: HTTPErrorResponse = new HTTPErrorResponse(
  404,
  { message: "Dashboard not found" },
  {},
);

const DEFAULT_SEO_ANSWERS: SeoAnswers = {
  [BLOCKED_DASHBOARD_ID]: NOT_FOUND,
  [BLOCKED_DOMAIN]: NOT_FOUND,
  [LIVE_DASHBOARD_ID]: LIVE_SEO,
  [LIVE_DOMAIN]: LIVE_SEO,
};

let apiGet: SpiedApi;

function onCustomDomain(domain: string, path: string = "/"): ExpressRequest {
  return pageRequest({ host: domain, path });
}

function onDashboardUrl(
  dashboardId: string,
  path: string = "",
): ExpressRequest {
  return pageRequest({
    host: "oneuptime.example",
    path: `/public-dashboard/${dashboardId}${path}`,
  });
}

beforeEach(() => {
  apiGet = spyOnApi("get");
  answerSeo(apiGet, DEFAULT_SEO_ANSWERS);

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
  "getPublicDashboardData (%s)",
  (_name: string, getPublicDashboardData: GetPublicDashboardData) => {
    it("answers not found for a dashboard the API does not know, on its custom domain", async () => {
      await expect(
        getPublicDashboardData(onCustomDomain(BLOCKED_DOMAIN)),
      ).resolves.toBe(PUBLIC_PAGE_NOT_FOUND);
    });

    it("asks the API about the dashboard's own URL too, and answers not found there", async () => {
      await expect(
        getPublicDashboardData(onDashboardUrl(BLOCKED_DASHBOARD_ID)),
      ).resolves.toBe(PUBLIC_PAGE_NOT_FOUND);

      expect(seoLookups(apiGet)).toEqual([BLOCKED_DASHBOARD_ID]);
    });

    it("finds a dashboard the API knows, with its title and description, by domain and by URL", async () => {
      for (const req of [
        onCustomDomain(LIVE_DOMAIN),
        onDashboardUrl(LIVE_DASHBOARD_ID),
      ]) {
        await expect(getPublicDashboardData(req)).resolves.toEqual({
          id: LIVE_DASHBOARD_ID,
          title: LIVE_TITLE,
          description: LIVE_DESCRIPTION,
        });
      }
    });

    it.each([
      ["a server error", 500],
      ["rate limiting", 429],
      ["an IP allowlist refusal", 403],
    ])(
      "does not read %s as not found: the dashboard's own URL still renders from its id, as before",
      async (_label: string, statusCode: number) => {
        answerSeo(apiGet, {
          [LIVE_DASHBOARD_ID]: new HTTPErrorResponse(statusCode, {}, {}),
        });

        await expect(
          getPublicDashboardData(onDashboardUrl(LIVE_DASHBOARD_ID)),
        ).resolves.toEqual({
          id: LIVE_DASHBOARD_ID,
          title: "Dashboard",
          description: "View dashboard metrics and insights.",
        });
      },
    );

    it("does not read a failed lookup on a custom domain as not found either", async () => {
      answerSeo(apiGet, { [LIVE_DOMAIN]: new HTTPErrorResponse(500, {}, {}) });

      await expect(
        getPublicDashboardData(onCustomDomain(LIVE_DOMAIN)),
      ).resolves.toBeNull();
    });

    it("returns nothing when the lookup throws outright", async () => {
      apiGet.mockImplementation(async () => {
        throw new Error("ECONNREFUSED");
      });

      await expect(
        getPublicDashboardData(onDashboardUrl(LIVE_DASHBOARD_ID)),
      ).resolves.toBeNull();
    });
  },
);

type Handler = (req: ExpressRequest, res: ExpressResponse) => Promise<void>;

const LLMS_TXT: Array<[string, Handler]> = [
  ["llms.txt (standalone public-dashboard container)", handleStandaloneLlmsTxt],
  ["llms.txt (combined App container)", handleFrontendLlmsTxt],
];

describe.each(LLMS_TXT)("%s", (_name: string, handler: Handler) => {
  it.each([
    ["on its custom domain", onCustomDomain(BLOCKED_DOMAIN, "/llms.txt")],
    ["on its own URL", onDashboardUrl(BLOCKED_DASHBOARD_ID, "/llms.txt")],
  ])(
    "answers a dashboard the API does not know with 404, noindex, %s",
    async (_label: string, req: ExpressRequest) => {
      const res: FakeResponse = fakeResponse();

      await handler(req, res as unknown as ExpressResponse);

      expect(res.statusCode).toBe(404);
      expect(res.headers["x-robots-tag"]).toBe(NOINDEX);
      expect(res.body).toBe("Dashboard not found");
    },
  );

  it("answers an id no dashboard has with 404 on its own URL, where it used to answer any id", async () => {
    const missingId: string = ObjectID.generate().toString();
    answerSeo(apiGet, { [missingId]: NOT_FOUND });

    const res: FakeResponse = fakeResponse();

    await handler(
      onDashboardUrl(missingId, "/llms.txt"),
      res as unknown as ExpressResponse,
    );

    expect(res.statusCode).toBe(404);
    expect(res.headers["x-robots-tag"]).toBe(NOINDEX);
  });

  it("still serves a dashboard the API knows, with its title", async () => {
    const res: FakeResponse = fakeResponse();

    await handler(
      onDashboardUrl(LIVE_DASHBOARD_ID, "/llms.txt"),
      res as unknown as ExpressResponse,
    );

    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toContain(`# ${LIVE_TITLE}`);
    expect(res.headers["x-robots-tag"]).toBeUndefined();
  });
});

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

function expectNotFoundShell(res: FakeResponse): void {
  expect(res.statusCode).toBe(404);
  expect(res.headers["x-robots-tag"]).toBe(NOINDEX);
  expect(res.rendered?.variables).toMatchObject({
    // The app still loads and says so, from the placeholder.
    title: "Dashboard",
    description: "View dashboard metrics and insights.",
    isSearchEngineIndexingEnabled: false,
  });
}

describe.each(SHELLS)(
  "the public dashboard shell in the %s",
  (
    _name: string,
    dashboardUrlShell: () => PageRenderer,
    customDomainShell: () => PageRenderer,
  ) => {
    it("answers a dashboard the API does not know on its own URL with 404, noindex", async () => {
      expectNotFoundShell(
        await dashboardUrlShell()(onDashboardUrl(BLOCKED_DASHBOARD_ID)),
      );
    });

    it("answers its custom domain the same way", async () => {
      expectNotFoundShell(
        await customDomainShell()(onCustomDomain(BLOCKED_DOMAIN)),
      );
    });

    it("renders a dashboard the API knows: 200, its title and description, no robots tag", async () => {
      for (const res of [
        await dashboardUrlShell()(onDashboardUrl(LIVE_DASHBOARD_ID)),
        await customDomainShell()(onCustomDomain(LIVE_DOMAIN)),
      ]) {
        expect(res.statusCode).toBe(200);
        expect(res.headers["x-robots-tag"]).toBeUndefined();
        expect(res.rendered?.variables).toMatchObject({
          title: LIVE_TITLE,
          description: LIVE_DESCRIPTION,
        });
        expect(
          res.rendered?.variables["isSearchEngineIndexingEnabled"],
        ).toBeUndefined();
      }
    });

    it("keeps serving the placeholder when the lookup fails: a failure is not 'not found'", async () => {
      answerSeo(apiGet, {
        [LIVE_DASHBOARD_ID]: new HTTPErrorResponse(500, {}, {}),
        [LIVE_DOMAIN]: new HTTPErrorResponse(500, {}, {}),
      });

      for (const res of [
        await dashboardUrlShell()(onDashboardUrl(LIVE_DASHBOARD_ID)),
        await customDomainShell()(onCustomDomain(LIVE_DOMAIN)),
      ]) {
        expect(res.statusCode).toBe(200);
        expect(res.headers["x-robots-tag"]).toBeUndefined();
        expect(res.rendered?.variables["title"]).toBe("Dashboard");
      }
    });
  },
);
