import { describe, expect, test } from "@jest/globals";
import ToolResultSerializer, {
  MAX_PAYLOAD_BYTES,
  SerializedResult,
} from "../../../../Server/Utils/AI/Toolbox/Serializer";
import {
  DATA_LINEAGE_ANSWER_LIMITS,
  DATA_LINEAGE_ANSWER_LIMITS_FOR_INVESTIGATION,
  DATA_LINEAGE_ANSWER_LIMITS_FOR_SEVERAL,
  DataLineageAnswerLimits,
  DataLineageAnswerTable,
  DataTableLineageAnswer,
  MAX_DATA_LINEAGE_ANSWER_ERROR_LENGTH,
  MAX_DATA_LINEAGE_ANSWER_FAILURES_TOLD,
  MAX_DATA_LINEAGE_ANSWER_TABLES_NAMED,
  buildDataTableLineageAnswer,
  describeDataAlertLineage,
  formatDataTableLineageReply,
} from "../../../../Server/Utils/DataObservability/DataTableLineageAnswer";
import { DataAssetFreshness } from "../../../../Types/DataObservability/DataAssetFreshness";
import {
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  MAX_DATA_LINEAGE_DASHBOARDS,
  MAX_DATA_LINEAGE_ERROR_LENGTH,
  MAX_DATA_LINEAGE_PIPELINES_PER_TABLE,
  MAX_DATA_LINEAGE_TABLES_PER_SIDE,
  getLineageDashboardNodeId,
  getLineageEdgeId,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../../Types/DataObservability/DataTableLineage";
import { NOW, d, p, t } from "./LineageMemoryGraph";

/*
 * ONE ANSWER STAYS ONE ANSWER, HOWEVER LARGE THE LINEAGE.
 *
 * The lineage an answer tells is one drawing (DataTableLineage), and a
 * drawing has limits of its own: 120 tables a side, five pipelines loading
 * a table, 25 dashboards. A warehouse can fill every one of them at once -
 * every table late, every pipeline failed with the longest error a card
 * carries, a sync loading a whole schema, dashboards reading dozens of
 * tables. The answer still tells each list's first few and counts the rest
 * (DataLineageAnswerLimits, MAX_DATA_LINEAGE_ANSWER_TABLES_NAMED,
 * MAX_DATA_LINEAGE_ANSWER_FAILURES_TOLD), so it stays a few pages for the
 * model: well inside what one tool result holds (MAX_PAYLOAD_BYTES) for
 * one table, and for the five tables one name answers with at most - so
 * no answer is ever cut off in the middle.
 */

// Long for a schema.table key: most are a third of it.
const NAME_LENGTH: number = 60;

// Thirty pipelines load the upstream tables, five each: a few syncs loading whole schemas.
const LOADERS: number = 30;

// Each dashboard reads this many of the tables built from the table.
const TABLES_PER_DASHBOARD: number = 40;

// The longest error a pipeline's card carries, in words: a run of hex would read as a secret and be hidden.
const LONGEST_ERROR: string =
  "Sync failed: the source could not be read because the server closed the connection while the rows were copied. "
    .repeat(10)
    .slice(0, MAX_DATA_LINEAGE_ERROR_LENGTH);

function longName(prefix: string, index: number): string {
  const base: string = `${prefix}.table_${index}_`;

  return `${base}${"x".repeat(Math.max(0, NAME_LENGTH - base.length))}`;
}

function edge(
  kind: DataLineageEdgeKind,
  source: string,
  target: string,
  pipelines: DataTableLineageEdge["pipelines"] = [],
): DataTableLineageEdge {
  return {
    id: getLineageEdgeId({ kind, source, target }),
    source,
    target,
    kind,
    seenIn: [],
    pipelines,
    lastSeenAt: null,
  };
}

/*
 * A drawing at every limit: 120 tables each side, all late with open
 * alerts, three failed pipelines on every arrow, five failed loaders on
 * every upstream table, each with the longest error a card carries, and
 * 25 dashboards reading 40 tables each - with more past every limit.
 */
function drawingAtEveryLimit(): DataTableLineage {
  const focus: string = getLineageTableNodeId(t(0));
  const nodes: Array<DataTableLineageNode> = [
    {
      id: focus,
      kind: DataLineageNodeKind.Table,
      side: DataLineageSide.Focus,
      depth: 0,
      name: longName("focus", 0),
      dataAssetId: t(0),
      database: "Warehouse",
      freshness: DataAssetFreshness.Late,
      lateBySeconds: 3600,
      isDropped: false,
      openAlertCount: 3,
      hiddenUpstreamCount: 0,
      hiddenDownstreamCount: 0,
    },
  ];
  const edges: Array<DataTableLineageEdge> = [];
  const failedBuilders: DataTableLineageEdge["pipelines"] = [1, 2, 3].map(
    (index: number) => {
      return {
        dataPipelineId: p(900 + index),
        name: longName("dbt", index),
        lastRunState: "FAIL",
      };
    },
  );

  for (let index: number = 1; index <= LOADERS; index++) {
    nodes.push({
      id: getLineagePipelineNodeId(p(index)),
      kind: DataLineageNodeKind.Pipeline,
      side: DataLineageSide.Upstream,
      depth: -4,
      name: longName("sync", index),
      dataPipelineId: p(index),
      lastRunState: "FAIL",
      lastRunStartedAt: NOW.toISOString(),
      lastErrorMessage: LONGEST_ERROR,
    });
  }

  for (const side of [DataLineageSide.Upstream, DataLineageSide.Downstream]) {
    const isUpstream: boolean = side === DataLineageSide.Upstream;

    for (
      let index: number = 1;
      index <= MAX_DATA_LINEAGE_TABLES_PER_SIDE;
      index++
    ) {
      const tableIndex: number = (isUpstream ? 0 : 1000) + index;
      const id: string = getLineageTableNodeId(t(tableIndex));

      nodes.push({
        id,
        kind: DataLineageNodeKind.Table,
        side,
        depth: isUpstream ? -1 : 1,
        name: longName(isUpstream ? "raw" : "marts", index),
        dataAssetId: t(tableIndex),
        // Another database's, so each is named with it.
        database: `Database ${index % 7}`,
        freshness: DataAssetFreshness.Late,
        lateBySeconds: 30 * 3600,
        isDropped: false,
        openAlertCount: 4,
        hiddenUpstreamCount: 10,
        hiddenDownstreamCount: 10,
      });
      edges.push(
        isUpstream
          ? edge(DataLineageEdgeKind.Feeds, id, focus, failedBuilders)
          : edge(DataLineageEdgeKind.Feeds, focus, id, failedBuilders),
      );

      if (isUpstream) {
        for (
          let writer: number = 0;
          writer < MAX_DATA_LINEAGE_PIPELINES_PER_TABLE;
          writer++
        ) {
          const loader: number =
            ((index * MAX_DATA_LINEAGE_PIPELINES_PER_TABLE + writer) %
              LOADERS) +
            1;

          edges.push(
            edge(
              DataLineageEdgeKind.Writes,
              getLineagePipelineNodeId(p(loader)),
              id,
            ),
          );
        }
      }
    }
  }

  for (let index: number = 1; index <= MAX_DATA_LINEAGE_DASHBOARDS; index++) {
    const id: string = getLineageDashboardNodeId(d(index));

    nodes.push({
      id,
      kind: DataLineageNodeKind.Dashboard,
      side: DataLineageSide.Downstream,
      depth: 2,
      name: longName("dashboard", index),
      dataDashboardId: d(index),
      tool: "Looker",
      url: null,
    });

    for (let read: number = 1; read <= TABLES_PER_DASHBOARD; read++) {
      edges.push(
        edge(
          DataLineageEdgeKind.Reads,
          getLineageTableNodeId(t(1000 + read)),
          id,
        ),
      );
    }
  }

  return {
    focusNodeId: focus,
    depth: 3,
    nodes,
    edges,
    hiddenDashboardCount: 30,
    isTruncated: true,
  };
}

function bytesOf(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function answerAt(limits: DataLineageAnswerLimits): DataTableLineageAnswer {
  return buildDataTableLineageAnswer(drawingAtEveryLimit(), limits);
}

function everyTableTold(
  answer: DataTableLineageAnswer,
): Array<DataLineageAnswerTable> {
  return [
    ...answer.upstream.problems,
    ...answer.upstream.others,
    ...answer.downstream.problems,
    ...answer.downstream.others,
  ];
}

describe("an answer at every limit a drawing has", () => {
  test("tells each list's first few and counts the rest", () => {
    const answer: DataTableLineageAnswer = answerAt(DATA_LINEAGE_ANSWER_LIMITS);

    for (const side of [answer.upstream, answer.downstream]) {
      expect(side.tableCount).toBe(MAX_DATA_LINEAGE_TABLES_PER_SIDE);
      expect(side.problems).toHaveLength(DATA_LINEAGE_ANSWER_LIMITS.problems);
      expect(side.untoldProblemCount).toBe(
        MAX_DATA_LINEAGE_TABLES_PER_SIDE - DATA_LINEAGE_ANSWER_LIMITS.problems,
      );
      expect(side.others).toEqual([]);
    }

    expect(answer.loaders).toHaveLength(DATA_LINEAGE_ANSWER_LIMITS.loaders);
    expect(answer.untoldLoaderCount).toBe(
      LOADERS - DATA_LINEAGE_ANSWER_LIMITS.loaders,
    );
    expect(answer.dashboards).toHaveLength(
      DATA_LINEAGE_ANSWER_LIMITS.dashboards,
    );
    expect(answer.untoldDashboardCount).toBe(
      MAX_DATA_LINEAGE_DASHBOARDS - DATA_LINEAGE_ANSWER_LIMITS.dashboards + 30,
    );
  });

  test("names at most five tables a loader loads, or a dashboard reads, and counts the rest", () => {
    const answer: DataTableLineageAnswer = answerAt(DATA_LINEAGE_ANSWER_LIMITS);

    for (const loader of answer.loaders) {
      expect(loader.tables).toHaveLength(MAX_DATA_LINEAGE_ANSWER_TABLES_NAMED);
      expect(loader.untoldTableCount).toBe(
        (MAX_DATA_LINEAGE_TABLES_PER_SIDE *
          MAX_DATA_LINEAGE_PIPELINES_PER_TABLE) /
          LOADERS -
          MAX_DATA_LINEAGE_ANSWER_TABLES_NAMED,
      );
    }

    for (const dashboard of answer.dashboards) {
      expect(dashboard.tables).toHaveLength(
        MAX_DATA_LINEAGE_ANSWER_TABLES_NAMED,
      );
      expect(dashboard.untoldTableCount).toBe(
        TABLES_PER_DASHBOARD - MAX_DATA_LINEAGE_ANSWER_TABLES_NAMED,
      );
    }
  });

  test("tells at most two failed pipelines of a table, with their errors clipped, and counts the rest", () => {
    const answer: DataTableLineageAnswer = answerAt(DATA_LINEAGE_ANSWER_LIMITS);

    for (const table of everyTableTold(answer)) {
      expect(
        table.failedPipelines.length + table.failedLoaders.length,
      ).toBeLessThanOrEqual(MAX_DATA_LINEAGE_ANSWER_FAILURES_TOLD);

      for (const loader of table.failedLoaders) {
        expect(loader.lastErrorMessage!.length).toBeLessThanOrEqual(
          MAX_DATA_LINEAGE_ANSWER_ERROR_LENGTH,
        );
      }
    }

    // The table itself: three pipelines build it, two told.
    expect(answer.self!.failedPipelines).toHaveLength(2);
    expect(answer.self!.untoldFailureCount).toBe(1);

    // Upstream: five pipelines load each table, two told with their errors.
    const upstream: DataLineageAnswerTable = answer.upstream.problems[0]!;

    expect(upstream.failedPipelines).toEqual([]);
    expect(upstream.failedLoaders).toHaveLength(2);
    expect(upstream.untoldFailureCount).toBe(
      MAX_DATA_LINEAGE_PIPELINES_PER_TABLE - 2,
    );
    expect(upstream.failedLoaders[0]!.lastErrorMessage).toBe(
      `${LONGEST_ERROR.slice(0, MAX_DATA_LINEAGE_ANSWER_ERROR_LENGTH - 1)}…`,
    );

    // Downstream: three pipelines build each table, two told.
    const downstream: DataLineageAnswerTable = answer.downstream.problems[0]!;

    expect(downstream.failedPipelines).toHaveLength(2);
    expect(downstream.failedLoaders).toEqual([]);
    expect(downstream.untoldFailureCount).toBe(1);
  });

  test("one table's answer stays a few pages, well inside one tool result", () => {
    const reply: string = formatDataTableLineageReply({
      reference: "orders",
      answers: [answerAt(DATA_LINEAGE_ANSWER_LIMITS)],
      now: NOW,
    });

    expect(bytesOf(reply)).toBeLessThan(32 * 1024);
  });

  test("the five tables a name answers with at most stay one tool result, never cut off", () => {
    const answer: DataTableLineageAnswer = answerAt(
      DATA_LINEAGE_ANSWER_LIMITS_FOR_SEVERAL,
    );
    const reply: string = formatDataTableLineageReply({
      reference: "orders",
      answers: [answer, answer, answer, answer, answer],
      now: NOW,
    });
    const serialized: SerializedResult = ToolResultSerializer.serializeText(
      reply,
      5,
    );

    expect(bytesOf(reply)).toBeLessThan(MAX_PAYLOAD_BYTES);
    expect(serialized.isTruncated).toBe(false);
    expect(serialized.redactionCount).toBe(0);
    expect(serialized.text).toBe(reply);
  });

  test("an investigation's context tells less of it still", () => {
    const lines: Array<string> = describeDataAlertLineage(
      {
        lineage: drawingAtEveryLimit(),
        hasCause: false,
        isCauseDrawn: false,
        consequenceCount: 0,
        drawnConsequenceCount: 0,
        column: null,
      },
      NOW,
    );
    const answer: DataTableLineageAnswer = answerAt(
      DATA_LINEAGE_ANSWER_LIMITS_FOR_INVESTIGATION,
    );

    expect(answer.loaders).toHaveLength(
      DATA_LINEAGE_ANSWER_LIMITS_FOR_INVESTIGATION.loaders,
    );
    expect(bytesOf(lines.join("\n"))).toBeLessThan(24 * 1024);
    expect(lines.join("\n")).toContain(
      `and ${LOADERS - DATA_LINEAGE_ANSWER_LIMITS_FOR_INVESTIGATION.loaders} more.`,
    );
  });
});
