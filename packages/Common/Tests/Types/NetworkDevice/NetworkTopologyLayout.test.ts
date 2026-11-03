import NetworkTopologyLayout, {
  NETWORK_TOPOLOGY_LAYOUTS,
  NetworkTopologyLayoutUtil,
} from "../../../Types/NetworkDevice/NetworkTopologyLayout";
import { describe, expect, test } from "@jest/globals";

/*
 * The five ways a network topology map can be arranged, by the ids the map,
 * a browser's saved arrangements and a project's default layout (issue
 * #5378) all store. A stored id outlives the code that wrote it, so these
 * tests hold the ids still and hold every reader to the same answer for a
 * value it does not know: none.
 */

const UNKNOWN_VALUES: Array<unknown> = [
  "",
  " ",
  "\n\t",
  "Force",
  "PARENTCHILD",
  "parent-child",
  "parent_child",
  "Parent and child",
  "hub",
  "automatic",
  "mesh",
  "constructor",
  "__proto__",
  "toString",
  "hasOwnProperty",
  "valueOf",
  "force,tiered",
  "force tiered",
  null,
  undefined,
  0,
  1,
  NaN,
  true,
  false,
  {},
  [],
  ["force"],
  { layout: "force" },
  new String("force"),
  Symbol("force"),
  () => {
    return "force";
  },
];

describe("NETWORK_TOPOLOGY_LAYOUTS", () => {
  test("is the five layouts, in the order the map offers them", () => {
    expect(NETWORK_TOPOLOGY_LAYOUTS).toEqual([
      "force",
      "tiered",
      "radial",
      "star",
      "parentChild",
    ]);
  });

  test("names each layout once", () => {
    expect(new Set(NETWORK_TOPOLOGY_LAYOUTS).size).toBe(
      NETWORK_TOPOLOGY_LAYOUTS.length,
    );
  });

  test("every id fits the column it is stored in", () => {
    for (const layout of NETWORK_TOPOLOGY_LAYOUTS) {
      expect(layout.length).toBeLessThanOrEqual(100);
      expect(layout).toBe(layout.trim());
    }
  });
});

describe("NetworkTopologyLayoutUtil.isLayout", () => {
  test.each([...NETWORK_TOPOLOGY_LAYOUTS])("%s is a layout", (id: string) => {
    expect(NetworkTopologyLayoutUtil.isLayout(id)).toBe(true);
  });

  test.each(
    UNKNOWN_VALUES.map((value: unknown) => {
      return [value];
    }),
  )("%p is not", (value: unknown) => {
    expect(NetworkTopologyLayoutUtil.isLayout(value)).toBe(false);
  });

  test("a layout with space around it is not one until it is trimmed", () => {
    expect(NetworkTopologyLayoutUtil.isLayout(" star ")).toBe(false);
    expect(NetworkTopologyLayoutUtil.parse(" star ")).toBe("star");
  });
});

describe("NetworkTopologyLayoutUtil.parse: a stored default, read back", () => {
  test.each([...NETWORK_TOPOLOGY_LAYOUTS])(
    "%s reads as itself",
    (id: string) => {
      expect(NetworkTopologyLayoutUtil.parse(id)).toBe(id);
    },
  );

  test("space around an id is ignored", () => {
    expect(NetworkTopologyLayoutUtil.parse("  parentChild\n")).toBe(
      "parentChild",
    );
    expect(NetworkTopologyLayoutUtil.parse("\ttiered ")).toBe("tiered");
  });

  test.each(
    UNKNOWN_VALUES.map((value: unknown) => {
      return [value];
    }),
  )("%p reads as none", (value: unknown) => {
    expect(NetworkTopologyLayoutUtil.parse(value)).toBeNull();
  });

  test("the answer is typed as a layout the map can open on", () => {
    const layout: NetworkTopologyLayout | null =
      NetworkTopologyLayoutUtil.parse("radial");
    expect(layout).toBe("radial");
  });
});

describe("NetworkTopologyLayoutUtil.getProblem: what a project may store", () => {
  test.each([...NETWORK_TOPOLOGY_LAYOUTS])("%s may be stored", (id: string) => {
    expect(NetworkTopologyLayoutUtil.getProblem(id)).toBeNull();
  });

  test("an id with space around it may be stored (it is stored trimmed)", () => {
    expect(NetworkTopologyLayoutUtil.getProblem(" star ")).toBeNull();
  });

  test("null clears the default", () => {
    expect(NetworkTopologyLayoutUtil.getProblem(null)).toBeNull();
  });

  test.each(["", "   ", "\n"])(
    "blank text %p clears it too",
    (value: string) => {
      expect(NetworkTopologyLayoutUtil.getProblem(value)).toBeNull();
    },
  );

  test.each([
    "Force",
    "parent-child",
    "Parent and child",
    "mesh",
    "constructor",
    "__proto__",
    "force,tiered",
  ])("%p is refused, naming every id it could be", (value: string) => {
    expect(NetworkTopologyLayoutUtil.getProblem(value)).toBe(
      "The default network topology layout must be one of force, tiered, radial, star, parentChild.",
    );
  });

  test.each([
    [0],
    [1],
    [true],
    [false],
    [{}],
    [[]],
    [["force"]],
    [{ layout: "force" }],
    [undefined],
  ])("%p is refused as not text", (value: unknown) => {
    expect(NetworkTopologyLayoutUtil.getProblem(value)).toBe(
      "The default network topology layout must be text.",
    );
  });

  test("whatever may be stored reads back as a layout or as none, never as anything else", () => {
    const candidates: Array<unknown> = [
      ...NETWORK_TOPOLOGY_LAYOUTS,
      ...NETWORK_TOPOLOGY_LAYOUTS.map((id: string) => {
        return ` ${id}\n`;
      }),
      null,
      "",
      "  ",
    ];

    for (const value of candidates) {
      expect(NetworkTopologyLayoutUtil.getProblem(value)).toBeNull();
      const read: NetworkTopologyLayout | null =
        NetworkTopologyLayoutUtil.parse(value);
      expect(read === null || NETWORK_TOPOLOGY_LAYOUTS.includes(read)).toBe(
        true,
      );
    }
  });
});
