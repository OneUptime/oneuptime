import { describe, expect, test } from "@jest/globals";
import DataTableLineageReader from "../../../Server/Utils/DataObservability/DataTableLineage";
import {
  DataColumnMapping,
  mergeColumnMappings,
} from "../../../Types/DataObservability/DataColumnLineage";
import {
  DataLineageExpandRequest,
  DataLineageExpansion,
  readDataLineageExpandRequest,
} from "../../../Types/DataObservability/DataLineageExpansion";
import {
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  MAX_DATA_LINEAGE_TABLES_PER_SIDE,
  getLineageDashboardNodeId,
  getLineageEdgeId,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../Types/DataObservability/DataTableLineage";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  HOUR,
  MemoryGraph,
  NOW,
  columns,
  d,
  feeds,
  lateTable,
  memoryReader,
  newGraph,
  p,
  pipeline,
  runs,
  t,
  table,
  uuid,
  writes,
} from "../../Server/Utils/DataObservability/LineageMemoryGraph";
import {
  canExpandLineageCard,
  countLineageTables,
  getLineageExpandRequest,
  mergeLineageExpansion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/LineageGraphModel";

/*
 * DRAWING MORE, END TO END WITHOUT A DATABASE (#6667, #6665).
 *
 * The server draws a graph held in memory (LineageMemoryGraph) as a
 * table's Lineage tab, or a pipeline's page, reads it. Then, again and
 * again, a card whose count can be pressed (the Dashboard's
 * canExpandLineageCard) is pressed: the Dashboard's request
 * (getLineageExpandRequest) goes through the route's strict reading
 * (readDataLineageExpandRequest) to the server's answer (buildExpansion),
 * which the Dashboard adds in place (mergeLineageExpansion). After the
 * drawing and after every press, the drawing is one a drawing read whole
 * could be:
 *
 * - every card once, every arrow once and between two cards drawn, the
 *   drawing's own card alone in the middle, no side past its most;
 * - every table card counts, its own way, exactly the tables the project
 *   has that are not drawn - the drawing's own table both ways - and a
 *   pipeline's own card exactly the tables it reads, or writes, that are
 *   not drawn, every one drawn joined to it;
 * - the arrows between tables are exactly those a drawing read whole
 *   draws: every one into a table upstream or the drawing's own, and out
 *   of a table downstream or the drawing's own; one from a table upstream
 *   to one downstream is left out;
 * - each arrow carries every source's columns, when the drawing was read
 *   with its columns;
 * - the dashboards drawn and the ones counted are every dashboard built on
 *   a table drawn that is not upstream, each joined to every such table it
 *   reads.
 *
 * Every press draws at least one table, nothing drawn moves, and the same
 * answer added twice changes nothing more; pressed until no count can be,
 * a table's drawing holds everything upstream and downstream of it. Some
 * drawings have the cards beside the drawing's own card pressed first, so
 * the tables its own count counts are drawn through others, and its count
 * must fall as they are. The graphs are drawn from seeded streams: a
 * failure names its seed, round and press.
 */

interface Truth {
  // Each table the project has, the tables it is built from and the tables built from it.
  upstreamOf: Map<string, Set<string>>;
  downstreamOf: Map<string, Set<string>>;
  // "upstream>downstream", between two tables the project has.
  pairs: Set<string>;
  // Every source's columns of each pair, as one arrow carries them.
  columnsOf: Map<string, Array<DataColumnMapping>>;
  // The drawing's own pipeline: the tables it reads and the tables it writes.
  pipelineReads: Set<string>;
  pipelineWrites: Set<string>;
}

function addTo(map: Map<string, Set<string>>, key: string, id: string): void {
  const set: Set<string> = map.get(key) || new Set();

  set.add(id);
  map.set(key, set);
}

function truthOf(graph: MemoryGraph, focusPipelineId: string | null): Truth {
  const truth: Truth = {
    upstreamOf: new Map(),
    downstreamOf: new Map(),
    pairs: new Set(),
    columnsOf: new Map(),
    pipelineReads: new Set(),
    pipelineWrites: new Set(),
  };

  for (const row of graph.edges) {
    const upstream: string | null = row.upstreamDataAssetId;
    const downstream: string = row.downstreamDataAssetId;

    if (
      upstream &&
      upstream !== downstream &&
      graph.tables.has(upstream) &&
      graph.tables.has(downstream)
    ) {
      addTo(truth.upstreamOf, downstream, upstream);
      addTo(truth.downstreamOf, upstream, downstream);
      truth.pairs.add(`${upstream}>${downstream}`);
    }

    if (focusPipelineId && row.dataPipelineId === focusPipelineId) {
      truth.pipelineWrites.add(downstream);

      if (upstream && upstream !== downstream) {
        truth.pipelineReads.add(upstream);
      }
    }
  }

  for (const id of truth.pipelineWrites) {
    truth.pipelineReads.delete(id);
  }

  for (const set of [truth.pipelineReads, truth.pipelineWrites]) {
    for (const id of Array.from(set)) {
      if (!graph.tables.has(id)) {
        set.delete(id);
      }
    }
  }

  for (const row of graph.columnRows) {
    const key: string = `${row.upstreamDataAssetId}>${row.downstreamDataAssetId}`;
    const merged: Array<DataColumnMapping> = mergeColumnMappings(
      truth.columnsOf.get(key),
      row.columnMappings,
    );

    if (merged.length > 0) {
      truth.columnsOf.set(key, merged);
    }
  }

  return truth;
}

function tablesDrawn(
  lineage: DataTableLineage,
): Map<string, DataTableLineageNode> {
  const drawn: Map<string, DataTableLineageNode> = new Map();

  for (const node of lineage.nodes) {
    if (node.kind === DataLineageNodeKind.Table && node.dataAssetId) {
      drawn.set(node.dataAssetId, node);
    }
  }

  return drawn;
}

function notDrawn(
  ids: Set<string> | undefined,
  drawn: Map<string, DataTableLineageNode>,
): number {
  return Array.from(ids || []).filter((id: string): boolean => {
    return !drawn.has(id);
  }).length;
}

// Every promise of a drawing, for the graph it was drawn from.
function expectTrue(data: {
  graph: MemoryGraph;
  truth: Truth;
  lineage: DataTableLineage;
  withColumns: boolean;
  where: string;
}): void {
  const { graph, truth, lineage, where } = data;
  const byId: Map<string, DataTableLineageNode> = new Map();

  for (const node of lineage.nodes) {
    byId.set(node.id, node);
  }

  const edgeIds: Set<string> = new Set(
    lineage.edges.map((edge: DataTableLineageEdge): string => {
      return edge.id;
    }),
  );

  // Every card once, every arrow once, between cards drawn.
  expect([where, byId.size]).toEqual([where, lineage.nodes.length]);
  expect([where, edgeIds.size]).toEqual([where, lineage.edges.length]);

  for (const edge of lineage.edges) {
    expect([
      where,
      edge.id,
      byId.has(edge.source),
      byId.has(edge.target),
    ]).toEqual([where, edge.id, true, true]);
  }

  // The drawing's own card alone in the middle.
  expect([
    where,
    lineage.nodes
      .filter((node: DataTableLineageNode): boolean => {
        return node.side === DataLineageSide.Focus;
      })
      .map((node: DataTableLineageNode): string => {
        return `${node.id}@${node.depth}`;
      }),
  ]).toEqual([where, [`${lineage.focusNodeId}@0`]]);

  const drawn: Map<string, DataTableLineageNode> = tablesDrawn(lineage);

  for (const node of drawn.values()) {
    if (node.side === DataLineageSide.Upstream) {
      expect([where, node.id, node.depth < 0]).toEqual([where, node.id, true]);
    }

    if (node.side === DataLineageSide.Downstream) {
      expect([where, node.id, node.depth > 0]).toEqual([where, node.id, true]);
    }
  }

  for (const side of [DataLineageSide.Upstream, DataLineageSide.Downstream]) {
    expect(countLineageTables(lineage, side)).toBeLessThanOrEqual(
      MAX_DATA_LINEAGE_TABLES_PER_SIDE,
    );
  }

  // Each table card counts its own way exactly the tables not drawn.
  for (const [id, node] of drawn) {
    const upstream: number =
      node.side === DataLineageSide.Downstream
        ? 0
        : notDrawn(truth.upstreamOf.get(id), drawn);
    const downstream: number =
      node.side === DataLineageSide.Upstream
        ? 0
        : notDrawn(truth.downstreamOf.get(id), drawn);

    expect([
      where,
      node.id,
      node.hiddenUpstreamCount || 0,
      node.hiddenDownstreamCount || 0,
    ]).toEqual([where, node.id, upstream, downstream]);
  }

  // A pipeline's own card: what it reads, or writes, not drawn; each drawn joined to it.
  const focus: DataTableLineageNode = byId.get(lineage.focusNodeId)!;

  if (focus.kind === DataLineageNodeKind.Pipeline) {
    expect([
      where,
      focus.hiddenUpstreamCount || 0,
      focus.hiddenDownstreamCount || 0,
    ]).toEqual([
      where,
      notDrawn(truth.pipelineReads, drawn),
      notDrawn(truth.pipelineWrites, drawn),
    ]);

    const joined: Set<string> = new Set();

    for (const edge of lineage.edges) {
      if (edge.target === focus.id) {
        expect([where, edge.kind]).toEqual([where, DataLineageEdgeKind.Reads]);
        joined.add(edge.source);
      }

      if (edge.source === focus.id) {
        expect([where, edge.kind]).toEqual([where, DataLineageEdgeKind.Writes]);
        joined.add(edge.target);
      }
    }

    const expected: Set<string> = new Set();

    for (const id of [...truth.pipelineReads, ...truth.pipelineWrites]) {
      if (drawn.has(id)) {
        expected.add(getLineageTableNodeId(id));
      }
    }

    expect([where, Array.from(joined).sort()]).toEqual([
      where,
      Array.from(expected).sort(),
    ]);
  }

  // The arrows between tables: exactly those a drawing read whole draws.
  const expectedFeeds: Array<string> = [];

  for (const pair of truth.pairs) {
    const [upstream, downstream] = pair.split(">") as [string, string];
    const from: DataTableLineageNode | undefined = drawn.get(upstream);
    const to: DataTableLineageNode | undefined = drawn.get(downstream);

    if (
      from &&
      to &&
      !(
        from.side === DataLineageSide.Upstream &&
        to.side === DataLineageSide.Downstream
      )
    ) {
      expectedFeeds.push(
        getLineageEdgeId({
          kind: DataLineageEdgeKind.Feeds,
          source: from.id,
          target: to.id,
        }),
      );
    }
  }

  const feedsDrawn: Array<DataTableLineageEdge> = lineage.edges.filter(
    (edge: DataTableLineageEdge): boolean => {
      return edge.kind === DataLineageEdgeKind.Feeds;
    },
  );

  expect([
    where,
    feedsDrawn
      .map((edge: DataTableLineageEdge): string => {
        return edge.id;
      })
      .sort(),
  ]).toEqual([where, expectedFeeds.sort()]);

  // Each carries every source's columns, asked for; none, not.
  for (const edge of feedsDrawn) {
    const key: string = `${edge.source.slice("table:".length)}>${edge.target.slice("table:".length)}`;

    expect([where, edge.id, edge.columnMappings]).toEqual([
      where,
      edge.id,
      data.withColumns ? truth.columnsOf.get(key) : undefined,
    ]);
  }

  // The dashboards: every one built on a table drawn that is not upstream, drawn or counted.
  const readable: Set<string> = new Set(
    Array.from(drawn.values())
      .filter((node: DataTableLineageNode): boolean => {
        return node.side !== DataLineageSide.Upstream;
      })
      .map((node: DataTableLineageNode): string => {
        return node.dataAssetId!;
      }),
  );
  const builtOn: Array<{ id: string; reads: Array<string> }> = graph.dashboards
    .map(
      (dashboard: { dataDashboardId: string; dataAssetIds: Array<string> }) => {
        return {
          id: dashboard.dataDashboardId,
          reads: dashboard.dataAssetIds.filter((id: string): boolean => {
            return readable.has(id);
          }),
        };
      },
    )
    .filter((dashboard: { id: string; reads: Array<string> }): boolean => {
      return dashboard.reads.length > 0;
    });
  const cards: Array<DataTableLineageNode> = lineage.nodes.filter(
    (node: DataTableLineageNode): boolean => {
      return node.kind === DataLineageNodeKind.Dashboard;
    },
  );

  expect([where, cards.length + lineage.hiddenDashboardCount]).toEqual([
    where,
    builtOn.length,
  ]);

  const expectedReads: Array<string> = [];

  for (const card of cards) {
    const dashboard: { id: string; reads: Array<string> } | undefined =
      builtOn.find((candidate: { id: string }): boolean => {
        return candidate.id === card.dataDashboardId;
      });

    expect([where, card.id, Boolean(dashboard)]).toEqual([
      where,
      card.id,
      true,
    ]);
    expect([where, card.id, card.side]).toEqual([
      where,
      card.id,
      DataLineageSide.Downstream,
    ]);

    for (const id of new Set(dashboard!.reads)) {
      expectedReads.push(
        getLineageEdgeId({
          kind: DataLineageEdgeKind.Reads,
          source: getLineageTableNodeId(id),
          target: getLineageDashboardNodeId(card.dataDashboardId!),
        }),
      );
    }
  }

  expect([
    where,
    lineage.edges
      .filter((edge: DataTableLineageEdge): boolean => {
        return byId.get(edge.target)?.kind === DataLineageNodeKind.Dashboard;
      })
      .map((edge: DataTableLineageEdge): string => {
        return edge.id;
      })
      .sort(),
  ]).toEqual([where, expectedReads.sort()]);

  // A pipeline loading a table from outside: a writes row of its own.
  for (const edge of lineage.edges) {
    if (
      edge.kind === DataLineageEdgeKind.Writes &&
      edge.source !== lineage.focusNodeId
    ) {
      const pipelineId: string = edge.source.slice("pipeline:".length);
      const tableId: string = edge.target.slice("table:".length);

      expect([
        where,
        edge.id,
        graph.edges.some(
          (row: {
            upstreamDataAssetId: string | null;
            downstreamDataAssetId: string;
            dataPipelineId: string | null;
          }): boolean => {
            return (
              row.upstreamDataAssetId === null &&
              row.downstreamDataAssetId === tableId &&
              row.dataPipelineId === pipelineId
            );
          },
        ),
      ]).toEqual([where, edge.id, true]);
    }
  }
}

// Every count on the drawing that can be pressed.
function pressable(
  lineage: DataTableLineage,
): Array<{ node: DataTableLineageNode; side: DataLineageSide }> {
  const found: Array<{ node: DataTableLineageNode; side: DataLineageSide }> =
    [];

  for (const node of lineage.nodes) {
    for (const side of [DataLineageSide.Upstream, DataLineageSide.Downstream]) {
      if (canExpandLineageCard(lineage, node, side)) {
        found.push({ node, side });
      }
    }
  }

  return found;
}

/*
 * Presses counts, one at a time, until none can be pressed, checking the
 * drawing after each: the request as the Dashboard sends it, read as the
 * route reads it, answered as the server answers it, added as the
 * Dashboard adds it.
 */
async function pressUntilDone(data: {
  graph: MemoryGraph;
  truth: Truth;
  lineage: DataTableLineage;
  withColumns: boolean;
  random: SeededRandom;
  where: string;
  // The drawing's own card pressed only once no other can be: what it counts is drawn through others first.
  focusLast?: boolean | undefined;
}): Promise<DataTableLineage> {
  let lineage: DataTableLineage = data.lineage;

  for (let press: number = 0; press < 400; press++) {
    const all: Array<{ node: DataTableLineageNode; side: DataLineageSide }> =
      pressable(lineage);
    const focusNodeId: string = lineage.focusNodeId;
    const others: Array<{
      node: DataTableLineageNode;
      side: DataLineageSide;
    }> = all.filter((choice: { node: DataTableLineageNode }): boolean => {
      return choice.node.id !== focusNodeId;
    });
    const choices: Array<{
      node: DataTableLineageNode;
      side: DataLineageSide;
    }> = data.focusLast && others.length > 0 ? others : all;

    if (choices.length === 0) {
      return lineage;
    }

    const where: string = `${data.where}, press ${press}`;
    const chosen: { node: DataTableLineageNode; side: DataLineageSide } =
      choices[data.random(choices.length)]!;
    const request: DataLineageExpandRequest = getLineageExpandRequest({
      lineage,
      nodeId: chosen.node.id,
      side: chosen.side,
      withColumns: data.withColumns,
    });
    // Over the wire and through the route's reading, unchanged.
    const read: DataLineageExpandRequest | string =
      readDataLineageExpandRequest(JSON.parse(JSON.stringify(request)));

    expect([where, read]).toEqual([
      where,
      { ...request, withColumns: data.withColumns },
    ]);

    const expansion: DataLineageExpansion | null =
      await DataTableLineageReader.buildExpansion({
        request: read as DataLineageExpandRequest,
        now: NOW,
        reader: memoryReader(data.graph),
      });

    expect([where, expansion === null]).toEqual([where, false]);

    const before: Map<string, DataTableLineageNode> = tablesDrawn(lineage);
    const merged: DataTableLineage = mergeLineageExpansion(lineage, expansion!);
    const after: Map<string, DataTableLineageNode> = tablesDrawn(merged);

    // At least one table drawn, nowhere a table already was; nothing drawn moves.
    expect([where, after.size > before.size]).toEqual([where, true]);

    for (const node of expansion!.nodes) {
      if (node.kind === DataLineageNodeKind.Table) {
        expect([where, before.has(node.dataAssetId!)]).toEqual([where, false]);
      }
    }

    for (const node of lineage.nodes) {
      const kept: DataTableLineageNode | undefined = merged.nodes.find(
        (candidate: DataTableLineageNode): boolean => {
          return candidate.id === node.id;
        },
      );

      expect([where, kept?.side, kept?.depth]).toEqual([
        where,
        node.side,
        node.depth,
      ]);
    }

    // The same answer added again changes nothing.
    expect(mergeLineageExpansion(merged, expansion!)).toEqual(merged);

    expectTrue({
      graph: data.graph,
      truth: data.truth,
      lineage: merged,
      withColumns: data.withColumns,
      where,
    });

    lineage = merged;
  }

  throw new Error(`${data.where}: still pressing after 400 presses.`);
}

function anyTables(
  graph: MemoryGraph,
  random: SeededRandom,
  count: number,
): void {
  for (let index: number = 0; index < count; index++) {
    if (random() < 0.15) {
      lateTable(graph, t(index));
    } else {
      table(graph, t(index), { isDropped: random() < 0.05 });
    }

    if (random() < 0.1) {
      graph.openAlerts.set(t(index), 1 + random(3));
    }
  }

  for (let index: number = 1; index <= 3; index++) {
    pipeline(graph, p(index), {
      lastRunState: random() < 0.25 ? "FAIL" : "COMPLETE",
    });
  }
}

/*
 * Arrows between the tables - from a lower number to a higher one when
 * the graph goes round no circle - with a crowded table among them, some
 * columns named, arrows left behind to tables gone, pipelines loading
 * tables from outside, and dashboards.
 */
function anyArrows(data: {
  graph: MemoryGraph;
  random: SeededRandom;
  count: number;
  isCircleFree: boolean;
  crowded: number;
  // How many arrows the crowded table has, and the share of them into it.
  crowdedArrows: number;
  upstreamShare: number;
}): void {
  const { graph, random, count } = data;
  const arrow: (a: number, b: number) => void = (a: number, b: number) => {
    if (a === b) {
      return;
    }

    const from: number = data.isCircleFree ? Math.min(a, b) : a;
    const to: number = data.isCircleFree ? Math.max(a, b) : b;

    feeds(graph, t(from), t(to), {
      dataPipelineId: random() < 0.3 ? p(1 + random(3)) : null,
      lastSeenAt: new Date(NOW.getTime() - random(200) * HOUR),
    });

    if (random() < 0.3) {
      columns(graph, t(from), t(to), [
        [`c${random(4)}`, `c${random(4)}`],
        [`k${random(3)}`, `k${random(3)}`],
      ]);
    }
  };

  for (let index: number = 0; index < count * (1 + random(3)); index++) {
    arrow(random(count), random(count));
  }

  const neighbours: Array<number> = [];
  // Round no circle, a table upstream of it has a lower number, one downstream a higher.
  const below: number = data.crowded;
  const above: number = count - data.crowded - 1;

  for (let index: number = 0; index < data.crowdedArrows; index++) {
    const isUpstream: boolean = random() < data.upstreamShare;

    if (data.isCircleFree && (isUpstream ? below : above) === 0) {
      continue;
    }

    const other: number = !data.isCircleFree
      ? random(count)
      : isUpstream
        ? random(below)
        : data.crowded + 1 + random(above);

    neighbours.push(other);

    if (isUpstream) {
      arrow(other, data.crowded);
    } else {
      arrow(data.crowded, other);
    }
  }

  // Its neighbours feed one another: drawing one's draws others it counts.
  for (let index: number = 0; index < neighbours.length; index++) {
    arrow(
      neighbours[random(neighbours.length)]!,
      neighbours[random(neighbours.length)]!,
    );
  }

  for (let index: number = 0; index < random(3); index++) {
    const gone: string = uuid(9, index);

    if (random() < 0.5) {
      feeds(graph, gone, t(random(count)));
    } else {
      feeds(graph, t(random(count)), gone);
    }
  }

  for (let index: number = 0; index < random(4); index++) {
    writes(graph, p(1 + random(3)), t(random(count)));
  }

  for (let index: number = 0; index < random(7); index++) {
    const reads: Set<string> = new Set();

    for (let read: number = 0; read < 1 + random(3); read++) {
      reads.add(t(random(count)));
    }

    graph.dashboards.push({
      dataDashboardId: d(index),
      name: `Board ${index}`,
      tool: "Metabase",
      url: null,
      dataAssetIds: Array.from(reads),
    });
  }
}

// Everything upstream and downstream of a table, through the tables the project has.
function reachable(start: string, next: Map<string, Set<string>>): Set<string> {
  const found: Set<string> = new Set();
  const queue: Array<string> = [start];

  while (queue.length > 0) {
    const id: string = queue.shift()!;

    for (const other of next.get(id) || []) {
      if (!found.has(other) && other !== start) {
        found.add(other);
        queue.push(other);
      }
    }
  }

  return found;
}

describe("a table's drawing, drawn more card by card", () => {
  test("keeps every promise of a drawing read whole, press after press, until nothing is left to draw", async () => {
    const random: SeededRandom = seededRandom(6667);

    for (let round: number = 0; round < 60; round++) {
      const graph: MemoryGraph = newGraph();
      const count: number = 8 + random(38);
      // Toward the middle: tables on both sides of it.
      const crowded: number =
        Math.floor(count / 4) + random(Math.ceil(count / 2));
      const isCircleFree: boolean = random() < 0.7;

      anyTables(graph, random, count);
      anyArrows({
        graph,
        random,
        count,
        isCircleFree,
        crowded,
        crowdedArrows: 14 + random(16),
        upstreamShare: 0.5,
      });

      const focus: string = random() < 0.5 ? t(crowded) : t(random(count));
      const withColumns: boolean = random() < 0.5;
      const where: string = `seed 6667, round ${round}`;
      const lineage: DataTableLineage | null =
        await DataTableLineageReader.build({
          focusDataAssetId: focus,
          // A step only, half the time: more of every count left to press.
          depth: random() < 0.5 ? 1 : 2 + random(2),
          now: NOW,
          reader: memoryReader(graph),
          withColumns,
        });

      expect(lineage).not.toBeNull();

      const truth: Truth = truthOf(graph, null);

      expectTrue({ graph, truth, lineage: lineage!, withColumns, where });

      const done: DataTableLineage = await pressUntilDone({
        graph,
        truth,
        lineage: lineage!,
        withColumns,
        random,
        where,
      });

      // Nothing left to draw: every count none.
      for (const node of done.nodes) {
        expect([where, node.id, node.hiddenUpstreamCount || 0]).toEqual([
          where,
          node.id,
          0,
        ]);
        expect([where, node.id, node.hiddenDownstreamCount || 0]).toEqual([
          where,
          node.id,
          0,
        ]);
      }

      // Round no circle, that is everything upstream and downstream of the table.
      if (isCircleFree) {
        const everything: Set<string> = new Set([
          focus,
          ...reachable(focus, truth.upstreamOf),
          ...reachable(focus, truth.downstreamOf),
        ]);

        expect([where, Array.from(tablesDrawn(done).keys()).sort()]).toEqual([
          where,
          Array.from(everything).sort(),
        ]);
      }
    }
  });
});

describe("a crowded table's drawing, a step each way, drawn more card by card", () => {
  /*
   * The table has far more tables than its card draws on one side, and
   * they feed one another: pressing one of them draws tables the table
   * itself counts, so its count must fall as they are drawn.
   */
  test("its own count falls as the tables it counts are drawn through others", async () => {
    const random: SeededRandom = seededRandom(1665);
    let fell: number = 0;

    for (let round: number = 0; round < 40; round++) {
      const graph: MemoryGraph = newGraph();
      const count: number = 30 + random(20);
      const crowded: number =
        Math.floor(count / 3) + random(Math.ceil(count / 3));
      const isUpstream: boolean = random() < 0.5;

      anyTables(graph, random, count);
      anyArrows({
        graph,
        random,
        count,
        isCircleFree: random() < 0.7,
        crowded,
        crowdedArrows: 30 + random(20),
        upstreamShare: isUpstream ? 0.85 : 0.15,
      });

      const where: string = `seed 1665, round ${round}`;
      const withColumns: boolean = random() < 0.5;
      const lineage: DataTableLineage | null =
        await DataTableLineageReader.build({
          focusDataAssetId: t(crowded),
          depth: 1,
          now: NOW,
          reader: memoryReader(graph),
          withColumns,
        });

      expect(lineage).not.toBeNull();

      const truth: Truth = truthOf(graph, null);

      expectTrue({ graph, truth, lineage: lineage!, withColumns, where });

      // Press the cards beside it first, never the table itself, while any can be.
      let drawing: DataTableLineage = lineage!;
      const focusNodeId: string = drawing.focusNodeId;

      for (let press: number = 0; press < 400; press++) {
        const others: Array<{
          node: DataTableLineageNode;
          side: DataLineageSide;
        }> = pressable(drawing).filter(
          (choice: { node: DataTableLineageNode }): boolean => {
            return choice.node.id !== focusNodeId;
          },
        );

        if (others.length === 0) {
          break;
        }

        const chosen: { node: DataTableLineageNode; side: DataLineageSide } =
          others[random(others.length)]!;
        const focusBefore: DataTableLineageNode = drawing.nodes.find(
          (node: DataTableLineageNode): boolean => {
            return node.id === focusNodeId;
          },
        )!;
        const expansion: DataLineageExpansion | null =
          await DataTableLineageReader.buildExpansion({
            request: getLineageExpandRequest({
              lineage: drawing,
              nodeId: chosen.node.id,
              side: chosen.side,
              withColumns,
            }),
            now: NOW,
            reader: memoryReader(graph),
          });

        drawing = mergeLineageExpansion(drawing, expansion!);

        const focusAfter: DataTableLineageNode = drawing.nodes.find(
          (node: DataTableLineageNode): boolean => {
            return node.id === focusNodeId;
          },
        )!;

        if (
          (focusAfter.hiddenUpstreamCount || 0) <
            (focusBefore.hiddenUpstreamCount || 0) ||
          (focusAfter.hiddenDownstreamCount || 0) <
            (focusBefore.hiddenDownstreamCount || 0)
        ) {
          fell++;
        }

        expectTrue({
          graph,
          truth,
          lineage: drawing,
          withColumns,
          where: `${where}, press ${press}`,
        });
      }

      // Then everything else, the table's own count among them.
      await pressUntilDone({
        graph,
        truth,
        lineage: drawing,
        withColumns,
        random,
        where: `${where}, the rest`,
      });
    }

    // The case this is for came up, again and again.
    expect(fell).toBeGreaterThan(10);
  });
});

describe("a pipeline's drawing, drawn more card by card", () => {
  test("keeps every promise of a drawing read whole, its own card's counts too, press after press", async () => {
    const random: SeededRandom = seededRandom(6668);

    for (let round: number = 0; round < 40; round++) {
      const graph: MemoryGraph = newGraph();
      const count: number = 8 + random(38);
      const focusPipeline: string = p(0);

      anyTables(graph, random, count);
      anyArrows({
        graph,
        random,
        count,
        isCircleFree: random() < 0.7,
        crowded: random(count),
        crowdedArrows: 14 + random(16),
        upstreamShare: 0.5,
      });
      pipeline(graph, focusPipeline, {
        jobName: "orders_etl",
        lastRunState: random() < 0.3 ? "FAIL" : "COMPLETE",
      });

      // Its runs: some read many tables, so its card counts what it does not draw.
      for (let run: number = 0; run < 1 + random(5); run++) {
        const reads: Array<string> = [];
        const written: Array<string> = [];

        for (let index: number = 0; index < 1 + random(14); index++) {
          reads.push(t(random(count)));
        }

        // Some of what it reads is built from more of what it reads.
        for (let index: number = 0; index < random(reads.length); index++) {
          const a: number = random(reads.length);
          const b: number = random(reads.length);

          if (reads[a] !== reads[b]) {
            feeds(graph, reads[a]!, reads[b]!);
          }
        }

        for (let index: number = 0; index < 1 + random(6); index++) {
          written.push(t(random(count)));
        }

        runs(graph, focusPipeline, {
          reads,
          writes: written,
          lastSeenAt: new Date(NOW.getTime() - random(100) * HOUR),
        });
      }

      const where: string = `seed 6668, round ${round}`;
      const lineage: DataTableLineage | null =
        await DataTableLineageReader.buildForPipeline({
          focusDataPipelineId: focusPipeline,
          depth: 1 + random(2),
          now: NOW,
          reader: memoryReader(graph),
        });

      expect(lineage).not.toBeNull();
      expect(lineage!.focusNodeId).toBe(
        getLineagePipelineNodeId(focusPipeline),
      );

      const truth: Truth = truthOf(graph, focusPipeline);

      // A pipeline's page draws no columns.
      expectTrue({
        graph,
        truth,
        lineage: lineage!,
        withColumns: false,
        where,
      });

      const done: DataTableLineage = await pressUntilDone({
        graph,
        truth,
        lineage: lineage!,
        withColumns: false,
        random,
        where,
        focusLast: round % 2 === 0,
      });

      for (const node of done.nodes) {
        expect([
          where,
          node.id,
          node.hiddenUpstreamCount || 0,
          node.hiddenDownstreamCount || 0,
        ]).toEqual([where, node.id, 0, 0]);
      }

      // Every table it reads and writes is drawn, and joined to it.
      for (const id of [...truth.pipelineReads, ...truth.pipelineWrites]) {
        expect([where, tablesDrawn(done).has(id)]).toEqual([where, true]);
      }
    }
  });
});
