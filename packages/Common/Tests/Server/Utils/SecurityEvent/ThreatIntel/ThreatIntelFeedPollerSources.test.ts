import ThreatIntelFeedPoller from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelFeedPoller";
import ThreatIntelEnricher from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import ThreatIntelListSource from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelListSource";
import GoogleSecOpsIndicatorSource, {
  GoogleSecOpsIocReader,
} from "../../../../../Server/Utils/SecurityEvent/ThreatIntel/GoogleSecOpsIndicatorSource";
import { GoogleSecOpsIocMatchesResult } from "../../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import ThreatIntelFeedService from "../../../../../Server/Services/ThreatIntelFeedService";
import ThreatIntelIndicatorService from "../../../../../Server/Services/ThreatIntelIndicatorService";
import SecurityEventConnectionService from "../../../../../Server/Services/SecurityEventConnectionService";
import logger from "../../../../../Server/Utils/Logger";
import SecurityEventConnection from "../../../../../Models/DatabaseModels/SecurityEventConnection";
import ThreatIntelFeed from "../../../../../Models/DatabaseModels/ThreatIntelFeed";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import SecurityEventConnectorProvider from "../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import ThreatIntelFeedType from "../../../../../Types/SecurityEvent/ThreatIntelFeedType";
import { CONNECTION_SETTINGS } from "../Connectors/AlertClosing/GoogleSecOpsFakeApi";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The poller reads each feed from its source: a TAXII collection as it
 * always has, a list at an https address, or Google SecOps through a
 * connection. What a list or Google SecOps poll did lands on the feed - its
 * Last poll, its cursor, its error cleared - and the enricher forgets what
 * it knew when indicators changed. A failing source is recorded on the feed
 * like a failing TAXII server, and never stops the turn.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const LIST_FEED_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SECOPS_FEED_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111112",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

function listFeed(): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed._id = LIST_FEED_ID.toString();
  feed.projectId = PROJECT_ID;
  feed.name = "Tor exit nodes";
  feed.feedType = ThreatIntelFeedType.List;
  feed.listUrl = "https://check.torproject.org/torbulkexitlist";
  feed.indicatorConfidence = 30;
  feed.pollIntervalInMinutes = 60;
  return feed;
}

function secOpsFeed(): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed._id = SECOPS_FEED_ID.toString();
  feed.projectId = PROJECT_ID;
  feed.name = "Google SecOps IOCs";
  feed.feedType = ThreatIntelFeedType.GoogleSecOps;
  feed.securityEventConnectionId = CONNECTION_ID;
  feed.pollIntervalInMinutes = 60;
  return feed;
}

function serving(
  text: string,
): (request: DataSourceHttpRequest) => Promise<DataSourceHttpResponse> {
  return async (): Promise<DataSourceHttpResponse> => {
    return { statusCode: 200, bodyText: text, bodyJson: undefined };
  };
}

function readerOf(matches: Array<JSONObject>): () => GoogleSecOpsIocReader {
  return (): GoogleSecOpsIocReader => {
    return {
      searchEnterpriseIocMatches:
        async (): Promise<GoogleSecOpsIocMatchesResult> => {
          return { matches, moreDataAvailable: false };
        },
    };
  };
}

let updateSpy: Spy;
let invalidateSpy: Spy;
let insertSpy: Spy;

function feedUpdate(): { id: ObjectID; data: JSONObject } {
  expect(updateSpy).toHaveBeenCalledTimes(1);
  return updateSpy.mock.calls[0]![0] as { id: ObjectID; data: JSONObject };
}

beforeEach(() => {
  updateSpy = getJestSpyOn(
    ThreatIntelFeedService,
    "updateOneById",
  ).mockResolvedValue(undefined as never);
  invalidateSpy = getJestSpyOn(
    ThreatIntelEnricher,
    "invalidateProjectCache",
  ).mockImplementation((() => {
    return undefined;
  }) as never);
  insertSpy = getJestSpyOn(
    ThreatIntelIndicatorService,
    "insertJsonRows",
  ).mockResolvedValue(undefined as never);
  getJestSpyOn(
    ThreatIntelIndicatorService,
    "findActiveValuesForFeed",
  ).mockResolvedValue([] as never);

  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID.toString();
  connection.projectId = PROJECT_ID;
  connection.provider = SecurityEventConnectorProvider.GoogleSecOps;

  getJestSpyOn(SecurityEventConnectionService, "findOneById").mockResolvedValue(
    connection as never,
  );
  getJestSpyOn(
    SecurityEventConnectionService,
    "getConnectorSettings",
  ).mockResolvedValue(CONNECTION_SETTINGS as never);
  getJestSpyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a list feed's poll", () => {
  test("records what it read, its cursor and no error, and refreshes the enricher", async () => {
    await ThreatIntelFeedPoller.pollFeedFromSource(listFeed(), {
      listFetch: serving("192.0.2.1\n192.0.2.2\n"),
    });

    const update: { id: ObjectID; data: JSONObject } = feedUpdate();

    expect(update.id.toString()).toBe(LIST_FEED_ID.toString());
    expect(update.data["lastPollSummary"]).toBe(
      "Read 2 indicators from the list.",
    );
    expect(update.data["lastError"]).toBeNull();
    expect(update.data["lastPolledAt"]).toBeInstanceOf(Date);
    expect(String(update.data["cursor"])).toMatch(/^sha256:[0-9a-f]{64}@/);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("an unchanged list keeps its cursor and leaves the enricher alone", async () => {
    const first: ThreatIntelFeed = listFeed();

    await ThreatIntelFeedPoller.pollFeedFromSource(first, {
      listFetch: serving("192.0.2.1\n"),
    });

    const cursor: string = String(feedUpdate().data["cursor"]);

    updateSpy.mockClear();
    invalidateSpy.mockClear();
    insertSpy.mockClear();

    const again: ThreatIntelFeed = listFeed();
    again.cursor = cursor;

    await ThreatIntelFeedPoller.pollFeedFromSource(again, {
      listFetch: serving("192.0.2.1\n"),
    });

    const update: { id: ObjectID; data: JSONObject } = feedUpdate();

    expect(update.data["lastPollSummary"]).toBe(
      "The list has not changed: 1 indicator.",
    );
    expect("cursor" in update.data).toBe(false);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("a Google SecOps feed's poll", () => {
  test("records what it read and the end of the window", async () => {
    getJestSpyOn(
      GoogleSecOpsIndicatorSource,
      "createReader",
    ).mockImplementation(
      readerOf([{ artifactIndicator: { domain: "c2.evil.example" } }]) as never,
    );

    await ThreatIntelFeedPoller.pollFeedFromSource(secOpsFeed());

    const update: { id: ObjectID; data: JSONObject } = feedUpdate();

    expect(update.id.toString()).toBe(SECOPS_FEED_ID.toString());
    expect(update.data["lastPollSummary"]).toBe(
      "Read 1 indicator Google SecOps found in your events (1 match).",
    );
    expect(
      Number.isNaN(new Date(String(update.data["cursor"])).getTime()),
    ).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("a window with no match still moves on, and leaves the enricher alone", async () => {
    await ThreatIntelFeedPoller.pollFeedFromSource(secOpsFeed(), {
      googleSecOpsReaderFactory: readerOf([]),
    });

    expect(feedUpdate().data["cursor"]).toBeDefined();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("a TAXII feed", () => {
  test("is polled as it always was, and a feed saved before sources is one", async () => {
    const pollSpy: Spy = getJestSpyOn(
      ThreatIntelFeedPoller,
      "pollFeed",
    ).mockResolvedValue({} as never);

    const taxii: ThreatIntelFeed = new ThreatIntelFeed();
    taxii._id = LIST_FEED_ID.toString();
    taxii.projectId = PROJECT_ID;
    taxii.apiRootUrl = "https://taxii.example.com/api1/";
    taxii.collectionId = "col-1";

    await ThreatIntelFeedPoller.pollFeedFromSource(taxii);

    taxii.feedType = ThreatIntelFeedType.Taxii;
    await ThreatIntelFeedPoller.pollFeedFromSource(taxii);

    expect(pollSpy).toHaveBeenCalledTimes(2);
    // The TAXII poll records its own bookkeeping.
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("a source that fails, in a project's turn", () => {
  test("is recorded on its feed, and the other feeds are still polled", async () => {
    getJestSpyOn(ThreatIntelFeedService, "findAllBy").mockResolvedValue([
      listFeed(),
      secOpsFeed(),
    ] as never);
    getJestSpyOn(ThreatIntelListSource, "download").mockRejectedValue(
      new Error("Data source responded with HTTP 503: try later") as never,
    );
    getJestSpyOn(
      GoogleSecOpsIndicatorSource,
      "createReader",
    ).mockImplementation(readerOf([]) as never);

    await ThreatIntelFeedPoller.pollDueFeedsForProject(PROJECT_ID);

    const updates: Array<{ id: ObjectID; data: JSONObject }> =
      updateSpy.mock.calls.map(
        (call: Array<unknown>): { id: ObjectID; data: JSONObject } => {
          return call[0] as { id: ObjectID; data: JSONObject };
        },
      );

    expect(updates).toHaveLength(2);

    const failed: { id: ObjectID; data: JSONObject } = updates.find(
      (update: { id: ObjectID; data: JSONObject }): boolean => {
        return update.id.toString() === LIST_FEED_ID.toString();
      },
    )!;

    expect(String(failed.data["lastError"])).toContain("HTTP 503");

    const polled: { id: ObjectID; data: JSONObject } = updates.find(
      (update: { id: ObjectID; data: JSONObject }): boolean => {
        return update.id.toString() === SECOPS_FEED_ID.toString();
      },
    )!;

    expect(polled.data["lastError"]).toBeNull();
  });

  test("a Google SecOps feed whose connection was deleted says so on the feed", async () => {
    getJestSpyOn(ThreatIntelFeedService, "findAllBy").mockResolvedValue([
      secOpsFeed(),
    ] as never);
    getJestSpyOn(
      SecurityEventConnectionService,
      "findOneById",
    ).mockResolvedValue(null as never);

    await ThreatIntelFeedPoller.pollDueFeedsForProject(PROJECT_ID);

    expect(String(feedUpdate().data["lastError"])).toContain(
      "The Google SecOps connection this feed read through was deleted.",
    );
  });
});

describe("what a turn reads of each feed", () => {
  test("includes every source's own columns", async () => {
    const findAll: Spy = getJestSpyOn(
      ThreatIntelFeedService,
      "findAllBy",
    ).mockResolvedValue([] as never);

    await ThreatIntelFeedPoller.pollDueFeedsForProject(PROJECT_ID);

    const select: JSONObject = (findAll.mock.calls[0]![0] as JSONObject)[
      "select"
    ] as JSONObject;

    for (const column of [
      "feedType",
      "listUrl",
      "indicatorConfidence",
      "securityEventConnectionId",
      "apiRootUrl",
      "collectionId",
      "cursor",
      "minimumConfidence",
    ]) {
      expect([column, select[column]]).toEqual([column, true]);
    }
  });
});
