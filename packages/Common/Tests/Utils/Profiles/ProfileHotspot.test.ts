import { describe, expect, test } from "@jest/globals";
import {
  ProfileCallChain,
  ProfileCallee,
  ProfileTreeNode,
  getOwnCodeValue,
  getShareOfWindow,
  getTopCallees,
  getTopCallerChains,
} from "../../../Utils/Profiles/ProfileHotspot";

/*
 * One function's part of a profile, read from the two trees the function
 * focus answers with: its own-code time (what a change to it can win back),
 * the heaviest chains that call it, and what it spends its time calling.
 */

function node(
  functionName: string,
  fileName: string,
  values: { self?: number; total: number },
  children: Array<ProfileTreeNode> = [],
): ProfileTreeNode {
  return {
    functionName,
    fileName,
    selfValue: values.self ?? 0,
    totalValue: values.total,
    children,
  };
}

/*
 * parseOrder's callees: JSON.parse (runtime) under it, a helper of the
 * application's own (normalizeLineItems) with a library call of its own,
 * and a little time in parseOrder itself.
 */
const PARSE_ORDER_CALLEES: ProfileTreeNode = node(
  "parseOrder",
  "src/orders/parse.ts",
  { self: 10, total: 640 },
  [
    node("JSON.parse", "node:internal/json", { self: 420, total: 420 }),
    node(
      "normalizeLineItems",
      "src/orders/normalize.ts",
      { self: 90, total: 150 },
      [
        node("lodash.cloneDeep", "node_modules/lodash/cloneDeep.js", {
          self: 60,
          total: 60,
        }),
      ],
    ),
    node("Buffer.concat", "node:buffer", { self: 0, total: 60 }, [
      node("memcpy", "/lib/x86_64-linux-gnu/libc.so.6", {
        self: 60,
        total: 60,
      }),
    ]),
  ],
);

describe("own-code time", () => {
  test("is the function's own time and every chain below it that reaches no other own function", () => {
    // 10 (itself) + 420 (JSON.parse) + 60 (Buffer.concat -> memcpy).
    expect(getOwnCodeValue(PARSE_ORDER_CALLEES)).toBe(490);
  });

  test("a request handler whose time all goes to its own parser has none", () => {
    expect(
      getOwnCodeValue(
        node("handleCheckout", "src/routes/checkout.ts", { total: 640 }, [
          PARSE_ORDER_CALLEES,
        ]),
      ),
    ).toBe(0);
  });

  test("is never more than the function's total", () => {
    expect(
      getOwnCodeValue(node("f", "src/f.ts", { self: 100, total: 50 })),
    ).toBe(50);
  });
});

describe("the chains that call a function", () => {
  const CALLERS: ProfileTreeNode = node(
    "JSON.parse",
    "node:internal/json",
    { total: 600 },
    [
      node("parseOrder", "src/orders/parse.ts", { total: 420 }, [
        node("handleCheckout", "src/routes/checkout.ts", { total: 420 }, [
          node("main", "src/server.ts", { total: 420 }),
        ]),
      ]),
      node("loadCatalog", "src/catalog.ts", { total: 180 }, [
        node("main", "src/server.ts", { total: 120 }),
        node("refresh", "src/catalog.ts", { total: 60 }),
      ]),
    ],
  );

  test("heaviest first, each following its heaviest caller up to the depth", () => {
    const chains: Array<ProfileCallChain> = getTopCallerChains(CALLERS, {
      depth: 2,
    });

    expect(
      chains.map((chain: ProfileCallChain) => {
        return [
          chain.frames.map((frame: { functionName: string }) => {
            return frame.functionName;
          }),
          chain.value,
        ];
      }),
    ).toEqual([
      [["parseOrder", "handleCheckout"], 420],
      [["loadCatalog", "main"], 180],
    ]);
  });

  test("at most `limit` chains", () => {
    expect(getTopCallerChains(CALLERS, { limit: 1 })).toHaveLength(1);
  });
});

describe("what a function spends its time calling", () => {
  test("every function below it, once each, heaviest first", () => {
    const callees: Array<ProfileCallee> = getTopCallees(PARSE_ORDER_CALLEES);

    expect(
      callees.map((callee: ProfileCallee) => {
        return [callee.functionName, callee.value];
      }),
    ).toEqual([
      ["JSON.parse", 420],
      ["normalizeLineItems", 150],
      ["lodash.cloneDeep", 60],
      ["Buffer.concat", 60],
      ["memcpy", 60],
    ]);
  });

  test("a function met again lower in its own chain (recursion) is counted once", () => {
    const recursive: ProfileTreeNode = node(
      "walk",
      "src/tree.ts",
      { total: 100 },
      [
        node("visit", "src/tree.ts", { total: 100 }, [
          node("visit", "src/tree.ts", { total: 70 }, [
            node("visit", "src/tree.ts", { self: 40, total: 40 }),
          ]),
        ]),
      ],
    );

    expect(
      getTopCallees(recursive).map((callee: ProfileCallee) => {
        return [callee.functionName, callee.value];
      }),
    ).toEqual([["visit", 100]]);
  });

  test("at most `limit` callees", () => {
    expect(getTopCallees(PARSE_ORDER_CALLEES, { limit: 2 })).toHaveLength(2);
  });
});

describe("a share of the window", () => {
  test.each([
    [25, 100, 25],
    [0, 100, 0],
    [10, 0, 0],
    [-5, 100, 0],
    [Number.NaN, 100, 0],
    [10, Number.POSITIVE_INFINITY, 0],
  ])("%s of %s is %s%%", (value: number, total: number, share: number) => {
    expect(getShareOfWindow(value, total)).toBe(share);
  });
});
