import ProfileAggregationService, {
  DiffFlamegraphNode,
  FlamegraphResult,
  ProfileFlamegraphNode,
} from "../../../Server/Services/ProfileAggregationService";
import ProfileSampleDatabaseService from "../../../Server/Services/ProfileSampleService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, afterEach, jest } from "@jest/globals";

/*
 * Replace the ClickHouse boundary: getFlamegraph builds a Statement and
 * hands it to ProfileSampleDatabaseService.executeQuery, then everything
 * after that (tree building, totals) is pure. Stubbing executeQuery lets
 * the test feed grouped stack rows directly.
 */
const stubGroupedRows: (rows: Array<JSONObject>) => void = (
  rows: Array<JSONObject>,
): void => {
  const fakeResult: Results = {
    json: () => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  jest
    .spyOn(ProfileSampleDatabaseService, "executeQuery")
    .mockResolvedValue(fakeResult);
};

/*
 * Invariants every flamegraph consumer relies on: a child never exceeds
 * its parent, and a node's total is exactly its self value plus its
 * children's totals (no double counting, no lost samples).
 */
const assertTreeInvariants: (node: ProfileFlamegraphNode) => void = (
  node: ProfileFlamegraphNode,
): void => {
  let childrenTotal: number = 0;

  for (const child of node.children) {
    expect(child.totalValue).toBeLessThanOrEqual(node.totalValue);
    childrenTotal += child.totalValue;
    assertTreeInvariants(child);
  }

  expect(node.selfValue + childrenTotal).toBe(node.totalValue);
};

const findChild: (
  node: ProfileFlamegraphNode,
  functionName: string,
) => ProfileFlamegraphNode = (
  node: ProfileFlamegraphNode,
  functionName: string,
): ProfileFlamegraphNode => {
  const child: ProfileFlamegraphNode | undefined = node.children.find(
    (candidate: ProfileFlamegraphNode) => {
      return candidate.functionName === functionName;
    },
  );
  expect(child).toBeDefined();
  return child!;
};

describe("ProfileAggregationService.getFlamegraph", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("merges grouped stack rows into a tree with consistent parent/child totals", async () => {
    /*
     * Three pre-aggregated stacks sharing the "main" root frame. Stored
     * stacktraces are LEAF-FIRST (pprof/OTLP wire order), so the leaf
     * sits at index 0 and "main" comes last. ClickHouse's JSON output
     * renders wide numerics as strings, so one row uses string values to
     * cover the Number() coercion path.
     */
    stubGroupedRows([
      {
        stacktrace: ["work@main.go:22", "main@main.go:10"],
        frameTypes: ["go", "go"],
        totalValue: "100",
        sampleCount: "2",
      },
      {
        stacktrace: ["idle@main.go:30", "main@main.go:10"],
        frameTypes: ["go", "go"],
        totalValue: 50,
        sampleCount: 1,
      },
      {
        stacktrace: ["main@main.go:10"],
        frameTypes: ["go"],
        totalValue: 25,
        sampleCount: 1,
      },
    ]);

    const result: FlamegraphResult =
      await ProfileAggregationService.getFlamegraph({
        projectId: ObjectID.generate(),
      });

    expect(result.truncated).toBe(false);

    const root: ProfileFlamegraphNode = result.flamegraph;
    expect(root.functionName).toBe("(root)");
    expect(root.totalValue).toBe(175);
    expect(root.selfValue).toBe(0);
    expect(root.children.length).toBe(1);

    const main: ProfileFlamegraphNode = findChild(root, "main");
    expect(main.fileName).toBe("main.go");
    expect(main.lineNumber).toBe(10);
    expect(main.frameType).toBe("go");
    // All three stacks pass through main; only the third ends there.
    expect(main.totalValue).toBe(175);
    expect(main.selfValue).toBe(25);
    expect(main.children.length).toBe(2);

    const work: ProfileFlamegraphNode = findChild(main, "work");
    expect(work.totalValue).toBe(100);
    expect(work.selfValue).toBe(100);
    expect(work.lineNumber).toBe(22);
    expect(work.children.length).toBe(0);

    const idle: ProfileFlamegraphNode = findChild(main, "idle");
    expect(idle.totalValue).toBe(50);
    expect(idle.selfValue).toBe(50);

    assertTreeInvariants(root);
  });

  test("skips empty stacktraces and tolerates frames without the @file:line shape", async () => {
    stubGroupedRows([
      {
        stacktrace: [],
        frameTypes: [],
        totalValue: 999,
        sampleCount: 1,
      },
      {
        stacktrace: ["bareframe"],
        frameTypes: [],
        totalValue: 10,
        sampleCount: 1,
      },
    ]);

    const result: FlamegraphResult =
      await ProfileAggregationService.getFlamegraph({
        projectId: ObjectID.generate(),
      });

    const root: ProfileFlamegraphNode = result.flamegraph;

    // The empty-stack row contributes nothing — not even to the root total.
    expect(root.totalValue).toBe(10);
    expect(root.children.length).toBe(1);

    const bare: ProfileFlamegraphNode = findChild(root, "bareframe");
    expect(bare.fileName).toBe("");
    expect(bare.lineNumber).toBe(0);
    expect(bare.totalValue).toBe(10);

    assertTreeInvariants(root);
  });

  test("flags truncation when the unique-stack fetch cap is hit", async () => {
    const cappedRows: Array<JSONObject> = Array.from(
      { length: 10000 },
      (_unused: unknown, index: number) => {
        return {
          stacktrace: [`fn${index}@file.ts:1`],
          frameTypes: ["node"],
          totalValue: 1,
          sampleCount: 1,
        };
      },
    );

    stubGroupedRows(cappedRows);

    const result: FlamegraphResult =
      await ProfileAggregationService.getFlamegraph({
        projectId: ObjectID.generate(),
      });

    expect(result.truncated).toBe(true);
    expect(result.flamegraph.totalValue).toBe(10000);
    assertTreeInvariants(result.flamegraph);
  });
});

describe("ProfileAggregationService.mergeDiffTrees", () => {
  type MergeDiffTrees = (
    baseline: ProfileFlamegraphNode | null,
    comparison: ProfileFlamegraphNode | null,
  ) => DiffFlamegraphNode;

  /*
   * mergeDiffTrees is private but pure; reaching it through a cast keeps
   * the diff math testable without a ClickHouse round trip.
   */
  const mergeDiffTrees: MergeDiffTrees = (
    ProfileAggregationService as unknown as {
      mergeDiffTrees: MergeDiffTrees;
    }
  ).mergeDiffTrees.bind(ProfileAggregationService);

  const makeNode: (
    functionName: string,
    totalValue: number,
    selfValue: number,
    children?: Array<ProfileFlamegraphNode>,
  ) => ProfileFlamegraphNode = (
    functionName: string,
    totalValue: number,
    selfValue: number,
    children: Array<ProfileFlamegraphNode> = [],
  ): ProfileFlamegraphNode => {
    return {
      functionName,
      fileName: "main.go",
      lineNumber: 1,
      selfValue,
      totalValue,
      children,
      frameType: "go",
    };
  };

  test("computes deltas across both windows and unions children", async () => {
    const baseline: ProfileFlamegraphNode = makeNode("(root)", 100, 0, [
      makeNode("stable", 60, 60),
      makeNode("removed", 40, 40),
    ]);
    const comparison: ProfileFlamegraphNode = makeNode("(root)", 150, 0, [
      makeNode("stable", 90, 90),
      makeNode("added", 60, 60),
    ]);

    const diff: DiffFlamegraphNode = mergeDiffTrees(baseline, comparison);

    expect(diff.baselineValue).toBe(100);
    expect(diff.comparisonValue).toBe(150);
    expect(diff.delta).toBe(50);
    expect(diff.deltaPercent).toBe(50);
    expect(diff.children.length).toBe(3);

    // Children come back sorted by comparison value, descending.
    expect(
      diff.children.map((child: DiffFlamegraphNode) => {
        return child.functionName;
      }),
    ).toEqual(["stable", "added", "removed"]);

    const stable: DiffFlamegraphNode = diff.children[0]!;
    expect(stable.baselineValue).toBe(60);
    expect(stable.comparisonValue).toBe(90);
    expect(stable.delta).toBe(30);
    expect(stable.deltaPercent).toBe(50);

    // Present only in the comparison window: +100% by convention.
    const added: DiffFlamegraphNode = diff.children[1]!;
    expect(added.baselineValue).toBe(0);
    expect(added.comparisonValue).toBe(60);
    expect(added.delta).toBe(60);
    expect(added.deltaPercent).toBe(100);

    // Present only in the baseline window: the full value drops away.
    const removed: DiffFlamegraphNode = diff.children[2]!;
    expect(removed.baselineValue).toBe(40);
    expect(removed.comparisonValue).toBe(0);
    expect(removed.delta).toBe(-40);
    expect(removed.deltaPercent).toBe(-100);
  });
});
