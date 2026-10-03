import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_ESCALATE_AFTER_IN_MINUTES,
  EscalationRuleNameEntry,
  getDefaultEscalationRuleName,
  getEscalationRuleDisplayName,
  getEscalationRuleOrderAfterSwap,
  getEscalationRuleRenames,
  isDefaultEscalationRuleName,
} from "../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";

/*
 * What a new escalation rule starts with, and what it is called when nobody
 * names it. The server names a rule created without a name with these, the
 * dashboard shows the same name as the form's placeholder, and the ladder
 * keeps those names in step with the levels when rules move or one is
 * deleted - so "Level 2" never sits above "Level 1".
 */

type EntryFunction = (id: string, name: string) => EscalationRuleNameEntry;

const entry: EntryFunction = (
  id: string,
  name: string,
): EscalationRuleNameEntry => {
  return { id, name };
};

describe("the default wait", () => {
  test("is thirty minutes", () => {
    expect(DEFAULT_ESCALATE_AFTER_IN_MINUTES).toBe(30);
  });
});

describe("the name a rule gets from its level", () => {
  test("is 'Level' and the level, counting from one", () => {
    expect(getDefaultEscalationRuleName(1)).toBe("Level 1");
    expect(getDefaultEscalationRuleName(2)).toBe("Level 2");
    expect(getDefaultEscalationRuleName(12)).toBe("Level 12");
  });

  test("never names a level zero, a negative or a fraction", () => {
    expect(getDefaultEscalationRuleName(0)).toBe("Level 1");
    expect(getDefaultEscalationRuleName(-3)).toBe("Level 1");
    expect(getDefaultEscalationRuleName(Number.NaN)).toBe("Level 1");
    expect(getDefaultEscalationRuleName(Number.POSITIVE_INFINITY)).toBe(
      "Level 1",
    );
    expect(getDefaultEscalationRuleName(2.7)).toBe("Level 2");
  });
});

describe("whether a name is its level's", () => {
  test("is true for the level's own name", () => {
    expect(isDefaultEscalationRuleName("Level 2", 2)).toBe(true);
  });

  test("ignores case and spacing, as somebody may have typed it", () => {
    expect(isDefaultEscalationRuleName("level 2", 2)).toBe(true);
    expect(isDefaultEscalationRuleName("  LEVEL   2 ", 2)).toBe(true);
  });

  test("is false for another level's name: that one was chosen", () => {
    expect(isDefaultEscalationRuleName("Level 1", 2)).toBe(false);
    expect(isDefaultEscalationRuleName("Level 12", 1)).toBe(false);
  });

  test("is false for a name of somebody's own", () => {
    expect(isDefaultEscalationRuleName("Managers", 1)).toBe(false);
    expect(isDefaultEscalationRuleName("Level 2 support", 2)).toBe(false);
  });

  test("is false when there is no name at all", () => {
    expect(isDefaultEscalationRuleName("", 1)).toBe(false);
    expect(isDefaultEscalationRuleName("   ", 1)).toBe(false);
    expect(isDefaultEscalationRuleName(undefined, 1)).toBe(false);
    expect(isDefaultEscalationRuleName(null, 1)).toBe(false);
  });
});

describe("the name a rule is shown with", () => {
  test("is its own name when it has one", () => {
    expect(getEscalationRuleDisplayName("Managers", 3)).toBe("Managers");
  });

  test("is its level's name when it has none", () => {
    expect(getEscalationRuleDisplayName("", 3)).toBe("Level 3");
    expect(getEscalationRuleDisplayName("  ", 3)).toBe("Level 3");
    expect(getEscalationRuleDisplayName(undefined, 1)).toBe("Level 1");
    expect(getEscalationRuleDisplayName(null, 2)).toBe("Level 2");
  });
});

describe("the levels after a rule swaps places with a neighbour", () => {
  const ids: Array<string> = ["a", "b", "c"];

  test("moving up swaps it with the rule above", () => {
    expect(
      getEscalationRuleOrderAfterSwap({ ids, index: 2, neighbourIndex: 1 }),
    ).toEqual(["a", "c", "b"]);
  });

  test("moving down swaps it with the rule below", () => {
    expect(
      getEscalationRuleOrderAfterSwap({ ids, index: 0, neighbourIndex: 1 }),
    ).toEqual(["b", "a", "c"]);
  });

  test("leaves the list it was given alone", () => {
    getEscalationRuleOrderAfterSwap({ ids, index: 0, neighbourIndex: 1 });

    expect(ids).toEqual(["a", "b", "c"]);
  });

  test("a neighbour past either end changes nothing", () => {
    expect(
      getEscalationRuleOrderAfterSwap({ ids, index: 0, neighbourIndex: -1 }),
    ).toEqual(ids);
    expect(
      getEscalationRuleOrderAfterSwap({ ids, index: 2, neighbourIndex: 3 }),
    ).toEqual(ids);
  });
});

describe("keeping levels named after their place", () => {
  test("moving the third level up swaps the names of the two that moved", () => {
    expect(
      getEscalationRuleRenames({
        before: [
          entry("a", "Level 1"),
          entry("b", "Level 2"),
          entry("c", "Level 3"),
        ],
        after: ["a", "c", "b"],
      }),
    ).toEqual([entry("b", "Level 3"), entry("c", "Level 2")]);
  });

  test("deleting the first level moves every name after it up", () => {
    expect(
      getEscalationRuleRenames({
        before: [
          entry("a", "Level 1"),
          entry("b", "Level 2"),
          entry("c", "Level 3"),
        ],
        after: ["b", "c"],
      }),
    ).toEqual([entry("b", "Level 1"), entry("c", "Level 2")]);
  });

  test("deleting the last level renames nothing", () => {
    expect(
      getEscalationRuleRenames({
        before: [entry("a", "Level 1"), entry("b", "Level 2")],
        after: ["a"],
      }),
    ).toEqual([]);
  });

  test("a name somebody chose stays wherever the rule goes", () => {
    expect(
      getEscalationRuleRenames({
        before: [entry("a", "First responders"), entry("b", "Managers")],
        after: ["b", "a"],
      }),
    ).toEqual([]);
  });

  test("only the default names move when both kinds are on the ladder", () => {
    expect(
      getEscalationRuleRenames({
        before: [
          entry("a", "Level 1"),
          entry("b", "Managers"),
          entry("c", "Level 3"),
        ],
        after: ["a", "c", "b"],
      }),
    ).toEqual([entry("c", "Level 2")]);
  });

  test("'Level 1' on the third rule was chosen, so it is kept", () => {
    expect(
      getEscalationRuleRenames({
        before: [
          entry("a", "Primary"),
          entry("b", "Secondary"),
          entry("c", "Level 1"),
        ],
        after: ["c", "a", "b"],
      }),
    ).toEqual([]);
  });

  test("a default name typed in another case is written the default way", () => {
    expect(
      getEscalationRuleRenames({
        before: [entry("a", "level 1"), entry("b", "LEVEL 2")],
        after: ["b", "a"],
      }),
    ).toEqual([entry("a", "Level 2"), entry("b", "Level 1")]);
  });

  test("a rule that did not move keeps its name", () => {
    expect(
      getEscalationRuleRenames({
        before: [
          entry("a", "Level 1"),
          entry("b", "Level 2"),
          entry("c", "Level 3"),
        ],
        after: ["a", "b", "c"],
      }),
    ).toEqual([]);
  });

  test("a rule with no name is left to the display name", () => {
    expect(
      getEscalationRuleRenames({
        before: [entry("a", ""), entry("b", "Level 2")],
        after: ["b", "a"],
      }),
    ).toEqual([entry("b", "Level 1")]);
  });

  test("an empty ladder renames nothing", () => {
    expect(getEscalationRuleRenames({ before: [], after: [] })).toEqual([]);
  });
});
