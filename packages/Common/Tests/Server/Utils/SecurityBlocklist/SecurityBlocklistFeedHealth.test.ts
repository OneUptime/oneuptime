import SecurityBlocklistFeed from "../../../../Models/DatabaseModels/SecurityBlocklistFeed";
import ProjectService from "../../../../Server/Services/ProjectService";
import SecurityBlocklistFeedFetchService from "../../../../Server/Services/SecurityBlocklistFeedFetchService";
import SecurityBlocklistFeedService from "../../../../Server/Services/SecurityBlocklistFeedService";
import SecurityBlocklistFeedHealth, {
  describeSecurityBlocklistFeedDuration,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistFeedHealth";
import ObjectID from "../../../../Types/ObjectID";
import { NO_BREAK_SPACE } from "../../../../Types/NoBreakSpaces";
import { SecurityBlocklistFeedFirewall } from "../../../../Types/SecurityBlocklist/SecurityBlocklistFeed";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A FIREWALL THAT STOPS READING ITS FEED IS REPORTED, ONCE (#10345): the
 * health pass works out how often each feed is fetched, keeps it on the
 * feed, and tells the project's owners by email when a firewall has not
 * fetched its feed for three times that - once, in one compare-and-set, and
 * never for a feed whose secret was revoked, or one an hourly firewall
 * fetched once. The next fetch clearing the mark is held where fetches are
 * recorded (SecurityBlocklistFeedEnforcement.test.ts).
 */

type MockedFn = ReturnType<typeof jest.fn>;

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;

const NOW: Date = new Date("2026-11-21T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "81111111-1111-4111-8111-111111111111",
);

function at(offsetInMs: number): Date {
  return new Date(NOW.getTime() + offsetInMs);
}

function feed(
  values: Partial<SecurityBlocklistFeed> = {},
): SecurityBlocklistFeed {
  const model: SecurityBlocklistFeed = new SecurityBlocklistFeed();
  model.id = new ObjectID("82222222-2222-4222-8222-222222222222");
  model.projectId = PROJECT_ID;
  model.name = "Palo Alto feed";
  model.firewall = SecurityBlocklistFeedFirewall.PaloAlto;
  model.secretHint = "9f3c";
  model.lastFetchedAt = at(-4 * HOUR_IN_MS);
  model.usualFetchIntervalInSeconds = 3600;
  Object.assign(model, values);
  return model;
}

// A firewall that fetched every hour, the latest at `last`.
function hourlyFetches(last: Date, count: number = 6): Array<Date> {
  return Array.from({ length: count }, (_: unknown, index: number): Date => {
    return new Date(last.getTime() - index * HOUR_IN_MS);
  });
}

let fetchTimes: Array<Date>;
let isClaimed: boolean;
let updateColumns: MockedFn;
let compareAndSet: MockedFn;
let sendEmail: MockedFn;

beforeEach(() => {
  fetchTimes = hourlyFetches(at(-4 * HOUR_IN_MS));
  isClaimed = true;

  jest
    .spyOn(SecurityBlocklistFeedFetchService, "findLatestFetchTimes")
    .mockImplementation(async (): Promise<Array<Date>> => {
      return fetchTimes;
    });
  updateColumns = jest
    .spyOn(SecurityBlocklistFeedService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
  compareAndSet = jest
    .spyOn(SecurityBlocklistFeedService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (): Promise<boolean> => {
      return isClaimed;
    }) as never) as unknown as MockedFn;
  sendEmail = jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a firewall that stopped reading its feed", () => {
  test("is reported to the project's owners once it has not fetched for three usual intervals", async () => {
    const stopped: SecurityBlocklistFeed = feed();

    await expect(
      SecurityBlocklistFeedHealth.checkFeed({ feed: stopped, now: NOW }),
    ).resolves.toBe(true);

    // Claimed first, against the fetch it was judged on: no second server tells them too.
    expect(compareAndSet).toHaveBeenCalledTimes(1);
    expect(compareAndSet.mock.calls[0]![0]).toEqual({
      id: stopped.id,
      data: { stoppedReadingToldAt: NOW },
      expectedData: {
        stoppedReadingToldAt: null,
        lastFetchedAt: stopped.lastFetchedAt,
      },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [projectId, subject, html] = sendEmail.mock.calls[0] as [
      ObjectID,
      string,
      string,
    ];
    expect(projectId).toEqual(PROJECT_ID);
    expect(subject).toBe(
      "Your firewall stopped reading the blocklist feed Palo Alto feed",
    );
    expect(html).toContain(
      `Your firewall stopped reading the blocklist feed Palo Alto feed 4${NO_BREAK_SPACE}hours ago, though it usually reads it every 60${NO_BREAK_SPACE}minutes.`,
    );
  });

  test("is not reported while it fetches within three usual intervals", async () => {
    fetchTimes = hourlyFetches(at(-2 * HOUR_IN_MS));

    await expect(
      SecurityBlocklistFeedHealth.checkFeed({
        feed: feed({ lastFetchedAt: at(-2 * HOUR_IN_MS) }),
        now: NOW,
      }),
    ).resolves.toBe(false);

    expect(compareAndSet).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("is reported once: a feed its owners were told of is left alone until a fetch clears it", async () => {
    await expect(
      SecurityBlocklistFeedHealth.checkFeed({
        feed: feed({ stoppedReadingToldAt: at(-HOUR_IN_MS) }),
        now: NOW,
      }),
    ).resolves.toBe(false);

    expect(compareAndSet).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("is told by one server only: a claim another server won sends nothing", async () => {
    isClaimed = false;

    await expect(
      SecurityBlocklistFeedHealth.checkFeed({ feed: feed(), now: NOW }),
    ).resolves.toBe(false);

    expect(compareAndSet).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("is not reported when its secret was revoked: nothing stopped working", async () => {
    await expect(
      SecurityBlocklistFeedHealth.checkFeed({
        feed: feed({ secretHint: null as unknown as string }),
        now: NOW,
      }),
    ).resolves.toBe(false);

    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("an hourly firewall fetched once is not reported ten minutes later, and is three hours later", async () => {
    // One fetch: no usual interval yet, so OPNsense's hour stands in for it.
    fetchTimes = [at(-20 * MINUTE_IN_MS)];
    const opnsense: SecurityBlocklistFeed = feed({
      firewall: SecurityBlocklistFeedFirewall.OPNsense,
      lastFetchedAt: at(-20 * MINUTE_IN_MS),
      usualFetchIntervalInSeconds: null as unknown as number,
    });

    await expect(
      SecurityBlocklistFeedHealth.checkFeed({ feed: opnsense, now: NOW }),
    ).resolves.toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();

    fetchTimes = [at(-3 * HOUR_IN_MS - MINUTE_IN_MS)];
    await expect(
      SecurityBlocklistFeedHealth.checkFeed({
        feed: feed({
          firewall: SecurityBlocklistFeedFirewall.OPNsense,
          lastFetchedAt: at(-3 * HOUR_IN_MS - MINUTE_IN_MS),
          usualFetchIntervalInSeconds: null as unknown as number,
        }),
        now: NOW,
      }),
    ).resolves.toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  test("a feed no firewall has fetched is not set up yet, and is not reported", async () => {
    fetchTimes = [];

    await expect(
      SecurityBlocklistFeedHealth.checkFeed({
        feed: feed({ lastFetchedAt: null as unknown as Date }),
        now: NOW,
      }),
    ).resolves.toBe(false);

    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe("how often a feed is fetched", () => {
  test("is kept on the feed when it moved, and left alone when it did not", async () => {
    // Every hour, as the feed already says.
    fetchTimes = hourlyFetches(at(-30 * MINUTE_IN_MS));
    await SecurityBlocklistFeedHealth.checkFeed({
      feed: feed({ lastFetchedAt: at(-30 * MINUTE_IN_MS) }),
      now: NOW,
    });
    expect(updateColumns).not.toHaveBeenCalled();

    // Now every 5 minutes.
    fetchTimes = Array.from({ length: 6 }, (_: unknown, index: number) => {
      return at(-index * 5 * MINUTE_IN_MS);
    });
    await SecurityBlocklistFeedHealth.checkFeed({
      feed: feed({ lastFetchedAt: NOW }),
      now: NOW,
    });
    expect(updateColumns).toHaveBeenCalledTimes(1);
    expect(updateColumns.mock.calls[0]![0]).toEqual({
      id: feed().id,
      data: { usualFetchIntervalInSeconds: 300 },
    });
  });
});

describe("one pass over every feed", () => {
  test("checks every feed a firewall has fetched, and one that fails does not stop the others", async () => {
    const first: SecurityBlocklistFeed = feed({
      id: new ObjectID("83333333-3333-4333-8333-333333333333"),
    });
    const second: SecurityBlocklistFeed = feed();

    const findBy: MockedFn = jest
      .spyOn(SecurityBlocklistFeedService, "findBy")
      .mockResolvedValue([first, second] as never) as unknown as MockedFn;

    let reads: number = 0;
    jest
      .spyOn(SecurityBlocklistFeedFetchService, "findLatestFetchTimes")
      .mockImplementation(async (): Promise<Array<Date>> => {
        reads++;

        if (reads === 1) {
          throw new Error("The database is not reachable.");
        }

        return hourlyFetches(at(-4 * HOUR_IN_MS));
      });

    await expect(SecurityBlocklistFeedHealth.checkFeeds(NOW)).resolves.toEqual({
      checked: 2,
      told: 1,
    });

    // Read as OneUptime, the firewall and the secret's hint with them - never the secret.
    const select: Record<string, unknown> = (
      findBy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["firewall"]).toBe(true);
    expect(select["secretHint"]).toBe(true);
    expect(select["secret"]).toBeUndefined();
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe("the email", () => {
  test("names the feed, escaped, says since when and links its page", () => {
    const html: string = SecurityBlocklistFeedHealth.getHtml({
      projectId: PROJECT_ID,
      feedId: new ObjectID("84444444-4444-4444-8444-444444444444"),
      feedName: "Edge <b>firewall</b>",
      lastFetchedAt: at(-3 * 24 * HOUR_IN_MS),
      usualIntervalInMs: null,
      now: NOW,
    });

    expect(html).toContain("Edge &lt;b&gt;firewall&lt;/b&gt;");
    expect(html).not.toContain("<b>firewall</b>");
    expect(html).toContain(`3${NO_BREAK_SPACE}days ago.`);
    expect(html).not.toContain("usually reads it");
    expect(html).toContain(
      "a secret replaced more than a day ago no longer works",
    );
  });

  test("a feed with no name is the project's feed", () => {
    expect(SecurityBlocklistFeedHealth.getSubject("  ")).toBe(
      "Your firewall stopped reading the blocklist feed of your project",
    );
  });

  test("a length of time reads in minutes, hours or days, its figure kept to its word", () => {
    expect(describeSecurityBlocklistFeedDuration(30 * 1000)).toBe(
      `1${NO_BREAK_SPACE}minute`,
    );
    expect(describeSecurityBlocklistFeedDuration(45 * MINUTE_IN_MS)).toBe(
      `45${NO_BREAK_SPACE}minutes`,
    );
    expect(describeSecurityBlocklistFeedDuration(5 * HOUR_IN_MS)).toBe(
      `5${NO_BREAK_SPACE}hours`,
    );
    expect(describeSecurityBlocklistFeedDuration(3 * 24 * HOUR_IN_MS)).toBe(
      `3${NO_BREAK_SPACE}days`,
    );
  });
});
