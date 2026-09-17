import OnCallShiftMaterializer, {
  MaterializeResult,
  MaterializedScheduleInfo,
  MaterializedUserInfo,
} from "../../../../Server/Utils/OnCall/OnCallShiftMaterializer";
import OnCallDutyPolicyScheduleLayerUserService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyUserOverrideService from "../../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import UserService from "../../../../Server/Services/UserService";
import logger from "../../../../Server/Utils/Logger";
import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import EventInterval from "../../../../Types/Events/EventInterval";
import ObjectID from "../../../../Types/ObjectID";
import { LayerProps } from "../../../../Types/OnCallDutyPolicy/Layer";
import {
  MaterializedShift,
  MaterializedShiftPolicy,
} from "../../../../Types/OnCallDutyPolicy/MaterializedShift";
import { OnCallShift } from "../../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import {
  at,
  dailyRestriction,
  rotation,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedTestFixtures";
import {
  FakeDb,
  emptyDb,
  installFakeDb,
  makeAttachment,
  makeLayer,
  makeLayerUser,
  makeOverride,
  makeProject,
  makeSchedule,
  makeUser,
  oid,
} from "./OnCallResolverTestHarness";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * OnCallShiftMaterializer: resolver segments -> MaterializedShift[].
 *
 * The fixtures are the ones the calendar-feed spec names — multi-layer with
 * restricted hours, a partial override, a substitute who is not a member,
 * a schedule attached to two policies with a policy-scoped override, and
 * the audit "A[10:00-11:00], B[11:00:01-12:00]" seam case — and every one is
 * CROSS-CHECKED against the service methods paging uses
 * (getCurrentUserIdInSchedule / getEventByIndexInSchedule), which run the
 * real code against the same in-memory rows.
 */

const UTC: string = "UTC";
const PROJECT: string = "project-1";
const SCHEDULE: string = "schedule-1";
const SCHEDULE_2: string = "schedule-2";

const WINDOW_START: Date = at("2026-03-02T00:00:00Z");
const WINDOW_END: Date = at("2026-03-05T00:00:00Z");
const NOW: Date = at("2026-03-03T12:00:00Z");

function ids(list: Array<ObjectID>): Array<string> {
  return list.map((id: ObjectID) => {
    return id.toString();
  });
}

/*
 * Fixture A: "Primary" A/B daily rotation restricted to 09:00-17:00 UTC over
 * a 24x7 "Fallback" layer with C, attached to one policy.
 */
function multiLayerDb(): FakeDb {
  const db: FakeDb = emptyDb();

  db.projects.push(makeProject({ id: PROJECT, name: "Acme" }));
  db.schedules.push(
    makeSchedule({
      id: SCHEDULE,
      projectId: PROJECT,
      name: "Payments",
      timezone: UTC,
      shiftConfigVersion: 4,
    }),
  );

  db.layers.push(
    makeLayer({
      id: "layer-primary",
      scheduleId: SCHEDULE,
      projectId: PROJECT,
      name: "Primary",
      order: 1,
      startsAt: at("2026-01-01T00:00:00Z"),
      handOffTime: at("2026-01-01T09:00:00Z"),
      rotation: rotation(EventInterval.Day, 1),
      restrictionTimes: dailyRestriction("09:00", "17:00", UTC),
    }),
    makeLayer({
      id: "layer-fallback",
      scheduleId: SCHEDULE,
      projectId: PROJECT,
      name: "Fallback",
      order: 2,
      startsAt: at("2026-01-05T00:00:00Z"),
      handOffTime: at("2026-01-05T00:00:00Z"),
      rotation: rotation(EventInterval.Week, 1),
    }),
  );

  db.layerUsers.push(
    makeLayerUser({
      id: "lu-a",
      scheduleId: SCHEDULE,
      layerId: "layer-primary",
      projectId: PROJECT,
      userId: "A",
      order: 1,
    }),
    makeLayerUser({
      id: "lu-b",
      scheduleId: SCHEDULE,
      layerId: "layer-primary",
      projectId: PROJECT,
      userId: "B",
      order: 2,
    }),
    makeLayerUser({
      id: "lu-c",
      scheduleId: SCHEDULE,
      layerId: "layer-fallback",
      projectId: PROJECT,
      userId: "C",
      order: 1,
    }),
  );

  db.attachments.push(
    makeAttachment({
      id: "att-1",
      scheduleId: SCHEDULE,
      projectId: PROJECT,
      policyId: "P1",
      policyName: "Payments Policy",
      ruleId: "R1",
      ruleName: "Primary rule",
      ruleOrder: 1,
    }),
  );

  db.users.push(
    makeUser({
      id: "A",
      name: "Alice",
      email: "alice@example.com",
      timezone: "UTC",
    }),
    makeUser({ id: "B", email: "bob@example.com" }),
    makeUser({
      id: "C",
      name: "Carol",
      email: "carol@example.com",
      timezone: "Europe/Stockholm",
    }),
    makeUser({ id: "E", name: "Erin" }),
  );

  return db;
}

/*
 * Who the materialization says is on call at `instant` — in a policy's
 * context when `policyId` is given: a policy-variant shift for that policy
 * wins, otherwise the base (roster) shift applies, exactly as paging would
 * resolve it.
 */
function coveringShift(
  shifts: Array<MaterializedShift>,
  instant: Date,
  options?: { policyId?: string | undefined },
): MaterializedShift | undefined {
  const covers: (shift: MaterializedShift) => boolean = (
    shift: MaterializedShift,
  ): boolean => {
    return (
      shift.start.getTime() <= instant.getTime() &&
      shift.end.getTime() > instant.getTime()
    );
  };

  if (options?.policyId) {
    const variant: MaterializedShift | undefined = shifts.find(
      (shift: MaterializedShift) => {
        return (
          shift.policyVariantOf?.policyId === options.policyId && covers(shift)
        );
      },
    );
    if (variant) {
      return variant;
    }
  }

  return shifts.find((shift: MaterializedShift) => {
    return !shift.policyVariantOf && covers(shift);
  });
}

function baseShifts(
  shifts: Array<MaterializedShift>,
): Array<MaterializedShift> {
  return shifts.filter((shift: MaterializedShift) => {
    return !shift.policyVariantOf;
  });
}

async function materializeSchedule(
  db: FakeDb,
  options?: { now?: Date; maxSimulationIterations?: number },
): Promise<MaterializeResult> {
  installFakeDb(db);
  return await OnCallShiftMaterializer.materializeForSchedule({
    scheduleId: oid(SCHEDULE),
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    now: options?.now ?? NOW,
    maxSimulationIterations: options?.maxSimulationIterations,
  });
}

function withinOneSecond(a: Date, b: Date): void {
  expect(Math.abs(a.getTime() - b.getTime())).toBeLessThanOrEqual(1000);
}

/*
 * The cross-check proper: at `now`, the person the materializer says is on
 * call must be the person paging would resolve, and the current / next
 * events paging computes must line up with the materialized shift boundaries
 * (to within the engine's one-second seam, which the materializer removes).
 */
async function crossCheck(data: {
  shifts: Array<MaterializedShift>;
  now: Date;
  policyId?: string | undefined;
}): Promise<void> {
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(data.now);

  const current: MaterializedShift | undefined = coveringShift(
    data.shifts,
    data.now,
    { policyId: data.policyId },
  );
  expect(current).toBeDefined();

  const pagedUser: ObjectID | null =
    await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
      oid(SCHEDULE),
      { onCallDutyPolicyId: data.policyId ? oid(data.policyId) : undefined },
    );

  expect(pagedUser?.toString()).toBe(current!.userId);

  const events: Array<CalendarEvent> =
    await OnCallDutyPolicyScheduleService.getEventByIndexInSchedule({
      scheduleId: oid(SCHEDULE),
      getNumberOfEvents: 2,
      onCallDutyPolicyId: data.policyId ? oid(data.policyId) : undefined,
    });

  expect(events.length).toBeGreaterThanOrEqual(1);
  expect(events[0]!.title).toBe(current!.userId);
  withinOneSecond(events[0]!.end, current!.end);

  if (events[1]) {
    const next: MaterializedShift | undefined = coveringShift(
      data.shifts,
      new Date(current!.end.getTime() + 1000),
      { policyId: data.policyId },
    );
    expect(next).toBeDefined();
    expect(events[1]!.title).toBe(next!.userId);
    withinOneSecond(events[1]!.start, next!.start);
  }
}

describe("OnCallShiftMaterializer", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("multi-layer schedule with restricted hours (fixture A)", () => {
    test("one shift per active block, seam-normalised, touching, no overlaps, all inside the window", async () => {
      const result: MaterializeResult =
        await materializeSchedule(multiLayerDb());
      const shifts: Array<MaterializedShift> = baseShifts(result.shifts);

      expect(result.truncated).toBe(false);
      expect(shifts.length).toBeGreaterThan(3);

      for (const shift of shifts) {
        expect(shift.start.getTime()).toBeLessThan(WINDOW_END.getTime());
        expect(shift.end.getTime()).toBeGreaterThan(WINDOW_START.getTime());
        expect(shift.end.getTime()).toBeGreaterThan(shift.start.getTime());
        // Minute-aligned after seam normalisation.
        expect(shift.start.getUTCSeconds()).toBe(0);
        expect(shift.start.getUTCMilliseconds()).toBe(0);
        expect(shift.end.getUTCSeconds()).toBe(0);
        expect(shift.coverageSeconds).toBe(
          Math.round((shift.end.getTime() - shift.start.getTime()) / 1000),
        );
      }

      for (let i: number = 1; i < shifts.length; i++) {
        const previous: MaterializedShift = shifts[i - 1]!;
        const current: MaterializedShift = shifts[i]!;
        // Sorted by start, touching exactly, never overlapping.
        expect(current.start.getTime()).toBeGreaterThanOrEqual(
          previous.start.getTime(),
        );
        expect(current.start.getTime()).toBe(previous.end.getTime());
      }
    });

    test("primary shifts are 09:00-17:00 by A or B with layer identity; the fallback fills the rest with C", async () => {
      const result: MaterializeResult =
        await materializeSchedule(multiLayerDb());
      const shifts: Array<MaterializedShift> = baseShifts(result.shifts);

      const primary: Array<MaterializedShift> = shifts.filter(
        (shift: MaterializedShift) => {
          return shift.layerName === "Primary";
        },
      );
      const fallback: Array<MaterializedShift> = shifts.filter(
        (shift: MaterializedShift) => {
          return shift.layerName === "Fallback";
        },
      );

      expect(primary).toHaveLength(3); // 03-02, 03-03, 03-04
      for (const shift of primary) {
        expect(shift.layerId).toBe("layer-primary");
        expect(shift.start.getUTCHours()).toBe(9);
        expect(shift.end.getUTCHours()).toBe(17);
        expect(shift.coverageSeconds).toBe(8 * 3600);
        expect(["A", "B"]).toContain(shift.userId);
      }
      expect(primary[0]!.userId).not.toBe(primary[1]!.userId);
      expect(primary[1]!.userId).not.toBe(primary[2]!.userId);

      expect(fallback.length).toBeGreaterThan(0);
      for (const shift of fallback) {
        expect(shift.layerId).toBe("layer-fallback");
        expect(shift.userId).toBe("C");
      }

      expect(coveringShift(shifts, at("2026-03-03T12:00:00Z"))!.layerName).toBe(
        "Primary",
      );
      expect(coveringShift(shifts, at("2026-03-03T20:00:00Z"))!.userId).toBe(
        "C",
      );
      expect(coveringShift(shifts, at("2026-03-03T03:00:00Z"))!.userId).toBe(
        "C",
      );
    });

    test("carries schedule, project, policy, version, lastModifiedAt and isPast", async () => {
      const result: MaterializeResult =
        await materializeSchedule(multiLayerDb());

      for (const shift of result.shifts) {
        expect(shift.projectId).toBe(PROJECT);
        expect(shift.projectName).toBe("Acme");
        expect(shift.scheduleId).toBe(SCHEDULE);
        expect(shift.scheduleName).toBe("Payments");
        expect(shift.scheduleTimezone).toBe(UTC);
        expect(shift.shiftConfigVersion).toBe(4);
        expect(shift.lastModifiedAt.toISOString()).toBe(
          "2026-08-01T10:00:00.000Z",
        );
        expect(shift.policies).toEqual([
          {
            policyId: "P1",
            policyName: "Payments Policy",
            ruleId: "R1",
            ruleName: "Primary rule",
            ruleOrder: 1,
          },
        ]);
        expect(shift.isPast).toBe(shift.start.getTime() < NOW.getTime());
        expect(shift.override).toBeUndefined();
        expect(shift.policyVariantOf).toBeUndefined();
      }

      expect(
        result.shifts.some((shift: MaterializedShift) => {
          return shift.isPast;
        }),
      ).toBe(true);
      expect(
        result.shifts.some((shift: MaterializedShift) => {
          return !shift.isPast;
        }),
      ).toBe(true);
    });

    test("names and timezones come from ONE user lookup; email is the fallback, unknown users are 'Unnamed user'", async () => {
      const result: MaterializeResult =
        await materializeSchedule(multiLayerDb());

      expect(UserService.findBy).toHaveBeenCalledTimes(1);

      const byUser: Record<string, string> = {};
      for (const shift of result.shifts) {
        byUser[shift.userId] = shift.userName;
      }
      expect(byUser["A"]).toBe("Alice");
      expect(byUser["B"]).toBe("bob@example.com");
      expect(byUser["C"]).toBe("Carol");

      const carol: MaterializedUserInfo | undefined = result.users.find(
        (u: MaterializedUserInfo) => {
          return u.userId === "C";
        },
      );
      expect(carol).toEqual({
        userId: "C",
        userName: "Carol",
        email: "carol@example.com",
        timezone: "Europe/Stockholm",
      });
      const bob: MaterializedUserInfo | undefined = result.users.find(
        (u: MaterializedUserInfo) => {
          return u.userId === "B";
        },
      );
      expect(bob).toEqual({
        userId: "B",
        userName: "bob@example.com",
        email: "bob@example.com",
      });
    });

    test("exposes per-schedule info (layer props for the coverage envelope, attached policies, members)", async () => {
      const result: MaterializeResult =
        await materializeSchedule(multiLayerDb());

      expect(result.schedules).toHaveLength(1);
      const info: MaterializedScheduleInfo = result.schedules[0]!;
      expect(info.scheduleId).toBe(SCHEDULE);
      expect(info.scheduleName).toBe("Payments");
      expect(info.projectName).toBe("Acme");
      expect(info.scheduleTimezone).toBe(UTC);
      expect(info.shiftConfigVersion).toBe(4);
      expect(info.truncated).toBe(false);
      expect(
        info.layerProps.map((l: LayerProps) => {
          return l.layerId;
        }),
      ).toEqual(["layer-primary", "layer-fallback"]);
      expect(info.scheduleUserIds).toEqual(["A", "B", "C"]);
      expect(info.attachedPolicies).toHaveLength(1);
      expect(result.generatedAt).toBe(NOW);
    });

    test("cross-check: agrees with getCurrentUserIdInSchedule / getEventByIndexInSchedule during and outside office hours", async () => {
      const result: MaterializeResult =
        await materializeSchedule(multiLayerDb());

      await crossCheck({
        shifts: result.shifts,
        now: at("2026-03-03T12:00:00Z"),
        policyId: "P1",
      });
      await crossCheck({
        shifts: result.shifts,
        now: at("2026-03-03T20:00:00Z"),
        policyId: "P1",
      });
      await crossCheck({
        shifts: result.shifts,
        now: at("2026-03-04T08:59:00Z"),
        policyId: "P1",
      });
    });
  });

  describe("shift identity and content hash", () => {
    test("shiftKey is schedule + seam-normalised start; hashes are deterministic across runs", async () => {
      const first: MaterializeResult =
        await materializeSchedule(multiLayerDb());
      jest.restoreAllMocks();
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });
      const second: MaterializeResult =
        await materializeSchedule(multiLayerDb());

      expect(
        first.shifts.map((s: MaterializedShift) => {
          return s.shiftKey;
        }),
      ).toEqual(
        second.shifts.map((s: MaterializedShift) => {
          return s.shiftKey;
        }),
      );
      expect(
        first.shifts.map((s: MaterializedShift) => {
          return s.contentHash;
        }),
      ).toEqual(
        second.shifts.map((s: MaterializedShift) => {
          return s.contentHash;
        }),
      );

      for (const shift of first.shifts) {
        expect(shift.shiftKey).toBe(
          `${SCHEDULE}:${Math.floor(shift.start.getTime() / 1000)}`,
        );
        expect(shift.contentHash).toMatch(/^[0-9a-f]{64}$/);
      }

      // Keys are unique.
      expect(
        new Set(
          first.shifts.map((s: MaterializedShift) => {
            return s.shiftKey;
          }),
        ).size,
      ).toBe(first.shifts.length);
    });

    test("a display-name change alters the hash of that user's shifts only", async () => {
      const before: MaterializeResult =
        await materializeSchedule(multiLayerDb());
      jest.restoreAllMocks();
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });

      const db: FakeDb = multiLayerDb();
      db.users[0]!["name"] = "Alicia";
      const after: MaterializeResult = await materializeSchedule(db);

      expect(after.shifts).toHaveLength(before.shifts.length);
      before.shifts.forEach((shift: MaterializedShift, index: number) => {
        const other: MaterializedShift = after.shifts[index]!;
        expect(other.shiftKey).toBe(shift.shiftKey);
        if (shift.userId === "A") {
          expect(other.contentHash).not.toBe(shift.contentHash);
          expect(other.userName).toBe("Alicia");
        } else {
          expect(other.contentHash).toBe(shift.contentHash);
        }
      });
    });

    test("computeContentHash ignores shiftKey / version / lastModifiedAt and reacts to content", () => {
      const base: MaterializedShift = {
        shiftKey: "k",
        contentHash: "",
        projectId: PROJECT,
        scheduleId: SCHEDULE,
        scheduleName: "Payments",
        userId: "A",
        userName: "Alice",
        start: at("2026-03-03T09:00:00Z"),
        end: at("2026-03-03T17:00:00Z"),
        coverageSeconds: 8 * 3600,
        policies: [],
        isPast: false,
        lastModifiedAt: at("2026-01-01T00:00:00Z"),
        shiftConfigVersion: 1,
      };

      const hash: string = OnCallShiftMaterializer.computeContentHash(base);

      const identityOnlyChange: MaterializedShift = {
        ...base,
        shiftKey: "other",
        lastModifiedAt: at("2027-01-01T00:00:00Z"),
        shiftConfigVersion: 99,
      };
      expect(
        OnCallShiftMaterializer.computeContentHash(identityOnlyChange),
      ).toBe(hash);

      expect(
        OnCallShiftMaterializer.computeContentHash({
          ...base,
          end: at("2026-03-03T18:00:00Z"),
        }),
      ).not.toBe(hash);
      expect(
        OnCallShiftMaterializer.computeContentHash({ ...base, userId: "B" }),
      ).not.toBe(hash);
      expect(
        OnCallShiftMaterializer.computeContentHash({
          ...base,
          layerName: "Primary",
        }),
      ).not.toBe(hash);
      expect(
        OnCallShiftMaterializer.computeContentHash({
          ...base,
          policies: [
            {
              policyId: "P1",
              policyName: "x",
              ruleId: "R1",
              ruleName: "r",
              ruleOrder: 1,
            },
          ],
        }),
      ).not.toBe(hash);
    });
  });

  describe("partial override (fixture B)", () => {
    const OVERRIDE_START: Date = at("2026-03-03T11:00:00Z");
    const OVERRIDE_END: Date = at("2026-03-03T13:00:00Z");

    async function overrideDb(): Promise<{ db: FakeDb; original: string }> {
      const baseline: MaterializeResult =
        await materializeSchedule(multiLayerDb());
      const original: string = coveringShift(baseline.shifts, NOW)!.userId;
      jest.restoreAllMocks();
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });

      const db: FakeDb = multiLayerDb();
      db.overrides.push(
        makeOverride({
          id: "ov-1",
          projectId: PROJECT,
          overrideUserId: original,
          routeAlertsToUserId: "D",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
        }),
      );
      return { db, original };
    }

    test("splits the day into X / D / X with three touching shifts and override provenance on the middle one", async () => {
      const { db, original } = await overrideDb();
      const result: MaterializeResult = await materializeSchedule(db);

      const day: Array<MaterializedShift> = baseShifts(result.shifts).filter(
        (shift: MaterializedShift) => {
          return (
            shift.layerName === "Primary" && shift.start.getUTCDate() === 3
          );
        },
      );

      expect(
        day.map((s: MaterializedShift) => {
          return [s.userId, s.start.toISOString(), s.end.toISOString()];
        }),
      ).toEqual([
        [original, "2026-03-03T09:00:00.000Z", "2026-03-03T11:00:00.000Z"],
        ["D", "2026-03-03T11:00:00.000Z", "2026-03-03T13:00:00.000Z"],
        [original, "2026-03-03T13:00:00.000Z", "2026-03-03T17:00:00.000Z"],
      ]);

      const [before, during, after] = day as [
        MaterializedShift,
        MaterializedShift,
        MaterializedShift,
      ];

      expect(before.override).toBeUndefined();
      expect(after.override).toBeUndefined();
      expect(during.override).toEqual({
        originalUserId: original,
        originalUserName: original === "A" ? "Alice" : "bob@example.com",
        overrideStartsAt: OVERRIDE_START,
        overrideEndsAt: OVERRIDE_END,
      });
      expect(during.override!.onCallDutyPolicyId).toBeUndefined();
      expect(during.userName).toBe("Unnamed user"); // D has no user row
      expect(during.shiftKey).toBe(
        `${SCHEDULE}:${Math.floor(OVERRIDE_START.getTime() / 1000)}`,
      );
      expect(
        new Set(
          day.map((s: MaterializedShift) => {
            return s.shiftKey;
          }),
        ).size,
      ).toBe(3);
    });

    test("cross-check: paging pages the substitute during the override and the original outside it", async () => {
      const { db } = await overrideDb();
      const result: MaterializeResult = await materializeSchedule(db);

      await crossCheck({
        shifts: result.shifts,
        now: at("2026-03-03T12:00:00Z"),
        policyId: "P1",
      });
      await crossCheck({
        shifts: result.shifts,
        now: at("2026-03-03T10:30:00Z"),
        policyId: "P1",
      });
      await crossCheck({
        shifts: result.shifts,
        now: at("2026-03-03T13:30:00Z"),
        policyId: "P1",
      });
    });

    test("substitute who is NOT a member: covering shift appears only with includeCoveringShifts", async () => {
      const { db } = await overrideDb();
      installFakeDb(db);

      const covering: MaterializeResult =
        await OnCallShiftMaterializer.materializeForUser({
          userId: oid("D"),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          now: NOW,
          includeCoveringShifts: true,
        });

      expect(covering.shifts).toHaveLength(1);
      expect(covering.shifts[0]!.userId).toBe("D");
      expect(covering.shifts[0]!.override?.originalUserId).toBeDefined();
      expect(
        covering.schedules.map((s: MaterializedScheduleInfo) => {
          return s.scheduleId;
        }),
      ).toEqual([SCHEDULE]);

      const own: MaterializeResult =
        await OnCallShiftMaterializer.materializeForUser({
          userId: oid("D"),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          now: NOW,
          includeCoveringShifts: false,
        });

      expect(own.shifts).toEqual([]);
      expect(own.schedules).toEqual([]);
    });

    test("the overridden user's own feed loses the middle block", async () => {
      const { db, original } = await overrideDb();
      installFakeDb(db);

      const result: MaterializeResult =
        await OnCallShiftMaterializer.materializeForUser({
          userId: oid(original),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          now: NOW,
          includeCoveringShifts: true,
        });

      for (const shift of result.shifts) {
        expect(shift.userId).toBe(original);
      }
      expect(coveringShift(result.shifts, NOW)).toBeUndefined();
      expect(
        coveringShift(result.shifts, at("2026-03-03T10:00:00Z")),
      ).toBeDefined();
    });
  });

  describe("multi-policy schedule with a policy-scoped override (fixture C)", () => {
    const OVERRIDE_START: Date = at("2026-03-03T09:00:00Z");
    const OVERRIDE_END: Date = at("2026-03-03T17:00:00Z");

    async function twoPolicyDb(): Promise<{ db: FakeDb; original: string }> {
      const baseline: MaterializeResult =
        await materializeSchedule(multiLayerDb());
      const original: string = coveringShift(baseline.shifts, NOW)!.userId;
      jest.restoreAllMocks();
      jest.spyOn(logger, "error").mockImplementation((): void => {
        return undefined;
      });

      const db: FakeDb = multiLayerDb();
      db.attachments.push(
        makeAttachment({
          id: "att-2",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          policyId: "P2",
          policyName: "Checkout Policy",
          ruleId: "R2",
          ruleName: "Checkout rule",
          ruleOrder: 1,
        }),
      );
      db.overrides.push(
        makeOverride({
          id: "ov-scoped",
          projectId: PROJECT,
          overrideUserId: original,
          routeAlertsToUserId: "E",
          startsAt: OVERRIDE_START,
          endsAt: OVERRIDE_END,
          policyId: "P1",
        }),
      );
      return { db, original };
    }

    test("emits the base shift for the rostered user plus ONE policy-variant shift for the substitute", async () => {
      const { db, original } = await twoPolicyDb();
      const result: MaterializeResult = await materializeSchedule(db);

      const base: MaterializedShift = coveringShift(result.shifts, NOW)!;
      expect(base.userId).toBe(original);
      expect(base.override).toBeUndefined();
      expect(base.policyVariantOf).toBeUndefined();
      expect(
        base.policies
          .map((p: MaterializedShiftPolicy) => {
            return p.policyId;
          })
          .sort(),
      ).toEqual(["P1", "P2"]);

      const variants: Array<MaterializedShift> = result.shifts.filter(
        (s: MaterializedShift) => {
          return Boolean(s.policyVariantOf);
        },
      );
      expect(variants).toHaveLength(1);

      const variant: MaterializedShift = variants[0]!;
      expect(variant.userId).toBe("E");
      expect(variant.userName).toBe("Erin");
      expect(variant.start).toEqual(OVERRIDE_START);
      expect(variant.end).toEqual(OVERRIDE_END);
      expect(variant.policyVariantOf).toEqual({
        policyId: "P1",
        policyName: "Payments Policy",
        globalUserId: original,
      });
      expect(variant.override).toMatchObject({
        originalUserId: original,
        overrideStartsAt: OVERRIDE_START,
        overrideEndsAt: OVERRIDE_END,
        onCallDutyPolicyId: "P1",
      });
      expect(variant.shiftKey).toBe(
        `${SCHEDULE}:${Math.floor(OVERRIDE_START.getTime() / 1000)}:P1`,
      );
      expect(variant.shiftKey).not.toBe(base.shiftKey);
      expect(
        variant.policies
          .map((p: MaterializedShiftPolicy) => {
            return p.policyId;
          })
          .sort(),
      ).toEqual(["P1", "P2"]);
    });

    test("filterShiftsForUser gives the substitute the variant and the original the base shift", async () => {
      const { db, original } = await twoPolicyDb();
      const result: MaterializeResult = await materializeSchedule(db);

      const forE: Array<MaterializedShift> =
        OnCallShiftMaterializer.filterShiftsForUser(result.shifts, oid("E"));
      expect(forE).toHaveLength(1);
      expect(forE[0]!.policyVariantOf?.policyId).toBe("P1");

      const forOriginal: Array<MaterializedShift> =
        OnCallShiftMaterializer.filterShiftsForUser(result.shifts, original);
      expect(coveringShift(forOriginal, NOW)).toBeDefined();
      expect(
        forOriginal.every((s: MaterializedShift) => {
          return s.userId === original;
        }),
      ).toBe(true);
    });

    test("cross-check: paging with P1 pages the substitute, paging with P2 pages the rostered user", async () => {
      const { db } = await twoPolicyDb();
      const result: MaterializeResult = await materializeSchedule(db);

      await crossCheck({ shifts: result.shifts, now: NOW, policyId: "P1" });
      await crossCheck({ shifts: result.shifts, now: NOW, policyId: "P2" });

      jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
      const viaP1: ObjectID | null =
        await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
          oid(SCHEDULE),
          { onCallDutyPolicyId: oid("P1") },
        );
      const viaP2: ObjectID | null =
        await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
          oid(SCHEDULE),
          { onCallDutyPolicyId: oid("P2") },
        );
      expect(viaP1?.toString()).toBe("E");
      expect(viaP2?.toString()).not.toBe("E");
    });

    test("the substitute's personal feed carries the variant even though they are not a member", async () => {
      const { db } = await twoPolicyDb();
      installFakeDb(db);

      const result: MaterializeResult =
        await OnCallShiftMaterializer.materializeForUser({
          userId: oid("E"),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          now: NOW,
          includeCoveringShifts: true,
        });

      expect(result.shifts).toHaveLength(1);
      expect(result.shifts[0]!.policyVariantOf?.policyId).toBe("P1");
    });
  });

  describe("the audit seam fixture: A[10:00-11:00], B[11:00:01-12:00] over a 24x7 fallback", () => {
    function seamDb(): FakeDb {
      const db: FakeDb = emptyDb();
      db.schedules.push(
        makeSchedule({
          id: SCHEDULE,
          projectId: PROJECT,
          name: "Seams",
          timezone: UTC,
        }),
      );
      db.layers.push(
        makeLayer({
          id: "layer-hourly",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          name: "Hourly",
          order: 1,
          startsAt: at("2026-03-02T00:00:00Z"),
          handOffTime: at("2026-03-02T11:00:00Z"),
          rotation: rotation(EventInterval.Hour, 1),
          restrictionTimes: dailyRestriction("10:00", "12:00", UTC),
        }),
        makeLayer({
          id: "layer-24x7",
          scheduleId: SCHEDULE,
          projectId: PROJECT,
          name: "Always",
          order: 2,
          startsAt: at("2026-03-02T00:00:00Z"),
          handOffTime: at("2026-03-02T00:00:00Z"),
          rotation: rotation(EventInterval.Week, 1),
        }),
      );
      db.layerUsers.push(
        makeLayerUser({
          id: "lu-a",
          scheduleId: SCHEDULE,
          layerId: "layer-hourly",
          projectId: PROJECT,
          userId: "A",
          order: 1,
        }),
        makeLayerUser({
          id: "lu-b",
          scheduleId: SCHEDULE,
          layerId: "layer-hourly",
          projectId: PROJECT,
          userId: "B",
          order: 2,
        }),
        makeLayerUser({
          id: "lu-c",
          scheduleId: SCHEDULE,
          layerId: "layer-24x7",
          projectId: PROJECT,
          userId: "C",
          order: 1,
        }),
      );
      return db;
    }

    test("the one-second seam disappears: the two hourly blocks touch exactly at 11:00:00", async () => {
      const result: MaterializeResult = await materializeSchedule(seamDb());

      const day: Array<MaterializedShift> = baseShifts(result.shifts).filter(
        (shift: MaterializedShift) => {
          return shift.layerName === "Hourly" && shift.start.getUTCDate() === 3;
        },
      );

      expect(
        day.map((s: MaterializedShift) => {
          return [s.userId, s.start.toISOString(), s.end.toISOString()];
        }),
      ).toEqual([
        ["A", "2026-03-03T10:00:00.000Z", "2026-03-03T11:00:00.000Z"],
        ["B", "2026-03-03T11:00:00.000Z", "2026-03-03T12:00:00.000Z"],
      ]);

      const around: MaterializedShift = coveringShift(
        result.shifts,
        at("2026-03-03T09:59:00Z"),
      )!;
      expect(around.userId).toBe("C");
      expect(around.end.toISOString()).toBe("2026-03-03T10:00:00.000Z");
    });

    test("cross-check at 11:30 pages B; at 12:30 pages C", async () => {
      const result: MaterializeResult = await materializeSchedule(seamDb());
      await crossCheck({
        shifts: result.shifts,
        now: at("2026-03-03T11:30:00Z"),
      });
      await crossCheck({
        shifts: result.shifts,
        now: at("2026-03-03T12:30:00Z"),
      });
    });
  });

  describe("toShifts / diffPolicyVariant (pure helpers)", () => {
    test("toShifts drops empty segments and normalises seams", () => {
      const shifts: Array<OnCallShift> = OnCallShiftMaterializer.toShifts([
        {
          id: 1,
          title: "A",
          start: at("2026-03-03T09:00:01Z"),
          end: at("2026-03-03T10:59:59Z"),
          allDay: false,
        },
        {
          id: 2,
          title: "B",
          start: at("2026-03-03T11:00:00Z"),
          end: at("2026-03-03T11:00:00Z"),
          allDay: false,
        },
        {
          id: 3,
          title: "B",
          start: at("2026-03-03T11:00:01Z"),
          end: at("2026-03-03T12:00:00Z"),
          allDay: false,
        },
      ] as Array<CalendarEvent>);

      expect(
        shifts.map((s: OnCallShift) => {
          return [s.userId, s.start.toISOString(), s.end.toISOString()];
        }),
      ).toEqual([
        ["A", "2026-03-03T09:00:00.000Z", "2026-03-03T11:00:00.000Z"],
        ["B", "2026-03-03T11:00:00.000Z", "2026-03-03T12:00:00.000Z"],
      ]);
    });

    test("diffPolicyVariant keeps only intervals where a different person is on call", () => {
      const base: Array<OnCallShift> = [
        {
          userId: "A",
          start: at("2026-03-03T09:00:00Z"),
          end: at("2026-03-03T17:00:00Z"),
          coverageSeconds: 8 * 3600,
        },
      ];
      const variant: Array<OnCallShift> = [
        {
          userId: "A",
          start: at("2026-03-03T09:00:00Z"),
          end: at("2026-03-03T12:00:00Z"),
          coverageSeconds: 3 * 3600,
        },
        {
          userId: "B",
          start: at("2026-03-03T12:00:00Z"),
          end: at("2026-03-03T13:00:00Z"),
          coverageSeconds: 3600,
        },
        {
          userId: "A",
          start: at("2026-03-03T13:00:00Z"),
          end: at("2026-03-03T17:00:00Z"),
          coverageSeconds: 4 * 3600,
        },
        // No base coverage at all here: kept, attributed to the variant itself.
        {
          userId: "Z",
          start: at("2026-03-03T18:00:00Z"),
          end: at("2026-03-03T19:00:00Z"),
          coverageSeconds: 3600,
        },
      ];

      const diff: Array<{ shift: OnCallShift; globalUserId: string }> =
        OnCallShiftMaterializer.diffPolicyVariant(base, variant);

      expect(
        diff.map((d: { shift: OnCallShift; globalUserId: string }) => {
          return [d.shift.userId, d.globalUserId];
        }),
      ).toEqual([
        ["B", "A"],
        ["Z", "Z"],
      ]);
    });
  });

  describe("materializeForProject / materializeForUser scoping", () => {
    function twoScheduleDb(): FakeDb {
      const db: FakeDb = multiLayerDb();
      db.schedules.push(
        makeSchedule({
          id: SCHEDULE_2,
          projectId: PROJECT,
          name: "Checkout",
          timezone: UTC,
        }),
      );
      db.layers.push(
        makeLayer({
          id: "layer-s2",
          scheduleId: SCHEDULE_2,
          projectId: PROJECT,
          name: "Solo",
          startsAt: at("2026-01-01T00:00:00Z"),
          handOffTime: at("2026-01-01T00:00:00Z"),
          rotation: rotation(EventInterval.Day, 1),
        }),
      );
      db.layerUsers.push(
        makeLayerUser({
          id: "lu-f",
          scheduleId: SCHEDULE_2,
          layerId: "layer-s2",
          projectId: PROJECT,
          userId: "F",
        }),
      );
      return db;
    }

    test("materializeForProject covers every schedule in the project", async () => {
      installFakeDb(twoScheduleDb());

      const result: MaterializeResult =
        await OnCallShiftMaterializer.materializeForProject({
          projectId: oid(PROJECT),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          now: NOW,
        });

      expect(
        result.schedules
          .map((s: MaterializedScheduleInfo) => {
            return s.scheduleId;
          })
          .sort(),
      ).toEqual([SCHEDULE, SCHEDULE_2]);
      expect(
        result.shifts.some((s: MaterializedShift) => {
          return s.scheduleId === SCHEDULE;
        }),
      ).toBe(true);
      expect(
        result.shifts.some((s: MaterializedShift) => {
          return s.scheduleId === SCHEDULE_2 && s.userId === "F";
        }),
      ).toBe(true);

      // Sorted by start across schedules.
      for (let i: number = 1; i < result.shifts.length; i++) {
        expect(result.shifts[i]!.start.getTime()).toBeGreaterThanOrEqual(
          result.shifts[i - 1]!.start.getTime(),
        );
      }
    });

    test("materializeForUser: only the user's own shifts, from every schedule they are on", async () => {
      installFakeDb(twoScheduleDb());

      const result: MaterializeResult =
        await OnCallShiftMaterializer.materializeForUser({
          userId: oid("A"),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          now: NOW,
          includeCoveringShifts: true,
        });

      expect(result.shifts.length).toBeGreaterThan(0);
      expect(
        result.shifts.every((s: MaterializedShift) => {
          return s.userId === "A";
        }),
      ).toBe(true);
      expect(
        result.schedules.map((s: MaterializedScheduleInfo) => {
          return s.scheduleId;
        }),
      ).toEqual([SCHEDULE]);
    });

    test("materializeForUser honours the scheduleId filter", async () => {
      installFakeDb(twoScheduleDb());

      const other: MaterializeResult =
        await OnCallShiftMaterializer.materializeForUser({
          userId: oid("A"),
          scheduleId: oid(SCHEDULE_2),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          now: NOW,
          includeCoveringShifts: true,
        });
      expect(other.shifts).toEqual([]);

      const own: MaterializeResult =
        await OnCallShiftMaterializer.materializeForUser({
          userId: oid("A"),
          scheduleId: oid(SCHEDULE),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          now: NOW,
          includeCoveringShifts: true,
        });
      expect(own.shifts.length).toBeGreaterThan(0);
    });

    test("materializeForUser honours the projectIds filter", async () => {
      installFakeDb(twoScheduleDb());

      const result: MaterializeResult =
        await OnCallShiftMaterializer.materializeForUser({
          userId: oid("A"),
          projectIds: [oid("some-other-project")],
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          now: NOW,
          includeCoveringShifts: true,
        });

      expect(result.shifts).toEqual([]);
      expect(OnCallDutyPolicyUserOverrideService.findBy).toHaveBeenCalledTimes(
        1,
      );
    });

    test("getCandidateScheduleIdsForUser: own schedules plus covered schedules, deduped", async () => {
      const db: FakeDb = twoScheduleDb();
      db.overrides.push(
        makeOverride({
          id: "ov-cover",
          projectId: PROJECT,
          overrideUserId: "F",
          routeAlertsToUserId: "A",
          startsAt: at("2026-03-03T00:00:00Z"),
          endsAt: at("2026-03-04T00:00:00Z"),
        }),
        // Outside the window: must not pull in schedule 2 on its own.
        makeOverride({
          id: "ov-far",
          projectId: PROJECT,
          overrideUserId: "F",
          routeAlertsToUserId: "B",
          startsAt: at("2026-06-01T00:00:00Z"),
          endsAt: at("2026-06-02T00:00:00Z"),
        }),
      );
      installFakeDb(db);

      const forA: Array<ObjectID> =
        await OnCallShiftMaterializer.getCandidateScheduleIdsForUser({
          userId: oid("A"),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          includeCoveringShifts: true,
        });
      expect(ids(forA).sort()).toEqual([SCHEDULE, SCHEDULE_2]);

      const forB: Array<ObjectID> =
        await OnCallShiftMaterializer.getCandidateScheduleIdsForUser({
          userId: oid("B"),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          includeCoveringShifts: true,
        });
      expect(ids(forB)).toEqual([SCHEDULE]);

      const forAOwnOnly: Array<ObjectID> =
        await OnCallShiftMaterializer.getCandidateScheduleIdsForUser({
          userId: oid("A"),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          includeCoveringShifts: false,
        });
      expect(ids(forAOwnOnly)).toEqual([SCHEDULE]);
    });

    /*
     * The batched form the reminder sweep uses: the same answer for a whole
     * group of users in the same 2-3 queries it takes for one, which is what
     * keeps a five-minute tick from issuing 2-3 queries PER reminded user.
     */
    test("getCandidateScheduleIdsForUsers: one batched lookup answers every user, with coverage kept per user", async () => {
      const db: FakeDb = twoScheduleDb();
      db.overrides.push(
        makeOverride({
          id: "ov-cover",
          projectId: PROJECT,
          overrideUserId: "F",
          routeAlertsToUserId: "A",
          startsAt: at("2026-03-03T00:00:00Z"),
          endsAt: at("2026-03-04T00:00:00Z"),
        }),
      );
      installFakeDb(db);

      const byUser: Map<
        string,
        Array<ObjectID>
      > = await OnCallShiftMaterializer.getCandidateScheduleIdsForUsers({
        userIds: [oid("A"), oid("B"), oid("nobody")],
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeCoveringShifts: true,
      });

      // A is on schedule 1 and covers F, who is on schedule 2.
      expect(ids(byUser.get("A") || []).sort()).toEqual([SCHEDULE, SCHEDULE_2]);
      // B is on schedule 1 only: A's coverage never leaks into B's list.
      expect(ids(byUser.get("B") || [])).toEqual([SCHEDULE]);
      // Every requested user gets an entry, even with nothing to show.
      expect(byUser.has("nobody")).toBe(true);
      expect(byUser.get("nobody")).toEqual([]);

      // Two layer-user queries and ONE override query for all three users.
      expect(OnCallDutyPolicyUserOverrideService.findBy).toHaveBeenCalledTimes(
        1,
      );
      expect(
        OnCallDutyPolicyScheduleLayerUserService.findBy,
      ).toHaveBeenCalledTimes(2);
    });

    test("getCandidateScheduleIdsForUsers: no users means no queries at all", async () => {
      installFakeDb(twoScheduleDb());

      const byUser: Map<
        string,
        Array<ObjectID>
      > = await OnCallShiftMaterializer.getCandidateScheduleIdsForUsers({
        userIds: [],
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeCoveringShifts: true,
      });

      expect(byUser.size).toBe(0);
      expect(
        OnCallDutyPolicyScheduleLayerUserService.findBy,
      ).toHaveBeenCalledTimes(0);
      expect(OnCallDutyPolicyUserOverrideService.findBy).toHaveBeenCalledTimes(
        0,
      );
    });

    test("getCandidateScheduleIdsForUsers honours the scheduleId narrowing for every user", async () => {
      installFakeDb(twoScheduleDb());

      const byUser: Map<
        string,
        Array<ObjectID>
      > = await OnCallShiftMaterializer.getCandidateScheduleIdsForUsers({
        userIds: [oid("A"), oid("F")],
        scheduleId: oid(SCHEDULE_2),
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        includeCoveringShifts: false,
      });

      expect(ids(byUser.get("A") || [])).toEqual([]);
      expect(ids(byUser.get("F") || [])).toEqual([SCHEDULE_2]);
    });

    test("an empty project yields an empty result", async () => {
      installFakeDb(emptyDb());

      const result: MaterializeResult =
        await OnCallShiftMaterializer.materializeForProject({
          projectId: oid("empty-project"),
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          now: NOW,
        });

      expect(result).toEqual({
        shifts: [],
        truncated: false,
        schedules: [],
        users: [],
        generatedAt: NOW,
      });
    });
  });

  describe("truncation and validation", () => {
    test("propagates truncated from the resolver", async () => {
      const db: FakeDb = emptyDb();
      db.schedules.push(
        makeSchedule({ id: SCHEDULE, projectId: PROJECT, timezone: UTC }),
      );
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
          id: "lu-q",
          scheduleId: SCHEDULE,
          layerId: "layer-old",
          projectId: PROJECT,
          userId: "Q",
        }),
      );

      const result: MaterializeResult = await materializeSchedule(db, {
        maxSimulationIterations: 10,
      });

      expect(result.truncated).toBe(true);
      expect(result.schedules[0]!.truncated).toBe(true);
    });

    test("rejects an inverted or invalid window", async () => {
      installFakeDb(multiLayerDb());

      await expect(
        OnCallShiftMaterializer.materializeForSchedule({
          scheduleId: oid(SCHEDULE),
          windowStart: WINDOW_END,
          windowEnd: WINDOW_START,
        }),
      ).rejects.toBeInstanceOf(BadDataException);

      await expect(
        OnCallShiftMaterializer.materializeForUser({
          userId: oid("A"),
          windowStart: new Date("nonsense"),
          windowEnd: WINDOW_END,
          includeCoveringShifts: true,
        }),
      ).rejects.toBeInstanceOf(BadDataException);
    });

    test("unknown schedules materialize to an empty result", async () => {
      installFakeDb(multiLayerDb());

      const result: MaterializeResult =
        await OnCallShiftMaterializer.materializeForSchedules({
          scheduleIds: [oid("missing")],
          windowStart: WINDOW_START,
          windowEnd: WINDOW_END,
          now: NOW,
        });

      expect(result.shifts).toEqual([]);
      expect(result.schedules).toEqual([]);
    });
  });
});
