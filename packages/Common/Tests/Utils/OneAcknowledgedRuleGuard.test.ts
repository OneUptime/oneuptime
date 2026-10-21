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
 * ONE RULE DECIDES WHETHER AN INCIDENT, AN ALERT OR AN EPISODE IS
 * ACKNOWLEDGED (Common/Utils/AcknowledgedState): its state is at or below its
 * project's acknowledged state - the first from the top flagged acknowledged
 * - or carries the acknowledged flag itself, or it is resolved.
 *
 * Reading the flag on its own is what made a state placed after Acknowledged
 * ("Investigating") half-acknowledged (#4453): the mobile app and Microsoft
 * Teams offered Acknowledge again - a move back up the list - acknowledging
 * an alert or an episode moved it back, and the SLA, the metrics, the
 * measurements and the summaries never counted the move as a response.
 *
 * So nothing outside the helpers reads the flag to decide that: no
 * `x.isAcknowledgedState` read (handing a state's flags on as they are is
 * fine), and no query by it - the state services'
 * getAcknowledgedUnresolvedIncidentStateIds and the alert twin name the
 * states to ask for. What is left reads it on purpose and is listed below,
 * shrink-only.
 */

const FLAG: string = "isAcknowledgedState";

/*
 * Files that read the flag on purpose, by path from the repository root, and
 * why. Shrink-only.
 */
const ALLOWED: Record<string, string> = {
  // The app's own copy of the rule: it is built without Common's runtime code.
  "packages/MobileApp/src/utils/acknowledgedState.ts":
    "the mobile app's copy of Common/Utils/AcknowledgedState",
};

describe("one rule decides whether an incident, alert or episode is acknowledged", () => {
  const reads: Array<FlagRead> = scanStateFlagReads(FLAG);

  test("nothing outside the helpers reads the acknowledged flag or queries by it", () => {
    const unexpected: Array<string> = reads
      .filter((read: FlagRead): boolean => {
        return !Object.prototype.hasOwnProperty.call(ALLOWED, read.file);
      })
      .map((read: FlagRead): string => {
        return `${read.file}:${read.line}: ${read.text}`;
      });

    /*
     * Ask Common/Utils/AcknowledgedState (in the dashboard and on status
     * pages), the state services (isAcknowledgedIncidentState,
     * findAcknowledgedIncidentState, getAcknowledgedUnresolvedIncidentStateIds
     * and the alert twins) or the record services (isIncidentAcknowledged,
     * isAlertAcknowledged, isEpisodeAcknowledged) instead.
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
      "packages/Common/Utils/AcknowledgedState.ts",
      "packages/MobileApp/src/utils/acknowledgedState.ts",
    ]) {
      expect(fs.existsSync(path.join(REPOSITORY_ROOT, file))).toBe(true);
    }
  });
});

describe("the acknowledged guard's own detector", () => {
  function linesOf(text: string, file: string = "sample.ts"): Array<string> {
    return findStateFlagReads(FLAG, file, text).map(
      (read: FlagRead): string => {
        return read.text;
      },
    );
  }

  test.each([
    ["a read of the flag", "if (state.isAcknowledgedState) { go(); }"],
    [
      "an optional read",
      "const x = incident.currentIncidentState?.isAcknowledgedState;",
    ],
    ["a string-keyed read", 'const x = state["isAcknowledgedState"];'],
    ["a destructured read", "const { isAcknowledgedState } = state;"],
    [
      "a query by the flag",
      "await IncidentService.findBy({ query: { currentIncidentState: { isAcknowledgedState: true } } });",
    ],
    [
      "a query for the flagged state",
      "await AlertStateService.findOneBy({ query: { isAcknowledgedState: true, projectId } });",
    ],
    [
      "a query assigned to",
      'query["currentIncidentState"] = { isAcknowledgedState: true };',
    ],
    [
      "a list search by the flag",
      "const ack = states.find((s) => { return s.isAcknowledgedState; });",
    ],
  ] as Array<[string, string]>)("flags %s", (_name: string, text: string) => {
    expect(linesOf(text)).toHaveLength(1);
  });

  test.each([
    [
      "a select",
      "await IncidentStateService.findBy({ query: { projectId }, select: { _id: true, isAcknowledgedState: true } });",
    ],
    [
      "the flags handed on",
      "const row = { id: state.id, isAcknowledgedState: state.isAcknowledgedState };",
    ],
    ["a write of the flag", "acknowledgedState.isAcknowledgedState = true;"],
    ["a label map", 'const labels = { isAcknowledgedState: "Acknowledged" };'],
    ["a string naming the flag", 'const flag = "isAcknowledgedState";'],
    ["a type member", "interface S { isAcknowledgedState?: boolean }"],
  ] as Array<[string, string]>)(
    "leaves %s alone",
    (_name: string, text: string) => {
      expect(linesOf(text)).toEqual([]);
    },
  );
});
