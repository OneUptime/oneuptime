import ProfileAggregationService, {
  DiffFlamegraphNode,
  FlamegraphRequest,
  FlamegraphResult,
  ProfileFlamegraphNode,
  TracePresenceRequest,
  TracePresenceResult,
} from "../../../Server/Services/ProfileAggregationService";
import ProfileSampleDatabaseService from "../../../Server/Services/ProfileSampleService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
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

describe("ProfileAggregationService trace-scoped sample filters", () => {
  type BuildSampleQuery = (request: FlamegraphRequest) => Statement;

  /*
   * The builders are private but pure — reaching them through casts keeps
   * predicate generation testable without a ClickHouse round trip (same
   * pattern as the mergeDiffTrees block above).
   */
  const buildGroupedStackQuery: BuildSampleQuery = (
    ProfileAggregationService as unknown as {
      buildGroupedStackQuery: BuildSampleQuery;
    }
  ).buildGroupedStackQuery.bind(ProfileAggregationService);

  const buildWindowTotalQuery: BuildSampleQuery = (
    ProfileAggregationService as unknown as {
      buildWindowTotalQuery: BuildSampleQuery;
    }
  ).buildWindowTotalQuery.bind(ProfileAggregationService);

  const projectId: ObjectID = ObjectID.generate();

  test("emits no trace predicates when traceId and spanIds are absent", () => {
    const statement: Statement = buildGroupedStackQuery({ projectId });

    expect(statement.query).not.toContain("traceId");
    expect(statement.query).not.toContain("spanId");
  });

  test("traceId alone adds a parameter-bound equality predicate", () => {
    const statement: Statement = buildGroupedStackQuery({
      projectId,
      traceId: "trace-abc-123",
    });

    expect(statement.query).toMatch(/AND traceId = \{p\d+:String\}/);
    expect(statement.query).not.toContain("spanId");
    expect(Object.values(statement.query_params)).toContain("trace-abc-123");
  });

  test("spanIds alone add a parameter-bound IN predicate", () => {
    const statement: Statement = buildGroupedStackQuery({
      projectId,
      spanIds: ["span-a", "span-b"],
    });

    expect(statement.query).toMatch(
      /AND spanId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expect(statement.query).not.toContain("traceId");
    expect(Object.values(statement.query_params)).toContainEqual([
      "span-a",
      "span-b",
    ]);
  });

  test("traceId and spanIds combine into both predicates", () => {
    const statement: Statement = buildGroupedStackQuery({
      projectId,
      traceId: "trace-abc-123",
      spanIds: ["span-a"],
    });

    expect(statement.query).toMatch(/AND traceId = \{p\d+:String\}/);
    expect(statement.query).toMatch(
      /AND spanId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expect(Object.values(statement.query_params)).toContain("trace-abc-123");
    expect(Object.values(statement.query_params)).toContainEqual(["span-a"]);
  });

  test("an empty spanIds array behaves exactly like an absent filter", () => {
    const statement: Statement = buildGroupedStackQuery({
      projectId,
      spanIds: [],
    });

    expect(statement.query).not.toContain("spanId");
  });

  test("injection-shaped values never reach the query text", () => {
    const evilTraceId: string = "') OR 1=1 --";
    const evilSpanId: string = "x'); DROP TABLE ProfileSample; --";

    const statement: Statement = buildGroupedStackQuery({
      projectId,
      traceId: evilTraceId,
      spanIds: [evilSpanId],
    });

    expect(statement.query).not.toContain(evilTraceId);
    expect(statement.query).not.toContain(evilSpanId);
    expect(Object.values(statement.query_params)).toContain(evilTraceId);
    expect(Object.values(statement.query_params)).toContainEqual([evilSpanId]);
  });

  test("the window-total query carries the same trace predicates", () => {
    const statement: Statement = buildWindowTotalQuery({
      projectId,
      traceId: "trace-abc-123",
      spanIds: ["span-a"],
    });

    expect(statement.query).toMatch(/AND traceId = \{p\d+:String\}/);
    expect(statement.query).toMatch(
      /AND spanId IN \(\{p\d+:Array\(String\)\}\)/,
    );
  });
});

/*
 * Stub the ClickHouse boundary while capturing every Statement handed to
 * executeQuery, so tests can assert on the generated predicates AND feed
 * canned rows back. Returns the (initially empty) capture array.
 */
const stubAndCaptureStatements: (
  rows: Array<JSONObject>,
) => Array<Statement> = (rows: Array<JSONObject>): Array<Statement> => {
  const captured: Array<Statement> = [];
  const fakeResult: Results = {
    json: () => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;

  jest
    .spyOn(ProfileSampleDatabaseService, "executeQuery")
    .mockImplementation((statement: Statement | string): Promise<Results> => {
      captured.push(statement as Statement);
      return Promise.resolve(fakeResult);
    });

  return captured;
};

describe("ProfileAggregationService trace filters through the public reads", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const projectId: ObjectID = ObjectID.generate();

  const expectTracePredicates: (statement: Statement) => void = (
    statement: Statement,
  ): void => {
    expect(statement.query).toMatch(/AND traceId = \{p\d+:String\}/);
    expect(statement.query).toMatch(
      /AND spanId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expect(Object.values(statement.query_params)).toContain("trace-9");
    expect(Object.values(statement.query_params)).toContainEqual(["span-9"]);
  };

  test("getFlamegraph threads traceId + spanIds into the grouped query", async () => {
    const captured: Array<Statement> = stubAndCaptureStatements([]);

    await ProfileAggregationService.getFlamegraph({
      projectId,
      traceId: "trace-9",
      spanIds: ["span-9"],
    });

    expect(captured.length).toBe(1);
    expectTracePredicates(captured[0]!);
  });

  test("getFunctionList threads traceId + spanIds into both queries", async () => {
    const captured: Array<Statement> = stubAndCaptureStatements([]);

    await ProfileAggregationService.getFunctionList({
      projectId,
      traceId: "trace-9",
      spanIds: ["span-9"],
    });

    // Grouped stack query + window-total query.
    expect(captured.length).toBe(2);
    for (const statement of captured) {
      expectTracePredicates(statement);
    }
  });

  test("getFunctionFocus threads traceId + spanIds into both queries", async () => {
    const captured: Array<Statement> = stubAndCaptureStatements([]);

    await ProfileAggregationService.getFunctionFocus({
      projectId,
      functionName: "work",
      fileName: "main.go",
      traceId: "trace-9",
      spanIds: ["span-9"],
    });

    // Function-stack query + window-total query.
    expect(captured.length).toBe(2);
    for (const statement of captured) {
      expectTracePredicates(statement);
    }
  });
});

describe("ProfileAggregationService.getTracePresence", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const projectId: ObjectID = ObjectID.generate();

  test("returns the count from the stubbed boundary and scopes the query", async () => {
    // ClickHouse renders wide numerics as strings — cover the coercion.
    const captured: Array<Statement> = stubAndCaptureStatements([
      { sampleCount: "42" },
    ]);

    const request: TracePresenceRequest = {
      projectId,
      traceId: "trace-1",
      spanIds: ["span-1", "span-2"],
    };

    const result: TracePresenceResult =
      await ProfileAggregationService.getTracePresence(request);

    expect(result.sampleCount).toBe(42);
    expect(captured.length).toBe(1);

    const statement: Statement = captured[0]!;
    expect(statement.query).toContain("count() AS sampleCount");
    expect(statement.query).toMatch(/AND traceId = \{p\d+:String\}/);
    expect(statement.query).toMatch(
      /AND spanId IN \(\{p\d+:Array\(String\)\}\)/,
    );
    expect(statement.query).toContain("retentionDate >= now()");
    expect(Object.values(statement.query_params)).toContain(
      projectId.toString(),
    );
    expect(Object.values(statement.query_params)).toContain("trace-1");
    expect(Object.values(statement.query_params)).toContainEqual([
      "span-1",
      "span-2",
    ]);
  });

  test("omits the spanId predicate when spanIds is absent or empty", async () => {
    const captured: Array<Statement> = stubAndCaptureStatements([
      { sampleCount: 7 },
    ]);

    const absentResult: TracePresenceResult =
      await ProfileAggregationService.getTracePresence({
        projectId,
        traceId: "trace-1",
      });
    expect(absentResult.sampleCount).toBe(7);
    expect(captured[0]!.query).not.toContain("spanId");

    const emptyResult: TracePresenceResult =
      await ProfileAggregationService.getTracePresence({
        projectId,
        traceId: "trace-1",
        spanIds: [],
      });
    expect(emptyResult.sampleCount).toBe(7);
    expect(captured[1]!.query).not.toContain("spanId");
  });

  test("returns 0 when the boundary yields no rows", async () => {
    stubAndCaptureStatements([]);

    const result: TracePresenceResult =
      await ProfileAggregationService.getTracePresence({
        projectId,
        traceId: "trace-with-no-samples",
      });

    expect(result.sampleCount).toBe(0);
  });

  test("injection-shaped trace ids stay out of the query text", async () => {
    const captured: Array<Statement> = stubAndCaptureStatements([]);
    const evilTraceId: string = "') UNION SELECT * FROM system.tables --";

    await ProfileAggregationService.getTracePresence({
      projectId,
      traceId: evilTraceId,
    });

    expect(captured[0]!.query).not.toContain(evilTraceId);
    expect(Object.values(captured[0]!.query_params)).toContain(evilTraceId);
  });
});
