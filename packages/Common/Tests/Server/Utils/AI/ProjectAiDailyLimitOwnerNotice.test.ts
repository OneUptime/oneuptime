import ProjectAiDailyLimitOwnerNotice, {
  OWNERS_MAY_CHANGE_PROJECT_AI_DAILY_LIMITS,
  PROJECT_AI_DAILY_LIMITS_SETTINGS_PATH,
  ProjectAiDailyLimitNoticeOutcome,
  ReachedProjectAiDailyLimit,
} from "../../../../Server/Utils/AI/ProjectAiDailyLimitOwnerNotice";
import ProjectService from "../../../../Server/Services/ProjectService";
import logger from "../../../../Server/Utils/Logger";
import Project from "../../../../Models/DatabaseModels/Project";
import {
  PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS,
  ProjectAiDailyLimit,
} from "../../../../Types/AI/ProjectAiDailyLimits";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The email the project's owners get the first time one of its own daily
 * AI limits stops OneUptime AI on a UTC day (the delivery through
 * AIService is in Tests/Server/Services/AIServiceDailyLimitOwnerNotice).
 *
 * These pin what it says - which limit, what was used of it today, until
 * when AI is paused, what happens to the incidents and alerts it skips, and
 * where the limit is changed, with a link only for people who may change it
 * - and how "once a day for each limit" is decided: by the database's
 * conditional UPDATE, with the row a caller already read and this process's
 * memory saving the round trip, and never at the cost of the caller.
 */

type MockGlobal = typeof globalThis & {
  __ownerNoticeDashboardUrl: string;
};

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const urlModule: { default: { fromString: (url: string) => unknown } } =
    jest.requireActual("../../../../Types/API/URL");
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockGlobal = globalThis as MockGlobal;
  mockGlobal.__ownerNoticeDashboardUrl =
    "https://oneuptime.example.com/dashboard";

  Object.defineProperty(mocked, "DashboardClientUrl", {
    configurable: true,
    enumerable: true,
    get: (): unknown => {
      return urlModule.default.fromString(mockGlobal.__ownerNoticeDashboardUrl);
    },
  });

  return mocked;
});

function setDashboardUrl(url: string): void {
  (globalThis as MockGlobal).__ownerNoticeDashboardUrl = url;
}

const NOW: Date = new Date("2026-10-05T15:30:00.000Z");
const RESETS_AT: Date = new Date("2026-10-06T00:00:00.000Z");

function tokenLimitReached(
  values: Partial<ReachedProjectAiDailyLimit> = {},
): ReachedProjectAiDailyLimit {
  return {
    reachedLimit: ProjectAiDailyLimit.Tokens,
    tokenLimit: 200_000,
    spendLimitInUSD: null,
    usage: { usedTokensToday: 201_234, spentTodayInUSDCents: 0 },
    resetsAt: RESETS_AT,
    ...values,
  };
}

function spendLimitReached(): ReachedProjectAiDailyLimit {
  return {
    reachedLimit: ProjectAiDailyLimit.Spend,
    tokenLimit: null,
    spendLimitInUSD: 25,
    usage: { usedTokensToday: 9_000_000, spentTodayInUSDCents: 2503 },
    resetsAt: RESETS_AT,
  };
}

let claim: jest.SpyInstance;
let ownerEmails: jest.SpyInstance;
let projectRead: jest.SpyInstance;

beforeEach(() => {
  setDashboardUrl("https://oneuptime.example.com/dashboard");

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });

  claim = jest
    .spyOn(ProjectService, "markAiDailyLimitReached")
    .mockResolvedValue(true);
  ownerEmails = jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockResolvedValue(undefined);
  projectRead = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ name: "Acme Production" } as unknown as Project);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what the email says", () => {
  test("the subject names the limit and the project", () => {
    expect(
      ProjectAiDailyLimitOwnerNotice.getSubject({
        limit: ProjectAiDailyLimit.Tokens,
        projectName: "Acme Production",
      }),
    ).toBe("Daily AI token limit reached for Acme Production");
    expect(
      ProjectAiDailyLimitOwnerNotice.getSubject({
        limit: ProjectAiDailyLimit.Spend,
        projectName: "  Acme Production  ",
      }),
    ).toBe("Daily AI spend limit reached for Acme Production");
    expect(
      ProjectAiDailyLimitOwnerNotice.getSubject({
        limit: ProjectAiDailyLimit.Tokens,
      }),
    ).toBe("Daily AI token limit reached for your project");
  });

  test("the token limit: which limit and today's usage, until when AI is paused, the skipped incidents and alerts, and the link", () => {
    const projectId: ObjectID = ObjectID.generate();
    const html: string = ProjectAiDailyLimitOwnerNotice.getHtml({
      projectId,
      status: tokenLimitReached(),
    });
    const link: string = `https://oneuptime.example.com/dashboard/${projectId.toString()}/settings/ai-features`;

    expect(html).toBe(
      [
        "This project has reached its daily AI token limit: 201,234 of 200,000 tokens used today. OneUptime AI is paused until 00:00 UTC on Oct 6, 2026, when the day&#39;s count starts again.",
        "Incidents and alerts that are not investigated while it is paused are investigated after the reset, if they are still open.",
        `To raise or remove the limit, go to Project Settings → AI Features → More settings: <br/> <a href="${link}">${link}</a>`,
        "Project owners get this email once a day for each limit, the first time it is reached.",
      ].join(" <br/> <br/> "),
    );
  });

  test("the spend limit: in dollars, and only AI billed to the credits is paused", () => {
    const html: string = ProjectAiDailyLimitOwnerNotice.getHtml({
      projectId: ObjectID.generate(),
      status: spendLimitReached(),
    });

    expect(html).toContain(
      "This project has reached its daily AI spend limit: $25.03 of $25 spent today. AI billed to the project&#39;s AI credits is paused until 00:00 UTC on Oct 6, 2026",
    );
    expect(html).not.toContain("tokens used today");
  });

  test("the link only for people who may change the limit: anyone else is told who can", () => {
    const html: string = ProjectAiDailyLimitOwnerNotice.getHtml({
      projectId: ObjectID.generate(),
      status: tokenLimitReached(),
      mayChangeLimits: false,
    });

    expect(html).not.toContain("<a ");
    expect(html).not.toContain("settings/ai-features");
    expect(html).toContain(
      "A project owner or someone with Manage Billing can raise or remove the limit in Project Settings → AI Features → More settings.",
    );
  });

  test("without a dashboard address (no HOST), it says where the limit is, without a broken link", () => {
    setDashboardUrl("http:///dashboard");

    const html: string = ProjectAiDailyLimitOwnerNotice.getHtml({
      projectId: ObjectID.generate(),
      status: tokenLimitReached(),
    });

    expect(html).not.toContain("<a ");
    expect(html).toContain(
      "To raise or remove the limit, go to Project Settings → AI Features → More settings.",
    );
  });

  test("the text is escaped - the email is HTML - and the only markup is the line breaks and the link", () => {
    const projectId: ObjectID = ObjectID.generate();
    const html: string = ProjectAiDailyLimitOwnerNotice.getHtml({
      projectId,
      status: spendLimitReached(),
    });

    // "the project's AI credits", "the day's count": escaped.
    expect(html).not.toContain("'");
    expect(html).toContain("project&#39;s AI credits");

    const link: string = `https://oneuptime.example.com/dashboard/${projectId.toString()}/settings/ai-features`;
    const lineBreak: RegExp = /<br\/>/g;
    const withoutMarkup: string = html
      .replace(lineBreak, "")
      .replace(`<a href="${link}">${link}</a>`, "");

    expect(withoutMarkup).not.toMatch(/[<>]/);
  });

  test("the owners are the people who may change the limits: the column's own update list says so", () => {
    expect(OWNERS_MAY_CHANGE_PROJECT_AI_DAILY_LIMITS).toBe(true);

    for (const column of [
      "aiDailyTokenLimit",
      "aiDailySpendLimitInUSD",
    ] as const) {
      expect(new Project().getColumnAccessControlFor(column)?.update).toEqual(
        PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS,
      );
    }

    expect(PROJECT_AI_DAILY_LIMIT_UPDATE_PERMISSIONS).toContain(
      Permission.ProjectOwner,
    );
  });

  test("the link goes to the page that holds the limits: the dashboard's AI Features settings route", () => {
    const routeMap: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap.ts",
      ),
      "utf-8",
    );

    expect(PROJECT_AI_DAILY_LIMITS_SETTINGS_PATH).toBe("settings/ai-features");
    expect(routeMap).toContain('[PageMap.SETTINGS_AI_FEATURES]: "ai-features"');
    expect(routeMap).toMatch(
      /\[PageMap\.SETTINGS_AI_FEATURES\]: new Route\(\s*`\/dashboard\/\$\{RouteParams\.ProjectID\}\/settings\/\$\{\s*SettingsRoutePath\[PageMap\.SETTINGS_AI_FEATURES\]\s*\}`/,
    );
  });
});

describe("once a day for each limit", () => {
  test("the day's first: the claim is written for this limit at this moment, and the owners are emailed", async () => {
    const projectId: ObjectID = ObjectID.generate();

    expect(
      await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
        projectId,
        status: tokenLimitReached(),
      }),
    ).toBe(ProjectAiDailyLimitNoticeOutcome.Told);

    expect(claim).toHaveBeenCalledWith({
      projectId,
      limit: ProjectAiDailyLimit.Tokens,
      now: NOW,
    });
    expect(projectRead).toHaveBeenCalledWith({
      id: projectId,
      select: { name: true },
      props: { isRoot: true },
    });
    expect(ownerEmails).toHaveBeenCalledTimes(1);
    expect(ownerEmails).toHaveBeenCalledWith(
      projectId,
      "Daily AI token limit reached for Acme Production",
      ProjectAiDailyLimitOwnerNotice.getHtml({
        projectId,
        status: tokenLimitReached(),
      }),
    );
  });

  test("another server was first: the claim is lost, nobody is emailed from here", async () => {
    claim.mockResolvedValue(false);

    expect(
      await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
        projectId: ObjectID.generate(),
        status: tokenLimitReached(),
      }),
    ).toBe(ProjectAiDailyLimitNoticeOutcome.AlreadyTold);
    expect(ownerEmails).not.toHaveBeenCalled();
  });

  test("the row the caller read says it was today: no database round trip at all", async () => {
    expect(
      await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
        projectId: ObjectID.generate(),
        status: tokenLimitReached(),
        lastReachedAt: new Date("2026-10-05T00:00:00.000Z"),
      }),
    ).toBe(ProjectAiDailyLimitNoticeOutcome.AlreadyTold);
    expect(claim).not.toHaveBeenCalled();
    expect(ownerEmails).not.toHaveBeenCalled();
  });

  test("a row that says yesterday, or never, leaves it to the database", async () => {
    for (const lastReachedAt of [
      new Date("2026-10-04T23:59:59.999Z"),
      null,
      undefined,
    ]) {
      await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
        projectId: ObjectID.generate(),
        status: tokenLimitReached(),
        lastReachedAt,
      });
    }

    expect(claim).toHaveBeenCalledTimes(3);
    expect(ownerEmails).toHaveBeenCalledTimes(3);
  });

  test("this process remembers a settled day: the next refusal here costs no round trip", async () => {
    const projectId: ObjectID = ObjectID.generate();

    await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
      projectId,
      status: tokenLimitReached(),
    });
    await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
      projectId,
      status: tokenLimitReached(),
    });

    expect(claim).toHaveBeenCalledTimes(1);
    expect(ownerEmails).toHaveBeenCalledTimes(1);
  });

  test("each limit on its own: the spend limit is told the same day as the token limit", async () => {
    const projectId: ObjectID = ObjectID.generate();

    await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
      projectId,
      status: tokenLimitReached(),
    });
    await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
      projectId,
      status: spendLimitReached(),
    });

    expect(
      claim.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as { limit: ProjectAiDailyLimit }).limit;
      }),
    ).toEqual([ProjectAiDailyLimit.Tokens, ProjectAiDailyLimit.Spend]);
    expect(ownerEmails).toHaveBeenCalledTimes(2);
  });

  test("the next UTC day is a new day", async () => {
    const projectId: ObjectID = ObjectID.generate();

    await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
      projectId,
      status: tokenLimitReached(),
    });

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date("2026-10-06T00:00:01.000Z");
    });

    await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
      projectId,
      status: tokenLimitReached(),
    });

    expect(claim).toHaveBeenCalledTimes(2);
    expect(ownerEmails).toHaveBeenCalledTimes(2);
  });

  test("nothing reached, nothing done", async () => {
    expect(
      await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
        projectId: ObjectID.generate(),
        status: tokenLimitReached({ reachedLimit: null }),
      }),
    ).toBe(ProjectAiDailyLimitNoticeOutcome.NotReached);
    expect(claim).not.toHaveBeenCalled();
  });
});

describe("never at the caller's cost", () => {
  test("a claim that cannot be written is logged, sends nothing, and is tried again by the next refusal", async () => {
    const error: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined as never;
      });
    const projectId: ObjectID = ObjectID.generate();

    claim.mockRejectedValueOnce(new Error("database unavailable"));

    expect(
      await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
        projectId,
        status: tokenLimitReached(),
      }),
    ).toBe(ProjectAiDailyLimitNoticeOutcome.Failed);
    expect(ownerEmails).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);

    expect(
      await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
        projectId,
        status: tokenLimitReached(),
      }),
    ).toBe(ProjectAiDailyLimitNoticeOutcome.Told);
    expect(ownerEmails).toHaveBeenCalledTimes(1);
  });

  test("an email that fails after the claim is logged and not sent twice", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
    const projectId: ObjectID = ObjectID.generate();

    ownerEmails.mockRejectedValueOnce(new Error("no owners could be read"));

    expect(
      await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
        projectId,
        status: tokenLimitReached(),
      }),
    ).toBe(ProjectAiDailyLimitNoticeOutcome.Failed);

    expect(
      await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
        projectId,
        status: tokenLimitReached(),
      }),
    ).toBe(ProjectAiDailyLimitNoticeOutcome.AlreadyTold);
    expect(ownerEmails).toHaveBeenCalledTimes(1);
  });

  test("a project whose name cannot be read is still told", async () => {
    projectRead.mockResolvedValue(null);

    await ProjectAiDailyLimitOwnerNotice.notifyIfFirstToday({
      projectId: ObjectID.generate(),
      status: tokenLimitReached(),
    });

    expect(ownerEmails.mock.calls[0]![1]).toBe(
      "Daily AI token limit reached for your project",
    );
  });
});
