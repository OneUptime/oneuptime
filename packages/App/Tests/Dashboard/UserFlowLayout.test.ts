import { describe, expect, test } from "@jest/globals";
import {
  buildUserFlowGraph,
  UserFlowGraph,
  UserFlowJourney,
  UserFlowLink,
  UserFlowNode,
} from "Common/Utils/Rum/UserFlow";
import {
  buildBandPath,
  describeUserFlowColumn,
  fitUserFlowColumns,
  layoutUserFlow,
  USER_FLOW_COLUMN_GAP,
  USER_FLOW_MAX_COLUMN_GAP,
  USER_FLOW_MIN_COLUMN_GAP,
  USER_FLOW_MIN_NODE_WIDTH,
  USER_FLOW_MIN_NODE_HEIGHT,
  USER_FLOW_NODE_WIDTH,
  USER_FLOW_PADDING_TOP,
  USER_FLOW_PADDING_X,
  USER_FLOW_STUB_LENGTH,
  USER_FLOW_TARGET_HEIGHT,
  UserFlowBand,
  UserFlowLayout,
  UserFlowNodeBox,
  UserFlowStub,
} from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowLayout";
import {
  formatUserFlowCount,
  formatUserFlowDuration,
  formatUserFlowShare,
  pluralizeSessions,
  truncateUserFlowLabel,
} from "../../FeatureSet/Dashboard/src/Components/UserFlow/UserFlowFormat";

/*
 * The flow map's geometry. The SVG is drawn straight from these numbers, so
 * "does a band start where its node is" and "is a bigger flow a thicker
 * band" are pinned here rather than eyeballed in a browser.
 */

function journey(id: string, pages: Array<string>): UserFlowJourney {
  return {
    sessionId: id,
    startUnixMs: 0,
    durationMs: 1000,
    deviceType: "desktop",
    pages: pages,
    errorPages: new Set<string>(),
    frustrationPages: new Set<string>(),
    hadErrors: false,
    hadFrustration: false,
  };
}

/* 3 x (/ -> /a), 1 x (/ -> /b), 1 x (/) */
const JOURNEYS: Array<UserFlowJourney> = [
  journey("1", ["/", "/a"]),
  journey("2", ["/", "/a"]),
  journey("3", ["/", "/a"]),
  journey("4", ["/", "/b"]),
  journey("5", ["/"]),
];

function forwardGraph(): UserFlowGraph {
  return buildUserFlowGraph(JOURNEYS, {
    anchorPage: null,
    direction: "forward",
    steps: 2,
    pagesPerStep: 6,
  });
}

function boxOf(
  layout: UserFlowLayout,
  page: string,
  step: number,
): UserFlowNodeBox {
  return layout.nodes.find((box: UserFlowNodeBox): boolean => {
    return box.node.page === page && box.node.step === step;
  }) as UserFlowNodeBox;
}

function bandOf(layout: UserFlowLayout, to: string): UserFlowBand {
  return layout.bands.find((band: UserFlowBand): boolean => {
    return band.link.toPage === to;
  }) as UserFlowBand;
}

/* The "M x,y" start of a band path. */
function startOf(path: string): [number, number] {
  const match: RegExpMatchArray | null = path.match(/^M([\d.-]+),([\d.-]+)/);

  return [Number(match?.[1]), Number(match?.[2])];
}

describe("layoutUserFlow", () => {
  test("columns sit left to right, one node width and one gap apart", () => {
    const layout: UserFlowLayout = layoutUserFlow(forwardGraph());

    expect(boxOf(layout, "/", 0).x).toBe(USER_FLOW_PADDING_X);
    expect(boxOf(layout, "/a", 1).x).toBe(
      USER_FLOW_PADDING_X + USER_FLOW_NODE_WIDTH + USER_FLOW_COLUMN_GAP,
    );
    expect(layout.width).toBe(
      USER_FLOW_PADDING_X * 2 + 2 * USER_FLOW_NODE_WIDTH + USER_FLOW_COLUMN_GAP,
    );
  });

  test("node height is proportional to sessions, with a floor", () => {
    const layout: UserFlowLayout = layoutUserFlow(forwardGraph());

    /* The busiest column (5 sessions at step 0) fills the target height. */
    expect(layout.scale).toBeCloseTo(USER_FLOW_TARGET_HEIGHT / 5);
    expect(boxOf(layout, "/", 0).height).toBeCloseTo(USER_FLOW_TARGET_HEIGHT);
    expect(boxOf(layout, "/a", 1).height).toBeCloseTo(3 * layout.scale);
    expect(boxOf(layout, "/b", 1).height).toBe(
      Math.max(USER_FLOW_MIN_NODE_HEIGHT, layout.scale),
    );
    expect(boxOf(layout, "/", 0).y).toBe(USER_FLOW_PADDING_TOP);
  });

  test("band thickness is proportional to sessions", () => {
    const layout: UserFlowLayout = layoutUserFlow(forwardGraph());

    expect(bandOf(layout, "/a").thickness).toBeCloseTo(3 * layout.scale);
    expect(bandOf(layout, "/b").thickness).toBeCloseTo(layout.scale);
    /* Thick bands are drawn first so thin ones stay on top. */
    expect(layout.bands[0]?.link.toPage).toBe("/a");
  });

  test("bands leave the source's right edge, stacked in target order", () => {
    const layout: UserFlowLayout = layoutUserFlow(forwardGraph());
    const source: UserFlowNodeBox = boxOf(layout, "/", 0);
    const [ax, ay]: [number, number] = startOf(bandOf(layout, "/a").path);
    const [bx, by]: [number, number] = startOf(bandOf(layout, "/b").path);

    expect(ax).toBe(source.x + source.width);
    expect(bx).toBe(source.x + source.width);
    /* /a is above /b in the next column, so its band starts higher. */
    expect(ay).toBeCloseTo(source.y);
    expect(by).toBeCloseTo(source.y + 3 * layout.scale);
  });

  test("a drop-off stub leaves after the bands, sized by the sessions that left", () => {
    const layout: UserFlowLayout = layoutUserFlow(forwardGraph());
    const exit: UserFlowStub | undefined = layout.stubs.find(
      (stub: UserFlowStub): boolean => {
        return (
          stub.kind === "exit" && stub.nodeId === boxOf(layout, "/", 0).node.id
        );
      },
    );
    const source: UserFlowNodeBox = boxOf(layout, "/", 0);

    expect(exit?.sessions).toBe(1);
    expect(exit?.thickness).toBeCloseTo(layout.scale);
    expect(startOf(exit!.path)).toEqual([
      source.x + source.width,
      expect.closeTo(source.y + 4 * layout.scale, 1),
    ]);
  });

  test("everything that enters a node is accounted for on its right edge", () => {
    const layout: UserFlowLayout = layoutUserFlow(forwardGraph());

    for (const box of layout.nodes) {
      const node: UserFlowNode = box.node;
      const outgoing: number = layout.bands
        .filter((band: UserFlowBand): boolean => {
          return band.link.sourceId === node.id;
        })
        .reduce((sum: number, band: UserFlowBand): number => {
          return sum + band.link.sessions;
        }, 0);
      const stubbed: number = layout.stubs
        .filter((stub: UserFlowStub): boolean => {
          return stub.nodeId === node.id;
        })
        .reduce((sum: number, stub: UserFlowStub): number => {
          return sum + stub.sessions;
        }, 0);

      expect(outgoing + stubbed).toBe(node.sessions);
    }
  });

  test("the last column's continuing journeys get a stub, not a band", () => {
    const graph: UserFlowGraph = buildUserFlowGraph(
      [journey("1", ["/", "/a", "/b"])],
      { anchorPage: null, direction: "forward", steps: 2, pagesPerStep: 6 },
    );
    const layout: UserFlowLayout = layoutUserFlow(graph);

    expect(
      layout.stubs.map((stub: UserFlowStub): string => {
        return stub.kind;
      }),
    ).toEqual(["continued"]);
    /* It stays inside the drawing. */
    const box: UserFlowNodeBox = boxOf(layout, "/a", 1);

    expect(box.x + box.width + USER_FLOW_STUB_LENGTH).toBeLessThanOrEqual(
      layout.width,
    );
  });

  test("a backward map puts the anchor on the right and keeps bands left to right", () => {
    const graph: UserFlowGraph = buildUserFlowGraph(
      [journey("1", ["/", "/a", "/pay"]), journey("2", ["/b", "/pay"])],
      {
        anchorPage: "/pay",
        direction: "backward",
        steps: 3,
        pagesPerStep: 6,
      },
    );
    const layout: UserFlowLayout = layoutUserFlow(graph);
    const anchor: UserFlowNodeBox = boxOf(layout, "/pay", 0);
    const earliest: UserFlowNodeBox = boxOf(layout, "/", 2);

    expect(anchor.column).toBe(2);
    expect(earliest.column).toBe(0);
    expect(anchor.x).toBeGreaterThan(earliest.x);

    for (const band of layout.bands) {
      const source: UserFlowNodeBox = layout.nodes.find(
        (box: UserFlowNodeBox): boolean => {
          return box.node.id === band.link.sourceId;
        },
      ) as UserFlowNodeBox;
      const target: UserFlowNodeBox = layout.nodes.find(
        (box: UserFlowNodeBox): boolean => {
          return box.node.id === band.link.targetId;
        },
      ) as UserFlowNodeBox;

      expect(target.x).toBeGreaterThan(source.x);
    }

    /* Session starts show as entry stubs on the left, where they began. */
    const entries: Array<UserFlowStub> = layout.stubs.filter(
      (stub: UserFlowStub): boolean => {
        return stub.kind === "entry";
      },
    );

    expect(
      entries
        .map((stub: UserFlowStub): number => {
          return stub.sessions;
        })
        .reduce((sum: number, value: number): number => {
          return sum + value;
        }, 0),
    ).toBe(2);
    expect(
      layout.columns.map((column: { label: string }): string => {
        return column.label;
      }),
    ).toEqual(["Selected page", "1 page before", "2 pages before"]);
  });

  test("column headers carry their totals", () => {
    const layout: UserFlowLayout = layoutUserFlow(forwardGraph());

    expect(
      layout.columns.map((column: { sessions: number }): number => {
        return column.sessions;
      }),
    ).toEqual([5, 4]);
  });

  test("an empty graph still lays out", () => {
    const layout: UserFlowLayout = layoutUserFlow({
      direction: "forward",
      anchorPage: null,
      steps: 0,
      nodes: [],
      links: [],
      sessions: 0,
    });

    expect(layout.nodes).toEqual([]);
    expect(Number.isFinite(layout.width)).toBe(true);
    expect(Number.isFinite(layout.height)).toBe(true);
  });

  test("a link whose node is missing is skipped rather than drawn at NaN", () => {
    const graph: UserFlowGraph = forwardGraph();
    const broken: UserFlowLink = {
      ...(graph.links[0] as UserFlowLink),
      id: "broken",
      targetId: "nowhere",
    };
    const layout: UserFlowLayout = layoutUserFlow({
      ...graph,
      links: [...graph.links, broken],
    });

    expect(
      layout.bands.some((band: UserFlowBand): boolean => {
        return band.link.id === "broken";
      }),
    ).toBe(false);
    expect(
      layout.bands.every((band: UserFlowBand): boolean => {
        return !band.path.includes("NaN");
      }),
    ).toBe(true);
  });
});

describe("fitting the map to its card", () => {
  test("without a width, the default spacing", () => {
    expect(fitUserFlowColumns(5, undefined)).toEqual({
      nodeWidth: USER_FLOW_NODE_WIDTH,
      columnGap: USER_FLOW_COLUMN_GAP,
    });
  });

  test("a wide card spreads the columns to fill it exactly", () => {
    const fit: { nodeWidth: number; columnGap: number } = fitUserFlowColumns(
      5,
      1200,
    );

    expect(fit.nodeWidth).toBe(USER_FLOW_NODE_WIDTH);
    expect(
      USER_FLOW_PADDING_X * 2 + 5 * fit.nodeWidth + 4 * fit.columnGap,
    ).toBeCloseTo(1200);

    /* Two columns in 700px: the gap takes up the slack. */
    const layout: UserFlowLayout = layoutUserFlow(forwardGraph(), {
      availableWidth: 600,
    });

    expect(layout.width).toBeCloseTo(600);
    expect(layout.columnGap).toBeGreaterThan(USER_FLOW_COLUMN_GAP);
  });

  test("the gap stops growing before bands turn into flat lines", () => {
    expect(fitUserFlowColumns(2, 3000).columnGap).toBe(
      USER_FLOW_MAX_COLUMN_GAP,
    );

    /* So a short map in a wide card is narrower than the card. */
    const layout: UserFlowLayout = layoutUserFlow(forwardGraph(), {
      availableWidth: 3000,
    });

    expect(layout.columnGap).toBe(USER_FLOW_MAX_COLUMN_GAP);
    expect(layout.width).toBeLessThan(3000);
  });

  test("a narrow card narrows the nodes, then scrolls", () => {
    const squeezed: { nodeWidth: number; columnGap: number } =
      fitUserFlowColumns(5, 1100);

    expect(squeezed.columnGap).toBe(USER_FLOW_MIN_COLUMN_GAP);
    expect(squeezed.nodeWidth).toBeLessThan(USER_FLOW_NODE_WIDTH);
    expect(
      USER_FLOW_PADDING_X * 2 + 5 * squeezed.nodeWidth + 4 * squeezed.columnGap,
    ).toBeCloseTo(1100);

    const phone: { nodeWidth: number; columnGap: number } = fitUserFlowColumns(
      5,
      360,
    );

    expect(phone.nodeWidth).toBe(USER_FLOW_MIN_NODE_WIDTH);
    expect(phone.columnGap).toBe(USER_FLOW_MIN_COLUMN_GAP);
  });

  test("bands still meet their nodes when the columns are refit", () => {
    const layout: UserFlowLayout = layoutUserFlow(forwardGraph(), {
      availableWidth: 1400,
    });
    const source: UserFlowNodeBox = boxOf(layout, "/", 0);
    const target: UserFlowNodeBox = boxOf(layout, "/a", 1);
    const band: UserFlowBand = bandOf(layout, "/a");

    expect(startOf(band.path)[0]).toBeCloseTo(source.x + source.width);
    expect(band.path).toContain(`${Math.round(target.x * 100) / 100},`);
  });
});

describe("buildBandPath", () => {
  test("is a closed ribbon between the two spans", () => {
    expect(buildBandPath(0, 10, 100, 50, 5)).toBe(
      "M0,10 C50,10 50,50 100,50 L100,55 C50,55 50,15 0,15 Z",
    );
  });
});

describe("describeUserFlowColumn", () => {
  test("names columns by what they mean", () => {
    const start: { anchorPage: null; direction: "forward" } = {
      anchorPage: null,
      direction: "forward",
    };

    expect(describeUserFlowColumn(0, start)).toBe("Landing page");
    expect(describeUserFlowColumn(2, start)).toBe("Page 3");
    expect(
      describeUserFlowColumn(1, { anchorPage: "/x", direction: "forward" }),
    ).toBe("1 page after");
    expect(
      describeUserFlowColumn(3, { anchorPage: "/x", direction: "backward" }),
    ).toBe("3 pages before");
  });
});

describe("formatting", () => {
  test("counts and shares", () => {
    expect(formatUserFlowCount(1234567)).toBe("1,234,567");
    expect(formatUserFlowCount(Number.NaN)).toBe("0");
    expect(formatUserFlowShare(0)).toBe("0%");
    expect(formatUserFlowShare(0.004)).toBe("<1%");
    expect(formatUserFlowShare(0.0567)).toBe("5.7%");
    expect(formatUserFlowShare(0.05)).toBe("5%");
    expect(formatUserFlowShare(0.456)).toBe("46%");
    expect(formatUserFlowShare(1)).toBe("100%");
    expect(pluralizeSessions(1)).toBe("1 session");
    expect(pluralizeSessions(2500)).toBe("2,500 sessions");
  });

  test("durations", () => {
    expect(formatUserFlowDuration(0)).toBe("—");
    expect(formatUserFlowDuration(42_000)).toBe("42s");
    expect(formatUserFlowDuration(125_000)).toBe("2m 5s");
    expect(formatUserFlowDuration(120_000)).toBe("2m");
    expect(formatUserFlowDuration(3_900_000)).toBe("1h 5m");
  });

  test("labels keep the end of the path", () => {
    expect(truncateUserFlowLabel("/cart", 21)).toBe("/cart");
    expect(truncateUserFlowLabel("/account/orders/:id/refund", 12)).toBe(
      "…/:id/refund",
    );
    expect(truncateUserFlowLabel("/cart", 12).length).toBeLessThanOrEqual(12);
  });
});
