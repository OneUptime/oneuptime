import fs from "fs";
import path from "path";
import {
  FlagRead,
  REPOSITORY_ROOT,
  findStateFlagReads,
  findStateOrderComparisons,
  scanStateFlagReads,
  scanStateOrderComparisons,
} from "../StateFlagReads";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE RULE DECIDES WHERE A SCHEDULED MAINTENANCE EVENT IS IN ITS LIFE
 * (Common/Utils/ScheduledMaintenanceStart): by its state's place in the
 * project's list.
 *
 *   - waiting for its Starts At (isWaitingToStart): Scheduled, or a state
 *     of the project's own after it and before Ongoing ("Confirmed");
 *   - in progress (isInProgress): Ongoing, or a state of the project's own
 *     between Ongoing and Ended ("Verifying") - OneInProgressRuleGuard;
 *   - over (hasEnded, getPhase): Ended, Completed, or a state of the
 *     project's own after Ended ("Reviewing");
 *   - complete (isComplete): Completed, or a state of the project's own
 *     after it ("Archived") - the completed flag is OneResolvedRuleGuard's.
 *
 * Reading the scheduled or the ended flag on its own is what left an event
 * moved on to "Confirmed" never started at its time and off every upcoming
 * list, and what had the Dashboard count an event in "Reviewing" as still
 * running. Comparing two states' places outside the helper is the same
 * rule written again, and drifts the same way.
 *
 * So nothing outside the helper decides it:
 *
 *   - no `x.isScheduledState` or `x.isEndedState` is read, and no query asks
 *     for records by them - ScheduledMaintenanceStateService names the
 *     states to ask for (getWaitingToStartScheduledMaintenanceStateIds, the
 *     every-project queries). The flags still mark THE scheduled and THE
 *     ended state - the one an event is created in, the one the end at its
 *     time moves it into (ScheduledMaintenanceStartUtil.getEndedState);
 *   - no state's place is compared (`a.order < b.order`) where scheduled
 *     maintenance states are read.
 *
 * What is left does so on purpose and is listed below, shrink-only: a file
 * that no longer needs its entry fails here until the entry goes.
 */

const FLAGS: Array<string> = ["isScheduledState", "isEndedState"];

/*
 * Files that read the scheduled or ended flag on purpose, by path from the
 * repository root, and why. Shrink-only.
 */
const ALLOWED_FLAG_READS: Record<string, string> = {
  /*
   * The rule's own queries for every project at once (the start and the
   * end at an event's time): each project's scheduled state by its flag,
   * and the states that are none of the four kinds, to place them.
   */
  "packages/Common/Server/Services/ScheduledMaintenanceStateService.ts":
    "the phase queries of every project, built from the rule",

  // THE scheduled state: the one a new event is created in.
  "packages/Common/Server/Services/ScheduledMaintenanceService.ts":
    "the state a new event is created in",

  /*
   * THE scheduled state again: the timeline row an event is created with,
   * whose subscribers were told at creation - not a move into a state.
   */
  "packages/App/FeatureSet/Workers/Jobs/ScheduledMaintenanceStateTimeline/SendNotificationToSubscribers.ts":
    "the creation row's subscribers were told already",
};

// Where scheduled maintenance states are read.
const MAINTENANCE_STATES: RegExp =
  /ScheduledMaintenanceState\b|scheduledMaintenanceState\b|ScheduledMaintenanceStart\b/;

/*
 * Files that compare two states' places on purpose, by path from the
 * repository root, and why. Shrink-only.
 */
const ALLOWED_ORDER_COMPARISONS: Record<string, string> = {
  // The state lists' own rule, shared by every kind - what the helper reads.
  "packages/Common/Utils/StateOrder.ts": "the state lists' own rule",

  /*
   * A new entry of an event's timeline only moves it forward
   * (onBeforeCreate): no phase is decided there.
   */
  "packages/Common/Server/Services/ScheduledMaintenanceStateTimelineService.ts":
    "a new timeline entry only moves the event forward",
};

function unexpectedIn(
  found: Array<FlagRead>,
  allowed: Record<string, string>,
): Array<string> {
  return found
    .filter((read: FlagRead): boolean => {
      return !Object.prototype.hasOwnProperty.call(allowed, read.file);
    })
    .map((read: FlagRead): string => {
      return `${read.file}:${read.line}: ${read.text}`;
    });
}

function staleIn(
  found: Array<FlagRead>,
  allowed: Record<string, string>,
): Array<string> {
  const filesWithFindings: Set<string> = new Set<string>(
    found.map((read: FlagRead): string => {
      return read.file;
    }),
  );

  return Object.keys(allowed).filter((file: string): boolean => {
    return (
      fs.existsSync(path.join(REPOSITORY_ROOT, file)) &&
      !filesWithFindings.has(file)
    );
  });
}

describe("one rule decides where a scheduled maintenance event is in its life", () => {
  const flagReads: Array<FlagRead> = FLAGS.flatMap(
    (flag: string): Array<FlagRead> => {
      return scanStateFlagReads(flag);
    },
  );

  const orderComparisons: Array<FlagRead> =
    scanStateOrderComparisons(MAINTENANCE_STATES);

  test("nothing outside the helper reads the scheduled or the ended flag, or queries by them", () => {
    /*
     * Ask Common/Utils/ScheduledMaintenanceStart (isWaitingToStart,
     * hasStarted, isInProgress, hasEnded, isComplete, getPhase,
     * getEndedState) or ScheduledMaintenanceStateService
     * (getWaitingToStartScheduledMaintenanceStateIds,
     * getWaitingToStartEventQueriesOfEveryProject,
     * getIncompleteScheduledMaintenanceStateIds) instead.
     */
    expect(unexpectedIn(flagReads, ALLOWED_FLAG_READS)).toEqual([]);
  });

  test("nothing outside the helper compares two scheduled maintenance states' places", () => {
    // Ask Common/Utils/ScheduledMaintenanceStart instead.
    expect(unexpectedIn(orderComparisons, ALLOWED_ORDER_COMPARISONS)).toEqual(
      [],
    );
  });

  test("every allowed file still reads a flag, so the list only shrinks", () => {
    expect(staleIn(flagReads, ALLOWED_FLAG_READS)).toEqual([]);
  });

  test("every allowed file still compares places, so the list only shrinks", () => {
    expect(staleIn(orderComparisons, ALLOWED_ORDER_COMPARISONS)).toEqual([]);
  });

  test("the helper itself is where the rule is read", () => {
    expect(
      fs.existsSync(
        path.join(
          REPOSITORY_ROOT,
          "packages/Common/Utils/ScheduledMaintenanceStart.ts",
        ),
      ),
    ).toBe(true);
  });

  /*
   * The readers this rule moved onto the helper stay there: the Dashboard's
   * "is the event over" (the Measurements card, the active states of a
   * resource's badges, the header's kind), the status page's timeline icons,
   * the start at an event's time, the measurements' end and completion.
   */
  test.each([
    "packages/App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Index.tsx",
    "packages/App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState.ts",
    "packages/App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceTiming.ts",
    "packages/App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ChangeState.tsx",
    "packages/App/FeatureSet/StatusPage/src/Pages/ScheduledEvent/Detail.tsx",
    "packages/App/FeatureSet/Workers/Jobs/ScheduledMaintenance/ChangeStateToOngoing.ts",
    "packages/App/FeatureSet/Workers/Jobs/ScheduledMaintenance/ChangeStateToEnded.ts",
    "packages/Common/Server/Services/ScheduledMaintenanceMeasurementValueService.ts",
  ])("%s decides no phase by a flag of its own", (file: string) => {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, file),
      "utf8",
    );

    for (const flag of [...FLAGS, "isOngoingState", "isResolvedState"]) {
      expect(findStateFlagReads(flag, file, text)).toEqual([]);
    }

    expect(findStateOrderComparisons(file, text)).toEqual([]);
  });
});

describe("the phase guard's own place detector", () => {
  function linesOf(text: string): Array<string> {
    return findStateOrderComparisons("sample.ts", text).map(
      (read: FlagRead): string => {
        return read.text;
      },
    );
  }

  test.each([
    ["a place compared", "if (state.order > ended.order) { over(); }"],
    ["an optional read", "const x = a?.order <= b?.order;"],
    ["a non-null read", "const x = a!.order < b!.order;"],
    ["a string-keyed read", 'const x = a["order"] >= 4;'],
    ["one side alone", "const late = 3 < row.order;"],
  ] as Array<[string, string]>)("flags %s", (_name: string, text: string) => {
    expect(linesOf(text)).toHaveLength(1);
  });

  test.each([
    [
      "a sort by place",
      "states.sort((a, b) => { return a.order - b.order; });",
    ],
    ["a place written", "state.order = 3;"],
    ["a place handed on", "const row = { order: state.order };"],
    ["a place checked for", "if (state.order === undefined) { place(); }"],
    ["another order compared", "if (newPlanOrder > oldPlanOrder) { up(); }"],
  ] as Array<[string, string]>)(
    "leaves %s alone",
    (_name: string, text: string) => {
      expect(linesOf(text)).toEqual([]);
    },
  );
});
