import { describe, expect, test } from "@jest/globals";
import {
  UserFlowJourneysResponseDto,
  UserFlowSessionDto,
} from "../../../Types/Rum/UserFlow";
import {
  analyzeUserFlow,
  buildUserFlowGraph,
  buildUserFlowJourneys,
  buildUserFlowLoops,
  buildUserFlowPageStats,
  buildUserFlowPaths,
  isDynamicPathSegment,
  normalizeUserFlowOptions,
  OTHER_PAGES_KEY,
  sliceJourneyForMap,
  spansMultipleHosts,
  toSessionListUrlPrefix,
  toUserFlowPageKey,
  USER_FLOW_MAX_PATH_LENGTH,
  USER_FLOW_MAX_STEPS,
  USER_FLOW_MIN_STEPS,
  USER_FLOW_SAMPLE_SESSIONS,
  UserFlowAnalysis,
  UserFlowGraph,
  UserFlowInsight,
  UserFlowJourney,
  UserFlowLink,
  UserFlowNode,
  UserFlowPageStats,
} from "../../../Utils/Rum/UserFlow";

/*
 * The User Flows engine. Every number the page shows comes out of these
 * functions, so each count is pinned against a hand-worked fixture rather
 * than against the engine's own output.
 */

const ORIGIN: string = "https://shop.example.com";

interface SessionSpec {
  id: string;
  pages: Array<string>;
  errorCount?: number;
  frustrationCount?: number;
  durationMs?: number;
  deviceType?: string;
  /* [path, errors, frustration] */
  signals?: Array<[string, number, number]>;
}

/* Builds a response the way the endpoint does: one dictionary for every page. */
function response(specs: Array<SessionSpec>): UserFlowJourneysResponseDto {
  const pages: Array<string> = [];
  const indexOf: (path: string) => number = (path: string): number => {
    const url: string = path.startsWith("http") ? path : `${ORIGIN}${path}`;
    let index: number = pages.indexOf(url);

    if (index < 0) {
      index = pages.length;
      pages.push(url);
    }

    return index;
  };

  const sessions: Array<UserFlowSessionDto> = specs.map(
    (spec: SessionSpec, position: number): UserFlowSessionDto => {
      return {
        sessionId: spec.id,
        startUnixMs: 1_800_000_000_000 - position * 1000,
        durationMs: spec.durationMs ?? 60_000,
        deviceType: spec.deviceType ?? "desktop",
        browserName: "Chrome",
        countryCode: "DK",
        errorCount: spec.errorCount ?? 0,
        frustrationCount: spec.frustrationCount ?? 0,
        pages: spec.pages.map(indexOf),
        pageSignals: (spec.signals || []).map(
          ([path, errors, frustration]: [string, number, number]): [
            number,
            number,
            number,
          ] => {
            return [indexOf(path), errors, frustration];
          },
        ),
      };
    },
  );

  return {
    pages: pages,
    sessions: sessions,
    sessionsInWindow: sessions.length,
    isSampled: false,
    maxSessions: 5000,
    startUnixMs: 0,
    endUnixMs: 1,
  };
}

function journeysOf(specs: Array<SessionSpec>): Array<UserFlowJourney> {
  return buildUserFlowJourneys(response(specs), {
    groupDynamicSegments: true,
    hiddenPages: [],
    sessionFilter: "all",
    deviceType: "",
  }).journeys;
}

function node(
  graph: UserFlowGraph,
  step: number,
  page: string,
): UserFlowNode | undefined {
  return graph.nodes.find((candidate: UserFlowNode): boolean => {
    return candidate.step === step && candidate.page === page;
  });
}

function link(
  graph: UserFlowGraph,
  from: [number, string],
  to: [number, string],
): UserFlowLink | undefined {
  const source: UserFlowNode | undefined = node(graph, from[0], from[1]);
  const target: UserFlowNode | undefined = node(graph, to[0], to[1]);

  return graph.links.find((candidate: UserFlowLink): boolean => {
    return (
      candidate.sourceId === source?.id && candidate.targetId === target?.id
    );
  });
}

/*
 * The shop fixture used through most of this file. Five sessions:
 *   s1  /            -> /products -> /cart -> /checkout
 *   s2  /            -> /products -> /cart            (left on /cart)
 *   s3  /            -> /products -> /products/42     (left on a product)
 *   s4  /            (bounce)
 *   s5  /products/42 -> /cart     -> /checkout
 */
const SHOP: Array<SessionSpec> = [
  { id: "s1", pages: ["/", "/products", "/cart", "/checkout"] },
  { id: "s2", pages: ["/", "/products", "/cart"] },
  { id: "s3", pages: ["/", "/products", "/products/42"] },
  { id: "s4", pages: ["/"] },
  { id: "s5", pages: ["/products/42", "/cart", "/checkout"] },
];

describe("page keys", () => {
  test("strip origin, query and trailing slash", () => {
    const options: { groupDynamicSegments: boolean; includeHost: boolean } = {
      groupDynamicSegments: false,
      includeHost: false,
    };

    expect(toUserFlowPageKey("https://a.example.com/cart/", options)).toBe(
      "/cart",
    );
    expect(
      toUserFlowPageKey(
        "https://a.example.com/cart?coupon=[redacted]",
        options,
      ),
    ).toBe("/cart");
    expect(toUserFlowPageKey("https://a.example.com", options)).toBe("/");
    expect(toUserFlowPageKey("https://a.example.com/", options)).toBe("/");
    expect(toUserFlowPageKey("/relative/path", options)).toBe("/relative/path");
    expect(toUserFlowPageKey("", options)).toBe("/");
  });

  test("keep the host only when asked", () => {
    expect(
      toUserFlowPageKey("https://docs.example.com/start", {
        groupDynamicSegments: false,
        includeHost: true,
      }),
    ).toBe("docs.example.com/start");
    /* A relative URL has no host to keep. */
    expect(
      toUserFlowPageKey("/start", {
        groupDynamicSegments: false,
        includeHost: true,
      }),
    ).toBe("/start");
  });

  test("read a hash route as the path", () => {
    expect(
      toUserFlowPageKey("https://a.example.com/#/orders/7", {
        groupDynamicSegments: true,
        includeHost: false,
      }),
    ).toBe("/orders/:id");
  });

  test("group id-shaped segments, and only those", () => {
    const grouped: (url: string) => string = (url: string): string => {
      return toUserFlowPageKey(`https://a.example.com${url}`, {
        groupDynamicSegments: true,
        includeHost: false,
      });
    };

    expect(grouped("/orders/1042")).toBe("/orders/:id");
    expect(grouped("/orders/[redacted]/refund")).toBe("/orders/:id/refund");
    expect(grouped("/u/5f2b9c1e")).toBe("/u/:id");
    expect(grouped("/p/a1b2c3d4e5f6g7h8i9")).toBe("/p/:id");
    expect(grouped("/checkout/shipping")).toBe("/checkout/shipping");
    /* A word that happens to be hex letters only is a route, not an id. */
    expect(grouped("/feed/deadbeef")).toBe("/feed/deadbeef");
    expect(grouped("/v2/settings")).toBe("/v2/settings");
  });

  test("isDynamicPathSegment", () => {
    expect(isDynamicPathSegment("123")).toBe(true);
    expect(isDynamicPathSegment("[redacted]")).toBe(true);
    expect(isDynamicPathSegment("%5Bredacted%5D")).toBe(true);
    expect(isDynamicPathSegment("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(
      true,
    );
    expect(isDynamicPathSegment("pricing")).toBe(false);
    expect(isDynamicPathSegment("v2")).toBe(false);
    expect(isDynamicPathSegment("my-long-article-title-slug")).toBe(false);
  });

  test("spansMultipleHosts", () => {
    expect(
      spansMultipleHosts([
        "https://a.example.com/x",
        "https://a.example.com/y",
        "/relative",
      ]),
    ).toBe(false);
    expect(
      spansMultipleHosts(["https://a.example.com/x", "https://b.example.com/"]),
    ).toBe(true);
    expect(spansMultipleHosts([])).toBe(false);
  });

  test("the session-list prefix widens a grouped key to its static head", () => {
    expect(toSessionListUrlPrefix("/cart")).toBe("/cart");
    expect(toSessionListUrlPrefix("/orders/:id")).toBe("/orders/");
    expect(toSessionListUrlPrefix("/orders/:id/refund")).toBe("/orders/");
    expect(toSessionListUrlPrefix("shop.example.com/cart")).toBe("/cart");
    expect(toSessionListUrlPrefix(OTHER_PAGES_KEY)).toBe("");
    expect(toSessionListUrlPrefix("")).toBe("");
  });
});

describe("journeys", () => {
  test("group, hide and collapse, in that order", () => {
    const journeys: Array<UserFlowJourney> = buildUserFlowJourneys(
      response([
        {
          id: "a",
          pages: ["/cart", "/login", "/cart", "/orders/1", "/orders/2"],
        },
      ]),
      {
        groupDynamicSegments: true,
        hiddenPages: ["/login"],
        sessionFilter: "all",
        deviceType: "",
      },
    ).journeys;

    /*
     * Hiding /login joins the two /cart visits and grouping joins the two
     * orders, so the journey is two pages, not five.
     */
    expect(journeys[0]?.pages).toEqual(["/cart", "/orders/:id"]);
  });

  test("without grouping, distinct ids stay distinct", () => {
    const journeys: Array<UserFlowJourney> = buildUserFlowJourneys(
      response([{ id: "a", pages: ["/orders/1", "/orders/2"] }]),
      {
        groupDynamicSegments: false,
        hiddenPages: [],
        sessionFilter: "all",
        deviceType: "",
      },
    ).journeys;

    expect(journeys[0]?.pages).toEqual(["/orders/1", "/orders/2"]);
  });

  test("a session whose every page is hidden drops out", () => {
    const journeys: Array<UserFlowJourney> = buildUserFlowJourneys(
      response([
        { id: "a", pages: ["/login"] },
        { id: "b", pages: ["/login", "/home"] },
      ]),
      {
        groupDynamicSegments: true,
        hiddenPages: ["/login"],
        sessionFilter: "all",
        deviceType: "",
      },
    ).journeys;

    expect(
      journeys.map((journey: UserFlowJourney): string => {
        return journey.sessionId;
      }),
    ).toEqual(["b"]);
  });

  test("session and device filters", () => {
    const specs: Array<SessionSpec> = [
      { id: "clean", pages: ["/"] },
      { id: "broken", pages: ["/"], errorCount: 2 },
      { id: "angry", pages: ["/"], frustrationCount: 1, deviceType: "mobile" },
    ];
    const ids: (filter: {
      sessionFilter: "all" | "errors" | "frustration";
      deviceType: string;
    }) => Array<string> = (filter: {
      sessionFilter: "all" | "errors" | "frustration";
      deviceType: string;
    }): Array<string> => {
      return buildUserFlowJourneys(response(specs), {
        groupDynamicSegments: true,
        hiddenPages: [],
        ...filter,
      }).journeys.map((journey: UserFlowJourney): string => {
        return journey.sessionId;
      });
    };

    expect(ids({ sessionFilter: "all", deviceType: "" })).toEqual([
      "clean",
      "broken",
      "angry",
    ]);
    expect(ids({ sessionFilter: "errors", deviceType: "" })).toEqual([
      "broken",
    ]);
    expect(ids({ sessionFilter: "frustration", deviceType: "" })).toEqual([
      "angry",
    ]);
    expect(ids({ sessionFilter: "all", deviceType: "mobile" })).toEqual([
      "angry",
    ]);
  });

  test("signals are attributed to the grouped page", () => {
    const journeys: Array<UserFlowJourney> = journeysOf([
      {
        id: "a",
        pages: ["/", "/orders/7"],
        errorCount: 1,
        signals: [["/orders/7", 1, 0]],
      },
    ]);

    expect(Array.from(journeys[0]!.errorPages)).toEqual(["/orders/:id"]);
    expect(journeys[0]!.hadErrors).toBe(true);
    expect(journeys[0]!.frustrationPages.size).toBe(0);
  });

  test("keys carry the host when the application spans several", () => {
    const result: { journeys: Array<UserFlowJourney>; includesHost: boolean } =
      buildUserFlowJourneys(
        response([
          {
            id: "a",
            pages: ["https://www.example.com/", "https://app.example.com/"],
          },
        ]),
        {
          groupDynamicSegments: true,
          hiddenPages: [],
          sessionFilter: "all",
          deviceType: "",
        },
      );

    expect(result.includesHost).toBe(true);
    expect(result.journeys[0]?.pages).toEqual([
      "www.example.com/",
      "app.example.com/",
    ]);
  });
});

describe("slicing a journey for the map", () => {
  const pages: Array<string> = ["/a", "/b", "/c", "/b", "/d"];

  test("no anchor: the whole journey", () => {
    expect(sliceJourneyForMap(pages, null, "forward")).toEqual(pages);
  });

  test("forward: from the FIRST arrival at the anchor", () => {
    expect(sliceJourneyForMap(pages, "/b", "forward")).toEqual([
      "/b",
      "/c",
      "/b",
      "/d",
    ]);
  });

  test("backward: up to the first arrival, reversed", () => {
    expect(sliceJourneyForMap(pages, "/c", "backward")).toEqual([
      "/c",
      "/b",
      "/a",
    ]);
  });

  test("a journey that never reached the anchor is left out", () => {
    expect(sliceJourneyForMap(pages, "/zzz", "forward")).toBeNull();
  });
});

describe("the flow map from the session start", () => {
  const graph: UserFlowGraph = buildUserFlowGraph(journeysOf(SHOP), {
    anchorPage: null,
    direction: "forward",
    steps: 4,
    pagesPerStep: 6,
  });

  test("counts every session once per column", () => {
    expect(graph.sessions).toBe(5);
    expect(graph.steps).toBe(4);
    expect(node(graph, 0, "/")?.sessions).toBe(4);
    expect(node(graph, 0, "/products/:id")?.sessions).toBe(1);
    expect(node(graph, 1, "/products")?.sessions).toBe(3);
    expect(node(graph, 1, "/cart")?.sessions).toBe(1);
    expect(node(graph, 2, "/cart")?.sessions).toBe(1 + 1);
    expect(node(graph, 2, "/checkout")?.sessions).toBe(1);
    expect(node(graph, 2, "/products/:id")?.sessions).toBe(1);
    expect(node(graph, 3, "/checkout")?.sessions).toBe(1);
  });

  test("drop-offs are where journeys end", () => {
    expect(node(graph, 0, "/")?.terminal).toBe(1); // s4 bounced
    expect(node(graph, 2, "/cart")?.terminal).toBe(1); // s2
    expect(node(graph, 2, "/products/:id")?.terminal).toBe(1); // s3
    expect(node(graph, 2, "/checkout")?.terminal).toBe(1); // s5
    expect(node(graph, 3, "/checkout")?.terminal).toBe(1); // s1
  });

  test("links carry the sessions that made the move", () => {
    expect(link(graph, [0, "/"], [1, "/products"])?.sessions).toBe(3);
    expect(link(graph, [1, "/products"], [2, "/cart"])?.sessions).toBe(2);
    expect(link(graph, [1, "/products"], [2, "/products/:id"])?.sessions).toBe(
      1,
    );
    expect(link(graph, [0, "/products/:id"], [1, "/cart"])?.sessions).toBe(1);
  });

  test("flow is conserved: in = out + terminal + continued", () => {
    for (const current of graph.nodes) {
      const outgoing: number = graph.links
        .filter((candidate: UserFlowLink): boolean => {
          return candidate.sourceId === current.id;
        })
        .reduce((sum: number, candidate: UserFlowLink): number => {
          return sum + candidate.sessions;
        }, 0);

      expect(outgoing + current.terminal + current.continued).toBe(
        current.sessions,
      );
    }
  });

  test("a journey longer than the map is marked as continuing", () => {
    const short: UserFlowGraph = buildUserFlowGraph(journeysOf(SHOP), {
      anchorPage: null,
      direction: "forward",
      steps: 2,
      pagesPerStep: 6,
    });

    expect(node(short, 1, "/products")?.continued).toBe(3);
    expect(node(short, 1, "/products")?.terminal).toBe(0);
    expect(node(short, 1, "/cart")?.continued).toBe(1);
  });

  test("sample sessions are capped", () => {
    const many: Array<SessionSpec> = [];

    for (let index: number = 0; index < 12; index++) {
      many.push({ id: `m${index}`, pages: ["/", "/a"] });
    }

    const busy: UserFlowGraph = buildUserFlowGraph(journeysOf(many), {
      anchorPage: null,
      direction: "forward",
      steps: 3,
      pagesPerStep: 6,
    });

    expect(node(busy, 0, "/")?.sampleSessionIds).toHaveLength(
      USER_FLOW_SAMPLE_SESSIONS,
    );
    expect(node(busy, 0, "/")?.sampleSessionIds[0]).toBe("m0");
  });

  test("nodes come sorted by step, then by traffic", () => {
    const steps: Array<number> = graph.nodes.map(
      (candidate: UserFlowNode): number => {
        return candidate.step;
      },
    );

    expect(steps).toEqual([...steps].sort());
    expect(graph.nodes[0]?.page).toBe("/");
  });
});

describe("folding quiet pages into Other pages", () => {
  const specs: Array<SessionSpec> = [
    { id: "1", pages: ["/", "/a"] },
    { id: "2", pages: ["/", "/a"] },
    { id: "3", pages: ["/", "/a"] },
    { id: "4", pages: ["/", "/b"] },
    { id: "5", pages: ["/", "/b"] },
    { id: "6", pages: ["/", "/c"] },
    { id: "7", pages: ["/", "/d"] },
  ];

  test("everything past the busiest N shares one node", () => {
    const graph: UserFlowGraph = buildUserFlowGraph(journeysOf(specs), {
      anchorPage: null,
      direction: "forward",
      steps: 2,
      pagesPerStep: 2,
    });
    const other: UserFlowNode | undefined = node(graph, 1, OTHER_PAGES_KEY);

    expect(node(graph, 1, "/a")?.sessions).toBe(3);
    expect(node(graph, 1, "/b")?.sessions).toBe(2);
    expect(other?.isOther).toBe(true);
    expect(other?.sessions).toBe(2);
    expect(other?.otherPages).toEqual([
      { page: "/c", sessions: 1 },
      { page: "/d", sessions: 1 },
    ]);
    expect(link(graph, [0, "/"], [1, OTHER_PAGES_KEY])?.sessions).toBe(2);

    /* Other sits at the bottom of its column. */
    const column: Array<UserFlowNode> = graph.nodes.filter(
      (candidate: UserFlowNode): boolean => {
        return candidate.step === 1;
      },
    );

    expect(column[column.length - 1]?.isOther).toBe(true);
  });

  test("a single overflowing page keeps its name instead of becoming Other", () => {
    const graph: UserFlowGraph = buildUserFlowGraph(journeysOf(specs), {
      anchorPage: null,
      direction: "forward",
      steps: 2,
      pagesPerStep: 3,
    });

    expect(node(graph, 1, OTHER_PAGES_KEY)).toBeUndefined();
    expect(node(graph, 1, "/c")?.sessions).toBe(1);
    expect(node(graph, 1, "/d")?.sessions).toBe(1);
  });
});

describe("anchored maps", () => {
  test("forward from /products", () => {
    const graph: UserFlowGraph = buildUserFlowGraph(journeysOf(SHOP), {
      anchorPage: "/products",
      direction: "forward",
      steps: 3,
      pagesPerStep: 6,
    });

    expect(graph.anchorPage).toBe("/products");
    expect(graph.sessions).toBe(3); // s1, s2, s3 visited /products
    expect(node(graph, 0, "/products")?.sessions).toBe(3);
    expect(node(graph, 1, "/cart")?.sessions).toBe(2);
    expect(node(graph, 1, "/products/:id")?.sessions).toBe(1);
    expect(node(graph, 2, "/checkout")?.sessions).toBe(1);
  });

  test("backward into /checkout: the anchor is step 0 and bands run in lived order", () => {
    const graph: UserFlowGraph = buildUserFlowGraph(journeysOf(SHOP), {
      anchorPage: "/checkout",
      direction: "backward",
      steps: 4,
      pagesPerStep: 6,
    });

    expect(graph.direction).toBe("backward");
    expect(graph.sessions).toBe(2); // s1 and s5
    expect(node(graph, 0, "/checkout")?.sessions).toBe(2);
    expect(node(graph, 1, "/cart")?.sessions).toBe(2);
    expect(node(graph, 2, "/products")?.sessions).toBe(1);
    expect(node(graph, 2, "/products/:id")?.sessions).toBe(1);

    /* /cart -> /checkout: the source is the page lived first. */
    const cartToCheckout: UserFlowLink | undefined = link(
      graph,
      [1, "/cart"],
      [0, "/checkout"],
    );

    expect(cartToCheckout?.sessions).toBe(2);
    expect(cartToCheckout?.fromPage).toBe("/cart");
    expect(cartToCheckout?.toPage).toBe("/checkout");

    /* s5 started on the product page; s1 started on "/". */
    expect(node(graph, 2, "/products/:id")?.terminal).toBe(1);
    expect(node(graph, 3, "/")?.terminal).toBe(1);
  });

  test("an anchor nobody visited draws an empty map", () => {
    const graph: UserFlowGraph = buildUserFlowGraph(journeysOf(SHOP), {
      anchorPage: "/nowhere",
      direction: "forward",
      steps: 3,
      pagesPerStep: 6,
    });

    expect(graph.sessions).toBe(0);
    expect(graph.nodes).toEqual([]);
    expect(graph.links).toEqual([]);
  });

  test("direction is ignored without an anchor", () => {
    const graph: UserFlowGraph = buildUserFlowGraph(journeysOf(SHOP), {
      anchorPage: null,
      direction: "backward",
      steps: 3,
      pagesPerStep: 6,
    });

    expect(graph.direction).toBe("forward");
  });
});

describe("revisits", () => {
  test("a band into a page already seen is counted as a revisit", () => {
    const graph: UserFlowGraph = buildUserFlowGraph(
      journeysOf([
        { id: "a", pages: ["/list", "/item", "/list", "/item"] },
        { id: "b", pages: ["/list", "/item", "/done"] },
      ]),
      {
        anchorPage: null,
        direction: "forward",
        steps: 4,
        pagesPerStep: 6,
      },
    );

    expect(link(graph, [0, "/list"], [1, "/item"])?.revisitSessions).toBe(0);
    expect(link(graph, [1, "/item"], [2, "/list"])?.revisitSessions).toBe(1);
    expect(link(graph, [2, "/list"], [3, "/item"])?.revisitSessions).toBe(1);
    expect(link(graph, [1, "/item"], [2, "/done"])?.revisitSessions).toBe(0);
  });

  test("forward from an anchor remembers what came before it", () => {
    const graph: UserFlowGraph = buildUserFlowGraph(
      journeysOf([{ id: "a", pages: ["/home", "/item", "/home"] }]),
      {
        anchorPage: "/item",
        direction: "forward",
        steps: 3,
        pagesPerStep: 6,
      },
    );

    expect(link(graph, [0, "/item"], [1, "/home"])?.revisitSessions).toBe(1);
  });

  test("backward maps judge revisits in lived order", () => {
    /* Lived: /a -> /b -> /a -> /c. Backward from /c. */
    const graph: UserFlowGraph = buildUserFlowGraph(
      journeysOf([{ id: "x", pages: ["/a", "/b", "/a", "/c"] }]),
      {
        anchorPage: "/c",
        direction: "backward",
        steps: 4,
        pagesPerStep: 6,
      },
    );

    /* /b -> /a (step 2 -> step 1) returned to /a, which was seen first. */
    expect(link(graph, [2, "/b"], [1, "/a"])?.revisitSessions).toBe(1);
    expect(link(graph, [3, "/a"], [2, "/b"])?.revisitSessions).toBe(0);
    expect(link(graph, [1, "/a"], [0, "/c"])?.revisitSessions).toBe(0);
  });

  test("backward revisits count pages beyond the drawn columns", () => {
    /* Lived: /a -> /b -> /a -> /c; only two columns drawn back from /c. */
    const graph: UserFlowGraph = buildUserFlowGraph(
      journeysOf([{ id: "x", pages: ["/a", "/b", "/a", "/c"] }]),
      {
        anchorPage: "/c",
        direction: "backward",
        steps: 2,
        pagesPerStep: 6,
      },
    );

    expect(node(graph, 1, "/a")?.continued).toBe(1);
    expect(link(graph, [1, "/a"], [0, "/c"])?.revisitSessions).toBe(0);
  });
});

describe("page statistics", () => {
  const pages: Array<UserFlowPageStats> = buildUserFlowPageStats(
    journeysOf([
      ...SHOP,
      {
        id: "s6",
        pages: ["/", "/cart", "/", "/cart"],
        errorCount: 1,
        frustrationCount: 2,
        signals: [
          ["/cart", 1, 2],
          ["/", 0, 0],
        ],
      },
    ]),
  );
  const byPage: (page: string) => UserFlowPageStats = (
    page: string,
  ): UserFlowPageStats => {
    return pages.find((candidate: UserFlowPageStats): boolean => {
      return candidate.page === page;
    }) as UserFlowPageStats;
  };

  test("sessions count people, views count visits", () => {
    expect(byPage("/").sessions).toBe(5);
    expect(byPage("/").views).toBe(6);
    expect(byPage("/cart").sessions).toBe(4);
    expect(byPage("/cart").views).toBe(5);
  });

  test("entries, exits, bounces and exit rate", () => {
    expect(byPage("/").entries).toBe(5);
    expect(byPage("/").bounces).toBe(1);
    expect(byPage("/").exits).toBe(1);
    expect(byPage("/cart").exits).toBe(2); // s2, s6
    expect(byPage("/cart").exitRate).toBeCloseTo(0.5);
    expect(byPage("/checkout").exitRate).toBe(1);
  });

  test("next and previous count sessions, not transitions", () => {
    /* s6 goes / -> /cart twice; it still counts once. */
    expect(byPage("/").next).toEqual([
      { page: "/products", sessions: 3 },
      { page: "/cart", sessions: 1 },
    ]);
    expect(byPage("/cart").previous).toEqual([
      { page: "/products", sessions: 2 },
      { page: "/", sessions: 1 },
      { page: "/products/:id", sessions: 1 },
    ]);
  });

  test("errors and frustration are per page", () => {
    expect(byPage("/cart").errorSessions).toBe(1);
    expect(byPage("/cart").frustrationSessions).toBe(1);
    expect(byPage("/").errorSessions).toBe(0);
  });

  test("busiest first", () => {
    expect(pages[0]?.page).toBe("/");
  });
});

describe("paths", () => {
  test("identical journeys fold together, busiest first", () => {
    const paths: Array<{ pages: Array<string>; sessions: number }> =
      buildUserFlowPaths(
        journeysOf([
          { id: "1", pages: ["/", "/a"], durationMs: 10_000 },
          { id: "2", pages: ["/", "/a"], durationMs: 30_000, errorCount: 1 },
          { id: "3", pages: ["/"] },
        ]),
      );

    expect(paths).toEqual([
      expect.objectContaining({
        pages: ["/", "/a"],
        sessions: 2,
        share: 2 / 3,
        avgDurationMs: 20_000,
        errorSessions: 1,
        sampleSessionIds: ["1", "2"],
        isTruncated: false,
      }),
      expect.objectContaining({ pages: ["/"], sessions: 1 }),
    ]);
  });

  test("long journeys are cut and marked", () => {
    const pages: Array<string> = [];

    for (
      let index: number = 0;
      index < USER_FLOW_MAX_PATH_LENGTH + 3;
      index++
    ) {
      pages.push(`/step-${String.fromCharCode(97 + index)}`);
    }

    const paths: ReturnType<typeof buildUserFlowPaths> = buildUserFlowPaths(
      journeysOf([{ id: "1", pages: pages }]),
    );

    expect(paths[0]?.pages).toHaveLength(USER_FLOW_MAX_PATH_LENGTH);
    expect(paths[0]?.isTruncated).toBe(true);
  });
});

describe("loops", () => {
  test("A -> B -> A counts once per session and per pair", () => {
    const loops: ReturnType<typeof buildUserFlowLoops> = buildUserFlowLoops(
      journeysOf([
        { id: "1", pages: ["/list", "/item", "/list", "/item", "/list"] },
        { id: "2", pages: ["/item", "/list", "/item"] },
        { id: "3", pages: ["/list", "/item", "/done"] },
        { id: "4", pages: ["/a", "/b", "/a"] },
      ]),
    );

    expect(loops[0]).toEqual(
      expect.objectContaining({
        pageA: "/item",
        pageB: "/list",
        sessions: 2,
        share: 0.5,
        sampleSessionIds: ["1", "2"],
      }),
    );
    expect(loops[1]).toEqual(
      expect.objectContaining({ pageA: "/a", pageB: "/b", sessions: 1 }),
    );
  });
});

describe("summary and findings", () => {
  test("summary", () => {
    const analysis: UserFlowAnalysis = analyzeUserFlow(response(SHOP), {});

    expect(analysis.summary).toEqual({
      sessions: 5,
      navigatingSessions: 4,
      bounceRate: 0.2,
      avgPagesPerSession: (4 + 3 + 3 + 1 + 3) / 5,
      medianPagesPerSession: 3,
      uniquePages: 5,
      topEntryPage: { page: "/", sessions: 4 },
      /* /cart and /checkout both end 2 journeys... */
      topExitPage: expect.objectContaining({ sessions: 2 }),
    });
  });

  test("an empty response analyses to zeros, not NaN", () => {
    const analysis: UserFlowAnalysis = analyzeUserFlow(response([]), {});

    expect(analysis.summary.sessions).toBe(0);
    expect(analysis.summary.bounceRate).toBe(0);
    expect(analysis.summary.avgPagesPerSession).toBe(0);
    expect(analysis.graph.nodes).toEqual([]);
    expect(analysis.insights).toEqual([]);
  });

  test("findings name the pages that deserve a look", () => {
    const specs: Array<SessionSpec> = [];

    /* 10 sessions reach /pay; 8 give up there, all 8 hit an error on it. */
    for (let index: number = 0; index < 10; index++) {
      const failed: boolean = index < 8;

      specs.push({
        id: `pay-${index}`,
        pages: failed ? ["/", "/cart", "/pay"] : ["/", "/cart", "/pay", "/ok"],
        errorCount: failed ? 1 : 0,
        signals: failed ? [["/pay", 1, 0]] : [],
      });
    }

    /* 4 sessions bounce between /cart and /help. */
    for (let index: number = 0; index < 4; index++) {
      specs.push({
        id: `loop-${index}`,
        pages: ["/", "/cart", "/help", "/cart", "/ok"],
        frustrationCount: 1,
        signals: [["/help", 0, 3]],
      });
    }

    const insights: Array<UserFlowInsight> = analyzeUserFlow(
      response(specs),
      {},
    ).insights;
    const byKind: (kind: string) => UserFlowInsight | undefined = (
      kind: string,
    ): UserFlowInsight | undefined => {
      return insights.find((insight: UserFlowInsight): boolean => {
        return insight.kind === kind;
      });
    };

    expect(byKind("error-hotspot")).toEqual(
      expect.objectContaining({ page: "/pay", sessions: 8, share: 0.8 }),
    );
    expect(byKind("drop-off")).toEqual(
      expect.objectContaining({ page: "/pay", sessions: 8, share: 0.8 }),
    );
    expect(byKind("drop-off")?.tone).toBe("danger");
    /* A drop-off opens the map on how people got there; the rest look ahead. */
    expect(byKind("drop-off")?.focusDirection).toBe("backward");
    expect(byKind("error-hotspot")?.focusDirection).toBe("forward");
    expect(byKind("loop")?.focusDirection).toBe("forward");
    expect(byKind("frustration-hotspot")).toEqual(
      expect.objectContaining({ page: "/help", sessions: 4, share: 1 }),
    );
    expect(byKind("loop")).toEqual(
      expect.objectContaining({
        page: "/cart",
        secondaryPage: "/help",
        sessions: 4,
      }),
    );
    expect(byKind("top-entry")).toEqual(
      expect.objectContaining({ page: "/", sessions: 14, share: 1 }),
    );
    /* The copy carries the same numbers the tables show. */
    expect(byKind("error-hotspot")?.detail).toContain("80%");
    expect(byKind("error-hotspot")?.detail).toContain("8 sessions");
  });

  test("a page every journey ends on is a natural end, not a drop-off", () => {
    const specs: Array<SessionSpec> = [];

    for (let index: number = 0; index < 10; index++) {
      specs.push({ id: `done-${index}`, pages: ["/", "/cart", "/thanks"] });
    }

    const insights: Array<UserFlowInsight> = analyzeUserFlow(
      response(specs),
      {},
    ).insights;

    expect(
      insights.find((insight: UserFlowInsight): boolean => {
        return insight.kind === "drop-off";
      }),
    ).toBeUndefined();
  });

  test("findings need a minimum sample", () => {
    const insights: Array<UserFlowInsight> = analyzeUserFlow(
      response([
        { id: "1", pages: ["/", "/x"], errorCount: 1, signals: [["/x", 1, 0]] },
        { id: "2", pages: ["/", "/y"] },
      ]),
      {},
    ).insights;

    expect(
      insights.map((insight: UserFlowInsight): string => {
        return insight.kind;
      }),
    ).toEqual(["top-entry"]);
  });
});

describe("options", () => {
  test("are clamped and cleaned", () => {
    const options: ReturnType<typeof normalizeUserFlowOptions> =
      normalizeUserFlowOptions({
        steps: 99,
        pagesPerStep: -3,
        anchorPage: "/cart",
        hiddenPages: ["/cart", "", "/login"],
      });

    expect(options.steps).toBe(USER_FLOW_MAX_STEPS);
    expect(options.pagesPerStep).toBe(2);
    /* The anchor can never be hidden. */
    expect(options.hiddenPages).toEqual(["/login"]);
    expect(normalizeUserFlowOptions({ steps: Number.NaN }).steps).toBe(
      USER_FLOW_MIN_STEPS,
    );
    expect(normalizeUserFlowOptions({ anchorPage: "" }).anchorPage).toBeNull();
  });

  test("analyzeUserFlow exposes pickers for the toolbar", () => {
    const analysis: UserFlowAnalysis = analyzeUserFlow(
      response([...SHOP, { id: "m", pages: ["/"], deviceType: "mobile" }]),
      {},
    );

    expect(analysis.availablePages[0]).toEqual({ page: "/", sessions: 5 });
    expect(analysis.deviceTypes).toEqual(["desktop", "mobile"]);
    expect(analysis.includesHost).toBe(false);
  });
});
