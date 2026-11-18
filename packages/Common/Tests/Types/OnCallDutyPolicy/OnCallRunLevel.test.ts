import ObjectID from "../../../Types/ObjectID";
import {
  getOnCallDeletedLevelLabel,
  getOnCallDeletedLevelWords,
  getOnCallLevelAfter,
  getOnCallLevelsBefore,
  getOnCallPolicyFirstLevel,
  getOnCallRunCurrentLevel,
  getOnCallRunLaterLevels,
  getOnCallRunNextLevel,
  hasOnCallRunStartedALevel,
  isOnCallRunLevelDeleted,
  isOnCallRunPastFirstLevel,
  ON_CALL_DELETED_LEVEL_LABEL,
  OnCallPolicyLevel,
  OnCallRunPlace,
  sortOnCallPolicyLevels,
} from "../../../Types/OnCallDutyPolicy/OnCallRunLevel";
import { describe, expect, test } from "@jest/globals";

/*
 * WHERE A RUN IS IN ITS POLICY'S LEVELS, AND WHICH COMES NEXT (issue #9036).
 *
 * A run recorded the level it is on, and the level's place then. Its
 * policy's levels can change under it: these pin that the next level is
 * read from the levels as they are now - a level deleted under the run
 * (its rule cleared, its place kept) hands over to the level that moved up
 * into its place; a level added, deleted or moved before the run's neither
 * skips a level nor pages the run's own again; gaps in the numbering skip
 * nothing - and that the words for a deleted level say what was recorded.
 */

interface Level extends OnCallPolicyLevel {
  id: ObjectID;
  order: number;
  name: string;
}

const L1: ObjectID = new ObjectID("9036a000-0000-4000-8000-000000000001");
const L2: ObjectID = new ObjectID("9036a000-0000-4000-8000-000000000002");
const L3: ObjectID = new ObjectID("9036a000-0000-4000-8000-000000000003");
const L4: ObjectID = new ObjectID("9036a000-0000-4000-8000-000000000004");
const NEW: ObjectID = new ObjectID("9036a000-0000-4000-8000-0000000000ff");

function level(id: ObjectID, order: number, name: string): Level {
  return { id: id, order: order, name: name };
}

// Primary, Secondary, Manager, Director: a policy of four levels.
function policy(): Array<Level> {
  return [
    level(L1, 1, "Primary"),
    level(L2, 2, "Secondary"),
    level(L3, 3, "Manager"),
    level(L4, 4, "Director"),
  ];
}

// The policy after Secondary is deleted: the levels after it move up.
function withoutSecondary(): Array<Level> {
  return [
    level(L1, 1, "Primary"),
    level(L3, 2, "Manager"),
    level(L4, 3, "Director"),
  ];
}

function names(levels: Array<Level>): Array<string> {
  return levels.map((each: Level): string => {
    return each.name;
  });
}

function onLevel(id: ObjectID | null, order: number | null): OnCallRunPlace {
  return {
    lastExecutedEscalationRuleId: id,
    lastExecutedEscalationRuleOrder: order,
  };
}

describe("a run on a level that is still there", () => {
  test("goes on to the level after it", () => {
    expect(
      getOnCallRunNextLevel({ run: onLevel(L2, 2), levels: policy() })?.name,
    ).toBe("Manager");
    expect(
      names(getOnCallRunLaterLevels({ run: onLevel(L2, 2), levels: policy() })),
    ).toEqual(["Manager", "Director"]);
  });

  test("on the last level, has none after it", () => {
    expect(
      getOnCallRunNextLevel({ run: onLevel(L4, 4), levels: policy() }),
    ).toBeNull();
  });

  test("is where its level is now: a level deleted before it does not make it skip one", () => {
    // On Manager (recorded at place 3); Secondary deleted, Manager is at 2 now.
    expect(
      getOnCallRunNextLevel({
        run: onLevel(L3, 3),
        levels: withoutSecondary(),
      })?.name,
    ).toBe("Director");
  });

  test("a level added before it does not page its own level again", () => {
    // On Secondary (place 2); a new first level moves everybody down one.
    const levels: Array<Level> = [
      level(NEW, 1, "New first"),
      level(L1, 2, "Primary"),
      level(L2, 3, "Secondary"),
      level(L3, 4, "Manager"),
    ];

    expect(
      getOnCallRunNextLevel({ run: onLevel(L2, 2), levels: levels })?.name,
    ).toBe("Manager");
  });

  test("a level added right after it comes next", () => {
    const levels: Array<Level> = [
      level(L1, 1, "Primary"),
      level(L2, 2, "Secondary"),
      level(NEW, 3, "Backup"),
      level(L3, 4, "Manager"),
    ];

    expect(
      getOnCallRunNextLevel({ run: onLevel(L2, 2), levels: levels })?.name,
    ).toBe("Backup");
  });

  test("gaps in the numbering skip nothing", () => {
    const levels: Array<Level> = [
      level(L1, 1, "Primary"),
      level(L2, 3, "Secondary"),
      level(L3, 7, "Manager"),
    ];

    expect(
      getOnCallRunNextLevel({ run: onLevel(L1, 1), levels: levels })?.name,
    ).toBe("Secondary");
    expect(
      getOnCallRunNextLevel({ run: onLevel(L2, 3), levels: levels })?.name,
    ).toBe("Manager");
  });

  test("its level is found whatever the order the levels come in, and its id's case", () => {
    const shuffled: Array<Level> = [policy()[3]!, policy()[0]!, policy()[2]!];
    shuffled.push(policy()[1]!);

    expect(
      getOnCallRunCurrentLevel({
        run: {
          lastExecutedEscalationRuleId: L2.toString().toUpperCase(),
          lastExecutedEscalationRuleOrder: 2,
        },
        levels: shuffled,
      })?.name,
    ).toBe("Secondary");
  });
});

describe("a run on a level that was deleted under it (issue #9036)", () => {
  test("its rule cleared and its place kept: the level deleted is read as such", () => {
    expect(isOnCallRunLevelDeleted(onLevel(null, 2))).toBe(true);
    expect(hasOnCallRunStartedALevel(onLevel(null, 2))).toBe(true);
    expect(isOnCallRunLevelDeleted(onLevel(L2, 2))).toBe(false);
    expect(isOnCallRunLevelDeleted(onLevel(null, null))).toBe(false);
  });

  test("goes on to the level that moved up into its place", () => {
    expect(
      getOnCallRunNextLevel({
        run: onLevel(null, 2),
        levels: withoutSecondary(),
      })?.name,
    ).toBe("Manager");
    expect(
      names(
        getOnCallRunLaterLevels({
          run: onLevel(null, 2),
          levels: withoutSecondary(),
        }),
      ),
    ).toEqual(["Manager", "Director"]);
  });

  test("with no level moved up into its place - none renumbered - the next one after it", () => {
    const levels: Array<Level> = [
      level(L1, 1, "Primary"),
      level(L3, 3, "Manager"),
      level(L4, 4, "Director"),
    ];

    expect(
      getOnCallRunNextLevel({ run: onLevel(null, 2), levels: levels })?.name,
    ).toBe("Manager");
  });

  test("the last level deleted: none after it, so the policy repeats or the run ends", () => {
    expect(
      getOnCallRunNextLevel({
        run: onLevel(null, 4),
        levels: withoutSecondary(),
      }),
    ).toBeNull();
  });

  test("read before its rule was cleared - it still names the rule, gone from the policy - it is placed the same", () => {
    expect(
      getOnCallRunCurrentLevel({
        run: onLevel(L2, 2),
        levels: withoutSecondary(),
      }),
    ).toBeNull();
    expect(
      getOnCallRunNextLevel({
        run: onLevel(L2, 2),
        levels: withoutSecondary(),
      })?.name,
    ).toBe("Manager");
  });

  test("its current level is none: the level at its place now is another", () => {
    expect(
      getOnCallRunCurrentLevel({
        run: onLevel(null, 2),
        levels: withoutSecondary(),
      }),
    ).toBeNull();
  });
});

describe("a run that has started no level", () => {
  test("is on none, and every level is after it, the first first", () => {
    expect(hasOnCallRunStartedALevel(onLevel(null, null))).toBe(false);
    expect(hasOnCallRunStartedALevel({})).toBe(false);
    expect(
      getOnCallRunNextLevel({ run: onLevel(null, null), levels: policy() })
        ?.name,
    ).toBe("Primary");
  });

  test("a run that names a rule has started a level", () => {
    expect(hasOnCallRunStartedALevel(onLevel(L1, null))).toBe(true);
    expect(hasOnCallRunStartedALevel(onLevel(L1, 1))).toBe(true);
  });

  test("a place that is not a whole number is no place", () => {
    expect(
      hasOnCallRunStartedALevel({
        lastExecutedEscalationRuleOrder: Number.NaN,
      }),
    ).toBe(false);
    expect(
      isOnCallRunLevelDeleted({ lastExecutedEscalationRuleOrder: 1.5 }),
    ).toBe(false);
  });
});

describe("a policy's levels", () => {
  test("are read in order, each once, any without a place left out", () => {
    const levels: Array<OnCallPolicyLevel & { name: string }> = [
      { id: L3, order: 3, name: "Manager" },
      { id: L1, order: 1, name: "Primary" },
      { id: L2, order: undefined, name: "No place" },
      { id: L1, order: 1, name: "Primary again" },
      { id: L4, order: 2, name: "Director" },
    ];

    expect(
      sortOnCallPolicyLevels(levels).map((each: { name: string }): string => {
        return each.name;
      }),
    ).toEqual(["Primary", "Director", "Manager"]);
  });

  test("the first is the lowest place, which need not be 1", () => {
    expect(
      getOnCallPolicyFirstLevel([
        level(L2, 5, "Secondary"),
        level(L1, 3, "Primary"),
      ])?.name,
    ).toBe("Primary");
    expect(getOnCallPolicyFirstLevel([])).toBeNull();
  });
});

/*
 * LEVELS THAT SHARE A PLACE, AND GAPS (issue #9573).
 *
 * No write of a level moves another any more: a deleted level leaves its
 * gap, and Terraform numbers a policy's levels one write each, so until
 * every write of an apply has landed - or for good, when a configuration
 * gives two levels one number - two levels can share a place. They come in
 * the order of their ids, as the database reads them; the second of two is
 * after the first, never skipped, and "next" goes by that order, never by
 * the number one more.
 */
describe("levels that share a place", () => {
  // L2 and L3 both at 2: L2 comes first, by id.
  function withTwins(): Array<Level> {
    return [
      level(L3, 2, "Manager"),
      level(L4, 5, "Director"),
      level(L1, 1, "Primary"),
      level(L2, 2, "Secondary"),
    ];
  }

  test("come in the order of their ids, whatever order they are handed in", () => {
    expect(names(sortOnCallPolicyLevels(withTwins()))).toEqual([
      "Primary",
      "Secondary",
      "Manager",
      "Director",
    ]);
    expect(names(sortOnCallPolicyLevels([...withTwins()].reverse()))).toEqual([
      "Primary",
      "Secondary",
      "Manager",
      "Director",
    ]);
  });

  test("a run on the first of two goes on to the second, never past it", () => {
    expect(
      getOnCallRunNextLevel({ run: onLevel(L2, 2), levels: withTwins() })?.name,
    ).toBe("Manager");
    expect(
      names(
        getOnCallRunLaterLevels({ run: onLevel(L2, 2), levels: withTwins() }),
      ),
    ).toEqual(["Manager", "Director"]);
  });

  test("a run on the second of two goes on to the next place, over the gap", () => {
    expect(
      getOnCallRunNextLevel({ run: onLevel(L3, 2), levels: withTwins() })?.name,
    ).toBe("Director");
  });

  test("a run on a level deleted at their place goes on to both, the first first", () => {
    expect(
      names(
        getOnCallRunLaterLevels({
          run: onLevel(null, 2),
          levels: withTwins(),
        }),
      ),
    ).toEqual(["Secondary", "Manager", "Director"]);
  });

  test("the first of two at the lowest place is the policy's first", () => {
    expect(
      getOnCallPolicyFirstLevel([
        level(L2, 1, "Secondary"),
        level(L1, 1, "Primary"),
      ])?.name,
    ).toBe("Primary");
  });
});

describe("the levels before one", () => {
  test("are the ones a run moved straight on to it passes over, in order", () => {
    const levels: Array<Level> = sortOnCallPolicyLevels([
      level(L1, 1, "Primary"),
      level(L2, 2, "Secondary"),
      level(L3, 2, "Manager"),
      level(L4, 4, "Director"),
    ]);

    expect(
      names(getOnCallLevelsBefore({ level: levels[3]!, levels: levels })),
    ).toEqual(["Primary", "Secondary", "Manager"]);
    // The second of two at one place passes over the first.
    expect(
      names(getOnCallLevelsBefore({ level: levels[2]!, levels: levels })),
    ).toEqual(["Primary", "Secondary"]);
    expect(
      getOnCallLevelsBefore({ level: levels[0]!, levels: levels }),
    ).toEqual([]);
  });

  test("of a level not among them are none", () => {
    expect(
      getOnCallLevelsBefore({
        level: level(NEW, 2, "New"),
        levels: policy(),
      }),
    ).toEqual([]);
  });

  test("find the level by its id, in any case", () => {
    expect(
      names(
        getOnCallLevelsBefore({
          level: level(new ObjectID(L3.toString().toUpperCase()), 3, "x"),
          levels: policy(),
        }),
      ),
    ).toEqual(["Primary", "Secondary"]);
  });
});

describe("the level after one", () => {
  test("is the next in the policy's order, whatever its number", () => {
    const levels: Array<Level> = [
      level(L1, 1, "Primary"),
      level(L3, 7, "Manager"),
    ];

    expect(
      getOnCallLevelAfter({ level: levels[0]!, levels: levels })?.name,
    ).toBe("Manager");
  });

  test("of the first of two at one place is the second", () => {
    expect(
      getOnCallLevelAfter({
        level: level(L2, 2, "Secondary"),
        levels: [
          level(L3, 2, "Manager"),
          level(L2, 2, "Secondary"),
          level(L4, 3, "Director"),
        ],
      })?.name,
    ).toBe("Manager");
  });

  test("of the last, or of a level not in the policy, is none", () => {
    expect(
      getOnCallLevelAfter({
        level: level(L4, 4, "Director"),
        levels: policy(),
      }),
    ).toBeNull();
    expect(
      getOnCallLevelAfter({ level: level(NEW, 2, "New"), levels: policy() }),
    ).toBeNull();
  });
});

describe("whether a run is past its policy's first level", () => {
  test("on the first level, it is not", () => {
    expect(
      isOnCallRunPastFirstLevel({ run: onLevel(L1, 1), levels: policy() }),
    ).toBe(false);
  });

  /*
   * The check used to be "past place 1", so a run on the first level of a
   * policy whose first level is at 3 - its levels before it deleted - was
   * taken as one that had not paged the levels before it, and a pass that
   * reached nobody went round again.
   */
  test("on the first level at a later place than 1, it is not", () => {
    expect(
      isOnCallRunPastFirstLevel({
        run: onLevel(L3, 3),
        levels: [level(L3, 3, "Manager"), level(L4, 4, "Director")],
      }),
    ).toBe(false);
  });

  test("on a later level, it is", () => {
    expect(
      isOnCallRunPastFirstLevel({ run: onLevel(L3, 3), levels: policy() }),
    ).toBe(true);
  });

  test("on the second of two at the lowest place, it is", () => {
    const levels: Array<Level> = [
      level(L1, 1, "Primary"),
      level(L2, 1, "Secondary"),
    ];

    expect(
      isOnCallRunPastFirstLevel({ run: onLevel(L2, 1), levels: levels }),
    ).toBe(true);
    expect(
      isOnCallRunPastFirstLevel({ run: onLevel(L1, 1), levels: levels }),
    ).toBe(false);
  });

  test("on a deleted level, it is when the place it recorded is after the first's", () => {
    expect(
      isOnCallRunPastFirstLevel({
        run: onLevel(null, 2),
        levels: withoutSecondary(),
      }),
    ).toBe(true);
    expect(
      isOnCallRunPastFirstLevel({
        run: onLevel(null, 1),
        levels: [level(L3, 3, "Manager"), level(L4, 4, "Director")],
      }),
    ).toBe(false);
  });

  test("on no level yet, or with no levels, it is not", () => {
    expect(
      isOnCallRunPastFirstLevel({ run: onLevel(null, null), levels: policy() }),
    ).toBe(false);
    expect(isOnCallRunPastFirstLevel({ run: onLevel(L2, 2), levels: [] })).toBe(
      false,
    );
  });
});

describe("the words for a deleted level", () => {
  test("name it from what was recorded as it paged", () => {
    expect(getOnCallDeletedLevelLabel({ order: 2, name: "Database" })).toBe(
      "Level 2: Database (deleted)",
    );
    expect(getOnCallDeletedLevelLabel({ order: 2, name: "  " })).toBe(
      "Level 2 (deleted)",
    );
    expect(getOnCallDeletedLevelLabel({ order: 2 })).toBe("Level 2 (deleted)");
  });

  test("with nothing recorded - a line from before levels were recorded - say a rule was deleted", () => {
    expect(getOnCallDeletedLevelLabel({})).toBe(ON_CALL_DELETED_LEVEL_LABEL);
    expect(getOnCallDeletedLevelLabel({ name: "Database" })).toBe(
      "Deleted escalation rule",
    );
  });

  test("are a template and its values, for a reader's language to word", () => {
    expect(getOnCallDeletedLevelWords({ order: 3, name: "Ops" })).toEqual({
      template: "Level {{order}}: {{name}} (deleted)",
      values: { order: 3, name: "Ops" },
    });
    expect(getOnCallDeletedLevelWords({ order: 3 })).toEqual({
      template: "Level {{order}} (deleted)",
      values: { order: 3 },
    });
    expect(getOnCallDeletedLevelWords({ order: null })).toEqual({
      template: "Deleted escalation rule",
      values: {},
    });
  });
});
