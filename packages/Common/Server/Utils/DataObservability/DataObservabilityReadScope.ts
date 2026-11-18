import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataCheck from "../../../Models/DatabaseModels/DataCheck";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OwnedBy, { OwnedByMatch } from "../../../Types/BaseDatabase/OwnedBy";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import ObjectID from "../../../Types/ObjectID";
import DataAssetService from "../../Services/DataAssetService";
import DataCheckService from "../../Services/DataCheckService";
import DatabaseService from "../../Services/DatabaseService";
import OwnedByFilter from "../../Types/Database/OwnedByFilter";
import ModelPermission from "../../Types/Database/Permissions/Index";
import { CheckReadPermissionType } from "../../Types/Database/Permissions/ReadPermission";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import { combineWithPrivacyClause } from "../PrivacyFilterUtil";

/*
 * WHAT A CALLER MAY READ, FOR DATA OBSERVABILITY'S OWN ROUTES (#6553).
 *
 * A role can be limited to what its members own, or to records with some
 * labels, and a team can be blocked from records with others. The generic
 * list and read routes narrow every read by the caller's grants
 * (DatabaseService, OwnedScopePermission); Data Observability's own routes
 * read as OneUptime, for the names, states and times only they hand back,
 * and now narrow the same way: the read-permission pipeline works out the
 * caller's query for a model - the project, and whatever their grants add
 * - and the route reads with it, as OneUptime (the way ProxmoxResourceAPI
 * scopes a lookup with the update pipeline, and NetworkSummaryCache reads a
 * caller's scope with the read one). A caller the pipeline narrows nothing
 * for reads exactly what the routes read before.
 *
 *   - tables (DataAsset): owners and labels of their own;
 *   - checks (DataCheck): through their table (@OwnedThrough);
 *   - pipelines (DataPipeline): owners of their own (#6551).
 *
 * A database is Data Security's record, which the readers of table health
 * may not read: its name, kind and how its last collection went are shown
 * to a narrowed caller for the databases holding a table they may read.
 * Data products and reconciliations have no owners or labels, so every
 * reader of them reads all of them, here as on their lists.
 *
 * What OneUptime writes where many people read it - an investigation's
 * report, in its alert's feed and channels - reads as nobody in
 * particular (nobodyInParticular, #9562): only the tables and pipelines
 * no owner or label sets apart.
 */

// The name of the table every table's labels are kept in.
const TABLE_LABELS_JOIN_TABLE: string = "DataAssetLabel";

export interface DataObservabilityScope {
  // Whether the caller's grants narrow none of these reads: they read the whole project.
  isWholeProject: boolean;
  assetQuery: Query<DataAsset>;
  checkQuery: Query<DataCheck>;
  pipelineQuery: Query<DataPipeline>;
}

/*
 * A caller's read with conditions of a route's own added - AND-ed with any
 * the caller's grants put on the same column, never in their place: the
 * Owned scope narrows a table's reads by its id, and a route asking for some
 * ids must not widen that to them.
 */
export function withConditions<TBaseModel extends BaseModel>(
  query: Query<TBaseModel>,
  conditions: Query<TBaseModel>,
): Query<TBaseModel> {
  const combined: Record<string, unknown> = {
    ...(query as unknown as Record<string, unknown>),
  };

  for (const [column, condition] of Object.entries(
    conditions as unknown as Record<string, unknown>,
  )) {
    combined[column] = Object.prototype.hasOwnProperty.call(combined, column)
      ? combineWithPrivacyClause(combined[column], condition as never)
      : condition;
  }

  return combined as unknown as Query<TBaseModel>;
}

// A read the pipeline narrowed to nothing but the project: the whole project's.
export function isWholeProjectQuery(query: unknown): boolean {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return false;
  }

  const keys: Array<string> = Object.keys(query as Record<string, unknown>);

  return keys.length === 1 && keys[0] === "projectId";
}

// OneUptime's own read, or a read no person or key asked for: nothing to narrow.
export function readsAsOneUptime(
  props: DatabaseCommonInteractionProps | undefined | null,
): boolean {
  return (
    !props ||
    Boolean(props.isRoot) ||
    Boolean(props.isMasterAdmin) ||
    (!props.userId && !props.apiKeyId && !props.userTenantAccessPermission)
  );
}

export default class DataObservabilityReadScope {
  // The whole project's reads: what OneUptime's own work, and an unnarrowed caller, read.
  public static wholeProject(projectId: ObjectID): DataObservabilityScope {
    return {
      isWholeProject: true,
      assetQuery: { projectId },
      checkQuery: { projectId },
      pipelineQuery: { projectId },
    };
  }

  /*
   * WHAT NOBODY IN PARTICULAR MAY READ (#9562): the tables and pipelines
   * nobody has set apart.
   *
   * Owners and labels are how a project sets a table or pipeline apart: a
   * role limited to what its members own, or to some labels, reads only
   * what is set apart for it, and a team blocked from a label never reads
   * what carries it. A report OneUptime writes for everyone who may see an
   * alert - an investigation's, in the alert's feed and in the Slack and
   * Microsoft Teams channels it is posted to - is read by all of them at
   * once, so it reads none of those:
   *
   *   - tables with no owner, person or team, and no label;
   *   - pipelines with no owner (a pipeline has no labels);
   *   - the checks of those tables.
   *
   * The alert names its own table or pipeline, which all its readers read
   * on it already: a reader of its lineage adds those (withNamedReadable).
   * A project that sets no table or pipeline apart reads every one of
   * them, as before.
   */
  public static nobodyInParticular(
    projectId: ObjectID,
  ): DataObservabilityScope {
    const unownedPipeline: FindWhereProperty<any> =
      OwnedByFilter.getIdCondition(
        DataPipeline,
        new OwnedBy({ match: OwnedByMatch.NoOwner }),
      ) as FindWhereProperty<any>;
    const unmarkedTable: FindWhereProperty<any> = QueryHelper.allOfConditions([
      {
        condition: OwnedByFilter.getIdCondition(
          DataAsset,
          new OwnedBy({ match: OwnedByMatch.NoOwner }),
        ),
      },
      {
        condition: QueryHelper.noEntitiesInManyToMany({
          joinTableName: TABLE_LABELS_JOIN_TABLE,
          ownerColumnName: "dataAssetId",
        }),
      },
    ]);

    return {
      isWholeProject: false,
      assetQuery: { projectId, _id: unmarkedTable },
      checkQuery: {
        projectId,
        dataAssetId: QueryHelper.inRecordsWhere({
          tableName: new DataAsset().tableName || "DataAsset",
          condition: unmarkedTable,
        }),
      },
      pipelineQuery: { projectId, _id: unownedPipeline },
    };
  }

  /*
   * The caller's reads of tables, checks and pipelines in the project, as
   * the read-permission pipeline narrows them. Throws what it throws for a
   * caller who may not read one of them at all.
   */
  public static async get(
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps | undefined | null,
  ): Promise<DataObservabilityScope> {
    if (readsAsOneUptime(props)) {
      return this.wholeProject(projectId);
    }

    const [assetQuery, checkQuery, pipelineQuery]: [
      Query<DataAsset>,
      Query<DataCheck>,
      Query<DataPipeline>,
    ] = await Promise.all([
      this.narrow(DataAsset, projectId, props!),
      this.narrow(DataCheck, projectId, props!),
      this.narrow(DataPipeline, projectId, props!),
    ]);

    return {
      isWholeProject:
        isWholeProjectQuery(assetQuery) &&
        isWholeProjectQuery(checkQuery) &&
        isWholeProjectQuery(pipelineQuery),
      assetQuery,
      checkQuery,
      pipelineQuery,
    };
  }

  // The caller's read of one model in the project, as the pipeline narrows it.
  public static async narrow<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    projectId: ObjectID,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    const checked: CheckReadPermissionType<TBaseModel> =
      await ModelPermission.checkReadQueryPermission(
        modelType,
        { projectId } as Query<TBaseModel>,
        null,
        props,
      );

    return (checked.query || { projectId }) as Query<TBaseModel>;
  }

  /*
   * Of these records, the ones the caller may read: their ids. A record of
   * another project, or one their grants do not reach, is left out.
   */
  public static async getReadableIds<TBaseModel extends BaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    query: Query<TBaseModel>;
    ids: Array<string>;
  }): Promise<Set<string>> {
    if (data.ids.length === 0) {
      return new Set();
    }

    const rows: Array<TBaseModel> = await data.service.findBy({
      query: withConditions<TBaseModel>(data.query, {
        _id: QueryHelper.any(data.ids),
      } as Query<TBaseModel>),
      select: { _id: true } as never,
      skip: 0,
      limit: data.ids.length,
      props: { isRoot: true },
    });

    return new Set(
      rows.map((row: TBaseModel): string => {
        return row.id?.toString() || "";
      }),
    );
  }

  // Whether the caller may read this table: a route about one table answers only then.
  public static async canReadTable(data: {
    projectId: ObjectID;
    dataAssetId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    if (readsAsOneUptime(data.props)) {
      return true;
    }

    const query: Query<DataAsset> = await this.narrow(
      DataAsset,
      data.projectId,
      data.props,
    );

    return (
      await this.getReadableIds({
        service: DataAssetService,
        query,
        ids: [data.dataAssetId.toString()],
      })
    ).has(data.dataAssetId.toString());
  }

  /*
   * Whether the caller may change this check, as a change of it through its
   * own route would be narrowed: an action on one check (Run Now, its alert)
   * is taken only then.
   */
  public static async canChangeCheck(data: {
    projectId: ObjectID;
    dataCheckId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    if (readsAsOneUptime(data.props)) {
      return true;
    }

    const query: Query<DataCheck> =
      await ModelPermission.checkUpdateQueryPermissions(
        DataCheck,
        { _id: data.dataCheckId, projectId: data.projectId },
        {},
        data.props,
      );

    return (
      await this.getReadableIds({
        service: DataCheckService,
        query,
        ids: [data.dataCheckId.toString()],
      })
    ).has(data.dataCheckId.toString());
  }
}
