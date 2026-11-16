import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import FlamegraphView, {
  FlamegraphNode,
  ServerFlamegraphNode,
  normaliseServerFlamegraphNode,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/FlamegraphView";
import {
  getUnnamedValue,
  groupUnnamedFrames,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProfileFlameTree";

/*
 * ---------------------------------------------------------------------------
 * A flame graph a newcomer can read (#9118)
 * ---------------------------------------------------------------------------
 *
 * Real profiles of a Go service, read by the eBPF profiler, drew a third of
 * the graph as bare addresses ("0x270675", one sliver each) beside names
 * like "go.opentelemetry.io/obi/pkg/export/otel/metric/components/exem...",
 * cut off long before the part that says what the function is. Here: the
 * addresses are one frame named for what they are, with how much of the
 * graph they take and how to give them names; a frame reads by its short
 * name, the full name one hover away with self and total said in words;
 * and the choice of how a search shows its matches waits for a search.
 */

afterEach(() => {
  cleanup();
});

function server(
  functionName: string,
  selfValue: number,
  children: Array<ServerFlamegraphNode> = [],
  fileName: string = "",
  frameType: string = "",
): ServerFlamegraphNode {
  const totalValue: number =
    selfValue +
    children.reduce((sum: number, child: ServerFlamegraphNode): number => {
      return sum + child.totalValue;
    }, 0);

  return {
    functionName,
    fileName,
    lineNumber: 0,
    selfValue,
    totalValue,
    children,
    frameType,
  };
}

const LOOKUP: string =
  "github.com/acme/search/internal/index.(*Segment).Lookup";

/*
 * A Go service: its handler ranks results (its own code), and calls a
 * stripped native library through cgo - a run of addresses, two of which
 * end in libc's memcpy.
 */
function goService(): ServerFlamegraphNode {
  return server("", 0, [
    server(
      "main.main",
      0,
      [
        server("search.Rank", 60, [], "/app/internal/search/rank.go"),
        server(
          LOOKUP,
          0,
          [
            server(
              "0x7f3a2c10",
              5,
              [
                server("0x7f3a2b9e", 10, [
                  server("memcpy", 5, [], "/lib/x86_64-linux-gnu/libc.so.6"),
                ]),
                server("0x7f3a2d02", 10),
              ],
              "",
              "native",
            ),
            server(
              "0x7f3a2e00",
              5,
              [server("memcpy", 5, [], "/lib/x86_64-linux-gnu/libc.so.6")],
              "",
              "native",
            ),
          ],
          "/app/internal/index/segment.go",
        ),
      ],
      "/app/cmd/search/main.go",
    ),
  ]);
}

function sumOfSelf(node: FlamegraphNode): number {
  return node.children.reduce((sum: number, child: FlamegraphNode) => {
    return sum + sumOfSelf(child);
  }, node.selfValue);
}

function find(
  node: FlamegraphNode,
  test: (candidate: FlamegraphNode) => boolean,
): FlamegraphNode | null {
  if (test(node)) {
    return node;
  }

  for (const child of node.children) {
    const found: FlamegraphNode | null = find(child, test);

    if (found) {
      return found;
    }
  }

  return null;
}

describe("normaliseServerFlamegraphNode", () => {
  test("only the top of the tree is the root; a nameless frame below it stays nameless", () => {
    const root: FlamegraphNode = normaliseServerFlamegraphNode(
      server("", 0, [server("", 4)]),
    );

    expect(root.name).toBe("(root)");
    expect(root.children[0]!.name).toBe("");
  });

  test("frames are coloured by the rule the functions list uses", () => {
    const root: FlamegraphNode = normaliseServerFlamegraphNode(goService());
    const main: FlamegraphNode = root.children[0]!;
    const lookup: FlamegraphNode = main.children[1]!;

    expect(root.category).toBe("unknown");
    expect(main.category).toBe("own");
    // An address is nobody's code, even where the profiler calls it native.
    expect(lookup.children[0]!.category).toBe("unknown");
    expect(
      find(root, (node: FlamegraphNode) => {
        return node.name === "memcpy";
      })!.category,
    ).toBe("native");
  });
});

describe("groupUnnamedFrames", () => {
  test("the addresses under a frame become one frame, the named code under them kept and merged", () => {
    const root: FlamegraphNode = normaliseServerFlamegraphNode(goService());
    const grouped: FlamegraphNode = groupUnnamedFrames(root);

    const lookup: FlamegraphNode = grouped.children[0]!.children.find(
      (node: FlamegraphNode) => {
        return node.name === LOOKUP;
      },
    )!;

    expect(lookup.children).toHaveLength(1);
    const unnamed: FlamegraphNode = lookup.children[0]!;

    // Four addresses: two siblings, and the two below the first.
    expect(unnamed.unnamedFrameCount).toBe(4);
    expect(unnamed.name).toBe("");
    expect(unnamed.category).toBe("unknown");
    // Their own time, summed; their total is the frame's whole width.
    expect(unnamed.selfValue).toBe(5 + 10 + 10 + 5);
    expect(unnamed.totalValue).toBe(40);
    // memcpy sat under two different addresses: it is one frame now.
    expect(unnamed.children).toHaveLength(1);
    expect(unnamed.children[0]!.name).toBe("memcpy");
    expect(unnamed.children[0]!.totalValue).toBe(10);
  });

  test("no value is lost: the total and every frame's own time add up as before", () => {
    const root: FlamegraphNode = normaliseServerFlamegraphNode(goService());
    const grouped: FlamegraphNode = groupUnnamedFrames(root);

    expect(grouped.totalValue).toBe(root.totalValue);
    expect(sumOfSelf(grouped)).toBe(sumOfSelf(root));
  });

  test("the tree it was handed is left as it was", () => {
    const root: FlamegraphNode = normaliseServerFlamegraphNode(goService());
    const before: string = JSON.stringify(root);

    groupUnnamedFrames(root);

    expect(JSON.stringify(root)).toBe(before);
  });

  test("a lone address keeps its name for the tooltip", () => {
    const root: FlamegraphNode = normaliseServerFlamegraphNode(
      server("", 0, [server("main", 2, [server("0xabc", 3)], "/app/main.go")]),
    );
    const grouped: FlamegraphNode = groupUnnamedFrames(root);
    const unnamed: FlamegraphNode = grouped.children[0]!.children[0]!;

    expect(unnamed.unnamedFrameCount).toBe(1);
    expect(unnamed.name).toBe("0xabc");
  });

  test("a tree with no addresses comes back the same", () => {
    const root: FlamegraphNode = normaliseServerFlamegraphNode(
      server("", 0, [server("main", 2, [server("work", 3)], "/app/main.go")]),
    );

    expect(groupUnnamedFrames(root)).toEqual(root);
    expect(getUnnamedValue(root)).toBe(0);
  });

  test("how much of the graph has no symbols counts each address once", () => {
    const grouped: FlamegraphNode = groupUnnamedFrames(
      normaliseServerFlamegraphNode(goService()),
    );

    expect(getUnnamedValue(grouped)).toBe(40);
  });
});

describe("FlamegraphView", () => {
  function draw(truncated: boolean = false): void {
    render(
      <FlamegraphView
        root={normaliseServerFlamegraphNode(goService())}
        unit="nanoseconds"
        truncated={truncated}
      />,
    );
  }

  test("a frame reads by its short name; the module path is not drawn", () => {
    draw();

    const frames: HTMLElement = screen.getByTestId("flamegraph-frames");

    expect(within(frames).getByText("index.(*Segment).Lookup")).toBeVisible();
    expect(within(frames).queryByText(LOOKUP)).toBeNull();
    // The top frame says what it is: everything.
    expect(within(frames).getByText("Total")).toBeVisible();
  });

  test("code without symbols is one frame, in the legend, with its share and the way to fix it", () => {
    draw();

    const frames: HTMLElement = screen.getByTestId("flamegraph-frames");

    expect(within(frames).getAllByText("No symbols")).toHaveLength(1);
    expect(within(frames).queryByText("0x7f3a2c10")).toBeNull();

    // 40 of 100: the line under the graph says so, and links the docs.
    const note: HTMLElement = screen.getByTestId("flamegraph-unnamed-note");
    expect(note).toHaveTextContent(
      "40% of this graph is code without symbols, so its functions have no names.",
    );
    expect(
      within(note).getByRole("link", { name: "How to add symbols" }),
    ).toHaveAttribute("href", "/docs/telemetry/profiles#code-without-symbols");
  });

  test("a sliver of addresses is normal, and earns no line", () => {
    render(
      <FlamegraphView
        root={normaliseServerFlamegraphNode(
          server("", 0, [
            server("main", 95, [server("0x1", 5)], "/app/main.go"),
          ]),
        )}
        unit="nanoseconds"
      />,
    );

    expect(screen.queryByTestId("flamegraph-unnamed-note")).toBeNull();
  });

  test("a frame's tooltip gives the full name, and self and total in words", () => {
    draw();

    fireEvent.mouseEnter(
      within(screen.getByTestId("flamegraph-frames")).getByText(
        "index.(*Segment).Lookup",
      ),
    );

    const tooltip: HTMLElement = screen.getByTestId("flamegraph-tooltip");
    expect(tooltip).toHaveTextContent(LOOKUP);
    expect(tooltip).toHaveTextContent("in its own code");
    expect(tooltip).toHaveTextContent("with what it calls");
    // Its share of the whole graph: 40 of 100.
    expect(tooltip).toHaveTextContent("40%");
    expect(tooltip).toHaveTextContent("Your code · click to zoom in");
  });

  test("the grouped frame's tooltip says why it has no name, and how many addresses it holds", () => {
    draw();

    fireEvent.mouseEnter(
      within(screen.getByTestId("flamegraph-frames")).getByText("No symbols"),
    );

    const tooltip: HTMLElement = screen.getByTestId("flamegraph-tooltip");
    expect(tooltip).toHaveTextContent(
      "Code built without symbols: the profiler recorded only where it ran, not what it is called.",
    );
    expect(tooltip).toHaveTextContent("4 addresses grouped here.");
  });

  test("how a search shows its matches is offered only once there is a search", () => {
    draw();

    expect(screen.queryByTestId("flamegraph-search-mode")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/Search functions or files/), {
      target: { value: "Rank" },
    });

    expect(screen.getByTestId("flamegraph-search-mode")).toBeVisible();
  });

  test("a window too busy for one graph says so in a quiet line, not a warning", () => {
    draw(true);

    const note: HTMLElement = screen.getByTestId("flamegraph-truncated-note");
    expect(note).toHaveTextContent(
      "This window has more call stacks than one graph can hold, so it draws the busiest, and shares are of those.",
    );
    expect(note.className).not.toMatch(/amber/);
  });
});
