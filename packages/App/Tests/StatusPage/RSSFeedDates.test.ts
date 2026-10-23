/**
 * What a status page's RSS feed says on the wire about WHEN each item
 * happened, and who the page's API takes its reader to be - for both servers
 * that serve the feed: the standalone status-page container and the
 * combined App container (they share StatusPageRssFeed).
 *
 * Every item is dated as the page dates it: an incident by when it was
 * declared, an announcement by when it went up on the page, and a scheduled
 * maintenance event by when it starts, its description opening with its
 * window. Dated by when each record was written, maintenance announced a
 * week ahead read in a feed reader - and in a monitor counting the last
 * day's items as incidents - as something happening that day (issue #5176).
 *
 * The feed's reads of the page carry the reader's address and cookies, so
 * the page's IP allowlist and sign-in judge the reader, not the server.
 */

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { JSONObject } from "Common/Types/JSON";
import API, { APIRequestOptions } from "Common/Utils/API";
import { handleRSS as handleFrontendRSS } from "../../FeatureSet/Frontend/Utils/StatusPage";
import { handleRSS as handleStandaloneRSS } from "../../FeatureSet/StatusPage/src/Server/API/RSS";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

const STATUS_PAGE_ID: string = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

type Handler = (req: ExpressRequest, res: ExpressResponse) => Promise<void>;

type FakeResponse = {
  set: ReturnType<typeof jest.fn>;
  send: ReturnType<typeof jest.fn>;
  status: ReturnType<typeof jest.fn>;
};

interface FeedItem {
  title: string;
  description?: string;
  pubDate?: string;
  link: string;
}

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

function feedRequest(data: {
  forwardedFor?: string;
  cookie?: string;
}): ExpressRequest {
  const headers: Record<string, string> = { host: "status.acme.com" };

  if (data.forwardedFor) {
    headers["x-forwarded-for"] = data.forwardedFor;
  }

  if (data.cookie) {
    headers["cookie"] = data.cookie;
  }

  return {
    path: "/rss",
    hostname: "status.acme.com",
    protocol: "https",
    headers: headers,
    socket: { remoteAddress: "10.0.0.2" },
    ip: "10.0.0.2",
    get: () => {
      return "status.acme.com";
    },
  } as unknown as ExpressRequest;
}

/*
 * The page, and its lists as the API sends them: dates in the JSON's
 * {_type: "DateTime"} form, as JSONFunctions.serialize writes them.
 */
function dateTime(iso: string): JSONObject {
  return { _type: "DateTime", value: iso };
}

let readOptions: Array<APIRequestOptions> = [];

function mockStatusPage(data: { isPrivate?: boolean } = {}): void {
  readOptions = [];

  jest.spyOn(API, "get").mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        _id: STATUS_PAGE_ID,
        title: "Acme",
        description: "Acme's status",
        enableSearchEngineIndexing: true,
      },
      {},
    ) as never,
  );

  jest
    .spyOn(API, "post")
    .mockImplementation(
      async (
        options: APIRequestOptions,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        readOptions.push(options);

        if (data.isPrivate) {
          return new HTTPErrorResponse(
            401,
            {
              message:
                "You do not have access to this status page. Please login to view the status page.",
            },
            {},
          );
        }

        const url: string = options.url.toString();

        if (url.includes("/incidents/")) {
          return new HTTPResponse<JSONObject>(
            200,
            {
              incidents: [
                {
                  _id: "incident-1",
                  title: "Slow checkouts",
                  description: "Payments take long.",
                  createdAt: dateTime("2026-10-23T10:05:00.000Z"),
                  declaredAt: dateTime("2026-10-23T09:40:00.000Z"),
                },
              ],
            },
            {},
          );
        }

        if (url.includes("/announcements/")) {
          return new HTTPResponse<JSONObject>(
            200,
            {
              announcements: [
                {
                  _id: "announcement-1",
                  title: "New region",
                  description: "Frankfurt is live.",
                  createdAt: dateTime("2026-10-01T08:00:00.000Z"),
                  showAnnouncementAt: dateTime("2026-10-20T08:00:00.000Z"),
                },
              ],
            },
            {},
          );
        }

        return new HTTPResponse<JSONObject>(
          200,
          {
            scheduledMaintenanceEvents: [
              {
                _id: "event-1",
                title: "Database upgrade",
                description: "Writes pause for a few minutes.",
                createdAt: dateTime("2026-10-18T09:00:00.000Z"),
                startsAt: dateTime("2026-10-25T02:00:00.000Z"),
                endsAt: dateTime("2026-10-25T04:30:00.000Z"),
              },
            ],
          },
          {},
        );
      },
    );
}

async function renderFeed(
  handler: Handler,
  req: ExpressRequest,
): Promise<Array<FeedItem>> {
  const res: FakeResponse = fakeResponse();

  await handler(req, res as unknown as ExpressResponse);

  expect(res.status).not.toHaveBeenCalled();
  expect(res.send).toHaveBeenCalledTimes(1);

  const xml: string = (
    res.send as unknown as { mock: { calls: Array<Array<string>> } }
  ).mock.calls[0]![0]!;

  return xml
    .split("<item>")
    .slice(1)
    .map((block: string): FeedItem => {
      const item: FeedItem = {
        title: between(block, "<title>", "</title>") || "",
        link: between(block, "<link>", "</link>") || "",
      };
      const description: string | undefined = between(
        block,
        "<description>",
        "</description>",
      );
      const pubDate: string | undefined = between(
        block,
        "<pubDate>",
        "</pubDate>",
      );

      if (description !== undefined) {
        item.description = description;
      }

      if (pubDate !== undefined) {
        item.pubDate = pubDate;
      }

      return item;
    });
}

// The text between two markers, read with indexOf; undefined when absent.
function between(
  text: string,
  open: string,
  close: string,
): string | undefined {
  const start: number = text.indexOf(open);

  if (start === -1) {
    return undefined;
  }

  const end: number = text.indexOf(close, start + open.length);

  return end === -1 ? undefined : text.slice(start + open.length, end);
}

const RSS_HANDLERS: Array<[string, Handler]> = [
  ["standalone status-page container", handleStandaloneRSS],
  ["combined App container", handleFrontendRSS],
];

describe.each(RSS_HANDLERS)(
  "RSS feed dates and readers (%s)",
  (_name: string, handler: Handler) => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("dates each item as the page dates it, newest first", async () => {
      mockStatusPage();

      const items: Array<FeedItem> = await renderFeed(
        handler,
        feedRequest({ forwardedFor: "198.51.100.7" }),
      );

      expect(
        items.map((item: FeedItem) => {
          return [item.title, item.pubDate];
        }),
      ).toEqual([
        // When it starts, not the week before, when it was announced.
        [
          "Scheduled Maintenance: Database upgrade",
          "Sun, 25 Oct 2026 02:00:00 GMT",
        ],
        // When it was declared, not when its record was written.
        ["Incident: Slow checkouts", "Fri, 23 Oct 2026 09:40:00 GMT"],
        // When it went up, not when it was written.
        ["Announcement: New region", "Tue, 20 Oct 2026 08:00:00 GMT"],
      ]);
    });

    it("opens a maintenance item's description with its window", async () => {
      mockStatusPage();

      const items: Array<FeedItem> = await renderFeed(
        handler,
        feedRequest({ forwardedFor: "198.51.100.7" }),
      );

      expect(items[0]!.description).toBe(
        "Scheduled from Sun, 25 Oct 2026 02:00 UTC to Sun, 25 Oct 2026 04:30 UTC.\n\nWrites pause for a few minutes.",
      );
      expect(items[1]!.description).toBe("Payments take long.");
    });

    it("reads the page as the reader: their address and cookies go with each read", async () => {
      mockStatusPage();

      await renderFeed(
        handler,
        feedRequest({
          forwardedFor: "198.51.100.7",
          cookie: "status-page-session=abc",
        }),
      );

      expect(readOptions).toHaveLength(3);

      for (const options of readOptions) {
        expect(options.headers).toEqual({
          "status-page-id": STATUS_PAGE_ID,
          "x-forwarded-for": "198.51.100.7",
          cookie: "status-page-session=abc",
        });
      }
    });

    it("a private page the reader cannot read: the feed is there, with nothing in it", async () => {
      mockStatusPage({ isPrivate: true });

      const items: Array<FeedItem> = await renderFeed(
        handler,
        feedRequest({ forwardedFor: "198.51.100.7" }),
      );

      expect(items).toEqual([]);
    });
  },
);
