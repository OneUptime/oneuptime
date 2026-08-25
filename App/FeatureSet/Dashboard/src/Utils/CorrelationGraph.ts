import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";

/*
 * Pure graph construction for Security Events → Correlate: the applied
 * filter in the middle, one node per event class that matched it, and one
 * node per co-occurring observable (capped at the most frequent N). The
 * component maps this data onto React Flow nodes/edges and a layout — kept
 * out of here so counting, capping, exclusion, dedupe, and severity ranking
 * are unit-testable without rendering anything.
 */

export const CENTER_NODE_ID: string = "center";
export const OBSERVABLE_NODE_PREFIX: string = "observable:";
export const CLASS_NODE_PREFIX: string = "class:";

export const DEFAULT_MAX_CO_OBSERVABLES: number = 30;

export type CorrelationGraphNodeKind = "center" | "class" | "observable";

export interface CorrelationGraphNode {
  id: string;
  label: string;
  kind: CorrelationGraphNodeKind;
  // Number of matching events (class nodes) — undefined otherwise.
  count?: number | undefined;
  // Worst severity among the node's events (class nodes) — undefined otherwise.
  worstSeverity?: OcsfSeverity | undefined;
}

export interface CorrelationGraphEdge {
  id: string;
  from: string;
  to: string;
  count: number;
}

export interface CorrelationGraphData {
  nodes: Array<CorrelationGraphNode>;
  edges: Array<CorrelationGraphEdge>;
  // How many distinct co-observables were dropped by the cap (0 = none).
  droppedCoObservableCount: number;
}

export interface CorrelationGraphInput {
  events: Array<SecurityEvent>;
  centerLabel: string;
  /*
   * Observable values pinned by the filter with equality — they would
   * trivially co-occur with every matched event, so they are not shown as
   * co-occurring nodes.
   */
  excludedObservables: Array<string>;
  maxCoObservables?: number | undefined;
}

/*
 * "Worst" ranking for the class-node coloring. This is deliberately NOT
 * OcsfSeverityId: there `Other` is 99 and would beat `Fatal`, which is
 * wrong for a "how bad is it" ordering — Unknown/Other rank below
 * everything real.
 */
const SEVERITY_RANK: Record<string, number> = {
  [OcsfSeverity.Fatal]: 6,
  [OcsfSeverity.Critical]: 5,
  [OcsfSeverity.High]: 4,
  [OcsfSeverity.Medium]: 3,
  [OcsfSeverity.Low]: 2,
  [OcsfSeverity.Informational]: 1,
};

export function severityRank(severityName: string | undefined): number {
  if (!severityName) {
    return 0;
  }
  return SEVERITY_RANK[severityName] || 0;
}

/*
 * Union of several per-query result sets. OR-mode correlation runs one
 * query per condition; an event matching two conditions comes back twice
 * and must count once. Keyed by the row id, with eventUid+time as the
 * fallback identity for callers that did not select _id.
 */
export function dedupeSecurityEvents(
  eventLists: Array<Array<SecurityEvent>>,
): Array<SecurityEvent> {
  const deduped: Array<SecurityEvent> = [];
  const seen: Set<string> = new Set<string>();

  for (const eventList of eventLists) {
    for (const event of eventList) {
      const id: string = event._id
        ? event._id.toString()
        : `${event.eventUid || ""}|${event.time ? new Date(event.time).toISOString() : ""}`;

      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      deduped.push(event);
    }
  }

  return deduped;
}

export function buildCorrelationGraph(
  input: CorrelationGraphInput,
): CorrelationGraphData {
  const maxCoObservables: number =
    input.maxCoObservables ?? DEFAULT_MAX_CO_OBSERVABLES;
  const excluded: Set<string> = new Set<string>(input.excludedObservables);

  if (input.events.length === 0) {
    return { nodes: [], edges: [], droppedCoObservableCount: 0 };
  }

  // Events per class, worst severity per class, co-observables per class.
  const classCounts: Map<string, number> = new Map<string, number>();
  const classWorstSeverity: Map<string, string> = new Map<string, string>();
  const coObservableCounts: Map<string, number> = new Map<string, number>();
  const classToCoObservable: Map<string, Map<string, number>> = new Map<
    string,
    Map<string, number>
  >();

  for (const event of input.events) {
    const className: string = event.className || "Unclassified";
    classCounts.set(className, (classCounts.get(className) || 0) + 1);

    const currentWorst: string | undefined = classWorstSeverity.get(className);
    if (
      severityRank(event.severityName) > severityRank(currentWorst) ||
      currentWorst === undefined
    ) {
      classWorstSeverity.set(className, event.severityName || "");
    }

    const seenInEvent: Set<string> = new Set<string>();
    for (const observable of event.observables || []) {
      if (
        !observable ||
        excluded.has(observable) ||
        seenInEvent.has(observable)
      ) {
        continue;
      }
      seenInEvent.add(observable);
      coObservableCounts.set(
        observable,
        (coObservableCounts.get(observable) || 0) + 1,
      );
      const observableCounts: Map<string, number> =
        classToCoObservable.get(className) || new Map<string, number>();
      observableCounts.set(
        observable,
        (observableCounts.get(observable) || 0) + 1,
      );
      classToCoObservable.set(className, observableCounts);
    }
  }

  // Cap co-observables at the most frequent ones; ties break alphabetically.
  const sortedCoObservables: Array<[string, number]> = Array.from(
    coObservableCounts.entries(),
  ).sort((a: [string, number], b: [string, number]): number => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });

  const topCoObservables: Set<string> = new Set<string>(
    sortedCoObservables
      .slice(0, maxCoObservables)
      .map((entry: [string, number]) => {
        return entry[0];
      }),
  );

  const droppedCoObservableCount: number = Math.max(
    0,
    sortedCoObservables.length - maxCoObservables,
  );

  const nodes: Array<CorrelationGraphNode> = [
    { id: CENTER_NODE_ID, label: input.centerLabel, kind: "center" },
  ];
  const edges: Array<CorrelationGraphEdge> = [];

  const sortedClassNames: Array<string> = Array.from(classCounts.keys()).sort(
    (a: string, b: string): number => {
      return a.localeCompare(b);
    },
  );

  for (const className of sortedClassNames) {
    const classId: string = `${CLASS_NODE_PREFIX}${className}`;
    const count: number = classCounts.get(className) || 0;
    const worstSeverityName: string = classWorstSeverity.get(className) || "";

    nodes.push({
      id: classId,
      label: className,
      kind: "class",
      count: count,
      worstSeverity: severityRank(worstSeverityName)
        ? (worstSeverityName as OcsfSeverity)
        : undefined,
    });
    edges.push({
      id: `${CENTER_NODE_ID}->${classId}`,
      from: CENTER_NODE_ID,
      to: classId,
      count: count,
    });
  }

  const addedObservableNodes: Set<string> = new Set<string>();

  for (const className of sortedClassNames) {
    const observableCounts: Map<string, number> | undefined =
      classToCoObservable.get(className);
    if (!observableCounts) {
      continue;
    }

    const classId: string = `${CLASS_NODE_PREFIX}${className}`;
    const sortedObservables: Array<string> = Array.from(
      observableCounts.keys(),
    ).sort((a: string, b: string): number => {
      return a.localeCompare(b);
    });

    for (const observable of sortedObservables) {
      if (!topCoObservables.has(observable)) {
        continue;
      }
      const coId: string = `${OBSERVABLE_NODE_PREFIX}${observable}`;
      if (!addedObservableNodes.has(coId)) {
        addedObservableNodes.add(coId);
        nodes.push({ id: coId, label: observable, kind: "observable" });
      }
      edges.push({
        id: `${classId}->${coId}`,
        from: classId,
        to: coId,
        count: observableCounts.get(observable) || 0,
      });
    }
  }

  return { nodes, edges, droppedCoObservableCount };
}
