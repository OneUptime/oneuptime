import fs from "fs";
import path from "path";
import {
  FlagRead,
  REPOSITORY_ROOT,
  findStateFlagReads,
  scanStateFlagReads,
} from "../StateFlagReads";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE RULE DECIDES WHETHER A SCHEDULED MAINTENANCE EVENT IS IN PROGRESS
 * (Common/Utils/ScheduledMaintenanceStart): its state is the project's
 * ongoing state, or a state of the project's own placed between Ongoing and
 * Ended - "Verifying", say. A state placed before Ongoing has not started; a
 * state placed after Ended is over.
 *
 * Reading the ongoing flag on its own is what left such an event half in
 * progress: still holding its monitors, but off the status page's ongoing
 * list, out of the RSS feed, no longer silencing its network sites or its
 * telemetry series, never ended at its end time, and missing from the
 * Dashboard's Ongoing list and counts.
 *
 * So nothing outside the helper reads the flag to decide that: no
 * `x.isOngoingState` read (handing a state's flags on as they are is fine),
 * and no query by it - ScheduledMaintenanceStateService's
 * getInProgressScheduledMaintenanceStateIds (one project) and
 * getInProgressEventQueriesOfEveryProject (every project) name the states to
 * ask for. What is left reads it on purpose and is listed below,
 * shrink-only.
 */

const FLAG: string = "isOngoingState";

/*
 * Files that read the flag on purpose, by path from the repository root, and
 * why. Shrink-only.
 */
const ALLOWED: Record<string, string> = {
  /*
   * The rule's own query for every project at once
   * (getInProgressEventQueriesOfEveryProject): each project's ongoing state
   * by its flag - naming them would read every project's states on every
   * run - and the states that are none of the four kinds, to place them.
   */
  "packages/Common/Server/Services/ScheduledMaintenanceStateService.ts":
    "the in-progress queries of every project, built from the rule",
};

describe("one rule decides whether a scheduled maintenance event is in progress", () => {
  const reads: Array<FlagRead> = scanStateFlagReads(FLAG);

  test("nothing outside the helper reads the ongoing flag or queries by it", () => {
    const unexpected: Array<string> = reads
      .filter((read: FlagRead): boolean => {
        return !Object.prototype.hasOwnProperty.call(ALLOWED, read.file);
      })
      .map((read: FlagRead): string => {
        return `${read.file}:${read.line}: ${read.text}`;
      });

    /*
     * Ask Common/Utils/ScheduledMaintenanceStart (isInProgress, hasStarted,
     * hasEnded, getInProgressStateIds, getOngoingState, getStartRows and
     * getEndRows) or ScheduledMaintenanceStateService
     * (getInProgressScheduledMaintenanceStateIds,
     * getInProgressEventQueriesOfEveryProject) instead.
     */
    expect(unexpected).toEqual([]);
  });

  test("every allowed file still reads the flag, so the list only shrinks", () => {
    const filesWithReads: Set<string> = new Set<string>(
      reads.map((read: FlagRead): string => {
        return read.file;
      }),
    );

    const stale: Array<string> = Object.keys(ALLOWED).filter(
      (file: string): boolean => {
        return (
          fs.existsSync(path.join(REPOSITORY_ROOT, file)) &&
          !filesWithReads.has(file)
        );
      },
    );

    expect(stale).toEqual([]);
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
});

describe("the in-progress guard's own detector", () => {
  function linesOf(text: string, file: string = "sample.ts"): Array<string> {
    return findStateFlagReads(FLAG, file, text).map(
      (read: FlagRead): string => {
        return read.text;
      },
    );
  }

  test.each([
    ["a read of the flag", "if (state.isOngoingState) { go(); }"],
    [
      "an optional read",
      "const x = event.currentScheduledMaintenanceState?.isOngoingState;",
    ],
    ["a string-keyed read", 'const x = state["isOngoingState"];'],
    ["a destructured read", "const { isOngoingState } = state;"],
    [
      "a query by the flag",
      "await ScheduledMaintenanceService.findBy({ query: { currentScheduledMaintenanceState: { isOngoingState: true } } });",
    ],
    [
      "a query for the flagged state",
      "await ScheduledMaintenanceStateService.findOneBy({ query: { isOngoingState: true, projectId } });",
    ],
    [
      "a query assigned to",
      'query["currentScheduledMaintenanceState"] = { isOngoingState: true };',
    ],
    [
      "a list search by the flag",
      "const ongoing = states.find((s) => { return s.isOngoingState; });",
    ],
  ] as Array<[string, string]>)("flags %s", (_name: string, text: string) => {
    expect(linesOf(text)).toHaveLength(1);
  });

  test.each([
    [
      "a select",
      "await ScheduledMaintenanceStateService.findBy({ query: { projectId }, select: { _id: true, isOngoingState: true } });",
    ],
    [
      "the flags handed on",
      "const row = { id: state.id, isOngoingState: state.isOngoingState };",
    ],
    ["a write of the flag", "ongoingState.isOngoingState = true;"],
    ["a label map", 'const labels = { isOngoingState: "Ongoing" };'],
    ["a string naming the flag", 'const flag = "isOngoingState";'],
    ["a type member", "interface S { isOngoingState?: boolean }"],
  ] as Array<[string, string]>)(
    "leaves %s alone",
    (_name: string, text: string) => {
      expect(linesOf(text)).toEqual([]);
    },
  );
});
