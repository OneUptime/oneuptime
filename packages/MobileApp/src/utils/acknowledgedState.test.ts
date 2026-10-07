import { describe, expect, test } from "@jest/globals";
import {
  getAcknowledgedState,
  getAcknowledgedStateIds,
  getUnacknowledgedStateIds,
  isAcknowledged,
  isAcknowledgedById,
  type AcknowledgedRuleState,
} from "./acknowledgedState";
import {
  getResolvedState,
  getResolvedStateIds,
  getUnresolvedStateIds,
  isResolvedStateId,
} from "./resolvedState";
import STATE_RULE_CASES from "../__tests__/stateRuleCases.json";

/*
 * The app's copy of the one acknowledged rule (Common/Utils/AcknowledgedState):
 * a record is acknowledged when its state is the project's acknowledged state
 * - the first from the top flagged acknowledged - or any state placed after
 * it, flagged or not; a resolved record counts too. These are the cases the
 * server's suite checks (Common/Tests/Utils/AcknowledgedState.test.ts), and
 * the shared table at the bottom is run by both, so the app and the server
 * cannot drift apart on what "acknowledged" means. Common's suite also runs
 * this file's rule itself next to its own (AcknowledgedStateMobileParity).
 */

interface State extends AcknowledgedRuleState {
  name: string;
}

const CREATED: State = { _id: "created", name: "Created", order: 1 };
const TRIAGE: State = { _id: "triage", name: "Triage", order: 2 };
const ACKNOWLEDGED: State = {
  _id: "acknowledged",
  name: "Acknowledged",
  order: 3,
  isAcknowledgedState: true,
};
const INVESTIGATING: State = {
  _id: "investigating",
  name: "Investigating",
  order: 4,
};
const RESOLVED: State = {
  _id: "resolved",
  name: "Resolved",
  order: 5,
  isResolvedState: true,
};
const CLOSED: State = { _id: "closed", name: "Closed", order: 6 };

// Listed out of order on purpose: the rule reads the order, not the position.
const STATES: Array<State> = [
  CLOSED,
  INVESTIGATING,
  RESOLVED,
  TRIAGE,
  CREATED,
  ACKNOWLEDGED,
];

describe("getAcknowledgedState", () => {
  test("is the state flagged acknowledged", () => {
    expect(getAcknowledgedState(STATES)).toBe(ACKNOWLEDGED);
  });

  test("is the first flagged from the top when two carry the flag, whatever order they arrive in", () => {
    const escalated: State = {
      _id: "escalated",
      name: "Escalated",
      order: 4,
      isAcknowledgedState: true,
    };

    expect(getAcknowledgedState([escalated, ...STATES])).toBe(ACKNOWLEDGED);
    expect(getAcknowledgedState([...STATES, escalated])).toBe(ACKNOWLEDGED);
  });

  test("prefers a flagged state with a place over one without", () => {
    const unplaced: State = {
      _id: "unplaced",
      name: "Unplaced",
      order: null,
      isAcknowledgedState: true,
    };

    expect(getAcknowledgedState([unplaced, ACKNOWLEDGED])).toBe(ACKNOWLEDGED);
  });

  test("breaks a tie on the same place by id, as the server sorts", () => {
    const b: State = {
      _id: "b",
      name: "B",
      order: 3,
      isAcknowledgedState: true,
    };
    const a: State = {
      _id: "a",
      name: "A",
      order: 3,
      isAcknowledgedState: true,
    };

    expect(getAcknowledgedState([b, a])).toBe(a);
    expect(getAcknowledgedState([a, b])).toBe(a);
  });

  test("is undefined when no state carries the flag, or there are no states", () => {
    expect(getAcknowledgedState([CREATED, RESOLVED])).toBeUndefined();
    expect(getAcknowledgedState([])).toBeUndefined();
    expect(getAcknowledgedState(undefined)).toBeUndefined();
    expect(getAcknowledgedState(null)).toBeUndefined();
  });
});

describe("isAcknowledged and isAcknowledgedById", () => {
  test("the states above the acknowledged one wait for an acknowledgement", () => {
    for (const state of [CREATED, TRIAGE]) {
      expect(isAcknowledged(STATES, state)).toBe(false);
      expect(isAcknowledgedById(STATES, state._id)).toBe(false);
    }
  });

  test("the acknowledged state is acknowledged", () => {
    expect(isAcknowledged(STATES, ACKNOWLEDGED)).toBe(true);
    expect(isAcknowledgedById(STATES, ACKNOWLEDGED._id)).toBe(true);
  });

  test("a state placed after the acknowledged one is acknowledged, flag or not", () => {
    expect(isAcknowledged(STATES, INVESTIGATING)).toBe(true);
    expect(isAcknowledgedById(STATES, INVESTIGATING._id)).toBe(true);
  });

  test("resolved is further along still: the resolved state and every state after it count", () => {
    for (const state of [RESOLVED, CLOSED]) {
      expect(isAcknowledged(STATES, state)).toBe(true);
      expect(isAcknowledgedById(STATES, state._id)).toBe(true);
    }
  });

  test("a flagged state is acknowledged wherever it sits", () => {
    const early: State = {
      _id: "early",
      name: "Early",
      order: 1,
      isAcknowledgedState: true,
    };
    const earlyResolved: State = {
      _id: "early-resolved",
      name: "Early resolved",
      order: 1,
      isResolvedState: true,
    };

    expect(isAcknowledged([early], early)).toBe(true);
    expect(isAcknowledged([earlyResolved], earlyResolved)).toBe(true);
  });

  test("a state that is none of the project's, or no state at all, is not acknowledged", () => {
    expect(isAcknowledgedById(STATES, "somewhere-else")).toBe(false);
    expect(isAcknowledgedById(STATES, undefined)).toBe(false);
    expect(isAcknowledgedById(STATES, null)).toBe(false);
    expect(isAcknowledgedById(STATES, "")).toBe(false);
    expect(isAcknowledged(STATES, undefined)).toBe(false);
    expect(isAcknowledged(STATES, null)).toBe(false);
  });

  test("a state id matches whatever its case and surrounding spaces", () => {
    expect(isAcknowledgedById(STATES, " INVESTIGATING ")).toBe(true);
    expect(isAcknowledgedById(STATES, "Triage")).toBe(false);
  });

  test("a state without a place is acknowledged only by its own flags", () => {
    const unplaced: State = { _id: "unplaced", name: "Unplaced", order: null };

    expect(isAcknowledged([...STATES, unplaced], unplaced)).toBe(false);
  });

  test("without an acknowledged state in the project, only resolving or the flag can say so", () => {
    expect(isAcknowledged([CREATED, TRIAGE, RESOLVED], TRIAGE)).toBe(false);
    expect(isAcknowledged([CREATED, TRIAGE, RESOLVED, CLOSED], CLOSED)).toBe(
      true,
    );
  });

  test("a place written as text counts, as it does on the server", () => {
    const textual: Array<State> = [
      { _id: "acknowledged", name: "Acknowledged", order: "3", isAcknowledgedState: true },
      { _id: "investigating", name: "Investigating", order: "4" },
    ];

    expect(isAcknowledgedById(textual, "investigating")).toBe(true);
  });
});

describe("getAcknowledgedStateIds and getUnacknowledgedStateIds", () => {
  test("split the project's states by the rule, in the order given", () => {
    expect(getAcknowledgedStateIds(STATES)).toEqual([
      "closed",
      "investigating",
      "resolved",
      "acknowledged",
    ]);
    expect(getUnacknowledgedStateIds(STATES)).toEqual(["triage", "created"]);
  });

  test("are empty for a project whose states never arrived", () => {
    expect(getAcknowledgedStateIds(undefined)).toEqual([]);
    expect(getUnacknowledgedStateIds(undefined)).toEqual([]);
  });
});

/*
 * The table both copies of the rules run, case for case: the server's in
 * Common/Tests/Utils/AcknowledgedState.test.ts, and the app's here.
 */
interface StateRuleCase {
  name: string;
  states: Array<AcknowledgedRuleState>;
  acknowledgedStateId: string | null;
  resolvedStateId: string | null;
  acknowledged: Array<string>;
  unacknowledged: Array<string>;
  resolved: Array<string>;
  unresolved: Array<string>;
}

interface StateRuleLookup {
  stateId: string | null;
  acknowledged: boolean;
  resolved: boolean;
}

const CASES: Array<StateRuleCase> =
  STATE_RULE_CASES.cases as unknown as Array<StateRuleCase>;

const LOOKUPS: { case: string; rows: Array<StateRuleLookup> } =
  STATE_RULE_CASES.lookups as unknown as {
    case: string;
    rows: Array<StateRuleLookup>;
  };

describe("the cases the server's copy of the rules is checked against", () => {
  test("the table has cases to check", () => {
    expect(CASES.length).toBeGreaterThan(10);
  });

  test.each(
    CASES.map((ruleCase: StateRuleCase): [string, StateRuleCase] => {
      return [ruleCase.name, ruleCase];
    }),
  )("%s", (_name: string, ruleCase: StateRuleCase) => {
    expect(getAcknowledgedState(ruleCase.states)?._id ?? null).toBe(
      ruleCase.acknowledgedStateId,
    );
    expect(getResolvedState(ruleCase.states)?._id ?? null).toBe(
      ruleCase.resolvedStateId,
    );
    expect(getAcknowledgedStateIds(ruleCase.states)).toEqual(
      ruleCase.acknowledged,
    );
    expect(getUnacknowledgedStateIds(ruleCase.states)).toEqual(
      ruleCase.unacknowledged,
    );
    expect(getResolvedStateIds(ruleCase.states)).toEqual(ruleCase.resolved);
    expect(getUnresolvedStateIds(ruleCase.states)).toEqual(
      ruleCase.unresolved,
    );

    for (const state of ruleCase.states) {
      expect(isAcknowledgedById(ruleCase.states, state._id)).toBe(
        ruleCase.acknowledged.includes(state._id),
      );
      expect(isResolvedStateId(ruleCase.states, state._id)).toBe(
        ruleCase.resolved.includes(state._id),
      );
    }
  });

  test.each(
    LOOKUPS.rows.map((row: StateRuleLookup): [string, StateRuleLookup] => {
      return [JSON.stringify(row.stateId), row];
    }),
  )("looking up %s", (_name: string, row: StateRuleLookup) => {
    const ruleCase: StateRuleCase | undefined = CASES.find(
      (candidate: StateRuleCase) => {
        return candidate.name === LOOKUPS.case;
      },
    );

    expect(ruleCase).toBeDefined();
    expect(isAcknowledgedById(ruleCase!.states, row.stateId)).toBe(
      row.acknowledged,
    );
    expect(isResolvedStateId(ruleCase!.states, row.stateId)).toBe(
      row.resolved,
    );
  });
});
