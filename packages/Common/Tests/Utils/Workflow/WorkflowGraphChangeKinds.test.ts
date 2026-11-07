import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import {
  WorkflowGraphChange,
  WorkflowGraphChangeKind,
  WorkflowGraphChanges,
  getWorkflowGraphChanges,
} from "../../../Utils/Workflow/WorkflowGraphChanges";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  CardSpec,
  EMAIL,
  IF_ELSE,
  LOG,
  MANUAL,
  graphOf,
  lookup,
} from "./WorkflowGraphFixtures";

/*
 * The changes behind the lines, by kind and with the steps each is about
 * (issue #6188): what the builder's Undo names, and the cards moved, which a
 * version history says and the audit log does not.
 */

const changesOf: (
  before: unknown,
  after: unknown,
  includeMoves?: boolean,
) => WorkflowGraphChanges = (
  before: unknown,
  after: unknown,
  includeMoves: boolean = false,
): WorkflowGraphChanges => {
  return getWorkflowGraphChanges({ before, after, lookup, includeMoves });
};

const kindsOf: (changes: WorkflowGraphChanges) => Array<string> = (
  changes: WorkflowGraphChanges,
): Array<string> => {
  return changes.changes.map((change: WorkflowGraphChange): string => {
    return change.kind;
  });
};

describe("every line comes with its kind and the steps it is about", () => {
  test("a step added", () => {
    const result: WorkflowGraphChanges = changesOf(
      graphOf([MANUAL]),
      graphOf([MANUAL, LOG]),
    );

    expect(result.changes).toEqual([
      {
        kind: WorkflowGraphChangeKind.Added,
        line: 'Added "Log" (log-1)',
        steps: [{ key: LOG.key, label: '"Log" (log-1)' }],
      },
    ]);
  });

  test("a step removed", () => {
    expect(
      changesOf(graphOf([MANUAL, EMAIL]), graphOf([MANUAL])).changes,
    ).toEqual([
      {
        kind: WorkflowGraphChangeKind.Removed,
        line: 'Removed "Send Email" (send-email-1)',
        steps: [{ key: EMAIL.key, label: '"Send Email" (send-email-1)' }],
      },
    ]);
  });

  test("a step renamed is about the step as it was named", () => {
    expect(
      changesOf(graphOf([LOG]), graphOf([{ ...LOG, stepId: "log-final" }]))
        .changes,
    ).toEqual([
      {
        kind: WorkflowGraphChangeKind.Renamed,
        line: 'Renamed "Log" (log-1) to "log-final"',
        steps: [{ key: LOG.key, label: '"Log" (log-1)' }],
      },
    ]);
  });

  test("a component swapped under its card", () => {
    expect(
      kindsOf(
        changesOf(
          graphOf([LOG]),
          graphOf([{ ...LOG, componentId: EMAIL.componentId }]),
        ),
      ),
    ).toEqual([WorkflowGraphChangeKind.Replaced]);
  });

  test("settings changed, and a part of the step that is not a setting", () => {
    const after: { nodes: Array<JSONObject>; edges: Array<JSONObject> } =
      graphOf([{ ...LOG, args: { value: "other" } }]);
    ((after.nodes[0] as JSONObject)["data"] as JSONObject)["isDisabled"] = true;

    const result: WorkflowGraphChanges = changesOf(graphOf([LOG]), after);

    expect(kindsOf(result).sort()).toEqual(
      [
        WorkflowGraphChangeKind.SettingsChanged,
        WorkflowGraphChangeKind.SetUpChanged,
      ].sort(),
    );
    expect(
      result.changes.every((change: WorkflowGraphChange): boolean => {
        return (
          change.steps.length === 1 && change.steps[0]?.key === LOG.key
        );
      }),
    ).toBe(true);
  });

  test("a connection made and one removed are about both ends, where it leaves first", () => {
    const result: WorkflowGraphChanges = changesOf(
      graphOf(
        [IF_ELSE, LOG, EMAIL],
        [{ from: IF_ELSE.key, to: LOG.key, fromPort: "yes" }],
      ),
      graphOf(
        [IF_ELSE, LOG, EMAIL],
        [{ from: IF_ELSE.key, to: EMAIL.key, fromPort: "yes" }],
      ),
    );

    expect(
      result.changes.map((change: WorkflowGraphChange) => {
        return {
          kind: change.kind,
          keys: change.steps.map((step: { key: string }): string => {
            return step.key;
          }),
        };
      }),
    ).toEqual([
      {
        kind: WorkflowGraphChangeKind.Connected,
        keys: [IF_ELSE.key, EMAIL.key],
      },
      {
        kind: WorkflowGraphChangeKind.Disconnected,
        keys: [IF_ELSE.key, LOG.key],
      },
    ]);
  });

  test("the changes are uncut, the lines are cut, and both are in the same order", () => {
    const many: Array<CardSpec> = Array.from(
      { length: 40 },
      (_value: unknown, index: number): CardSpec => {
        return { ...LOG, key: `card-${index}`, stepId: `log-${index}` };
      },
    );

    const result: WorkflowGraphChanges = getWorkflowGraphChanges({
      before: graphOf([]),
      after: graphOf(many),
      lookup,
      lineLimit: 10,
    });

    expect(result.changes).toHaveLength(40);
    expect(result.totalChanges).toBe(40);
    expect(result.lines).toHaveLength(10);
    expect(result.lines.slice(0, 9)).toEqual(
      result.changes.slice(0, 9).map((change: WorkflowGraphChange): string => {
        return change.line;
      }),
    );
    expect(result.lines[9]).toBe("and 31 more changes");
  });

  test("nothing changed, nothing listed", () => {
    expect(changesOf(graphOf([MANUAL, LOG]), graphOf([MANUAL, LOG]))).toEqual(
      { lines: [], totalChanges: 0, changes: [] },
    );
  });
});

describe("cards moved, for a version history (includeMoves)", () => {
  test("are not changes unless asked for: the audit log records what a workflow does", () => {
    expect(
      changesOf(graphOf([MANUAL, LOG]), graphOf([MANUAL, { ...LOG, x: 512 }]))
        .lines,
    ).toEqual([]);
  });

  test("one card moved is named", () => {
    expect(
      changesOf(
        graphOf([MANUAL, LOG]),
        graphOf([MANUAL, { ...LOG, x: 512 }]),
        true,
      ).changes,
    ).toEqual([
      {
        kind: WorkflowGraphChangeKind.Moved,
        line: 'Moved "Log" (log-1)',
        steps: [{ key: LOG.key, label: '"Log" (log-1)' }],
      },
    ]);
  });

  test("two cards are named, in order of their names", () => {
    expect(
      changesOf(
        graphOf([MANUAL, LOG]),
        graphOf([
          { ...MANUAL, x: 0 },
          { ...LOG, y: 900 },
        ]),
        true,
      ).lines,
    ).toEqual(['Moved "Log" (log-1) and "Manual" (manual-1)']);
  });

  test("more cards are counted, in one line", () => {
    const result: WorkflowGraphChanges = changesOf(
      graphOf([MANUAL, LOG, EMAIL]),
      graphOf([
        { ...MANUAL, x: 0 },
        { ...LOG, x: 0 },
        { ...EMAIL, x: 0 },
      ]),
      true,
    );

    expect(result.lines).toEqual(["Moved 3 steps"]);
    expect(result.changes[0]?.steps).toHaveLength(3);
  });

  test("come last, after what the workflow does", () => {
    expect(
      changesOf(
        graphOf([MANUAL, LOG]),
        graphOf([{ ...MANUAL, x: 0 }, LOG, EMAIL]),
        true,
      ).lines,
    ).toEqual(['Added "Send Email" (send-email-1)', 'Moved "Manual" (manual-1)']);
  });

  test("a card added, removed or swapped for another component is not also a move", () => {
    expect(
      changesOf(
        graphOf([MANUAL, LOG]),
        graphOf([
          { ...MANUAL, componentId: EMAIL.componentId, x: 0 },
          { ...EMAIL, x: 0 },
        ]),
        true,
      ).changes.some((change: WorkflowGraphChange): boolean => {
        return change.kind === WorkflowGraphChangeKind.Moved;
      }),
    ).toBe(false);
  });

  test("a card with no position on one side is not said to have moved", () => {
    const after: { nodes: Array<JSONObject>; edges: Array<JSONObject> } =
      graphOf([MANUAL, LOG]);
    delete (after.nodes[1] as JSONObject)["position"];

    expect(changesOf(graphOf([MANUAL, LOG]), after, true).lines).toEqual([]);
  });

  test("property: the lines without moves are the lines with moves, less the move line", () => {
    const random: SeededRandom = seededRandom(61880);

    for (let attempt: number = 0; attempt < 300; attempt++) {
      const cards: Array<CardSpec> = [MANUAL, LOG, EMAIL, IF_ELSE];
      const before: Array<CardSpec> = cards.filter((): boolean => {
        return random(3) > 0;
      });
      const after: Array<CardSpec> = cards
        .filter((): boolean => {
          return random(3) > 0;
        })
        .map((spec: CardSpec): CardSpec => {
          return random(2) === 0
            ? { ...spec, x: random(10) * 16, y: random(10) * 16 }
            : spec;
        });

      const without: WorkflowGraphChanges = changesOf(
        graphOf(before),
        graphOf(after),
      );
      const withMoves: WorkflowGraphChanges = changesOf(
        graphOf(before),
        graphOf(after),
        true,
      );

      expect(
        withMoves.changes
          .filter((change: WorkflowGraphChange): boolean => {
            return change.kind !== WorkflowGraphChangeKind.Moved;
          })
          .map((change: WorkflowGraphChange): string => {
            return change.line;
          }),
      ).toEqual(without.lines);
      expect(
        withMoves.changes.filter((change: WorkflowGraphChange): boolean => {
          return change.kind === WorkflowGraphChangeKind.Moved;
        }).length,
      ).toBeLessThanOrEqual(1);
    }
  });
});
