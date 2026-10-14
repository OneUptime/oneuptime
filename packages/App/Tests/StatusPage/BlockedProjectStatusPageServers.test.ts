/**
 * The status page servers' half of taking a blocked project's pages down.
 *
 * The status page API answers every request for a page of a project a master
 * admin blocked as it answers a page that does not exist: 404 (see
 * Common/Tests/Server/API/BlockedProjectPublicRoutes.test.ts). The two servers
 * that render a status page - the standalone status-page container and the
 * combined App container - learn that from the API's /seo, and must then
 * answer as not found too, on a custom domain and on the page's own
 * /status-page/<id> URL alike: the page shell, its RSS feed and its llms.txt
 * all answer 404 with X-Robots-Tag: noindex, so search engines drop what the
 * spam pages put there. A lookup that FAILS is not that answer: the page may
 * well exist, and each server keeps serving what it served before.
 *
 * Everything runs against both servers, the page shells through their real
 * renderers (PageServerHarness).
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
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { PUBLIC_PAGE_NOT_FOUND } from "Common/Server/Utils/PublicPageNotFound";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { DEFAULT_STATUS_PAGE_LANGUAGE } from "Common/Types/StatusPage/StatusPageLanguage";
import {
  getStatusPageData as getFrontendStatusPageData,
  handleLlmsTxt as handleFrontendLlmsTxt,
  handleRSS as handleFrontendRSS,
} from "../../FeatureSet/Frontend/Utils/StatusPage";
import { handleLlmsTxt as handleStandaloneLlmsTxt } from "../../FeatureSet/StatusPage/src/Server/API/LlmsTxt";
import { handleRSS as handleStandaloneRSS } from "../../FeatureSet/StatusPage/src/Server/API/RSS";
import { getStatusPageData as getStandaloneStatusPageData } from "../../FeatureSet/StatusPage/src/Server/Utils/StatusPage";
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
} from "./PageServerHarness";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";

const BLOCKED_PAGE_ID: string = "5b000000-0000-4000-8000-000000000001";
const LIVE_PAGE_ID: string = "5b000000-0000-4000-8000-000000000002";
const BLOCKED_DOMAIN: string = "status.pirated-films.example";
const LIVE_DOMAIN: string = "status.acme.example";

const LIVE_TITLE: string = "Acme Status";

const NOINDEX: string = "noindex, nofollow";
const ZERO_FAVICON: string = `/status-page-api/favicon/${ObjectID.getZeroObjectID().toString()}`;

const LIVE_SEO: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
  200,
  {
    _id: LIVE_PAGE_ID,
    title: LIVE_TITLE,
    description: "How Acme is doing.",
    enableSearchEngineIndexing: true,
  },
  {},
);

// The API's answer for a page of a blocked project: not found, like no page.
const NOT_FOUND: HTTPErrorResponse = new HTTPErrorResponse(
  404,
  { message: "Status Page not found" },
  {},
);

const DEFAULT_SEO_ANSWERS: SeoAnswers = {
  [BLOCKED_PAGE_ID]: NOT_FOUND,
  [BLOCKED_DOMAIN]: NOT_FOUND,
  [LIVE_PAGE_ID]: LIVE_SEO,
  [LIVE_DOMAIN]: LIVE_SEO,
};

let apiGet: SpiedApi;
let apiPost: SpiedApi;

function onCustomDomain(domain: string, path: string = "/"): ExpressRequest {
  return pageRequest({ host: domain, path });
}

function onPreviewUrl(statusPageId: string, path: string = ""): ExpressRequest {
  return pageRequest({
    host: "oneuptime.example",
    path: `/status-page/${statusPageId}${path}`,
  });
}

beforeEach(() => {
  apiGet = spyOnApi("get");
  answerSeo(apiGet, DEFAULT_SEO_ANSWERS);

  // The RSS feed's items.
  apiPost = spyOnApi("post");
  apiPost.mockImplementation(async () => {
    return new HTTPResponse<JSONObject>(200, {}, {});
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
  "getStatusPageData (%s)",
  (_name: string, getStatusPageData: GetStatusPageData) => {
    it("answers not found for a page the API does not know, on its custom domain", async () => {
      await expect(
        getStatusPageData(onCustomDomain(BLOCKED_DOMAIN)),
      ).resolves.toBe(PUBLIC_PAGE_NOT_FOUND);

      expect(seoLookups(apiGet)).toEqual([BLOCKED_DOMAIN]);
    });

    it("answers not found on the page's own URL, where its id alone could render it", async () => {
      await expect(
        getStatusPageData(onPreviewUrl(BLOCKED_PAGE_ID)),
      ).resolves.toBe(PUBLIC_PAGE_NOT_FOUND);

      expect(seoLookups(apiGet)).toEqual([BLOCKED_PAGE_ID]);
    });

    it("answers not found on every page under that URL too", async () => {
      await expect(
        getStatusPageData(
          onPreviewUrl(BLOCKED_PAGE_ID, `/incidents/${LIVE_PAGE_ID}`),
        ),
      ).resolves.toBe(PUBLIC_PAGE_NOT_FOUND);
    });

    it("finds a page the API knows, as before", async () => {
      await expect(
        getStatusPageData(onCustomDomain(LIVE_DOMAIN)),
      ).resolves.toMatchObject({ id: LIVE_PAGE_ID, title: LIVE_TITLE });

      await expect(
        getStatusPageData(onPreviewUrl(LIVE_PAGE_ID)),
      ).resolves.toMatchObject({ id: LIVE_PAGE_ID, title: LIVE_TITLE });
    });

    it.each([
      ["a server error", 500],
      ["a bad gateway", 502],
      ["rate limiting", 429],
      ["an authentication error", 401],
    ])(
      "does not read %s as not found: the page's own URL still renders from its id",
      async (_label: string, statusCode: number) => {
        answerSeo(apiGet, {
          [BLOCKED_PAGE_ID]: new HTTPErrorResponse(statusCode, {}, {}),
        });

        await expect(
          getStatusPageData(onPreviewUrl(BLOCKED_PAGE_ID)),
        ).resolves.toMatchObject({
          id: BLOCKED_PAGE_ID,
          title: "Status Page",
        });
      },
    );

    it("does not read a failed lookup on a custom domain as not found either", async () => {
      answerSeo(apiGet, { [LIVE_DOMAIN]: new HTTPErrorResponse(500, {}, {}) });

      await expect(
        getStatusPageData(onCustomDomain(LIVE_DOMAIN)),
      ).resolves.toBeNull();
    });
  },
);

type Handler = (req: ExpressRequest, res: ExpressResponse) => Promise<void>;

const NON_HTML_RESPONSES: Array<[string, Handler]> = [
  ["llms.txt (standalone status-page container)", handleStandaloneLlmsTxt],
  ["llms.txt (combined App container)", handleFrontendLlmsTxt],
  ["RSS feed (standalone status-page container)", handleStandaloneRSS],
  ["RSS feed (combined App container)", handleFrontendRSS],
];

describe.each(NON_HTML_RESPONSES)("%s", (_name: string, handler: Handler) => {
  it.each([
    ["on its custom domain", onCustomDomain(BLOCKED_DOMAIN, "/rss")],
    ["on its own URL", onPreviewUrl(BLOCKED_PAGE_ID, "/rss")],
  ])(
    "answers a page the API does not know with 404, noindex, %s",
    async (_label: string, req: ExpressRequest) => {
      const res: FakeResponse = fakeResponse();

      await handler(req, res as unknown as ExpressResponse);

      expect(res.statusCode).toBe(404);
      expect(res.headers["x-robots-tag"]).toBe(NOINDEX);
      expect(res.body).toBe("Status page not found");

      // Nothing of the page is fetched, let alone listed.
      expect(apiPost.mock.calls).toHaveLength(0);
    },
  );

  it("still serves a page the API knows", async () => {
    const res: FakeResponse = fakeResponse();

    await handler(
      onCustomDomain(LIVE_DOMAIN, "/rss"),
      res as unknown as ExpressResponse,
    );

    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toContain(LIVE_TITLE);
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

function expectNotFoundShell(res: FakeResponse): void {
  expect(res.statusCode).toBe(404);
  expect(res.headers["x-robots-tag"]).toBe(NOINDEX);

  // The app still loads and says so; the document carries nothing of the page.
  expect(res.rendered?.variables).toMatchObject({
    title: "Status Page",
    faviconUrl: ZERO_FAVICON,
    isSearchEngineIndexingEnabled: false,
  });
}

describe.each(SHELLS)(
  "the status page shell in the %s",
  (
    _name: string,
    previewShell: () => PageRenderer,
    customDomainShell: () => PageRenderer,
  ) => {
    it("answers a page the API does not know on its own URL with 404, noindex", async () => {
      expectNotFoundShell(await previewShell()(onPreviewUrl(BLOCKED_PAGE_ID)));
    });

    it("answers a page under that URL the same way", async () => {
      expectNotFoundShell(
        await previewShell()(
          onPreviewUrl(BLOCKED_PAGE_ID, `/announcements/${LIVE_PAGE_ID}`),
        ),
      );
    });

    it("answers the page's custom domain the same way", async () => {
      expectNotFoundShell(
        await customDomainShell()(onCustomDomain(BLOCKED_DOMAIN)),
      );
    });

    it("renders a page the API knows as before: 200, its title, indexable on its custom domain", async () => {
      const res: FakeResponse = await customDomainShell()(
        onCustomDomain(LIVE_DOMAIN),
      );

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-robots-tag"]).toBeUndefined();
      expect(res.rendered?.variables).toMatchObject({
        title: LIVE_TITLE,
        isSearchEngineIndexingEnabled: true,
      });
    });

    it("renders it on its own URL as before: 200, its title, and never indexed there", async () => {
      const res: FakeResponse = await previewShell()(
        onPreviewUrl(LIVE_PAGE_ID),
      );

      expect(res.statusCode).toBe(200);
      expect(res.headers["x-robots-tag"]).toBe(NOINDEX);
      expect(res.rendered?.variables["title"]).toBe(LIVE_TITLE);
    });

    it("keeps serving the placeholder when the lookup fails, as before: a failure is not 'not found'", async () => {
      answerSeo(apiGet, {
        [LIVE_PAGE_ID]: new HTTPErrorResponse(500, {}, {}),
        [LIVE_DOMAIN]: new HTTPErrorResponse(500, {}, {}),
      });

      const onItsUrl: FakeResponse = await previewShell()(
        onPreviewUrl(LIVE_PAGE_ID),
      );
      expect(onItsUrl.statusCode).toBe(200);
      expect(onItsUrl.rendered?.variables["title"]).toBe("Status Page");

      const onItsDomain: FakeResponse = await customDomainShell()(
        onCustomDomain(LIVE_DOMAIN),
      );
      expect(onItsDomain.statusCode).toBe(200);
      // A custom domain fails open, whenever the owner's setting cannot be read.
      expect(onItsDomain.headers["x-robots-tag"]).toBeUndefined();
    });
  },
);

describe("the standalone status-page container's shell", () => {
  it("keeps the default language for a page that does not exist", async () => {
    const res: FakeResponse = await servers.standalone.statusPage(
      onPreviewUrl(BLOCKED_PAGE_ID),
    );

    expect(res.rendered?.variables["lang"]).toBe(DEFAULT_STATUS_PAGE_LANGUAGE);
  });
});
