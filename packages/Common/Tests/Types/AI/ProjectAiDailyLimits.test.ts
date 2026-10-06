import ProjectAiDailyLimits, {
  MAX_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD,
  MAX_PROJECT_AI_DAILY_TOKEN_LIMIT,
  MIN_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD,
  MIN_PROJECT_AI_DAILY_TOKEN_LIMIT,
  PROJECT_AI_DAILY_LIMIT_REACHED_AT_COLUMNS,
  PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS,
  PROJECT_AI_DAILY_LIMITS_LOCATION,
  PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
  PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
  ProjectAiDailyLimit,
  ProjectAiDailyLimitValues,
  WHO_CAN_CHANGE_PROJECT_AI_DAILY_LIMITS,
} from "../../../Types/AI/ProjectAiDailyLimits";
import Project from "../../../Models/DatabaseModels/Project";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import { getWhoCanTurnOnClause } from "../../../Utils/Project/NotificationChannels";
import { describe, expect, test } from "@jest/globals";

/*
 * A project's own daily limits on OneUptime AI (Project Settings → AI
 * Features → More settings): what a stored value means, which limit stops
 * AI, when a day starts and ends, and what may be saved. The server
 * enforces with these and the dashboard offers with these, so they read a
 * value the same way.
 */

const NO_LIMITS: ProjectAiDailyLimitValues = {
  tokenLimit: null,
  spendLimitInUSD: null,
};

describe("the columns that hold the limits", () => {
  test("are the two Project number columns, nullable, with no default", () => {
    const project: Project = new Project();

    for (const column of [
      PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
      PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
    ]) {
      const metadata: ReturnType<typeof project.getTableColumnMetadata> =
        project.getTableColumnMetadata(column);

      expect([column, metadata?.type]).toEqual([
        column,
        TableColumnType.Number,
      ]);
      expect([column, metadata?.required]).toEqual([column, false]);
      // No default: every project starts with no limit.
      expect([column, metadata?.defaultValue]).toEqual([column, undefined]);
      expect([column, metadata?.isDefaultValueColumn]).toEqual([
        column,
        undefined,
      ]);
    }
  });

  test("are named for what they hold", () => {
    expect(PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN).toBe("aiDailyTokenLimit");
    expect(PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN).toBe("aiDailySpendLimitInUSD");
  });
});

describe("ProjectAiDailyLimits.getLimit", () => {
  test.each([
    [null],
    [undefined],
    [""],
    ["   "],
    ["abc"],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [{}],
    [true],
  ])("%p is no limit", (value: unknown) => {
    expect(ProjectAiDailyLimits.getLimit(value)).toBeNull();
  });

  test("a stored number is the limit", () => {
    expect(ProjectAiDailyLimits.getLimit(1)).toBe(1);
    expect(ProjectAiDailyLimits.getLimit(200000)).toBe(200000);
    expect(ProjectAiDailyLimits.getLimit("200000")).toBe(200000);
    expect(ProjectAiDailyLimits.getLimit(" 25 ")).toBe(25);
  });

  test("a fraction reads as the whole number below it", () => {
    expect(ProjectAiDailyLimits.getLimit(12.9)).toBe(12);
  });

  /*
   * A value below 1 cannot be saved. If a row ever held one it reads as a
   * limit already reached, never as no limit: a ceiling that cannot be read
   * is not waved through.
   */
  test("a value below 1 reads as nothing allowed, not as no limit", () => {
    expect(ProjectAiDailyLimits.getLimit(0)).toBe(0);
    expect(ProjectAiDailyLimits.getLimit(-5)).toBe(0);
    expect(
      ProjectAiDailyLimits.getReachedLimit({
        limits: { tokenLimit: 0, spendLimitInUSD: null },
        usage: { usedTokensToday: 0, spentTodayInUSDCents: 0 },
        isSpendCounted: false,
      }),
    ).toBe(ProjectAiDailyLimit.Tokens);
  });
});

describe("ProjectAiDailyLimits.getLimits", () => {
  test("no row, or a row with nothing set, is no limit", () => {
    expect(
      ProjectAiDailyLimits.getLimits({ project: null, isBillingEnabled: true }),
    ).toEqual(NO_LIMITS);
    expect(
      ProjectAiDailyLimits.getLimits({ project: {}, isBillingEnabled: true }),
    ).toEqual(NO_LIMITS);
  });

  test("with billing on, both limits are read", () => {
    expect(
      ProjectAiDailyLimits.getLimits({
        project: { aiDailyTokenLimit: 200000, aiDailySpendLimitInUSD: 25 },
        isBillingEnabled: true,
      }),
    ).toEqual({ tokenLimit: 200000, spendLimitInUSD: 25 });
  });

  /*
   * Where AI is not billed nothing is spent, so a spend limit - one left
   * over from somewhere, or written past the API's refusal - limits nothing.
   */
  test("with billing off, a spend limit is no limit and the token limit still holds", () => {
    expect(
      ProjectAiDailyLimits.getLimits({
        project: { aiDailyTokenLimit: 200000, aiDailySpendLimitInUSD: 25 },
        isBillingEnabled: false,
      }),
    ).toEqual({ tokenLimit: 200000, spendLimitInUSD: null });
  });
});

describe("ProjectAiDailyLimits.hasLimit", () => {
  test("is true when either limit is set", () => {
    expect(ProjectAiDailyLimits.hasLimit(NO_LIMITS)).toBe(false);
    expect(
      ProjectAiDailyLimits.hasLimit({ tokenLimit: 1, spendLimitInUSD: null }),
    ).toBe(true);
    expect(
      ProjectAiDailyLimits.hasLimit({ tokenLimit: null, spendLimitInUSD: 5 }),
    ).toBe(true);
  });
});

describe("ProjectAiDailyLimits.getReachedLimit", () => {
  const limits: ProjectAiDailyLimitValues = {
    tokenLimit: 1000,
    spendLimitInUSD: 2,
  };

  test("nothing is reached with no limit, however much was used", () => {
    expect(
      ProjectAiDailyLimits.getReachedLimit({
        limits: NO_LIMITS,
        usage: {
          usedTokensToday: 999_999_999,
          spentTodayInUSDCents: 999_999,
        },
        isSpendCounted: true,
      }),
    ).toBeNull();
  });

  test.each([
    [999, null],
    [1000, ProjectAiDailyLimit.Tokens],
    [1001, ProjectAiDailyLimit.Tokens],
  ])(
    "%s tokens used against a 1,000-token limit: %s",
    (used: number, expected: ProjectAiDailyLimit | null) => {
      expect(
        ProjectAiDailyLimits.getReachedLimit({
          limits: { tokenLimit: 1000, spendLimitInUSD: null },
          usage: { usedTokensToday: used, spentTodayInUSDCents: 0 },
          isSpendCounted: true,
        }),
      ).toBe(expected);
    },
  );

  test.each([
    [199, null],
    [200, ProjectAiDailyLimit.Spend],
    [201, ProjectAiDailyLimit.Spend],
  ])(
    "%s cents spent against a $2 limit, on billed work: %s",
    (spentCents: number, expected: ProjectAiDailyLimit | null) => {
      expect(
        ProjectAiDailyLimits.getReachedLimit({
          limits: { tokenLimit: null, spendLimitInUSD: 2 },
          usage: { usedTokensToday: 0, spentTodayInUSDCents: spentCents },
          isSpendCounted: true,
        }),
      ).toBe(expected);
    },
  );

  /*
   * A spend limit never stops work that is not billed: AI on the project's
   * own LLM provider costs no AI credits.
   */
  test("a spend limit reached does not stop work that is not billed", () => {
    expect(
      ProjectAiDailyLimits.getReachedLimit({
        limits: { tokenLimit: null, spendLimitInUSD: 2 },
        usage: { usedTokensToday: 0, spentTodayInUSDCents: 5000 },
        isSpendCounted: false,
      }),
    ).toBeNull();
  });

  test("the token limit is said first when both are reached", () => {
    expect(
      ProjectAiDailyLimits.getReachedLimit({
        limits,
        usage: { usedTokensToday: 5000, spentTodayInUSDCents: 5000 },
        isSpendCounted: true,
      }),
    ).toBe(ProjectAiDailyLimit.Tokens);
  });

  test("the token limit stops unbilled work too", () => {
    expect(
      ProjectAiDailyLimits.getReachedLimit({
        limits,
        usage: { usedTokensToday: 1000, spentTodayInUSDCents: 0 },
        isSpendCounted: false,
      }),
    ).toBe(ProjectAiDailyLimit.Tokens);
  });
});

/*
 * A day is a UTC day, like the incident and alert daily limits: usage is
 * counted from midnight UTC and starts again at the next midnight UTC,
 * whatever the server's own time zone.
 */
describe("the day the limits count", () => {
  test.each([
    ["2026-10-05T00:00:00.000Z", "2026-10-05T00:00:00.000Z"],
    ["2026-10-05T00:00:00.001Z", "2026-10-05T00:00:00.000Z"],
    ["2026-10-05T13:45:12.345Z", "2026-10-05T00:00:00.000Z"],
    ["2026-10-05T23:59:59.999Z", "2026-10-05T00:00:00.000Z"],
    ["2026-12-31T23:30:00.000Z", "2026-12-31T00:00:00.000Z"],
    ["2028-02-29T10:00:00.000Z", "2028-02-29T00:00:00.000Z"],
  ])("at %s the day began at %s", (now: string, dayStart: string) => {
    expect(ProjectAiDailyLimits.getDayStart(new Date(now)).toISOString()).toBe(
      dayStart,
    );
  });

  test.each([
    ["2026-10-05T00:00:00.000Z", "2026-10-06T00:00:00.000Z"],
    ["2026-10-05T23:59:59.999Z", "2026-10-06T00:00:00.000Z"],
    ["2026-12-31T23:30:00.000Z", "2027-01-01T00:00:00.000Z"],
    ["2028-02-28T08:00:00.000Z", "2028-02-29T00:00:00.000Z"],
  ])("at %s the count starts again at %s", (now: string, reset: string) => {
    expect(ProjectAiDailyLimits.getNextReset(new Date(now)).toISOString()).toBe(
      reset,
    );
  });

  // Across a daylight saving change a local day can be 23 or 25 hours.
  test("a UTC day is always 24 hours, whatever a local clock does", () => {
    for (const now of [
      "2026-03-29T01:30:00.000Z",
      "2026-10-25T01:30:00.000Z",
      "2026-03-08T07:30:00.000Z",
      "2026-11-01T06:30:00.000Z",
    ]) {
      const start: Date = ProjectAiDailyLimits.getDayStart(new Date(now));
      const reset: Date = ProjectAiDailyLimits.getNextReset(new Date(now));

      expect(reset.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    }
  });
});

describe("ProjectAiDailyLimits.getWriteError", () => {
  test("clearing a limit is always allowed", () => {
    expect(
      ProjectAiDailyLimits.getWriteError(
        PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
        null,
      ),
    ).toBeNull();
    expect(
      ProjectAiDailyLimits.getWriteError(
        PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
        undefined,
      ),
    ).toBeNull();
  });

  test.each([
    [MIN_PROJECT_AI_DAILY_TOKEN_LIMIT],
    [200000],
    [MAX_PROJECT_AI_DAILY_TOKEN_LIMIT],
  ])("a token limit of %s may be saved", (value: number) => {
    expect(
      ProjectAiDailyLimits.getWriteError(
        PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
        value,
      ),
    ).toBeNull();
  });

  test.each([
    [MIN_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD],
    [25],
    [MAX_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD],
  ])("a spend limit of $%s may be saved", (value: number) => {
    expect(
      ProjectAiDailyLimits.getWriteError(
        PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
        value,
      ),
    ).toBeNull();
  });

  /*
   * 0 is refused rather than read as "pause": Enable AI is the project's one
   * AI switch, and the message says so.
   */
  test.each([
    [0],
    [-1],
    [1.5],
    [MAX_PROJECT_AI_DAILY_TOKEN_LIMIT + 1],
    ["200000"],
    ["abc"],
    [Number.NaN],
    [true],
  ])(
    "a token limit of %p is refused, pointing at Enable AI",
    (value: unknown) => {
      const error: string | null = ProjectAiDailyLimits.getWriteError(
        PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
        value,
      );

      expect(error).toBe(
        "The daily AI token limit must be a whole number from 1 to 2,000,000,000. Leave it empty for no limit. To turn OneUptime AI off, use Enable AI.",
      );
    },
  );

  test.each([[0], [-25], [2.5], [MAX_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD + 1]])(
    "a spend limit of %p is refused",
    (value: unknown) => {
      expect(
        ProjectAiDailyLimits.getWriteError(
          PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
          value,
        ),
      ).toBe(
        "The daily AI spend limit must be a whole number of US dollars from 1 to 1,000,000. Leave it empty for no limit. To turn OneUptime AI off, use Enable AI.",
      );
    },
  );

  test("the bounds fit the integer columns that hold them", () => {
    expect(MAX_PROJECT_AI_DAILY_TOKEN_LIMIT).toBeLessThanOrEqual(2147483647);
    expect(MAX_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD).toBeLessThanOrEqual(
      2147483647,
    );
    expect(MIN_PROJECT_AI_DAILY_TOKEN_LIMIT).toBe(1);
    expect(MIN_PROJECT_AI_DAILY_SPEND_LIMIT_IN_USD).toBe(1);
  });
});

describe("ProjectAiDailyLimits.formatUsd", () => {
  test.each([
    [0, "$0"],
    [2500, "$25"],
    [320, "$3.20"],
    [5, "$0.05"],
    [123456700, "$1,234,567"],
    [-100, "$0"],
  ])("%s cents is %s", (cents: number, text: string) => {
    expect(ProjectAiDailyLimits.formatUsd(cents)).toBe(text);
  });
});

/*
 * When a limit last stopped AI, the sentences everything that says so is
 * made of, and who may change the limits - shared by the server's refusal,
 * the owners' email and the investigation catch-up.
 */
describe("ProjectAiDailyLimits.isToday", () => {
  const NOW: Date = new Date("2026-10-07T15:30:00.000Z");

  test.each([
    ["midnight UTC, the day's first moment", "2026-10-07T00:00:00.000Z", true],
    ["a moment ago", "2026-10-07T15:29:59.000Z", true],
    ["the last moment of yesterday", "2026-10-06T23:59:59.999Z", false],
    ["the next midnight UTC", "2026-10-08T00:00:00.000Z", false],
  ])("%s: %s is today: %s", (_label: string, at: string, today: boolean) => {
    expect(ProjectAiDailyLimits.isToday(new Date(at), NOW)).toBe(today);
    expect(ProjectAiDailyLimits.isToday(at, NOW)).toBe(today);
  });

  test("never, unknown or not a date is not today", () => {
    expect(ProjectAiDailyLimits.isToday(null, NOW)).toBe(false);
    expect(ProjectAiDailyLimits.isToday(undefined, NOW)).toBe(false);
    expect(ProjectAiDailyLimits.isToday("not a date", NOW)).toBe(false);
  });
});

describe("ProjectAiDailyLimits.getReachedSentence", () => {
  test("the token limit: what was used of it today", () => {
    expect(
      ProjectAiDailyLimits.getReachedSentence({
        reachedLimit: ProjectAiDailyLimit.Tokens,
        tokenLimit: 200000,
        spendLimitInUSD: null,
        usage: { usedTokensToday: 201234, spentTodayInUSDCents: 0 },
      }),
    ).toBe(
      "This project has reached its daily AI token limit: 201,234 of 200,000 tokens used today.",
    );
  });

  test("the spend limit, in dollars", () => {
    expect(
      ProjectAiDailyLimits.getReachedSentence({
        reachedLimit: ProjectAiDailyLimit.Spend,
        tokenLimit: 5000,
        spendLimitInUSD: 25,
        usage: { usedTokensToday: 9_000_000, spentTodayInUSDCents: 2503 },
      }),
    ).toBe(
      "This project has reached its daily AI spend limit: $25.03 of $25 spent today.",
    );
  });
});

describe("who may change the limits, and where", () => {
  test("the update permissions of both limit columns, as the model declares them", () => {
    const project: Project = new Project();

    for (const column of [
      PROJECT_AI_DAILY_TOKEN_LIMIT_COLUMN,
      PROJECT_AI_DAILY_SPEND_LIMIT_COLUMN,
    ]) {
      expect(project.getColumnAccessControlFor(column)?.update).toEqual(
        PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS,
      );
    }

    expect(PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);
  });

  test("named in the words every who-can sentence uses for those permissions", () => {
    expect(WHO_CAN_CHANGE_PROJECT_AI_DAILY_LIMITS).toBe(
      "a project owner or someone with Manage Billing",
    );
    // The same people, in the same words, as the notification channels' switches.
    expect(
      getWhoCanTurnOnClause("it").startsWith(
        WHO_CAN_CHANGE_PROJECT_AI_DAILY_LIMITS,
      ),
    ).toBe(true);
  });

  test("the sentence said to whoever met the limit names them rather than telling the reader to", () => {
    expect(ProjectAiDailyLimits.getWhoCanChangeSentence()).toBe(
      "A project owner or someone with Manage Billing can raise or remove the limit in Project Settings → AI Features → More settings.",
    );
    expect(PROJECT_AI_DAILY_LIMITS_LOCATION).toBe(
      "Project Settings → AI Features → More settings",
    );
  });
});

describe("the columns that say when each limit last stopped AI", () => {
  test("one per limit, internal, nullable dates", () => {
    expect(PROJECT_AI_DAILY_LIMIT_REACHED_AT_COLUMNS).toEqual({
      [ProjectAiDailyLimit.Tokens]: "aiDailyTokenLimitReachedAt",
      [ProjectAiDailyLimit.Spend]: "aiDailySpendLimitReachedAt",
    });

    const project: Project = new Project();

    for (const column of Object.values(
      PROJECT_AI_DAILY_LIMIT_REACHED_AT_COLUMNS,
    )) {
      expect(project.getTableColumnMetadata(column)?.type).toBe(
        TableColumnType.Date,
      );
      expect(project.getTableColumnMetadata(column)?.required).toBe(false);
      expect(project.getColumnAccessControlFor(column)).toEqual({
        create: [],
        read: [],
        update: [],
      });
    }
  });
});
