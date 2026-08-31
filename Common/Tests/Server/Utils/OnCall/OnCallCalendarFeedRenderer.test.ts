import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The renderer behind the on-call calendar feeds: authorisation re-derived
 * per fetch, the body / schedule-level / last-good caches, the render cap,
 * stale-while-error, the iteration-cap and MAX_EVENTS truncations, coverage
 * gaps, and the /my-shifts materialization.
 *
 * The materializer and every database read are stubbed at their public
 * seams; the caches are REAL (Redis is mocked away, so they run on their
 * in-process tier) because the properties under test -- a second fetch is a
 * cache hit, a partial render never becomes "last good", the last good body
 * outlives a failed render -- are about how the renderer drives them.
 */

type EnvMockGlobal = typeof globalThis & {
  __oneuptimeCalendarRendererBillingEnabled: boolean;
};

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: EnvMockGlobal = globalThis as EnvMockGlobal;

  mockGlobal.__oneuptimeCalendarRendererBillingEnabled = false;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__oneuptimeCalendarRendererBillingEnabled;
    },
  });

  return mocked;
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(() => {
        return null;
      }),
      isConnected: jest.fn(() => {
        return false;
      }),
    },
  };
});

jest.mock("../../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import DatabaseConfig from "../../../../Server/DatabaseConfig";
import OnCallCalendarFeedCache from "../../../../Server/Infrastructure/OnCallCalendarFeedCache";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import ProjectService from "../../../../Server/Services/ProjectService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import OnCallCalendarFeedRenderer, {
  CachedScheduleSegments,
  FEED_DISABLED_REASON,
  FILTERED_SCHEDULE_REASON,
  FeedRenderOutcome,
  FeedRenderRequest,
  FeedRenderStatus,
  NO_PROJECT_SCHEDULES_REASON,
  NO_SCHEDULES_REASON,
  PLAN_REASON,
  PROJECT_MISSING_REASON,
  RENDER_CAP_RETRY_AFTER_SECONDS,
  SCHEDULE_MISSING_REASON,
  USER_MISSING_REASON,
  UserShiftsResult,
} from "../../../../Server/Utils/OnCall/OnCallCalendarFeedRenderer";
import OnCallShiftMaterializer, {
  MaterializeResult,
} from "../../../../Server/Utils/OnCall/OnCallShiftMaterializer";
import Response from "../../../../Server/Utils/Response";
import AppMetrics from "../../../../Server/Utils/Telemetry/AppMetrics";
import SubscriptionPlan, {
  PlanType,
} from "../../../../Types/Billing/SubscriptionPlan";
import EventInterval from "../../../../Types/Events/EventInterval";
import ObjectID from "../../../../Types/ObjectID";
import CalendarFeedWindow, {
  MAX_EVENTS,
  MAX_GAP_EVENTS,
} from "../../../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import { LayerProps } from "../../../../Types/OnCallDutyPolicy/Layer";
import { MaterializedShift } from "../../../../Types/OnCallDutyPolicy/MaterializedShift";
import { OnCallCalendarFeedKind } from "../../../../Types/OnCallDutyPolicy/OnCallCalendarFeedUtil";
import {
  DASHBOARD_URL,
  at,
  eventBlocks,
  noRestriction,
  property,
  rotation,
  shift,
  user,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";

// -- Fixtures ---------------------------------------------------------------

const NOW: Date = at("2026-09-01T12:00:00Z");

/* pastDays 2 / futureDays 7 around NOW (see CalendarFeedWindow). */
const FEED_START: Date = at("2026-08-30T00:00:00Z");
const FEED_END: Date = at("2026-09-09T00:00:00Z");

const TOKEN_HASH: string = "a".repeat(64);

interface ScheduleFixture {
  id: ObjectID;
  name: string;
  timezone?: string | undefined;
  projectId: ObjectID;
  shiftConfigVersion: number;
}

interface CapturedFindBy {
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
  props?: { isRoot?: boolean | undefined } | undefined;
}

function setBillingEnabled(value: boolean): void {
  (globalThis as EnvMockGlobal).__oneuptimeCalendarRendererBillingEnabled =
    value;
}

function scheduleFixture(
  overrides?: Partial<ScheduleFixture> | undefined,
): ScheduleFixture {
  return {
    id: ObjectID.generate(),
    name: "Payments",
    timezone: "Europe/Stockholm",
    projectId: ObjectID.generate(),
    shiftConfigVersion: 3,
    ...(overrides || {}),
  };
}

function alwaysOnLayer(users: Array<string>, startsAt: Date): LayerProps {
  return {
    users: users.map(user),
    startDateTimeOfLayer: startsAt,
    restrictionTimes: noRestriction(),
    handOffTime: at("2026-08-31T09:00:00Z"),
    rotation: rotation(EventInterval.Week, 1),
    timezone: "UTC",
    layerId: "layer-1",
    layerName: "Primary",
  };
}

function materialization(data: {
  schedule: ScheduleFixture;
  shifts: Array<MaterializedShift>;
  truncated?: boolean | undefined;
  layerProps?: Array<LayerProps> | undefined;
  lastModifiedAt?: Date | undefined;
  projectName?: string | undefined;
}): MaterializeResult {
  return {
    shifts: data.shifts,
    truncated: data.truncated === true,
    schedules: [
      {
        scheduleId: data.schedule.id.toString(),
        scheduleName: data.schedule.name,
        projectId: data.schedule.projectId.toString(),
        ...(data.projectName ? { projectName: data.projectName } : {}),
        ...(data.schedule.timezone
          ? { scheduleTimezone: data.schedule.timezone }
          : {}),
        shiftConfigVersion: data.schedule.shiftConfigVersion,
        lastModifiedAt: data.lastModifiedAt || at("2026-08-01T10:00:00Z"),
        truncated: data.truncated === true,
        attachedPolicies: [],
        layerProps: data.layerProps || [],
        scheduleUserIds: [],
      },
    ],
    users: [],
    generatedAt: NOW,
  };
}

function shiftOn(
  schedule: ScheduleFixture,
  userId: string,
  start: string,
  end: string,
): MaterializedShift {
  return shift({
    scheduleId: schedule.id.toString(),
    scheduleName: schedule.name,
    projectId: schedule.projectId.toString(),
    userId,
    userName: `Name of ${userId}`,
    start: at(start),
    end: at(end),
    shiftConfigVersion: schedule.shiftConfigVersion,
  });
}

function personalRequest(data: {
  projectId: ObjectID;
  userId: ObjectID;
  scheduleFilterId?: ObjectID | undefined;
  includeCoveringShifts?: boolean | undefined;
  tokenHash?: string | undefined;
}): FeedRenderRequest {
  return {
    kind: OnCallCalendarFeedKind.Personal,
    feedId: ObjectID.generate(),
    projectId: data.projectId,
    userId: data.userId,
    tokenHash: data.tokenHash || TOKEN_HASH,
    includeCoveringShifts: data.includeCoveringShifts !== false,
    scheduleFilterId: data.scheduleFilterId,
    pastDays: 2,
    futureDays: 7,
    now: NOW,
  };
}

function scheduleRequest(data: {
  projectId: ObjectID;
  scheduleId: ObjectID;
  includeCoverageGaps?: boolean | undefined;
  minimumGapMinutes?: number | undefined;
}): FeedRenderRequest {
  return {
    kind: OnCallCalendarFeedKind.Schedule,
    feedId: ObjectID.generate(),
    projectId: data.projectId,
    scheduleId: data.scheduleId,
    tokenHash: TOKEN_HASH,
    includeCoverageGaps: data.includeCoverageGaps === true,
    minimumGapMinutes: data.minimumGapMinutes ?? 60,
    pastDays: 2,
    futureDays: 7,
    now: NOW,
  };
}

function projectRequest(data: {
  projectId: ObjectID;
  includeCoverageGaps?: boolean | undefined;
}): FeedRenderRequest {
  return {
    kind: OnCallCalendarFeedKind.Project,
    feedId: ObjectID.generate(),
    projectId: data.projectId,
    tokenHash: TOKEN_HASH,
    includeCoverageGaps: data.includeCoverageGaps === true,
    minimumGapMinutes: 60,
    pastDays: 2,
    futureDays: 7,
    now: NOW,
  };
}

function unfold(body: string): string {
  return body.replace(/\r\n /g, "");
}

function summaries(body: string): Array<string> {
  return eventBlocks(body).map((block: Array<string>): string => {
    const line: string | undefined = block.find((candidate: string) => {
      return candidate.startsWith("SUMMARY:");
    });

    return line ? line.slice("SUMMARY:".length) : "";
  });
}

// -- Spies ------------------------------------------------------------------

let materializeForSchedule: jest.SpyInstance;
let candidateIds: jest.SpyInstance;
let scheduleFindBy: jest.SpyInstance;
let userFindOneById: jest.SpyInstance;
let projectFindOneById: jest.SpyInstance;
let getCurrentPlan: jest.SpyInstance;
let planCheck: jest.SpyInstance;
let dashboardUrl: jest.SpyInstance;
let recordDuration: jest.Mock;
let recordEvents: jest.Mock;
let setLastGood: jest.SpyInstance;
let setBody: jest.SpyInstance;

let projectId: ObjectID;
let me: ObjectID;

function installSchedules(rows: Array<ScheduleFixture>): void {
  scheduleFindBy.mockImplementation(
    async (args: CapturedFindBy): Promise<Array<ScheduleFixture>> => {
      const wanted: unknown = args.query["projectId"];

      if (wanted) {
        return rows.filter((row: ScheduleFixture): boolean => {
          return row.projectId.toString() === String(wanted);
        });
      }

      return rows;
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  setBillingEnabled(false);
  OnCallCalendarFeedCache.clearInProcessState();
  OnCallCalendarFeedCache.configure({ renderConcurrency: 4 });

  projectId = ObjectID.generate();
  me = ObjectID.generate();

  materializeForSchedule = jest.spyOn(
    OnCallShiftMaterializer,
    "materializeForSchedule",
  );
  candidateIds = jest
    .spyOn(OnCallShiftMaterializer, "getCandidateScheduleIdsForUser")
    .mockResolvedValue([]);
  scheduleFindBy = jest
    .spyOn(OnCallDutyPolicyScheduleService, "findBy")
    .mockResolvedValue([]);
  userFindOneById = jest
    .spyOn(UserService, "findOneById")
    .mockResolvedValue({ id: me, timezone: "America/New_York" } as never);
  projectFindOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({ id: projectId, name: "Acme" } as never);
  getCurrentPlan = jest
    .spyOn(ProjectService, "getCurrentPlan")
    .mockResolvedValue({ plan: PlanType.Growth, isSubscriptionUnpaid: false });
  planCheck = jest
    .spyOn(SubscriptionPlan, "isFeatureAccessibleOnCurrentPlan")
    .mockReturnValue(true);
  dashboardUrl = jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue({
      toString: (): string => {
        return DASHBOARD_URL;
      },
    } as never);

  recordDuration = jest.fn();
  recordEvents = jest.fn();
  jest
    .spyOn(AppMetrics, "getOnCallCalendarRenderDuration")
    .mockReturnValue({ record: recordDuration } as never);
  jest
    .spyOn(AppMetrics, "getOnCallCalendarRenderEvents")
    .mockReturnValue({ record: recordEvents } as never);

  setLastGood = jest.spyOn(OnCallCalendarFeedCache, "setLastGood");
  setBody = jest.spyOn(OnCallCalendarFeedCache, "setBody");
});

afterEach(() => {
  jest.restoreAllMocks();
  OnCallCalendarFeedCache.clearInProcessState();
});

// -- Outcomes ---------------------------------------------------------------

describe("OnCallCalendarFeedRenderer.buildEmptyOutcome", () => {
  test("is a header-only VCALENDAR whose X-WR-CALDESC carries the reason, with a content ETag", () => {
    const outcome: FeedRenderOutcome =
      OnCallCalendarFeedRenderer.buildEmptyOutcome({
        kind: OnCallCalendarFeedKind.Personal,
        reason: FEED_DISABLED_REASON,
        now: NOW,
      });

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.kind).toBe(OnCallCalendarFeedKind.Personal);
    expect(outcome.body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(outcome.body).not.toContain("BEGIN:VEVENT");
    expect(unfold(outcome.body)).toContain(FEED_DISABLED_REASON.slice(0, 40));
    expect(outcome.etag).toBe(Response.getCalendarETag(outcome.body));
    expect(outcome.lastModified).toBe(NOW);
    expect(outcome.eventCount).toBe(0);
    expect(outcome.stale).toBe(false);
    expect(outcome.truncated).toBe(false);
    expect(outcome.cacheHit).toBe(false);
    expect(outcome.reason).toBe(FEED_DISABLED_REASON);
    expect(outcome.retryAfterSeconds).toBeNull();
  });

  test("names the schedule / project / filter in the calendar name", () => {
    const scheduleOutcome: FeedRenderOutcome =
      OnCallCalendarFeedRenderer.buildEmptyOutcome({
        kind: OnCallCalendarFeedKind.Schedule,
        reason: PLAN_REASON,
        scheduleName: "Payments",
        now: NOW,
      });

    expect(property(scheduleOutcome.body, "X-WR-CALNAME")).toBe("Payments");

    const projectOutcome: FeedRenderOutcome =
      OnCallCalendarFeedRenderer.buildEmptyOutcome({
        kind: OnCallCalendarFeedKind.Project,
        reason: PLAN_REASON,
        projectName: "Acme",
        now: NOW,
      });

    expect(property(projectOutcome.body, "X-WR-CALNAME")).toContain("Acme");

    const filteredOutcome: FeedRenderOutcome =
      OnCallCalendarFeedRenderer.buildEmptyOutcome({
        kind: OnCallCalendarFeedKind.Personal,
        reason: FILTERED_SCHEDULE_REASON,
        filterScheduleName: "Payments",
        now: NOW,
      });

    expect(property(filteredOutcome.body, "X-WR-CALNAME")).toContain(
      "Payments",
    );
  });

  test("two empty outcomes for the same reason are byte-identical (same ETag)", () => {
    const first: FeedRenderOutcome =
      OnCallCalendarFeedRenderer.buildEmptyOutcome({
        kind: OnCallCalendarFeedKind.Personal,
        reason: PLAN_REASON,
        now: NOW,
      });
    const second: FeedRenderOutcome =
      OnCallCalendarFeedRenderer.buildEmptyOutcome({
        kind: OnCallCalendarFeedKind.Personal,
        reason: PLAN_REASON,
        now: at("2027-01-01T00:00:00Z"),
      });

    expect(first.body).toBe(second.body);
    expect(first.etag).toBe(second.etag);
  });
});

describe("OnCallCalendarFeedRenderer.buildUnavailableOutcome", () => {
  test("carries the Retry-After and no body", () => {
    const outcome: FeedRenderOutcome =
      OnCallCalendarFeedRenderer.buildUnavailableOutcome(
        OnCallCalendarFeedKind.Schedule,
        60,
      );

    expect(outcome.status).toBe(FeedRenderStatus.Unavailable);
    expect(outcome.body).toBe("");
    expect(outcome.etag).toBe("");
    expect(outcome.retryAfterSeconds).toBe(60);
    expect(outcome.eventCount).toBe(0);
  });
});

describe("OnCallCalendarFeedRenderer.countEvents", () => {
  test("counts VEVENT blocks", () => {
    expect(OnCallCalendarFeedRenderer.countEvents("")).toBe(0);
    expect(
      OnCallCalendarFeedRenderer.countEvents(
        "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
      ),
    ).toBe(2);
  });
});

// -- Plan ---------------------------------------------------------------------

describe("OnCallCalendarFeedRenderer.isProjectOnPlan", () => {
  test("with billing disabled every project is on plan and no plan is read", async () => {
    setBillingEnabled(false);

    expect(await OnCallCalendarFeedRenderer.isProjectOnPlan(projectId)).toBe(
      true,
    );
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  test("the explicit option overrides the environment", async () => {
    setBillingEnabled(true);

    expect(
      await OnCallCalendarFeedRenderer.isProjectOnPlan(projectId, {
        billingEnabled: false,
      }),
    ).toBe(true);
    expect(getCurrentPlan).not.toHaveBeenCalled();
  });

  test("with billing enabled the check delegates to SubscriptionPlan for the Growth feature", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: PlanType.Scale,
      isSubscriptionUnpaid: false,
    });
    planCheck.mockReturnValue(true);

    expect(await OnCallCalendarFeedRenderer.isProjectOnPlan(projectId)).toBe(
      true,
    );
    expect(getCurrentPlan).toHaveBeenCalledWith(projectId);
    expect(planCheck).toHaveBeenCalledTimes(1);
    expect(planCheck.mock.calls[0]?.[0]).toBe(PlanType.Growth);
    expect(planCheck.mock.calls[0]?.[1]).toBe(PlanType.Scale);
  });

  test("a plan below Growth is off plan", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: PlanType.Free,
      isSubscriptionUnpaid: false,
    });
    planCheck.mockReturnValue(false);

    expect(await OnCallCalendarFeedRenderer.isProjectOnPlan(projectId)).toBe(
      false,
    );
  });

  test("no plan at all is off plan (fails closed)", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockResolvedValue({
      plan: null,
      isSubscriptionUnpaid: false,
    });

    expect(await OnCallCalendarFeedRenderer.isProjectOnPlan(projectId)).toBe(
      false,
    );
    expect(planCheck).not.toHaveBeenCalled();
  });

  test("a plan read that throws is off plan, logged at warn, never thrown", async () => {
    setBillingEnabled(true);
    getCurrentPlan.mockRejectedValue(new Error("project gone"));

    expect(await OnCallCalendarFeedRenderer.isProjectOnPlan(projectId)).toBe(
      false,
    );
    expect(logger.warn).toHaveBeenCalled();
  });
});

// -- Cache key ------------------------------------------------------------------

describe("OnCallCalendarFeedRenderer.buildBodyCacheKey", () => {
  const first: ScheduleFixture = scheduleFixture({ shiftConfigVersion: 1 });
  const second: ScheduleFixture = scheduleFixture({ shiftConfigVersion: 2 });

  function key(
    request: FeedRenderRequest,
    schedules: Array<ScheduleFixture>,
    now?: Date | undefined,
  ): string {
    return OnCallCalendarFeedRenderer.buildBodyCacheKey({
      request,
      pastDays: request.pastDays,
      futureDays: request.futureDays,
      schedules,
      now: now || NOW,
    });
  }

  test("starts with the kind and the token HASH, and encodes the window and the day bucket", () => {
    const request: FeedRenderRequest = personalRequest({
      projectId,
      userId: me,
    });
    const value: string = key(request, [first]);

    expect(value.startsWith(`user:${TOKEN_HASH}:`)).toBe(false);
    expect(
      value.startsWith(`${OnCallCalendarFeedKind.Personal}:${TOKEN_HASH}:`),
    ).toBe(true);
    expect(value).toContain(":w=2/7:");
    expect(value.endsWith(`:${CalendarFeedWindow.getUtcDayBucket(NOW)}`)).toBe(
      true,
    );
  });

  test("is deterministic and independent of schedule order", () => {
    const request: FeedRenderRequest = personalRequest({
      projectId,
      userId: me,
    });

    expect(key(request, [first, second])).toBe(key(request, [second, first]));
    expect(key(request, [first])).toBe(key(request, [first]));
  });

  test("changes with any schedule's shiftConfigVersion, the candidate set, the filters, the window, the token and the day", () => {
    const request: FeedRenderRequest = personalRequest({
      projectId,
      userId: me,
    });
    const base: string = key(request, [first]);

    expect(key(request, [{ ...first, shiftConfigVersion: 9 }])).not.toBe(base);
    expect(key(request, [first, second])).not.toBe(base);
    expect(
      key(
        personalRequest({
          projectId,
          userId: me,
          includeCoveringShifts: false,
        }),
        [first],
      ),
    ).not.toBe(base);
    expect(
      key(
        personalRequest({
          projectId,
          userId: me,
          scheduleFilterId: ObjectID.generate(),
        }),
        [first],
      ),
    ).not.toBe(base);
    expect(key({ ...request, pastDays: 3 }, [first])).not.toBe(base);
    expect(
      key(
        personalRequest({ projectId, userId: me, tokenHash: "b".repeat(64) }),
        [first],
      ),
    ).not.toBe(base);
    expect(key(request, [first], at("2026-09-02T00:00:01Z"))).not.toBe(base);
  });

  test("shared feeds encode the gap settings; the same schedule under different kinds never shares a key", () => {
    const scheduleKey: string = key(
      scheduleRequest({
        projectId,
        scheduleId: first.id,
        includeCoverageGaps: true,
        minimumGapMinutes: 30,
      }),
      [first],
    );

    expect(scheduleKey).toContain(":g=1;m=30:");
    expect(scheduleKey.startsWith(`${OnCallCalendarFeedKind.Schedule}:`)).toBe(
      true,
    );
    expect(
      key(
        scheduleRequest({
          projectId,
          scheduleId: first.id,
          includeCoverageGaps: false,
          minimumGapMinutes: 30,
        }),
        [first],
      ),
    ).not.toBe(scheduleKey);
    expect(key(projectRequest({ projectId }), [first])).not.toBe(scheduleKey);
  });
});

// -- loadSchedules ----------------------------------------------------------------

describe("OnCallCalendarFeedRenderer.loadSchedules", () => {
  test("an empty id list reads nothing", async () => {
    expect(await OnCallCalendarFeedRenderer.loadSchedules([])).toEqual([]);
    expect(scheduleFindBy).not.toHaveBeenCalled();
  });

  test("preserves input order, drops unknown ids and duplicates, omits a missing timezone, reads as root", async () => {
    const legacy: ScheduleFixture = scheduleFixture({
      name: "Legacy",
      timezone: undefined,
      shiftConfigVersion: "7" as unknown as number,
    });
    const payments: ScheduleFixture = scheduleFixture({ name: "Payments" });

    installSchedules([payments, legacy]);

    const unknown: ObjectID = ObjectID.generate();

    const loaded: Array<{
      id: ObjectID;
      name: string;
      timezone?: string | undefined;
      shiftConfigVersion: number;
    }> = await OnCallCalendarFeedRenderer.loadSchedules([
      legacy.id,
      unknown,
      payments.id,
      legacy.id,
    ]);

    expect(
      loaded.map((info: { name: string }): string => {
        return info.name;
      }),
    ).toEqual(["Legacy", "Payments"]);
    expect("timezone" in (loaded[0] || {})).toBe(false);
    expect(loaded[0]?.shiftConfigVersion).toBe(7);
    expect(loaded[1]?.timezone).toBe("Europe/Stockholm");

    const call: CapturedFindBy = scheduleFindBy.mock
      .calls[0]?.[0] as CapturedFindBy;

    expect(call.props?.isRoot).toBe(true);
    expect(call.select?.["shiftConfigVersion"]).toBe(true);
    expect(call.select?.["timezone"]).toBe(true);
  });
});

// -- Personal feed ----------------------------------------------------------------

describe("OnCallCalendarFeedRenderer.render (personal feed)", () => {
  let schedule: ScheduleFixture;

  beforeEach(() => {
    schedule = scheduleFixture({ projectId });
    installSchedules([schedule]);
    candidateIds.mockResolvedValue([schedule.id]);
    materializeForSchedule.mockResolvedValue(
      materialization({
        schedule,
        shifts: [
          shiftOn(
            schedule,
            me.toString(),
            "2026-09-02T07:00:00Z",
            "2026-09-02T15:00:00Z",
          ),
          shiftOn(
            schedule,
            "someone-else",
            "2026-09-02T15:00:00Z",
            "2026-09-02T23:00:00Z",
          ),
          shiftOn(
            schedule,
            me.toString(),
            "2026-09-03T07:00:00Z",
            "2026-09-03T15:00:00Z",
          ),
        ],
      }),
    );
  });

  test("a user that no longer exists gets an empty calendar, and nothing is materialized", async () => {
    userFindOneById.mockResolvedValue(null);

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      personalRequest({ projectId, userId: me }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.reason).toBe(USER_MISSING_REASON);
    expect(candidateIds).not.toHaveBeenCalled();
    expect(materializeForSchedule).not.toHaveBeenCalled();
  });

  test("a project below plan gets an empty calendar that says so, in the viewer's zone", async () => {
    setBillingEnabled(true);
    planCheck.mockReturnValue(false);

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      personalRequest({ projectId, userId: me }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.reason).toBe(PLAN_REASON);
    expect(unfold(outcome.body)).toContain(PLAN_REASON.slice(0, 40));
    expect(property(outcome.body, "X-WR-TIMEZONE")).toBe("America/New_York");
    expect(candidateIds).not.toHaveBeenCalled();
  });

  test("no eligible schedule gets an empty calendar", async () => {
    candidateIds.mockResolvedValue([]);

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      personalRequest({ projectId, userId: me }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.reason).toBe(NO_SCHEDULES_REASON);
    expect(materializeForSchedule).not.toHaveBeenCalled();
  });

  test("a ?schedule= filter the user is not on gets the filtered reason and names the schedule", async () => {
    candidateIds.mockResolvedValue([]);

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      personalRequest({ projectId, userId: me, scheduleFilterId: schedule.id }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.reason).toBe(FILTERED_SCHEDULE_REASON);
    expect(property(outcome.body, "X-WR-CALNAME")).toContain("Payments");

    const candidates: {
      scheduleId?: ObjectID;
      projectIds?: Array<ObjectID>;
      includeCoveringShifts: boolean;
      windowStart: Date;
      windowEnd: Date;
    } = candidateIds.mock.calls[0]?.[0] as {
      scheduleId?: ObjectID;
      projectIds?: Array<ObjectID>;
      includeCoveringShifts: boolean;
      windowStart: Date;
      windowEnd: Date;
    };

    expect(candidates.scheduleId?.toString()).toBe(schedule.id.toString());
    expect(candidates.projectIds?.map(String)).toEqual([projectId.toString()]);
    expect(candidates.includeCoveringShifts).toBe(true);
    expect(candidates.windowStart.toISOString()).toBe(FEED_START.toISOString());
    expect(candidates.windowEnd.toISOString()).toBe(FEED_END.toISOString());
  });

  test("a candidate schedule from ANOTHER project never renders under this project's token", async () => {
    const foreign: ScheduleFixture = scheduleFixture({
      projectId: ObjectID.generate(),
    });
    installSchedules([foreign]);
    candidateIds.mockResolvedValue([foreign.id]);

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      personalRequest({ projectId, userId: me }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.reason).toBe(NO_SCHEDULES_REASON);
    expect(materializeForSchedule).not.toHaveBeenCalled();
  });

  test("renders ONLY the viewer's shifts, in the viewer's zone, over the day-aligned window, caching body and last-good", async () => {
    const request: FeedRenderRequest = personalRequest({
      projectId,
      userId: me,
    });

    const outcome: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);

    expect(outcome.status).toBe(FeedRenderStatus.Rendered);
    expect(outcome.cacheHit).toBe(false);
    expect(outcome.stale).toBe(false);
    expect(outcome.truncated).toBe(false);
    expect(outcome.eventCount).toBe(2);
    expect(OnCallCalendarFeedRenderer.countEvents(outcome.body)).toBe(2);
    /* The fixture attaches exactly one policy, hence the suffix. */
    expect(summaries(outcome.body)).toEqual([
      "On-call · Payments · Payments Policy",
      "On-call · Payments · Payments Policy",
    ]);
    expect(outcome.body).not.toContain("someone-else");
    expect(property(outcome.body, "X-WR-TIMEZONE")).toBe("America/New_York");
    expect(property(outcome.body, "X-WR-CALNAME")).toBe("OneUptime On-Call");
    expect(outcome.etag).toBe(Response.getCalendarETag(outcome.body));
    expect(outcome.lastModified.toISOString()).toBe("2026-08-01T10:00:00.000Z");

    const materializeArgs: {
      scheduleId: ObjectID;
      windowStart: Date;
      windowEnd: Date;
      now: Date;
      maxSimulationIterations: number;
    } = materializeForSchedule.mock.calls[0]?.[0] as {
      scheduleId: ObjectID;
      windowStart: Date;
      windowEnd: Date;
      now: Date;
      maxSimulationIterations: number;
    };

    expect(materializeArgs.scheduleId.toString()).toBe(schedule.id.toString());
    expect(materializeArgs.windowStart.toISOString()).toBe(
      FEED_START.toISOString(),
    );
    expect(materializeArgs.windowEnd.toISOString()).toBe(
      FEED_END.toISOString(),
    );
    expect(materializeArgs.maxSimulationIterations).toBe(200000);

    expect(setBody).toHaveBeenCalledTimes(1);
    expect(setLastGood).toHaveBeenCalledTimes(1);
    expect(recordDuration).toHaveBeenCalledTimes(1);
    expect(recordEvents).toHaveBeenCalledWith(2, {
      [AppMetrics.ON_CALL_CALENDAR_FEED_KIND_ATTRIBUTE]: "user",
    });
  });

  test("the second fetch of the same key is a body-cache hit: no materialization, no metrics, same bytes", async () => {
    const request: FeedRenderRequest = personalRequest({
      projectId,
      userId: me,
    });

    const first: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);
    const second: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);

    expect(second.status).toBe(FeedRenderStatus.Rendered);
    expect(second.cacheHit).toBe(true);
    expect(second.body).toBe(first.body);
    expect(second.etag).toBe(first.etag);
    expect(second.lastModified.getTime()).toBe(first.lastModified.getTime());
    expect(second.eventCount).toBe(2);
    expect(materializeForSchedule).toHaveBeenCalledTimes(1);
    expect(recordDuration).toHaveBeenCalledTimes(1);
  });

  test("a configuration edit (shiftConfigVersion bump) is a new body key AND a new schedule-level render", async () => {
    const request: FeedRenderRequest = personalRequest({
      projectId,
      userId: me,
    });

    await OnCallCalendarFeedRenderer.render(request);

    schedule.shiftConfigVersion = 4;
    installSchedules([schedule]);

    const after: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);

    expect(after.cacheHit).toBe(false);
    expect(materializeForSchedule).toHaveBeenCalledTimes(2);
  });

  test("two feeds on the same schedule share ONE schedule-level expansion", async () => {
    const other: ObjectID = ObjectID.generate();

    await OnCallCalendarFeedRenderer.render(
      personalRequest({ projectId, userId: me, tokenHash: "c".repeat(64) }),
    );
    await OnCallCalendarFeedRenderer.render(
      personalRequest({ projectId, userId: other, tokenHash: "d".repeat(64) }),
    );

    expect(materializeForSchedule).toHaveBeenCalledTimes(1);
    expect(setBody).toHaveBeenCalledTimes(2);
  });

  test("a viewer without a timezone renders in UTC", async () => {
    userFindOneById.mockResolvedValue({ id: me } as never);

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      personalRequest({ projectId, userId: me }),
    );

    expect(property(outcome.body, "X-WR-TIMEZONE")).toBe("UTC");
  });

  test("the dashboard URL feeds the event URL and the cover link", async () => {
    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      personalRequest({ projectId, userId: me }),
    );

    expect(dashboardUrl).toHaveBeenCalled();
    expect(unfold(outcome.body)).toContain(DASHBOARD_URL);
  });
});

// -- Stale-while-error ------------------------------------------------------------

describe("OnCallCalendarFeedRenderer.render (stale-while-error)", () => {
  let schedule: ScheduleFixture;
  let request: FeedRenderRequest;

  beforeEach(() => {
    schedule = scheduleFixture({ projectId });
    installSchedules([schedule]);
    candidateIds.mockResolvedValue([schedule.id]);
    request = personalRequest({ projectId, userId: me });
    materializeForSchedule.mockResolvedValue(
      materialization({
        schedule,
        shifts: [
          shiftOn(
            schedule,
            me.toString(),
            "2026-09-02T07:00:00Z",
            "2026-09-02T15:00:00Z",
          ),
        ],
      }),
    );
  });

  async function renderOnceAndExpireBodyCache(): Promise<FeedRenderOutcome> {
    const good: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);

    /*
     * Drop the fresh body (and the schedule-level entry) but keep the
     * last-good tier: purges are exactly what the last-good tier survives.
     */
    await OnCallCalendarFeedCache.purgeForUser(
      projectId.toString(),
      me.toString(),
    );
    await OnCallCalendarFeedCache.purgeForSchedule(schedule.id.toString());

    return good;
  }

  test("render cap reached with nothing cached: Unavailable + Retry-After 60, no slot leaked", async () => {
    jest
      .spyOn(OnCallCalendarFeedCache, "tryAcquireRenderSlot")
      .mockReturnValue(false);

    const outcome: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);

    expect(outcome.status).toBe(FeedRenderStatus.Unavailable);
    expect(outcome.retryAfterSeconds).toBe(RENDER_CAP_RETRY_AFTER_SECONDS);
    expect(RENDER_CAP_RETRY_AFTER_SECONDS).toBe(60);
    expect(materializeForSchedule).not.toHaveBeenCalled();
    expect(OnCallCalendarFeedCache.getActiveRenderSlots()).toBe(0);
  });

  test("render cap reached with a last-good body: that body, flagged stale", async () => {
    const good: FeedRenderOutcome = await renderOnceAndExpireBodyCache();

    jest
      .spyOn(OnCallCalendarFeedCache, "tryAcquireRenderSlot")
      .mockReturnValue(false);

    const outcome: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);

    expect(outcome.status).toBe(FeedRenderStatus.Rendered);
    expect(outcome.stale).toBe(true);
    expect(outcome.truncated).toBe(true);
    expect(outcome.cacheHit).toBe(false);
    expect(outcome.body).toBe(good.body);
    expect(outcome.etag).toBe(good.etag);
    expect(materializeForSchedule).toHaveBeenCalledTimes(1);
  });

  test("a render that throws with nothing cached: Unavailable, logged, slot released", async () => {
    materializeForSchedule.mockRejectedValue(new Error("layer exploded"));

    const outcome: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);

    expect(outcome.status).toBe(FeedRenderStatus.Unavailable);
    expect(outcome.retryAfterSeconds).toBe(60);
    expect(logger.error).toHaveBeenCalled();
    expect(OnCallCalendarFeedCache.getActiveRenderSlots()).toBe(0);
    expect(setLastGood).not.toHaveBeenCalled();
  });

  test("a render that throws with a last-good body serves it stale and keeps the last-good intact", async () => {
    const good: FeedRenderOutcome = await renderOnceAndExpireBodyCache();

    materializeForSchedule.mockRejectedValue(new Error("layer exploded"));

    const outcome: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);

    expect(outcome.status).toBe(FeedRenderStatus.Rendered);
    expect(outcome.stale).toBe(true);
    expect(outcome.body).toBe(good.body);
    expect(OnCallCalendarFeedCache.getActiveRenderSlots()).toBe(0);

    /* And it is still there for the next failure. */
    const again: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);

    expect(again.stale).toBe(true);
    expect(again.body).toBe(good.body);
  });

  test("an iteration-capped expansion with a last-good body serves the complete older body, not the partial one", async () => {
    const good: FeedRenderOutcome = await renderOnceAndExpireBodyCache();

    materializeForSchedule.mockResolvedValue(
      materialization({ schedule, shifts: [], truncated: true }),
    );

    const outcome: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);

    expect(outcome.stale).toBe(true);
    expect(outcome.truncated).toBe(true);
    expect(outcome.body).toBe(good.body);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("an iteration-capped expansion with nothing cached goes out partial, with a note, and is NOT stored as last-good", async () => {
    materializeForSchedule.mockResolvedValue(
      materialization({
        schedule,
        shifts: [
          shiftOn(
            schedule,
            me.toString(),
            "2026-09-02T07:00:00Z",
            "2026-09-02T15:00:00Z",
          ),
        ],
        truncated: true,
      }),
    );

    const outcome: FeedRenderOutcome =
      await OnCallCalendarFeedRenderer.render(request);

    expect(outcome.status).toBe(FeedRenderStatus.Rendered);
    expect(outcome.stale).toBe(false);
    expect(outcome.truncated).toBe(true);
    expect(outcome.eventCount).toBe(1);
    expect(unfold(outcome.body)).toContain("Some shifts may be missing");
    expect(unfold(outcome.body)).toContain("Payments");
    expect(setBody).toHaveBeenCalledTimes(1);
    expect(setLastGood).not.toHaveBeenCalled();
    expect(
      await OnCallCalendarFeedCache.getLastGood(
        OnCallCalendarFeedRenderer.buildBodyCacheKey({
          request,
          pastDays: 2,
          futureDays: 7,
          schedules: [schedule],
          now: NOW,
        }),
      ),
    ).toBeNull();
  });
});

// -- MAX_EVENTS ---------------------------------------------------------------------

describe("OnCallCalendarFeedRenderer.render (MAX_EVENTS shrink)", () => {
  test("a feed that would exceed MAX_EVENTS is shortened by whole days, says so, and is flagged truncated", async () => {
    const schedule: ScheduleFixture = scheduleFixture({ projectId });
    installSchedules([schedule]);
    candidateIds.mockResolvedValue([schedule.id]);

    /* 600 ten-minute shifts per day across the ten-day window = 6,000. */
    const shifts: Array<MaterializedShift> = [];
    const dayMs: number = 24 * 60 * 60 * 1000;
    const stepMs: number = 144 * 1000;

    for (let day: number = 0; day < 10; day++) {
      for (let index: number = 0; index < 600; index++) {
        const start: Date = new Date(
          FEED_START.getTime() + day * dayMs + index * stepMs,
        );
        shifts.push(
          shiftOn(
            schedule,
            me.toString(),
            start.toISOString(),
            new Date(start.getTime() + stepMs).toISOString(),
          ),
        );
      }
    }

    materializeForSchedule.mockResolvedValue(
      materialization({ schedule, shifts }),
    );

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      personalRequest({ projectId, userId: me }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Rendered);
    expect(outcome.truncated).toBe(true);
    expect(outcome.eventCount).toBeLessThanOrEqual(MAX_EVENTS);
    expect(outcome.eventCount).toBeGreaterThan(0);
    expect(unfold(outcome.body)).toContain("Shortened to");
    expect(unfold(outcome.body)).toContain(`${MAX_EVENTS} events`);
    /* A shrunk feed is still complete for the days it covers: last-good. */
    expect(setLastGood).toHaveBeenCalledTimes(1);
  }, 60000);
});

// -- Schedule feed ------------------------------------------------------------------

describe("OnCallCalendarFeedRenderer.render (schedule feed)", () => {
  let schedule: ScheduleFixture;

  beforeEach(() => {
    schedule = scheduleFixture({ projectId, name: "Payments" });
    installSchedules([schedule]);
    materializeForSchedule.mockResolvedValue(
      materialization({
        schedule,
        shifts: [
          shiftOn(
            schedule,
            "user-a",
            "2026-09-01T07:00:00Z",
            "2026-09-01T15:00:00Z",
          ),
          shiftOn(
            schedule,
            "user-b",
            "2026-09-02T07:00:00Z",
            "2026-09-02T15:00:00Z",
          ),
        ],
        layerProps: [alwaysOnLayer(["user-a", "user-b"], FEED_START)],
      }),
    );
  });

  test("a schedule that no longer exists gets an empty calendar", async () => {
    installSchedules([]);

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      scheduleRequest({ projectId, scheduleId: ObjectID.generate() }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.reason).toBe(SCHEDULE_MISSING_REASON);
    expect(materializeForSchedule).not.toHaveBeenCalled();
  });

  test("a schedule in another project is treated as missing (the token is a project capability)", async () => {
    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      scheduleRequest({
        projectId: ObjectID.generate(),
        scheduleId: schedule.id,
      }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.reason).toBe(SCHEDULE_MISSING_REASON);
  });

  test("below plan: empty, named after the schedule, in the schedule's zone", async () => {
    setBillingEnabled(true);
    planCheck.mockReturnValue(false);

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      scheduleRequest({ projectId, scheduleId: schedule.id }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.reason).toBe(PLAN_REASON);
    expect(property(outcome.body, "X-WR-CALNAME")).toBe("Payments");
    expect(property(outcome.body, "X-WR-TIMEZONE")).toBe("Europe/Stockholm");
  });

  test("renders everyone's shifts, named after the schedule, in the schedule's zone, with no gap events by default", async () => {
    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      scheduleRequest({ projectId, scheduleId: schedule.id }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Rendered);
    expect(outcome.eventCount).toBe(2);
    expect(summaries(outcome.body)).toEqual([
      "Name of user-a · On-call · Payments",
      "Name of user-b · On-call · Payments",
    ]);
    expect(property(outcome.body, "X-WR-CALNAME")).toBe("Payments");
    expect(property(outcome.body, "X-WR-TIMEZONE")).toBe("Europe/Stockholm");
    expect(outcome.body).not.toContain("No coverage");
    expect(recordEvents).toHaveBeenCalledWith(2, {
      [AppMetrics.ON_CALL_CALENDAR_FEED_KIND_ATTRIBUTE]: "schedule",
    });
  });

  test("includeCoverageGaps emits a gap event for every hole inside the layers' envelope", async () => {
    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      scheduleRequest({
        projectId,
        scheduleId: schedule.id,
        includeCoverageGaps: true,
        minimumGapMinutes: 60,
      }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Rendered);

    const gapSummaries: Array<string> = summaries(outcome.body).filter(
      (summary: string): boolean => {
        return summary.startsWith("No coverage");
      },
    );

    /*
     * Three holes in a 24x7 envelope: before the first shift (1 Sep 07:00),
     * between the two shifts (1 Sep 15:00 -> 2 Sep 07:00) and after the LAST
     * shift (2 Sep 15:00 -> the end of the feed window). The dashboard's
     * coverage view (ScheduleShiftUtil.getCoverageGaps) stops at the last
     * shift, but a feed's window end is the horizon the envelope was computed
     * for, so a rotation that stops mid-window shows its tail as a gap too.
     */
    expect(gapSummaries).toEqual([
      "No coverage · Payments",
      "No coverage · Payments",
      "No coverage · Payments",
    ]);
    expect(outcome.eventCount).toBe(5);
    expect(outcome.truncated).toBe(false);

    const gapBlocks: Array<Array<string>> = eventBlocks(outcome.body).filter(
      (block: Array<string>): boolean => {
        return block.some((line: string): boolean => {
          return line.startsWith("SUMMARY:No coverage");
        });
      },
    );

    const starts: Array<string> = gapBlocks.map(
      (block: Array<string>): string => {
        return (
          block.find((line: string): boolean => {
            return line.startsWith("DTSTART:");
          }) || ""
        ).slice("DTSTART:".length);
      },
    );

    expect(starts).toEqual([
      "20260830T000000Z",
      "20260901T150000Z",
      "20260902T150000Z",
    ]);
  });

  test("a minimum gap longer than every hole emits nothing", async () => {
    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      scheduleRequest({
        projectId,
        scheduleId: schedule.id,
        includeCoverageGaps: true,
        minimumGapMinutes: 10080,
      }),
    );

    expect(outcome.body).not.toContain("No coverage");
    expect(outcome.eventCount).toBe(2);
  });

  test("without an envelope (no layers) there is nothing a layer intended to cover, so no gap events", async () => {
    materializeForSchedule.mockResolvedValue(
      materialization({
        schedule,
        shifts: [
          shiftOn(
            schedule,
            "user-a",
            "2026-09-02T07:00:00Z",
            "2026-09-02T15:00:00Z",
          ),
        ],
      }),
    );

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      scheduleRequest({
        projectId,
        scheduleId: schedule.id,
        includeCoverageGaps: true,
      }),
    );

    expect(outcome.body).not.toContain("No coverage");
  });

  test("MAX_GAP_EVENTS caps the gap list and says so", async () => {
    /* One 10-minute shift every hour for the whole window: ~240 holes. */
    const shifts: Array<MaterializedShift> = [];
    const hourMs: number = 60 * 60 * 1000;

    for (
      let start: number = FEED_START.getTime();
      start < FEED_END.getTime();
      start += hourMs
    ) {
      shifts.push(
        shiftOn(
          schedule,
          "user-a",
          new Date(start).toISOString(),
          new Date(start + 10 * 60 * 1000).toISOString(),
        ),
      );
    }

    materializeForSchedule.mockResolvedValue(
      materialization({
        schedule,
        shifts,
        layerProps: [alwaysOnLayer(["user-a"], FEED_START)],
      }),
    );

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      scheduleRequest({
        projectId,
        scheduleId: schedule.id,
        includeCoverageGaps: true,
        minimumGapMinutes: 30,
      }),
    );

    const gapCount: number = summaries(outcome.body).filter(
      (summary: string): boolean => {
        return summary.startsWith("No coverage");
      },
    ).length;

    expect(gapCount).toBe(MAX_GAP_EVENTS);
    expect(outcome.truncated).toBe(true);
    expect(unfold(outcome.body)).toContain(
      `first ${MAX_GAP_EVENTS} coverage gaps`,
    );
  }, 60000);
});

// -- Project feed -------------------------------------------------------------------

describe("OnCallCalendarFeedRenderer.render (project feed)", () => {
  test("a project that no longer exists gets an empty calendar", async () => {
    projectFindOneById.mockResolvedValue(null);

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      projectRequest({ projectId }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.reason).toBe(PROJECT_MISSING_REASON);
    expect(scheduleFindBy).not.toHaveBeenCalled();
  });

  test("below plan: empty, named after the project", async () => {
    setBillingEnabled(true);
    planCheck.mockReturnValue(false);

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      projectRequest({ projectId }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.reason).toBe(PLAN_REASON);
    expect(property(outcome.body, "X-WR-CALNAME")).toContain("Acme");
    expect(scheduleFindBy).not.toHaveBeenCalled();
  });

  test("a project with no schedules gets an empty calendar", async () => {
    installSchedules([]);

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      projectRequest({ projectId }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Empty);
    expect(outcome.reason).toBe(NO_PROJECT_SCHEDULES_REASON);
    expect(materializeForSchedule).not.toHaveBeenCalled();
  });

  test("renders every schedule in the project together, named after the project", async () => {
    const payments: ScheduleFixture = scheduleFixture({
      projectId,
      name: "Payments",
    });
    const search: ScheduleFixture = scheduleFixture({
      projectId,
      name: "Search",
    });
    const elsewhere: ScheduleFixture = scheduleFixture({
      projectId: ObjectID.generate(),
      name: "Elsewhere",
    });

    installSchedules([payments, search, elsewhere]);

    materializeForSchedule.mockImplementation(
      async (data: { scheduleId: ObjectID }): Promise<MaterializeResult> => {
        const schedule: ScheduleFixture =
          data.scheduleId.toString() === payments.id.toString()
            ? payments
            : search;

        return materialization({
          schedule,
          shifts: [
            shiftOn(
              schedule,
              "user-a",
              "2026-09-02T07:00:00Z",
              "2026-09-02T15:00:00Z",
            ),
          ],
          projectName: "Acme",
        });
      },
    );

    const outcome: FeedRenderOutcome = await OnCallCalendarFeedRenderer.render(
      projectRequest({ projectId }),
    );

    expect(outcome.status).toBe(FeedRenderStatus.Rendered);
    expect(outcome.eventCount).toBe(2);
    expect(materializeForSchedule).toHaveBeenCalledTimes(2);
    expect(summaries(outcome.body).sort()).toEqual([
      "Name of user-a · On-call · Payments",
      "Name of user-a · On-call · Search",
    ]);
    expect(outcome.body).not.toContain("Elsewhere");
    expect(property(outcome.body, "X-WR-CALNAME")).toBe(
      "OneUptime On-Call · Acme",
    );
    expect(recordEvents).toHaveBeenCalledWith(2, {
      [AppMetrics.ON_CALL_CALENDAR_FEED_KIND_ATTRIBUTE]: "project",
    });

    const listing: CapturedFindBy = scheduleFindBy.mock
      .calls[0]?.[0] as CapturedFindBy;

    expect(String(listing.query["projectId"])).toBe(projectId.toString());
    expect(listing.props?.isRoot).toBe(true);
  });
});

// -- Schedule-level cache ------------------------------------------------------------

describe("OnCallCalendarFeedRenderer.loadScheduleSegments", () => {
  test("renders once per (version, window) and hands back a JSON-safe copy on the hit", async () => {
    const schedule: ScheduleFixture = scheduleFixture({ projectId });

    materializeForSchedule.mockResolvedValue(
      materialization({
        schedule,
        shifts: [
          shiftOn(
            schedule,
            "user-a",
            "2026-09-02T07:00:00Z",
            "2026-09-02T15:00:00Z",
          ),
        ],
        layerProps: [alwaysOnLayer(["user-a"], FEED_START)],
        lastModifiedAt: at("2026-08-15T00:00:00Z"),
      }),
    );

    const info: {
      id: ObjectID;
      name: string;
      projectId: ObjectID;
      shiftConfigVersion: number;
      timezone?: string | undefined;
    } = {
      id: schedule.id,
      name: schedule.name,
      projectId,
      shiftConfigVersion: 3,
      timezone: "Europe/Stockholm",
    };

    const first: CachedScheduleSegments =
      await OnCallCalendarFeedRenderer.loadScheduleSegments({
        schedule: info,
        windowStart: FEED_START,
        windowEnd: FEED_END,
        now: NOW,
      });

    const second: CachedScheduleSegments =
      await OnCallCalendarFeedRenderer.loadScheduleSegments({
        schedule: info,
        windowStart: FEED_START,
        windowEnd: FEED_END,
        now: NOW,
      });

    expect(materializeForSchedule).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first.scheduleId).toBe(schedule.id.toString());
    expect(first.scheduleName).toBe("Payments");
    expect(first.scheduleTimezone).toBe("Europe/Stockholm");
    expect(first.projectId).toBe(projectId.toString());
    expect(first.shiftConfigVersion).toBe(3);
    expect(first.lastModifiedAt).toBe("2026-08-15T00:00:00.000Z");
    expect(first.truncated).toBe(false);
    expect(first.shifts).toHaveLength(1);
    expect(typeof first.shifts[0]?.start).toBe("string");
    expect(first.envelope).toEqual([
      { start: FEED_START.toISOString(), end: FEED_END.toISOString() },
    ]);
    expect(first.envelopeTruncated).toBe(false);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);

    /* A new version is a new key. */
    await OnCallCalendarFeedRenderer.loadScheduleSegments({
      schedule: { ...info, shiftConfigVersion: 4 },
      windowStart: FEED_START,
      windowEnd: FEED_END,
      now: NOW,
    });

    expect(materializeForSchedule).toHaveBeenCalledTimes(2);

    /* A different window is a new key. */
    await OnCallCalendarFeedRenderer.loadScheduleSegments({
      schedule: info,
      windowStart: FEED_START,
      windowEnd: at("2026-09-10T00:00:00Z"),
      now: NOW,
    });

    expect(materializeForSchedule).toHaveBeenCalledTimes(3);
  });

  test("a legacy schedule (no timezone) caches a null timezone and the schedule's own facts fill the gaps", async () => {
    const schedule: ScheduleFixture = scheduleFixture({
      projectId,
      timezone: undefined,
    });

    materializeForSchedule.mockResolvedValue({
      shifts: [],
      truncated: false,
      schedules: [],
      users: [],
      generatedAt: NOW,
    });

    const cached: CachedScheduleSegments =
      await OnCallCalendarFeedRenderer.loadScheduleSegments({
        schedule: {
          id: schedule.id,
          name: "Legacy",
          projectId,
          shiftConfigVersion: 0,
        },
        windowStart: FEED_START,
        windowEnd: FEED_END,
        now: NOW,
      });

    expect(cached.scheduleTimezone).toBeNull();
    expect(cached.scheduleName).toBe("Legacy");
    expect(cached.projectName).toBeNull();
    expect(cached.shiftConfigVersion).toBe(0);
    expect(cached.lastModifiedAt).toBe(NOW.toISOString());
    expect(cached.envelope).toEqual([]);
  });
});

// -- /my-shifts -----------------------------------------------------------------------

describe("OnCallCalendarFeedRenderer.materializeUserShifts", () => {
  let schedule: ScheduleFixture;

  beforeEach(() => {
    schedule = scheduleFixture({ projectId });
    installSchedules([schedule]);
    candidateIds.mockResolvedValue([schedule.id]);
    materializeForSchedule.mockResolvedValue(
      materialization({
        schedule,
        shifts: [
          shiftOn(
            schedule,
            me.toString(),
            "2026-08-31T07:00:00Z",
            "2026-08-31T15:00:00Z",
          ),
          shiftOn(
            schedule,
            me.toString(),
            "2026-09-01T10:00:00Z",
            "2026-09-01T18:00:00Z",
          ),
          shiftOn(
            schedule,
            "someone-else",
            "2026-09-02T07:00:00Z",
            "2026-09-02T15:00:00Z",
          ),
          shiftOn(
            schedule,
            me.toString(),
            "2026-09-03T07:00:00Z",
            "2026-09-03T15:00:00Z",
          ),
          shiftOn(
            schedule,
            me.toString(),
            "2026-09-20T07:00:00Z",
            "2026-09-20T15:00:00Z",
          ),
        ],
      }),
    );
  });

  test("no candidate schedules: empty without touching the database", async () => {
    candidateIds.mockResolvedValue([]);

    const result: UserShiftsResult =
      await OnCallCalendarFeedRenderer.materializeUserShifts({
        userId: me,
        projectIds: [projectId],
        from: NOW,
        to: at("2026-09-10T00:00:00Z"),
        now: NOW,
      });

    expect(result).toEqual({ shifts: [], truncated: false, generatedAt: NOW });
    expect(scheduleFindBy).not.toHaveBeenCalled();
  });

  test("widens the window to whole UTC days for the cache, then cuts back to [from, to), mine only, sorted, isPast re-evaluated", async () => {
    const result: UserShiftsResult =
      await OnCallCalendarFeedRenderer.materializeUserShifts({
        userId: me,
        projectIds: [projectId],
        from: NOW,
        to: at("2026-09-10T00:00:00Z"),
        now: NOW,
      });

    const materializeArgs: { windowStart: Date; windowEnd: Date } =
      materializeForSchedule.mock.calls[0]?.[0] as {
        windowStart: Date;
        windowEnd: Date;
      };

    expect(materializeArgs.windowStart.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(materializeArgs.windowEnd.toISOString()).toBe(
      "2026-09-10T00:00:00.000Z",
    );

    expect(
      result.shifts.map((entry: MaterializedShift): string => {
        return entry.start.toISOString();
      }),
    ).toEqual(["2026-09-01T10:00:00.000Z", "2026-09-03T07:00:00.000Z"]);
    expect(result.shifts[0]?.isPast).toBe(true);
    expect(result.shifts[1]?.isPast).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.generatedAt).toBe(NOW);

    const candidates: {
      projectIds?: Array<ObjectID>;
      includeCoveringShifts: boolean;
      windowStart: Date;
      windowEnd: Date;
    } = candidateIds.mock.calls[0]?.[0] as {
      projectIds?: Array<ObjectID>;
      includeCoveringShifts: boolean;
      windowStart: Date;
      windowEnd: Date;
    };

    expect(candidates.projectIds?.map(String)).toEqual([projectId.toString()]);
    expect(candidates.includeCoveringShifts).toBe(true);
    expect(candidates.windowStart.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  test("a `to` that is exactly midnight is not widened by a day", async () => {
    await OnCallCalendarFeedRenderer.materializeUserShifts({
      userId: me,
      from: at("2026-09-01T00:00:00Z"),
      to: at("2026-09-03T00:00:00Z"),
      now: NOW,
    });

    const materializeArgs: { windowStart: Date; windowEnd: Date } =
      materializeForSchedule.mock.calls[0]?.[0] as {
        windowStart: Date;
        windowEnd: Date;
      };

    expect(materializeArgs.windowEnd.toISOString()).toBe(
      "2026-09-03T00:00:00.000Z",
    );

    const candidates: { projectIds?: Array<ObjectID> } = candidateIds.mock
      .calls[0]?.[0] as { projectIds?: Array<ObjectID> };

    expect(candidates.projectIds).toBeUndefined();
  });

  test("shares the schedule-level cache with the feeds", async () => {
    await OnCallCalendarFeedRenderer.render(
      personalRequest({ projectId, userId: me }),
    );

    await OnCallCalendarFeedRenderer.materializeUserShifts({
      userId: me,
      projectIds: [projectId],
      from: at("2026-08-30T00:00:00Z"),
      to: at("2026-09-09T00:00:00Z"),
      now: NOW,
    });

    expect(materializeForSchedule).toHaveBeenCalledTimes(1);
  });

  test("truncated propagates from the schedule-level materialization", async () => {
    materializeForSchedule.mockResolvedValue(
      materialization({ schedule, shifts: [], truncated: true }),
    );

    const result: UserShiftsResult =
      await OnCallCalendarFeedRenderer.materializeUserShifts({
        userId: me,
        projectIds: [projectId],
        from: NOW,
        to: at("2026-09-10T00:00:00Z"),
        now: NOW,
      });

    expect(result.truncated).toBe(true);
    expect(result.shifts).toEqual([]);
  });

  test("a candidate schedule deleted between the two reads is skipped, not rendered", async () => {
    candidateIds.mockResolvedValue([ObjectID.generate(), schedule.id]);

    const result: UserShiftsResult =
      await OnCallCalendarFeedRenderer.materializeUserShifts({
        userId: me,
        projectIds: [projectId],
        from: NOW,
        to: at("2026-09-10T00:00:00Z"),
        now: NOW,
      });

    expect(materializeForSchedule).toHaveBeenCalledTimes(1);
    expect(result.shifts).toHaveLength(2);
  });
});
