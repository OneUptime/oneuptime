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
  OBSERVABLE_NODE_PREFIX,
  buildCorrelationGraph,
  dedupeSecurityEvents,
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
