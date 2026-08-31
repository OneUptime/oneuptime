import OnCallDutyPolicyScheduleService, {
  ResolvedPolicyVariant,
  ResolvedShiftSegments,
} from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import logger from "../../../Server/Utils/Logger";
import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import BadDataException from "../../../Types/Exception/BadDataException";
import EventInterval from "../../../Types/Events/EventInterval";
import { MaterializedShiftPolicy } from "../../../Types/OnCallDutyPolicy/MaterializedShift";
import UserOverrideUtil, {
  UserOverrideRecord,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import {
  at,
  dailyRestriction,
  rotation,
} from "../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import {
  FakeDb,
  emptyDb,
  installFakeDb,
  makeAttachment,
  makeLayer,
  makeLayerUser,
  makeOverride,
  makeSchedule,
  oid,
} from "../Utils/OnCall/OnCallResolverTestHarness";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * getResolvedShiftSegments / getResolvedShiftSegmentsForSchedules: the
 * source of truth behind the calendar feeds. Runs the REAL service code
 * (layer props builder, window widening, engine, override selection, policy
 * variants, lastModifiedAt) against an in-memory fake of the tables it reads.
 */

const UTC: string = "UTC";
const PROJECT: string = "project-1";
const OTHER_PROJECT: string = "project-2";
const SCHEDULE: string = "schedule-1";
const OTHER_SCHEDULE: string = "schedule-2";

const WINDOW_START: Date = at("2026-03-02T00:00:00Z");
const WINDOW_END: Date = at("2026-03-05T00:00:00Z");

// A daily A/B rotation handing off at 09:00 UTC, running since New Year.
function dailyLayer(
  db: FakeDb,
  data?: {
    scheduleId?: string;
    projectId?: string;
    layerId?: string;
    users?: Array<string>;
    order?: number;
    restricted?: boolean;
    updatedAt?: Date;
  },
): void {
  const scheduleId: string = data?.scheduleId ?? SCHEDULE;
  const projectId: string = data?.projectId ?? PROJECT;
  const layerId: string = data?.layerId ?? "layer-1";
  const users: Array<string> = data?.users ?? ["A", "B"];

  db.layers.push(
    makeLayer({
      id: layerId,
      scheduleId,
      projectId,
      name: "Primary",
      order: data?.order ?? 1,
      startsAt: at("2026-01-01T00:00:00Z"),
      handOffTime: at("2026-01-01T09:00:00Z"),
      rotation: rotation(EventInterval.Day, 1),
      restrictionTimes: data?.restricted
        ? dailyRestriction("09:00", "17:00", UTC)
        : undefined,
      updatedAt: data?.updatedAt,
    }),
  );

  users.forEach((userId: string, index: number) => {
    db.layerUsers.push(
      makeLayerUser({
        id: `${layerId}-user-${userId}`,
        scheduleId,
        layerId,
        projectId,
        userId,
        order: index + 1,
      }),
    );
  });
}

function baseDb(): FakeDb {
  const db: FakeDb = emptyDb();
  db.schedules.push(
    makeSchedule({
      id: SCHEDULE,
      projectId: PROJECT,
      name: "Payments",
      timezone: UTC,
      shiftConfigVersion: 7,
    }),
  );
  dailyLayer(db);
  return db;
}

function coveringSegment(
  segments: Array<CalendarEvent>,
  instant: Date,
): CalendarEvent | undefined {
  return segments.find((segment: CalendarEvent) => {
    return (
      segment.start.getTime() <= instant.getTime() &&
      segment.end.getTime() > instant.getTime()
    );
  });
}

async function resolve(
  db: FakeDb,
  options?: { maxSimulationIterations?: number; scheduleId?: string },
): Promise<ResolvedShiftSegments> {
  installFakeDb(db);

  const resolved: ResolvedShiftSegments | null =
    await OnCallDutyPolicyScheduleService.getResolvedShiftSegments({
      scheduleId: oid(options?.scheduleId ?? SCHEDULE),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
      maxSimulationIterations: options?.maxSimulationIterations,
    });

  expect(resolved).not.toBeNull();
  return resolved!;
}

describe("OnCallDutyPolicyScheduleService shift resolver", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("window handling", () => {
    test("returns only segments overlapping the window, UNCLIPPED at both ends", async () => {
      const resolved: ResolvedShiftSegments = await resolve(baseDb());

      expect(resolved.segments.length).toBeGreaterThan(0);

      for (const segment of resolved.segments) {
        expect(segment.start.getTime()).toBeLessThan(WINDOW_END.getTime());
        expect(segment.end.getTime()).toBeGreaterThan(WINDOW_START.getTime());
      }

      // The shift covering the window start began at the previous 09:00 handoff.
      const first: CalendarEvent = resolved.segments[0]!;
      expect(first.start.getTime()).toBeLessThan(WINDOW_START.getTime());
      expect(first.start.toISOString()).toMatch(/^2026-03-01T09:00:0[01]/);

      // The shift covering the window end runs to the next 09:00 handoff.
      const last: CalendarEvent =
        resolved.segments[resolved.segments.length - 1]!;
      expect(last.end.getTime()).toBeGreaterThan(WINDOW_END.getTime());
      expect(last.end.toISOString()).toMatch(/^2026-03-05T09:00:00/);
    });

    test("segments alternate between the layer users at each 09:00 handoff", async () => {
      const resolved: ResolvedShiftSegments = await resolve(baseDb());

      const titles: Array<string> = resolved.segments.map(
        (segment: CalendarEvent) => {
          return segment.title;
        },
      );

      expect(titles.length).toBe(4); // 03-01 09:00 .. 03-05 09:00 = four daily shifts
      for (let i: number = 1; i < titles.length; i++) {
        expect(titles[i]).not.toBe(titles[i - 1]);
        expect(["A", "B"]).toContain(titles[i]);
      }
    });

    test("rejects an inverted window", async () => {
      installFakeDb(baseDb());

      await expect(
        OnCallDutyPolicyScheduleService.getResolvedShiftSegments({
          scheduleId: oid(SCHEDULE),
          windowStart: WINDOW_END,
          windowEnd: WINDOW_START,
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    test("a schedule with no layers resolves to no segments and no variants", async () => {
      const db: FakeDb = emptyDb();
      db.schedules.push(
        makeSchedule({ id: SCHEDULE, projectId: PROJECT, timezone: UTC }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);

      expect(resolved.segments).toEqual([]);
      expect(resolved.policyVariants).toEqual([]);
      expect(resolved.layerProps).toEqual([]);
      expect(resolved.truncated).toBe(false);
    });

    test("an unknown schedule resolves to null (and is skipped by the batch)", async () => {
      installFakeDb(baseDb());

      const single: ResolvedShiftSegments | null =
        await OnCallDutyPolicyScheduleService.getResolvedShiftSegments({
          scheduleId: oid("missing"),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
        });
      expect(single).toBeNull();

      const batch: Array<ResolvedShiftSegments> =
        await OnCallDutyPolicyScheduleService.getResolvedShiftSegmentsForSchedules(
          {
            scheduleIds: [oid("missing"), oid(SCHEDULE)],
            windowStart: WINDOW_START,
            windowEnd: WINDOW_END,
          },
        );
      expect(batch).toHaveLength(1);
      expect(batch[0]!.schedule.id).toBe(SCHEDULE);
    });

    test("an empty id list resolves to an empty batch without touching the database", async () => {
      installFakeDb(baseDb());

      const batch: Array<ResolvedShiftSegments> =
        await OnCallDutyPolicyScheduleService.getResolvedShiftSegmentsForSchedules(
          {
            scheduleIds: [],
            windowStart: WINDOW_START,
            windowEnd: WINDOW_END,
          },
        );

      expect(batch).toEqual([]);
      expect(OnCallDutyPolicyScheduleService.findBy).not.toHaveBeenCalled();
    });
  });

  describe("schedule info and layer props", () => {
    test("carries the schedule columns and stamps layer id/name on the layer props and events", async () => {
      const resolved: ResolvedShiftSegments = await resolve(baseDb());

      expect(resolved.schedule).toEqual({
        id: SCHEDULE,
        name: "Payments",
        timezone: UTC,
        projectId: PROJECT,
        shiftConfigVersion: 7,
      });

      expect(resolved.layerProps).toHaveLength(1);
      expect(resolved.layerProps[0]!.layerId).toBe("layer-1");
      expect(resolved.layerProps[0]!.layerName).toBe("Primary");
      expect(resolved.layerProps[0]!.timezone).toBe(UTC);
      expect(resolved.scheduleUserIds).toEqual(["A", "B"]);

      for (const segment of resolved.segments) {
        expect((segment as unknown as Record<string, unknown>)["layerId"]).toBe(
          "layer-1",
        );
        expect(
          (segment as unknown as Record<string, unknown>)["layerName"],
        ).toBe("Primary");
      }
    });

    test("omits the timezone key for a legacy schedule without one", async () => {
      const db: FakeDb = baseDb();
      db.schedules[0]!["timezone"] = undefined;

      const resolved: ResolvedShiftSegments = await resolve(db);

      expect("timezone" in resolved.schedule).toBe(false);
      expect(resolved.layerProps[0]!.timezone).toBeUndefined();
    });

    test("a non-numeric shiftConfigVersion reads as 0", async () => {
      const db: FakeDb = baseDb();
      db.schedules[0]!["shiftConfigVersion"] = undefined;

      const resolved: ResolvedShiftSegments = await resolve(db);
      expect(resolved.schedule.shiftConfigVersion).toBe(0);
    });
  });

  describe("attached policies", () => {
    test("dedupes (policy, rule) rows and orders them", async () => {
      const db: FakeDb = baseDb();
      db.attachments.push(
        makeAttachment({
          id: "att-1",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          policyId: "P1",
          policyName: "Payments Policy",
          ruleId: "R2",
          ruleName: "Secondary",
          ruleOrder: 2,
        }),
        makeAttachment({
          id: "att-2",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          policyId: "P1",
          policyName: "Payments Policy",
          ruleId: "R1",
          ruleName: "Primary",
          ruleOrder: 1,
        }),
        // Duplicate row for the same (policy, rule): the join has no unique index.
        makeAttachment({
          id: "att-3",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          policyId: "P1",
          policyName: "Payments Policy",
          ruleId: "R1",
          ruleName: "Primary",
          ruleOrder: 1,
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);

      expect(resolved.attachedPolicies).toEqual([
        {
          policyId: "P1",
          policyName: "Payments Policy",
          ruleId: "R1",
          ruleName: "Primary",
          ruleOrder: 1,
        },
        {
          policyId: "P1",
          policyName: "Payments Policy",
          ruleId: "R2",
          ruleName: "Secondary",
          ruleOrder: 2,
        },
      ]);
    });

    test("attachments of other schedules are not mixed in", async () => {
      const db: FakeDb = baseDb();
      db.schedules.push(
        makeSchedule({ id: OTHER_SCHEDULE, projectId: PROJECT, timezone: UTC }),
      );
      db.attachments.push(
        makeAttachment({
          id: "att-other",
          scheduleId: OTHER_SCHEDULE,
          projectId: PROJECT,
          policyId: "P9",
          ruleId: "R9",
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);
      expect(resolved.attachedPolicies).toEqual([]);
    });
  });

  describe("overrides in the roster's policy context", () => {
    const OVERRIDE_START: Date = at("2026-03-03T11:00:00Z");
    const OVERRIDE_END: Date = at("2026-03-03T13:00:00Z");

    function whoIsOnAt(
      resolved: ResolvedShiftSegments,
      instant: Date,
    ): string | undefined {
      return coveringSegment(resolved.segments, instant)?.title;
    }

    test("a GLOBAL override substitutes the user inside its window and stamps override meta", async () => {
      const db: FakeDb = baseDb();
      const onCallAtNoon: string = whoIsOnAt(
        await resolve(db),
        at("2026-03-03T12:00:00Z"),
      )!;

      db.overrides.push(
        makeOverride({
          id: "ov-1",
          projectId: PROJECT,
          overrideUserId: onCallAtNoon,
          routeAlertsToUserId: "C",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);

      expect(whoIsOnAt(resolved, at("2026-03-03T12:00:00Z"))).toBe("C");
      expect(whoIsOnAt(resolved, at("2026-03-03T10:00:00Z"))).toBe(
        onCallAtNoon,
      );
      expect(whoIsOnAt(resolved, at("2026-03-03T14:00:00Z"))).toBe(
        onCallAtNoon,
      );

      const substituted: CalendarEvent = coveringSegment(
        resolved.segments,
        at("2026-03-03T12:00:00Z"),
      )!;
      expect(substituted.start).toEqual(OVERRIDE_START);
      expect(substituted.end).toEqual(OVERRIDE_END);
      expect(UserOverrideUtil.getOverrideMeta(substituted)).toMatchObject({
        originalUserId: onCallAtNoon,
        overrideUserId: "C",
      });

      // The override took part in the resolution.
      expect(resolved.overrides).toHaveLength(1);
      expect(resolved.overrides[0]).toMatchObject({
        overrideUserId: onCallAtNoon,
        routeAlertsToUserId: "C",
        onCallDutyPolicyId: null,
      });
    });

    test("an override for a NON-member is ignored", async () => {
      const db: FakeDb = baseDb();
      db.overrides.push(
        makeOverride({
          id: "ov-stranger",
          projectId: PROJECT,
          overrideUserId: "Z",
          routeAlertsToUserId: "C",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);

      expect(whoIsOnAt(resolved, at("2026-03-03T12:00:00Z"))).not.toBe("C");
      expect(resolved.overrides).toEqual([]);
    });

    test("an override in ANOTHER project is ignored even for a member", async () => {
      const db: FakeDb = baseDb();
      db.overrides.push(
        makeOverride({
          id: "ov-other-project",
          projectId: OTHER_PROJECT,
          overrideUserId: "A",
          routeAlertsToUserId: "C",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
        }),
        makeOverride({
          id: "ov-other-project-2",
          projectId: OTHER_PROJECT,
          overrideUserId: "B",
          routeAlertsToUserId: "C",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);

      expect(whoIsOnAt(resolved, at("2026-03-03T12:00:00Z"))).not.toBe("C");
      expect(resolved.overrides).toEqual([]);
    });

    test("an override outside the (widened) window does not participate", async () => {
      const db: FakeDb = baseDb();
      db.overrides.push(
        makeOverride({
          id: "ov-far",
          projectId: PROJECT,
          overrideUserId: "A",
          routeAlertsToUserId: "C",
          startsAt: at("2026-06-01T00:00:00Z"),
          endsAt: at("2026-06-02T00:00:00Z"),
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);
      expect(resolved.overrides).toEqual([]);
    });

    test("with exactly ONE attached policy, that policy's scoped overrides apply (the roster rule)", async () => {
      const db: FakeDb = baseDb();
      db.attachments.push(
        makeAttachment({
          id: "att-1",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          policyId: "P1",
          ruleId: "R1",
        }),
      );
      const onCallAtNoon: string = whoIsOnAt(
        await resolve(db),
        at("2026-03-03T12:00:00Z"),
      )!;

      db.overrides.push(
        makeOverride({
          id: "ov-scoped",
          projectId: PROJECT,
          overrideUserId: onCallAtNoon,
          routeAlertsToUserId: "D",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
          policyId: "P1",
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);

      expect(whoIsOnAt(resolved, at("2026-03-03T12:00:00Z"))).toBe("D");
      expect(resolved.policyVariants).toEqual([]);
      expect(resolved.overrides[0]!.onCallDutyPolicyId).toBe("P1");
    });

    test("a scoped override for a policy the schedule is NOT attached to is ignored", async () => {
      const db: FakeDb = baseDb();
      db.attachments.push(
        makeAttachment({
          id: "att-1",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          policyId: "P1",
          ruleId: "R1",
        }),
      );
      db.overrides.push(
        makeOverride({
          id: "ov-scoped-other",
          projectId: PROJECT,
          overrideUserId: "A",
          routeAlertsToUserId: "D",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
          policyId: "P2",
        }),
        makeOverride({
          id: "ov-scoped-other-b",
          projectId: PROJECT,
          overrideUserId: "B",
          routeAlertsToUserId: "D",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
          policyId: "P2",
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);

      expect(whoIsOnAt(resolved, at("2026-03-03T12:00:00Z"))).not.toBe("D");
      expect(resolved.policyVariants).toEqual([]);
      expect(resolved.overrides).toEqual([]);
    });

    test("with ZERO attached policies, scoped overrides never apply", async () => {
      const db: FakeDb = baseDb();
      db.overrides.push(
        makeOverride({
          id: "ov-scoped",
          projectId: PROJECT,
          overrideUserId: "A",
          routeAlertsToUserId: "D",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
          policyId: "P1",
        }),
        makeOverride({
          id: "ov-scoped-b",
          projectId: PROJECT,
          overrideUserId: "B",
          routeAlertsToUserId: "D",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
          policyId: "P1",
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);
      expect(whoIsOnAt(resolved, at("2026-03-03T12:00:00Z"))).not.toBe("D");
      expect(resolved.policyVariants).toEqual([]);
    });
  });

  describe("policy variants (two or more attached policies)", () => {
    const OVERRIDE_START: Date = at("2026-03-03T09:00:00Z");
    const OVERRIDE_END: Date = at("2026-03-04T09:00:00Z");

    function twoPolicyDb(): FakeDb {
      const db: FakeDb = baseDb();
      db.attachments.push(
        makeAttachment({
          id: "att-1",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          policyId: "P1",
          policyName: "Payments",
          ruleId: "R1",
        }),
        makeAttachment({
          id: "att-2",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          policyId: "P2",
          policyName: "Checkout",
          ruleId: "R2",
        }),
      );
      return db;
    }

    test("no scoped override overlapping the window => no variants, base is global-only", async () => {
      const db: FakeDb = twoPolicyDb();

      const resolved: ResolvedShiftSegments = await resolve(db);

      expect(resolved.policyVariants).toEqual([]);
      expect(
        resolved.attachedPolicies.map((p: MaterializedShiftPolicy) => {
          return p.policyId;
        }),
      ).toEqual(["P2", "P1"]);
    });

    test("a scoped override for a member yields a variant for THAT policy only, base stays global", async () => {
      const db: FakeDb = twoPolicyDb();
      const baseline: ResolvedShiftSegments = await resolve(db);
      const onCall: string = coveringSegment(
        baseline.segments,
        at("2026-03-03T12:00:00Z"),
      )!.title;

      db.overrides.push(
        makeOverride({
          id: "ov-p1",
          projectId: PROJECT,
          overrideUserId: onCall,
          routeAlertsToUserId: "E",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
          policyId: "P1",
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);

      // Base (global-only) still names the rostered person.
      expect(
        coveringSegment(resolved.segments, at("2026-03-03T12:00:00Z"))!.title,
      ).toBe(onCall);

      expect(resolved.policyVariants).toHaveLength(1);
      const variant: ResolvedPolicyVariant = resolved.policyVariants[0]!;
      expect(variant.policyId).toBe("P1");
      expect(variant.policyName).toBe("Payments");
      expect(
        coveringSegment(variant.segments, at("2026-03-03T12:00:00Z"))!.title,
      ).toBe("E");

      // The variant's segments are window-filtered too.
      for (const segment of variant.segments) {
        expect(segment.start.getTime()).toBeLessThan(WINDOW_END.getTime());
        expect(segment.end.getTime()).toBeGreaterThan(WINDOW_START.getTime());
      }

      // Both the scoped override is recorded as participating, with its scope.
      expect(
        resolved.overrides.filter((o: UserOverrideRecord) => {
          return o.onCallDutyPolicyId === "P1";
        }),
      ).toHaveLength(1);
    });

    test("global overrides apply inside every variant as well", async () => {
      const db: FakeDb = twoPolicyDb();
      const baseline: ResolvedShiftSegments = await resolve(db);
      const onCallDay3: string = coveringSegment(
        baseline.segments,
        at("2026-03-03T12:00:00Z"),
      )!.title;
      const onCallDay4: string = coveringSegment(
        baseline.segments,
        at("2026-03-04T12:00:00Z"),
      )!.title;

      db.overrides.push(
        makeOverride({
          id: "ov-global",
          projectId: PROJECT,
          overrideUserId: onCallDay4,
          routeAlertsToUserId: "G",
          startsAt: at("2026-03-04T10:00:00Z"),
          endsAt: at("2026-03-04T12:30:00Z"),
        }),
        makeOverride({
          id: "ov-p2",
          projectId: PROJECT,
          overrideUserId: onCallDay3,
          routeAlertsToUserId: "E",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
          policyId: "P2",
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);

      const variant: ResolvedPolicyVariant = resolved.policyVariants.find(
        (v: ResolvedPolicyVariant) => {
          return v.policyId === "P2";
        },
      )!;
      expect(variant).toBeDefined();
      expect(
        coveringSegment(variant.segments, at("2026-03-03T12:00:00Z"))!.title,
      ).toBe("E");
      expect(
        coveringSegment(variant.segments, at("2026-03-04T11:00:00Z"))!.title,
      ).toBe("G");
      expect(
        coveringSegment(resolved.segments, at("2026-03-04T11:00:00Z"))!.title,
      ).toBe("G");
    });

    test("scoped overrides for a non-member do not create a variant", async () => {
      const db: FakeDb = twoPolicyDb();
      db.overrides.push(
        makeOverride({
          id: "ov-p1-stranger",
          projectId: PROJECT,
          overrideUserId: "Z",
          routeAlertsToUserId: "E",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
          policyId: "P1",
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);
      expect(resolved.policyVariants).toEqual([]);
    });
  });

  describe("lastModifiedAt", () => {
    test("is the max updatedAt over layers, layer users, attachments and participating overrides — never the schedule row", async () => {
      const db: FakeDb = emptyDb();
      db.schedules.push(
        makeSchedule({
          id: SCHEDULE,
          projectId: PROJECT,
          timezone: UTC,
          updatedAt: at("2026-12-31T00:00:00Z"), // roster refresh noise
        }),
      );
      dailyLayer(db, { updatedAt: at("2026-08-01T00:00:00Z") });
      db.layerUsers[0]!["updatedAt"] = at("2026-08-05T00:00:00Z");
      db.attachments.push(
        makeAttachment({
          id: "att-1",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          policyId: "P1",
          ruleId: "R1",
          updatedAt: at("2026-08-03T00:00:00Z"),
        }),
      );
      db.overrides.push(
        makeOverride({
          id: "ov-1",
          projectId: PROJECT,
          overrideUserId: "A",
          routeAlertsToUserId: "C",
          startsAt: at("2026-03-03T11:00:00Z"),
          endsAt: at("2026-03-03T13:00:00Z"),
          updatedAt: at("2026-08-10T00:00:00Z"),
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);
      expect(resolved.lastModifiedAt.toISOString()).toBe(
        "2026-08-10T00:00:00.000Z",
      );
    });

    test("an override that does not participate does not count", async () => {
      const db: FakeDb = baseDb();
      db.overrides.push(
        makeOverride({
          id: "ov-far",
          projectId: PROJECT,
          overrideUserId: "A",
          routeAlertsToUserId: "C",
          startsAt: at("2027-01-01T00:00:00Z"),
          endsAt: at("2027-01-02T00:00:00Z"),
          updatedAt: at("2027-06-01T00:00:00Z"),
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);
      expect(resolved.lastModifiedAt.toISOString()).toBe(
        "2026-08-01T10:00:00.000Z",
      );
    });

    test("falls back to the schedule's createdAt when nothing is configured", async () => {
      const db: FakeDb = emptyDb();
      db.schedules.push(
        makeSchedule({
          id: SCHEDULE,
          projectId: PROJECT,
          createdAt: at("2026-02-02T02:02:02Z"),
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db);
      expect(resolved.lastModifiedAt.toISOString()).toBe(
        "2026-02-02T02:02:02.000Z",
      );
    });

    test("is identical across two resolutions of an unchanged configuration", async () => {
      const first: ResolvedShiftSegments = await resolve(baseDb());
      jest.restoreAllMocks();
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });
      const second: ResolvedShiftSegments = await resolve(baseDb());

      expect(first.lastModifiedAt).toEqual(second.lastModifiedAt);
      expect(
        first.segments.map((s: CalendarEvent) => {
          return [s.title, s.start, s.end];
        }),
      ).toEqual(
        second.segments.map((s: CalendarEvent) => {
          return [s.title, s.start, s.end];
        }),
      );
    });
  });

  describe("truncation", () => {
    test("propagates the engine's truncated flag when the iteration cap is hit", async () => {
      const db: FakeDb = emptyDb();
      db.schedules.push(
        makeSchedule({ id: SCHEDULE, projectId: PROJECT, timezone: UTC }),
      );
      /*
       * A restricted hourly rotation running for years: the pre-window
       * simulation needs tens of thousands of periods.
       */
      db.layers.push(
        makeLayer({
          id: "layer-old",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          startsAt: at("2020-01-01T00:00:00Z"),
          handOffTime: at("2020-01-01T09:00:00Z"),
          rotation: rotation(EventInterval.Hour, 1),
          restrictionTimes: dailyRestriction("09:00", "17:00", UTC),
        }),
      );
      db.layerUsers.push(
        makeLayerUser({
          id: "lu-a",
          scheduleId: SCHEDULE,
          layerId: "layer-old",
          projectId: PROJECT,
          userId: "A",
        }),
      );

      const resolved: ResolvedShiftSegments = await resolve(db, {
        maxSimulationIterations: 10,
      });

      expect(resolved.truncated).toBe(true);
    });

    test("is false for an ordinary schedule", async () => {
      const resolved: ResolvedShiftSegments = await resolve(baseDb(), {
        maxSimulationIterations: 100000,
      });
      expect(resolved.truncated).toBe(false);
      expect(resolved.segments.length).toBeGreaterThan(0);
    });
  });

  describe("batched resolution", () => {
    test("resolves several schedules across projects with one override query, scoping overrides per project", async () => {
      const db: FakeDb = baseDb();
      db.schedules.push(
        makeSchedule({
          id: OTHER_SCHEDULE,
          projectId: OTHER_PROJECT,
          name: "Checkout",
          timezone: UTC,
        }),
      );
      dailyLayer(db, {
        scheduleId: OTHER_SCHEDULE,
        projectId: OTHER_PROJECT,
        layerId: "layer-2",
        users: ["A", "X"],
      });
      // A is a member of both schedules; this override lives in project 2 only.
      db.overrides.push(
        makeOverride({
          id: "ov-p2",
          projectId: OTHER_PROJECT,
          overrideUserId: "A",
          routeAlertsToUserId: "C",
          startsAt: at("2026-03-01T00:00:00Z"),
          endsAt: at("2026-03-06T00:00:00Z"),
        }),
        makeOverride({
          id: "ov-p2-x",
          projectId: OTHER_PROJECT,
          overrideUserId: "X",
          routeAlertsToUserId: "C",
          startsAt: at("2026-03-01T00:00:00Z"),
          endsAt: at("2026-03-06T00:00:00Z"),
        }),
      );

      installFakeDb(db);

      const batch: Array<ResolvedShiftSegments> =
        await OnCallDutyPolicyScheduleService.getResolvedShiftSegmentsForSchedules(
          {
            scheduleIds: [oid(SCHEDULE), oid(OTHER_SCHEDULE), oid(SCHEDULE)],
            windowStart: WINDOW_START,
            windowEnd: WINDOW_END,
          },
        );

      expect(
        batch.map((r: ResolvedShiftSegments) => {
          return r.schedule.id;
        }),
      ).toEqual([SCHEDULE, OTHER_SCHEDULE]);
      expect(OnCallDutyPolicyUserOverrideService.findBy).toHaveBeenCalledTimes(
        1,
      );

      const [first, second] = batch as [
        ResolvedShiftSegments,
        ResolvedShiftSegments,
      ];

      // Project 1: nobody substituted.
      expect(first.overrides).toEqual([]);
      for (const segment of first.segments) {
        expect(["A", "B"]).toContain(segment.title);
      }

      // Project 2: everyone substituted by C for the whole window.
      expect(second.overrides).toHaveLength(2);
      for (const segment of second.segments) {
        expect(segment.title).toBe("C");
      }
    });

    test("each schedule reports its own truncated flag and layer props", async () => {
      const db: FakeDb = baseDb();
      db.schedules.push(
        makeSchedule({ id: OTHER_SCHEDULE, projectId: PROJECT, timezone: UTC }),
      );
      db.layers.push(
        makeLayer({
          id: "layer-old",
          scheduleId: OTHER_SCHEDULE,
          projectId: PROJECT,
          startsAt: at("2020-01-01T00:00:00Z"),
          handOffTime: at("2020-01-01T09:00:00Z"),
          rotation: rotation(EventInterval.Hour, 1),
          restrictionTimes: dailyRestriction("09:00", "17:00", UTC),
        }),
      );
      db.layerUsers.push(
        makeLayerUser({
          id: "lu-old",
          scheduleId: OTHER_SCHEDULE,
          layerId: "layer-old",
          projectId: PROJECT,
          userId: "Q",
        }),
      );

      installFakeDb(db);

      const batch: Array<ResolvedShiftSegments> =
        await OnCallDutyPolicyScheduleService.getResolvedShiftSegmentsForSchedules(
          {
            scheduleIds: [oid(SCHEDULE), oid(OTHER_SCHEDULE)],
            windowStart: WINDOW_START,
            windowEnd: WINDOW_END,
            maxSimulationIterations: 10,
          },
        );

      expect(batch[0]!.truncated).toBe(false);
      expect(batch[0]!.segments.length).toBeGreaterThan(0);
      expect(batch[1]!.truncated).toBe(true);
      expect(batch[1]!.layerProps[0]!.layerId).toBe("layer-old");
    });
  });
});
