import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/MetricType";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
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
