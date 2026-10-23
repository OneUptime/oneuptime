process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

import ExternalStatusPageMonitorUtil, {
  EXTERNAL_STATUS_PAGE_FEED_ACTIVE_WINDOW_IN_MS,
  EXTERNAL_STATUS_PAGE_FEED_CLOCK_SKEW_IN_MS,
} from "../../../../Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor";
import ProxyConfig from "../../../../Utils/ProxyConfig";
import ExternalStatusPageMonitorResponse from "Common/Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import axios, { AxiosResponse } from "axios";
import { Readable } from "stream";

/*
 * On an RSS or Atom feed, the items of the last 24 hours count as active
 * incidents. An item dated ahead had always counted too - its age is
 * negative, which is "within 24 hours" - so a feed that dates scheduled
 * maintenance by its start (a OneUptime status page's feed does, as the
 * page dates it) raised an incident the moment the work was announced. Now
 * an item counts from its date to 24 hours after it; a few minutes ahead
 * still count, for a server clock running fast.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

let feedBody: string = "";

beforeEach(() => {
  jest.spyOn(ProxyConfig, "getHttpProxyAgent").mockReturnValue(null);
  jest.spyOn(ProxyConfig, "getHttpsProxyAgent").mockReturnValue(null);
  jest
    .spyOn(axios, "get")
    .mockImplementation(async (): Promise<AxiosResponse> => {
      return {
        status: 200,
        statusText: "OK",
        data: Readable.from([Buffer.from(feedBody)]),
        headers: { "content-type": "application/rss+xml" },
        config: {},
        request: {},
      } as AxiosResponse;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function rssItem(title: string, offsetFromNowInMs: number): string {
  return `<item><title>${title}</title><pubDate>${new Date(
    Date.now() + offsetFromNowInMs,
  ).toUTCString()}</pubDate></item>`;
}

function atomEntry(title: string, offsetFromNowInMs: number): string {
  return `<entry><title>${title}</title><updated>${new Date(
    Date.now() + offsetFromNowInMs,
  ).toISOString()}</updated></entry>`;
}

async function readFeed(
  provider: ExternalStatusPageProviderType,
  body: string,
): Promise<ExternalStatusPageMonitorResponse> {
  feedBody = body;

  const response: ExternalStatusPageMonitorResponse | null =
    await ExternalStatusPageMonitorUtil.fetch(
      {
        // A public literal keeps this unit test independent from real DNS.
        statusPageUrl: "https://1.1.1.1/rss",
        provider: provider,
        timeout: 5000,
        retries: 0,
      },
      { isOnlineCheckRequest: true },
    );

  expect(response).not.toBeNull();
  return response!;
}

function counted(response: ExternalStatusPageMonitorResponse): Array<string> {
  return response.componentStatuses.map(
    (component: { name: string }): string => {
      return component.name;
    },
  );
}

describe("which feed items count as active incidents", () => {
  test("the window is 24 hours, and an item may be dated 5 minutes ahead", () => {
    expect(EXTERNAL_STATUS_PAGE_FEED_ACTIVE_WINDOW_IN_MS).toBe(24 * HOUR);
    expect(EXTERNAL_STATUS_PAGE_FEED_CLOCK_SKEW_IN_MS).toBe(5 * MINUTE);
  });

  test("an RSS feed: from the item's date to a day after it", async () => {
    const response: ExternalStatusPageMonitorResponse = await readFeed(
      ExternalStatusPageProviderType.RSS,
      `<rss version="2.0"><channel><title>Status</title>
${rssItem("Announced for next week", 6 * 24 * HOUR)}
${rssItem("Starts in an hour", HOUR)}
${rssItem("Dated two minutes ahead", 2 * MINUTE)}
${rssItem("Just now", -MINUTE)}
${rssItem("This morning", -6 * HOUR)}
${rssItem("Almost a day ago", -23 * HOUR)}
${rssItem("Yesterday", -25 * HOUR)}
</channel></rss>`,
    );

    expect(response.provider).toBe(ExternalStatusPageProviderType.RSS);
    expect(counted(response)).toEqual([
      "Dated two minutes ahead",
      "Just now",
      "This morning",
      "Almost a day ago",
    ]);
    expect(response.activeIncidentCount).toBe(4);
    expect(response.overallStatus).toBe("degraded_performance");
  });

  test("an Atom feed: the same, by each entry's update", async () => {
    const response: ExternalStatusPageMonitorResponse = await readFeed(
      ExternalStatusPageProviderType.Atom,
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>Status</title>
${atomEntry("Planned for tomorrow", 24 * HOUR)}
${atomEntry("Updated an hour ago", -HOUR)}
${atomEntry("Updated two days ago", -48 * HOUR)}
</feed>`,
    );

    expect(response.provider).toBe(ExternalStatusPageProviderType.Atom);
    expect(counted(response)).toEqual(["Updated an hour ago"]);
  });

  test("a feed with only maintenance still to come reads as operational", async () => {
    const response: ExternalStatusPageMonitorResponse = await readFeed(
      ExternalStatusPageProviderType.RSS,
      `<rss version="2.0"><channel><title>Status</title>
${rssItem("Scheduled Maintenance: Database upgrade", 3 * 24 * HOUR)}
</channel></rss>`,
    );

    expect(response.activeIncidentCount).toBe(0);
    expect(response.overallStatus).toBe("operational");
  });

  test("an item whose date cannot be read does not count", async () => {
    const response: ExternalStatusPageMonitorResponse = await readFeed(
      ExternalStatusPageProviderType.RSS,
      `<rss version="2.0"><channel><title>Status</title>
<item><title>Garbled</title><pubDate>not a date</pubDate></item>
<item><title>Undated</title></item>
</channel></rss>`,
    );

    expect(response.activeIncidentCount).toBe(0);
  });
});
