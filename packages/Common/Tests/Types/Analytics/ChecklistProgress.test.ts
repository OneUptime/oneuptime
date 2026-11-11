import {
  ChecklistProgressChange,
  getChecklistProgressChange,
} from "../../../Types/Analytics/ChecklistProgress";
import { describe, expect, test } from "@jest/globals";

/*
 * Which Welcome checklist events a visit sends (issue #6830): only a
 * change this browser saw - a step it saw not done, now done - so a first
 * visit, a reload or a step that could not be checked never reports one.
 */

const STEPS: Array<string> = ["monitor", "status-page", "team", "on-call"];

describe("getChecklistProgressChange", () => {
  test("the first visit reports nothing and remembers what it saw", () => {
    const change: ChecklistProgressChange = getChecklistProgressChange({
      previouslySeen: null,
      current: { monitor: true, "status-page": false },
      stepKeys: STEPS,
    });

    expect(change.completedSteps).toEqual([]);
    expect(change.isFinished).toBe(false);
    expect(change.seen).toEqual({ monitor: true, "status-page": false });
  });

  test("a step seen not done and now done is reported, once", () => {
    const first: ChecklistProgressChange = getChecklistProgressChange({
      previouslySeen: { monitor: false, "status-page": false, team: false },
      current: { monitor: true, "status-page": false, team: false },
      stepKeys: STEPS,
    });

    expect(first.completedSteps).toEqual(["monitor"]);
    expect(first.isFinished).toBe(false);

    const reload: ChecklistProgressChange = getChecklistProgressChange({
      previouslySeen: first.seen,
      current: { monitor: true, "status-page": false, team: false },
      stepKeys: STEPS,
    });

    expect(reload.completedSteps).toEqual([]);
  });

  test("a step never seen not done is not reported when it is seen done", () => {
    const change: ChecklistProgressChange = getChecklistProgressChange({
      previouslySeen: { monitor: false },
      current: { monitor: false, team: true },
      stepKeys: STEPS,
    });

    expect(change.completedSteps).toEqual([]);
    expect(change.seen).toEqual({ monitor: false, team: true });
  });

  test("a step that could not be checked this visit keeps what was seen before", () => {
    const change: ChecklistProgressChange = getChecklistProgressChange({
      previouslySeen: { monitor: false, "on-call": false },
      current: { monitor: true },
      stepKeys: STEPS,
    });

    expect(change.completedSteps).toEqual(["monitor"]);
    expect(change.seen).toEqual({ monitor: true, "on-call": false });
  });

  test("the last step done finishes the checklist, once", () => {
    const finishing: ChecklistProgressChange = getChecklistProgressChange({
      previouslySeen: {
        monitor: true,
        "status-page": true,
        team: true,
        "on-call": false,
      },
      current: {
        monitor: true,
        "status-page": true,
        team: true,
        "on-call": true,
      },
      stepKeys: STEPS,
    });

    expect(finishing.completedSteps).toEqual(["on-call"]);
    expect(finishing.isFinished).toBe(true);

    const after: ChecklistProgressChange = getChecklistProgressChange({
      previouslySeen: finishing.seen,
      current: finishing.seen,
      stepKeys: STEPS,
    });

    expect(after.completedSteps).toEqual([]);
    expect(after.isFinished).toBe(false);
  });

  test("a checklist seen finished before nobody looked at it is not reported as finished", () => {
    const change: ChecklistProgressChange = getChecklistProgressChange({
      previouslySeen: { monitor: true },
      current: {
        monitor: true,
        "status-page": true,
        team: true,
        "on-call": true,
      },
      stepKeys: STEPS,
    });

    expect(change.isFinished).toBe(false);
  });

  test("a step done and then undone - a monitor deleted - is reported again only when done again", () => {
    const undone: ChecklistProgressChange = getChecklistProgressChange({
      previouslySeen: { monitor: true },
      current: { monitor: false },
      stepKeys: STEPS,
    });

    expect(undone.completedSteps).toEqual([]);
    expect(undone.seen).toEqual({ monitor: false });

    const redone: ChecklistProgressChange = getChecklistProgressChange({
      previouslySeen: undone.seen,
      current: { monitor: true },
      stepKeys: STEPS,
    });

    expect(redone.completedSteps).toEqual(["monitor"]);
  });

  test("keys outside the checklist's steps are neither reported nor remembered", () => {
    const change: ChecklistProgressChange = getChecklistProgressChange({
      previouslySeen: { monitor: false },
      current: { monitor: true, somethingElse: true },
      stepKeys: STEPS,
    });

    expect(change.completedSteps).toEqual(["monitor"]);
    expect(change.seen).toEqual({ monitor: true });
  });
});
