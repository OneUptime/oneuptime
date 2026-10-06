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
import PerProjectReadScope from "../Utils/Telemetry/PerProjectReadScope";
import { Raw } from "typeorm";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * THE METRIC CATALOGUE FOLLOWS THE SERVICES THAT REPORT IT.
   *
   * A metric type lists the services that report it (`services`), and only
   * those: it does not record which hosts, clusters, devices or monitors
   * report it. So the catalogue narrows what it can tell apart:
   *
   *   - A caller whose metric grant reaches services alone - a label or
   *     Owned grant that reaches no other kind of resource
   *     (TelemetryReadScope) - sees the metric types a service they may
   *     read reports, and the ones no service reports. A team limited to
   *     its own services is not shown the metric names of every other one.
   *   - A caller who may read the metrics of any other kind of resource, or
   *     of the whole project, sees every metric type: any of those
   *     resources may report any of them, and hiding one would hide a
   *     metric they may chart.
   *
   * Either way the values, attributes and resources of every metric are
   * read through the Metric model and the /telemetry/metrics routes, which
   * follow the caller's scope; a metric type's name, unit and description
   * are definitions rather than data.
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
    await super.onBeforeUpdate(updateBy);

    updateBy.query = await this.addCatalogueScope(
      updateBy.query,
      updateBy.props,
      DatabaseRequestType.Update,
    );

    return { updateBy, carryForward: null };
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
    if (props.isRoot || props.isMasterAdmin) {
      return query;
    }

    /*
     * A read across the caller's projects follows the caller's scope in each
     * project on its own (PerProjectReadScope).
     */
    const clause: FindWhereProperty<any> | null =
      PerProjectReadScope.isAcrossProjects(props)
        ? await PerProjectReadScope.getClauseAcrossProjects({
            props: props,
            tableName: new Model().tableName || "MetricType",
            getClauseInProject: (
              projectProps: DatabaseCommonInteractionProps,
            ): Promise<FindWhereProperty<any> | null> => {
              return this.getCatalogueScopeClauseInProject(
                projectProps,
                operation,
              );
            },
          })
        : await this.getCatalogueScopeClauseInProject(props, operation);

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
   * The catalogue condition in the caller's project (props.tenantId) for an
   * operation, or null when the caller sees every metric type (see above).
   */
  private async getCatalogueScopeClauseInProject(
    props: DatabaseCommonInteractionProps,
    operation: DatabaseRequestType,
  ): Promise<FindWhereProperty<any> | null> {
    const otherResourceTypes: Array<string> =
      AnalyticsModelPermission.getTelemetryResourceTypes().filter(
        (resourceType: string): boolean => {
          return resourceType !== "Service";
        },
      );

    const [serviceScope, otherScope]: [TelemetryReadScope, TelemetryReadScope] =
      await Promise.all([
        this.getCatalogueScope(props, operation, ["Service"]),
        this.getCatalogueScope(props, operation, otherResourceTypes),
      ]);

    /*
     * The metrics of some other kind of resource (or of every resource)
     * are readable: the catalogue cannot tell which metric types those
     * report, so it shows them all.
     */
    const otherReadableIds: Array<string> | null =
      TelemetryReadScopeUtil.getReadableIds(otherScope);

    if (otherReadableIds === null || otherReadableIds.length > 0) {
      return null;
    }

    return this.getCatalogueScopeClause(serviceScope);
  }

  /*
   * The caller's scope in their project (props.tenantId) for an operation,
   * over the resource types named.
   */
  private async getCatalogueScope(
    props: DatabaseCommonInteractionProps,
    operation: DatabaseRequestType,
    resourceTypes: ReadonlyArray<string>,
  ): Promise<TelemetryReadScope> {
    const model: Model = new Model();
    const permissions: Array<Permission> =
      operation === DatabaseRequestType.Update
        ? model.updateRecordPermissions
        : operation === DatabaseRequestType.Delete
          ? model.deleteRecordPermissions
          : model.readRecordPermissions;

    return await AnalyticsModelPermission.getReadScopeForPermissions({
      props: props,
      permissions: permissions,
      resourceTypes: resourceTypes,
      recordName: model.pluralName || "Metric Types",
      operation: operation,
    });
  }

  /*
   * The condition on a metric type's id for a caller limited to some
   * services: no service reports it, or one the scope reaches does. Null
   * for a scope that is not limited to a list of services - a grant over
   * the whole project reads every metric type, blocks with labels or not,
   * as the catalogue cannot tell which hosts, clusters or devices report a
   * metric type (getCatalogueScopeClauseInProject).
   */
  public getCatalogueScopeClause(
    scope: TelemetryReadScope,
  ): FindWhereProperty<any> | null {
    const readableIds: Array<string> | null =
      TelemetryReadScopeUtil.getReadableIds(scope);

    if (readableIds === null) {
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
