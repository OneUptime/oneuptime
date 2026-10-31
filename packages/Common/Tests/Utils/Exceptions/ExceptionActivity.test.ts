import { describe, expect, test } from "@jest/globals";
import { TelemetryExceptionActivityType } from "../../../Models/DatabaseModels/TelemetryExceptionActivity";
import ObjectID from "../../../Types/ObjectID";
import {
  EXCEPTION_ACTIVITY_COLUMNS,
  ExceptionActivityChange,
  ExceptionActivityState,
  getExceptionActivityChanges,
  isExceptionActivityWrite,
  readId,
  readSwitch,
} from "../../../Utils/Exceptions/ExceptionActivity";
import {
  applyAssignmentChange,
  applyManualResolutionChange,
} from "../../../Utils/Exceptions/ExceptionIssueState";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * What an update of an exception changed, as activity entries: the rule
 * TelemetryExceptionService.onUpdateSuccess records every triage and
 * assignment by - from the exception's page, a row's menu, Bulk Actions and
 * the API alike. Writes are run through the service's own rules first
 * (applyManualResolutionChange, applyAssignmentChange), exactly as the
 * update hook hands them over.
 */

const PRIYA: string = "90000000-0000-4000-8000-000000000001";
const ALEX: string = "90000000-0000-4000-8000-000000000002";
const PLATFORM: string = "a0000000-0000-4000-8000-000000000001";
const MOBILE: string = "a0000000-0000-4000-8000-000000000002";

function state(
  overrides: Partial<ExceptionActivityState> = {},
): ExceptionActivityState {
  return {
    isResolved: false,
    isArchived: false,
    resolvedInReleaseAfter: null,
    assignToUserId: null,
    assignToTeamId: null,
    ...overrides,
  };
}

// A write as the update hook hands it on: after the service's own rules.
function hooked(write: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = { ...write };
  applyManualResolutionChange(data);
  applyAssignmentChange(data);
  return data;
}

function changes(
  before: ExceptionActivityState,
  write: Record<string, unknown>,
): Array<ExceptionActivityChange> {
  return getExceptionActivityChanges({ before, write: hooked(write) });
}

function types(
  before: ExceptionActivityState,
  write: Record<string, unknown>,
): Array<TelemetryExceptionActivityType> {
  return changes(before, write).map(
    (change: ExceptionActivityChange): TelemetryExceptionActivityType => {
      return change.activityType;
    },
  );
}

describe("resolving and reopening", () => {
  test("Resolve on an open exception is Resolved", () => {
    expect(changes(state(), { isResolved: true })).toEqual([
      { activityType: TelemetryExceptionActivityType.Resolved },
    ]);
  });

  test("Resolve in next release names the release it waits out", () => {
    expect(
      changes(state(), { isResolved: true, resolvedInReleaseAfter: " 1.4.0 " }),
    ).toEqual([
      {
        activityType: TelemetryExceptionActivityType.ResolvedInNextRelease,
        release: "1.4.0",
      },
    ]);
  });

  test("Resolve on a resolved exception changes nothing", () => {
    expect(types(state({ isResolved: true }), { isResolved: true })).toEqual(
      [],
    );
  });

  test("Resolve in next release again, with the same release, changes nothing", () => {
    expect(
      types(state({ isResolved: true, resolvedInReleaseAfter: "1.4.0" }), {
        isResolved: true,
        resolvedInReleaseAfter: "1.4.0",
      }),
    ).toEqual([]);
  });

  test("a resolved exception resolved in the next release instead, or for good, is recorded: what it waits for changed", () => {
    expect(
      changes(state({ isResolved: true }), {
        isResolved: true,
        resolvedInReleaseAfter: "2.0.0",
      }),
    ).toEqual([
      {
        activityType: TelemetryExceptionActivityType.ResolvedInNextRelease,
        release: "2.0.0",
      },
    ]);

    expect(
      types(state({ isResolved: true, resolvedInReleaseAfter: "1.4.0" }), {
        isResolved: true,
      }),
    ).toEqual([TelemetryExceptionActivityType.Resolved]);
  });

  test("Reopen on a resolved exception is Reopened", () => {
    expect(types(state({ isResolved: true }), { isResolved: false })).toEqual([
      TelemetryExceptionActivityType.Reopened,
    ]);
  });

  test("Reopen on an open exception changes nothing", () => {
    expect(types(state(), { isResolved: false })).toEqual([]);
  });

  test("OneUptime's check that a fix did not hold reopens with a regression time: Regressed", () => {
    expect(
      types(state({ isResolved: true }), {
        isResolved: false,
        regressedAt: new Date("2026-10-30T10:00:00.000Z"),
      }),
    ).toEqual([TelemetryExceptionActivityType.Regressed]);
  });

  test("an AI fix merged resolves it as OneUptime: Resolved", () => {
    expect(
      types(state(), { isResolved: true, markedAsResolvedAt: new Date() }),
    ).toEqual([TelemetryExceptionActivityType.Resolved]);
  });

  test("a switch sent as a string, as a form sends it, counts", () => {
    expect(types(state(), { isResolved: "true" })).toEqual([
      TelemetryExceptionActivityType.Resolved,
    ]);
    expect(types(state({ isResolved: true }), { isResolved: "false" })).toEqual(
      [TelemetryExceptionActivityType.Reopened],
    );
  });
});

describe("archiving", () => {
  test("Archive and Unarchive, each only when it changes the switch", () => {
    expect(types(state(), { isArchived: true })).toEqual([
      TelemetryExceptionActivityType.Archived,
    ]);
    expect(types(state({ isArchived: true }), { isArchived: false })).toEqual([
      TelemetryExceptionActivityType.Unarchived,
    ]);
    expect(types(state({ isArchived: true }), { isArchived: true })).toEqual(
      [],
    );
    expect(types(state(), { isArchived: false })).toEqual([]);
  });

  test("an archive leaves resolution alone, and the other way round", () => {
    expect(types(state({ isResolved: true }), { isArchived: true })).toEqual([
      TelemetryExceptionActivityType.Archived,
    ]);
    expect(types(state({ isArchived: true }), { isResolved: true })).toEqual([
      TelemetryExceptionActivityType.Resolved,
    ]);
  });
});

describe("assigning", () => {
  test("assigning a person names them", () => {
    expect(changes(state(), { assignToUserId: new ObjectID(PRIYA) })).toEqual([
      {
        activityType: TelemetryExceptionActivityType.Assigned,
        assigneeUserId: PRIYA,
        assigneeTeamId: null,
      },
    ]);
  });

  test("assigning a team names it, and the person it was taken from is no longer on it", () => {
    expect(
      changes(state({ assignToUserId: PRIYA }), { assignToTeamId: PLATFORM }),
    ).toEqual([
      {
        activityType: TelemetryExceptionActivityType.Assigned,
        assigneeUserId: null,
        assigneeTeamId: PLATFORM,
      },
    ]);
  });

  test("handing it from one person to another is one Assigned", () => {
    expect(
      types(state({ assignToUserId: PRIYA }), { assignToUserId: ALEX }),
    ).toEqual([TelemetryExceptionActivityType.Assigned]);
    expect(
      types(state({ assignToTeamId: PLATFORM }), { assignToTeamId: MOBILE }),
    ).toEqual([TelemetryExceptionActivityType.Assigned]);
  });

  test("assigning the one it is assigned to changes nothing, whatever case the id is in", () => {
    expect(
      types(state({ assignToUserId: PRIYA }), {
        assignToUserId: PRIYA.toUpperCase(),
      }),
    ).toEqual([]);
    expect(
      types(state({ assignToTeamId: PLATFORM }), {
        assignToTeamId: new ObjectID(PLATFORM),
      }),
    ).toEqual([]);
  });

  test("unassigning names who it was taken from", () => {
    expect(
      changes(state({ assignToUserId: PRIYA }), {
        assignToUserId: null,
        assignToTeamId: null,
      }),
    ).toEqual([
      {
        activityType: TelemetryExceptionActivityType.Unassigned,
        assigneeUserId: PRIYA,
        assigneeTeamId: null,
      },
    ]);

    expect(
      changes(state({ assignToTeamId: MOBILE }), { assignToTeamId: "" }),
    ).toEqual([
      {
        activityType: TelemetryExceptionActivityType.Unassigned,
        assigneeUserId: null,
        assigneeTeamId: MOBILE,
      },
    ]);
  });

  test("unassigning what nobody owns changes nothing", () => {
    expect(
      types(state(), { assignToUserId: null, assignToTeamId: null }),
    ).toEqual([]);
  });

  test("a relation object instead of the id column counts the same", () => {
    expect(
      changes(state(), { assignToUser: { _id: PRIYA } }).map(
        (change: ExceptionActivityChange) => {
          return change.assigneeUserId;
        },
      ),
    ).toEqual([PRIYA]);
  });

  test("one write can resolve, archive and assign: three entries, resolution first", () => {
    expect(
      types(state(), {
        isResolved: true,
        isArchived: true,
        assignToUserId: PRIYA,
      }),
    ).toEqual([
      TelemetryExceptionActivityType.Resolved,
      TelemetryExceptionActivityType.Archived,
      TelemetryExceptionActivityType.Assigned,
    ]);
  });
});

describe("which writes are activity", () => {
  test("only writes that touch a triage switch or the assignee", () => {
    for (const column of EXCEPTION_ACTIVITY_COLUMNS) {
      expect(isExceptionActivityWrite({ [column]: null })).toBe(true);
    }

    expect(isExceptionActivityWrite({ aiClassification: "CodeFault" })).toBe(
      false,
    );
    expect(isExceptionActivityWrite({ aiFixDeclinedAt: new Date() })).toBe(
      false,
    );
    expect(isExceptionActivityWrite({})).toBe(false);
    expect(isExceptionActivityWrite(null)).toBe(false);
  });

  test("ids and switches as writes carry them", () => {
    expect(readId(undefined)).toBeUndefined();
    expect(readId(null)).toBeNull();
    expect(readId("")).toBeNull();
    expect(readId(new ObjectID(PRIYA))).toBe(PRIYA);
    expect(readId(PRIYA.toUpperCase())).toBe(PRIYA);
    expect(readId({ id: PRIYA })).toBe(PRIYA);
    expect(readSwitch(undefined)).toBeUndefined();
    expect(readSwitch("true")).toBe(true);
    expect(readSwitch(false)).toBe(false);
  });
});

/*
 * A seeded sweep: random states and random writes. An entry is recorded for
 * a part exactly when the write changes it, and never twice for one part.
 */
describe("a seeded sweep of states and writes", () => {
  const random: SeededRandom = seededRandom(20261031);
  const users: Array<string | null> = [null, PRIYA, ALEX];
  const teams: Array<string | null> = [null, PLATFORM, MOBILE];
  const releases: Array<string | null> = [null, "1.4.0", "2.0.0"];

  function pick<T>(values: Array<T>): T {
    return values[random(values.length)] as T;
  }

  test("each part is recorded exactly when it changes", () => {
    for (let run: number = 0; run < 2000; run++) {
      const before: ExceptionActivityState = state({
        isResolved: random() < 0.5,
        isArchived: random() < 0.5,
        resolvedInReleaseAfter: pick(releases),
        assignToUserId: pick(users),
        assignToTeamId: null,
      });

      if (before.assignToUserId === null && random() < 0.5) {
        before.assignToTeamId = pick(teams);
      }

      if (!before.isResolved) {
        before.resolvedInReleaseAfter = null;
      }

      const write: Record<string, unknown> = {};

      if (random() < 0.5) {
        write["isResolved"] = random() < 0.5;

        if (write["isResolved"] === true && random() < 0.5) {
          write["resolvedInReleaseAfter"] = pick(releases);
        }
      }

      if (random() < 0.5) {
        write["isArchived"] = random() < 0.5;
      }

      if (random() < 0.5) {
        if (random() < 0.5) {
          write["assignToUserId"] = pick(users);
        } else {
          write["assignToTeamId"] = pick(teams);
        }
      }

      const after: Record<string, unknown> = hooked(write);
      const recorded: Array<TelemetryExceptionActivityType> = types(
        before,
        write,
      );

      const resolvedAfter: boolean =
        after["isResolved"] === undefined
          ? before.isResolved
          : after["isResolved"] === true;
      const releaseAfter: string | null =
        after["isResolved"] === undefined
          ? before.resolvedInReleaseAfter
          : ((after["resolvedInReleaseAfter"] as string | null) ?? null);
      const resolutionChanged: boolean =
        resolvedAfter !== before.isResolved ||
        (resolvedAfter && releaseAfter !== before.resolvedInReleaseAfter);

      const archivedAfter: boolean =
        after["isArchived"] === undefined
          ? before.isArchived
          : after["isArchived"] === true;

      const userAfter: string | null =
        after["assignToUserId"] === undefined
          ? before.assignToUserId
          : ((after["assignToUserId"] as string | null) ?? null);
      const teamAfter: string | null =
        after["assignToTeamId"] === undefined
          ? before.assignToTeamId
          : ((after["assignToTeamId"] as string | null) ?? null);
      const assigneeChanged: boolean =
        userAfter !== before.assignToUserId ||
        teamAfter !== before.assignToTeamId;

      const resolutionEntries: number = recorded.filter(
        (type: TelemetryExceptionActivityType): boolean => {
          return [
            TelemetryExceptionActivityType.Resolved,
            TelemetryExceptionActivityType.ResolvedInNextRelease,
            TelemetryExceptionActivityType.Reopened,
            TelemetryExceptionActivityType.Regressed,
          ].includes(type);
        },
      ).length;
      const archiveEntries: number = recorded.filter(
        (type: TelemetryExceptionActivityType): boolean => {
          return [
            TelemetryExceptionActivityType.Archived,
            TelemetryExceptionActivityType.Unarchived,
          ].includes(type);
        },
      ).length;
      const assigneeEntries: number = recorded.filter(
        (type: TelemetryExceptionActivityType): boolean => {
          return [
            TelemetryExceptionActivityType.Assigned,
            TelemetryExceptionActivityType.Unassigned,
          ].includes(type);
        },
      ).length;

      expect({ run, entries: resolutionEntries }).toEqual({
        run,
        entries: resolutionChanged ? 1 : 0,
      });
      expect({ run, entries: archiveEntries }).toEqual({
        run,
        entries: archivedAfter !== before.isArchived ? 1 : 0,
      });
      expect({ run, entries: assigneeEntries }).toEqual({
        run,
        entries: assigneeChanged ? 1 : 0,
      });
    }
  });
});
