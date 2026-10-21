import { describe, expect, test } from "@jest/globals";
import {
  getResolvedState,
  getResolvedStateIds,
  getUnresolvedStateIds,
  isResolvedState,
  isResolvedStateId,
  toStateIdsQuery,
  type ResolvedRuleState,
} from "./resolvedState";

/*
 * The app's copy of the one resolved rule (Common/Utils/ResolvedState): a
 * record is resolved when its state is the project's resolved state - the
 * first from the top flagged resolved - or any state placed after it,
 * flagged or not. These cases are the ones the server's suite checks, so the
 * app and the server cannot drift apart on what "resolved" means.
 */

interface State extends ResolvedRuleState {
  name: string;
}

const CREATED: State = { _id: "created", name: "Created", order: 1 };
const ACKNOWLEDGED: State = {
  _id: "acknowledged",
  name: "Acknowledged",
  order: 2,
};
const INVESTIGATING: State = {
  _id: "investigating",
  name: "Investigating",
  order: 3,
};
const RESOLVED: State = {
  _id: "resolved",
  name: "Resolved",
  order: 4,
  isResolvedState: true,
};
const CLOSED: State = { _id: "closed", name: "Closed", order: 5 };

// Listed out of order on purpose: the rule reads the order, not the position.
const STATES: Array<State> = [
  CLOSED,
  INVESTIGATING,
  RESOLVED,
  CREATED,
  ACKNOWLEDGED,
];

describe("getResolvedState", () => {
  test("is the state flagged resolved", () => {
    expect(getResolvedState(STATES)).toBe(RESOLVED);
  });

  test("is the first flagged from the top when two carry the flag, whatever order they arrive in", () => {
    const autoClosed: State = {
      _id: "auto-closed",
      name: "Auto-closed",
      order: 6,
      isResolvedState: true,
    };

    expect(getResolvedState([autoClosed, ...STATES])).toBe(RESOLVED);
    expect(getResolvedState([...STATES, autoClosed])).toBe(RESOLVED);
  });

  test("prefers a flagged state with a place over one without", () => {
    const unplaced: State = {
      _id: "unplaced",
      name: "Unplaced",
      order: null,
      isResolvedState: true,
    };

    expect(getResolvedState([unplaced, RESOLVED])).toBe(RESOLVED);
  });

  test("is undefined when no state carries the flag, or there are no states", () => {
    expect(getResolvedState([CREATED, CLOSED])).toBeUndefined();
    expect(getResolvedState([])).toBeUndefined();
    expect(getResolvedState(undefined)).toBeUndefined();
    expect(getResolvedState(null)).toBeUndefined();
  });
});

describe("isResolvedState and isResolvedStateId", () => {
  test("the states above the resolved one are open", () => {
    for (const state of [CREATED, ACKNOWLEDGED, INVESTIGATING]) {
      expect(isResolvedState(STATES, state)).toBe(false);
      expect(isResolvedStateId(STATES, state._id)).toBe(false);
    }
  });

  test("the resolved state is resolved", () => {
    expect(isResolvedState(STATES, RESOLVED)).toBe(true);
    expect(isResolvedStateId(STATES, RESOLVED._id)).toBe(true);
  });

  test("a state placed after the resolved one is resolved, flag or not", () => {
    expect(isResolvedState(STATES, CLOSED)).toBe(true);
    expect(isResolvedStateId(STATES, CLOSED._id)).toBe(true);
  });

  test("a flagged state is resolved wherever it sits", () => {
    const early: State = {
      _id: "early",
      name: "Early",
      order: 1,
      isResolvedState: true,
    };

    expect(isResolvedState([early], early)).toBe(true);
  });

  test("a state that is none of the project's, or no state at all, is not resolved", () => {
    expect(isResolvedStateId(STATES, "somewhere-else")).toBe(false);
    expect(isResolvedStateId(STATES, undefined)).toBe(false);
    expect(isResolvedStateId(STATES, "")).toBe(false);
    expect(isResolvedState(STATES, undefined)).toBe(false);
    expect(isResolvedState(STATES, null)).toBe(false);
  });

  test("a state without a place is resolved only by its own flag", () => {
    const unplaced: State = { _id: "unplaced", name: "Unplaced", order: null };

    expect(isResolvedState([...STATES, unplaced], unplaced)).toBe(false);
  });

  test("without a resolved state in the project, only the flag can say so", () => {
    expect(isResolvedState([CREATED, CLOSED], CLOSED)).toBe(false);
  });
});

describe("getResolvedStateIds and getUnresolvedStateIds", () => {
  test("split the project's states by the rule, in the order given", () => {
    expect(getResolvedStateIds(STATES)).toEqual(["closed", "resolved"]);
    expect(getUnresolvedStateIds(STATES)).toEqual([
      "investigating",
      "created",
      "acknowledged",
    ]);
  });

  test("are empty for a project whose states never arrived", () => {
    expect(getResolvedStateIds(undefined)).toEqual([]);
    expect(getUnresolvedStateIds(undefined)).toEqual([]);
  });
});

describe("toStateIdsQuery", () => {
  test("asks the server for records whose state is one of the ids", () => {
    expect(toStateIdsQuery(["created", "acknowledged"])).toEqual({
      _type: "Includes",
      value: ["created", "acknowledged"],
    });
  });

  test("keeps an empty list empty, which matches nothing", () => {
    expect(toStateIdsQuery([])).toEqual({ _type: "Includes", value: [] });
  });
});
