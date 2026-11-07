import WriteSource from "../../../../Types/BaseDatabase/WriteSource";
import { JSONObject } from "../../../../Types/JSON";
import { WorkflowEditCause } from "../../../../UI/Components/Workflow/WorkflowEditHistory";
import {
  MAX_WORKFLOW_VERSIONS_READ_FOR_SAVES,
  WorkflowSavedElsewhereStep,
  WorkflowVersionOfSave,
  getStepsSavedElsewhere,
  getWorkflowVersionsToRead,
  isAskAiSaveAlone,
} from "../../../../UI/Components/Workflow/WorkflowSavedElsewhere";
import {
  SavedWorkflowGraph,
  getWorkflowGraphKey,
  toSavedWorkflowGraph,
} from "../../../../Utils/Workflow/WorkflowGraphSnapshot";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  EMAIL,
  IF_ELSE,
  LOG,
  MANUAL,
  graphOf,
} from "../../../Utils/Workflow/WorkflowGraphFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * Issue #6274: when Ask AI's change was made on top of a save the Builder
 * had not seen, Undo takes back Ask AI's change alone - their save is a step
 * of its own - and the steps follow the version history.
 */

const saved: (graph: unknown) => SavedWorkflowGraph = (
  graph: unknown,
): SavedWorkflowGraph => {
  return toSavedWorkflowGraph(graph);
};

// What the Builder knew: the trigger and a Log.
const KNOWN: SavedWorkflowGraph = saved(
  graphOf([MANUAL, LOG], [{ from: "card-manual", to: "card-log" }]),
);

// A teammate added an email.
const THEIRS: SavedWorkflowGraph = saved(
  graphOf(
    [MANUAL, LOG, EMAIL],
    [
      { from: "card-manual", to: "card-log" },
      { from: "card-log", to: "card-email" },
    ],
  ),
);

// Ask AI's change, made on top of theirs: an If / Else.
const ASK_AI: SavedWorkflowGraph = saved(
  graphOf(
    [MANUAL, LOG, EMAIL, IF_ELSE],
    [
      { from: "card-manual", to: "card-log" },
      { from: "card-log", to: "card-email" },
      { from: "card-email", to: "card-if" },
    ],
  ),
);

// Someone else again, after Ask AI: the Log moved.
const AFTER: SavedWorkflowGraph = saved(
  graphOf(
    [MANUAL, { ...LOG, x: 900 }, EMAIL, IF_ELSE],
    [
      { from: "card-manual", to: "card-log" },
      { from: "card-log", to: "card-email" },
      { from: "card-email", to: "card-if" },
    ],
  ),
);

const version: (
  versionNumber: number,
  graph: SavedWorkflowGraph,
  savedThrough?: WriteSource | null,
) => WorkflowVersionOfSave = (
  versionNumber: number,
  graph: SavedWorkflowGraph,
  savedThrough?: WriteSource | null,
): WorkflowVersionOfSave => {
  return {
    versionNumber,
    graph: JSON.parse(JSON.stringify(graph)) as JSONObject,
    savedThrough: savedThrough ?? null,
  };
};

type ShapeFunction = (
  steps: Array<WorkflowSavedElsewhereStep>,
) => Array<[WorkflowEditCause, string]>;

const NAMES: Map<string, string> = new Map<string, string>([
  [getWorkflowGraphKey(KNOWN), "known"],
  [getWorkflowGraphKey(THEIRS), "theirs"],
  [getWorkflowGraphKey(ASK_AI), "Ask AI's"],
  [getWorkflowGraphKey(AFTER), "after"],
]);

// Each step as its cause and the graph it lands on, by name.
const shape: ShapeFunction = (
  steps: Array<WorkflowSavedElsewhereStep>,
): Array<[WorkflowEditCause, string]> => {
  return steps.map(
    (step: WorkflowSavedElsewhereStep): [WorkflowEditCause, string] => {
      return [step.cause, NAMES.get(getWorkflowGraphKey(step.graph)) || "?"];
    },
  );
};

describe("whether the server's graph is Ask AI's save alone", () => {
  test.each([
    [4, 5, true],
    [4, 4, true],
    [4, 3, true],
    [4, 6, false],
    [0, 9, false],
    [null, 9, true],
    [4, null, true],
    [null, null, true],
  ] as Array<[number | null, number | null, boolean]>)(
    "known at %s, the server at %s: %s",
    (known: number | null, server: number | null, alone: boolean) => {
      expect(isAskAiSaveAlone({ known, server })).toBe(alone);
    },
  );
});

describe("how many versions are read", () => {
  test("one for each save since, and the one that held the graph known", () => {
    expect(getWorkflowVersionsToRead({ known: 4, server: 6 })).toBe(3);
    expect(getWorkflowVersionsToRead({ known: 4, server: 9 })).toBe(6);
  });

  test("never fewer than two, never more than the most", () => {
    expect(getWorkflowVersionsToRead({ known: 4, server: 4 })).toBe(2);
    expect(getWorkflowVersionsToRead({ known: 0, server: 500 })).toBe(
      MAX_WORKFLOW_VERSIONS_READ_FOR_SAVES,
    );
    expect(getWorkflowVersionsToRead({ known: null, server: 5 })).toBe(
      MAX_WORKFLOW_VERSIONS_READ_FOR_SAVES,
    );
  });
});

describe("the steps of what was saved elsewhere", () => {
  test("a teammate saved, then Ask AI's change on top: their changes, then Ask AI's change, as two steps", () => {
    expect(
      shape(
        getStepsSavedElsewhere({
          known: KNOWN,
          server: ASK_AI,
          versions: [
            version(7, ASK_AI, WriteSource.AskAi),
            version(6, THEIRS),
            version(5, KNOWN),
          ],
        }),
      ),
    ).toEqual([
      [WorkflowEditCause.TheirChanges, "theirs"],
      [WorkflowEditCause.AskAi, "Ask AI's"],
    ]);
  });

  test("in whatever order the versions come", () => {
    expect(
      shape(
        getStepsSavedElsewhere({
          known: KNOWN,
          server: ASK_AI,
          versions: [
            version(6, THEIRS),
            version(5, KNOWN),
            version(7, ASK_AI, WriteSource.AskAi),
          ],
        }),
      ),
    ).toEqual([
      [WorkflowEditCause.TheirChanges, "theirs"],
      [WorkflowEditCause.AskAi, "Ask AI's"],
    ]);
  });

  test("and a save after Ask AI's is theirs too, a step of its own", () => {
    expect(
      shape(
        getStepsSavedElsewhere({
          known: KNOWN,
          server: AFTER,
          versions: [
            version(8, AFTER),
            version(7, ASK_AI, WriteSource.AskAi),
            version(6, THEIRS),
            version(5, KNOWN),
          ],
        }),
      ),
    ).toEqual([
      [WorkflowEditCause.TheirChanges, "theirs"],
      [WorkflowEditCause.AskAi, "Ask AI's"],
      [WorkflowEditCause.TheirChanges, "after"],
    ]);
  });

  test("their saves next to each other are one step", () => {
    const middle: SavedWorkflowGraph = saved(
      graphOf(
        [MANUAL, { ...LOG, x: 5 }],
        [{ from: "card-manual", to: "card-log" }],
      ),
    );

    expect(
      shape(
        getStepsSavedElsewhere({
          known: KNOWN,
          server: ASK_AI,
          versions: [
            version(8, ASK_AI, WriteSource.AskAi),
            version(7, THEIRS),
            version(6, middle),
            version(5, KNOWN),
          ],
        }),
      ),
    ).toEqual([
      [WorkflowEditCause.TheirChanges, "theirs"],
      [WorkflowEditCause.AskAi, "Ask AI's"],
    ]);
  });

  test("two Ask AI changes are two steps", () => {
    expect(
      shape(
        getStepsSavedElsewhere({
          known: KNOWN,
          server: ASK_AI,
          versions: [
            version(7, ASK_AI, WriteSource.AskAi),
            version(6, THEIRS, WriteSource.AskAi),
            version(5, KNOWN),
          ],
        }),
      ),
    ).toEqual([
      [WorkflowEditCause.AskAi, "theirs"],
      [WorkflowEditCause.AskAi, "Ask AI's"],
    ]);
  });

  test("the newest version that held the graph known is where the steps start", () => {
    expect(
      shape(
        getStepsSavedElsewhere({
          known: KNOWN,
          server: ASK_AI,
          versions: [
            version(9, ASK_AI, WriteSource.AskAi),
            // Restored back to what the Builder knew.
            version(8, KNOWN),
            version(7, THEIRS),
            version(6, KNOWN),
          ],
        }),
      ),
    ).toEqual([[WorkflowEditCause.AskAi, "Ask AI's"]]);
  });

  test("the graph known among none of the versions read: up to the first of them is their changes, as it may hold more saves", () => {
    expect(
      shape(
        getStepsSavedElsewhere({
          known: KNOWN,
          server: ASK_AI,
          versions: [version(7, ASK_AI, WriteSource.AskAi), version(6, THEIRS)],
        }),
      ),
    ).toEqual([
      [WorkflowEditCause.TheirChanges, "theirs"],
      [WorkflowEditCause.AskAi, "Ask AI's"],
    ]);

    // Even when the first of them is Ask AI's own.
    expect(
      shape(
        getStepsSavedElsewhere({
          known: KNOWN,
          server: ASK_AI,
          versions: [version(7, ASK_AI, WriteSource.AskAi)],
        }),
      ),
    ).toEqual([[WorkflowEditCause.TheirChanges, "Ask AI's"]]);
  });

  test("no versions at all: what the server has is their changes", () => {
    expect(
      shape(
        getStepsSavedElsewhere({ known: KNOWN, server: ASK_AI, versions: [] }),
      ),
    ).toEqual([[WorkflowEditCause.TheirChanges, "Ask AI's"]]);
  });

  test("a server graph no version holds - its version not written - is their changes, last", () => {
    expect(
      shape(
        getStepsSavedElsewhere({
          known: KNOWN,
          server: AFTER,
          versions: [
            version(7, ASK_AI, WriteSource.AskAi),
            version(6, THEIRS),
            version(5, KNOWN),
          ],
        }),
      ),
    ).toEqual([
      [WorkflowEditCause.TheirChanges, "theirs"],
      [WorkflowEditCause.AskAi, "Ask AI's"],
      [WorkflowEditCause.TheirChanges, "after"],
    ]);
  });

  test("nothing changed: no step", () => {
    expect(
      getStepsSavedElsewhere({
        known: KNOWN,
        server: KNOWN,
        versions: [version(5, KNOWN)],
      }),
    ).toEqual([]);
  });

  test("the last step is always the graph the server has", () => {
    const random: SeededRandom = seededRandom(6274);
    const graphs: Array<SavedWorkflowGraph> = [KNOWN, THEIRS, ASK_AI, AFTER];

    for (let round: number = 0; round < 500; round++) {
      const versions: Array<WorkflowVersionOfSave> = [];
      const count: number = random(6);

      for (let index: number = 0; index < count; index++) {
        versions.push(
          version(
            index + 1,
            graphs[random(graphs.length)]!,
            random(2) === 0 ? WriteSource.AskAi : null,
          ),
        );
      }

      const known: SavedWorkflowGraph = graphs[random(graphs.length)]!;
      const server: SavedWorkflowGraph = graphs[random(graphs.length)]!;
      const steps: Array<WorkflowSavedElsewhereStep> = getStepsSavedElsewhere({
        known,
        server,
        versions,
      });

      if (getWorkflowGraphKey(known) === getWorkflowGraphKey(server)) {
        // Back where it started, or never moved: whatever lies between, Undo returns to it.
        if (steps.length > 0) {
          expect(getWorkflowGraphKey(steps[steps.length - 1]!.graph)).toBe(
            getWorkflowGraphKey(server),
          );
        }
        continue;
      }

      expect({
        round,
        last: getWorkflowGraphKey(steps[steps.length - 1]!.graph),
      }).toEqual({
        round,
        last: getWorkflowGraphKey(server),
      });

      // No step lands where the one before it did, and theirs never sit side by side.
      let previous: string = getWorkflowGraphKey(known);

      for (let index: number = 0; index < steps.length; index++) {
        const key: string = getWorkflowGraphKey(steps[index]!.graph);
        expect({ round, index, same: key === previous }).toEqual({
          round,
          index,
          same: false,
        });
        previous = key;

        if (index > 0) {
          expect({
            round,
            index,
            bothTheirs:
              steps[index]!.cause === WorkflowEditCause.TheirChanges &&
              steps[index - 1]!.cause === WorkflowEditCause.TheirChanges,
          }).toEqual({ round, index, bothTheirs: false });
        }
      }
    }
  });
});
