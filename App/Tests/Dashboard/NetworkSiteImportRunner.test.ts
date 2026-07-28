import { describe, expect, test } from "@jest/globals";
import { ParsedSiteRow } from "../../FeatureSet/Dashboard/src/Utils/NetworkSiteCsv";
import {
  CreateSiteFunction,
  SiteCreateResult,
  SiteImportProgress,
  SiteImportRowResult,
  SiteImportSummary,
  runSiteImport,
} from "../../FeatureSet/Dashboard/src/Utils/NetworkSiteImportRunner";

/*
 * Pins the create loop behind the Network Sites CSV import (the ⋯ > Import
 * from CSV action on the Sites table). The loop is the part that can quietly
 * corrupt a hierarchy: get the ordering wrong and a child is created before
 * its parent exists, get the failure handling wrong and a child whose parent
 * failed is silently created as a root site.
 *
 * The runner never talks to the API — the caller hands it a `createSite`, so
 * every one of those paths is drivable here without a renderer or a network.
 */

interface CreateCall {
  name: string;
  parentSiteId: string | undefined;
}

type MakeRowFunction = (overrides: Partial<ParsedSiteRow>) => ParsedSiteRow;

const makeRow: MakeRowFunction = (
  overrides: Partial<ParsedSiteRow>,
): ParsedSiteRow => {
  return {
    line: 2,
    name: "Site",
    networkSiteTypeId: "type-unit",
    siteType: "Unit",
    parentName: "",
    address: "",
    latitude: undefined,
    longitude: undefined,
    ...overrides,
  };
};

/*
 * A createSite that succeeds for every row, minting a predictable id, and
 * records what it was asked to create. The recorded calls are how the
 * ordering and parent-resolution assertions are made.
 */
interface Recorder {
  createSite: CreateSiteFunction;
  calls: Array<CreateCall>;
}

type RecordingCreatorFunction = (
  outcomeByName?: Record<string, SiteCreateResult>,
) => Recorder;

const recordingCreator: RecordingCreatorFunction = (
  outcomeByName: Record<string, SiteCreateResult> = {},
): Recorder => {
  const calls: Array<CreateCall> = [];

  return {
    calls: calls,
    createSite: async (
      row: ParsedSiteRow,
      parentSiteId: string | undefined,
    ): Promise<SiteCreateResult> => {
      calls.push({ name: row.name, parentSiteId: parentSiteId });

      const configured: SiteCreateResult | undefined = outcomeByName[row.name];
      if (configured) {
        return configured;
      }

      return { created: true, siteId: `id-${row.name}` };
    },
  };
};

type NamesOfFunction = (
  results: Array<SiteImportRowResult>,
  status: SiteImportRowResult["status"],
) => Array<string>;

const namesOf: NamesOfFunction = (
  results: Array<SiteImportRowResult>,
  status: SiteImportRowResult["status"],
): Array<string> => {
  return results
    .filter((result: SiteImportRowResult) => {
      return result.status === status;
    })
    .map((result: SiteImportRowResult) => {
      return result.name;
    });
};

describe("runSiteImport — nothing to do", () => {
  test("an empty file creates nothing and reports zeros", async () => {
    const recorder: Recorder = recordingCreator();

    const summary: SiteImportSummary = await runSiteImport({
      rows: [],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recorder.createSite,
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
    const progress: Array<SiteImportProgress> = [];

    await runSiteImport({
      rows: [],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recordingCreator().createSite,
      onProgress: (tick: SiteImportProgress) => {
        progress.push(tick);
      },
    });

    expect(progress).toEqual([
      { results: [], createdCount: 0, totalToCreate: 0 },
    ]);
  });
});

describe("runSiteImport — ordering", () => {
  test("root sites are created with no parent id", async () => {
    const recorder: Recorder = recordingCreator();

    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "East" }),
        makeRow({ line: 3, name: "West" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recorder.createSite,
    });

    expect(recorder.calls).toEqual([
      { name: "East", parentSiteId: undefined },
      { name: "West", parentSiteId: undefined },
    ]);
    expect(summary.createdCount).toBe(2);
    expect(summary.totalToCreate).toBe(2);
  });

  test("a parent later in the file is still created before its child", async () => {
    const recorder: Recorder = recordingCreator();

    await runSiteImport({
      // Child first — the file order is deliberately the wrong order.
      rows: [
        makeRow({ line: 2, name: "Springfield", parentName: "East" }),
        makeRow({ line: 3, name: "East" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recorder.createSite,
    });

    expect(recorder.calls).toEqual([
      { name: "East", parentSiteId: undefined },
      { name: "Springfield", parentSiteId: "id-East" },
    ]);
  });

  test("a three-level chain resolves each level against the one above it", async () => {
    const recorder: Recorder = recordingCreator();

    await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "Unit 1042", parentName: "Springfield" }),
        makeRow({ line: 3, name: "Springfield", parentName: "East" }),
        makeRow({ line: 4, name: "East" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recorder.createSite,
    });

    expect(recorder.calls).toEqual([
      { name: "East", parentSiteId: undefined },
      { name: "Springfield", parentSiteId: "id-East" },
      { name: "Unit 1042", parentSiteId: "id-Springfield" },
    ]);
  });

  test("a parent that already exists in the project is not re-created", async () => {
    const recorder: Recorder = recordingCreator();

    await runSiteImport({
      rows: [makeRow({ line: 2, name: "Springfield", parentName: "East" })],
      existingSiteIdByName: new Map<string, string>([
        ["East", "existing-east"],
      ]),
      createSite: recorder.createSite,
    });

    expect(recorder.calls).toEqual([
      { name: "Springfield", parentSiteId: "existing-east" },
    ]);
  });

  test("creates run one at a time, never concurrently", async () => {
    let inFlight: number = 0;
    let maxInFlight: number = 0;

    const createSite: CreateSiteFunction = async (
      row: ParsedSiteRow,
    ): Promise<SiteCreateResult> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
      inFlight--;
      return { created: true, siteId: `id-${row.name}` };
    };

    await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "A" }),
        makeRow({ line: 3, name: "B" }),
        makeRow({ line: 4, name: "C" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: createSite,
    });

    expect(maxInFlight).toBe(1);
  });
});

describe("runSiteImport — rows that can never be created", () => {
  test("a name that already exists is skipped before any request", async () => {
    const recorder: Recorder = recordingCreator();

    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "East" }),
        makeRow({ line: 3, name: "West" }),
      ],
      existingSiteIdByName: new Map<string, string>([
        ["East", "existing-east"],
      ]),
      createSite: recorder.createSite,
    });

    expect(recorder.calls).toEqual([{ name: "West", parentSiteId: undefined }]);
    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0]).toEqual({
      line: 2,
      name: "East",
      status: "skipped",
      message: 'A site named "East" already exists in this project.',
    });
  });

  test("an unresolvable parent is skipped and reported", async () => {
    const recorder: Recorder = recordingCreator();

    const summary: SiteImportSummary = await runSiteImport({
      rows: [makeRow({ line: 2, name: "Orphan", parentName: "Nowhere" })],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recorder.createSite,
    });

    expect(recorder.calls).toEqual([]);
    expect(summary.results).toEqual([
      {
        line: 2,
        name: "Orphan",
        status: "skipped",
        message:
          'Parent site "Nowhere" was not found in the file or the project.',
      },
    ]);
    expect(summary.totalToCreate).toBe(0);
  });

  test("a parent cycle is skipped rather than looping forever", async () => {
    const recorder: Recorder = recordingCreator();

    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "A", parentName: "B" }),
        makeRow({ line: 3, name: "B", parentName: "A" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recorder.createSite,
    });

    expect(recorder.calls).toEqual([]);
    expect(summary.skippedCount).toBe(2);
    expect(summary.createdCount).toBe(0);
  });

  test("skipped rows do not count toward the progress total", async () => {
    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "Orphan", parentName: "Nowhere" }),
        makeRow({ line: 3, name: "East" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recordingCreator().createSite,
    });

    expect(summary.totalToCreate).toBe(1);
  });
});

describe("runSiteImport — partial failure", () => {
  test("a failed row is reported with its message and does not stop the run", async () => {
    const recorder: Recorder = recordingCreator({
      West: { created: false, errorMessage: "Name is not unique." },
    });

    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "East" }),
        makeRow({ line: 3, name: "West" }),
        makeRow({ line: 4, name: "North" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recorder.createSite,
    });

    expect(namesOf(summary.results, "created")).toEqual(["East", "North"]);
    expect(summary.results[1]).toEqual({
      line: 3,
      name: "West",
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
   * created anyway, with no parentSiteId — a site silently re-homed to the
   * root of the hierarchy instead of a reported skip.
   */
  test("children of a failed parent are skipped, not created as roots", async () => {
    const recorder: Recorder = recordingCreator({
      East: { created: false, errorMessage: "Boom." },
    });

    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "East" }),
        makeRow({ line: 3, name: "Springfield", parentName: "East" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recorder.createSite,
    });

    expect(recorder.calls).toEqual([{ name: "East", parentSiteId: undefined }]);
    expect(summary.results).toEqual([
      { line: 2, name: "East", status: "failed", message: "Boom." },
      {
        line: 3,
        name: "Springfield",
        status: "skipped",
        message: 'Parent site "East" could not be created.',
      },
    ]);
  });

  test("a grandchild of a failed parent is skipped too", async () => {
    const recorder: Recorder = recordingCreator({
      East: { created: false, errorMessage: "Boom." },
    });

    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "East" }),
        makeRow({ line: 3, name: "Springfield", parentName: "East" }),
        makeRow({ line: 4, name: "Unit 1042", parentName: "Springfield" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recorder.createSite,
    });

    expect(namesOf(summary.results, "skipped")).toEqual([
      "Springfield",
      "Unit 1042",
    ]);
    expect(summary.createdCount).toBe(0);
  });

  /*
   * A create that reports success but hands back no id leaves the child with
   * nothing to point at. Treating that as "parent could not be created" is
   * the same safe answer as an outright failure.
   */
  test("a create that returns no id still blocks its children", async () => {
    const recorder: Recorder = recordingCreator({
      East: { created: true, siteId: undefined },
    });

    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "East" }),
        makeRow({ line: 3, name: "Springfield", parentName: "East" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recorder.createSite,
    });

    expect(namesOf(summary.results, "created")).toEqual(["East"]);
    expect(summary.results[1]).toMatchObject({
      name: "Springfield",
      status: "skipped",
      message: 'Parent site "East" could not be created.',
    });
  });

  test("an unexpected throw lands on the row, not on the run", async () => {
    const createSite: CreateSiteFunction = async (
      row: ParsedSiteRow,
    ): Promise<SiteCreateResult> => {
      if (row.name === "West") {
        throw new Error("Network is down.");
      }
      return { created: true, siteId: `id-${row.name}` };
    };

    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "East" }),
        makeRow({ line: 3, name: "West" }),
        makeRow({ line: 4, name: "North" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: createSite,
    });

    expect(summary.results[1]).toEqual({
      line: 3,
      name: "West",
      status: "failed",
      message: "Network is down.",
    });
    expect(namesOf(summary.results, "created")).toEqual(["East", "North"]);
  });

  test.each([
    ["a bare string", "not an error object"],
    ["an Error with an empty message", new Error("")],
  ])("%s still reads as a failure", async (_label: string, thrown: unknown) => {
    const createSite: CreateSiteFunction = (): Promise<SiteCreateResult> => {
      throw thrown;
    };

    const summary: SiteImportSummary = await runSiteImport({
      rows: [makeRow({ line: 2, name: "East" })],
      existingSiteIdByName: new Map<string, string>(),
      createSite: createSite,
    });

    expect(summary.results).toEqual([
      {
        line: 2,
        name: "East",
        status: "failed",
        message: "Something went wrong while creating this site.",
      },
    ]);
    expect(summary.failedCount).toBe(1);
  });
});

describe("runSiteImport — progress reporting", () => {
  test("reports the up-front skips before the first create", async () => {
    const progress: Array<SiteImportProgress> = [];

    await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "East" }),
        makeRow({ line: 3, name: "West" }),
      ],
      existingSiteIdByName: new Map<string, string>([
        ["East", "existing-east"],
      ]),
      createSite: recordingCreator().createSite,
      onProgress: (tick: SiteImportProgress) => {
        progress.push(tick);
      },
    });

    expect(progress[0]).toEqual({
      results: [
        {
          line: 2,
          name: "East",
          status: "skipped",
          message: 'A site named "East" already exists in this project.',
        },
      ],
      createdCount: 0,
      totalToCreate: 1,
    });
  });

  test("ticks once per attempted row, with a running created count", async () => {
    const progress: Array<SiteImportProgress> = [];

    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "A" }),
        makeRow({ line: 3, name: "B" }),
        makeRow({ line: 4, name: "C" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recordingCreator().createSite,
      onProgress: (tick: SiteImportProgress) => {
        progress.push(tick);
      },
    });

    // One up-front tick plus one per row.
    expect(progress).toHaveLength(4);
    expect(
      progress.map((tick: SiteImportProgress) => {
        return tick.createdCount;
      }),
    ).toEqual([0, 1, 2, 3]);
    expect(
      progress.map((tick: SiteImportProgress) => {
        return tick.results.length;
      }),
    ).toEqual([0, 1, 2, 3]);
    expect(progress[progress.length - 1]!.results).toEqual(summary.results);
  });

  test("a skipped child ticks too, so the results table stays live", async () => {
    const progress: Array<SiteImportProgress> = [];

    await runSiteImport({
      rows: [
        makeRow({ line: 2, name: "East" }),
        makeRow({ line: 3, name: "Springfield", parentName: "East" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recordingCreator({
        East: { created: false, errorMessage: "Boom." },
      }).createSite,
      onProgress: (tick: SiteImportProgress) => {
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
    const progress: Array<SiteImportProgress> = [];

    await runSiteImport({
      rows: [makeRow({ line: 2, name: "A" }), makeRow({ line: 3, name: "B" })],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recordingCreator().createSite,
      onProgress: (tick: SiteImportProgress) => {
        progress.push(tick);
      },
    });

    expect(progress[1]!.results).not.toBe(progress[2]!.results);
    // The earlier snapshot must not have grown after the fact.
    expect(progress[1]!.results).toHaveLength(1);
  });

  test("progress is optional", async () => {
    await expect(
      runSiteImport({
        rows: [makeRow({ line: 2, name: "A" })],
        existingSiteIdByName: new Map<string, string>(),
        createSite: recordingCreator().createSite,
      }),
    ).resolves.toMatchObject({ createdCount: 1 });
  });
});

describe("runSiteImport — the caller's inputs are inputs", () => {
  test("the existing-sites map is not mutated", async () => {
    const existing: Map<string, string> = new Map<string, string>([
      ["East", "existing-east"],
    ]);

    await runSiteImport({
      rows: [makeRow({ line: 2, name: "Springfield", parentName: "East" })],
      existingSiteIdByName: existing,
      createSite: recordingCreator().createSite,
    });

    expect(Array.from(existing.entries())).toEqual([["East", "existing-east"]]);
  });

  test("the parsed rows are not mutated", async () => {
    const rows: Array<ParsedSiteRow> = [
      makeRow({ line: 2, name: "East" }),
      makeRow({ line: 3, name: "Springfield", parentName: "East" }),
    ];
    const before: string = JSON.stringify(rows);

    await runSiteImport({
      rows: rows,
      existingSiteIdByName: new Map<string, string>(),
      createSite: recordingCreator().createSite,
    });

    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe("runSiteImport — the summary adds up", () => {
  test("every row lands in exactly one bucket", async () => {
    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        // created
        makeRow({ line: 2, name: "East" }),
        // failed
        makeRow({ line: 3, name: "West" }),
        // skipped: parent failed
        makeRow({ line: 4, name: "Cheyenne", parentName: "West" }),
        // skipped: already exists
        makeRow({ line: 5, name: "North" }),
        // skipped: parent is nowhere
        makeRow({ line: 6, name: "Orphan", parentName: "Nowhere" }),
      ],
      existingSiteIdByName: new Map<string, string>([
        ["North", "existing-north"],
      ]),
      createSite: recordingCreator({
        West: { created: false, errorMessage: "Boom." },
      }).createSite,
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
    const summary: SiteImportSummary = await runSiteImport({
      rows: [
        makeRow({ line: 7, name: "Springfield", parentName: "East" }),
        makeRow({ line: 9, name: "East" }),
      ],
      existingSiteIdByName: new Map<string, string>(),
      createSite: recordingCreator().createSite,
    });

    expect(
      summary.results.map((result: SiteImportRowResult) => {
        return [result.name, result.line];
      }),
    ).toEqual([
      ["East", 9],
      ["Springfield", 7],
    ]);
  });
});
