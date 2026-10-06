import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/MetricType";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../Types/BaseDatabase/Query";
import Permission from "../../Types/Permission";
import PositiveNumber from "../../Types/PositiveNumber";
import Text from "../../Types/Text";
import AnalyticsModelPermission from "../Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../Types/BaseDatabase/DatabaseRequestType";
import CountBy from "../Types/Database/CountBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import QueryUtil from "../Types/Database/QueryUtil";
import UpdateBy from "../Types/Database/UpdateBy";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../Utils/Telemetry/TelemetryReadScope";
import { combineWithPrivacyClause } from "../Utils/PrivacyFilterUtil";
import { Raw } from "typeorm";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * THE METRIC CATALOGUE FOLLOWS THE SERVICES THAT REPORT IT.
   *
   * A metric type lists the services that report it (`services`). A caller
   * whose metric grant reaches only some resources - a label or Owned
   * grant, or a block with labels (TelemetryReadScope) - sees the metric
   * types at least one service they may read reports, so a team limited to
   * its own services is not shown the metric names of every other service.
   *
   * A metric type no service reports - host, cluster, device and monitor
   * metrics, whose producers are not services - stays listed: the catalogue
   * does not record which of those resources reports it, its name, unit and
   * description are definitions rather than data, and the values,
   * attributes and resources of every metric are read through the Metric
   * model and the /telemetry/metrics routes, which follow the same scope.
   *
   * Applied to reads, counts, updates and deletes alike, each with the
   * grants for its own operation: a catalogue entry the caller cannot see
   * is not one they can change either.
   */
  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<Model>,
  ): Promise<OnFind<Model>> {
    findBy.query = await this.addCatalogueScope(
      findBy.query,
      findBy.props,
      DatabaseRequestType.Read,
    );

    return { findBy, carryForward: null };
  }

  @CaptureSpan()
  public override async countBy(
    countBy: CountBy<Model>,
  ): Promise<PositiveNumber> {
    countBy.query = await this.addCatalogueScope(
      countBy.query,
      countBy.props,
      DatabaseRequestType.Read,
    );

    return super.countBy(countBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    updateBy.query = await this.addCatalogueScope(
      updateBy.query,
      updateBy.props,
      DatabaseRequestType.Update,
    );

    return super.onBeforeUpdate(updateBy);
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    deleteBy.query = await this.addCatalogueScope(
      deleteBy.query,
      deleteBy.props,
      DatabaseRequestType.Delete,
    );

    return { deleteBy, carryForward: null };
  }

  /*
   * Narrows a catalogue query to the metric types the caller's scope
   * reaches (see above). Left alone for root, master admins and callers
   * whose grant reaches every service with nothing blocked.
   */
  public async addCatalogueScope<TQuery>(
    query: TQuery,
    props: DatabaseCommonInteractionProps,
    operation: DatabaseRequestType,
  ): Promise<TQuery> {
    if (props.isRoot || props.isMasterAdmin || !props.tenantId) {
      return query;
    }

    const model: Model = new Model();
    const permissions: Array<Permission> =
      operation === DatabaseRequestType.Update
        ? model.updateRecordPermissions
        : operation === DatabaseRequestType.Delete
          ? model.deleteRecordPermissions
          : model.readRecordPermissions;

    const scope: TelemetryReadScope =
      await AnalyticsModelPermission.getReadScopeForPermissions({
        props: props,
        permissions: permissions,
        recordName: model.pluralName || "Metric Types",
        operation: operation,
      });

    const clause: FindWhereProperty<any> | null =
      this.getCatalogueScopeClause(scope);

    if (!clause) {
      return query;
    }

    const record: Record<string, unknown> = (query || {}) as Record<
      string,
      unknown
    >;

    const idQuery: Record<string, unknown> = QueryUtil.serializeQuery(Model, {
      _id: record["_id"],
    } as never) as Record<string, unknown>;

    record["_id"] = combineWithPrivacyClause(idQuery["_id"], clause);

    return record as unknown as TQuery;
  }

  /*
   * The condition on a metric type's id: no service reports it, or one the
   * scope reaches does. Null when the scope reaches every service.
   */
  public getCatalogueScopeClause(
    scope: TelemetryReadScope,
  ): FindWhereProperty<any> | null {
    if (TelemetryReadScopeUtil.isProjectWide(scope)) {
      return null;
    }

    const junction: {
      joinTableName: string;
      ownerColumnName: string;
      relationColumnName: string;
    } | null = QueryUtil.getManyToManyRelationMetadata(Model, "services");

    if (!junction) {
      throw new BadDataException(
        "Cannot apply the metric catalogue scope without the services relation metadata.",
      );
    }

    const joinTable: string = junction.joinTableName.replace(/"/g, '""');
    const metricTypeColumn: string = junction.ownerColumnName.replace(
      /"/g,
      '""',
    );
    const serviceColumn: string = junction.relationColumnName.replace(
      /"/g,
      '""',
    );

    const unreported: (alias: string) => string = (alias: string): string => {
      return `NOT EXISTS (SELECT 1 FROM "${joinTable}" WHERE "${joinTable}"."${metricTypeColumn}" = ${alias})`;
    };

    if (scope.readableIds !== null) {
      const readableIds: Array<string> =
        TelemetryReadScopeUtil.filterReadableIds(scope, scope.readableIds);

      if (readableIds.length === 0) {
        return Raw((alias: string): string => {
          return `(${unreported(alias)})`;
        });
      }

      const readableRid: string = "mtReadable_" + Text.generateRandomText(10);

      return Raw(
        (alias: string): string => {
          return `(${unreported(alias)} OR EXISTS (SELECT 1 FROM "${joinTable}" WHERE "${joinTable}"."${metricTypeColumn}" = ${alias} AND "${joinTable}"."${serviceColumn}" IN (:...${readableRid})))`;
        },
        { [readableRid]: readableIds },
      );
    }

    const blockedRid: string = "mtBlocked_" + Text.generateRandomText(10);

    return Raw(
      (alias: string): string => {
        return `(${unreported(alias)} OR EXISTS (SELECT 1 FROM "${joinTable}" WHERE "${joinTable}"."${metricTypeColumn}" = ${alias} AND "${joinTable}"."${serviceColumn}" NOT IN (:...${blockedRid})))`;
      },
      { [blockedRid]: [...scope.blockedIds] },
    );
  }

  /*
   * Additively associate services with a metric type, in ONE statement.
   *
   * This replaces routing the association through `updateOneById` with the
   * whole `services` array in the payload. That looked innocuous and was not:
   * `services` is a `TableColumnType.EntityArray`, and its mere PRESENCE as a
   * key flips `hasRelationUpdates` in DatabaseService, which routes the write
   * to `getRepository().save()` — a real BEGIN/COMMIT that reloads the entity,
   * loads the relation ids, bumps `version`, and DELETEs then re-INSERTs
   * junction rows, holding the MetricType row's write lock across every one of
   * those round trips. On the ingest path, where this runs per metric name per
   * batch with no backpressure, it was the only multi-round-trip lock hold in
   * the pipeline.
   *
   * The whole-array write was also silently LOSING data. `save()` diffs the
   * array it is given against what is currently in the database and deletes
   * anything missing — but each ingest worker only knows the services in ITS
   * batch. Two workers with different batches therefore deleted each other's
   * associations and re-inserted them on the next batch: permanent junction
   * churn, and real service-to-metric links disappearing from the UI in
   * between. Additive insert makes that impossible to express.
   *
   * ON CONFLICT DO NOTHING is well-defined here: the junction's primary key is
   * exactly (metricTypeId, serviceId), so a concurrent writer adding the same
   * association is a no-op rather than a unique violation.
   */
  @CaptureSpan()
  public async attachServices(data: {
    metricTypeId: ObjectID;
    serviceIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.metricTypeId) {
      throw new BadDataException("metricTypeId is required");
    }

    if (!data.serviceIds || data.serviceIds.length === 0) {
      return;
    }

    /*
     * Identifiers come from entity metadata, never from the caller, and every
     * value is bound as a parameter — the same rule the other raw-SQL paths in
     * DatabaseService follow.
     */
    const relation: RelationMetadata | undefined =
      this.getRepository().metadata.findRelationWithPropertyPath("services");

    const junction: string | undefined =
      relation?.junctionEntityMetadata?.tableName;
    const metricTypeColumn: string | undefined =
      relation?.junctionEntityMetadata?.columns[0]?.databaseName;
    const serviceColumn: string | undefined =
      relation?.junctionEntityMetadata?.columns[1]?.databaseName;

    if (!junction || !metricTypeColumn || !serviceColumn) {
      throw new BadDataException(
        "MetricTypeService.attachServices: the services relation has no junction metadata",
      );
    }

    /*
     * Deduplicate and SORT. Concurrent statements that insert overlapping sets
     * acquire their row locks in the same order this way, which is what keeps
     * two workers associating the same services from deadlocking each other.
     */
    const serviceIds: Array<string> = Array.from(
      new Set(
        data.serviceIds.map((id: ObjectID) => {
          return id.toString();
        }),
      ),
    ).sort();

    await this.getRepository().manager.query(
      `INSERT INTO "${junction}" ("${metricTypeColumn}", "${serviceColumn}") ` +
        `SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [data.metricTypeId.toString(), serviceIds],
    );
  }
}

export default new Service();
