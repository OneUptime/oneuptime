import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import { FindOperator } from "typeorm";

/*
 * AlertEpisode:AutoResolve (the line-for-line twin of
 * IncidentEpisode:AutoResolve - keep the two suites symmetric).
 *
 * The job used to read the same first 1,000 open episodes every minute and
 * start two queries for each at once, so past 1,000 the rest never
 * resolved. It now runs EpisodeAutoResolve over alert episodes, whose own
 * suite pins the paging, the batching, the concurrency, the deadline and
 * the decision. This one pins the job's wiring: which episodes it reads
 * (open ones, a keyset page at a time), which tables its aggregate query
 * names, how it reads rules and states, and how it writes - and that it no
 * longer reads members or alerts episode by episode.
 */

type CronHandler = (deadline?: unknown) => Promise<void>;

const mockCapturedJobs: Record<
  string,
  { options: Record<string, unknown>; run: CronHandler }
> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: Record<string, unknown>,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { options, run: runFunction };
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const mockMemberQuery: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
      resolveEpisode: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertEpisodeMemberService", () => {
  return {
    __esModule: true,
    default: {
      // Mocked only to prove the per-episode read is gone.
      getAlertsInEpisode: jest.fn(),
      getRepository: jest.fn(() => {
        return { manager: { query: mockMemberQuery } };
      }),
    },
  };
});

jest.mock("Common/Server/Services/AlertStateService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertGroupingRuleService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertGroupingRuleService from "Common/Server/Services/AlertGroupingRuleService";
import AlertService from "Common/Server/Services/AlertService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import logger from "Common/Server/Utils/Logger";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { ALERT_EPISODE_AUTO_RESOLVE } from "../../../../FeatureSet/Workers/Jobs/AlertEpisode/AutoResolve";
import {
  AutoResolveEpisode,
  AutoResolveRule,
  AutoResolveState,
  EPISODE_AUTO_RESOLVE_PAGE_SIZE,
  getEpisodeMemberCountsSql,
} from "../../../../FeatureSet/Workers/Utils/EpisodeAutoResolve";

const JOB_NAME: string = "AlertEpisode:AutoResolve";

const episodeService: {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  resolveEpisode: jest.Mock;
} = AlertEpisodeService as unknown as {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  resolveEpisode: jest.Mock;
};
const memberService: { getAlertsInEpisode: jest.Mock } =
  AlertEpisodeMemberService as unknown as { getAlertsInEpisode: jest.Mock };
const stateService: { findBy: jest.Mock } = AlertStateService as unknown as {
  findBy: jest.Mock;
};
const ruleService: { findBy: jest.Mock } =
  AlertGroupingRuleService as unknown as { findBy: jest.Mock };
const recordService: { findBy: jest.Mock } = AlertService as unknown as {
  findBy: jest.Mock;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("bbbbbbbb-0000-4000-8000-000000000001");
const EPISODE_ID: ObjectID = new ObjectID(
  "cccccccc-0000-4000-8000-000000000001",
);

function cursorOf(query: Record<string, unknown>): string | undefined {
  const cursor: FindOperator<ObjectID> | undefined = query["_id"] as
    | FindOperator<ObjectID>
    | undefined;

  if (!cursor) {
    return undefined;
  }

  expect(cursor.getSql!("_id")).toMatch(/_id > :/);
  return String(Object.values(cursor.objectLiteralParameters!)[0]);
}

beforeEach(() => {
  jest.clearAllMocks();
  episodeService.findBy.mockResolvedValue([]);
  stateService.findBy.mockResolvedValue([]);
  ruleService.findBy.mockResolvedValue([]);
  mockMemberQuery.mockResolvedValue([]);
});

describe("AlertEpisode:AutoResolve", () => {
  test("runs every minute, one run at a time (RunCron's lock is not opted out of)", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(mockCapturedJobs[JOB_NAME]!.options).toEqual({
      schedule: EVERY_MINUTE,
      runOnStartup: false,
    });
    expect(mockCapturedJobs[JOB_NAME]!.options["allowOverlap"]).toBeUndefined();
  });

  test("reads open episodes a keyset page at a time, in _id order", async () => {
    const afterId: ObjectID = new ObjectID(
      "cccccccc-0000-4000-8000-000000000099",
    );

    await ALERT_EPISODE_AUTO_RESOLVE.readOpenEpisodes({
      afterId: null,
      limit: EPISODE_AUTO_RESOLVE_PAGE_SIZE,
    });
    await ALERT_EPISODE_AUTO_RESOLVE.readOpenEpisodes({
      afterId,
      limit: EPISODE_AUTO_RESOLVE_PAGE_SIZE,
    });

    const [first, second] = episodeService.findBy.mock.calls.map(
      (call: Array<unknown>) => {
        return call[0] as {
          query: Record<string, unknown>;
          select: Record<string, unknown>;
          sort: Record<string, unknown>;
          limit: number;
          skip: number;
        };
      },
    );

    for (const read of [first!, second!]) {
      expect(
        (read.query["resolvedAt"] as FindOperator<unknown>).getSql!("r"),
      ).toMatch(/r IS NULL/);
      expect(read.sort).toEqual({ _id: SortOrder.Ascending });
      expect(read.limit).toBe(EPISODE_AUTO_RESOLVE_PAGE_SIZE);
      expect(read.skip).toBe(0);
      expect(Object.keys(read.select).sort()).toEqual([
        "_id",
        "alertGroupingRuleId",
        "allAlertsResolvedAt",
        "projectId",
      ]);
    }

    expect(cursorOf(first!.query)).toBeUndefined();
    expect(cursorOf(second!.query)).toBe(afterId.toString());
  });

  test("hands the engine each episode's project, rule and stamp", async () => {
    const episode: AlertEpisode = new AlertEpisode(EPISODE_ID);
    episode.projectId = PROJECT_ID;
    episode.alertGroupingRuleId = RULE_ID;
    episode.allAlertsResolvedAt = new Date("2026-11-14T09:00:00.000Z");
    episodeService.findBy.mockResolvedValue([episode]);

    const episodes: Array<AutoResolveEpisode> =
      await ALERT_EPISODE_AUTO_RESOLVE.readOpenEpisodes({
        afterId: null,
        limit: 10,
      });

    expect(episodes).toEqual([
      {
        id: EPISODE_ID,
        projectId: PROJECT_ID,
        groupingRuleId: RULE_ID,
        allMembersResolvedAt: new Date("2026-11-14T09:00:00.000Z"),
      },
    ]);
  });

  test("reads the page's grouping rules and states in one query each", async () => {
    const rule: AlertGroupingRule = new AlertGroupingRule(RULE_ID);
    rule.enableResolveDelay = true;
    rule.resolveDelayMinutes = 15;
    ruleService.findBy.mockResolvedValue([rule]);

    const rules: Map<string, AutoResolveRule> =
      await ALERT_EPISODE_AUTO_RESOLVE.readRules([RULE_ID]);
    expect(rules.get(RULE_ID.toString())).toEqual({
      enableResolveDelay: true,
      resolveDelayMinutes: 15,
    });
    expect(ruleService.findBy).toHaveBeenCalledTimes(1);

    const state: AlertState = new AlertState();
    state.projectId = PROJECT_ID;
    state.order = 3;
    state.isResolvedState = true;
    stateService.findBy.mockResolvedValue([state]);

    const states: Array<AutoResolveState> =
      await ALERT_EPISODE_AUTO_RESOLVE.readStates([PROJECT_ID]);
    expect(states).toEqual([state]);
    expect(
      Object.keys(
        (stateService.findBy.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }).select,
      ).sort(),
    ).toEqual(["_id", "isResolvedState", "order", "projectId"]);
  });

  test("counts members with one aggregate query over the alert tables", async () => {
    expect(ALERT_EPISODE_AUTO_RESOLVE.tables).toEqual({
      memberTable: "AlertEpisodeMember",
      memberEpisodeColumn: "alertEpisodeId",
      memberRecordColumn: "alertId",
      recordTable: "Alert",
      recordStateColumn: "currentAlertStateId",
      stateTable: "AlertState",
    });

    const sql: string = getEpisodeMemberCountsSql(
      ALERT_EPISODE_AUTO_RESOLVE.tables,
    );
    await ALERT_EPISODE_AUTO_RESOLVE.query(sql, [[EPISODE_ID.toString()], [3]]);

    expect(mockMemberQuery).toHaveBeenCalledWith(sql, [
      [EPISODE_ID.toString()],
      [3],
    ]);
  });

  test("writes the stamp, and resolves without cascading to the alerts", async () => {
    const at: Date = new Date("2026-11-14T10:00:00.000Z");

    await ALERT_EPISODE_AUTO_RESOLVE.setAllMembersResolvedAt({
      episodeId: EPISODE_ID,
      at,
    });
    await ALERT_EPISODE_AUTO_RESOLVE.setAllMembersResolvedAt({
      episodeId: EPISODE_ID,
      at: null,
    });
    await ALERT_EPISODE_AUTO_RESOLVE.resolveEpisode(EPISODE_ID);

    expect(episodeService.updateOneById.mock.calls).toEqual([
      [
        {
          id: EPISODE_ID,
          data: { allAlertsResolvedAt: at },
          props: { isRoot: true },
        },
      ],
      [
        {
          id: EPISODE_ID,
          data: { allAlertsResolvedAt: null },
          props: { isRoot: true },
        },
      ],
    ]);
    expect(episodeService.resolveEpisode).toHaveBeenCalledWith(
      EPISODE_ID,
      undefined,
      false,
    );
  });

  test("a run resolves an episode whose alerts are all resolved, with no read per episode or per alert", async () => {
    const episode: AlertEpisode = new AlertEpisode(EPISODE_ID);
    episode.projectId = PROJECT_ID;
    episodeService.findBy.mockResolvedValue([episode]);

    const resolved: AlertState = new AlertState();
    resolved.projectId = PROJECT_ID;
    resolved.order = 3;
    resolved.isResolvedState = true;
    stateService.findBy.mockResolvedValue([resolved]);

    mockMemberQuery.mockResolvedValue([
      { episodeId: EPISODE_ID.toString(), memberCount: 4, unresolvedCount: 0 },
    ]);

    await mockCapturedJobs[JOB_NAME]!.run();

    expect(episodeService.resolveEpisode).toHaveBeenCalledWith(
      EPISODE_ID,
      undefined,
      false,
    );
    expect(mockMemberQuery).toHaveBeenCalledTimes(1);
    // THE regressions removed: a member read and an alert read per episode.
    expect(memberService.getAlertsInEpisode).not.toHaveBeenCalled();
    expect(recordService.findBy).not.toHaveBeenCalled();
  });

  test("a run that fails is logged, not thrown: the next minute tries again", async () => {
    episodeService.findBy.mockRejectedValue(new Error("connection reset"));

    await expect(mockCapturedJobs[JOB_NAME]!.run()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("connection reset"),
    );
  });
});
