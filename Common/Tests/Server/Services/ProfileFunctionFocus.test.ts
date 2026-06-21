import ProfileAggregationService, {
  FunctionFocusResult,
  ProfileFlamegraphNode,
} from "../../../Server/Services/ProfileAggregationService";
import ProfileSampleDatabaseService from "../../../Server/Services/ProfileSampleService";
import { Results } from "../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, afterEach, jest } from "@jest/globals";

const makeResult: (rows: Array<JSONObject>) => Results = (
  rows: Array<JSONObject>,
): Results => {
  return {
    json: () => {
      return Promise.resolve({ data: rows });
    },
  } as unknown as Results;
};

/*
 * Replace the ClickHouse boundary: getFunctionFocus issues TWO queries
 * through ProfileSampleDatabaseService.executeQuery — the function-stack
 * query (grouped rows for stacks containing the function) and the
 * window-total query (one aggregate row over ALL matching samples).
 * Routing on the statement text keeps the stub correct regardless of the
 * order the concurrent reads are dispatched in.
 */
const stubFocusQueries: (data: {
  stackRows: Array<JSONObject>;
  windowTotal: number;
}) => void = (data: {
  stackRows: Array<JSONObject>;
  windowTotal: number;
}): void => {
  jest
    .spyOn(ProfileSampleDatabaseService, "executeQuery")
    .mockImplementation((statement: Statement | string): Promise<Results> => {
      const query: string =
        statement instanceof Statement ? statement.query : statement;

      if (query.includes("windowTotal")) {
        return Promise.resolve(makeResult([{ windowTotal: data.windowTotal }]));
      }

      return Promise.resolve(makeResult(data.stackRows));
    });
};

/*
 * Invariants both focus trees share with regular flamegraphs: a child
 * never exceeds its parent, and a node's total is exactly its self value
 * plus its children's totals (no double counting, no lost samples).
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

describe("ProfileAggregationService.getFunctionFocus", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("splits leaf-first stacks into caller and callee trees around the focused function", async () => {
    /*
     * Three pre-aggregated stacks through "target". Stored stacktraces
     * are LEAF-FIRST (index 0 = leaf, last = root), so callers sit AFTER
     * the occurrence index and callees BEFORE it. ClickHouse's JSON
     * output renders wide numerics as strings, so one row uses string
     * values to cover the Number() coercion path.
     */
    stubFocusQueries({
      stackRows: [
        {
          stacktrace: ["leafWork@a.go:5", "target@t.go:10", "main@main.go:1"],
          frameTypes: ["go", "go", "go"],
          totalValue: "100",
          sampleCount: "2",
        },
        {
          stacktrace: [
            "otherLeaf@b.go:2",
            "target@t.go:10",
            "handler@h.go:3",
            "main@main.go:1",
          ],
          frameTypes: ["go", "go", "go", "go"],
          totalValue: 50,
          sampleCount: 1,
        },
        // The focused function IS the leaf here — pure self time.
        {
          stacktrace: ["target@t.go:10", "main@main.go:1"],
          frameTypes: ["go", "go"],
          totalValue: 25,
          sampleCount: 1,
        },
      ],
      windowTotal: 1000,
    });

    const result: FunctionFocusResult =
      await ProfileAggregationService.getFunctionFocus({
        projectId: ObjectID.generate(),
        functionName: "target",
        fileName: "t.go",
      });

    expect(result.functionName).toBe("target");
    expect(result.fileName).toBe("t.go");
    // Each stack's value counts exactly once toward the focus total.
    expect(result.totalValue).toBe(175);
    // Only the stack where "target" is the leaf contributes self time.
    expect(result.selfValue).toBe(25);
    expect(result.sampleCount).toBe(4);
    expect(result.windowTotal).toBe(1000);
    expect(result.truncated).toBe(false);

    /*
     * Callers tree: root = focused function; children = DIRECT callers.
     * "main" calls target directly in stacks 1 and 3 (100 + 25), while
     * stack 2 reaches target through "handler", whose own caller "main"
     * sits one level deeper.
     */
    const callers: ProfileFlamegraphNode = result.callers;
    expect(callers.functionName).toBe("target");
    expect(callers.totalValue).toBe(175);
    expect(callers.children.length).toBe(2);

    const directMain: ProfileFlamegraphNode = findChild(callers, "main");
    expect(directMain.fileName).toBe("main.go");
    expect(directMain.totalValue).toBe(125);
    // Every chain through direct-caller main terminates at main itself.
    expect(directMain.selfValue).toBe(125);
    expect(directMain.children.length).toBe(0);

    const handler: ProfileFlamegraphNode = findChild(callers, "handler");
    expect(handler.totalValue).toBe(50);
    expect(handler.selfValue).toBe(0);
    expect(handler.children.length).toBe(1);

    const mainAboveHandler: ProfileFlamegraphNode = findChild(handler, "main");
    expect(mainAboveHandler.totalValue).toBe(50);
    expect(mainAboveHandler.selfValue).toBe(50);

    /*
     * Callees tree: children = direct callees toward the leaf. Stack 3
     * has no callees, so its value terminates at the callees root as
     * self time.
     */
    const callees: ProfileFlamegraphNode = result.callees;
    expect(callees.functionName).toBe("target");
    expect(callees.totalValue).toBe(175);
    expect(callees.selfValue).toBe(25);
    expect(callees.children.length).toBe(2);

    const leafWork: ProfileFlamegraphNode = findChild(callees, "leafWork");
    expect(leafWork.fileName).toBe("a.go");
    expect(leafWork.totalValue).toBe(100);
    expect(leafWork.selfValue).toBe(100);

    const otherLeaf: ProfileFlamegraphNode = findChild(callees, "otherLeaf");
    expect(otherLeaf.totalValue).toBe(50);
    expect(otherLeaf.selfValue).toBe(50);

    assertTreeInvariants(callers);
    assertTreeInvariants(callees);
  });

  test("matches occurrences on functionName + fileName, ignoring line numbers", async () => {
    /*
     * Line numbers shift across deploys (and with inlining), so the same
     * logical function shows up as t.go:10 in one window and t.go:99 in
     * another. Both occurrences must merge into one focus, and the
     * surrounding chain frames must merge on functionName + fileName too.
     */
    stubFocusQueries({
      stackRows: [
        {
          stacktrace: ["leafWork@a.go:5", "target@t.go:10", "main@main.go:1"],
          frameTypes: ["go", "go", "go"],
          totalValue: 100,
          sampleCount: 1,
        },
        {
          stacktrace: ["leafWork@a.go:7", "target@t.go:99", "main@main.go:4"],
          frameTypes: ["go", "go", "go"],
          totalValue: 50,
          sampleCount: 1,
        },
      ],
      windowTotal: 150,
    });

    const result: FunctionFocusResult =
      await ProfileAggregationService.getFunctionFocus({
        projectId: ObjectID.generate(),
        functionName: "target",
        fileName: "t.go",
      });

    expect(result.totalValue).toBe(150);
    expect(result.sampleCount).toBe(2);

    // One merged caller and one merged callee — not one pair per line.
    expect(result.callers.children.length).toBe(1);
    const main: ProfileFlamegraphNode = findChild(result.callers, "main");
    expect(main.totalValue).toBe(150);
    // Focus trees aggregate line numbers away by design.
    expect(main.lineNumber).toBe(0);

    expect(result.callees.children.length).toBe(1);
    const leafWork: ProfileFlamegraphNode = findChild(
      result.callees,
      "leafWork",
    );
    expect(leafWork.totalValue).toBe(150);

    assertTreeInvariants(result.callers);
    assertTreeInvariants(result.callees);
  });

  test("splits recursive stacks at the occurrence closest to the root, counting value once", async () => {
    /*
     * target → mid → target (leaf-first storage, so the leaf occurrence
     * is index 0 and the root-side occurrence is index 2). The split must
     * happen at the occurrence CLOSEST TO THE ROOT so the nested
     * occurrence lands in the callees subtree instead of producing a
     * second, double-counting split.
     */
    stubFocusQueries({
      stackRows: [
        {
          stacktrace: [
            "target@t.go:10",
            "mid@m.go:1",
            "target@t.go:10",
            "main@main.go:1",
          ],
          frameTypes: ["go", "go", "go", "go"],
          totalValue: 10,
          sampleCount: 1,
        },
      ],
      windowTotal: 10,
    });

    const result: FunctionFocusResult =
      await ProfileAggregationService.getFunctionFocus({
        projectId: ObjectID.generate(),
        functionName: "target",
        fileName: "t.go",
      });

    // Value counted exactly once despite two occurrences in the stack.
    expect(result.totalValue).toBe(10);
    expect(result.callers.totalValue).toBe(10);
    expect(result.callees.totalValue).toBe(10);
    /*
     * The split happens at the root-side occurrence, but the EXECUTING
     * frame (index 0) is still the focused function — self time counts
     * whenever the function is the leaf, per sandwich-view semantics.
     */
    expect(result.selfValue).toBe(10);
    expect(result.sampleCount).toBe(1);

    // Callers: only the frame above the root-side occurrence.
    expect(result.callers.children.length).toBe(1);
    const main: ProfileFlamegraphNode = findChild(result.callers, "main");
    expect(main.totalValue).toBe(10);
    expect(main.selfValue).toBe(10);
    expect(main.children.length).toBe(0);

    // Callees: the nested occurrence appears UNDER mid as a callee.
    expect(result.callees.children.length).toBe(1);
    const mid: ProfileFlamegraphNode = findChild(result.callees, "mid");
    expect(mid.totalValue).toBe(10);
    expect(mid.selfValue).toBe(0);

    const nestedTarget: ProfileFlamegraphNode = findChild(mid, "target");
    expect(nestedTarget.totalValue).toBe(10);
    expect(nestedTarget.selfValue).toBe(10);

    assertTreeInvariants(result.callers);
    assertTreeInvariants(result.callees);
  });

  test("takes windowTotal from the second (window-total) query and reports truncated=false for small inputs", async () => {
    /*
     * The two reads are dispatched in a fixed order — function-stack
     * query first, window-total query second — so ordered one-shot stubs
     * pin down which result feeds which field.
     */
    const spy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ProfileSampleDatabaseService, "executeQuery")
      .mockResolvedValueOnce(
        makeResult([
          {
            stacktrace: ["target@t.go:10", "main@main.go:1"],
            frameTypes: ["go", "go"],
            totalValue: 40,
            sampleCount: 1,
          },
        ]),
      )
      .mockResolvedValueOnce(makeResult([{ windowTotal: "777" }]));

    const result: FunctionFocusResult =
      await ProfileAggregationService.getFunctionFocus({
        projectId: ObjectID.generate(),
        functionName: "target",
        fileName: "t.go",
      });

    expect(spy).toHaveBeenCalledTimes(2);
    // windowTotal mirrors the aggregate row, not the sum of stack rows.
    expect(result.windowTotal).toBe(777);
    expect(result.totalValue).toBe(40);
    // Far below the unique-stack fetch cap — nothing was dropped.
    expect(result.truncated).toBe(false);
  });
});
