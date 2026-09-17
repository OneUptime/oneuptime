import { describe, expect, test } from "@jest/globals";
import {
  ExistingStatusPageGroup,
  MAX_GROUP_NESTING_DEPTH,
  ParsedStatusPageGroupRow,
} from "../../FeatureSet/Dashboard/src/Utils/StatusPageGroupCsv";
import {
  CreateStatusPageGroupFunction,
  StatusPageGroupCreateResult,
  StatusPageGroupImportProgress,
  StatusPageGroupImportRowResult,
  StatusPageGroupImportSummary,
  runStatusPageGroupImport,
} from "../../FeatureSet/Dashboard/src/Utils/StatusPageGroupImportRunner";

/*
 * Pins the create loop behind the Status Page > Groups CSV import (the ⋯ >
 * Import from CSV action on the Groups table). The loop is the part that can
 * quietly corrupt a status page: get the ordering wrong and a child is
 * created before its parent exists, get the failure handling wrong and a
 * child whose parent failed silently becomes a top level group on a customer-
 * facing page.
 *
 * The runner never talks to the API — the caller hands it a `createGroup`, so
 * every one of those paths is drivable here without a renderer or a network.
 */

interface CreateCall {
  name: string;
  parentStatusPageGroupId: string | undefined;
}

type MakeRowFunction = (
  overrides: Partial<ParsedStatusPageGroupRow>,
) => ParsedStatusPageGroupRow;

const makeRow: MakeRowFunction = (
  overrides: Partial<ParsedStatusPageGroupRow>,
): ParsedStatusPageGroupRow => {
  return {
    line: 2,
    name: "Group",
    parentName: "",
    description: "",
    isExpandedByDefault: undefined,
    showCurrentStatus: undefined,
    showUptimePercent: undefined,
    uptimePercentPrecision: undefined,
    viewMode: undefined,
    rowAxisLabel: "",
    rowAxisValues: "",
    columnAxisLabel: "",
    columnAxisValues: "",
    ...overrides,
  };
};

type ExistingFunction = (
  name: string,
  depth?: number,
) => ExistingStatusPageGroup;

const existing: ExistingFunction = (
  name: string,
  depth: number = 0,
): ExistingStatusPageGroup => {
  return { id: `existing-${name}`, name: name, depth: depth };
};

/*
 * A createGroup that succeeds for every row, minting a predictable id, and
 * records what it was asked to create. The recorded calls are how the
 * ordering and parent-resolution assertions are made.
 */
interface Recorder {
  createGroup: CreateStatusPageGroupFunction;
  calls: Array<CreateCall>;
}

type RecordingCreatorFunction = (
  outcomeByName?: Record<string, StatusPageGroupCreateResult>,
) => Recorder;

const recordingCreator: RecordingCreatorFunction = (
  outcomeByName: Record<string, StatusPageGroupCreateResult> = {},
): Recorder => {
  const calls: Array<CreateCall> = [];

  return {
    calls: calls,
    createGroup: async (
      row: ParsedStatusPageGroupRow,
      parentStatusPageGroupId: string | undefined,
    ): Promise<StatusPageGroupCreateResult> => {
      calls.push({
        name: row.name,
        parentStatusPageGroupId: parentStatusPageGroupId,
      });

      const configured: StatusPageGroupCreateResult | undefined =
        outcomeByName[row.name];
      if (configured) {
        return configured;
      }

      return { created: true, statusPageGroupId: `id-${row.name}` };
    },
  };
};

type NamesOfFunction = (
  results: Array<StatusPageGroupImportRowResult>,
  status: StatusPageGroupImportRowResult["status"],
) => Array<string>;

const namesOf: NamesOfFunction = (
  results: Array<StatusPageGroupImportRowResult>,
  status: StatusPageGroupImportRowResult["status"],
): Array<string> => {
  return results
    .filter((result: StatusPageGroupImportRowResult) => {
      return result.status === status;
    })
    .map((result: StatusPageGroupImportRowResult) => {
      return result.name;
    });
};

describe("runStatusPageGroupImport — nothing to do", () => {
  test("an empty file creates nothing and reports zeros", async () => {
    const recorder: Recorder = recordingCreator();

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [],
        existingGroups: [],
        createGroup: recorder.createGroup,
      });

    expect(recorder.calls).toEqual([]);
    expect(summary).toEqual({
      results: [],
      createdCount: 0,
      failedCount: 0,
      skippedCount: 0,
      totalToCreate: 0,
    });
  });

  test("progress is still reported once, so a caller can render the total", async () => {
    const progress: Array<StatusPageGroupImportProgress> = [];

    await runStatusPageGroupImport({
      rows: [],
      existingGroups: [],
      createGroup: recordingCreator().createGroup,
      onProgress: (tick: StatusPageGroupImportProgress) => {
        progress.push(tick);
      },
    });

    expect(progress).toEqual([
      { results: [], createdCount: 0, totalToCreate: 0 },
    ]);
  });
});

describe("runStatusPageGroupImport — ordering", () => {
  test("top level groups are created with no parent id", async () => {
    const recorder: Recorder = recordingCreator();

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          makeRow({ line: 2, name: "Core" }),
          makeRow({ line: 3, name: "Edge" }),
        ],
        existingGroups: [],
        createGroup: recorder.createGroup,
      });

    expect(recorder.calls).toEqual([
      { name: "Core", parentStatusPageGroupId: undefined },
      { name: "Edge", parentStatusPageGroupId: undefined },
    ]);
    expect(summary.createdCount).toBe(2);
    expect(summary.totalToCreate).toBe(2);
  });

  test("a parent later in the file is still created before its child", async () => {
    const recorder: Recorder = recordingCreator();

    await runStatusPageGroupImport({
      // Child first — the file order is deliberately the wrong order.
      rows: [
        makeRow({ line: 2, name: "API", parentName: "Core" }),
        makeRow({ line: 3, name: "Core" }),
      ],
      existingGroups: [],
      createGroup: recorder.createGroup,
    });

    expect(recorder.calls).toEqual([
      { name: "Core", parentStatusPageGroupId: undefined },
      { name: "API", parentStatusPageGroupId: "id-Core" },
    ]);
  });

  test("a three-level chain resolves each level against the one above it", async () => {
    const recorder: Recorder = recordingCreator();

    await runStatusPageGroupImport({
      rows: [
        makeRow({ line: 2, name: "Auth DB", parentName: "API" }),
        makeRow({ line: 3, name: "API", parentName: "Core" }),
        makeRow({ line: 4, name: "Core" }),
      ],
      existingGroups: [],
      createGroup: recorder.createGroup,
    });

    expect(recorder.calls).toEqual([
      { name: "Core", parentStatusPageGroupId: undefined },
      { name: "API", parentStatusPageGroupId: "id-Core" },
      { name: "Auth DB", parentStatusPageGroupId: "id-API" },
    ]);
  });

  test("a parent already on the status page is not re-created", async () => {
    const recorder: Recorder = recordingCreator();

    await runStatusPageGroupImport({
      rows: [makeRow({ line: 2, name: "API", parentName: "Core" })],
      existingGroups: [existing("Core")],
      createGroup: recorder.createGroup,
    });

    expect(recorder.calls).toEqual([
      { name: "API", parentStatusPageGroupId: "existing-Core" },
    ]);
  });

  /*
   * StatusPageGroupService renumbers every sibling on each create, so two
   * in-flight creates would race on `order` and leave the page in an order
   * nobody asked for.
   */
  test("creates run one at a time, never concurrently", async () => {
    let inFlight: number = 0;
    let maxInFlight: number = 0;

    const createGroup: CreateStatusPageGroupFunction = async (
      row: ParsedStatusPageGroupRow,
    ): Promise<StatusPageGroupCreateResult> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
      inFlight--;
      return { created: true, statusPageGroupId: `id-${row.name}` };
    };

    await runStatusPageGroupImport({
      rows: [
        makeRow({ line: 2, name: "A" }),
        makeRow({ line: 3, name: "B" }),
        makeRow({ line: 4, name: "C" }),
      ],
      existingGroups: [],
      createGroup: createGroup,
    });

    expect(maxInFlight).toBe(1);
  });
});

describe("runStatusPageGroupImport — rows that can never be created", () => {
  test("a name already on the page is skipped before any request", async () => {
    const recorder: Recorder = recordingCreator();

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          makeRow({ line: 2, name: "Core" }),
          makeRow({ line: 3, name: "Edge" }),
        ],
        existingGroups: [existing("Core")],
        createGroup: recorder.createGroup,
      });

    expect(recorder.calls).toEqual([
      { name: "Edge", parentStatusPageGroupId: undefined },
    ]);
    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0]).toEqual({
      line: 2,
      name: "Core",
      status: "skipped",
      message: 'A group named "Core" already exists on this status page.',
    });
  });

  test("an unresolvable parent is skipped and reported", async () => {
    const recorder: Recorder = recordingCreator();

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [makeRow({ line: 2, name: "Orphan", parentName: "Nowhere" })],
        existingGroups: [],
        createGroup: recorder.createGroup,
      });

    expect(recorder.calls).toEqual([]);
    expect(summary.results).toEqual([
      {
        line: 2,
        name: "Orphan",
        status: "skipped",
        message:
          'Parent group "Nowhere" was not found in the file or on this status page.',
      },
    ]);
    expect(summary.totalToCreate).toBe(0);
  });

  test("a parent cycle is skipped rather than looping forever", async () => {
    const recorder: Recorder = recordingCreator();

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          makeRow({ line: 2, name: "A", parentName: "B" }),
          makeRow({ line: 3, name: "B", parentName: "A" }),
        ],
        existingGroups: [],
        createGroup: recorder.createGroup,
      });

    expect(recorder.calls).toEqual([]);
    expect(summary.skippedCount).toBe(2);
    expect(summary.createdCount).toBe(0);
  });

  /*
   * The server rejects a group nested past the limit, so sending it would
   * cost a round trip and come back as an opaque failure. It is reported as
   * a skip with the reason instead — and exactly once.
   */
  test("a row past the nesting limit is skipped without a request", async () => {
    const recorder: Recorder = recordingCreator();

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [makeRow({ line: 2, name: "Too Deep", parentName: "Deep" })],
        existingGroups: [existing("Deep", MAX_GROUP_NESTING_DEPTH - 1)],
        createGroup: recorder.createGroup,
      });

    expect(recorder.calls).toEqual([]);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]!.status).toBe("skipped");
    expect(summary.results[0]!.message).toContain("levels deep");
  });

  test("skipped rows do not count toward the progress total", async () => {
    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          makeRow({ line: 2, name: "Orphan", parentName: "Nowhere" }),
          makeRow({ line: 3, name: "Core" }),
        ],
        existingGroups: [],
        createGroup: recordingCreator().createGroup,
      });

    expect(summary.totalToCreate).toBe(1);
  });
});

describe("runStatusPageGroupImport — partial failure", () => {
  test("a failed row is reported with its message and does not stop the run", async () => {
    const recorder: Recorder = recordingCreator({
      Edge: { created: false, errorMessage: "Name is not unique." },
    });

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          makeRow({ line: 2, name: "Core" }),
          makeRow({ line: 3, name: "Edge" }),
          makeRow({ line: 4, name: "Partners" }),
        ],
        existingGroups: [],
        createGroup: recorder.createGroup,
      });

    expect(namesOf(summary.results, "created")).toEqual(["Core", "Partners"]);
    expect(summary.results[1]).toEqual({
      line: 3,
      name: "Edge",
      status: "failed",
      message: "Name is not unique.",
    });
    expect(summary).toMatchObject({
      createdCount: 2,
      failedCount: 1,
      skippedCount: 0,
      totalToCreate: 3,
    });
  });

  /*
   * The defect this guards: without the parent-id check the child would be
   * created anyway, with no parentStatusPageGroupId — a sub group silently
   * promoted to the top level of a public status page instead of a reported
   * skip.
   */
  test("children of a failed parent are skipped, not created at the top level", async () => {
    const recorder: Recorder = recordingCreator({
      Core: { created: false, errorMessage: "Boom." },
    });

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          makeRow({ line: 2, name: "Core" }),
          makeRow({ line: 3, name: "API", parentName: "Core" }),
        ],
        existingGroups: [],
        createGroup: recorder.createGroup,
      });

    expect(recorder.calls).toEqual([
      { name: "Core", parentStatusPageGroupId: undefined },
    ]);
    expect(summary.results).toEqual([
      { line: 2, name: "Core", status: "failed", message: "Boom." },
      {
        line: 3,
        name: "API",
        status: "skipped",
        message: 'Parent group "Core" could not be created.',
      },
    ]);
  });

  test("a grandchild of a failed parent is skipped too", async () => {
    const recorder: Recorder = recordingCreator({
      Core: { created: false, errorMessage: "Boom." },
    });

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          makeRow({ line: 2, name: "Core" }),
          makeRow({ line: 3, name: "API", parentName: "Core" }),
          makeRow({ line: 4, name: "Auth DB", parentName: "API" }),
        ],
        existingGroups: [],
        createGroup: recorder.createGroup,
      });

    expect(namesOf(summary.results, "skipped")).toEqual(["API", "Auth DB"]);
    expect(summary.createdCount).toBe(0);
  });

  /*
   * A create that reports success but hands back no id leaves the child with
   * nothing to point at. Treating that as "parent could not be created" is
   * the same safe answer as an outright failure.
   */
  test("a create that returns no id still blocks its children", async () => {
    const recorder: Recorder = recordingCreator({
      Core: { created: true, statusPageGroupId: undefined },
    });

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          makeRow({ line: 2, name: "Core" }),
          makeRow({ line: 3, name: "API", parentName: "Core" }),
        ],
        existingGroups: [],
        createGroup: recorder.createGroup,
      });

    expect(namesOf(summary.results, "created")).toEqual(["Core"]);
    expect(summary.results[1]).toMatchObject({
      name: "API",
      status: "skipped",
      message: 'Parent group "Core" could not be created.',
    });
  });

  test("an unexpected throw lands on the row, not on the run", async () => {
    const createGroup: CreateStatusPageGroupFunction = async (
      row: ParsedStatusPageGroupRow,
    ): Promise<StatusPageGroupCreateResult> => {
      if (row.name === "Edge") {
        throw new Error("Network is down.");
      }
      return { created: true, statusPageGroupId: `id-${row.name}` };
    };

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          makeRow({ line: 2, name: "Core" }),
          makeRow({ line: 3, name: "Edge" }),
          makeRow({ line: 4, name: "Partners" }),
        ],
        existingGroups: [],
        createGroup: createGroup,
      });

    expect(summary.results[1]).toEqual({
      line: 3,
      name: "Edge",
      status: "failed",
      message: "Network is down.",
    });
    expect(namesOf(summary.results, "created")).toEqual(["Core", "Partners"]);
  });

  test.each([
    ["a bare string", "not an error object"],
    ["an Error with an empty message", new Error("")],
  ])("%s still reads as a failure", async (_label: string, thrown: unknown) => {
    const createGroup: CreateStatusPageGroupFunction =
      (): Promise<StatusPageGroupCreateResult> => {
        throw thrown;
      };

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [makeRow({ line: 2, name: "Core" })],
        existingGroups: [],
        createGroup: createGroup,
      });

    expect(summary.results).toEqual([
      {
        line: 2,
        name: "Core",
        status: "failed",
        message: "Something went wrong while creating this group.",
      },
    ]);
    expect(summary.failedCount).toBe(1);
  });
});

describe("runStatusPageGroupImport — progress reporting", () => {
  test("reports the up-front skips before the first create", async () => {
    const progress: Array<StatusPageGroupImportProgress> = [];

    await runStatusPageGroupImport({
      rows: [
        makeRow({ line: 2, name: "Core" }),
        makeRow({ line: 3, name: "Edge" }),
      ],
      existingGroups: [existing("Core")],
      createGroup: recordingCreator().createGroup,
      onProgress: (tick: StatusPageGroupImportProgress) => {
        progress.push(tick);
      },
    });

    expect(progress[0]).toEqual({
      results: [
        {
          line: 2,
          name: "Core",
          status: "skipped",
          message: 'A group named "Core" already exists on this status page.',
        },
      ],
      createdCount: 0,
      totalToCreate: 1,
    });
  });

  test("ticks once per attempted row, with a running created count", async () => {
    const progress: Array<StatusPageGroupImportProgress> = [];

    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          makeRow({ line: 2, name: "A" }),
          makeRow({ line: 3, name: "B" }),
          makeRow({ line: 4, name: "C" }),
        ],
        existingGroups: [],
        createGroup: recordingCreator().createGroup,
        onProgress: (tick: StatusPageGroupImportProgress) => {
          progress.push(tick);
        },
      });

    // One up-front tick plus one per row.
    expect(progress).toHaveLength(4);
    expect(
      progress.map((tick: StatusPageGroupImportProgress) => {
        return tick.createdCount;
      }),
    ).toEqual([0, 1, 2, 3]);
    expect(progress[progress.length - 1]!.results).toEqual(summary.results);
  });

  test("a skipped child ticks too, so the results table stays live", async () => {
    const progress: Array<StatusPageGroupImportProgress> = [];

    await runStatusPageGroupImport({
      rows: [
        makeRow({ line: 2, name: "Core" }),
        makeRow({ line: 3, name: "API", parentName: "Core" }),
      ],
      existingGroups: [],
      createGroup: recordingCreator({
        Core: { created: false, errorMessage: "Boom." },
      }).createGroup,
      onProgress: (tick: StatusPageGroupImportProgress) => {
        progress.push(tick);
      },
    });

    expect(progress).toHaveLength(3);
    expect(progress[2]!.results[1]!.status).toBe("skipped");
  });

  /*
   * A React caller stores the tick's array straight into state, so reusing
   * one array would leave the results table on a stale render.
   */
  test("each tick carries its own array", async () => {
    const progress: Array<StatusPageGroupImportProgress> = [];

    await runStatusPageGroupImport({
      rows: [makeRow({ line: 2, name: "A" }), makeRow({ line: 3, name: "B" })],
      existingGroups: [],
      createGroup: recordingCreator().createGroup,
      onProgress: (tick: StatusPageGroupImportProgress) => {
        progress.push(tick);
      },
    });

    expect(progress[1]!.results).not.toBe(progress[2]!.results);
    // The earlier snapshot must not have grown after the fact.
    expect(progress[1]!.results).toHaveLength(1);
  });

  test("progress is optional", async () => {
    await expect(
      runStatusPageGroupImport({
        rows: [makeRow({ line: 2, name: "A" })],
        existingGroups: [],
        createGroup: recordingCreator().createGroup,
      }),
    ).resolves.toMatchObject({ createdCount: 1 });
  });
});

describe("runStatusPageGroupImport — the caller's inputs are inputs", () => {
  test("the existing-groups list is not mutated", async () => {
    const existingGroups: Array<ExistingStatusPageGroup> = [existing("Core")];
    const before: string = JSON.stringify(existingGroups);

    await runStatusPageGroupImport({
      rows: [makeRow({ line: 2, name: "API", parentName: "Core" })],
      existingGroups: existingGroups,
      createGroup: recordingCreator().createGroup,
    });

    expect(JSON.stringify(existingGroups)).toBe(before);
  });

  test("the parsed rows are not mutated", async () => {
    const rows: Array<ParsedStatusPageGroupRow> = [
      makeRow({ line: 2, name: "Core" }),
      makeRow({ line: 3, name: "API", parentName: "Core" }),
    ];
    const before: string = JSON.stringify(rows);

    await runStatusPageGroupImport({
      rows: rows,
      existingGroups: [],
      createGroup: recordingCreator().createGroup,
    });

    expect(JSON.stringify(rows)).toBe(before);
  });

  /*
   * Every field the parser produced has to reach createGroup untouched — the
   * runner's job is ordering, not editing.
   */
  test("the row handed to createGroup is the parsed row itself", async () => {
    const row: ParsedStatusPageGroupRow = makeRow({
      line: 7,
      name: "Regions",
      description: "By region",
      isExpandedByDefault: false,
      showUptimePercent: true,
      rowAxisValues: "Auth, API",
    });

    let seen: ParsedStatusPageGroupRow | null = null;

    await runStatusPageGroupImport({
      rows: [row],
      existingGroups: [],
      createGroup: async (
        received: ParsedStatusPageGroupRow,
      ): Promise<StatusPageGroupCreateResult> => {
        seen = received;
        return { created: true, statusPageGroupId: "id-Regions" };
      },
    });

    expect(seen).toBe(row);
  });
});

describe("runStatusPageGroupImport — the summary adds up", () => {
  test("every row lands in exactly one bucket", async () => {
    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          // created
          makeRow({ line: 2, name: "Core" }),
          // failed
          makeRow({ line: 3, name: "Edge" }),
          // skipped: parent failed
          makeRow({ line: 4, name: "CDN", parentName: "Edge" }),
          // skipped: already exists
          makeRow({ line: 5, name: "Partners" }),
          // skipped: parent is nowhere
          makeRow({ line: 6, name: "Orphan", parentName: "Nowhere" }),
        ],
        existingGroups: [existing("Partners")],
        createGroup: recordingCreator({
          Edge: { created: false, errorMessage: "Boom." },
        }).createGroup,
      });

    expect(summary.createdCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.skippedCount).toBe(3);
    expect(summary.results).toHaveLength(5);
    expect(
      summary.createdCount + summary.failedCount + summary.skippedCount,
    ).toBe(summary.results.length);
    // Only the rows the plan intended to create are in the progress total.
    expect(summary.totalToCreate).toBe(3);
  });

  test("every result keeps the CSV line it came from", async () => {
    const summary: StatusPageGroupImportSummary =
      await runStatusPageGroupImport({
        rows: [
          makeRow({ line: 7, name: "API", parentName: "Core" }),
          makeRow({ line: 9, name: "Core" }),
        ],
        existingGroups: [],
        createGroup: recordingCreator().createGroup,
      });

    expect(
      summary.results.map((result: StatusPageGroupImportRowResult) => {
        return [result.name, result.line];
      }),
    ).toEqual([
      ["Core", 9],
      ["API", 7],
    ]);
  });
});
