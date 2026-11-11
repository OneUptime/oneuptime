import Alert from "../../../Models/DatabaseModels/Alert";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { getDataCheckColumn } from "../../../Types/DataObservability/DataCheckType";
import {
  DEFAULT_DATA_LINEAGE_DEPTH,
  DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH,
  DataAlertLineageAnswer,
  DataLineageHighlight,
  DataTableLineage,
  DataTableLineageEdge,
  DataTableLineageNode,
  DataTableLineagePipeline,
  MAX_DATA_LINEAGE_DEPTH,
  getLineagePipelineNodeId,
  getLineageTableNodeId,
} from "../../../Types/DataObservability/DataTableLineage";
import ObjectID from "../../../Types/ObjectID";
import AlertService from "../../Services/AlertService";
import DataAlertService, {
  Service as DataAlertServiceType,
} from "../../Services/DataAlertService";
import DataCheckService from "../../Services/DataCheckService";
import Query from "../../Types/Database/Query";
import { applyAlertRelatedRecordPrivacyFilter } from "../Alert/AlertPrivacyFilter";
import DataTableLineageReader, {
  DataLineageDirection,
  DataLineageEdgeRow,
  DataLineagePins,
  DataLineageReader,
  DataPipelineLineageReader,
  DataPipelineTables,
  MAX_DATA_LINEAGE_EDGE_ROWS,
} from "./DataTableLineage";

/*
 * A DATA ALERT'S LINEAGE: WHERE IN THE CHAIN ITS PROBLEM STARTED, AND WHAT IT
 * REACHED.
 *
 * A data alert whose cause was open first upstream (DataAlertCause) says so
 * in words on its page; the person paged wants to see where in the chain
 * that cause is - the failed run three steps up - and, on the cause, which
 * of the tables built from it went wrong with it. So the alert's lineage is
 * drawn around what it is about - its table, as the table's Lineage tab
 * draws it, or its pipeline, as the pipeline's page does - and the way up
 * to its cause and down to each alert it caused is picked out (highlight).
 *
 * The ways are found first, a step at a time through the lineage edges, the
 * fewest steps to each (findWays), as far as a cause is ever looked for.
 * Their tables are then pinned, so the drawing draws them whatever else it
 * leaves out, and walks as many steps each way as the furthest needs. What
 * the drawing could not hold - a side past its most tables - is simply not
 * picked out, and the answer says how much was.
 *
 * Every alert is read as its reader may see it, with the same clause the
 * data alerts' own reads put on a signed-in reader (DataAlertService):
 * someone who may not see the alert, or the alert it is a consequence of,
 * gets no answer at all - as they get no Data card - and an alert it caused
 * that they may not see is neither counted nor picked out. No alert is
 * named here: the drawing says which tables and pipelines, never which
 * alerts.
 *
 * An alert from a check on one column of its table - a null rate, a
 * distinct count on orders.customer_id - is first a question of which
 * columns feed that column. Its drawing is read with the columns each
 * arrow carries, as a table's is when asked (withColumns), and says which
 * column the check reads (column), so the diagram opens with it followed.
 */

// The most alerts it caused that the drawing looks for ways to.
export const MAX_DATA_ALERT_LINEAGE_CONSEQUENCES: number = 50;

// The most tables a search for the ways reads before it stops.
export const MAX_DATA_ALERT_WAY_TABLES: number = 2000;

// One data alert, as its lineage reads it.
export interface DataAlertLineageRow {
  alertId: string;
  dataAssetId: string | null;
  dataPipelineId: string | null;
  dataStoreId: string | null;
  causeAlertId: string | null;
}

// Where a data alert's lineage reads its alerts: the database as its reader may see it, or a test's.
export interface DataAlertRowReader {
  // The alert's own row; null when it is no data alert, or its reader may not see it or the alert it is a consequence of.
  readAlert(alertId: string): Promise<DataAlertLineageRow | null>;
  // What an alert its reader may see is about.
  readSubject(alertId: string): Promise<DataAlertLineageRow | null>;
  // The alerts it caused that its reader may see, the first ones, and how many there are.
  readConsequences(data: {
    alertId: string;
    limit: number;
  }): Promise<{ rows: Array<DataAlertLineageRow>; total: number }>;
  /*
   * The column the check behind the alert reads (getDataCheckColumn): null
   * for an alert from no check, or from a check on the whole table. Asked
   * only of an alert readAlert found theirs to see.
   */
  readCheckColumn(alertId: string): Promise<string | null>;
}

// Where a way ends.
export enum DataLineageWayEnd {
  // At a table: the cause's, or a consequence's.
  Table = "Table",
  // At a pipeline that writes the last table from outside: drawn as a card.
  Writer = "Writer",
  // At a pipeline that moves data along the arrows into (or out of) the last table: drawn on them.
  Arrow = "Arrow",
}

// The fewest steps from the drawing's own card to a table or pipeline.
export interface DataLineageWay {
  // The tables along it in order, the first a step from the drawing's own card.
  dataAssetIds: Array<string>;
  end: DataLineageWayEnd;
  // A pipeline's way: the pipeline.
  dataPipelineId: string | null;
  // An arrow's: the table at its other end, drawn so one arrow is.
  viaDataAssetId: string | null;
}

// A way sought, and which way it goes.
interface SoughtWay {
  key: string;
  way: DataLineageWay;
  direction: DataLineageDirection;
  isCause: boolean;
}

// The tables and pipelines ways are sought to, one way.
interface WayTargets {
  dataAssetIds: Set<string>;
  dataPipelineIds: Set<string>;
}

/*
 * What a drawing picked out, and which ways it drew whole: the cause's and
 * the consequences' apart, so a table on both - a loop in the lineage - is
 * told for the way that reached it.
 */
interface PickedWays {
  highlight: DataLineageHighlight | null;
  causes: Set<string>;
  consequences: Set<string>;
}

// What the drawing is about: an alert's table, or its pipeline.
interface AlertFocus {
  dataAssetId: string | null;
  dataPipelineId: string | null;
}

function toAlertRow(row: DataAlert): DataAlertLineageRow {
  return {
    alertId: row.alertId?.toString() || "",
    dataAssetId: row.dataAssetId?.toString() || null,
    dataPipelineId: row.dataPipelineId?.toString() || null,
    dataStoreId: row.dataStoreId?.toString() || null,
    causeAlertId: row.causeAlertId?.toString() || null,
  };
}

// A way's key: the node id of where it ends.
function targetKeyOf(row: DataAlertLineageRow): string | null {
  if (row.dataAssetId) {
    return getLineageTableNodeId(row.dataAssetId);
  }

  if (row.dataPipelineId) {
    return getLineagePipelineNodeId(row.dataPipelineId);
  }

  return null;
}

// How many steps a way's tables reach from the drawing's own card.
function stepsOf(way: DataLineageWay): number {
  return way.dataAssetIds.length + (way.viaDataAssetId ? 1 : 0);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const SELECT_ROW: {
  alertId: true;
  dataAssetId: true;
  dataPipelineId: true;
  dataStoreId: true;
  causeAlertId: true;
} = {
  alertId: true,
  dataAssetId: true,
  dataPipelineId: true,
  dataStoreId: true,
  causeAlertId: true,
};

export default class DataAlertLineageReader {
  /*
   * The alert's lineage, for its reader: the props of the person who asked.
   * Null when it is no data alert of the project's that they may see.
   */
  public static async read(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    now: Date;
    reader: DatabaseCommonInteractionProps | null;
  }): Promise<DataAlertLineageAnswer | null> {
    return await this.build({
      alertId: data.alertId.toString(),
      now: data.now,
      alerts: this.getDatabaseAlertReader(data.projectId, data.reader),
      reader: DataTableLineageReader.getDatabaseReader(
        data.projectId,
        data.reader,
      ),
    });
  }

  // The answer, from any readers.
  public static async build(data: {
    alertId: string;
    now: Date;
    alerts: DataAlertRowReader;
    reader: DataPipelineLineageReader;
  }): Promise<DataAlertLineageAnswer | null> {
    const own: DataAlertLineageRow | null = await data.alerts.readAlert(
      data.alertId,
    );

    if (!own) {
      return null;
    }

    const consequences: {
      rows: Array<DataAlertLineageRow>;
      total: number;
    } = await data.alerts.readConsequences({
      alertId: data.alertId,
      limit: MAX_DATA_ALERT_LINEAGE_CONSEQUENCES,
    });
    const answer: DataAlertLineageAnswer = {
      lineage: null,
      hasCause: Boolean(own.causeAlertId),
      isCauseDrawn: false,
      consequenceCount: consequences.total,
      drawnConsequenceCount: 0,
      column: null,
    };

    // An alert about a whole database: no table or pipeline to draw.
    const focus: AlertFocus = {
      dataAssetId: own.dataAssetId,
      dataPipelineId: own.dataAssetId ? null : own.dataPipelineId,
    };

    if (!focus.dataAssetId && !focus.dataPipelineId) {
      return answer;
    }

    const focusKey: string = focus.dataAssetId
      ? getLineageTableNodeId(focus.dataAssetId)
      : getLineagePipelineNodeId(focus.dataPipelineId!);

    // A check on one column of its table: the drawing carries its arrows' columns, to follow that one.
    const column: string | null = focus.dataAssetId
      ? await data.alerts.readCheckColumn(data.alertId)
      : null;

    // Read only when it was the alert's cause: its reader may see it, so may see what it is about.
    const cause: DataAlertLineageRow | null = own.causeAlertId
      ? await data.alerts.readSubject(own.causeAlertId)
      : null;
    const causeKey: string | null = cause ? targetKeyOf(cause) : null;

    const upstreamTargets: WayTargets = {
      dataAssetIds: new Set(),
      dataPipelineIds: new Set(),
    };
    const downstreamTargets: WayTargets = {
      dataAssetIds: new Set(),
      dataPipelineIds: new Set(),
    };

    const addTarget: (targets: WayTargets, row: DataAlertLineageRow) => void = (
      targets: WayTargets,
      row: DataAlertLineageRow,
    ): void => {
      if (targetKeyOf(row) === focusKey) {
        return;
      }

      if (row.dataAssetId) {
        targets.dataAssetIds.add(row.dataAssetId);
      } else if (row.dataPipelineId) {
        targets.dataPipelineIds.add(row.dataPipelineId);
      }
    };

    if (cause) {
      addTarget(upstreamTargets, cause);
    }

    for (const row of consequences.rows) {
      addTarget(downstreamTargets, row);
    }

    // Where the ways set out from: the table itself, or the tables the pipeline reads and writes.
    let pipelineTables: DataPipelineTables | null = null;

    if (
      focus.dataPipelineId &&
      upstreamTargets.dataAssetIds.size +
        upstreamTargets.dataPipelineIds.size +
        downstreamTargets.dataAssetIds.size +
        downstreamTargets.dataPipelineIds.size >
        0
    ) {
      pipelineTables = await DataTableLineageReader.readPipelineTables(
        data.reader,
        focus.dataPipelineId,
      );
    }

    const startOf: (direction: DataLineageDirection) => {
      start: Array<string>;
      startStep: number;
    } = (
      direction: DataLineageDirection,
    ): { start: Array<string>; startStep: number } => {
      if (focus.dataAssetId) {
        return { start: [focus.dataAssetId], startStep: 0 };
      }

      return {
        start: Array.from(
          (direction === DataLineageDirection.Upstream
            ? pipelineTables?.read
            : pipelineTables?.written
          )?.keys() || [],
        ),
        startStep: 1,
      };
    };

    const upstreamWays: Map<string, DataLineageWay> = await this.findWays({
      direction: DataLineageDirection.Upstream,
      ...startOf(DataLineageDirection.Upstream),
      targets: upstreamTargets,
      reader: data.reader,
    });
    const downstreamWays: Map<string, DataLineageWay> = await this.findWays({
      direction: DataLineageDirection.Downstream,
      ...startOf(DataLineageDirection.Downstream),
      targets: downstreamTargets,
      reader: data.reader,
    });

    const sought: Array<SoughtWay> = [];

    for (const [key, way] of upstreamWays) {
      sought.push({
        key,
        way,
        direction: DataLineageDirection.Upstream,
        isCause: true,
      });
    }

    for (const [key, way] of downstreamWays) {
      sought.push({
        key,
        way,
        direction: DataLineageDirection.Downstream,
        isCause: false,
      });
    }

    const defaultDepth: number = focus.dataAssetId
      ? DEFAULT_DATA_LINEAGE_DEPTH
      : DEFAULT_DATA_PIPELINE_LINEAGE_DEPTH;
    let upstreamDepth: number = defaultDepth;
    let downstreamDepth: number = defaultDepth;
    const pins: DataLineagePins = {
      dataAssetIds: new Set(),
      dataPipelineIds: new Set(),
    };

    for (const entry of sought) {
      const steps: number = Math.min(
        MAX_DATA_LINEAGE_DEPTH,
        stepsOf(entry.way),
      );

      if (entry.direction === DataLineageDirection.Upstream) {
        upstreamDepth = Math.max(upstreamDepth, steps);
      } else {
        downstreamDepth = Math.max(downstreamDepth, steps);
      }

      for (const id of entry.way.dataAssetIds) {
        pins.dataAssetIds.add(id);
      }

      if (entry.way.viaDataAssetId) {
        pins.dataAssetIds.add(entry.way.viaDataAssetId);
      }

      if (
        entry.way.end === DataLineageWayEnd.Writer &&
        entry.way.dataPipelineId
      ) {
        pins.dataPipelineIds.add(entry.way.dataPipelineId);
      }
    }

    const lineage: DataTableLineage | null = focus.dataAssetId
      ? await DataTableLineageReader.build({
          focusDataAssetId: focus.dataAssetId,
          depth: defaultDepth,
          upstreamDepth,
          downstreamDepth,
          now: data.now,
          reader: data.reader,
          pins,
          // Capped as a table's drawing is: the arrows nearest the table first.
          withColumns: Boolean(column),
        })
      : await DataTableLineageReader.buildForPipeline({
          focusDataPipelineId: focus.dataPipelineId!,
          depth: defaultDepth,
          upstreamDepth,
          downstreamDepth,
          now: data.now,
          reader: data.reader,
          pins,
          // Read once: the ways set out from them.
          tables: pipelineTables || undefined,
        });

    if (!lineage) {
      return answer;
    }

    const picked: PickedWays = this.highlight(lineage, sought);

    if (picked.highlight) {
      lineage.highlight = picked.highlight;
    }

    answer.lineage = lineage;
    answer.column = column;
    answer.isCauseDrawn = Boolean(causeKey && picked.causes.has(causeKey));
    answer.drawnConsequenceCount = consequences.rows.filter(
      (row: DataAlertLineageRow): boolean => {
        const key: string | null = targetKeyOf(row);

        return Boolean(key && picked.consequences.has(key));
      },
    ).length;

    return answer;
  }

  /*
   * The fewest steps from the tables a drawing sets out from to each table
   * and pipeline sought, one way, as far as a cause is ever looked for: a
   * step at a time through the lineage edges, every table met once. A
   * pipeline is met on an edge it moves data along - the way ends on that
   * arrow - or, upstream, writing a table from outside: the way ends on its
   * card. Stops once every one is met, or past the most tables.
   */
  public static async findWays(data: {
    direction: DataLineageDirection;
    // The table itself (step 0), or the tables a pipeline reads or writes (step 1).
    start: Array<string>;
    startStep: number;
    targets: WayTargets;
    reader: DataLineageReader;
  }): Promise<Map<string, DataLineageWay>> {
    const ways: Map<string, DataLineageWay> = new Map();
    const wanted: number =
      data.targets.dataAssetIds.size + data.targets.dataPipelineIds.size;

    if (wanted === 0 || data.start.length === 0) {
      return ways;
    }

    const isUpstream: boolean =
      data.direction === DataLineageDirection.Upstream;
    // Each table met, and the table a step nearer it was met from: null for where the ways set out.
    const previous: Map<string, string | null> = new Map();

    const wayTo: (id: string) => Array<string> = (
      id: string,
    ): Array<string> => {
      const tables: Array<string> = [];

      for (
        let at: string | null = id;
        at !== null;
        at = previous.get(at) ?? null
      ) {
        tables.unshift(at);
      }

      // The table itself is the drawing's own card, not a step along the way.
      return data.startStep === 0 ? tables.slice(1) : tables;
    };

    for (const id of data.start) {
      previous.set(id, null);

      if (data.startStep > 0 && data.targets.dataAssetIds.has(id)) {
        ways.set(getLineageTableNodeId(id), {
          dataAssetIds: [id],
          end: DataLineageWayEnd.Table,
          dataPipelineId: null,
          viaDataAssetId: null,
        });
      }
    }

    let frontier: Array<string> = [...data.start];

    for (
      let step: number = data.startStep;
      frontier.length > 0 &&
      step < MAX_DATA_LINEAGE_DEPTH &&
      ways.size < wanted &&
      previous.size < MAX_DATA_ALERT_WAY_TABLES;
      step++
    ) {
      const inFrontier: Set<string> = new Set(frontier);
      const rows: Array<DataLineageEdgeRow> = await data.reader.readEdges({
        direction: data.direction,
        dataAssetIds: frontier,
        limit: MAX_DATA_LINEAGE_EDGE_ROWS,
      });
      const next: Array<string> = [];
      // By pipeline sought: an arrow it moves data along, else a table it writes from outside.
      const arrows: Map<string, { near: string; far: string }> = new Map();
      const writers: Map<string, string> = new Map();

      for (const row of rows) {
        const near: string | null = isUpstream
          ? row.downstreamDataAssetId
          : row.upstreamDataAssetId;
        const far: string | null = isUpstream
          ? row.upstreamDataAssetId
          : row.downstreamDataAssetId;

        if (!near || !inFrontier.has(near)) {
          continue;
        }

        if (
          row.dataPipelineId &&
          data.targets.dataPipelineIds.has(row.dataPipelineId)
        ) {
          if (far && far !== near) {
            if (!arrows.has(row.dataPipelineId)) {
              arrows.set(row.dataPipelineId, { near, far });
            }
          } else if (!far && !writers.has(row.dataPipelineId)) {
            writers.set(row.dataPipelineId, near);
          }
        }

        if (!far || far === near || previous.has(far)) {
          continue;
        }

        previous.set(far, near);
        next.push(far);

        const key: string = getLineageTableNodeId(far);

        if (data.targets.dataAssetIds.has(far) && !ways.has(key)) {
          ways.set(key, {
            dataAssetIds: wayTo(far),
            end: DataLineageWayEnd.Table,
            dataPipelineId: null,
            viaDataAssetId: null,
          });
        }
      }

      for (const pipelineId of Array.from(data.targets.dataPipelineIds).sort(
        compareText,
      )) {
        const key: string = getLineagePipelineNodeId(pipelineId);

        if (ways.has(key)) {
          continue;
        }

        const arrow: { near: string; far: string } | undefined =
          arrows.get(pipelineId);

        if (arrow) {
          ways.set(key, {
            dataAssetIds: wayTo(arrow.near),
            end: DataLineageWayEnd.Arrow,
            dataPipelineId: pipelineId,
            viaDataAssetId: arrow.far,
          });
          continue;
        }

        const written: string | undefined = writers.get(pipelineId);

        if (written) {
          ways.set(key, {
            dataAssetIds: wayTo(written),
            end: DataLineageWayEnd.Writer,
            dataPipelineId: pipelineId,
            viaDataAssetId: null,
          });
        }
      }

      frontier = next;
    }

    return ways;
  }

  /*
   * What the drawing picks out: each way whose every card and arrow it
   * drew, with where it ends. A way it could not hold whole is left out:
   * half a way leads nowhere.
   */
  private static highlight(
    lineage: DataTableLineage,
    sought: Array<SoughtWay>,
  ): PickedWays {
    const drawnCards: Set<string> = new Set(
      lineage.nodes.map((node: DataTableLineageNode): string => {
        return node.id;
      }),
    );
    const arrowByEnds: Map<string, DataTableLineageEdge> = new Map();

    for (const edge of lineage.edges) {
      arrowByEnds.set(`${edge.source}>${edge.target}`, edge);
    }

    const nodeIds: Array<string> = [lineage.focusNodeId];
    const edgeIds: Set<string> = new Set();
    const causeNodeIds: Set<string> = new Set();
    const consequenceNodeIds: Set<string> = new Set();
    const dataPipelineIds: Set<string> = new Set();
    const causeDataPipelineIds: Set<string> = new Set();
    const causes: Set<string> = new Set();
    const consequences: Set<string> = new Set();

    for (const entry of sought) {
      const isUpstream: boolean =
        entry.direction === DataLineageDirection.Upstream;
      const cards: Array<string> = [
        lineage.focusNodeId,
        ...entry.way.dataAssetIds.map(getLineageTableNodeId),
      ];
      const arrows: Array<string> = [];
      let isWhole: boolean = true;

      for (let index: number = 1; index < cards.length; index++) {
        const near: string = cards[index - 1]!;
        const far: string = cards[index]!;
        const arrow: DataTableLineageEdge | undefined = arrowByEnds.get(
          isUpstream ? `${far}>${near}` : `${near}>${far}`,
        );

        if (!drawnCards.has(far) || !arrow) {
          isWhole = false;
          break;
        }

        arrows.push(arrow.id);
      }

      if (!isWhole) {
        continue;
      }

      const last: string = cards[cards.length - 1]!;
      let end: string | null = null;
      // An arrow's way: the table at each highlighted arrow's other end, so no highlighted arrow starts at a faint card.
      const arrowEnds: Array<string> = [];

      if (entry.way.end === DataLineageWayEnd.Table) {
        end = last;
      } else if (entry.way.end === DataLineageWayEnd.Writer) {
        const card: string = getLineagePipelineNodeId(
          entry.way.dataPipelineId || "",
        );
        const arrow: DataTableLineageEdge | undefined = arrowByEnds.get(
          `${card}>${last}`,
        );

        if (!drawnCards.has(card) || !arrow) {
          continue;
        }

        arrows.push(arrow.id);
        end = card;
      } else {
        // Every drawn arrow into (or out of) the last table that the pipeline moves data along.
        const carrying: Array<DataTableLineageEdge> = lineage.edges.filter(
          (edge: DataTableLineageEdge): boolean => {
            return (
              (isUpstream ? edge.target === last : edge.source === last) &&
              edge.pipelines.some(
                (pipeline: DataTableLineagePipeline): boolean => {
                  return pipeline.dataPipelineId === entry.way.dataPipelineId;
                },
              )
            );
          },
        );

        if (carrying.length === 0) {
          continue;
        }

        for (const edge of carrying) {
          arrows.push(edge.id);
          arrowEnds.push(isUpstream ? edge.source : edge.target);
        }

        dataPipelineIds.add(entry.way.dataPipelineId || "");

        // The cause's pipeline: its arrows say Cause, an alert it caused's do not.
        if (entry.isCause) {
          causeDataPipelineIds.add(entry.way.dataPipelineId || "");
        }
      }

      for (const card of [...cards, ...(end ? [end] : []), ...arrowEnds]) {
        if (!nodeIds.includes(card)) {
          nodeIds.push(card);
        }
      }

      if (end) {
        (entry.isCause ? causeNodeIds : consequenceNodeIds).add(end);
      }

      for (const id of arrows) {
        edgeIds.add(id);
      }

      (entry.isCause ? causes : consequences).add(entry.key);
    }

    if (causes.size + consequences.size === 0) {
      return { highlight: null, causes, consequences };
    }

    return {
      highlight: {
        nodeIds,
        edgeIds: Array.from(edgeIds).sort(compareText),
        causeNodeIds: Array.from(causeNodeIds).sort(compareText),
        consequenceNodeIds: Array.from(consequenceNodeIds).sort(compareText),
        dataPipelineIds: Array.from(dataPipelineIds).sort(compareText),
        causeDataPipelineIds:
          Array.from(causeDataPipelineIds).sort(compareText),
      },
      causes,
      consequences,
    };
  }

  /*
   * The project's own data alerts, as `reader` may see them: their own
   * clause on every read, as the data alerts' reads put it on a signed-in
   * reader; for nobody in particular, or a read as root, the clause of no
   * one - the alerts that are not private.
   */
  public static getDatabaseAlertReader(
    projectId: ObjectID,
    reader: DatabaseCommonInteractionProps | null,
  ): DataAlertRowReader {
    const privacyReader: DatabaseCommonInteractionProps =
      reader && !reader.isRoot ? reader : {};

    return {
      readAlert: async (
        alertId: string,
      ): Promise<DataAlertLineageRow | null> => {
        const row: DataAlert | null = await DataAlertService.findOneBy({
          // The alert and, when it has one, its cause: both theirs to see.
          query: DataAlertServiceType.applyPrivacyFilters<Query<DataAlert>>(
            { projectId, alertId: new ObjectID(alertId) },
            privacyReader,
          ),
          select: SELECT_ROW,
          props: { isRoot: true },
        });

        return row ? toAlertRow(row) : null;
      },

      readSubject: async (
        alertId: string,
      ): Promise<DataAlertLineageRow | null> => {
        const row: DataAlert | null = await DataAlertService.findOneBy({
          query: applyAlertRelatedRecordPrivacyFilter<Query<DataAlert>>(
            { projectId, alertId: new ObjectID(alertId) },
            privacyReader,
          ),
          select: SELECT_ROW,
          props: { isRoot: true },
        });

        return row ? toAlertRow(row) : null;
      },

      readConsequences: async (data: {
        alertId: string;
        limit: number;
      }): Promise<{ rows: Array<DataAlertLineageRow>; total: number }> => {
        const query: () => Query<DataAlert> = (): Query<DataAlert> => {
          return DataAlertServiceType.applyPrivacyFilters<Query<DataAlert>>(
            { projectId, causeAlertId: new ObjectID(data.alertId) },
            privacyReader,
          );
        };
        const rows: Array<DataAlert> = await DataAlertService.findBy({
          query: query(),
          select: SELECT_ROW,
          sort: { createdAt: SortOrder.Ascending },
          limit: data.limit,
          skip: 0,
          props: { isRoot: true },
        });
        const total: number =
          rows.length < data.limit
            ? rows.length
            : (
                await DataAlertService.countBy({
                  query: query(),
                  props: { isRoot: true },
                })
              ).toNumber();

        return { rows: rows.map(toAlertRow), total };
      },

      /*
       * The check whose monitor raised the alert (DataCheckAlerts keeps it
       * as DataCheck.monitorId), and the column it reads. Asked only once
       * readAlert found the alert theirs to see: what its check reads is
       * no more private than the drawing.
       */
      readCheckColumn: async (alertId: string): Promise<string | null> => {
        const alert: Alert | null = await AlertService.findOneBy({
          query: { projectId, _id: new ObjectID(alertId) },
          select: { monitorId: true },
          props: { isRoot: true },
        });

        if (!alert?.monitorId) {
          return null;
        }

        const check: DataCheck | null = await DataCheckService.findOneBy({
          query: { projectId, monitorId: alert.monitorId },
          select: { checkType: true, columnName: true },
          props: { isRoot: true },
        });

        return check ? getDataCheckColumn(check) : null;
      },
    };
  }
}
