import SecurityWatchlist from "../../../../../Models/DatabaseModels/SecurityWatchlist";
import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import SecurityWatchlistItemService, {
  SecurityWatchlistImportSummary,
} from "../../../../../Server/Services/SecurityWatchlistItemService";
import SecurityWatchlistService from "../../../../../Server/Services/SecurityWatchlistService";
import { DataSourceHttpRequest } from "../../../../../Server/Utils/DataSource/HttpFetch";
import SecurityProjectWork, {
  SecurityProjectWorkLease,
} from "../../../../../Server/Utils/SecurityEvent/SecurityProjectWork";
import SecurityWatchlistUrlImport, {
  SECURITY_WATCHLIST_URL_READ_PROJECT_WORK,
  SECURITY_WATCHLIST_URL_REQUEST_TIMEOUT_IN_MS,
  SecurityWatchlistUrlReadError,
  SecurityWatchlistUrlReadOutcome,
  URL_READ_SELECT,
  WatchlistUrlFetchLike,
} from "../../../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlistUrlImport";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS,
  SECURITY_WATCHLIST_MESSAGES,
  SecurityWatchlistImportMode,
  SecurityWatchlistImportResult,
  SecurityWatchlistImportSchedule,
  SecurityWatchlistSource,
} from "../../../../../Types/SecurityEvent/SecurityWatchlist";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A WATCHLIST READ FROM AN ADDRESS (#5391): the file downloaded through the
 * egress-guarded fetch every data source uses, read as Import Values reads
 * a file, and the list made what it holds - or, when the read fails, the
 * list kept as it was and why said on it, tried again within the hour. One
 * read of a list at a time; Read Now reads it at once.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const WATCHLIST_ID: ObjectID = new ObjectID(
  "34343434-3434-4434-8434-343434343434",
);
const ADDRESS: string = "https://hr.example.com/vip-users.csv";
const NOW: Date = new Date("2026-11-03T12:00:00.000Z");

function urlList(
  values: Partial<Record<string, unknown>> = {},
): SecurityWatchlist {
  const list: SecurityWatchlist = new SecurityWatchlist();
  list.id = WATCHLIST_ID;
  list.projectId = PROJECT_ID;
  list.name = "vip_users";
  list.entityType = SecurityEntityType.User;
  list.source = SecurityWatchlistSource.Url;
  list.importUrl = ADDRESS;
  list.importSchedule = SecurityWatchlistImportSchedule.EverySixHours;
  Object.assign(list, values);
  return list;
}

function answering(text: string): WatchlistUrlFetchLike {
  return async () => {
    return { statusCode: 200, bodyText: text, bodyJson: undefined };
  };
}

const SUMMARY: SecurityWatchlistImportSummary = {
  added: 2,
  removed: 1,
  unchanged: 0,
  duplicates: 0,
  problems: [],
  problemCount: 1,
  valueCount: 2,
};

let release: Spy;
let lock: Spy;
let importValues: Spy;
let update: Spy;

beforeEach(() => {
  const mutex: Record<string, unknown> = {};
  lock = getJestSpyOn(Semaphore, "lock").mockResolvedValue(mutex as never);
  release = getJestSpyOn(Semaphore, "release").mockResolvedValue(
    undefined as never,
  );
  importValues = getJestSpyOn(
    SecurityWatchlistItemService,
    "importValues",
  ).mockResolvedValue(SUMMARY as never);
  update = getJestSpyOn(
    SecurityWatchlistService,
    "updateOneById",
  ).mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function recorded(): JSONObject {
  expect(update).toHaveBeenCalledTimes(1);
  const args: { id: ObjectID; data: JSONObject; props: JSONObject } = update
    .mock.calls[0]![0] as never;

  expect(args.id.toString()).toBe(WATCHLIST_ID.toString());
  expect(args.props).toEqual({ isRoot: true });
  return args.data;
}

describe("downloading the file", () => {
  test("a GET through the guarded fetch, asking for text, in a minute at most", async () => {
    const requests: Array<DataSourceHttpRequest> = [];

    await expect(
      SecurityWatchlistUrlImport.download(
        ADDRESS,
        async (request: DataSourceHttpRequest) => {
          requests.push(request);
          return { statusCode: 200, bodyText: "alice", bodyJson: undefined };
        },
      ),
    ).resolves.toBe("alice");

    expect(requests).toEqual([
      {
        method: "GET",
        url: ADDRESS,
        headers: { Accept: "text/csv, text/plain;q=0.9, */*;q=0.5" },
        timeoutInMs: SECURITY_WATCHLIST_URL_REQUEST_TIMEOUT_IN_MS,
        egressOptions: { targetLabel: "Watchlist file" },
      },
    ]);
    expect(SECURITY_WATCHLIST_URL_REQUEST_TIMEOUT_IN_MS).toBe(60 * 1000);
  });

  test("an address that does not answer, or answers with an error, says so, with what it said", async () => {
    const failure: unknown = await SecurityWatchlistUrlImport.download(
      ADDRESS,
      async () => {
        throw new BadDataException(
          "Data source responded with HTTP 404: Not Found",
        );
      },
    ).catch((error: unknown) => {
      return error;
    });

    expect(failure).toBeInstanceOf(SecurityWatchlistUrlReadError);
    expect((failure as SecurityWatchlistUrlReadError).message).toBe(
      SECURITY_WATCHLIST_MESSAGES.urlNotRead.message,
    );
    expect((failure as SecurityWatchlistUrlReadError).detail).toBe(
      "Data source responded with HTTP 404: Not Found",
    );
  });
});

describe("reading the file as a list", () => {
  function read(
    text: string,
    entityType: SecurityEntityType = SecurityEntityType.User,
  ): SecurityWatchlistImportResult {
    return SecurityWatchlistUrlImport.readFile({ text, entityType, now: NOW });
  }

  function refusal(
    text: string,
    entityType: SecurityEntityType = SecurityEntityType.User,
  ): SecurityWatchlistUrlReadError {
    try {
      read(text, entityType);
    } catch (error) {
      expect(error).toBeInstanceOf(SecurityWatchlistUrlReadError);
      return error as SecurityWatchlistUrlReadError;
    }

    throw new Error("The file was read.");
  }

  test("as Import Values reads one: a value a line, its note, when it leaves the list", () => {
    expect(
      read("value,note,expires\nalice@example.com,CFO,2026-12-31\nbob\n"),
    ).toEqual({
      values: [
        {
          value: "alice@example.com",
          note: "CFO",
          expiresAt: new Date("2026-12-31T00:00:00.000Z"),
        },
        { value: "bob", note: "" },
      ],
      problems: [],
      duplicates: 0,
    });
  });

  test("a file larger than an import is refused", () => {
    expect(
      refusal("a".repeat(SECURITY_WATCHLIST_IMPORT_MAX_CHARACTERS + 1)).message,
    ).toBe(SECURITY_WATCHLIST_MESSAGES.urlFileTooLarge.message);
  });

  test("a web page where a file was - a sign-in page, say - is refused", () => {
    expect(
      refusal("\n  <!DOCTYPE html><html><body>Sign in</body></html>").message,
    ).toBe(SECURITY_WATCHLIST_MESSAGES.urlFileIsWebPage.message);
    expect(refusal("<html><head></head></html>").message).toBe(
      SECURITY_WATCHLIST_MESSAGES.urlFileIsWebPage.message,
    );
  });

  test("a file with no value the list takes is refused, saying the first line's trouble", () => {
    const empty: SecurityWatchlistUrlReadError = refusal("# nothing here\n\n");

    expect(empty.message).toBe(
      SECURITY_WATCHLIST_MESSAGES.urlFileHasNoValues.message,
    );
    expect(empty.detail).toBeNull();

    const wrong: SecurityWatchlistUrlReadError = refusal(
      "not-an-address\n",
      SecurityEntityType.IpAddress,
    );

    expect(wrong.message).toBe(
      SECURITY_WATCHLIST_MESSAGES.urlFileHasNoValues.message,
    );
    expect(wrong.detail).toBe(
      `Line 1: ${SECURITY_WATCHLIST_MESSAGES.notAnAddress.message}`,
    );
  });
});

describe("one read of one list", () => {
  test("makes the list what the file holds - a replace, as OneUptime - and records it, next read one interval on", async () => {
    const outcome: SecurityWatchlistUrlReadOutcome =
      await SecurityWatchlistUrlImport.readList(urlList(), {
        fetchImplementation: answering("alice\nbob\nnot ok\tx\ty"),
        now: NOW,
      });

    expect(outcome).toEqual({
      summary: SUMMARY,
      error: null,
      errorDetail: null,
      isRead: true,
    });

    const args: {
      watchlistId: ObjectID;
      text: string;
      parsed: SecurityWatchlistImportResult;
      mode: SecurityWatchlistImportMode;
      props: JSONObject;
      fromUrl: boolean;
      now: Date;
    } = importValues.mock.calls[0]![0] as never;

    expect(args.watchlistId.toString()).toBe(WATCHLIST_ID.toString());
    expect(args.mode).toBe(SecurityWatchlistImportMode.Replace);
    expect(args.props).toEqual({ isRoot: true });
    expect(args.fromUrl).toBe(true);
    expect(args.now).toBe(NOW);
    expect(
      args.parsed.values.map((value: { value: string }): string => {
        return value.value;
      }),
    ).toEqual(["alice", "bob", "not ok"]);

    expect(recorded()).toEqual({
      lastImportAt: NOW,
      lastImportSucceededAt: NOW,
      lastImportError: null,
      lastImportErrorDetail: null,
      lastImportLinesLeftOut: 1,
      nextImportAt: new Date("2026-11-03T18:00:00.000Z"),
    });
  });

  test("one read of a list at a time: the lock is the list's, and always given back", async () => {
    await SecurityWatchlistUrlImport.readList(urlList(), {
      fetchImplementation: answering("alice"),
      now: NOW,
    });

    expect(lock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "security-watchlist-url-read",
        key: WATCHLIST_ID.toString(),
        acquireAttemptsLimit: 1,
      }),
    );
    expect(release).toHaveBeenCalledTimes(1);

    importValues.mockRejectedValue(new Error("deadlock") as never);

    await SecurityWatchlistUrlImport.readList(urlList(), {
      fetchImplementation: answering("alice"),
      now: NOW,
    });

    expect(release).toHaveBeenCalledTimes(2);
  });

  test("a list another read is reading is left to it: nothing read, nothing recorded", async () => {
    lock.mockRejectedValue(new Error("busy") as never);
    const fetch: Spy = jest.fn(answering("alice")) as never;

    const outcome: SecurityWatchlistUrlReadOutcome =
      await SecurityWatchlistUrlImport.readList(urlList(), {
        fetchImplementation: fetch as unknown as WatchlistUrlFetchLike,
        now: NOW,
      });

    expect(outcome.isRead).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(importValues).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("a read that fails changes no value, says why with what the address said, and is tried again within the hour", async () => {
    const outcome: SecurityWatchlistUrlReadOutcome =
      await SecurityWatchlistUrlImport.readList(
        urlList({ importSchedule: SecurityWatchlistImportSchedule.EveryDay }),
        {
          fetchImplementation: async () => {
            throw new Error("getaddrinfo ENOTFOUND hr.example.com");
          },
          now: NOW,
        },
      );

    expect(outcome).toEqual({
      summary: null,
      error: SECURITY_WATCHLIST_MESSAGES.urlNotRead.message,
      errorDetail: "getaddrinfo ENOTFOUND hr.example.com",
      isRead: true,
    });
    expect(importValues).not.toHaveBeenCalled();
    expect(recorded()).toEqual({
      lastImportAt: NOW,
      lastImportError: SECURITY_WATCHLIST_MESSAGES.urlNotRead.message,
      lastImportErrorDetail: "getaddrinfo ENOTFOUND hr.example.com",
      nextImportAt: new Date("2026-11-03T13:00:00.000Z"),
    });
  });

  test("a web page, or a file of nothing the list takes, keeps the list as it was", async () => {
    await SecurityWatchlistUrlImport.readList(urlList(), {
      fetchImplementation: answering("<!doctype html><title>Sign in</title>"),
      now: NOW,
    });

    expect(importValues).not.toHaveBeenCalled();
    expect(recorded()["lastImportError"]).toBe(
      SECURITY_WATCHLIST_MESSAGES.urlFileIsWebPage.message,
    );
  });

  test("a file past the list's limits is refused in the limit's own words", async () => {
    importValues.mockRejectedValue(
      new BadDataException(
        "A watchlist holds at most 5,000 values. Follow a threat intel feed for a longer list.",
      ) as never,
    );

    const outcome: SecurityWatchlistUrlReadOutcome =
      await SecurityWatchlistUrlImport.readList(urlList(), {
        fetchImplementation: answering("alice"),
        now: NOW,
      });

    expect(outcome.error).toBe(
      "A watchlist holds at most 5,000 values. Follow a threat intel feed for a longer list.",
    );
    expect(outcome.errorDetail).toBeNull();
  });

  test("anything else that goes wrong is said as a read that did not work, its detail kept", async () => {
    importValues.mockRejectedValue(new Error("connection reset") as never);

    const outcome: SecurityWatchlistUrlReadOutcome =
      await SecurityWatchlistUrlImport.readList(urlList(), {
        fetchImplementation: answering("alice"),
        now: NOW,
      });

    expect(outcome.error).toBe(SECURITY_WATCHLIST_MESSAGES.urlNotRead.message);
    expect(outcome.errorDetail).toBe("connection reset");
  });

  test("an address that is no longer one it may read is never asked", async () => {
    const fetch: Spy = jest.fn(answering("alice")) as never;

    const outcome: SecurityWatchlistUrlReadOutcome =
      await SecurityWatchlistUrlImport.readList(
        urlList({ importUrl: "http://hr.example.com/vip.csv" }),
        {
          fetchImplementation: fetch as unknown as WatchlistUrlFetchLike,
          now: NOW,
        },
      );

    expect(outcome.error).toBe(SECURITY_WATCHLIST_MESSAGES.urlNotHttps.message);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("a list no longer read from an address is never read", async () => {
    const fetch: Spy = jest.fn(answering("alice")) as never;

    const outcome: SecurityWatchlistUrlReadOutcome =
      await SecurityWatchlistUrlImport.readList(
        urlList({ source: SecurityWatchlistSource.Values }),
        {
          fetchImplementation: fetch as unknown as WatchlistUrlFetchLike,
          now: NOW,
        },
      );

    expect(outcome.error).toBe(SECURITY_WATCHLIST_MESSAGES.enterUrl.message);
    expect(fetch).not.toHaveBeenCalled();
    expect(importValues).not.toHaveBeenCalled();
  });

  test("recording what a read did never fails the read", async () => {
    update.mockRejectedValue(new Error("database is down") as never);

    await expect(
      SecurityWatchlistUrlImport.readList(urlList(), {
        fetchImplementation: answering("alice"),
        now: NOW,
      }),
    ).resolves.toMatchObject({ isRead: true, summary: SUMMARY });
  });
});

describe("Read Now", () => {
  function stubList(list: SecurityWatchlist | null): Spy {
    return getJestSpyOn(
      SecurityWatchlistService,
      "findOneById",
    ).mockResolvedValue(list as never);
  }

  test("reads the list as the caller may read it, then as OneUptime reads it", async () => {
    const find: Spy = stubList(urlList());
    const props: JSONObject = {
      tenantId: PROJECT_ID,
      userId: new ObjectID("56565656-5656-4656-8656-565656565656"),
    };

    const outcome: SecurityWatchlistUrlReadOutcome =
      await SecurityWatchlistUrlImport.readNow({
        watchlistId: WATCHLIST_ID,
        props: props as never,
        fetchImplementation: answering("alice"),
      });

    expect(outcome.summary).toBe(SUMMARY);
    expect(find).toHaveBeenCalledWith({
      id: WATCHLIST_ID,
      select: URL_READ_SELECT,
      props,
    });
    expect(
      (importValues.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({
      isRoot: true,
    });
  });

  test("a list the caller cannot read, or that is not read from an address, is refused", async () => {
    stubList(null);

    await expect(
      SecurityWatchlistUrlImport.readNow({
        watchlistId: WATCHLIST_ID,
        props: { isRoot: true },
      }),
    ).rejects.toThrow("Watchlist not found.");

    stubList(urlList({ source: SecurityWatchlistSource.Values }));

    await expect(
      SecurityWatchlistUrlImport.readNow({
        watchlistId: WATCHLIST_ID,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      "Only a watchlist read from an address is read from one.",
    );
  });

  test("a list already being read says so, and its page shows that read", async () => {
    stubList(urlList());
    lock.mockRejectedValue(new Error("busy") as never);

    await expect(
      SecurityWatchlistUrlImport.readNow({
        watchlistId: WATCHLIST_ID,
        props: { isRoot: true },
        fetchImplementation: answering("alice"),
      }),
    ).rejects.toThrow(
      "This list is being read right now. Its page shows what the read did when it ends.",
    );
  });
});

describe("the schedule", () => {
  test("each minute, a turn queued for each project with a list due, read in the order they fell due", async () => {
    const find: Spy = getJestSpyOn(
      SecurityWatchlistService,
      "findAllBy",
    ).mockResolvedValue([
      urlList(),
      urlList({ id: new ObjectID("78787878-7878-4878-8878-787878787878") }),
    ] as never);
    const enqueue: Spy = getJestSpyOn(
      SecurityProjectWork,
      "enqueueProjects",
    ).mockResolvedValue(1 as never);

    await expect(
      SecurityWatchlistUrlImport.enqueueProjectsWithDueLists(NOW),
    ).resolves.toBe(1);

    const args: {
      query: JSONObject;
      sort: JSONObject;
      props: JSONObject;
    } = find.mock.calls[0]![0] as never;
    const due: FindOperator<Date> = args.query[
      "nextImportAt"
    ] as unknown as FindOperator<Date>;

    expect(args.query["source"]).toBe(SecurityWatchlistSource.Url);
    expect(Object.values(due.objectLiteralParameters!)).toEqual([NOW]);
    expect(args.sort).toEqual({ nextImportAt: SortOrder.Ascending });
    expect(args.props).toEqual({ isRoot: true });
    expect(enqueue).toHaveBeenCalledWith(
      SECURITY_WATCHLIST_URL_READ_PROJECT_WORK,
      [PROJECT_ID, PROJECT_ID],
      NOW,
    );
    expect(SECURITY_WATCHLIST_URL_READ_PROJECT_WORK.jobName).toBe(
      "SecurityWatchlists:ReadProjectLists",
    );
  });

  test("a project's turn reads its due lists while it has time and keeps its lease", async () => {
    getJestSpyOn(SecurityWatchlistService, "findAllBy").mockResolvedValue([
      urlList(),
      urlList(),
      urlList(),
    ] as never);
    const readList: Spy = getJestSpyOn(
      SecurityWatchlistUrlImport,
      "readList",
    ).mockResolvedValue({
      summary: SUMMARY,
      error: null,
      errorDetail: null,
      isRead: true,
    } as never);

    let kept: number = 0;
    const lease: SecurityProjectWorkLease = {
      keep: async (): Promise<boolean> => {
        kept++;
        // The lease is lost after the second list.
        return kept < 2;
      },
      hasTimeLeft: (): boolean => {
        return true;
      },
    };

    await SecurityWatchlistUrlImport.runDueListsForProject(PROJECT_ID, lease);

    expect(readList).toHaveBeenCalledTimes(2);
  });

  test("a turn out of time leaves the rest due for the next minute", async () => {
    getJestSpyOn(SecurityWatchlistService, "findAllBy").mockResolvedValue([
      urlList(),
      urlList(),
    ] as never);
    const readList: Spy = getJestSpyOn(
      SecurityWatchlistUrlImport,
      "readList",
    ).mockResolvedValue({} as never);

    await SecurityWatchlistUrlImport.runDueListsForProject(PROJECT_ID, {
      keep: async (): Promise<boolean> => {
        return true;
      },
      hasTimeLeft: (): boolean => {
        return false;
      },
    });

    expect(readList).not.toHaveBeenCalled();
  });
});
