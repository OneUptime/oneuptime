import { describe, expect, test } from "@jest/globals";
import DataAlertLineageReader, {
  DataAlertLineageRow,
  DataAlertRowReader,
  DataLineageWay,
  DataLineageWayEnd,
  MAX_DATA_ALERT_LINEAGE_CONSEQUENCES,
  MAX_DATA_ALERT_WAY_TABLES,
} from "../../../../Server/Utils/DataObservability/DataAlertLineage";
import DataTableLineageReader, {
  DataLineageDirection,
} from "../../../../Server/Utils/DataObservability/DataTableLineage";
import {
  DEFAULT_DATA_LINEAGE_DEPTH,
  DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
  DataAlertLineageAnswer,
  DataLineageHighlight,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  DataTableLineagePipeline,
  MAX_DATA_LINEAGE_DEPTH,
  MAX_DATA_LINEAGE_NEIGHBORS,
  MAX_DATA_LINEAGE_TABLES_PER_SIDE,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  HOUR,
  MemoryGraph,
  NOW,
  edgeBetween,
  feeds,
  lateTable,
  memoryReader,
  newGraph,
  nodeOf,
  p,
  pipeline,
  runs,
  t,
  table,
  uuid,
  writes,
} from "./LineageMemoryGraph";

/*
 * A data alert's lineage (DataAlertLineageReader.build): the lineage around
 * what the alert is about - its table, as the table's Lineage tab draws it,
 * or its pipeline, as the pipeline's page does - with the way up to the
 * alert that caused it and down to each alert it caused picked out, the
 * fewest steps to each, drawn whatever else the drawing leaves out. These
 * walk graphs and alerts held in memory, the alerts read as their reader
 * may see them; DataAlertLineageDatabase.test.ts pins each read's privacy
 * clause and DataLineageRoutes.test.ts the route.
 */

// An alert's id.
function a(index: number): string {
  return uuid(4, index);
}

const STORE: string = uuid(5, 1);

// A table's card, a pipeline's card.
function tn(index: number): string {
  return getLineageTableNodeId(t(index));
}

function pn(index: number): string {
  return getLineagePipelineNodeId(p(index));
}

interface MemoryAlerts {
  rows: Map<string, DataAlertLineageRow>;
  // The alerts the reader may not see: private ones they do not own.
  hidden: Set<string>;
  // Every read, in order: "alert:<id>", "subject:<id>", "consequences:<id>".
  reads: Array<string>;
}

function newAlerts(): MemoryAlerts {
  return { rows: new Map(), hidden: new Set(), reads: [] };
}

// A data alert about a table, a pipeline or a whole database, caused by another when one is named.
function alertOn(
  alerts: MemoryAlerts,
  id: string,
  about: { table?: number; pipeline?: number; store?: boolean },
  causeAlertId: string | null = null,
): DataAlertLineageRow {
  const row: DataAlertLineageRow = {
    alertId: id,
    dataAssetId: about.table === undefined ? null : t(about.table),
    dataPipelineId: about.pipeline === undefined ? null : p(about.pipeline),
    dataStoreId: about.store || about.table !== undefined ? STORE : null,
    causeAlertId,
  };

  alerts.rows.set(id, row);

  return row;
}

/*
 * The alerts as the database reader reads them for one reader: none they
 * may not see, and no alert at all when the alert it is a consequence of is
 * one they may not see.
 */
function alertReader(alerts: MemoryAlerts): DataAlertRowReader {
  const isSeen: (id: string) => boolean = (id: string): boolean => {
    return alerts.rows.has(id) && !alerts.hidden.has(id);
  };

  return {
    readAlert: async (alertId: string): Promise<DataAlertLineageRow | null> => {
      alerts.reads.push(`alert:${alertId}`);

      const row: DataAlertLineageRow | undefined = alerts.rows.get(alertId);

      if (
        !row ||
        !isSeen(alertId) ||
        (row.causeAlertId && !isSeen(row.causeAlertId))
      ) {
        return null;
      }

      return row;
    },
    readSubject: async (
      alertId: string,
    ): Promise<DataAlertLineageRow | null> => {
      alerts.reads.push(`subject:${alertId}`);

      return isSeen(alertId) ? alerts.rows.get(alertId)! : null;
    },
    readConsequences: async (data: {
      alertId: string;
      limit: number;
    }): Promise<{ rows: Array<DataAlertLineageRow>; total: number }> => {
      alerts.reads.push(`consequences:${data.alertId}`);

      const rows: Array<DataAlertLineageRow> = Array.from(
        alerts.rows.values(),
      ).filter((row: DataAlertLineageRow): boolean => {
        return row.causeAlertId === data.alertId && isSeen(row.alertId);
      });

      return { rows: rows.slice(0, data.limit), total: rows.length };
    },
  };
}

async function answerFor(
  graph: MemoryGraph,
  alerts: MemoryAlerts,
  alertId: string = a(0),
): Promise<DataAlertLineageAnswer | null> {
  return await DataAlertLineageReader.build({
    alertId,
    now: NOW,
    alerts: alertReader(alerts),
    reader: memoryReader(graph),
  });
}

// The answer, with a drawing.
async function drawingFor(
  graph: MemoryGraph,
  alerts: MemoryAlerts,
  alertId: string = a(0),
): Promise<{ answer: DataAlertLineageAnswer; lineage: DataTableLineage }> {
  const answer: DataAlertLineageAnswer | null = await answerFor(
    graph,
    alerts,
    alertId,
  );

  expect(answer).not.toBeNull();
  expect(answer!.lineage).not.toBeNull();

  return { answer: answer!, lineage: answer!.lineage! };
}

function highlightOf(lineage: DataTableLineage): DataLineageHighlight {
  expect(lineage.highlight).toBeDefined();

  return lineage.highlight!;
}

function edgeId(
  lineage: DataTableLineage,
  source: string,
  target: string,
): string {
  const edge: DataTableLineageEdge | undefined = edgeBetween(
    lineage,
    source,
    target,
  );

  expect(edge).toBeDefined();

  return edge!.id;
}

function sorted(values: Array<string>): Array<string> {
  return [...values].sort();
}

function drawnNode(
  lineage: DataTableLineage,
  id: string,
): DataTableLineageNode {
  const node: DataTableLineageNode | undefined = nodeOf(lineage, id);

  expect(node).toBeDefined();

  return node!;
}

describe("the alerts a lineage is drawn for", () => {
  test("no answer for an alert that is no data alert, or one its reader may not see", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    table(graph, t(0));
    alertOn(alerts, a(0), { table: 0 });
    alerts.hidden.add(a(0));

    expect(await answerFor(graph, alerts)).toBeNull();
    expect(await answerFor(graph, alerts, a(9))).toBeNull();
    // Nothing else is read: not what it caused, nor any lineage.
    expect(alerts.reads).toEqual([`alert:${a(0)}`, `alert:${a(9)}`]);
    expect(graph.edgeReads).toEqual([]);
    expect(graph.pipelineEdgeReads).toEqual([]);
  });

  test("no answer when the alert it is a consequence of is one its reader may not see", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    table(graph, t(0));
    table(graph, t(1));
    feeds(graph, t(1), t(0));
    alertOn(alerts, a(1), { table: 1 });
    alertOn(alerts, a(0), { table: 0 }, a(1));
    alerts.hidden.add(a(1));

    // As they get no Data card: a lineage would show where the private cause is.
    expect(await answerFor(graph, alerts)).toBeNull();
    expect(graph.edgeReads).toEqual([]);

    alerts.hidden.clear();

    expect((await answerFor(graph, alerts))?.isCauseDrawn).toBe(true);
  });

  test("an alert about a whole database: its cause and what it caused told, nothing drawn", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    table(graph, t(1));
    table(graph, t(2));
    alertOn(alerts, a(3), { store: true });
    alertOn(alerts, a(0), { store: true }, a(3));
    alertOn(alerts, a(1), { table: 1 }, a(0));
    alertOn(alerts, a(2), { table: 2 }, a(0));

    expect(await answerFor(graph, alerts)).toEqual({
      lineage: null,
      hasCause: true,
      isCauseDrawn: false,
      consequenceCount: 2,
      drawnConsequenceCount: 0,
    });
    // No table or pipeline to walk from: no lineage read, nor its cause's subject.
    expect(graph.edgeReads).toEqual([]);
    expect(alerts.reads).toEqual([`alert:${a(0)}`, `consequences:${a(0)}`]);
  });

  test("an alert on a table the project no longer has: told, nothing drawn", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    table(graph, t(1));
    feeds(graph, t(0), t(1));
    alertOn(alerts, a(0), { table: 0 });
    alertOn(alerts, a(1), { table: 1 }, a(0));

    expect(await answerFor(graph, alerts)).toEqual({
      lineage: null,
      hasCause: false,
      isCauseDrawn: false,
      consequenceCount: 1,
      drawnConsequenceCount: 0,
    });
  });

  test("an alert on a pipeline the project no longer has: told, nothing drawn", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { pipeline: 0 });

    expect((await answerFor(graph, alerts))?.lineage).toBeNull();
  });

  test("an alert naming a table and a pipeline is drawn around its table", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    table(graph, t(0));
    pipeline(graph, p(0));
    writes(graph, p(0), t(0));
    alertOn(alerts, a(0), { table: 0, pipeline: 0 });

    const { lineage } = await drawingFor(graph, alerts);

    expect(lineage.focusNodeId).toBe(tn(0));
    expect(lineage.depth).toBe(DEFAULT_DATA_LINEAGE_DEPTH);
  });
});

describe("an alert on a table, with no cause and nothing it caused", () => {
  test("is drawn as the table's Lineage tab draws it, nothing picked out", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();

    for (let index: number = 0; index < 8; index++) {
      table(graph, t(index));
    }

    feeds(graph, t(1), t(0));
    feeds(graph, t(2), t(1), { dataPipelineId: p(1) });
    feeds(graph, t(0), t(3));
    feeds(graph, t(3), t(4));
    feeds(graph, t(4), t(5));
    feeds(graph, t(5), t(6));
    pipeline(graph, p(1), { lastRunState: "FAIL" });
    alertOn(alerts, a(0), { table: 0 });

    const { answer, lineage } = await drawingFor(graph, alerts);
    const plain: DataTableLineage | null = await DataTableLineageReader.build({
      focusDataAssetId: t(0),
      depth: DEFAULT_DATA_LINEAGE_DEPTH,
      now: NOW,
      reader: memoryReader(graph),
    });

    expect(lineage).toEqual(plain);
    expect(lineage.highlight).toBeUndefined();
    expect(answer).toMatchObject({
      hasCause: false,
      isCauseDrawn: false,
      consequenceCount: 0,
      drawnConsequenceCount: 0,
    });
    // Nothing looked for: the drawing's reads alone.
    expect(alerts.reads).toEqual([`alert:${a(0)}`, `consequences:${a(0)}`]);
  });
});

describe("the way up to the alert that caused it", () => {
  test("a cause two tables up: the way picked out, the cause's card marked", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();

    for (let index: number = 0; index < 4; index++) {
      table(graph, t(index));
    }

    feeds(graph, t(2), t(1));
    feeds(graph, t(1), t(0));
    // Off the way: drawn, not picked out.
    feeds(graph, t(3), t(0));
    alertOn(alerts, a(1), { table: 2 });
    alertOn(alerts, a(0), { table: 0 }, a(1));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer).toMatchObject({
      hasCause: true,
      isCauseDrawn: true,
      consequenceCount: 0,
      drawnConsequenceCount: 0,
    });
    expect(lineage.highlight).toEqual({
      nodeIds: [tn(0), tn(1), tn(2)],
      edgeIds: sorted([
        edgeId(lineage, tn(1), tn(0)),
        edgeId(lineage, tn(2), tn(1)),
      ]),
      causeNodeIds: [tn(2)],
      consequenceNodeIds: [],
      dataPipelineIds: [],
    });
    expect(nodeOf(lineage, tn(3))).toBeDefined();
    expect(lineage.depth).toBe(DEFAULT_DATA_LINEAGE_DEPTH);
    expect(alerts.reads).toEqual([
      `alert:${a(0)}`,
      `consequences:${a(0)}`,
      `subject:${a(1)}`,
    ]);
  });

  test("a cause further up than a drawing's usual steps: that side drawn as far as it is", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();

    for (let index: number = 0; index < 10; index++) {
      table(graph, t(index));
    }

    // Five up: t5 -> t4 -> t3 -> t2 -> t1 -> t0; four down: t0 -> t6 -> t7 -> t8 -> t9.
    for (let index: number = 1; index <= 5; index++) {
      feeds(graph, t(index), t(index - 1));
    }

    feeds(graph, t(0), t(6));
    feeds(graph, t(6), t(7));
    feeds(graph, t(7), t(8));
    feeds(graph, t(8), t(9));
    alertOn(alerts, a(1), { table: 5 });
    alertOn(alerts, a(0), { table: 0 }, a(1));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer.isCauseDrawn).toBe(true);
    expect(lineage.depth).toBe(5);
    expect(drawnNode(lineage, tn(5))).toMatchObject({
      side: DataLineageSide.Upstream,
      depth: -5,
    });
    expect(highlightOf(lineage).nodeIds).toEqual([
      tn(0),
      tn(1),
      tn(2),
      tn(3),
      tn(4),
      tn(5),
    ]);
    // The other side keeps a drawing's usual steps.
    expect(drawnNode(lineage, tn(8)).depth).toBe(DEFAULT_DATA_LINEAGE_DEPTH);
    expect(drawnNode(lineage, tn(8)).hiddenDownstreamCount).toBe(1);
    expect(nodeOf(lineage, tn(9))).toBeUndefined();
  });

  test("of two ways, the one with the fewest steps", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();

    for (let index: number = 0; index < 5; index++) {
      table(graph, t(index));
    }

    // t3 -> t1 -> t0, and the longer t3 -> t4 -> t2 -> t0.
    feeds(graph, t(1), t(0));
    feeds(graph, t(2), t(0));
    feeds(graph, t(3), t(1));
    feeds(graph, t(4), t(2));
    feeds(graph, t(3), t(4));
    alertOn(alerts, a(1), { table: 3 });
    alertOn(alerts, a(0), { table: 0 }, a(1));

    const { lineage } = await drawingFor(graph, alerts);
    const highlight: DataLineageHighlight = highlightOf(lineage);

    expect(highlight.nodeIds).toEqual([tn(0), tn(1), tn(3)]);
    expect(highlight.edgeIds).toEqual(
      sorted([edgeId(lineage, tn(1), tn(0)), edgeId(lineage, tn(3), tn(1))]),
    );
    expect(drawnNode(lineage, tn(3)).depth).toBe(-2);
    // The longer way is drawn as any table's lineage is, not picked out.
    expect(nodeOf(lineage, tn(4))).toBeDefined();
  });

  test("a cause among more tables than a card shows is drawn all the same", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    table(graph, t(0));

    // Fifteen tables feed t0; t15, seen longest ago and fresh, would be counted, not drawn.
    for (let index: number = 1; index <= 15; index++) {
      table(graph, t(index));
      feeds(graph, t(index), t(0), {
        lastSeenAt: new Date(NOW.getTime() - index * HOUR),
      });
    }

    const plain: DataTableLineage | null = await DataTableLineageReader.build({
      focusDataAssetId: t(0),
      depth: DEFAULT_DATA_LINEAGE_DEPTH,
      now: NOW,
      reader: memoryReader(graph),
    });

    expect(nodeOf(plain!, tn(15))).toBeUndefined();

    alertOn(alerts, a(1), { table: 15 });
    alertOn(alerts, a(0), { table: 0 }, a(1));

    const { answer, lineage } = await drawingFor(graph, alerts);
    const upstream: Array<DataTableLineageNode> = lineage.nodes.filter(
      (node: DataTableLineageNode): boolean => {
        return node.side === DataLineageSide.Upstream;
      },
    );

    expect(answer.isCauseDrawn).toBe(true);
    expect(highlightOf(lineage).causeNodeIds).toEqual([tn(15)]);
    // Still the most a card shows: the cause in place of the last of the rest.
    expect(upstream).toHaveLength(MAX_DATA_LINEAGE_NEIGHBORS);
    expect(drawnNode(lineage, tn(0)).hiddenUpstreamCount).toBe(5);
    expect(nodeOf(lineage, tn(10))).toBeUndefined();
  });

  test("a cause that is a pipeline loading a table from outside: its card, and the arrow out of it", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    table(graph, t(0));
    table(graph, t(1));
    pipeline(graph, p(1), { jobName: "fivetran_orders", lastRunState: "FAIL" });
    feeds(graph, t(1), t(0));
    writes(graph, p(1), t(1));
    alertOn(alerts, a(1), { pipeline: 1 });
    alertOn(alerts, a(0), { table: 0 }, a(1));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer.isCauseDrawn).toBe(true);
    expect(lineage.highlight).toEqual({
      nodeIds: [tn(0), tn(1), pn(1)],
      edgeIds: sorted([
        edgeId(lineage, tn(1), tn(0)),
        edgeId(lineage, pn(1), tn(1)),
      ]),
      causeNodeIds: [pn(1)],
      consequenceNodeIds: [],
      dataPipelineIds: [],
    });
    expect(drawnNode(lineage, pn(1))).toMatchObject({
      kind: DataLineageNodeKind.Pipeline,
      side: DataLineageSide.Upstream,
      depth: -2,
    });
  });

  test("a cause that is a pipeline moving data into the table: every arrow it moves data along", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();

    for (let index: number = 0; index < 5; index++) {
      table(graph, t(index));
    }

    pipeline(graph, p(1), { jobName: "orders_etl", lastRunState: "FAIL" });
    feeds(graph, t(2), t(0), { dataPipelineId: p(1) });
    feeds(graph, t(3), t(0), { dataPipelineId: p(1) });
    // Into the table, by no pipeline: not on the way.
    feeds(graph, t(4), t(0));
    alertOn(alerts, a(1), { pipeline: 1 });
    alertOn(alerts, a(0), { table: 0 }, a(1));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer.isCauseDrawn).toBe(true);
    expect(lineage.highlight).toEqual({
      // The tables it reads, so no picked-out arrow starts at a faint card.
      nodeIds: [tn(0), tn(2), tn(3)],
      edgeIds: sorted([
        edgeId(lineage, tn(2), tn(0)),
        edgeId(lineage, tn(3), tn(0)),
      ]),
      causeNodeIds: [],
      consequenceNodeIds: [],
      dataPipelineIds: [p(1)],
    });
    // Named on its arrows, as the drawing names a pipeline.
    expect(
      edgeBetween(lineage, tn(2), tn(0))?.pipelines.map(
        (entry: DataTableLineagePipeline): string => {
          return entry.dataPipelineId;
        },
      ),
    ).toEqual([p(1)]);
  });

  test("a cause about a whole database is told, not drawn", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    table(graph, t(0));
    table(graph, t(1));
    feeds(graph, t(1), t(0));
    alertOn(alerts, a(1), { store: true });
    alertOn(alerts, a(0), { table: 0 }, a(1));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer).toMatchObject({ hasCause: true, isCauseDrawn: false });
    expect(lineage.highlight).toBeUndefined();
    expect(nodeOf(lineage, tn(1))).toBeDefined();
  });

  test("a cause no lineage leads to is told, not drawn", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    table(graph, t(0));
    table(graph, t(1));
    table(graph, t(9));
    feeds(graph, t(1), t(0));
    alertOn(alerts, a(1), { table: 9 });
    alertOn(alerts, a(0), { table: 0 }, a(1));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer).toMatchObject({ hasCause: true, isCauseDrawn: false });
    expect(lineage.highlight).toBeUndefined();
    expect(nodeOf(lineage, tn(9))).toBeUndefined();
  });

  test("a way through a table the project no longer has leads nowhere: not picked out", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    table(graph, t(0));
    table(graph, t(2));
    // t1 was deleted; its rows are still there.
    feeds(graph, t(2), t(1));
    feeds(graph, t(1), t(0));
    alertOn(alerts, a(1), { table: 2 });
    alertOn(alerts, a(0), { table: 0 }, a(1));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer.isCauseDrawn).toBe(false);
    expect(lineage.highlight).toBeUndefined();
  });
});

describe("the ways down to the alerts it caused", () => {
  // t0 -> t5 -> t6, t0 -> t7, t0 -> t8; t8 has no alert.
  function fanOut(alerts: MemoryAlerts): MemoryGraph {
    const graph: MemoryGraph = newGraph();

    for (const index of [0, 5, 6, 7, 8]) {
      table(graph, t(index));
    }

    feeds(graph, t(0), t(5));
    feeds(graph, t(5), t(6));
    feeds(graph, t(0), t(7));
    feeds(graph, t(0), t(8));
    alertOn(alerts, a(0), { table: 0 });
    alertOn(alerts, a(2), { table: 5 }, a(0));
    alertOn(alerts, a(3), { table: 6 }, a(0));
    alertOn(alerts, a(4), { table: 7 }, a(0));

    return graph;
  }

  test("each alert it caused: its way picked out and its card marked", async () => {
    const alerts: MemoryAlerts = newAlerts();
    const graph: MemoryGraph = fanOut(alerts);

    const { answer, lineage } = await drawingFor(graph, alerts);
    const highlight: DataLineageHighlight = highlightOf(lineage);

    expect(answer).toMatchObject({
      hasCause: false,
      consequenceCount: 3,
      drawnConsequenceCount: 3,
    });
    expect(highlight.nodeIds[0]).toBe(tn(0));
    expect(sorted(highlight.nodeIds)).toEqual(
      sorted([tn(0), tn(5), tn(6), tn(7)]),
    );
    expect(highlight.edgeIds).toEqual(
      sorted([
        edgeId(lineage, tn(0), tn(5)),
        edgeId(lineage, tn(5), tn(6)),
        edgeId(lineage, tn(0), tn(7)),
      ]),
    );
    expect(highlight.consequenceNodeIds).toEqual(sorted([tn(5), tn(6), tn(7)]));
    expect(highlight.causeNodeIds).toEqual([]);
  });

  test("the ones its reader may not see are neither counted nor marked", async () => {
    const alerts: MemoryAlerts = newAlerts();
    const graph: MemoryGraph = fanOut(alerts);
    alerts.hidden.add(a(3));

    const { answer, lineage } = await drawingFor(graph, alerts);
    const highlight: DataLineageHighlight = highlightOf(lineage);

    expect(answer).toMatchObject({
      consequenceCount: 2,
      drawnConsequenceCount: 2,
    });
    expect(highlight.consequenceNodeIds).toEqual(sorted([tn(5), tn(7)]));
    expect(highlight.nodeIds).not.toContain(tn(6));
  });

  test("a way and a cause together: each marked as what it is", async () => {
    const alerts: MemoryAlerts = newAlerts();
    const graph: MemoryGraph = fanOut(alerts);
    table(graph, t(1));
    feeds(graph, t(1), t(0));
    alertOn(alerts, a(1), { table: 1 });
    alerts.rows.get(a(0))!.causeAlertId = a(1);

    const { answer, lineage } = await drawingFor(graph, alerts);
    const highlight: DataLineageHighlight = highlightOf(lineage);

    expect(answer).toMatchObject({
      hasCause: true,
      isCauseDrawn: true,
      consequenceCount: 3,
      drawnConsequenceCount: 3,
    });
    expect(highlight.causeNodeIds).toEqual([tn(1)]);
    expect(highlight.consequenceNodeIds).toEqual(sorted([tn(5), tn(6), tn(7)]));
  });

  test("an alert it caused about a pipeline reading the table: the arrows it moves data along", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();

    for (const index of [0, 8, 9]) {
      table(graph, t(index));
    }

    pipeline(graph, p(2), { jobName: "orders_mart" });
    feeds(graph, t(0), t(8), { dataPipelineId: p(2) });
    feeds(graph, t(0), t(9));
    alertOn(alerts, a(0), { table: 0 });
    alertOn(alerts, a(5), { pipeline: 2 }, a(0));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer.drawnConsequenceCount).toBe(1);
    expect(lineage.highlight).toEqual({
      nodeIds: [tn(0), tn(8)],
      edgeIds: [edgeId(lineage, tn(0), tn(8))],
      causeNodeIds: [],
      consequenceNodeIds: [],
      dataPipelineIds: [p(2)],
    });
  });

  test("past the most looked for: all counted, the first ones drawn and marked", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    const count: number = MAX_DATA_ALERT_LINEAGE_CONSEQUENCES + 5;

    table(graph, t(0));
    alertOn(alerts, a(0), { table: 0 });

    for (let index: number = 1; index <= count; index++) {
      table(graph, t(index));
      feeds(graph, t(0), t(index));
      alertOn(alerts, a(index), { table: index }, a(0));
    }

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer).toMatchObject({
      consequenceCount: count,
      drawnConsequenceCount: MAX_DATA_ALERT_LINEAGE_CONSEQUENCES,
    });
    expect(highlightOf(lineage).consequenceNodeIds).toHaveLength(
      MAX_DATA_ALERT_LINEAGE_CONSEQUENCES,
    );
    // Each one looked for is drawn past the most a card shows; the rest are counted.
    expect(drawnNode(lineage, tn(0)).hiddenDownstreamCount).toBe(5);
  });

  test("ways the drawing cannot hold whole are not picked out: half a way leads nowhere", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();
    // Fifty chains down from t0, ten each of one to five tables, an alert at each end.
    const chainEnds: Map<number, Array<string>> = new Map();

    table(graph, t(0));
    alertOn(alerts, a(0), { table: 0 });

    for (let chain: number = 0; chain < 50; chain++) {
      const length: number = 1 + (chain % 5);
      let previous: number = 0;

      for (let step: number = 1; step <= length; step++) {
        const index: number = 1000 + chain * 10 + step;

        table(graph, t(index));
        feeds(graph, t(previous), t(index));
        previous = index;
      }

      alertOn(alerts, a(chain + 1), { table: previous }, a(0));
      chainEnds.set(length, [...(chainEnds.get(length) || []), tn(previous)]);
    }

    const { answer, lineage } = await drawingFor(graph, alerts);
    const highlight: DataLineageHighlight = highlightOf(lineage);
    const downstream: number = lineage.nodes.filter(
      (node: DataTableLineageNode): boolean => {
        return node.side === DataLineageSide.Downstream;
      },
    ).length;

    // 50 + 40 + 30 tables fill the side: the chains of one to three steps are whole.
    expect(downstream).toBe(MAX_DATA_LINEAGE_TABLES_PER_SIDE);
    expect(lineage.isTruncated).toBe(true);
    expect(lineage.depth).toBe(MAX_DATA_LINEAGE_DEPTH);
    expect(answer).toMatchObject({
      consequenceCount: 50,
      drawnConsequenceCount: 30,
    });
    expect(highlight.consequenceNodeIds).toEqual(
      sorted([
        ...chainEnds.get(1)!,
        ...chainEnds.get(2)!,
        ...chainEnds.get(3)!,
      ]),
    );

    // Not one card of a cut way is picked out.
    for (const end of [...chainEnds.get(4)!, ...chainEnds.get(5)!]) {
      expect(highlight.nodeIds).not.toContain(end);
    }

    // The drawing's own card and every table of the ten whole chains of one, two and three.
    expect(highlight.nodeIds).toHaveLength(1 + 10 * (1 + 2 + 3));
  });

  test("an alert it caused further down than the most steps is counted, not drawn", async () => {
    const graph: MemoryGraph = newGraph();
    const alerts: MemoryAlerts = newAlerts();

    for (let index: number = 0; index <= 6; index++) {
      table(graph, t(index));

      if (index > 0) {
        feeds(graph, t(index - 1), t(index));
      }
    }

    alertOn(alerts, a(0), { table: 0 });
    alertOn(alerts, a(1), { table: 6 }, a(0));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer).toMatchObject({
      consequenceCount: 1,
      drawnConsequenceCount: 0,
    });
    expect(lineage.highlight).toBeUndefined();
    expect(lineage.depth).toBe(DEFAULT_DATA_LINEAGE_DEPTH);
  });
});

describe("an alert on a pipeline", () => {
  // t0 -> t1 -[p0 reads t1, writes t2]-> t2 -> t3 -> t4.
  function etl(): MemoryGraph {
    const graph: MemoryGraph = newGraph();

    for (let index: number = 0; index < 5; index++) {
      table(graph, t(index));
    }

    pipeline(graph, p(0), { jobName: "orders_etl", lastRunState: "FAIL" });
    feeds(graph, t(0), t(1));
    runs(graph, p(0), { reads: [t(1)], writes: [t(2)] });
    feeds(graph, t(2), t(3));
    feeds(graph, t(3), t(4));

    return graph;
  }

  test("with nothing to look for: drawn as its page draws it, its rows read once", async () => {
    const graph: MemoryGraph = etl();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { pipeline: 0 });

    const { lineage } = await drawingFor(graph, alerts);
    const plain: DataTableLineage | null =
      await DataTableLineageReader.buildForPipeline({
        focusDataPipelineId: p(0),
        depth: DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
        now: NOW,
        reader: memoryReader(etl()),
      });

    expect(lineage).toEqual(plain);
    expect(lineage.focusNodeId).toBe(pn(0));
    expect(lineage.highlight).toBeUndefined();
    expect(graph.pipelineEdgeReads).toEqual([p(0)]);
  });

  test("the way down to the tables it left late: that side drawn as far as they are", async () => {
    const graph: MemoryGraph = etl();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(0), { pipeline: 0 });
    alertOn(alerts, a(2), { table: 2 }, a(0));
    alertOn(alerts, a(3), { table: 3 }, a(0));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer).toMatchObject({
      consequenceCount: 2,
      drawnConsequenceCount: 2,
    });
    expect(lineage.depth).toBe(2);
    expect(lineage.highlight).toEqual({
      nodeIds: [pn(0), tn(2), tn(3)],
      edgeIds: sorted([
        edgeId(lineage, pn(0), tn(2)),
        edgeId(lineage, tn(2), tn(3)),
      ]),
      causeNodeIds: [],
      consequenceNodeIds: sorted([tn(2), tn(3)]),
      dataPipelineIds: [],
    });
    // Upstream keeps its one step; t4 is counted on t3's card.
    expect(nodeOf(lineage, tn(0))).toBeUndefined();
    expect(drawnNode(lineage, tn(3)).hiddenDownstreamCount).toBe(1);
    // Its rows read once, for the ways and the drawing both.
    expect(graph.pipelineEdgeReads).toEqual([p(0)]);
  });

  test("a cause up from a table it reads", async () => {
    const graph: MemoryGraph = etl();
    const alerts: MemoryAlerts = newAlerts();
    lateTable(graph, t(0));
    alertOn(alerts, a(1), { table: 0 });
    alertOn(alerts, a(0), { pipeline: 0 }, a(1));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer.isCauseDrawn).toBe(true);
    expect(lineage.highlight).toEqual({
      nodeIds: [pn(0), tn(1), tn(0)],
      edgeIds: sorted([
        edgeId(lineage, tn(1), pn(0)),
        edgeId(lineage, tn(0), tn(1)),
      ]),
      causeNodeIds: [tn(0)],
      consequenceNodeIds: [],
      dataPipelineIds: [],
    });
    expect(drawnNode(lineage, tn(0)).depth).toBe(-2);
  });

  test("a cause on a table it reads: one step", async () => {
    const graph: MemoryGraph = etl();
    const alerts: MemoryAlerts = newAlerts();
    alertOn(alerts, a(1), { table: 1 });
    alertOn(alerts, a(0), { pipeline: 0 }, a(1));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer.isCauseDrawn).toBe(true);
    expect(lineage.depth).toBe(DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH);
    expect(lineage.highlight).toEqual({
      nodeIds: [pn(0), tn(1)],
      edgeIds: [edgeId(lineage, tn(1), pn(0))],
      causeNodeIds: [tn(1)],
      consequenceNodeIds: [],
      dataPipelineIds: [],
    });
  });

  test("a cause that is another pipeline loading a table it reads", async () => {
    const graph: MemoryGraph = etl();
    const alerts: MemoryAlerts = newAlerts();
    pipeline(graph, p(1), { jobName: "fivetran_orders", lastRunState: "FAIL" });
    writes(graph, p(1), t(1));
    alertOn(alerts, a(1), { pipeline: 1 });
    alertOn(alerts, a(0), { pipeline: 0 }, a(1));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer.isCauseDrawn).toBe(true);
    expect(lineage.highlight).toEqual({
      nodeIds: [pn(0), tn(1), pn(1)],
      edgeIds: sorted([
        edgeId(lineage, tn(1), pn(0)),
        edgeId(lineage, pn(1), tn(1)),
      ]),
      causeNodeIds: [pn(1)],
      consequenceNodeIds: [],
      dataPipelineIds: [],
    });
  });

  test("an alert it caused about a pipeline reading what it writes", async () => {
    const graph: MemoryGraph = etl();
    const alerts: MemoryAlerts = newAlerts();
    pipeline(graph, p(2), { jobName: "orders_mart" });
    table(graph, t(7));
    runs(graph, p(2), { reads: [t(2)], writes: [t(7)] });
    alertOn(alerts, a(0), { pipeline: 0 });
    alertOn(alerts, a(5), { pipeline: 2 }, a(0));

    const { answer, lineage } = await drawingFor(graph, alerts);

    expect(answer.drawnConsequenceCount).toBe(1);
    expect(lineage.depth).toBe(2);
    expect(lineage.highlight).toEqual({
      nodeIds: [pn(0), tn(2), tn(7)],
      edgeIds: sorted([
        edgeId(lineage, pn(0), tn(2)),
        edgeId(lineage, tn(2), tn(7)),
      ]),
      causeNodeIds: [],
      consequenceNodeIds: [],
      dataPipelineIds: [p(2)],
    });
  });
});

describe("the ways themselves", () => {
  test("nothing sought: nothing read", async () => {
    const graph: MemoryGraph = newGraph();
    table(graph, t(0));
    table(graph, t(1));
    feeds(graph, t(1), t(0));

    const ways: Map<string, DataLineageWay> =
      await DataAlertLineageReader.findWays({
        direction: DataLineageDirection.Upstream,
        start: [t(0)],
        startStep: 0,
        targets: { dataAssetIds: new Set(), dataPipelineIds: new Set() },
        reader: memoryReader(graph),
      });

    expect(ways.size).toBe(0);
    expect(graph.edgeReads).toEqual([]);
  });

  test("a table a pipeline reads is a way of one step, found without a read", async () => {
    const graph: MemoryGraph = newGraph();

    const ways: Map<string, DataLineageWay> =
      await DataAlertLineageReader.findWays({
        direction: DataLineageDirection.Upstream,
        start: [t(1), t(2)],
        startStep: 1,
        targets: { dataAssetIds: new Set([t(2)]), dataPipelineIds: new Set() },
        reader: memoryReader(graph),
      });

    expect(Array.from(ways.entries())).toEqual([
      [
        tn(2),
        {
          dataAssetIds: [t(2)],
          end: DataLineageWayEnd.Table,
          dataPipelineId: null,
          viaDataAssetId: null,
        },
      ],
    ]);
    expect(graph.edgeReads).toEqual([]);
  });

  test("a pipeline moving data along an arrow ends there, before one loading the table from outside", async () => {
    const graph: MemoryGraph = newGraph();
    feeds(graph, t(1), t(0));
    feeds(graph, t(2), t(1), { dataPipelineId: p(1) });
    writes(graph, p(1), t(1));
    writes(graph, p(2), t(1));

    const ways: Map<string, DataLineageWay> =
      await DataAlertLineageReader.findWays({
        direction: DataLineageDirection.Upstream,
        start: [t(0)],
        startStep: 0,
        targets: {
          dataAssetIds: new Set(),
          dataPipelineIds: new Set([p(1), p(2)]),
        },
        reader: memoryReader(graph),
      });

    expect(ways.get(pn(1))).toEqual({
      dataAssetIds: [t(1)],
      end: DataLineageWayEnd.Arrow,
      dataPipelineId: p(1),
      viaDataAssetId: t(2),
    });
    expect(ways.get(pn(2))).toEqual({
      dataAssetIds: [t(1)],
      end: DataLineageWayEnd.Writer,
      dataPipelineId: p(2),
      viaDataAssetId: null,
    });
  });

  test("downstream, a pipeline is met on the arrows out of a table, never as a writer", async () => {
    const graph: MemoryGraph = newGraph();
    feeds(graph, t(0), t(1), { dataPipelineId: p(1) });
    writes(graph, p(2), t(1));

    const ways: Map<string, DataLineageWay> =
      await DataAlertLineageReader.findWays({
        direction: DataLineageDirection.Downstream,
        start: [t(0)],
        startStep: 0,
        targets: {
          dataAssetIds: new Set(),
          dataPipelineIds: new Set([p(1), p(2)]),
        },
        reader: memoryReader(graph),
      });

    expect(ways.get(pn(1))).toEqual({
      dataAssetIds: [],
      end: DataLineageWayEnd.Arrow,
      dataPipelineId: p(1),
      viaDataAssetId: t(1),
    });
    expect(ways.has(pn(2))).toBe(false);
  });

  test("stops once every one is found", async () => {
    const graph: MemoryGraph = newGraph();

    for (let index: number = 1; index <= 5; index++) {
      feeds(graph, t(index), t(index - 1));
    }

    await DataAlertLineageReader.findWays({
      direction: DataLineageDirection.Upstream,
      start: [t(0)],
      startStep: 0,
      targets: { dataAssetIds: new Set([t(2)]), dataPipelineIds: new Set() },
      reader: memoryReader(graph),
    });

    expect(graph.edgeReads).toEqual([
      { direction: DataLineageDirection.Upstream, ids: [t(0)] },
      { direction: DataLineageDirection.Upstream, ids: [t(1)] },
    ]);
  });

  test("never further than the most steps, nor past the most tables", async () => {
    const deep: MemoryGraph = newGraph();

    for (let index: number = 1; index <= MAX_DATA_LINEAGE_DEPTH + 1; index++) {
      feeds(deep, t(index), t(index - 1));
    }

    const far: Map<string, DataLineageWay> =
      await DataAlertLineageReader.findWays({
        direction: DataLineageDirection.Upstream,
        start: [t(0)],
        startStep: 0,
        targets: {
          dataAssetIds: new Set([
            t(MAX_DATA_LINEAGE_DEPTH),
            t(MAX_DATA_LINEAGE_DEPTH + 1),
          ]),
          dataPipelineIds: new Set(),
        },
        reader: memoryReader(deep),
      });

    expect(Array.from(far.keys())).toEqual([tn(MAX_DATA_LINEAGE_DEPTH)]);
    expect(deep.edgeReads).toHaveLength(MAX_DATA_LINEAGE_DEPTH);

    // More tables a step up than a search reads: the one past them is never found.
    const wide: MemoryGraph = newGraph();

    for (let index: number = 1; index <= MAX_DATA_ALERT_WAY_TABLES; index++) {
      feeds(wide, t(index), t(0));
    }

    feeds(wide, t(99999), t(1));

    const past: Map<string, DataLineageWay> =
      await DataAlertLineageReader.findWays({
        direction: DataLineageDirection.Upstream,
        start: [t(0)],
        startStep: 0,
        targets: {
          dataAssetIds: new Set([t(99999)]),
          dataPipelineIds: new Set(),
        },
        reader: memoryReader(wide),
      });

    expect(past.size).toBe(0);
    expect(wide.edgeReads).toHaveLength(1);
  });
});

describe("any alert's lineage", () => {
  // The fewest steps from where a search sets out to every table, one way, through every row.
  function distances(
    graph: MemoryGraph,
    start: Array<string>,
    startStep: number,
    isUpstream: boolean,
  ): Map<string, number> {
    const steps: Map<string, number> = new Map();
    let frontier: Array<string> = [...start];

    for (const id of start) {
      steps.set(id, startStep);
    }

    for (let step: number = startStep + 1; frontier.length > 0; step++) {
      const next: Array<string> = [];

      for (const edge of graph.edges) {
        const near: string | null = isUpstream
          ? edge.downstreamDataAssetId
          : edge.upstreamDataAssetId;
        const far: string | null = isUpstream
          ? edge.upstreamDataAssetId
          : edge.downstreamDataAssetId;

        if (near && far && frontier.includes(near) && !steps.has(far)) {
          steps.set(far, step);
          next.push(far);
        }
      }

      frontier = next;
    }

    return steps;
  }

  test("keeps every promise of the drawing", async () => {
    const random: SeededRandom = seededRandom(6662);
    // How many rounds drew a cause, an alert it caused, and a pipeline on its arrows: none may be vacuous.
    let causesDrawn: number = 0;
    let consequencesDrawn: number = 0;
    let arrowsDrawn: number = 0;

    for (let round: number = 0; round < 120; round++) {
      const graph: MemoryGraph = newGraph();
      const alerts: MemoryAlerts = newAlerts();
      const count: number = 6 + random(40);

      for (let index: number = 0; index < count; index++) {
        // Now and then a table the project no longer has.
        if (index > 0 && random() < 0.04) {
          continue;
        }

        if (random() < 0.15) {
          lateTable(graph, t(index));
        } else {
          table(graph, t(index));
        }
      }

      for (let index: number = 0; index <= 4; index++) {
        pipeline(graph, p(index), {
          lastRunState: random() < 0.3 ? "FAIL" : "COMPLETE",
        });
      }

      // Every edge from a lower table to a higher one: no loops.
      for (let index: number = 0; index < count * 2; index++) {
        const one: number = random(count);
        const other: number = random(count);

        if (one !== other) {
          feeds(graph, t(Math.min(one, other)), t(Math.max(one, other)), {
            dataPipelineId: random() < 0.4 ? p(1 + random(4)) : null,
            lastSeenAt: new Date(NOW.getTime() - random(300) * HOUR),
          });
        }
      }

      for (let index: number = 1; index <= 4; index++) {
        if (random() < 0.3) {
          writes(graph, p(index), t(random(count)));
        }
      }

      // p0 reads below a split and writes above it.
      const split: number = 1 + random(count - 1);

      for (let run: number = 0; run < random(5); run++) {
        runs(graph, p(0), {
          reads: [random(split), random(split)].map(t),
          writes: [split + random(count - split)].map(t),
        });
      }

      const isPipelineFocus: boolean = random() < 0.4;
      const focusTable: number = random(count);
      // Where its cause most likely is - below it - and what it caused - above it.
      const below: number = isPipelineFocus ? split : focusTable;
      const above: number = isPipelineFocus ? split : focusTable + 1;
      const pickBelow: () => number = (): number => {
        return below > 0 && random() < 0.8 ? random(below) : random(count);
      };
      const pickAbove: () => number = (): number => {
        return above < count && random() < 0.8
          ? above + random(count - above)
          : random(count);
      };

      if (!isPipelineFocus && !graph.tables.has(t(focusTable))) {
        table(graph, t(focusTable));
      }

      // The cause: a table, a pipeline or a whole database, now and then one its reader may not see.
      let cause: DataAlertLineageRow | null = null;
      const roll: number = random();

      if (roll < 0.35) {
        cause = alertOn(alerts, a(1), { table: pickBelow() });
      } else if (roll < 0.55) {
        cause = alertOn(alerts, a(1), { pipeline: 1 + random(4) });
      } else if (roll < 0.62) {
        cause = alertOn(alerts, a(1), { store: true });
      }

      if (cause && random() < 0.1) {
        alerts.hidden.add(a(1));
      }

      const own: DataAlertLineageRow = alertOn(
        alerts,
        a(0),
        isPipelineFocus ? { pipeline: 0 } : { table: focusTable },
        cause ? a(1) : null,
      );

      if (random() < 0.05) {
        alerts.hidden.add(a(0));
      }

      // What it caused: tables and pipelines, never the cause's pipeline; some hidden.
      for (let index: number = 0; index < random(9); index++) {
        let about: { table?: number; pipeline?: number } = {
          table: pickAbove(),
        };

        if (random() < 0.25) {
          const id: number = 1 + random(4);

          if (cause?.dataPipelineId !== p(id)) {
            about = { pipeline: id };
          }
        }

        alertOn(alerts, a(10 + index), about, a(0));

        if (random() < 0.15) {
          alerts.hidden.add(a(10 + index));
        }
      }

      const answer: DataAlertLineageAnswer | null = await answerFor(
        graph,
        alerts,
      );

      if (alerts.hidden.has(a(0)) || (cause && alerts.hidden.has(a(1)))) {
        expect(answer).toBeNull();
        continue;
      }

      const seenConsequences: Array<DataAlertLineageRow> = Array.from(
        alerts.rows.values(),
      ).filter((row: DataAlertLineageRow): boolean => {
        return row.causeAlertId === a(0) && !alerts.hidden.has(row.alertId);
      });

      expect(answer).not.toBeNull();
      expect(answer!.hasCause).toBe(Boolean(cause));
      expect(answer!.consequenceCount).toBe(seenConsequences.length);

      const lineage: DataTableLineage = answer!.lineage!;

      expect(lineage).not.toBeNull();

      const focusNodeId: string = isPipelineFocus ? pn(0) : tn(focusTable);
      const nodes: Map<string, DataTableLineageNode> = new Map(
        lineage.nodes.map(
          (node: DataTableLineageNode): [string, DataTableLineageNode] => {
            return [node.id, node];
          },
        ),
      );
      const edges: Map<string, DataTableLineageEdge> = new Map(
        lineage.edges.map(
          (edge: DataTableLineageEdge): [string, DataTableLineageEdge] => {
            return [edge.id, edge];
          },
        ),
      );

      expect(lineage.focusNodeId).toBe(focusNodeId);
      expect(lineage.depth).toBeGreaterThanOrEqual(
        isPipelineFocus
          ? DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH
          : DEFAULT_DATA_LINEAGE_DEPTH,
      );
      expect(lineage.depth).toBeLessThanOrEqual(MAX_DATA_LINEAGE_DEPTH);

      const highlight: DataLineageHighlight | undefined = lineage.highlight;

      if (!highlight) {
        expect(answer!.isCauseDrawn).toBe(false);
        expect(answer!.drawnConsequenceCount).toBe(0);
        continue;
      }

      // Every card and arrow picked out is drawn, the drawing's own card first.
      expect(highlight.nodeIds[0]).toBe(focusNodeId);
      expect(new Set(highlight.nodeIds).size).toBe(highlight.nodeIds.length);
      expect(highlight.edgeIds).toEqual(sorted(highlight.edgeIds));
      expect(new Set(highlight.edgeIds).size).toBe(highlight.edgeIds.length);

      for (const id of highlight.nodeIds) {
        expect(nodes.has(id)).toBe(true);
      }

      // Each picked-out arrow between picked-out cards: no way leads nowhere.
      const linked: Map<string, Array<string>> = new Map();

      for (const id of highlight.edgeIds) {
        const edge: DataTableLineageEdge | undefined = edges.get(id);

        expect(edge).toBeDefined();
        expect(highlight.nodeIds).toContain(edge!.source);
        expect(highlight.nodeIds).toContain(edge!.target);
        linked.set(edge!.source, [
          ...(linked.get(edge!.source) || []),
          edge!.target,
        ]);
        linked.set(edge!.target, [
          ...(linked.get(edge!.target) || []),
          edge!.source,
        ]);
      }

      // And every picked-out card reached from the drawing's own along them.
      const reached: Set<string> = new Set([focusNodeId]);
      let frontier: Array<string> = [focusNodeId];

      while (frontier.length > 0) {
        const next: Array<string> = [];

        for (const id of frontier) {
          for (const other of linked.get(id) || []) {
            if (!reached.has(other)) {
              reached.add(other);
              next.push(other);
            }
          }
        }

        frontier = next;
      }

      expect(sorted(Array.from(reached))).toEqual(sorted(highlight.nodeIds));

      // Each pipeline picked out is named on a picked-out arrow.
      for (const pipelineId of highlight.dataPipelineIds) {
        expect(
          highlight.edgeIds.some((id: string): boolean => {
            return edges
              .get(id)!
              .pipelines.some((entry: DataTableLineagePipeline): boolean => {
                return entry.dataPipelineId === pipelineId;
              });
          }),
        ).toBe(true);
      }

      // A cause upstream, what it caused downstream, each on the fewest steps.
      const isTableFocus: boolean = !isPipelineFocus;
      const pipelineReads: Array<string> = [];
      const pipelineWrites: Array<string> = [];

      for (const edge of graph.edges) {
        if (edge.dataPipelineId === p(0)) {
          pipelineWrites.push(edge.downstreamDataAssetId);

          if (edge.upstreamDataAssetId) {
            pipelineReads.push(edge.upstreamDataAssetId);
          }
        }
      }

      const up: Map<string, number> = isTableFocus
        ? distances(graph, [t(focusTable)], 0, true)
        : distances(graph, pipelineReads, 1, true);
      const down: Map<string, number> = isTableFocus
        ? distances(graph, [t(focusTable)], 0, false)
        : distances(graph, pipelineWrites, 1, false);

      for (const id of highlight.causeNodeIds) {
        expect(highlight.nodeIds).toContain(id);
        expect(nodes.get(id)!.side).toBe(DataLineageSide.Upstream);

        const node: DataTableLineageNode = nodes.get(id)!;

        if (node.kind === DataLineageNodeKind.Table) {
          expect(node.depth).toBe(-up.get(node.dataAssetId!)!);
        }
      }

      for (const id of highlight.consequenceNodeIds) {
        expect(highlight.nodeIds).toContain(id);

        const node: DataTableLineageNode = nodes.get(id)!;

        expect(node.side).toBe(DataLineageSide.Downstream);
        expect(node.kind).toBe(DataLineageNodeKind.Table);
        expect(node.depth).toBe(down.get(node.dataAssetId!)!);
      }

      causesDrawn += answer!.isCauseDrawn ? 1 : 0;
      consequencesDrawn += answer!.drawnConsequenceCount > 0 ? 1 : 0;
      arrowsDrawn += highlight.dataPipelineIds.length > 0 ? 1 : 0;

      // What the answer says was drawn is what is picked out.
      if (cause?.dataAssetId) {
        expect(answer!.isCauseDrawn).toBe(
          highlight.causeNodeIds.includes(
            getLineageTableNodeId(cause.dataAssetId),
          ),
        );
      } else if (cause?.dataPipelineId) {
        expect(answer!.isCauseDrawn).toBe(
          highlight.causeNodeIds.includes(
            getLineagePipelineNodeId(cause.dataPipelineId),
          ) || highlight.dataPipelineIds.includes(cause.dataPipelineId),
        );
      } else {
        expect(answer!.isCauseDrawn).toBe(false);
      }

      const focusOf: string = own.dataAssetId || own.dataPipelineId!;

      expect(answer!.drawnConsequenceCount).toBe(
        seenConsequences
          .slice(0, MAX_DATA_ALERT_LINEAGE_CONSEQUENCES)
          .filter((row: DataAlertLineageRow): boolean => {
            if ((row.dataAssetId || row.dataPipelineId) === focusOf) {
              return false;
            }

            return row.dataAssetId
              ? highlight.consequenceNodeIds.includes(
                  getLineageTableNodeId(row.dataAssetId),
                )
              : highlight.dataPipelineIds.includes(row.dataPipelineId!);
          }).length,
      );
    }

    expect(causesDrawn).toBeGreaterThan(5);
    expect(consequencesDrawn).toBeGreaterThan(5);
    expect(arrowsDrawn).toBeGreaterThan(0);
  });
});
