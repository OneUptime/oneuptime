import SecurityEventService from "../../../Server/Services/SecurityEventService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { readCampaignWindow } from "../../../Server/API/SecurityAttackCampaignAPI";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_ATTACK_CAMPAIGNS_MAX,
  SECURITY_ATTACK_CAMPAIGNS_MAX_DAYS,
  SecurityAttackCampaign,
} from "../../../Types/SecurityEvent/SecurityAttackCampaign";
import SecurityEventRequestOutcome from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The Campaigns page's read: the project's web attacks over a window, one
 * row per address that sent them, worst first. Every value - the project,
 * the window, the outcomes counted, the attribute keys read - is a bound
 * parameter, and the window is the page's to ask for but never longer than
 * a month or later than now.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const START: Date = new Date("2026-10-20T12:00:00.000Z");
const END: Date = new Date("2026-10-27T12:00:00.000Z");

function stubExecuteQuery(rows: Array<JSONObject>): Spy {
  getJestSpyOn(
    SecurityEventService.database,
    "getDatasourceOptions",
  ).mockReturnValue({
    database: "oneuptime",
  } as never);

  const result: Results = {
    json: (): Promise<unknown> => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  return getJestSpyOn(SecurityEventService, "executeQuery").mockResolvedValue(
    result as never,
  );
}

function statementOf(spy: Spy): Statement {
  return spy.mock.calls[0]![0] as Statement;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityEventService.findAttackCampaigns", () => {
  test("groups the window's web attacks by the address that sent them, worst first", async () => {
    const spy: Spy = stubExecuteQuery([]);

    await SecurityEventService.findAttackCampaigns({
      projectId: PROJECT_ID,
      startTime: START,
      endTime: END,
      limit: 25,
    });

    const statement: Statement = statementOf(spy);
    const query: string = statement.query.replace(/\s+/g, " ");

    expect(query).toContain(
      "SELECT principalIp AS sourceIp, count() AS requestCount",
    );
    expect(query).toContain("FROM oneuptime.SecurityEventItemV1");
    expect(query).toContain("GROUP BY sourceIp");
    expect(query).toContain(
      "ORDER BY worstOutcomeRank DESC, requestCount DESC, sourceIp ASC",
    );
    // Nothing from the request is in the text: every value is a parameter.
    expect(query).not.toContain("Reached Database");
    expect(query).not.toContain("web.attack.kind");
    expect(query).not.toContain(PROJECT_ID.toString());

    const values: Array<unknown> = Object.values(statement.query_params);

    expect(
      values.some((value: unknown): boolean => {
        return String(value) === PROJECT_ID.toString();
      }),
    ).toBe(true);
    expect(values).toContain(SecurityEventRequestOutcome.Rejected);
    expect(values).toContain(SecurityEventRequestOutcome.ReachedApp);
    expect(values).toContain(SecurityEventRequestOutcome.Errored);
    expect(values).toContain(SecurityEventRequestOutcome.ReachedDatabase);
    expect(values).toContain("web.attack.kind");
    expect(values).toContain("user_agent.original");
    // HTTP Activity only.
    expect(values).toContain(4002);
    // One row past the page, so the caller can tell there were more.
    expect(values).toContain(26);
  });

  test("never asks for more than the page can list", async () => {
    const spy: Spy = stubExecuteQuery([]);

    await SecurityEventService.findAttackCampaigns({
      projectId: PROJECT_ID,
      startTime: START,
      endTime: END,
      limit: 10_000,
    });

    expect(Object.values(statementOf(spy).query_params)).toContain(
      SECURITY_ATTACK_CAMPAIGNS_MAX + 1,
    );
  });

  test("reads each row's figures, and its times as ISO dates", async () => {
    stubExecuteQuery([
      {
        sourceIp: "198.51.100.23",
        requestCount: "96",
        rejectedCount: "94",
        reachedAppCount: "1",
        erroredCount: "0",
        reachedDatabaseCount: "1",
        worstOutcomeRank: 4,
        maxSeverityId: 5,
        attackKinds: ["sql-injection", "path-traversal", ""],
        userAgents: ["Mozilla/5.0 (scanner)"],
        targetCount: "40",
        sampleTargets: ["/sitemap.xml?offset=1"],
        firstSeen: "2026-10-27 05:25:00.000000000",
        lastSeen: "2026-10-27 06:45:00.000000000",
      },
    ]);

    const campaigns: Array<SecurityAttackCampaign> =
      await SecurityEventService.findAttackCampaigns({
        projectId: PROJECT_ID,
        startTime: START,
        endTime: END,
        limit: 25,
      });

    expect(campaigns).toHaveLength(1);
    expect(campaigns[0]).toEqual({
      sourceIp: "198.51.100.23",
      requestCount: 96,
      rejectedCount: 94,
      reachedAppCount: 1,
      erroredCount: 0,
      reachedDatabaseCount: 1,
      worstOutcome: SecurityEventRequestOutcome.ReachedDatabase,
      maxSeverityId: 5,
      attackKinds: ["sql-injection", "path-traversal"],
      userAgents: ["Mozilla/5.0 (scanner)"],
      targetCount: 40,
      sampleTargets: ["/sitemap.xml?offset=1"],
      firstSeen: "2026-10-27T05:25:00.000Z",
      lastSeen: "2026-10-27T06:45:00.000Z",
    });
  });
});

describe("the window the Campaigns page reads", () => {
  const NOW: Date = new Date("2026-10-27T12:00:00.000Z");

  test("is the last seven days when the page names none", () => {
    const window: { startTime: Date; endTime: Date } = readCampaignWindow(
      {},
      NOW,
    );

    expect(window.endTime).toEqual(NOW);
    expect(NOW.getTime() - window.startTime.getTime()).toBe(
      7 * 24 * 3600 * 1000,
    );
  });

  test("is the page's own when it names one", () => {
    expect(
      readCampaignWindow(
        {
          startTime: "2026-10-26T12:00:00.000Z",
          endTime: "2026-10-27T00:00:00.000Z",
        },
        NOW,
      ),
    ).toEqual({
      startTime: new Date("2026-10-26T12:00:00.000Z"),
      endTime: new Date("2026-10-27T00:00:00.000Z"),
    });
  });

  test("never ends in the future, nor reaches back further than a month", () => {
    const window: { startTime: Date; endTime: Date } = readCampaignWindow(
      {
        startTime: "2020-01-01T00:00:00.000Z",
        endTime: "2030-01-01T00:00:00.000Z",
      },
      NOW,
    );

    expect(window.endTime).toEqual(NOW);
    expect(NOW.getTime() - window.startTime.getTime()).toBe(
      SECURITY_ATTACK_CAMPAIGNS_MAX_DAYS * 24 * 3600 * 1000,
    );
  });

  test("a start after its end is refused", () => {
    expect(() => {
      return readCampaignWindow(
        {
          startTime: "2026-10-27T10:00:00.000Z",
          endTime: "2026-10-27T09:00:00.000Z",
        },
        NOW,
      );
    }).toThrow(BadDataException);
  });

  test("dates that are not dates are as good as none", () => {
    const window: { startTime: Date; endTime: Date } = readCampaignWindow(
      { startTime: "yesterday", endTime: 12 },
      NOW,
    );

    expect(window.endTime).toEqual(NOW);
    expect(NOW.getTime() - window.startTime.getTime()).toBe(
      7 * 24 * 3600 * 1000,
    );
  });
});
