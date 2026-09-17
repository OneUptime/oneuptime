import { describe, expect, test } from "@jest/globals";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  CENTER_NODE_ID,
  CLASS_NODE_PREFIX,
  CorrelationGraphData,
  CorrelationGraphEdge,
  CorrelationGraphNode,
  CorrelationGraphSummary,
  CorrelationNeighborhood,
  OBSERVABLE_NODE_PREFIX,
  UNCLASSIFIED_CLASS_NAME,
  buildCorrelationGraph,
  dedupeSecurityEvents,
  getCorrelationGraphSummary,
  getCorrelationNeighborhood,
  rankClassNodes,
  rankObservableNodes,
  severityRank,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/CorrelationGraph";

/*
 * The correlate graph builder aggregates fetched events into the
 * center/class/observable neighborhood: event counts per class, worst
 * severity per class (for node tinting), co-observable counting with
 * per-event dedupe, exclusion of the searched values, the top-N cap with
 * honest drop accounting, and the union-dedupe used when OR mode runs one
 * query per condition. All pinned here as pure data — no React, no
 * ReactFlow.
 */

interface EventInput {
  id?: string;
  eventUid?: string;
  className?: string;
  severityName?: OcsfSeverity;
  observables?: Array<string>;
  time?: Date;
}

function buildEvent(input: EventInput): SecurityEvent {
  const event: SecurityEvent = new SecurityEvent();
  if (input.id) {
    event._id = new ObjectID(input.id);
  }
  if (input.eventUid) {
    event.eventUid = input.eventUid;
  }
  if (input.className) {
    event.className = input.className;
  }
  if (input.severityName) {
    event.severityName = input.severityName;
  }
  event.observables = input.observables || [];
  if (input.time) {
    event.time = input.time;
  }
  return event;
}

function nodeById(
  graph: CorrelationGraphData,
  id: string,
): CorrelationGraphNode | undefined {
  return graph.nodes.find((node: CorrelationGraphNode) => {
    return node.id === id;
  });
}

function edgeById(
  graph: CorrelationGraphData,
  id: string,
): CorrelationGraphEdge | undefined {
  return graph.edges.find((edge: CorrelationGraphEdge) => {
    return edge.id === id;
  });
}

function classId(className: string): string {
  return `${CLASS_NODE_PREFIX}${className}`;
}

function observableId(observable: string): string {
  return `${OBSERVABLE_NODE_PREFIX}${observable}`;
}

function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}

function nodeIdsOf(graph: CorrelationGraphData): Array<string> {
  return graph.nodes.map((node: CorrelationGraphNode) => {
    return node.id;
  });
}

function labelsOf(nodes: Array<CorrelationGraphNode>): Array<string> {
  return nodes.map((node: CorrelationGraphNode) => {
    return node.label;
  });
}

function observableNodesOf(
  graph: CorrelationGraphData,
): Array<CorrelationGraphNode> {
  return graph.nodes.filter((node: CorrelationGraphNode) => {
    return node.kind === "observable";
  });
}

function classNode(
  label: string,
  count: number | undefined,
  worstSeverity?: OcsfSeverity,
): CorrelationGraphNode {
  return {
    id: classId(label),
    label: label,
    kind: "class",
    count: count,
    worstSeverity: worstSeverity,
  };
}

function observableNode(
  label: string,
  count: number | undefined,
): CorrelationGraphNode {
  return {
    id: observableId(label),
    label: label,
    kind: "observable",
    count: count,
  };
}

/*
 * Ranking helpers only look at nodes, so these graphs are hand-built with
 * the nodes deliberately out of order — a sort that silently relied on the
 * builder's alphabetical insertion order would pass a built fixture.
 */
function handBuiltGraph(
  nodes: Array<CorrelationGraphNode>,
): CorrelationGraphData {
  return {
    nodes: [{ id: CENTER_NODE_ID, label: "center", kind: "center" }, ...nodes],
    edges: [],
    droppedCoObservableCount: 0,
  };
}

// Same shape as the cap test: 5 distinct co-observables, cap of 2 → 3 dropped.
function buildCappedGraph(): CorrelationGraphData {
  const events: Array<SecurityEvent> = [];
  for (let eventIndex: number = 0; eventIndex < 3; eventIndex++) {
    events.push(
      buildEvent({
        className: "Authentication",
        severityName: OcsfSeverity.High,
        observables: ["popular", `rare-${eventIndex}`],
      }),
    );
  }
  events.push(
    buildEvent({ className: "Authentication", observables: ["rare-3"] }),
  );

  return buildCorrelationGraph({
    events: events,
    centerLabel: "c",
    excludedObservables: [],
    maxCoObservables: 2,
  });
}

/*
 * The neighbourhood fixture: "alice" is shared by Authentication and
 * Process Activity, "bob" and "carol" belong to one class each, Network
 * Activity only reaches "dave", and Compliance Finding has no co-observables
 * at all. "searched" is the filter value and never becomes a node.
 */
function buildNeighborhoodGraph(): CorrelationGraphData {
  return buildCorrelationGraph({
    events: [
      buildEvent({
        className: "Authentication",
        severityName: OcsfSeverity.High,
        observables: ["searched", "alice", "bob"],
      }),
      buildEvent({
        className: "Authentication",
        observables: ["searched", "alice"],
      }),
      buildEvent({
        className: "Process Activity",
        observables: ["searched", "alice", "carol"],
      }),
      buildEvent({
        className: "Network Activity",
        observables: ["searched", "dave"],
      }),
      buildEvent({
        className: "Compliance Finding",
        observables: ["searched"],
      }),
    ],
    centerLabel: 'Observable is "searched"',
    excludedObservables: ["searched"],
  });
}

describe("severityRank", () => {
  test("orders real severities and puts Unknown/Other/blank at the bottom", () => {
    expect(severityRank(OcsfSeverity.Fatal)).toBeGreaterThan(
      severityRank(OcsfSeverity.Critical),
    );
    expect(severityRank(OcsfSeverity.Critical)).toBeGreaterThan(
      severityRank(OcsfSeverity.High),
    );
    expect(severityRank(OcsfSeverity.High)).toBeGreaterThan(
      severityRank(OcsfSeverity.Medium),
    );
    expect(severityRank(OcsfSeverity.Medium)).toBeGreaterThan(
      severityRank(OcsfSeverity.Low),
    );
    expect(severityRank(OcsfSeverity.Low)).toBeGreaterThan(
      severityRank(OcsfSeverity.Informational),
    );
    expect(severityRank(OcsfSeverity.Unknown)).toBe(0);
    expect(severityRank(OcsfSeverity.Other)).toBe(0);
    expect(severityRank(undefined)).toBe(0);
    expect(severityRank("")).toBe(0);
  });
});

describe("buildCorrelationGraph", () => {
  test("no events → empty graph", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [],
      centerLabel: 'Observable is "x"',
      excludedObservables: ["x"],
    });
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(graph.droppedCoObservableCount).toBe(0);
  });

  test("one node per class with event counts on the center edges", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({ className: "Authentication", observables: ["host-1"] }),
        buildEvent({ className: "Authentication", observables: ["host-1"] }),
        buildEvent({ className: "Process Activity", observables: ["host-1"] }),
        buildEvent({ observables: ["host-1"] }), // no class → Unclassified
      ],
      centerLabel: "center-label",
      excludedObservables: ["host-1"],
    });

    const center: CorrelationGraphNode | undefined = nodeById(
      graph,
      CENTER_NODE_ID,
    );
    expect(center).toBeTruthy();
    expect(center?.label).toBe("center-label");
    expect(center?.kind).toBe("center");

    const authClass: CorrelationGraphNode | undefined = nodeById(
      graph,
      `${CLASS_NODE_PREFIX}Authentication`,
    );
    expect(authClass?.count).toBe(2);
    expect(
      edgeById(graph, `${CENTER_NODE_ID}->${CLASS_NODE_PREFIX}Authentication`)
        ?.count,
    ).toBe(2);

    expect(nodeById(graph, `${CLASS_NODE_PREFIX}Unclassified`)?.count).toBe(1);
    expect(nodeById(graph, `${CLASS_NODE_PREFIX}Process Activity`)?.count).toBe(
      1,
    );

    // Excluded observable never becomes a node.
    expect(nodeById(graph, `${OBSERVABLE_NODE_PREFIX}host-1`)).toBeUndefined();
  });

  test("class nodes carry the WORST severity among their events", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({
          className: "Authentication",
          severityName: OcsfSeverity.Low,
        }),
        buildEvent({
          className: "Authentication",
          severityName: OcsfSeverity.Critical,
        }),
        buildEvent({
          className: "Authentication",
          severityName: OcsfSeverity.Medium,
        }),
        buildEvent({
          className: "Compliance Finding",
          severityName: OcsfSeverity.Unknown,
        }),
      ],
      centerLabel: "c",
      excludedObservables: [],
    });

    expect(
      nodeById(graph, `${CLASS_NODE_PREFIX}Authentication`)?.worstSeverity,
    ).toBe(OcsfSeverity.Critical);
    /*
     * Unknown ranks zero — the node gets NO severity rather than
     * pretending "Unknown" is a color-worthy signal.
     */
    expect(
      nodeById(graph, `${CLASS_NODE_PREFIX}Compliance Finding`)?.worstSeverity,
    ).toBeUndefined();
  });

  test("co-observables count once per event even when repeated in one row", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({
          className: "Authentication",
          observables: ["searched", "alice", "alice", "alice"],
        }),
        buildEvent({
          className: "Authentication",
          observables: ["searched", "alice"],
        }),
      ],
      centerLabel: "c",
      excludedObservables: ["searched"],
    });

    expect(
      edgeById(
        graph,
        `${CLASS_NODE_PREFIX}Authentication->${OBSERVABLE_NODE_PREFIX}alice`,
      )?.count,
    ).toBe(2);
  });

  test("empty observable strings are ignored", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({ className: "Authentication", observables: ["", "alice"] }),
      ],
      centerLabel: "c",
      excludedObservables: [],
    });
    expect(nodeById(graph, `${OBSERVABLE_NODE_PREFIX}alice`)).toBeTruthy();
    expect(nodeById(graph, `${OBSERVABLE_NODE_PREFIX}`)).toBeUndefined();
  });

  test("an observable shared by two classes gets ONE node and two edges", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({ className: "Authentication", observables: ["alice"] }),
        buildEvent({ className: "Process Activity", observables: ["alice"] }),
      ],
      centerLabel: "c",
      excludedObservables: [],
    });

    const observableNodes: Array<CorrelationGraphNode> = graph.nodes.filter(
      (node: CorrelationGraphNode) => {
        return node.kind === "observable";
      },
    );
    expect(observableNodes).toHaveLength(1);
    expect(
      edgeById(
        graph,
        `${CLASS_NODE_PREFIX}Authentication->${OBSERVABLE_NODE_PREFIX}alice`,
      ),
    ).toBeTruthy();
    expect(
      edgeById(
        graph,
        `${CLASS_NODE_PREFIX}Process Activity->${OBSERVABLE_NODE_PREFIX}alice`,
      ),
    ).toBeTruthy();
  });

  test("caps co-observables at the most frequent N and reports the drop count", () => {
    const events: Array<SecurityEvent> = [];
    // "popular" appears in 3 events, every "rare-N" in exactly one.
    for (let eventIndex: number = 0; eventIndex < 3; eventIndex++) {
      events.push(
        buildEvent({
          className: "Authentication",
          observables: ["popular", `rare-${eventIndex}`],
        }),
      );
    }
    events.push(
      buildEvent({ className: "Authentication", observables: ["rare-3"] }),
    );

    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: events,
      centerLabel: "c",
      excludedObservables: [],
      maxCoObservables: 2,
    });

    const observableNodes: Array<CorrelationGraphNode> = graph.nodes.filter(
      (node: CorrelationGraphNode) => {
        return node.kind === "observable";
      },
    );
    expect(observableNodes).toHaveLength(2);
    // Highest count first, then alphabetical among the tied rares.
    expect(nodeById(graph, `${OBSERVABLE_NODE_PREFIX}popular`)).toBeTruthy();
    expect(nodeById(graph, `${OBSERVABLE_NODE_PREFIX}rare-0`)).toBeTruthy();
    expect(graph.droppedCoObservableCount).toBe(3);
  });

  test("cap exactly met → nothing reported dropped", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({ className: "Authentication", observables: ["a", "b"] }),
      ],
      centerLabel: "c",
      excludedObservables: [],
      maxCoObservables: 2,
    });
    expect(graph.droppedCoObservableCount).toBe(0);
  });
});

describe("dedupeSecurityEvents", () => {
  test("unions result sets by row id", () => {
    const shared: SecurityEvent = buildEvent({
      id: "11111111-1111-4111-8111-111111111111",
      className: "Authentication",
    });
    const onlyFirst: SecurityEvent = buildEvent({
      id: "22222222-2222-4222-8222-222222222222",
    });
    const onlySecond: SecurityEvent = buildEvent({
      id: "33333333-3333-4333-8333-333333333333",
    });

    const deduped: Array<SecurityEvent> = dedupeSecurityEvents([
      [onlyFirst, shared],
      [shared, onlySecond],
    ]);

    expect(deduped).toHaveLength(3);
    expect(deduped[0]).toBe(onlyFirst);
    expect(deduped[1]).toBe(shared);
    expect(deduped[2]).toBe(onlySecond);
  });

  test("two model instances with the SAME id count once", () => {
    const first: SecurityEvent = buildEvent({
      id: "11111111-1111-4111-8111-111111111111",
    });
    const second: SecurityEvent = buildEvent({
      id: "11111111-1111-4111-8111-111111111111",
    });
    expect(dedupeSecurityEvents([[first], [second]])).toHaveLength(1);
  });

  test("falls back to eventUid + time when _id was not selected", () => {
    const time: Date = new Date("2026-08-25T10:00:00.000Z");
    const first: SecurityEvent = buildEvent({ eventUid: "uid-1", time });
    const duplicate: SecurityEvent = buildEvent({ eventUid: "uid-1", time });
    const differentTime: SecurityEvent = buildEvent({
      eventUid: "uid-1",
      time: new Date("2026-08-25T11:00:00.000Z"),
    });

    expect(
      dedupeSecurityEvents([[first], [duplicate], [differentTime]]),
    ).toHaveLength(2);
  });
});

describe("UNCLASSIFIED_CLASS_NAME", () => {
  test("is the display name of the no-class bucket", () => {
    expect(UNCLASSIFIED_CLASS_NAME).toBe("Unclassified");
  });

  test("events with a missing or blank className share one Unclassified node", () => {
    const blankClass: SecurityEvent = buildEvent({
      severityName: OcsfSeverity.Medium,
      observables: ["alice"],
    });
    blankClass.className = "";

    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({ severityName: OcsfSeverity.Low, observables: ["bob"] }),
        blankClass,
        buildEvent({ className: "Authentication", observables: ["alice"] }),
      ],
      centerLabel: "c",
      excludedObservables: [],
    });

    const unclassified: CorrelationGraphNode | undefined = nodeById(
      graph,
      classId(UNCLASSIFIED_CLASS_NAME),
    );
    expect(unclassified).toBeTruthy();
    expect(unclassified?.label).toBe(UNCLASSIFIED_CLASS_NAME);
    expect(unclassified?.kind).toBe("class");
    expect(unclassified?.count).toBe(2);
    expect(unclassified?.worstSeverity).toBe(OcsfSeverity.Medium);

    const unclassifiedNodes: Array<CorrelationGraphNode> = graph.nodes.filter(
      (node: CorrelationGraphNode) => {
        return node.label === UNCLASSIFIED_CLASS_NAME;
      },
    );
    expect(unclassifiedNodes).toHaveLength(1);

    // Its observables hang off the bucket like any other class.
    expect(
      edgeById(
        graph,
        edgeId(classId(UNCLASSIFIED_CLASS_NAME), observableId("alice")),
      )?.count,
    ).toBe(1);
    expect(
      edgeById(
        graph,
        edgeId(classId(UNCLASSIFIED_CLASS_NAME), observableId("bob")),
      )?.count,
    ).toBe(1);
    expect(
      edgeById(graph, edgeId(CENTER_NODE_ID, classId(UNCLASSIFIED_CLASS_NAME)))
        ?.count,
    ).toBe(2);
  });
});

describe("observable node counts", () => {
  test("count is the number of matching events that mention the observable, across classes", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({ className: "Authentication", observables: ["alice"] }),
        buildEvent({
          className: "Authentication",
          observables: ["alice", "bob"],
        }),
        buildEvent({ className: "Process Activity", observables: ["alice"] }),
      ],
      centerLabel: "c",
      excludedObservables: [],
    });

    expect(nodeById(graph, observableId("alice"))?.count).toBe(3);
    expect(nodeById(graph, observableId("bob"))?.count).toBe(1);

    // The per-class split still lives on the edges.
    expect(
      edgeById(graph, edgeId(classId("Authentication"), observableId("alice")))
        ?.count,
    ).toBe(2);
    expect(
      edgeById(
        graph,
        edgeId(classId("Process Activity"), observableId("alice")),
      )?.count,
    ).toBe(1);
  });

  test("an observable shared by two classes counts every event once (1 + 1 = 2)", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({ className: "Authentication", observables: ["alice"] }),
        buildEvent({ className: "Process Activity", observables: ["alice"] }),
      ],
      centerLabel: "c",
      excludedObservables: [],
    });

    expect(nodeById(graph, observableId("alice"))?.count).toBe(2);
  });

  test("a value repeated inside one event counts once", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({
          className: "Authentication",
          observables: ["alice", "alice", "alice"],
        }),
      ],
      centerLabel: "c",
      excludedObservables: [],
    });
    expect(nodeById(graph, observableId("alice"))?.count).toBe(1);

    const twoEvents: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({
          className: "Authentication",
          observables: ["alice", "alice"],
        }),
        buildEvent({
          className: "Process Activity",
          observables: ["alice", "alice", "alice"],
        }),
      ],
      centerLabel: "c",
      excludedObservables: [],
    });
    expect(nodeById(twoEvents, observableId("alice"))?.count).toBe(2);
  });

  test("an observable's count equals the sum of its class edge counts", () => {
    const graph: CorrelationGraphData = buildNeighborhoodGraph();
    const observables: Array<CorrelationGraphNode> = observableNodesOf(graph);
    expect(observables.length).toBeGreaterThan(0);

    for (const observable of observables) {
      const edgeTotal: number = graph.edges
        .filter((edge: CorrelationGraphEdge) => {
          return edge.to === observable.id;
        })
        .reduce((total: number, edge: CorrelationGraphEdge) => {
          return total + edge.count;
        }, 0);
      expect(observable.count).toBe(edgeTotal);
    }
  });

  test("excluded observables get no node, no edge, and do not change other counts", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({
          className: "Authentication",
          observables: ["searched", "alice", "searched"],
        }),
        buildEvent({
          className: "Process Activity",
          observables: ["searched", "alice"],
        }),
      ],
      centerLabel: "c",
      excludedObservables: ["searched"],
    });

    expect(nodeById(graph, observableId("searched"))).toBeUndefined();
    const touchesExcluded: Array<CorrelationGraphEdge> = graph.edges.filter(
      (edge: CorrelationGraphEdge) => {
        return (
          edge.from === observableId("searched") ||
          edge.to === observableId("searched")
        );
      },
    );
    expect(touchesExcluded).toHaveLength(0);
    expect(nodeById(graph, observableId("alice"))?.count).toBe(2);
    expect(observableNodesOf(graph)).toHaveLength(1);
  });

  test("observables kept by the cap still carry their full event counts", () => {
    const graph: CorrelationGraphData = buildCappedGraph();

    expect(nodeById(graph, observableId("popular"))?.count).toBe(3);
    expect(nodeById(graph, observableId("rare-0"))?.count).toBe(1);
    // Dropped observables have neither a node nor an edge.
    expect(nodeById(graph, observableId("rare-1"))).toBeUndefined();
    expect(
      edgeById(
        graph,
        edgeId(classId("Authentication"), observableId("rare-1")),
      ),
    ).toBeUndefined();
  });

  test("the center stays count-less and class counts still count events", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({
          className: "Authentication",
          observables: ["alice", "bob", "carol"],
        }),
        buildEvent({ className: "Authentication", observables: [] }),
      ],
      centerLabel: "c",
      excludedObservables: [],
    });

    expect(nodeById(graph, CENTER_NODE_ID)?.count).toBeUndefined();
    expect(nodeById(graph, classId("Authentication"))?.count).toBe(2);
    for (const observable of observableNodesOf(graph)) {
      expect(observable.count).toBe(1);
      expect(observable.worstSeverity).toBeUndefined();
    }
  });
});

describe("getCorrelationGraphSummary", () => {
  test("an empty graph summarises to zeros and no worst class", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [],
      centerLabel: "c",
      excludedObservables: [],
    });

    const summary: CorrelationGraphSummary = getCorrelationGraphSummary(graph);
    expect(summary).toEqual({
      classCount: 0,
      highRiskClassCount: 0,
      observableCount: 0,
      droppedObservableCount: 0,
      worstClass: undefined,
    });
  });

  test("counts classes and observables but never the center", () => {
    const summary: CorrelationGraphSummary = getCorrelationGraphSummary(
      buildNeighborhoodGraph(),
    );

    // Authentication, Compliance Finding, Network Activity, Process Activity.
    expect(summary.classCount).toBe(4);
    // alice, bob, carol, dave — "searched" is excluded.
    expect(summary.observableCount).toBe(4);
    expect(summary.droppedObservableCount).toBe(0);
  });

  test("high-risk classes are High, Critical and Fatal — nothing below High", () => {
    const events: Array<SecurityEvent> = Object.values(OcsfSeverity).map(
      (severity: OcsfSeverity) => {
        return buildEvent({
          className: `${severity} class`,
          severityName: severity,
        });
      },
    );
    events.push(buildEvent({ className: "No severity class" }));

    const summary: CorrelationGraphSummary = getCorrelationGraphSummary(
      buildCorrelationGraph({
        events: events,
        centerLabel: "c",
        excludedObservables: [],
      }),
    );

    expect(summary.classCount).toBe(9);
    // High + Critical + Fatal; Medium/Low/Informational/Unknown/Other do not.
    expect(summary.highRiskClassCount).toBe(3);
  });

  /*
   * One class per graph, so a total of 3 above can't hide a threshold that
   * is off by one level in both directions at once.
   */
  test.each([
    [OcsfSeverity.Fatal, 1],
    [OcsfSeverity.Critical, 1],
    [OcsfSeverity.High, 1],
    [OcsfSeverity.Medium, 0],
    [OcsfSeverity.Low, 0],
    [OcsfSeverity.Informational, 0],
    [OcsfSeverity.Unknown, 0],
    [OcsfSeverity.Other, 0],
  ])(
    "a lone %s class adds %i to highRiskClassCount",
    (severity: OcsfSeverity, expected: number) => {
      const summary: CorrelationGraphSummary = getCorrelationGraphSummary(
        buildCorrelationGraph({
          events: [
            buildEvent({ className: "Authentication", severityName: severity }),
          ],
          centerLabel: "c",
          excludedObservables: [],
        }),
      );

      expect(summary.classCount).toBe(1);
      expect(summary.highRiskClassCount).toBe(expected);
    },
  );

  test("a class is high-risk from its worst event, and counts once however many events it has", () => {
    const summary: CorrelationGraphSummary = getCorrelationGraphSummary(
      buildCorrelationGraph({
        events: [
          buildEvent({
            className: "Authentication",
            severityName: OcsfSeverity.Low,
          }),
          buildEvent({
            className: "Authentication",
            severityName: OcsfSeverity.High,
          }),
          buildEvent({
            className: "Authentication",
            severityName: OcsfSeverity.Critical,
          }),
          buildEvent({
            className: "Process Activity",
            severityName: OcsfSeverity.Medium,
          }),
          buildEvent({
            className: "Process Activity",
            severityName: OcsfSeverity.Medium,
          }),
        ],
        centerLabel: "c",
        excludedObservables: [],
      }),
    );

    expect(summary.classCount).toBe(2);
    expect(summary.highRiskClassCount).toBe(1);
  });

  test("droppedObservableCount mirrors the cap and observableCount only counts rendered nodes", () => {
    const graph: CorrelationGraphData = buildCappedGraph();
    const summary: CorrelationGraphSummary = getCorrelationGraphSummary(graph);

    expect(summary.droppedObservableCount).toBe(3);
    expect(summary.droppedObservableCount).toBe(graph.droppedCoObservableCount);
    expect(summary.observableCount).toBe(2);
    expect(summary.classCount).toBe(1);
    expect(summary.highRiskClassCount).toBe(1);
  });

  test("worstClass is picked by severity before event count", () => {
    const events: Array<SecurityEvent> = [];
    for (let index: number = 0; index < 10; index++) {
      events.push(
        buildEvent({
          className: "Authentication",
          severityName: OcsfSeverity.High,
        }),
      );
    }
    events.push(
      buildEvent({
        className: "Zero Trust",
        severityName: OcsfSeverity.Critical,
      }),
    );

    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: events,
      centerLabel: "c",
      excludedObservables: [],
    });
    const summary: CorrelationGraphSummary = getCorrelationGraphSummary(graph);

    expect(summary.worstClass?.id).toBe(classId("Zero Trust"));
    // The very node object from the graph, so callers can select it by id.
    expect(summary.worstClass).toBe(nodeById(graph, classId("Zero Trust")));
  });

  test("Fatal outranks Critical for worstClass", () => {
    const summary: CorrelationGraphSummary = getCorrelationGraphSummary(
      buildCorrelationGraph({
        events: [
          buildEvent({
            className: "Alpha",
            severityName: OcsfSeverity.Critical,
          }),
          buildEvent({ className: "Omega", severityName: OcsfSeverity.Fatal }),
        ],
        centerLabel: "c",
        excludedObservables: [],
      }),
    );

    expect(summary.worstClass?.label).toBe("Omega");
    expect(summary.worstClass?.worstSeverity).toBe(OcsfSeverity.Fatal);
  });

  test("on a severity tie, the busier class wins even if its name sorts later", () => {
    const summary: CorrelationGraphSummary = getCorrelationGraphSummary(
      buildCorrelationGraph({
        events: [
          buildEvent({ className: "Alpha", severityName: OcsfSeverity.High }),
          buildEvent({ className: "Zeta", severityName: OcsfSeverity.High }),
          buildEvent({ className: "Zeta", severityName: OcsfSeverity.Low }),
          buildEvent({ className: "Zeta", severityName: OcsfSeverity.Low }),
        ],
        centerLabel: "c",
        excludedObservables: [],
      }),
    );

    expect(summary.worstClass?.label).toBe("Zeta");
    expect(summary.worstClass?.count).toBe(3);
  });

  test("on a severity and count tie, the first name alphabetically wins", () => {
    const summary: CorrelationGraphSummary = getCorrelationGraphSummary(
      handBuiltGraph([
        classNode("Charlie", 2, OcsfSeverity.High),
        classNode("Bravo", 2, OcsfSeverity.High),
        classNode("Alpha", 1, OcsfSeverity.High),
        classNode("Delta", 2, OcsfSeverity.Medium),
      ]),
    );

    expect(summary.worstClass?.label).toBe("Bravo");
  });

  test("worstClass is undefined when no class has a real severity", () => {
    const summary: CorrelationGraphSummary = getCorrelationGraphSummary(
      buildCorrelationGraph({
        events: [
          buildEvent({
            className: "Authentication",
            severityName: OcsfSeverity.Unknown,
          }),
          buildEvent({
            className: "Process Activity",
            severityName: OcsfSeverity.Other,
          }),
          buildEvent({ className: "Network Activity" }),
          buildEvent({ className: "Network Activity" }),
        ],
        centerLabel: "c",
        excludedObservables: [],
      }),
    );

    expect(summary.classCount).toBe(3);
    expect(summary.highRiskClassCount).toBe(0);
    expect(summary.worstClass).toBeUndefined();
  });

  test("Informational is a real severity: it can be the worst class without being high-risk", () => {
    const summary: CorrelationGraphSummary = getCorrelationGraphSummary(
      buildCorrelationGraph({
        events: [
          buildEvent({ className: "Authentication" }),
          buildEvent({ className: "Authentication" }),
          buildEvent({
            className: "Process Activity",
            severityName: OcsfSeverity.Informational,
          }),
        ],
        centerLabel: "c",
        excludedObservables: [],
      }),
    );

    expect(summary.worstClass?.label).toBe("Process Activity");
    expect(summary.highRiskClassCount).toBe(0);
  });

  test("does not reorder the graph's nodes", () => {
    const graph: CorrelationGraphData = handBuiltGraph([
      classNode("Low", 1, OcsfSeverity.Low),
      observableNode("alice", 1),
      classNode("Critical", 1, OcsfSeverity.Critical),
    ]);
    const before: Array<string> = nodeIdsOf(graph);

    getCorrelationGraphSummary(graph);

    expect(nodeIdsOf(graph)).toEqual(before);
  });
});

describe("rankClassNodes", () => {
  test("orders by worst severity, then event count, then name", () => {
    const graph: CorrelationGraphData = handBuiltGraph([
      classNode("No severity busy", 5),
      observableNode("alice", 99),
      classNode("Medium class", 1, OcsfSeverity.Medium),
      classNode("High beta", 2, OcsfSeverity.High),
      classNode("Critical class", 1, OcsfSeverity.Critical),
      classNode("High alpha", 2, OcsfSeverity.High),
      classNode("High busy", 7, OcsfSeverity.High),
      classNode("No severity quiet", undefined),
      classNode("Fatal class", 1, OcsfSeverity.Fatal),
      classNode("Low class", 3, OcsfSeverity.Low),
      classNode("Informational class", 4, OcsfSeverity.Informational),
    ]);

    expect(labelsOf(rankClassNodes(graph))).toEqual([
      "Fatal class",
      "Critical class",
      "High busy",
      "High alpha",
      "High beta",
      "Medium class",
      "Low class",
      "Informational class",
      "No severity busy",
      "No severity quiet",
    ]);
  });

  test("puts Critical before High before Medium before no severity on a built graph", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({ className: "Alpha" }),
        buildEvent({ className: "Alpha" }),
        buildEvent({ className: "Alpha" }),
        buildEvent({ className: "Bravo", severityName: OcsfSeverity.Medium }),
        buildEvent({ className: "Charlie", severityName: OcsfSeverity.High }),
        buildEvent({
          className: "Delta",
          severityName: OcsfSeverity.Critical,
        }),
        buildEvent({ className: "Echo", severityName: OcsfSeverity.Unknown }),
      ],
      centerLabel: "c",
      excludedObservables: [],
    });

    // Alpha (3 events, no severity) beats Echo (1 event, Unknown) on count.
    expect(labelsOf(rankClassNodes(graph))).toEqual([
      "Delta",
      "Charlie",
      "Bravo",
      "Alpha",
      "Echo",
    ]);
  });

  test("ranks Other and Unknown below every real severity, not by OCSF id", () => {
    /*
     * In OcsfSeverityId, Other is 99 and would beat Fatal; the ranking must
     * treat it like Unknown however busy the class is.
     */
    const graph: CorrelationGraphData = handBuiltGraph([
      classNode("Other busy", 50, OcsfSeverity.Other),
      classNode("Unknown busy", 40, OcsfSeverity.Unknown),
      classNode("Informational quiet", 1, OcsfSeverity.Informational),
      classNode("Fatal quiet", 1, OcsfSeverity.Fatal),
    ]);

    expect(labelsOf(rankClassNodes(graph))).toEqual([
      "Fatal quiet",
      "Informational quiet",
      "Other busy",
      "Unknown busy",
    ]);
    expect(getCorrelationGraphSummary(graph).highRiskClassCount).toBe(1);
  });

  test("returns only class nodes", () => {
    const ranked: Array<CorrelationGraphNode> = rankClassNodes(
      buildNeighborhoodGraph(),
    );

    expect(ranked).toHaveLength(4);
    for (const node of ranked) {
      expect(node.kind).toBe("class");
    }
  });

  test("returns a new array and leaves the input untouched", () => {
    const graph: CorrelationGraphData = handBuiltGraph([
      classNode("Low", 1, OcsfSeverity.Low),
      classNode("Critical", 1, OcsfSeverity.Critical),
      classNode("High", 1, OcsfSeverity.High),
    ]);
    const nodesBefore: Array<CorrelationGraphNode> = graph.nodes;
    const idsBefore: Array<string> = nodeIdsOf(graph);

    const ranked: Array<CorrelationGraphNode> = rankClassNodes(graph);

    expect(ranked).not.toBe(graph.nodes);
    expect(graph.nodes).toBe(nodesBefore);
    expect(nodeIdsOf(graph)).toEqual(idsBefore);
    expect(labelsOf(ranked)).toEqual(["Critical", "High", "Low"]);
  });

  test("an empty graph ranks to an empty list", () => {
    expect(
      rankClassNodes({ nodes: [], edges: [], droppedCoObservableCount: 0 }),
    ).toEqual([]);
  });
});

describe("rankObservableNodes", () => {
  test("orders by event count, then value", () => {
    const graph: CorrelationGraphData = handBuiltGraph([
      observableNode("zed", 5),
      classNode("Authentication", 100, OcsfSeverity.Fatal),
      observableNode("bob", 2),
      observableNode("carol", undefined),
      observableNode("alice", 2),
      observableNode("dave", 9),
    ]);

    expect(labelsOf(rankObservableNodes(graph))).toEqual([
      "dave",
      "zed",
      "alice",
      "bob",
      "carol",
    ]);
  });

  test("ranks a built graph by how many events mention each observable", () => {
    const graph: CorrelationGraphData = buildCorrelationGraph({
      events: [
        buildEvent({
          className: "Authentication",
          observables: ["carol", "bob", "alice"],
        }),
        buildEvent({
          className: "Process Activity",
          observables: ["carol", "alice"],
        }),
        buildEvent({
          className: "Network Activity",
          observables: ["alice", "carol", "carol"],
        }),
      ],
      centerLabel: "c",
      excludedObservables: [],
    });

    const ranked: Array<CorrelationGraphNode> = rankObservableNodes(graph);
    expect(labelsOf(ranked)).toEqual(["alice", "carol", "bob"]);
    expect(
      ranked.map((node: CorrelationGraphNode) => {
        return node.count;
      }),
    ).toEqual([3, 3, 1]);
  });

  test("returns only observable nodes", () => {
    const ranked: Array<CorrelationGraphNode> = rankObservableNodes(
      buildNeighborhoodGraph(),
    );

    expect(labelsOf(ranked)).toEqual(["alice", "bob", "carol", "dave"]);
    for (const node of ranked) {
      expect(node.kind).toBe("observable");
    }
  });

  test("returns a new array and leaves the input untouched", () => {
    const graph: CorrelationGraphData = handBuiltGraph([
      observableNode("quiet", 1),
      observableNode("busy", 8),
    ]);
    const nodesBefore: Array<CorrelationGraphNode> = graph.nodes;
    const idsBefore: Array<string> = nodeIdsOf(graph);

    const ranked: Array<CorrelationGraphNode> = rankObservableNodes(graph);

    expect(ranked).not.toBe(graph.nodes);
    expect(graph.nodes).toBe(nodesBefore);
    expect(nodeIdsOf(graph)).toEqual(idsBefore);
    expect(labelsOf(ranked)).toEqual(["busy", "quiet"]);
  });

  test("a graph without observables ranks to an empty list", () => {
    expect(
      rankObservableNodes(
        handBuiltGraph([classNode("Authentication", 1, OcsfSeverity.High)]),
      ),
    ).toEqual([]);
  });
});

describe("getCorrelationNeighborhood", () => {
  test("returns null when nothing is selected", () => {
    const graph: CorrelationGraphData = buildNeighborhoodGraph();
    expect(getCorrelationNeighborhood(graph, null)).toBeNull();
    expect(getCorrelationNeighborhood(graph, "")).toBeNull();
  });

  test("returns null for the center node", () => {
    expect(
      getCorrelationNeighborhood(buildNeighborhoodGraph(), CENTER_NODE_ID),
    ).toBeNull();
  });

  test("returns null for ids that are not in the graph", () => {
    const graph: CorrelationGraphData = buildNeighborhoodGraph();
    expect(getCorrelationNeighborhood(graph, "nope")).toBeNull();
    expect(
      getCorrelationNeighborhood(graph, classId("Not A Class")),
    ).toBeNull();
    expect(getCorrelationNeighborhood(graph, observableId("ghost"))).toBeNull();
    // The searched value is excluded, so it is not selectable either.
    expect(
      getCorrelationNeighborhood(graph, observableId("searched")),
    ).toBeNull();
    expect(
      getCorrelationNeighborhood(
        { nodes: [], edges: [], droppedCoObservableCount: 0 },
        classId("Authentication"),
      ),
    ).toBeNull();
  });

  test("returns null for any center-kind node, not just the default center id", () => {
    const graph: CorrelationGraphData = {
      nodes: [{ id: "other-center", label: "c", kind: "center" }],
      edges: [],
      droppedCoObservableCount: 0,
    };
    expect(getCorrelationNeighborhood(graph, "other-center")).toBeNull();
  });

  test("a class lights itself, the center, its observables, and exactly those edges", () => {
    const neighborhood: CorrelationNeighborhood | null =
      getCorrelationNeighborhood(
        buildNeighborhoodGraph(),
        classId("Authentication"),
      );

    expect(neighborhood).not.toBeNull();
    expect(neighborhood?.nodeIds).toEqual(
      new Set<string>([
        CENTER_NODE_ID,
        classId("Authentication"),
        observableId("alice"),
        observableId("bob"),
      ]),
    );
    /*
     * Process Activity also reaches alice, but that spoke belongs to the
     * other class and stays dimmed.
     */
    expect(neighborhood?.edgeIds).toEqual(
      new Set<string>([
        edgeId(CENTER_NODE_ID, classId("Authentication")),
        edgeId(classId("Authentication"), observableId("alice")),
        edgeId(classId("Authentication"), observableId("bob")),
      ]),
    );
  });

  test("a class without co-observables lights only itself, the center, and its spoke", () => {
    const neighborhood: CorrelationNeighborhood | null =
      getCorrelationNeighborhood(
        buildNeighborhoodGraph(),
        classId("Compliance Finding"),
      );

    expect(neighborhood?.nodeIds).toEqual(
      new Set<string>([CENTER_NODE_ID, classId("Compliance Finding")]),
    );
    expect(neighborhood?.edgeIds).toEqual(
      new Set<string>([edgeId(CENTER_NODE_ID, classId("Compliance Finding"))]),
    );
  });

  test("a class neighbourhood only includes observables the cap kept", () => {
    const neighborhood: CorrelationNeighborhood | null =
      getCorrelationNeighborhood(buildCappedGraph(), classId("Authentication"));

    expect(neighborhood?.nodeIds).toEqual(
      new Set<string>([
        CENTER_NODE_ID,
        classId("Authentication"),
        observableId("popular"),
        observableId("rare-0"),
      ]),
    );
    expect(neighborhood?.edgeIds).toEqual(
      new Set<string>([
        edgeId(CENTER_NODE_ID, classId("Authentication")),
        edgeId(classId("Authentication"), observableId("popular")),
        edgeId(classId("Authentication"), observableId("rare-0")),
      ]),
    );
  });

  test("an observable shared by two classes lights both classes and both of their center spokes", () => {
    const neighborhood: CorrelationNeighborhood | null =
      getCorrelationNeighborhood(
        buildNeighborhoodGraph(),
        observableId("alice"),
      );

    expect(neighborhood).not.toBeNull();
    /*
     * bob and carol are siblings through a class, not direct neighbours of
     * alice, so they stay out.
     */
    expect(neighborhood?.nodeIds).toEqual(
      new Set<string>([
        CENTER_NODE_ID,
        observableId("alice"),
        classId("Authentication"),
        classId("Process Activity"),
      ]),
    );
    expect(neighborhood?.edgeIds).toEqual(
      new Set<string>([
        edgeId(classId("Authentication"), observableId("alice")),
        edgeId(classId("Process Activity"), observableId("alice")),
        edgeId(CENTER_NODE_ID, classId("Authentication")),
        edgeId(CENTER_NODE_ID, classId("Process Activity")),
      ]),
    );
  });

  test("an observable seen in one class lights just that class", () => {
    const neighborhood: CorrelationNeighborhood | null =
      getCorrelationNeighborhood(
        buildNeighborhoodGraph(),
        observableId("dave"),
      );

    expect(neighborhood?.nodeIds).toEqual(
      new Set<string>([
        CENTER_NODE_ID,
        observableId("dave"),
        classId("Network Activity"),
      ]),
    );
    expect(neighborhood?.edgeIds).toEqual(
      new Set<string>([
        edgeId(classId("Network Activity"), observableId("dave")),
        edgeId(CENTER_NODE_ID, classId("Network Activity")),
      ]),
    );
  });

  test("every lit id exists in the graph, for every selectable node", () => {
    const graph: CorrelationGraphData = buildNeighborhoodGraph();
    const nodeIds: Set<string> = new Set<string>(nodeIdsOf(graph));
    const edgeIds: Set<string> = new Set<string>(
      graph.edges.map((edge: CorrelationGraphEdge) => {
        return edge.id;
      }),
    );

    for (const node of graph.nodes) {
      const neighborhood: CorrelationNeighborhood | null =
        getCorrelationNeighborhood(graph, node.id);

      if (node.kind === "center") {
        expect(neighborhood).toBeNull();
        continue;
      }

      expect(neighborhood).not.toBeNull();
      expect(neighborhood?.nodeIds.has(node.id)).toBe(true);
      expect(neighborhood?.nodeIds.has(CENTER_NODE_ID)).toBe(true);
      for (const id of Array.from(neighborhood?.nodeIds || [])) {
        expect(nodeIds.has(id)).toBe(true);
      }
      for (const id of Array.from(neighborhood?.edgeIds || [])) {
        expect(edgeIds.has(id)).toBe(true);
      }
    }
  });

  test("returns fresh sets, so callers cannot corrupt a later lookup", () => {
    const graph: CorrelationGraphData = buildNeighborhoodGraph();
    const first: CorrelationNeighborhood | null = getCorrelationNeighborhood(
      graph,
      classId("Authentication"),
    );
    first?.nodeIds.add("junk");
    first?.edgeIds.clear();

    const second: CorrelationNeighborhood | null = getCorrelationNeighborhood(
      graph,
      classId("Authentication"),
    );
    expect(second?.nodeIds.has("junk")).toBe(false);
    expect(second?.edgeIds.size).toBe(3);
  });
});
