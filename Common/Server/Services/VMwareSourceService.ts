import Model from "../../Models/DatabaseModels/VMwareSource";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import {
  VMwareSourceSnapshot,
  validateVMwareIdentifier,
} from "../Utils/Telemetry/VMwareSnapshot";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    validateVMwareIdentifier(createBy.data.sourceIdentifier);
    return { createBy, carryForward: null };
  }
  /*
   * One atomic operation per source/batch. The unique project/source key defuses
   * concurrent discovery; deleted sources cannot silently return through ingest.
   */
  public async ingestSnapshot(
    projectId: ObjectID,
    snapshot: VMwareSourceSnapshot,
  ): Promise<{ id: ObjectID; isArchived: boolean } | null> {
    validateVMwareIdentifier(snapshot.sourceIdentifier);
    /*
     * Equal-timestamp fragments belong to one collection. Merge them before
     * deciding success, because the exporter can split the two health gauges.
     */
    const collectionMetrics: string = `CASE WHEN EXCLUDED."lastCollectionAt" = "VMwareSource"."lastCollectionAt"
      THEN COALESCE("VMwareSource"."metrics", '{}'::jsonb) || EXCLUDED."metrics" ELSE EXCLUDED."metrics" END`;

    const rows: Array<{ _id: string; isArchived: boolean }> =
      await this.getRepository().manager.query(
        `
      INSERT INTO "VMwareSource" ("projectId", "sourceIdentifier", "name", "kind", "metrics", "lastSeenAt", "lastSuccessfulCollectionAt", "lastCollectionAt", "collectionIntervalSeconds", "version")
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, 0)
      ON CONFLICT ("projectId", "sourceIdentifier") DO UPDATE SET
        "kind" = CASE WHEN COALESCE(EXCLUDED."lastCollectionAt", EXCLUDED."lastSeenAt") >= COALESCE("VMwareSource"."lastCollectionAt", '-infinity')
          THEN COALESCE(EXCLUDED."kind", "VMwareSource"."kind") ELSE "VMwareSource"."kind" END,
        "metrics" = CASE WHEN EXCLUDED."lastCollectionAt" >= COALESCE("VMwareSource"."lastCollectionAt", '-infinity')
          THEN CASE WHEN EXCLUDED."lastCollectionAt" = "VMwareSource"."lastCollectionAt"
            THEN COALESCE("VMwareSource"."metrics", '{}'::jsonb) || EXCLUDED."metrics" ELSE EXCLUDED."metrics" END
          ELSE "VMwareSource"."metrics" END,
        "lastCollectionAt" = GREATEST("VMwareSource"."lastCollectionAt", EXCLUDED."lastCollectionAt"),
        "collectionIntervalSeconds" = CASE WHEN COALESCE(EXCLUDED."lastCollectionAt", EXCLUDED."lastSeenAt") >= COALESCE("VMwareSource"."lastCollectionAt", '-infinity')
          THEN COALESCE(EXCLUDED."collectionIntervalSeconds", "VMwareSource"."collectionIntervalSeconds") ELSE "VMwareSource"."collectionIntervalSeconds" END,
        "lastSeenAt" = GREATEST("VMwareSource"."lastSeenAt", EXCLUDED."lastSeenAt"),
        "lastSuccessfulCollectionAt" = GREATEST("VMwareSource"."lastSuccessfulCollectionAt", EXCLUDED."lastSuccessfulCollectionAt",
          CASE WHEN EXCLUDED."lastCollectionAt" >= COALESCE("VMwareSource"."lastCollectionAt", '-infinity')
            AND (${collectionMetrics})->>'oneuptime.vmware.source.up' = '1'
            AND (${collectionMetrics})->>'oneuptime.vmware.source.inventory.complete' = '1'
            THEN EXCLUDED."lastCollectionAt" ELSE NULL END)
      WHERE "VMwareSource"."deletedAt" IS NULL
      RETURNING "_id", "isArchived"
    `,
        [
          projectId.toString(),
          snapshot.sourceIdentifier,
          snapshot.name,
          snapshot.kind,
          JSON.stringify(snapshot.metrics),
          snapshot.lastSeenAt,
          snapshot.lastSuccessfulCollectionAt,
          snapshot.lastCollectionAt,
          snapshot.collectionIntervalSeconds,
        ],
      );
    return rows[0]
      ? { id: new ObjectID(rows[0]._id), isArchived: rows[0].isArchived }
      : null;
  }
}
export default new Service();
