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
 * ONE RULE DECIDES WHETHER AN INCIDENT, AN ALERT OR AN EPISODE IS RESOLVED.
 *
 * A record is resolved when its state is at or below its project's resolved
 * state, or carries the resolved flag itself (Common/Utils/ResolvedState).
 * Reading the flag on its own is what made a state placed after Resolved
 * ("Closed") half-resolved: resolved for reminders and status pages, open for
 * the Active badges and an episode's resolvedAt, and never a resolve at all
 * for an incident's monitors.
 *
 * So nothing outside the helpers reads the flag to decide that:
 *
 *   - no `x.isResolvedState` (or `x["isResolvedState"]`, or a destructured
 *     `{ isResolvedState }`) is read, except to hand a state's flags on as
 *     they are (`isResolvedState: state.isResolvedState`) - into the helper's
 *     input, say;
 *   - no query asks for records by it (`query`, `countQuery`, a `Query<...>`
 *     or a `where`: `currentIncidentState: { isResolvedState: false }`). The
 *     state services' getUnresolvedIncidentStateIds and the alert twins name
 *     the states to ask for. Selecting the flag, to hand it to the helper, is
 *     fine.
 *
 * What is left reads the flag on purpose and is listed below, shrink-only: a
 * file that no longer needs its entry fails here until the entry goes.
 * Scheduled maintenance has a path of its own (scheduled, ongoing, ended,
 * completed), where "ended or completed" is read off its states' flags.
 *
 * Only real syntax is read, through the TypeScript AST.
 */

/*
 * The detector and the directories it reads are shared with the
 * acknowledged rule's guard (Tests/StateFlagReads, OneAcknowledgedRuleGuard).
 */
const FLAG: string = "isResolvedState";

/*
 * Files that read the flag on purpose, by path from the repository root, and
 * why. Shrink-only.
 */
const ALLOWED: Record<string, string> = {
  // The app's own copy of the rule: it is built without Common's runtime code.
  "packages/MobileApp/src/utils/resolvedState.ts":
    "the mobile app's copy of Common/Utils/ResolvedState",

  // Scheduled maintenance: its own path, "ended or completed" by its flags.
  "packages/Common/Server/Services/ScheduledMaintenanceStateTimelineService.ts":
    "scheduled maintenance states",
  "packages/Common/Server/Services/ScheduledMaintenanceStateService.ts":
    "scheduled maintenance states",
  "packages/Common/Server/Services/ScheduledMaintenanceMeasurementValueService.ts":
    "scheduled maintenance states",
  "packages/Common/Server/Services/ScheduledMaintenanceReminderRuleService.ts":
    "scheduled maintenance events not yet completed",
  "packages/Common/Server/Services/ScheduledMaintenanceService.ts":
    "scheduled maintenance states",
  "packages/Common/Server/Utils/TeamMember/ProjectLeaveResourceCleanup.ts":
    "the open scheduled maintenance states (incidents and alerts ask the state services)",
  "packages/Common/Server/Utils/Workspace/MicrosoftTeams/ReactionNoteSync.ts":
    "the open scheduled maintenance events (incidents and alerts ask the state services)",
  "packages/App/FeatureSet/StatusPage/src/Pages/ScheduledEvent/Detail.tsx":
    "scheduled maintenance timeline icons",
  "packages/App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/Index.tsx":
    "scheduled maintenance states",
  "packages/App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ChangeState.tsx":
    "scheduled maintenance states",
  "packages/App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceTiming.ts":
    "scheduled maintenance states",
  "packages/App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState.ts":
    "scheduled maintenance states",
};

// Every read of the resolved flag, and every query on it, in one file's text.
function findFlagReads(file: string, text: string): Array<FlagRead> {
  return findStateFlagReads(FLAG, file, text);
}

function scanRepository(): Array<FlagRead> {
  return scanStateFlagReads(FLAG);
}

describe("one rule decides whether an incident, alert or episode is resolved", () => {
  const reads: Array<FlagRead> = scanRepository();

  test("nothing outside the helpers reads the resolved flag or queries by it", () => {
    const unexpected: Array<string> = reads
      .filter((read: FlagRead): boolean => {
        return !Object.prototype.hasOwnProperty.call(ALLOWED, read.file);
      })
      .map((read: FlagRead): string => {
        return `${read.file}:${read.line}: ${read.text}`;
      });

    /*
     * Ask Common/Utils/ResolvedState (in the dashboard and on status pages),
     * the state services (isResolvedIncidentState, getUnresolvedIncidentStateIds
     * and the alert twins) or the record services (isIncidentResolved,
     * isAlertResolved, isEpisodeResolved) instead.
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

  test("the helpers themselves are where the rule is read", () => {
    for (const file of [
      "packages/Common/Utils/ResolvedState.ts",
      "packages/Common/Utils/StartingStage.ts",
    ]) {
      expect(fs.existsSync(path.join(REPOSITORY_ROOT, file))).toBe(true);
    }
  });
});

describe("the guard's own detector", () => {
  function linesOf(text: string, file: string = "sample.ts"): Array<string> {
    return findFlagReads(file, text).map((read: FlagRead): string => {
      return read.text;
    });
  }

  test.each([
    ["a read of the flag", "if (state.isResolvedState) { go(); }"],
    [
      "an optional read",
      "const x = incident.currentIncidentState?.isResolvedState;",
    ],
    ["a string-keyed read", 'const x = state["isResolvedState"];'],
    ["a destructured read", "const { isResolvedState } = state;"],
    [
      "a renamed destructured read",
      "const { isResolvedState: resolved } = state;",
    ],
    [
      "a query by the flag",
      "await IncidentService.findBy({ query: { currentIncidentState: { isResolvedState: false } } });",
    ],
    [
      "a query for the flagged state",
      "await IncidentStateService.findOneBy({ query: { isResolvedState: true, projectId } });",
    ],
    [
      "a count query",
      "const item = { countQuery: { currentAlertState: { isResolvedState: false } } };",
    ],
    [
      "a typed query",
      "const query: Query<Incident> = { currentIncidentState: { isResolvedState: false } as any };",
    ],
    [
      "a query assigned to",
      "query.currentIncidentState = { isResolvedState: false };",
    ],
    [
      "a query built in a helper and returned",
      "function open() { return { currentIncidentState: { isResolvedState: false } }; }",
    ],
  ] as Array<[string, string]>)("flags %s", (_name: string, text: string) => {
    expect(linesOf(text)).toHaveLength(1);
  });

  test("flags a query in a JSX attribute", () => {
    expect(
      linesOf(
        "const page = <Table query={{ currentIncidentState: { isResolvedState: false } }} />;",
        "sample.tsx",
      ),
    ).toHaveLength(1);
  });

  test.each([
    [
      "a select",
      "await IncidentStateService.findBy({ query: { projectId }, select: { _id: true, isResolvedState: true } });",
    ],
    [
      "a nested select",
      "await IncidentService.findBy({ query: {}, select: { currentIncidentState: { isResolvedState: true } } });",
    ],
    [
      "a typed select",
      "const select: Select<Incident> = { currentIncidentState: { isResolvedState: true } };",
    ],
    [
      "the flags handed on",
      "const row = { id: state.id, isResolvedState: state.isResolvedState };",
    ],
    ["a write of the flag", "resolvedState.isResolvedState = true;"],
    ["a label map", 'const labels = { isResolvedState: "Resolved" };'],
    ["a string naming the flag", 'const flag = "isResolvedState";'],
    ["a type member", "interface S { isResolvedState?: boolean }"],
  ] as Array<[string, string]>)(
    "leaves %s alone",
    (_name: string, text: string) => {
      expect(linesOf(text)).toEqual([]);
    },
  );
});
