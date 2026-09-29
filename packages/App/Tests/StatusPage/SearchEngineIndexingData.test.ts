/**
 * getStatusPageData is where a status page's indexing preference is turned
 * from a field on an internal HTTP response into the boolean the renderers
 * act on. There are two copies of it - one in the standalone status-page
 * container, one in the combined App container - and a status page served by
 * one must not behave differently from the same page served by the other, so
 * every case below runs against both.
 *
 * The cases that matter most are the unhappy ones. The flag reaches these
 * functions over a network call to the status page API; when that call fails
 * the page still has to render, and it has to render indexable, because the
 * alternative is dropping pages out of search results over a transient blip
 * that nobody would ever see in a log.
 */

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { ExpressRequest } from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import { getStatusPageData as getFrontendStatusPageData } from "../../FeatureSet/Frontend/Utils/StatusPage";
import { getStatusPageData as getStandaloneStatusPageData } from "../../FeatureSet/StatusPage/src/Server/Utils/StatusPage";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const STATUS_PAGE_ID: string = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

type GetStatusPageData = (req: ExpressRequest) => Promise<{
  id: string;
  title: string;
  description: string;
  isSearchEngineIndexingEnabled: boolean;
} | null>;

/*
 * The two servers are the same function twice over. Naming them here means a
 * case added below is automatically run against both - which is the only way
 * this stays true as the copies are edited.
 */
const IMPLEMENTATIONS: Array<[string, GetStatusPageData]> = [
  ["standalone status-page container", getStandaloneStatusPageData],
  ["combined App container", getFrontendStatusPageData],
];

function customDomainRequest(host: string = "status.acme.com"): ExpressRequest {
  return {
    path: "/",
    hostname: host,
    headers: { host },
  } as unknown as ExpressRequest;
}

function previewRequest(statusPageId: string = STATUS_PAGE_ID): ExpressRequest {
  return {
    path: `/status-page/${statusPageId}`,
    hostname: "oneuptime.com",
    headers: { host: "oneuptime.com" },
  } as unknown as ExpressRequest;
}

function seoResponse(body: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, body, {});
}

/*
 * API.get is generic over half a dozen response shapes, and neither jest
 * typing dialect in this repo can express a spy on it without a cast. This is
 * the narrow surface the tests below actually use.
 */
type SpiedApiGet = {
  mockResolvedValue: (value: unknown) => void;
  mockRejectedValue: (value: unknown) => void;
  mock: { calls: Array<Array<{ url: unknown }>> };
};

function spyOnApiGet(): SpiedApiGet {
  return jest.spyOn(API, "get") as unknown as SpiedApiGet;
}

function mockSeoApi(
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): SpiedApiGet {
  const get: SpiedApiGet = spyOnApiGet();
  get.mockResolvedValue(response);
  return get;
}

describe.each(IMPLEMENTATIONS)(
  "getStatusPageData (%s)",
  (_name: string, getStatusPageData: GetStatusPageData) => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("a status page on a custom domain", () => {
      it("is indexable when the owner left the toggle on", async () => {
        mockSeoApi(
          seoResponse({
            _id: STATUS_PAGE_ID,
            title: "Acme Status",
            description: "How Acme is doing.",
            enableSearchEngineIndexing: true,
          }),
        );

        await expect(
          getStatusPageData(customDomainRequest()),
        ).resolves.toMatchObject({
          id: STATUS_PAGE_ID,
          isSearchEngineIndexingEnabled: true,
        });
      });

      it("is not indexable when the owner turned the toggle off", async () => {
        mockSeoApi(
          seoResponse({
            _id: STATUS_PAGE_ID,
            title: "Acme Status",
            enableSearchEngineIndexing: false,
          }),
        );

        await expect(
          getStatusPageData(customDomainRequest()),
        ).resolves.toMatchObject({
          isSearchEngineIndexingEnabled: false,
        });
      });

      it("is indexable when talking to an API that does not send the flag", async () => {
        /*
         * A rolling deploy runs a new frontend against an older API for a few
         * minutes. During that window every page must keep the behaviour it
         * had before this feature existed.
         */
        mockSeoApi(
          seoResponse({
            _id: STATUS_PAGE_ID,
            title: "Acme Status",
          }),
        );

        await expect(
          getStatusPageData(customDomainRequest()),
        ).resolves.toMatchObject({
          isSearchEngineIndexingEnabled: true,
        });
      });

      it("still cannot be resolved at all when the API errors", async () => {
        /*
         * Unchanged from before this feature: with no id there is no page to
         * render, so the caller falls back to the generic placeholder.
         */
        mockSeoApi(new HTTPErrorResponse(500, {}, {}));

        await expect(
          getStatusPageData(customDomainRequest()),
        ).resolves.toBeNull();
      });
    });

    describe("a status page on its preview URL", () => {
      /*
       * The preview URL (/status-page/:id) is the only URL a status page has
       * until someone attaches a custom domain, so it is the URL most
       * OneUptime status pages are actually crawled at. An opt-out that only
       * worked on custom domains would do nothing for most of the people who
       * asked for it.
       */
      it("looks the page up by id so the toggle applies here too", async () => {
        const get: SpiedApiGet = mockSeoApi(
          seoResponse({
            _id: STATUS_PAGE_ID,
            title: "Acme Status",
            enableSearchEngineIndexing: false,
          }),
        );

        await expect(
          getStatusPageData(previewRequest()),
        ).resolves.toMatchObject({
          id: STATUS_PAGE_ID,
          isSearchEngineIndexingEnabled: false,
        });

        expect(get.mock.calls).toHaveLength(1);
        expect(String(get.mock.calls[0]![0]!.url)).toContain(
          `/seo/${STATUS_PAGE_ID}`,
        );
      });

      it("is indexable when the owner left the toggle on", async () => {
        mockSeoApi(
          seoResponse({
            _id: STATUS_PAGE_ID,
            title: "Acme Status",
            enableSearchEngineIndexing: true,
          }),
        );

        await expect(
          getStatusPageData(previewRequest()),
        ).resolves.toMatchObject({
          isSearchEngineIndexingEnabled: true,
        });
      });

      it("still renders, indexable, when the lookup fails", async () => {
        /*
         * The id came from the URL, so the page can be served without the
         * lookup. Returning null here instead would take preview pages down
         * whenever the SEO lookup hiccuped - a much worse outcome than a
         * page rendering with its default title for one request.
         */
        mockSeoApi(new HTTPErrorResponse(500, {}, {}));

        await expect(
          getStatusPageData(previewRequest()),
        ).resolves.toMatchObject({
          id: STATUS_PAGE_ID,
          title: "Status Page",
          isSearchEngineIndexingEnabled: true,
        });
      });

      it("renders indexable when the API throws outright", async () => {
        spyOnApiGet().mockRejectedValue(new Error("ECONNREFUSED"));

        /*
         * getStatusPageData swallows throws and returns null, so the caller
         * renders its own placeholder - which carries no noindex. Pinned so a
         * future refactor cannot quietly turn a thrown error into a de-index.
         */
        await expect(getStatusPageData(previewRequest())).resolves.toBeNull();
      });
    });

    it("returns nothing when there is no host and no id to work with", async () => {
      const get: SpiedApiGet = mockSeoApi(seoResponse({ _id: STATUS_PAGE_ID }));

      const req: ExpressRequest = {
        path: "/",
        headers: {},
      } as unknown as ExpressRequest;

      await expect(getStatusPageData(req)).resolves.toBeNull();
      expect(get.mock.calls).toHaveLength(0);
    });
  },
);
