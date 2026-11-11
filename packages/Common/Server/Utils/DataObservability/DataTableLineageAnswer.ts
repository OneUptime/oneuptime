import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { DataAssetFreshness } from "../../../Types/DataObservability/DataAssetFreshness";
import {
  DataAlertLineageAnswer,
  DataLineageEdgeKind,
  DataLineageNodeKind,
  DataLineageSide,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  DataTableLineagePipeline,
  MAX_DATA_LINEAGE_DEPTH,
  MAX_DATA_LINEAGE_NEIGHBORS,
  isFailedLineageRunState,
  isLineagePipelineNodeId,
  isRunningLineageRunState,
} from "../../../Types/DataObservability/DataTableLineage";
import ObjectID from "../../../Types/ObjectID";
import DataTableAnswerer, { describeDuration } from "./DataTableAnswer";
import DataTableLineageReader from "./DataTableLineage";

/*
 * "WHAT IS THIS TABLE BUILT FROM, AND WHAT IS BUILT FROM IT?" - ONE ANSWER,
 * FOR AN AI AGENT, SLACK AND MICROSOFT TEAMS, AND AN INVESTIGATION.
 *
 * A table's Lineage tab draws its lineage (DataTableLineage): the tables it
 * is built from and the tables built from it, several steps each way, each
 * with how it is now. Asked in a sentence - "what feeds the revenue table?",
 * "why is orders late, is something upstream broken?", "what breaks if
 * raw.orders stops loading?" - the answer is that drawing told in words,
 * problems first:
 *
 *  - each table upstream and downstream that was dropped, is late, has open
 *    alerts, or whose pipeline failed its last run, nearest first, with how
 *    many steps away it is and the tables between;
 *  - the rest of the tables, nearest first, each with how it is now;
 *  - the pipelines that load the upstream tables from outside what
 *    OneUptime watches (a Fivetran sync, an export from an API), with how
 *    their latest run went;
 *  - the BI dashboards built on the table and on the tables built from it:
 *    who sees bad data first;
 *  - how much lies past what is told, and how to see it.
 *
 * Each list keeps its first few (DataLineageAnswerLimits) and counts the
 * rest, so one answer stays one answer. A table is found as "is this table
 * fresh?" finds it (DataTableAnswerer.findTables): schema.table, its name
 * alone, or its ID; a name several databases share answers with each.
 *
 * WHO READS THE ANSWER decides which alerts it counts, as the drawing does
 * (DataTableLineageReader): a person who asked - in Ask AI, an
 * investigation's thread, Slack, Microsoft Teams or the MCP server - the
 * open alerts they may see; nobody in particular, or a run of OneUptime's
 * own read as root, only the alerts that are not private. No alert is
 * named here, only counted: the table's own answer (DataTableAnswer) names
 * the ones its reader may see.
 *
 * An investigation of a data alert reads the same answer around the
 * alert's table or pipeline (DataAlertContext), with where in the chain
 * the alert it is a consequence of is, and which tables the alerts it
 * caused are on (describeDataAlertLineage).
 */

export interface DataLineageAnswerLimits {
  // The tables with a problem told on each side: the rest are counted.
  problems: number;
  // The other tables told on each side.
  others: number;
  // The pipelines told loading the upstream tables from outside.
  loaders: number;
  dashboards: number;
}

// The answer about one table.
export const DATA_LINEAGE_ANSWER_LIMITS: DataLineageAnswerLimits = {
  problems: 10,
  others: 15,
  loaders: 10,
  dashboards: 10,
};

// Each answer when a name matches several tables: shorter, so all of them stay one answer.
export const DATA_LINEAGE_ANSWER_LIMITS_FOR_SEVERAL: DataLineageAnswerLimits = {
  problems: 5,
  others: 5,
  loaders: 5,
  dashboards: 5,
};

// The longest pipeline error told: the pipeline's page has all of it.
export const MAX_DATA_LINEAGE_ANSWER_ERROR_LENGTH: number = 200;

// A pipeline that loads tables from outside what OneUptime watches.
export interface DataLineageAnswerLoader {
  dataPipelineId: string;
  name: string;
  // OpenLineage's: COMPLETE, FAIL, ABORT, START, RUNNING, RESCHEDULED; null before any run.
  lastRunState: string | null;
  // ISO time.
  lastRunStartedAt: string | null;
  lastErrorMessage: string | null;
  // The tables it loads, of those told: schema.table keys.
  tables: Array<string>;
}

export interface DataLineageAnswerTable {
  dataAssetId: string;
  // Its schema.table key.
  table: string;
  database: string | null;
  // Steps from what the answer is about: 1 is next to it, 0 the table itself.
  steps: number;
  // The tables between, in the order the data flows.
  through: Array<string>;
  freshness: DataAssetFreshness;
  // How long it has been late; 0 when it is not.
  lateBySeconds: number;
  isDropped: boolean;
  // Its open alerts that the answer's reader may see.
  openAlertCount: number;
  // The pipelines whose latest run failed, moving data into it from a watched table.
  failedPipelines: Array<string>;
  // The pipelines whose latest run failed, loading it from outside what OneUptime watches.
  failedLoaders: Array<{
    name: string;
    lastRunStartedAt: string | null;
    lastErrorMessage: string | null;
  }>;
  // Dropped, late, with open alerts, or a pipeline into it failed.
  hasProblem: boolean;
}

// One side of the answer: what it is built from, or what is built from it.
export interface DataLineageAnswerSide {
  // Every table drawn on this side.
  tableCount: number;
  problemCount: number;
  // The tables with a problem, nearest first; at most the most told.
  problems: Array<DataLineageAnswerTable>;
  // The others, nearest first; at most the most told.
  others: Array<DataLineageAnswerTable>;
  untoldProblemCount: number;
  untoldOtherCount: number;
  /*
   * Tables next to the drawn ones that the drawing does not reach, counted
   * on each drawn table that way: further than the steps asked for, or
   * past the most drawn next to one table.
   */
  hiddenCount: number;
}

export interface DataLineageAnswerDashboard {
  name: string;
  // The BI tool it is in: Looker, Tableau, Power BI, Metabase, ...
  tool: string | null;
  // Whether it reads the table the answer is about itself.
  readsTheTable: boolean;
  // The other tables it reads, of those built from it: schema.table keys.
  tables: Array<string>;
}

export interface DataTableLineageAnswer {
  // The table asked about; null on a pipeline's lineage (an investigation of a pipeline's alert).
  dataAssetId: string | null;
  dataPipelineId: string | null;
  // The table's schema.table key, or the pipeline's job name.
  name: string;
  database: string | null;
  // The steps each way it was read to.
  depth: number;
  // How the table itself is; null on a pipeline's lineage.
  self: DataLineageAnswerTable | null;
  upstream: DataLineageAnswerSide;
  downstream: DataLineageAnswerSide;
  loaders: Array<DataLineageAnswerLoader>;
  untoldLoaderCount: number;
  dashboards: Array<DataLineageAnswerDashboard>;
  // Dashboards not in the list: past the most told, or past the most a drawing holds.
  untoldDashboardCount: number;
  // More lineage than one drawing reads: what is told is true, the counts at least what they say.
  isTruncated: boolean;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function clip(value: string | null | undefined, length: number): string | null {
  const text: string = (value || "").replace(/\s+/g, " ").trim();

  if (!text) {
    return null;
  }

  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// What a sentence may already end with.
const SENTENCE_END: RegExp = /[.!?…]$/;

// A sentence's full stop, unless it ends with one: a pipeline's error often does.
function withFullStop(text: string): string {
  return SENTENCE_END.test(text) ? text : `${text}.`;
}

// "5 hours ago", from an ISO time; "" when there is none.
function agoOf(iso: string | null, now: Date): string {
  const time: number = iso ? Date.parse(iso) : NaN;

  if (!Number.isFinite(time)) {
    return "";
  }

  return ` ${describeDuration(Math.max(0, (now.getTime() - time) / 1000))} ago`;
}

/*
 * The fewest steps from the drawing's own card to each table on one side,
 * through the arrows drawn between them: each table's card, and the card a
 * step nearer. On a pipeline's drawing the arrows into and out of it are
 * the first steps. Neighbours are taken by name, so one drawing always
 * tells the same way.
 */
function findNearer(
  lineage: DataTableLineage,
  byId: Map<string, DataTableLineageNode>,
  side: DataLineageSide,
): Map<string, string> {
  const focus: string = lineage.focusNodeId;
  const further: Map<string, Array<string>> = new Map();
  const isUpstream: boolean = side === DataLineageSide.Upstream;

  for (const edge of lineage.edges) {
    const isFocusRead: boolean =
      edge.kind === DataLineageEdgeKind.Reads && edge.target === focus;
    const isFocusWrite: boolean =
      edge.kind === DataLineageEdgeKind.Writes && edge.source === focus;

    if (
      edge.kind !== DataLineageEdgeKind.Feeds &&
      !isFocusRead &&
      !isFocusWrite
    ) {
      continue;
    }

    const near: string = isUpstream ? edge.target : edge.source;
    const far: string = isUpstream ? edge.source : edge.target;
    const farNode: DataTableLineageNode | undefined = byId.get(far);
    const nearNode: DataTableLineageNode | undefined = byId.get(near);

    if (
      !farNode ||
      farNode.kind !== DataLineageNodeKind.Table ||
      farNode.side !== side ||
      (near !== focus && (!nearNode || nearNode.side !== side))
    ) {
      continue;
    }

    further.set(near, [...(further.get(near) || []), far]);
  }

  const byName: (a: string, b: string) => number = (
    a: string,
    b: string,
  ): number => {
    return (
      compareText(byId.get(a)?.name || "", byId.get(b)?.name || "") ||
      compareText(a, b)
    );
  };
  const nearer: Map<string, string> = new Map();
  const seen: Set<string> = new Set([focus]);
  let frontier: Array<string> = [focus];

  while (frontier.length > 0) {
    const next: Array<string> = [];

    for (const at of frontier) {
      for (const far of [...(further.get(at) || [])].sort(byName)) {
        if (seen.has(far)) {
          continue;
        }

        seen.add(far);
        nearer.set(far, at);
        next.push(far);
      }
    }

    frontier = next;
  }

  return nearer;
}

/*
 * The answer from a drawing (DataTableLineage), told as DataTableLineageAnswer
 * holds it. Pure: the drawing holds everything it tells.
 */
export function buildDataTableLineageAnswer(
  lineage: DataTableLineage,
  limits: DataLineageAnswerLimits = DATA_LINEAGE_ANSWER_LIMITS,
): DataTableLineageAnswer {
  const byId: Map<string, DataTableLineageNode> = new Map();

  for (const node of lineage.nodes) {
    byId.set(node.id, node);
  }

  const focus: DataTableLineageNode | undefined = byId.get(lineage.focusNodeId);
  const isPipelineFocus: boolean =
    focus?.kind === DataLineageNodeKind.Pipeline ||
    isLineagePipelineNodeId(lineage.focusNodeId);
  // The arrows into each card.
  const into: Map<string, Array<DataTableLineageEdge>> = new Map();

  for (const edge of lineage.edges) {
    into.set(edge.target, [...(into.get(edge.target) || []), edge]);
  }

  const nearerUp: Map<string, string> = findNearer(
    lineage,
    byId,
    DataLineageSide.Upstream,
  );
  const nearerDown: Map<string, string> = findNearer(
    lineage,
    byId,
    DataLineageSide.Downstream,
  );

  const toTable: (node: DataTableLineageNode) => DataLineageAnswerTable = (
    node: DataTableLineageNode,
  ): DataLineageAnswerTable => {
    const isUpstream: boolean = node.side === DataLineageSide.Upstream;
    const nearer: Map<string, string> = isUpstream ? nearerUp : nearerDown;
    let steps: number = Math.abs(node.depth);
    let through: Array<string> = [];

    if (node.id !== lineage.focusNodeId && nearer.has(node.id)) {
      const between: Array<string> = [];

      for (
        let at: string | undefined = nearer.get(node.id);
        at && at !== lineage.focusNodeId;
        at = nearer.get(at)
      ) {
        between.push(byId.get(at)?.name || at);
      }

      // Walked toward the drawing's own card: upstream that is the way the data flows.
      through = isUpstream ? between : between.reverse();
      steps = through.length + 1;
    }

    const failedPipelines: Array<string> = [];
    const failedLoaders: DataLineageAnswerTable["failedLoaders"] = [];

    for (const edge of into.get(node.id) || []) {
      if (edge.kind === DataLineageEdgeKind.Feeds) {
        for (const pipeline of edge.pipelines) {
          if (
            isFailedLineageRunState(pipeline.lastRunState) &&
            !failedPipelines.includes(pipeline.name)
          ) {
            failedPipelines.push(pipeline.name);
          }
        }
      }

      if (
        edge.kind === DataLineageEdgeKind.Writes &&
        edge.source !== lineage.focusNodeId
      ) {
        const loader: DataTableLineageNode | undefined = byId.get(edge.source);

        if (
          loader?.kind === DataLineageNodeKind.Pipeline &&
          isFailedLineageRunState(loader.lastRunState)
        ) {
          failedLoaders.push({
            name: loader.name,
            lastRunStartedAt: loader.lastRunStartedAt || null,
            lastErrorMessage: clip(
              loader.lastErrorMessage,
              MAX_DATA_LINEAGE_ANSWER_ERROR_LENGTH,
            ),
          });
        }
      }
    }

    const freshness: DataAssetFreshness =
      node.freshness || DataAssetFreshness.Unknown;
    const isDropped: boolean = node.isDropped === true;
    const openAlertCount: number = node.openAlertCount || 0;

    return {
      dataAssetId: node.dataAssetId || "",
      table: node.name,
      database: node.database || null,
      steps,
      through,
      freshness,
      lateBySeconds: node.lateBySeconds || 0,
      isDropped,
      openAlertCount,
      failedPipelines,
      failedLoaders,
      hasProblem:
        isDropped ||
        freshness === DataAssetFreshness.Late ||
        openAlertCount > 0 ||
        failedPipelines.length > 0 ||
        failedLoaders.length > 0,
    };
  };

  const sideOf: (side: DataLineageSide) => DataLineageAnswerSide = (
    side: DataLineageSide,
  ): DataLineageAnswerSide => {
    const tables: Array<DataLineageAnswerTable> = lineage.nodes
      .filter((node: DataTableLineageNode): boolean => {
        return (
          node.kind === DataLineageNodeKind.Table &&
          node.side === side &&
          node.id !== lineage.focusNodeId
        );
      })
      .map(toTable)
      .sort((a: DataLineageAnswerTable, b: DataLineageAnswerTable): number => {
        return (
          a.steps - b.steps ||
          compareText(a.table, b.table) ||
          compareText(a.dataAssetId, b.dataAssetId)
        );
      });
    const problems: Array<DataLineageAnswerTable> = tables.filter(
      (table: DataLineageAnswerTable): boolean => {
        return table.hasProblem;
      },
    );
    const others: Array<DataLineageAnswerTable> = tables.filter(
      (table: DataLineageAnswerTable): boolean => {
        return !table.hasProblem;
      },
    );
    const isUpstream: boolean = side === DataLineageSide.Upstream;
    let hiddenCount: number = 0;

    for (const node of lineage.nodes) {
      if (node.side !== side && node.id !== lineage.focusNodeId) {
        continue;
      }

      hiddenCount += isUpstream
        ? node.hiddenUpstreamCount || 0
        : node.hiddenDownstreamCount || 0;
    }

    return {
      tableCount: tables.length,
      problemCount: problems.length,
      problems: problems.slice(0, limits.problems),
      others: others.slice(0, limits.others),
      untoldProblemCount: Math.max(0, problems.length - limits.problems),
      untoldOtherCount: Math.max(0, others.length - limits.others),
      hiddenCount,
    };
  };

  // The pipelines that load drawn tables from outside: every pipeline card but the drawing's own.
  const loaders: Array<DataLineageAnswerLoader> = lineage.nodes
    .filter((node: DataTableLineageNode): boolean => {
      return (
        node.kind === DataLineageNodeKind.Pipeline &&
        node.id !== lineage.focusNodeId
      );
    })
    .map((node: DataTableLineageNode): DataLineageAnswerLoader => {
      return {
        dataPipelineId: node.dataPipelineId || "",
        name: node.name,
        lastRunState: node.lastRunState || null,
        lastRunStartedAt: node.lastRunStartedAt || null,
        lastErrorMessage: clip(
          node.lastErrorMessage,
          MAX_DATA_LINEAGE_ANSWER_ERROR_LENGTH,
        ),
        tables: lineage.edges
          .filter((edge: DataTableLineageEdge): boolean => {
            return (
              edge.kind === DataLineageEdgeKind.Writes &&
              edge.source === node.id
            );
          })
          .map((edge: DataTableLineageEdge): string => {
            return byId.get(edge.target)?.name || edge.target;
          })
          .sort(compareText),
      };
    })
    .sort((a: DataLineageAnswerLoader, b: DataLineageAnswerLoader): number => {
      const aFailed: boolean = isFailedLineageRunState(a.lastRunState);
      const bFailed: boolean = isFailedLineageRunState(b.lastRunState);

      if (aFailed !== bFailed) {
        return aFailed ? -1 : 1;
      }

      return (
        compareText(a.name, b.name) ||
        compareText(a.dataPipelineId, b.dataPipelineId)
      );
    });

  const dashboards: Array<DataLineageAnswerDashboard> = lineage.nodes
    .filter((node: DataTableLineageNode): boolean => {
      return node.kind === DataLineageNodeKind.Dashboard;
    })
    .map((node: DataTableLineageNode): DataLineageAnswerDashboard => {
      const reads: Array<DataTableLineageEdge> = (
        into.get(node.id) || []
      ).filter((edge: DataTableLineageEdge): boolean => {
        return edge.kind === DataLineageEdgeKind.Reads;
      });

      return {
        name: node.name,
        tool: node.tool || null,
        readsTheTable: reads.some((edge: DataTableLineageEdge): boolean => {
          return edge.source === lineage.focusNodeId;
        }),
        tables: reads
          .filter((edge: DataTableLineageEdge): boolean => {
            return edge.source !== lineage.focusNodeId;
          })
          .map((edge: DataTableLineageEdge): string => {
            return byId.get(edge.source)?.name || edge.source;
          })
          .sort(compareText),
      };
    })
    .sort(
      (
        a: DataLineageAnswerDashboard,
        b: DataLineageAnswerDashboard,
      ): number => {
        return compareText(a.name, b.name);
      },
    );

  return {
    dataAssetId: isPipelineFocus ? null : focus?.dataAssetId || null,
    dataPipelineId: isPipelineFocus ? focus?.dataPipelineId || null : null,
    name: focus?.name || "",
    database: isPipelineFocus ? null : focus?.database || null,
    depth: lineage.depth,
    self: focus && !isPipelineFocus ? toTable(focus) : null,
    upstream: sideOf(DataLineageSide.Upstream),
    downstream: sideOf(DataLineageSide.Downstream),
    loaders: loaders.slice(0, limits.loaders),
    untoldLoaderCount: Math.max(0, loaders.length - limits.loaders),
    dashboards: dashboards.slice(0, limits.dashboards),
    untoldDashboardCount:
      Math.max(0, dashboards.length - limits.dashboards) +
      lineage.hiddenDashboardCount,
    isTruncated: lineage.isTruncated,
  };
}

// "fresh", "late by 3 hours", "dropped from its database": how a table is now.
function describeFreshness(table: DataLineageAnswerTable): string {
  if (table.isDropped) {
    return "dropped from its database";
  }

  switch (table.freshness) {
    case DataAssetFreshness.Late:
      return `late by ${describeDuration(table.lateBySeconds)}`;
    case DataAssetFreshness.Fresh:
      return "fresh";
    case DataAssetFreshness.NotApplicable:
      return "a view";
    default:
      return "freshness not known yet";
  }
}

// Everything that is wrong with a table, and how fresh it is: "late by 3 hours; 1 open alert; ...".
export function describeLineageTableState(
  table: DataLineageAnswerTable,
  now: Date,
): string {
  const parts: Array<string> = [describeFreshness(table)];

  if (table.openAlertCount > 0) {
    parts.push(plural(table.openAlertCount, "open alert", "open alerts"));
  }

  for (const name of table.failedPipelines) {
    parts.push(`the pipeline ${name} that builds it failed its last run`);
  }

  for (const loader of table.failedLoaders) {
    parts.push(
      `the pipeline ${loader.name} that loads it failed its last run${agoOf(loader.lastRunStartedAt, now)}${loader.lastErrorMessage ? `: ${loader.lastErrorMessage}` : ""}`,
    );
  }

  return parts.join("; ");
}

// "the last run failed 5 hours ago", "running, started 3 minutes ago".
function describeLoaderRun(loader: DataLineageAnswerLoader, now: Date): string {
  const ago: string = agoOf(loader.lastRunStartedAt, now);

  if (!loader.lastRunState) {
    return "no run seen yet";
  }

  if (isRunningLineageRunState(loader.lastRunState)) {
    return `running${ago ? `, started${ago}` : ""}`;
  }

  const word: string =
    loader.lastRunState === "FAIL"
      ? "failed"
      : loader.lastRunState === "ABORT"
        ? "aborted"
        : loader.lastRunState.toLowerCase();

  return `last run ${word}${ago}`;
}

// A table's database, when it is not the database of what the answer is about.
function otherDatabaseOf(
  table: DataLineageAnswerTable,
  database: string | null,
): string | null {
  return table.database && table.database !== database ? table.database : null;
}

// A table's name, with its database when that is another.
function nameOf(
  table: DataLineageAnswerTable,
  database: string | null,
): string {
  const other: string | null = otherDatabaseOf(table, database);

  return `${table.table}${other ? ` (${other})` : ""}`;
}

function stepsOf(table: DataLineageAnswerTable, isUpstream: boolean): string {
  return `${plural(table.steps, "step", "steps")} ${isUpstream ? "up" : "down"}`;
}

/*
 * One side, in lines: how many tables and how many with a problem, each
 * problem on a line of its own, nearest first, then the rest in one line.
 */
function describeSide(data: {
  answer: DataTableLineageAnswer;
  side: DataLineageAnswerSide;
  isUpstream: boolean;
  now: Date;
}): Array<string> {
  const side: DataLineageAnswerSide = data.side;
  const isPipeline: boolean = data.answer.dataAssetId === null;
  const label: string = data.isUpstream
    ? isPipeline
      ? "Upstream, what it reads"
      : "Upstream, what it is built from"
    : isPipeline
      ? "Downstream, what it writes and what is built from that"
      : "Downstream, what is built from it";

  if (side.tableCount === 0) {
    return [
      data.isUpstream
        ? `Upstream: no watched table is seen ${isPipeline ? "read by it" : "feeding it"}.`
        : `Downstream: no watched table is seen ${isPipeline ? "written by it" : "built from it"}.`,
    ];
  }

  const lines: Array<string> = [
    `${label}: ${plural(side.tableCount, "table", "tables")}, ${
      side.problemCount === 0
        ? "none with a problem"
        : `${side.problemCount} with a problem`
    }.`,
  ];

  for (const table of side.problems) {
    lines.push(
      withFullStop(
        `- ${nameOf(table, data.answer.database)}, ${stepsOf(table, data.isUpstream)}${
          table.through.length > 0
            ? `, through ${table.through.join(", then ")}`
            : ""
        }: ${describeLineageTableState(table, data.now)}`,
      ),
    );
  }

  if (side.untoldProblemCount > 0) {
    lines.push(
      `- and ${side.untoldProblemCount} more with a problem, further ${data.isUpstream ? "up" : "down"}.`,
    );
  }

  if (side.others.length > 0) {
    lines.push(
      `${side.problemCount > 0 ? "The rest, nearest first" : "Nearest first"}: ${side.others
        .map((table: DataLineageAnswerTable): string => {
          return `${table.table} (${[
            otherDatabaseOf(table, data.answer.database),
            stepsOf(table, data.isUpstream),
            describeFreshness(table),
          ]
            .filter(Boolean)
            .join(", ")})`;
        })
        .join(
          ", ",
        )}${side.untoldOtherCount > 0 ? ` and ${side.untoldOtherCount} more` : ""}.`,
    );
  }

  return lines;
}

/*
 * The answer's lines past its first: each side, the pipelines that load
 * the upstream tables from outside, the dashboards, and what lies past
 * what is told. An investigation reads these under its own first line.
 */
export function describeDataTableLineageSides(
  answer: DataTableLineageAnswer,
  now: Date,
): Array<string> {
  const lines: Array<string> = [
    ...describeSide({
      answer,
      side: answer.upstream,
      isUpstream: true,
      now,
    }),
  ];

  if (answer.loaders.length > 0) {
    lines.push(
      `Loaded from outside what OneUptime watches by: ${answer.loaders
        .map((loader: DataLineageAnswerLoader): string => {
          return `the pipeline ${loader.name}${
            loader.tables.length > 0 ? ` into ${loader.tables.join(", ")}` : ""
          } (${describeLoaderRun(loader, now)})`;
        })
        .join(
          ", ",
        )}${answer.untoldLoaderCount > 0 ? ` and ${answer.untoldLoaderCount} more` : ""}.`,
    );
  }

  lines.push(
    ...describeSide({
      answer,
      side: answer.downstream,
      isUpstream: false,
      now,
    }),
  );

  if (answer.dashboards.length > 0) {
    lines.push(
      `Dashboards built on ${answer.dataAssetId ? "it or on tables built from it" : "the tables it writes"}: ${answer.dashboards
        .map((dashboard: DataLineageAnswerDashboard): string => {
          const reads: Array<string> = [
            ...(dashboard.readsTheTable ? ["it"] : []),
            ...dashboard.tables,
          ];

          return `${dashboard.name} (${[
            dashboard.tool,
            reads.length > 0 ? `reads ${reads.join(", ")}` : null,
          ]
            .filter(Boolean)
            .join(", ")})`;
        })
        .join(
          ", ",
        )}${answer.untoldDashboardCount > 0 ? ` and ${answer.untoldDashboardCount} more` : ""}.`,
    );
  } else if (answer.untoldDashboardCount > 0) {
    lines.push(
      `${plural(answer.untoldDashboardCount, "dashboard is", "dashboards are")} built on these tables, past the most one answer tells.`,
    );
  }

  const further: Array<string> = [];

  if (answer.upstream.hiddenCount > 0) {
    further.push(
      `${plural(answer.upstream.hiddenCount, "more table", "more tables")} further up`,
    );
  }

  if (answer.downstream.hiddenCount > 0) {
    further.push(
      `${plural(answer.downstream.hiddenCount, "more table", "more tables")} further down`,
    );
  }

  if (further.length > 0) {
    lines.push(
      `More lineage lies past what is told: ${further.join(" and ")} (further than ${plural(answer.depth, "step", "steps")}, or past the ${MAX_DATA_LINEAGE_NEIGHBORS} nearest to one table). ${
        answer.depth < MAX_DATA_LINEAGE_DEPTH
          ? `Ask again with a depth of up to ${MAX_DATA_LINEAGE_DEPTH} to see further, or about one of these tables.`
          : "Ask about one of these tables to see past it."
      }`,
    );
  }

  if (answer.isTruncated) {
    lines.push(
      "This lineage is larger than one answer reads: what is told is true, and the counts are at least what they say.",
    );
  }

  return lines;
}

/*
 * The answer in plain lines, for an agent to read or a person in a chat:
 * the table and how it is, then what it is built from - problems first -
 * and what is built from it.
 */
export function formatDataTableLineageAnswer(
  answer: DataTableLineageAnswer,
  now: Date,
): string {
  const name: string = `${answer.name}${answer.database ? ` (${answer.database})` : ""}`;
  const state: string = answer.self
    ? `: ${describeLineageTableState(answer.self, now)}`
    : "";

  return [
    `${answer.dataAssetId ? "" : "The pipeline "}${name}${state}. Its lineage, ${plural(answer.depth, "step", "steps")} each way:`,
    ...describeDataTableLineageSides(answer, now),
  ].join("\n");
}

/*
 * Several answers - a name several databases share - or none, as one
 * reply: what the AI tool answers with.
 */
export function formatDataTableLineageReply(data: {
  reference: string;
  answers: Array<DataTableLineageAnswer>;
  now: Date;
}): string {
  if (data.answers.length === 0) {
    return `No table Data Observability watches is called "${data.reference}". Data Observability watches the tables of the databases connected to it: list them under Data Observability > Tables.`;
  }

  const texts: Array<string> = data.answers.map(
    (answer: DataTableLineageAnswer): string => {
      return formatDataTableLineageAnswer(answer, data.now);
    },
  );

  if (texts.length === 1) {
    return texts[0]!;
  }

  return [
    `${texts.length} watched tables are called "${data.reference}". The lineage of each:`,
    ...texts,
  ].join("\n\n");
}

/*
 * What an investigation of a data alert is told of its lineage
 * (DataAlertContext): the lineage around its table or pipeline, where in
 * the chain the alert it is a consequence of is, and which tables the
 * alerts it caused are on. Lines of a list; none when the alert is about a
 * whole database.
 */
export function describeDataAlertLineage(
  alertLineage: DataAlertLineageAnswer,
  now: Date,
): Array<string> {
  const lineage: DataTableLineage | null = alertLineage.lineage;

  if (!lineage) {
    return [];
  }

  const answer: DataTableLineageAnswer = buildDataTableLineageAnswer(lineage);
  const isPipeline: boolean = answer.dataAssetId === null;
  const lines: Array<string> = [
    `- ${isPipeline ? "The pipeline's lineage (the tables it reads, and the tables it writes and what is built from them)" : "Its lineage (the tables it is built from, and the tables built from it)"}, ${plural(answer.depth, "step", "steps")} each way:`,
    ...describeDataTableLineageSides(answer, now).map(
      (line: string): string => {
        return `  ${line}`;
      },
    ),
  ];
  const byId: Map<string, DataTableLineageNode> = new Map();

  for (const node of lineage.nodes) {
    byId.set(node.id, node);
  }

  const tableAt: (nodeId: string) => DataLineageAnswerTable | undefined = (
    nodeId: string,
  ): DataLineageAnswerTable | undefined => {
    const id: string | undefined = byId.get(nodeId)?.dataAssetId;

    return [
      ...answer.upstream.problems,
      ...answer.upstream.others,
      ...answer.downstream.problems,
      ...answer.downstream.others,
    ].find((table: DataLineageAnswerTable): boolean => {
      return Boolean(id) && table.dataAssetId === id;
    });
  };
  const placeOf: (nodeId: string) => string | null = (
    nodeId: string,
  ): string | null => {
    const node: DataTableLineageNode | undefined = byId.get(nodeId);

    if (!node) {
      return null;
    }

    const isUpstream: boolean = node.side === DataLineageSide.Upstream;

    if (node.kind === DataLineageNodeKind.Pipeline) {
      const loads: Array<string> = lineage.edges
        .filter((edge: DataTableLineageEdge): boolean => {
          return (
            edge.kind === DataLineageEdgeKind.Writes && edge.source === node.id
          );
        })
        .map((edge: DataTableLineageEdge): string => {
          return byId.get(edge.target)?.name || edge.target;
        })
        .sort(compareText);

      return `the pipeline ${node.name}${loads.length > 0 ? `, which loads ${loads.join(", ")}` : ""}`;
    }

    const table: DataLineageAnswerTable | undefined = tableAt(nodeId);

    if (!table) {
      return `${node.name}, ${plural(Math.abs(node.depth), "step", "steps")} ${isUpstream ? "up" : "down"}`;
    }

    return `${nameOf(table, answer.database)}, ${stepsOf(table, isUpstream)}${
      table.through.length > 0
        ? `, through ${table.through.join(", then ")}`
        : ""
    }`;
  };

  if (alertLineage.isCauseDrawn && lineage.highlight) {
    const places: Array<string> = lineage.highlight.causeNodeIds
      .map(placeOf)
      .filter((place: string | null): place is string => {
        return Boolean(place);
      });

    // A cause on a pipeline that moves data between two watched tables: named on the arrow into the table it builds.
    if (places.length === 0) {
      for (const edge of lineage.edges) {
        const highlighted: boolean = lineage.highlight.edgeIds.includes(
          edge.id,
        );
        const target: DataTableLineageNode | undefined = byId.get(edge.target);
        const carried: DataTableLineagePipeline | undefined =
          edge.pipelines.find((pipeline: DataTableLineagePipeline) => {
            return lineage.highlight!.dataPipelineIds.includes(
              pipeline.dataPipelineId,
            );
          });

        if (
          highlighted &&
          carried &&
          target &&
          (target.id === lineage.focusNodeId ||
            target.side === DataLineageSide.Upstream)
        ) {
          places.push(
            `the pipeline ${carried.name}, which builds ${target.name}`,
          );
          break;
        }
      }
    }

    if (places.length > 0) {
      lines.push(
        `- The alert this one is a consequence of is on ${places.join("; ")}: start there.`,
      );
    }
  }

  if (alertLineage.consequenceCount > 0) {
    const places: Array<string> = (lineage.highlight?.consequenceNodeIds || [])
      .map(placeOf)
      .filter((place: string | null): place is string => {
        return Boolean(place);
      });

    lines.push(
      `- ${plural(alertLineage.consequenceCount, "alert was", "alerts were")} raised as a consequence of this one${
        places.length > 0 ? `, on: ${places.join("; ")}` : ""
      }${
        alertLineage.drawnConsequenceCount < alertLineage.consequenceCount
          ? `${places.length > 0 ? ". The rest are" : ","} further down than this lineage reaches`
          : ""
      }.`,
    );
  }

  return lines;
}

export default class DataTableLineageAnswerer {
  /*
   * The lineage of the tables a reference means - an id, schema.table, or
   * a table's name alone - each told, for its reader: the props of the
   * person (or API key) who asked, or null when nobody in particular reads
   * it. None when no watched table is called that.
   */
  public static async answer(data: {
    projectId: ObjectID;
    reference: string;
    depth: number;
    now: Date;
    reader: DatabaseCommonInteractionProps | null;
  }): Promise<Array<DataTableLineageAnswer>> {
    const tables: Array<DataAsset> = await DataTableAnswerer.findTables(
      data.projectId,
      data.reference,
    );
    const limits: DataLineageAnswerLimits =
      tables.length > 1
        ? DATA_LINEAGE_ANSWER_LIMITS_FOR_SEVERAL
        : DATA_LINEAGE_ANSWER_LIMITS;
    const answers: Array<DataTableLineageAnswer> = [];

    for (const table of tables) {
      if (!table.id) {
        continue;
      }

      // Its tables' open alerts as the reader may see them (DataTableLineageReader).
      const lineage: DataTableLineage | null =
        await DataTableLineageReader.read({
          projectId: data.projectId,
          dataAssetId: table.id,
          depth: data.depth,
          now: data.now,
          reader: data.reader,
        });

      if (lineage) {
        answers.push(buildDataTableLineageAnswer(lineage, limits));
      }
    }

    return answers;
  }
}
