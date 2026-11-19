import DataMigrationService from "../../../../Server/Services/DataMigrationService";
import logger from "../../../../Server/Utils/Logger";
import OnCallAcknowledgeLink, {
  ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME,
  ON_CALL_LINK_TOKEN_ROLLOUT_MS,
  ON_CALL_LINK_TOKEN_UPGRADE_CHECK_TTL_MS,
  ON_CALL_LINK_WITHOUT_TOKEN_LIFETIME_MS,
  OnCallAcknowledgeLinkProof,
} from "../../../../Server/Utils/OnCall/OnCallAcknowledgeLink";
import OnCallPageLinkToken, {
  ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS,
} from "../../../../Server/Utils/OnCall/OnCallPageLinkToken";
import DataMigration from "../../../../Models/DatabaseModels/DataMigration";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT LETS A LINK IN A PERSON'S OWN PAGE ACKNOWLEDGE IT (#10025).
 *
 * The page's own token (OnCallPageLinkToken), which every link OneUptime
 * sends carries now - or, for a link sent before links carried one, that
 * its page was sent before the server was upgraded (the first run of the
 * RequireTokenToAcknowledgeOnCallPages data migration), or within the hour
 * after while the release before may still send, and less than a week
 * ago. These pin those bounds, and how seldom the upgrade is read.
 */

const NOTIFICATION: ObjectID = new ObjectID(
  "0fd00000-0000-4000-8000-000000000001",
);

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

const NOW: Date = new Date("2026-11-19T09:00:00.000Z");
const UPGRADED_AT: Date = new Date("2026-11-19T06:00:00.000Z");

let upgradeRead: jest.SpiedFunction<typeof DataMigrationService.findOneBy>;

function migrationRow(data: {
  executedAt?: Date | undefined;
  createdAt?: Date | undefined;
}): DataMigration {
  const row: DataMigration = new DataMigration();
  row.name = ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME;
  row.executed = true;

  if (data.executedAt) {
    row.executedAt = data.executedAt;
  }

  if (data.createdAt) {
    row.createdAt = data.createdAt;
  }

  return row;
}

function sentAgo(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

beforeEach(() => {
  OnCallAcknowledgeLink.forget();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(new Date(NOW));
  upgradeRead = jest
    .spyOn(DataMigrationService, "findOneBy")
    .mockResolvedValue(migrationRow({ executedAt: UPGRADED_AT }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("its bounds", () => {
  test("a link without a token lives a week, as a page's token does; a rolling upgrade has an hour", () => {
    expect(ON_CALL_LINK_WITHOUT_TOKEN_LIFETIME_MS).toBe(7 * DAY_MS);
    expect(ON_CALL_LINK_WITHOUT_TOKEN_LIFETIME_MS).toBe(
      ON_CALL_PAGE_LINK_TOKEN_EXPIRES_IN_SECONDS * 1000,
    );
    expect(ON_CALL_LINK_TOKEN_ROLLOUT_MS).toBe(HOUR_MS);
    expect(ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME).toBe(
      "RequireTokenToAcknowledgeOnCallPages",
    );
  });
});

describe("the proof a link shows", () => {
  test("the page's own token, whenever the page was sent - and the upgrade is not read", async () => {
    for (const sentAt of [sentAgo(HOUR_MS), sentAgo(30 * DAY_MS), undefined]) {
      expect(
        await OnCallAcknowledgeLink.getProof({
          token: OnCallPageLinkToken.sign({
            userOnCallLogTimelineId: NOTIFICATION,
          }),
          userOnCallLogTimelineId: NOTIFICATION,
          sentAt: sentAt,
        }),
      ).toBe(OnCallAcknowledgeLinkProof.PageToken);
    }

    expect(upgradeRead).not.toHaveBeenCalled();
  });

  test("no token, on a page sent before the upgrade, less than a week ago", async () => {
    expect(
      await OnCallAcknowledgeLink.getProof({
        token: undefined,
        userOnCallLogTimelineId: NOTIFICATION,
        sentAt: sentAgo(DAY_MS),
      }),
    ).toBe(OnCallAcknowledgeLinkProof.SentBeforeTokens);
  });

  test("no token, on a page sent after the upgrade: none", async () => {
    expect(
      await OnCallAcknowledgeLink.getProof({
        token: undefined,
        userOnCallLogTimelineId: NOTIFICATION,
        sentAt: sentAgo(HOUR_MS),
      }),
    ).toBe(OnCallAcknowledgeLinkProof.None);
  });

  test("a token of another notification proves nothing more than no token", async () => {
    const otherToken: string = OnCallPageLinkToken.sign({
      userOnCallLogTimelineId: new ObjectID(
        "0fd00000-0000-4000-8000-000000000002",
      ),
    });

    expect(
      await OnCallAcknowledgeLink.getProof({
        token: otherToken,
        userOnCallLogTimelineId: NOTIFICATION,
        sentAt: sentAgo(HOUR_MS),
      }),
    ).toBe(OnCallAcknowledgeLinkProof.None);
    expect(
      await OnCallAcknowledgeLink.getProof({
        token: otherToken,
        userOnCallLogTimelineId: NOTIFICATION,
        sentAt: sentAgo(DAY_MS),
      }),
    ).toBe(OnCallAcknowledgeLinkProof.SentBeforeTokens);
  });
});

describe("a page sent before links carried a token", () => {
  // It is 9 AM; the server was upgraded at 6 AM.
  test.each([
    ["sent a day ago, before the upgrade", true, DAY_MS],
    ["sent six days and 23 hours ago", true, 7 * DAY_MS - HOUR_MS],
    ["sent a week and a minute ago", false, 7 * DAY_MS + 60 * 1000],
    [
      "sent at 6:01 AM, a minute after the upgrade",
      true,
      2 * HOUR_MS + 59 * 60 * 1000,
    ],
    [
      "sent at 6:59 AM, 59 minutes after the upgrade",
      true,
      2 * HOUR_MS + 60 * 1000,
    ],
    [
      "sent at 7:01 AM, 61 minutes after the upgrade",
      false,
      HOUR_MS + 59 * 60 * 1000,
    ],
    ["sent a minute ago", false, 60 * 1000],
  ])(
    "%s: taken without a token, %p",
    async (_name: string, isTaken: boolean, ageMs: number) => {
      expect(
        await OnCallAcknowledgeLink.isSentBeforeTokens(sentAgo(ageMs)),
      ).toBe(isTaken);
    },
  );

  test("a time as text, as a row read from JSON holds it, is read as a time", async () => {
    expect(
      await OnCallAcknowledgeLink.isSentBeforeTokens(
        sentAgo(DAY_MS).toISOString(),
      ),
    ).toBe(true);
  });

  test("no time, or no time at all, is no page sent before the upgrade", async () => {
    for (const sentAt of [undefined, null, "", "yesterday"]) {
      expect(await OnCallAcknowledgeLink.isSentBeforeTokens(sentAt)).toBe(
        false,
      );
    }

    expect(upgradeRead).not.toHaveBeenCalled();
  });

  test("a page older than a week is refused without reading the upgrade", async () => {
    expect(
      await OnCallAcknowledgeLink.isSentBeforeTokens(sentAgo(8 * DAY_MS)),
    ).toBe(false);
    expect(upgradeRead).not.toHaveBeenCalled();
  });
});

describe("when the server was upgraded", () => {
  test("is the first run of the data migration that records it", async () => {
    expect(await OnCallAcknowledgeLink.getUpgradedAt()).toEqual(UPGRADED_AT);

    const asked: {
      query: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = upgradeRead.mock.calls[0]![0] as never;

    expect(asked.query).toEqual({
      name: ON_CALL_ACKNOWLEDGE_TOKEN_MIGRATION_NAME,
      executed: true,
    });
    expect(asked.sort).toEqual({ executedAt: "ASC" });
  });

  test("a row without its run's time is read by when it was written", async () => {
    upgradeRead.mockResolvedValue(
      migrationRow({ createdAt: UPGRADED_AT }) as never,
    );

    expect(await OnCallAcknowledgeLink.getUpgradedAt()).toEqual(UPGRADED_AT);
  });

  test("once found, it is never asked of the database again", async () => {
    await OnCallAcknowledgeLink.getUpgradedAt();

    const later: jest.SpiedFunction<typeof Date.now> = jest
      .spyOn(Date, "now")
      .mockReturnValue(Date.now() + 30 * DAY_MS);

    await OnCallAcknowledgeLink.getUpgradedAt();
    await OnCallAcknowledgeLink.isSentBeforeTokens(sentAgo(DAY_MS));

    later.mockRestore();

    expect(upgradeRead).toHaveBeenCalledTimes(1);
  });

  test("while not recorded, it is asked again at most once a minute", async () => {
    upgradeRead.mockResolvedValue(null as never);

    const start: number = Date.now();
    const clock: jest.SpiedFunction<typeof Date.now> = jest
      .spyOn(Date, "now")
      .mockReturnValue(start);

    expect(await OnCallAcknowledgeLink.getUpgradedAt()).toBeNull();

    clock.mockReturnValue(start + ON_CALL_LINK_TOKEN_UPGRADE_CHECK_TTL_MS - 1);
    expect(await OnCallAcknowledgeLink.getUpgradedAt()).toBeNull();
    expect(upgradeRead).toHaveBeenCalledTimes(1);

    // The upgrade's data migration has run meanwhile.
    upgradeRead.mockResolvedValue(
      migrationRow({ executedAt: UPGRADED_AT }) as never,
    );
    clock.mockReturnValue(start + ON_CALL_LINK_TOKEN_UPGRADE_CHECK_TTL_MS);

    expect(await OnCallAcknowledgeLink.getUpgradedAt()).toEqual(UPGRADED_AT);
    expect(upgradeRead).toHaveBeenCalledTimes(2);
  });

  test("not recorded yet: a page sent in the last week counts as sent before it", async () => {
    upgradeRead.mockResolvedValue(null as never);

    expect(
      await OnCallAcknowledgeLink.isSentBeforeTokens(sentAgo(HOUR_MS)),
    ).toBe(true);
    expect(
      await OnCallAcknowledgeLink.isSentBeforeTokens(sentAgo(8 * DAY_MS)),
    ).toBe(false);
  });

  test("a question the database does not answer counts as not recorded yet, and is logged", async () => {
    upgradeRead.mockRejectedValue(new Error("the database is away") as never);
    const errorSpy: jest.SpiedFunction<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {});

    expect(await OnCallAcknowledgeLink.getUpgradedAt()).toBeNull();
    expect(String(errorSpy.mock.calls[0]![0])).toContain(
      "OnCallAcknowledgeLink: could not read when this server was upgraded",
    );
  });
});
