import { describe, expect, test } from "@jest/globals";
import {
  WorkflowVersionSeen,
  WorkflowVersionWrite,
  WorkflowVersionWriteKind,
  decideWorkflowVersionWrite,
  doesNewestVersionTakeInSave,
  getOldestWorkflowVersionKept,
} from "../../../../Server/Utils/Workflow/WorkflowVersionPolicy";
import {
  WORKFLOW_VERSIONS_KEPT,
  WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS,
  WORKFLOW_VERSION_TYPES,
  WorkflowVersionType,
  isWorkflowVersionType,
} from "../../../../Types/Workflow/WorkflowVersion";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import WriteSource from "../../../../Types/BaseDatabase/WriteSource";

/*
 * What a save of a workflow's graph does to its version history (issue
 * #6188): nothing, a version of its own, or the newest version taking it in.
 */

const NOW: Date = new Date("2026-11-07T12:00:00.000Z");
const ALICE: string = "0198c8ec-2a1d-7f0c-9e75-0000000a11ce";
const BOB: string = "0198c8ec-2a1d-7f0c-9e75-000000000b0b";

const ago: (milliseconds: number) => Date = (milliseconds: number): Date => {
  return new Date(NOW.getTime() - milliseconds);
};

const newest: (
  overrides?: Partial<WorkflowVersionSeen>,
) => WorkflowVersionSeen = (
  overrides: Partial<WorkflowVersionSeen> = {},
): WorkflowVersionSeen => {
  return {
    versionNumber: 7,
    versionType: WorkflowVersionType.Changed,
    graphFingerprint: "fingerprint-7",
    savedByUserId: ALICE,
    createdAt: ago(60 * 1000),
    ...overrides,
  };
};

const decide: (data: {
  newest?: WorkflowVersionSeen | null | undefined;
  graphFingerprint?: string | undefined;
  earlier?: number | null | undefined;
  savedBy?: string | null | undefined;
  savedThrough?: WriteSource | null | undefined;
  now?: Date | undefined;
}) => WorkflowVersionWrite = (data: {
  newest?: WorkflowVersionSeen | null | undefined;
  graphFingerprint?: string | undefined;
  earlier?: number | null | undefined;
  savedBy?: string | null | undefined;
  savedThrough?: WriteSource | null | undefined;
  now?: Date | undefined;
}): WorkflowVersionWrite => {
  return decideWorkflowVersionWrite({
    newest: data.newest === undefined ? newest() : data.newest,
    graphFingerprint: data.graphFingerprint || "fingerprint-new",
    earlierWithSameGraph:
      typeof data.earlier === "number" ? { versionNumber: data.earlier } : null,
    savedByUserId: data.savedBy === undefined ? ALICE : data.savedBy,
    savedThrough: data.savedThrough,
    now: data.now || NOW,
  });
};

describe("a save of the graph the newest version has", () => {
  test("is no version: a card selected, a graph saved again", () => {
    expect(decide({ graphFingerprint: "fingerprint-7" })).toEqual({
      kind: WorkflowVersionWriteKind.Nothing,
    });
  });

  test("is no version even when an earlier version had that graph too", () => {
    expect(decide({ graphFingerprint: "fingerprint-7", earlier: 3 })).toEqual({
      kind: WorkflowVersionWriteKind.Nothing,
    });
  });

  test("whoever saves it, whenever", () => {
    expect(
      decide({
        graphFingerprint: "fingerprint-7",
        savedBy: BOB,
        now: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
      }).kind,
    ).toBe(WorkflowVersionWriteKind.Nothing);
  });
});

describe("a save that puts back an earlier version's graph", () => {
  test("is a Restored version naming it, numbered after the newest", () => {
    expect(decide({ earlier: 3 })).toEqual({
      kind: WorkflowVersionWriteKind.Add,
      versionNumber: 8,
      versionType: WorkflowVersionType.Restored,
      restoredFromVersionNumber: 3,
    });
  });

  test("is never taken into the newest version, even by the person in the middle of a burst", () => {
    expect(
      decide({ earlier: 6, newest: newest({ createdAt: ago(1000) }) }).kind,
    ).toBe(WorkflowVersionWriteKind.Add);
  });

  test("an 'earlier' version that is not older than the newest is no restore", () => {
    expect(decide({ earlier: 7 })).toEqual({
      kind: WorkflowVersionWriteKind.TakeIntoNewest,
    });
    expect(decide({ earlier: 9, savedBy: BOB })).toEqual({
      kind: WorkflowVersionWriteKind.Add,
      versionNumber: 8,
      versionType: WorkflowVersionType.Changed,
      restoredFromVersionNumber: null,
    });
  });
});

describe("the newest version takes in the next save", () => {
  test("by the same person, within the grouping window of its first save", () => {
    expect(decide({})).toEqual({
      kind: WorkflowVersionWriteKind.TakeIntoNewest,
    });
  });

  test("right up to the end of the window, and not at it", () => {
    expect(
      decide({
        newest: newest({
          createdAt: ago(WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS - 1),
        }),
      }).kind,
    ).toBe(WorkflowVersionWriteKind.TakeIntoNewest);
    expect(
      decide({
        newest: newest({
          createdAt: ago(WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS),
        }),
      }),
    ).toEqual({
      kind: WorkflowVersionWriteKind.Add,
      versionNumber: 8,
      versionType: WorkflowVersionType.Changed,
      restoredFromVersionNumber: null,
    });
  });

  test("not by someone else: every person's changes are their own version", () => {
    expect(decide({ savedBy: BOB }).kind).toBe(WorkflowVersionWriteKind.Add);
  });

  test("not through the API, which saves as nobody", () => {
    expect(decide({ savedBy: null }).kind).toBe(WorkflowVersionWriteKind.Add);
    expect(
      decide({
        savedBy: null,
        newest: newest({ savedByUserId: null }),
      }).kind,
    ).toBe(WorkflowVersionWriteKind.Add);
  });

  test.each([
    WorkflowVersionType.Created,
    WorkflowVersionType.Restored,
    WorkflowVersionType.Earlier,
  ])("not into a %s version, which stays as it was", (versionType: string) => {
    expect(decide({ newest: newest({ versionType: versionType }) })).toEqual({
      kind: WorkflowVersionWriteKind.Add,
      versionNumber: 8,
      versionType: WorkflowVersionType.Changed,
      restoredFromVersionNumber: null,
    });
  });

  test("not into a version with no time, nor one stamped after now (a clock that moved back)", () => {
    expect(decide({ newest: newest({ createdAt: undefined }) }).kind).toBe(
      WorkflowVersionWriteKind.Add,
    );
    expect(
      decide({
        newest: newest({ createdAt: new Date(NOW.getTime() + 1000) }),
      }).kind,
    ).toBe(WorkflowVersionWriteKind.Add);
  });

  test("doesNewestVersionTakeInSave says the same", () => {
    expect(
      doesNewestVersionTakeInSave({
        newest: newest(),
        savedByUserId: ALICE,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      doesNewestVersionTakeInSave({
        newest: newest(),
        savedByUserId: BOB,
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("a workflow with no version yet", () => {
  test("gets version 1, of its changes", () => {
    expect(decide({ newest: null })).toEqual({
      kind: WorkflowVersionWriteKind.Add,
      versionNumber: 1,
      versionType: WorkflowVersionType.Changed,
      restoredFromVersionNumber: null,
    });
  });
});

describe("property: what a save does follows the order of the rules", () => {
  test("over 2000 seeded saves", () => {
    const random: SeededRandom = seededRandom(6188);
    const people: Array<string | null> = [ALICE, BOB, null];
    const fingerprints: Array<string> = ["a", "b", "c", "d"];

    for (let attempt: number = 0; attempt < 2000; attempt++) {
      const seen: WorkflowVersionSeen = {
        versionNumber: 1 + random(150),
        versionType:
          WORKFLOW_VERSION_TYPES[random(WORKFLOW_VERSION_TYPES.length)],
        graphFingerprint: fingerprints[random(fingerprints.length)],
        savedByUserId: people[random(people.length)] as string | null,
        createdAt: ago(random(2 * WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS)),
      };
      const fingerprint: string = fingerprints[
        random(fingerprints.length)
      ] as string;
      const earlier: number | null =
        random(2) === 0 ? 1 + random(seen.versionNumber + 3) : null;
      const savedBy: string | null = people[random(people.length)] as
        | string
        | null;

      const write: WorkflowVersionWrite = decideWorkflowVersionWrite({
        newest: seen,
        graphFingerprint: fingerprint,
        earlierWithSameGraph:
          earlier === null ? null : { versionNumber: earlier },
        savedByUserId: savedBy,
        now: NOW,
      });

      if (fingerprint === seen.graphFingerprint) {
        expect(write.kind).toBe(WorkflowVersionWriteKind.Nothing);
        continue;
      }

      if (earlier !== null && earlier < seen.versionNumber) {
        expect(write).toEqual({
          kind: WorkflowVersionWriteKind.Add,
          versionNumber: seen.versionNumber + 1,
          versionType: WorkflowVersionType.Restored,
          restoredFromVersionNumber: earlier,
        });
        continue;
      }

      const takesIn: boolean =
        seen.versionType === WorkflowVersionType.Changed &&
        savedBy !== null &&
        savedBy === seen.savedByUserId &&
        NOW.getTime() - (seen.createdAt as Date).getTime() <
          WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS;

      if (takesIn) {
        expect(write.kind).toBe(WorkflowVersionWriteKind.TakeIntoNewest);
      } else {
        expect(write).toEqual({
          kind: WorkflowVersionWriteKind.Add,
          versionNumber: seen.versionNumber + 1,
          versionType: WorkflowVersionType.Changed,
          restoredFromVersionNumber: null,
        });
      }
    }
  });
});

describe("how many versions are kept", () => {
  test("the newest ones: below the oldest kept goes", () => {
    expect(getOldestWorkflowVersionKept(250)).toBe(
      250 - WORKFLOW_VERSIONS_KEPT + 1,
    );
    expect(getOldestWorkflowVersionKept(WORKFLOW_VERSIONS_KEPT)).toBe(1);
  });

  test("never below version 1, however few have been written", () => {
    expect(getOldestWorkflowVersionKept(1)).toBe(1);
    expect(getOldestWorkflowVersionKept(5)).toBe(1);
  });

  test("keeps at least the newest, whatever is asked", () => {
    expect(getOldestWorkflowVersionKept(10, 0)).toBe(10);
    expect(getOldestWorkflowVersionKept(10, 3)).toBe(8);
  });

  test("a sensible retention: a hundred versions", () => {
    expect(WORKFLOW_VERSIONS_KEPT).toBe(100);
    expect(WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS).toBe(10 * 60 * 1000);
  });
});

describe("the version types", () => {
  test("are told apart from anything else", () => {
    for (const versionType of WORKFLOW_VERSION_TYPES) {
      expect(isWorkflowVersionType(versionType)).toBe(true);
    }

    for (const value of ["changed", "", null, undefined, 3, {}]) {
      expect(isWorkflowVersionType(value)).toBe(false);
    }
  });
});

/*
 * ASK AI'S CHANGES ARE VERSIONS OF THEIR OWN (issue #6258). Ask AI saves a
 * workflow as the person who asked, so by person alone a change of its made
 * within the window of the person's last edit was folded into the person's
 * version: there was no version from just before it to restore, and the
 * version said the person made it.
 */
const NEW_VERSION: WorkflowVersionWrite = {
  kind: WorkflowVersionWriteKind.Add,
  versionNumber: 8,
  versionType: WorkflowVersionType.Changed,
  restoredFromVersionNumber: null,
};

describe("Ask AI's changes are versions of their own", () => {
  test("a change Ask AI saves for the person is never taken into the person's own version", () => {
    // The very burst it would have joined: same person, a minute in.
    expect(decide({ savedThrough: WriteSource.AskAi })).toEqual(NEW_VERSION);
    expect(
      decide({
        savedThrough: WriteSource.AskAi,
        newest: newest({ createdAt: ago(1) }),
      }),
    ).toEqual(NEW_VERSION);
  });

  test("the person's next edit is never taken into Ask AI's version", () => {
    expect(
      decide({ newest: newest({ savedThrough: WriteSource.AskAi }) }),
    ).toEqual(NEW_VERSION);
    expect(
      decide({
        newest: newest({ savedThrough: WriteSource.AskAi, createdAt: ago(1) }),
      }),
    ).toEqual(NEW_VERSION);
  });

  test("nor is Ask AI's next change: each one can be undone on its own", () => {
    expect(
      decide({
        savedThrough: WriteSource.AskAi,
        newest: newest({ savedThrough: WriteSource.AskAi }),
      }),
    ).toEqual(NEW_VERSION);
  });

  test("the person's own saves after that are one version again", () => {
    // Version 8 is Ask AI's; version 9, the person's, takes in their next save.
    expect(
      decide({
        newest: newest({ versionNumber: 9, savedThrough: null }),
      }),
    ).toEqual({ kind: WorkflowVersionWriteKind.TakeIntoNewest });
  });

  test("Ask AI putting back an earlier version's graph is a Restored version, as anyone's", () => {
    expect(decide({ savedThrough: WriteSource.AskAi, earlier: 3 })).toEqual({
      kind: WorkflowVersionWriteKind.Add,
      versionNumber: 8,
      versionType: WorkflowVersionType.Restored,
      restoredFromVersionNumber: 3,
    });
  });

  test("Ask AI saving the newest version's graph again is no version", () => {
    expect(
      decide({
        savedThrough: WriteSource.AskAi,
        graphFingerprint: "fingerprint-7",
      }),
    ).toEqual({ kind: WorkflowVersionWriteKind.Nothing });
  });

  test("Ask AI's first change of a workflow with no version yet is version 1", () => {
    expect(decide({ savedThrough: WriteSource.AskAi, newest: null })).toEqual({
      kind: WorkflowVersionWriteKind.Add,
      versionNumber: 1,
      versionType: WorkflowVersionType.Changed,
      restoredFromVersionNumber: null,
    });
  });

  test("doesNewestVersionTakeInSave says the same", () => {
    for (const [seen, save, takesIn] of [
      [null, null, true],
      [null, WriteSource.AskAi, false],
      [WriteSource.AskAi, null, false],
      [WriteSource.AskAi, WriteSource.AskAi, false],
    ] as Array<[WriteSource | null, WriteSource | null, boolean]>) {
      expect({
        seen,
        save,
        takesIn: doesNewestVersionTakeInSave({
          newest: newest({ savedThrough: seen }),
          savedByUserId: ALICE,
          savedThrough: save,
          now: NOW,
        }),
      }).toEqual({ seen, save, takesIn });
    }
  });
});

describe("property: Ask AI's changes, and everyone else's grouped exactly as before", () => {
  // The rule before issue #6258, written out: by person, window and type alone.
  const takenInBefore: (data: {
    seen: WorkflowVersionSeen;
    savedBy: string | null;
  }) => boolean = (data: {
    seen: WorkflowVersionSeen;
    savedBy: string | null;
  }): boolean => {
    const age: number = NOW.getTime() - (data.seen.createdAt as Date).getTime();

    return (
      data.seen.versionType === WorkflowVersionType.Changed &&
      data.savedBy !== null &&
      data.savedBy === data.seen.savedByUserId &&
      age >= 0 &&
      age < WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS
    );
  };

  test("over 6000 seeded saves", () => {
    const random: SeededRandom = seededRandom(6258);
    const people: Array<string | null> = [ALICE, BOB, null];
    const sources: Array<WriteSource | null | undefined> = [
      null,
      undefined,
      WriteSource.AskAi,
    ];
    const fingerprints: Array<string> = ["a", "b", "c", "d"];
    let askAiSaves: number = 0;
    let keptApart: number = 0;

    for (let attempt: number = 0; attempt < 6000; attempt++) {
      const seen: WorkflowVersionSeen = {
        versionNumber: 1 + random(150),
        versionType:
          WORKFLOW_VERSION_TYPES[random(WORKFLOW_VERSION_TYPES.length)],
        graphFingerprint: fingerprints[random(fingerprints.length)],
        savedByUserId: people[random(people.length)] as string | null,
        savedThrough: sources[random(sources.length)],
        createdAt: ago(random(2 * WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS)),
      };
      const fingerprint: string = fingerprints[
        random(fingerprints.length)
      ] as string;
      const earlier: number | null =
        random(2) === 0 ? 1 + random(seen.versionNumber + 3) : null;
      const savedBy: string | null = people[random(people.length)] as
        | string
        | null;
      const savedThrough: WriteSource | null | undefined =
        sources[random(sources.length)];

      const write: WorkflowVersionWrite = decideWorkflowVersionWrite({
        newest: seen,
        graphFingerprint: fingerprint,
        earlierWithSameGraph:
          earlier === null ? null : { versionNumber: earlier },
        savedByUserId: savedBy,
        savedThrough,
        now: NOW,
      });

      const isAskAiInvolved: boolean = Boolean(
        savedThrough || seen.savedThrough,
      );

      if (savedThrough) {
        askAiSaves++;
      }

      // Ask AI's change never joins anything, and nothing joins it.
      if (isAskAiInvolved) {
        expect(write.kind).not.toBe(WorkflowVersionWriteKind.TakeIntoNewest);

        if (
          takenInBefore({ seen, savedBy }) &&
          fingerprint !== seen.graphFingerprint &&
          !(earlier !== null && earlier < seen.versionNumber)
        ) {
          keptApart++;
        }

        continue;
      }

      // Everyone else's saves are decided exactly as before.
      const before: WorkflowVersionWrite = decideWorkflowVersionWrite({
        newest: { ...seen, savedThrough: undefined },
        graphFingerprint: fingerprint,
        earlierWithSameGraph:
          earlier === null ? null : { versionNumber: earlier },
        savedByUserId: savedBy,
        now: NOW,
      });

      expect(write).toEqual(before);

      if (
        fingerprint !== seen.graphFingerprint &&
        !(earlier !== null && earlier < seen.versionNumber)
      ) {
        expect(write.kind === WorkflowVersionWriteKind.TakeIntoNewest).toBe(
          takenInBefore({ seen, savedBy }),
        );
      }
    }

    // Not vacuous: many of Ask AI's saves, and many it would once have been folded into.
    expect(askAiSaves).toBeGreaterThan(1000);
    expect(keptApart).toBeGreaterThan(20);
  });
});
