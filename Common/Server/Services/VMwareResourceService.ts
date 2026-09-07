import Model from "../../Models/DatabaseModels/VMwareResource";
import ObjectID from "../../Types/ObjectID";
import DatabaseService from "./DatabaseService";
import {
  VMwareResourceSnapshot,
  validateVMwareIdentifier,
  VMWARE_RESOURCE_TYPES,
} from "../Utils/Telemetry/VMwareSnapshot";
import BadDataException from "../../Types/Exception/BadDataException";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }
  public async bulkUpsert(data: {
    projectId: ObjectID;
    sourceId: ObjectID;
    resources: Array<VMwareResourceSnapshot>;
  }): Promise<void> {
    /*
     * Validate the complete batch before writing any chunk. Never truncate keys:
     * two long VMware IDs must not collide and overwrite each other's policies.
     */
    const unique: Map<string, VMwareResourceSnapshot> = new Map();
    for (const resource of data.resources) {
      validateVMwareIdentifier(resource.resourceIdentifier);
      if (!VMWARE_RESOURCE_TYPES.includes(resource.resourceType)) {
        throw new BadDataException("Invalid VMware resource type.");
      }
      const key: string = JSON.stringify([
        resource.resourceType,
        resource.resourceIdentifier,
      ]);
      const previous: VMwareResourceSnapshot | undefined = unique.get(key);
      if (!previous || resource.lastReportedAt >= previous.lastReportedAt) {
        unique.set(key, resource);
      }
    }
    const resources: Array<VMwareResourceSnapshot> = [...unique.values()];
    for (let index: number = 0; index < resources.length; index += 250) {
      const params: Array<unknown> = [
        data.projectId.toString(),
        data.sourceId.toString(),
      ];
      const tuples: Array<string> = resources
        .slice(index, index + 250)
        .map((resource: VMwareResourceSnapshot): string => {
          const start: number = params.length + 1;
          params.push(
            resource.resourceType,
            resource.resourceIdentifier,
            resource.name,
            JSON.stringify(resource.metadata),
            JSON.stringify(resource.metrics),
            resource.lastSeenAt,
            resource.lastReportedAt,
          );
          return `($1::uuid, $2::uuid, $${start}, $${start + 1}, $${start + 2}, $${start + 3}::jsonb, $${start + 4}::jsonb, $${start + 5}::timestamptz, $${start + 6}::timestamptz, 0)`;
        });
      /*
       * The parent join enforces tenant equality even for internal/root callers.
       * User overrides and archive state are deliberately absent from the update.
       */
      await this.getRepository().manager.query(
        `
        INSERT INTO "VMwareResource" ("projectId", "sourceId", "resourceType", "resourceIdentifier", "name", "metadata", "metrics", "lastSeenAt", "lastReportedAt", "version")
        SELECT incoming.* FROM (VALUES ${tuples.join(", ")}) AS incoming("projectId", "sourceId", "resourceType", "resourceIdentifier", "name", "metadata", "metrics", "lastSeenAt", "lastReportedAt", "version")
        JOIN "VMwareSource" parent ON parent."_id" = incoming."sourceId" AND parent."projectId" = incoming."projectId"
          AND parent."deletedAt" IS NULL AND parent."isArchived" = false
        ON CONFLICT ("projectId", "sourceId", "resourceType", "resourceIdentifier") DO UPDATE SET
          "name" = CASE WHEN EXCLUDED."lastReportedAt" >= COALESCE("VMwareResource"."lastReportedAt", '-infinity') THEN EXCLUDED."name" ELSE "VMwareResource"."name" END,
          "metadata" = CASE WHEN EXCLUDED."lastReportedAt" >= COALESCE("VMwareResource"."lastReportedAt", '-infinity') THEN EXCLUDED."metadata" ELSE "VMwareResource"."metadata" END,
          "metrics" = CASE WHEN EXCLUDED."lastReportedAt" = "VMwareResource"."lastReportedAt"
            THEN COALESCE("VMwareResource"."metrics", '{}'::jsonb) || EXCLUDED."metrics"
            ELSE CASE WHEN EXCLUDED."lastReportedAt" > COALESCE("VMwareResource"."lastReportedAt", '-infinity')
              THEN EXCLUDED."metrics" ELSE "VMwareResource"."metrics" END END,
          "lastSeenAt" = GREATEST("VMwareResource"."lastSeenAt", EXCLUDED."lastSeenAt"),
          "lastReportedAt" = GREATEST("VMwareResource"."lastReportedAt", EXCLUDED."lastReportedAt")
        WHERE "VMwareResource"."deletedAt" IS NULL AND "VMwareResource"."isArchived" = false
      `,
        params,
      );
    }
  }
}
export default new Service();
