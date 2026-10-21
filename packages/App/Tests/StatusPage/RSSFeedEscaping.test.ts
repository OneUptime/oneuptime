/**
 * What the status page RSS feed writes into its XML, on the wire.
 *
 * The feed is built by string interpolation, so every value in it has to be
 * escaped. A page titled "R&D Status" made the whole feed unparseable, and so
 * did an incident title containing "]]>", which ended the CDATA section the
 * titles used to be wrapped in.
 *
 * XML.escape itself is round-tripped through a real XML parser in
 * Common/Tests/Types/XML.test.ts. This file checks that the handlers put
 * every value through it. Both server implementations are covered: the
 * standalone status-page container and the combined App container each ship
 * their own copy of the handler.
 */

import HTTPResponse from "Common/Types/API/HTTPResponse";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import API, { APIRequestOptions } from "Common/Utils/API";
import { handleRSS as handleFrontendRSS } from "../../FeatureSet/Frontend/Utils/StatusPage";
import { handleRSS as handleStandaloneRSS } from "../../FeatureSet/StatusPage/src/Server/API/RSS";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

const STATUS_PAGE_ID: string = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/*
 * Every character XML.escape rewrites (& < > " '), the "]]>" that ends a
 * CDATA section, and an ANSI colour code, whose ESC character XML cannot
 * carry at all.
 */
const HOSTILE: string = `R&D <"core"> isn't ]]> \u001b[31mdown\u001b[0m`;
const HOSTILE_ESCAPED: string =
  "R&amp;D &lt;&quot;core&quot;&gt; isn&apos;t ]]&gt; [31mdown[0m";

/* An "&" that does not open one of the five entities XML.escape writes. */
const UNESCAPED_AMPERSAND: RegExp = /&(?!(?:amp|lt|gt|quot|apos);)/;

type Handler = (req: ExpressRequest, res: ExpressResponse) => Promise<void>;

type SpiedApi = {
  mockResolvedValue: (value: unknown) => void;
  mockImplementation: (
    implementation: (options: APIRequestOptions) => Promise<unknown>,
  ) => void;
};

type FakeResponse = {
  set: ReturnType<typeof jest.fn>;
  send: ReturnType<typeof jest.fn>;
  status: ReturnType<typeof jest.fn>;
};

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    set: jest.fn(),
    send: jest.fn(),
    status: jest.fn(),
  };

  (
    res.status as unknown as { mockReturnValue: (value: unknown) => void }
  ).mockReturnValue(res);

  return res;
}

function feedRequest(path: string): ExpressRequest {
  return {
    path,
    hostname: "status.acme.com",
    protocol: "https",
    headers: { host: "status.acme.com" },
    get: () => {
      return "status.acme.com";
    },
  } as unknown as ExpressRequest;
}

function feedItem(id: string, title: string): JSONObject {
  return {
    _id: id,
    title: `${title} ${HOSTILE}`,
    description: `${title} details ${HOSTILE}`,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

/*
 * A page, and one incident, announcement and scheduled maintenance event,
 * with HOSTILE in every title and description.
 */
function mockHostileStatusPage(): void {
  (jest.spyOn(API, "get") as unknown as SpiedApi).mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        _id: STATUS_PAGE_ID,
        title: `Page ${HOSTILE}`,
        description: `About ${HOSTILE}`,
        enableSearchEngineIndexing: true,
      },
      {},
    ),
  );

  (jest.spyOn(API, "post") as unknown as SpiedApi).mockImplementation(
    async (options: APIRequestOptions): Promise<unknown> => {
      const url: string = options.url.toString();

      if (url.includes("/incidents/")) {
        return new HTTPResponse<JSONObject>(
          200,
          { incidents: [feedItem("incident-1", "Outage")] },
          {},
        );
      }

      if (url.includes("/announcements/")) {
        return new HTTPResponse<JSONObject>(
          200,
          { announcements: [feedItem("announcement-1", "News")] },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(
        200,
        { scheduledMaintenanceEvents: [feedItem("event-1", "Upgrade")] },
        {},
      );
    },
  );
}

async function renderFeed(handler: Handler, path: string): Promise<string> {
  const res: FakeResponse = fakeResponse();

  await handler(feedRequest(path), res as unknown as ExpressResponse);

  expect(res.status).not.toHaveBeenCalled();
  expect(res.send).toHaveBeenCalledTimes(1);

  const feed: string = (
    res.send as unknown as { mock: { calls: Array<Array<string>> } }
  ).mock.calls[0]![0]!;

  // Nothing got into the feed unescaped, wherever it was written.
  expect(feed).not.toMatch(UNESCAPED_AMPERSAND);
  expect(feed).not.toContain("]]>");
  expect(feed).not.toContain("\u001b");

  return feed;
}

const RSS_HANDLERS: Array<[string, Handler]> = [
  ["standalone status-page container", handleStandaloneRSS],
  ["combined App container", handleFrontendRSS],
];

describe.each(RSS_HANDLERS)(
  "RSS feed escaping (%s)",
  (_name: string, handler: Handler) => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it.each(["/rss", `/status-page/${STATUS_PAGE_ID}/rss`])(
      "escapes the page's title and description on %s",
      async (path: string) => {
        mockHostileStatusPage();

        const feed: string = await renderFeed(handler, path);

        expect(feed).toContain(
          `<title>Page ${HOSTILE_ESCAPED} Updates</title>`,
        );
        expect(feed).toContain(
          `<description>About ${HOSTILE_ESCAPED}</description>`,
        );
      },
    );

    it("escapes every item's title and description, instead of wrapping them in CDATA", async () => {
      mockHostileStatusPage();

      const feed: string = await renderFeed(handler, "/rss");

      expect(feed).not.toContain("<![CDATA[");
      expect(feed).toContain(
        `<title>Incident: Outage ${HOSTILE_ESCAPED}</title>`,
      );
      expect(feed).toContain(
        `<description>Outage details ${HOSTILE_ESCAPED}</description>`,
      );
      expect(feed).toContain(
        `<title>Announcement: News ${HOSTILE_ESCAPED}</title>`,
      );
      expect(feed).toContain(
        `<description>News details ${HOSTILE_ESCAPED}</description>`,
      );
      expect(feed).toContain(
        `<title>Scheduled Maintenance: Upgrade ${HOSTILE_ESCAPED}</title>`,
      );
      expect(feed).toContain(
        `<description>Upgrade details ${HOSTILE_ESCAPED}</description>`,
      );
    });

    it("escapes the links, which carry the request's path", async () => {
      /*
       * A preview URL's page id comes from the path as it was requested, and
       * a browser sends "&" in a path as it is.
       */
      mockHostileStatusPage();

      const feed: string = await renderFeed(handler, "/status-page/a&b/rss");

      expect(feed).toContain(
        "<link>https://status.acme.com/status-page/a&amp;b</link>",
      );
      expect(feed).toContain(
        "<guid>https://status.acme.com/status-page/a&amp;b/incidents/incident-1</guid>",
      );
      expect(feed).toContain(
        'status.acme.com/status-page/a&amp;b/rss" rel="self"',
      );
    });
  },
);
