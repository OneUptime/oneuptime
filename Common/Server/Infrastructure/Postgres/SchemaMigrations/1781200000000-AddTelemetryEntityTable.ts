import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Phase 2 of the OpenTelemetry entity model
 * (Internal/Docs/OpenTelemetryEntities.md): the generalized, polymorphic
 * `TelemetryEntity` registry. One row per (projectId, entityType,
 * entityKey) — a service / host / k8s.pod / container / ... discovered from
 * telemetry resource attributes and reconciled forward-only (no backfill)
 * at ingest. The unique (projectId, entityType, entityKey) index is the
 * upsert conflict target for the throttled ingest reconciler.
 */
export class AddTelemetryEntityTable1781200000000
  implements MigrationInterface
{
  public name = "AddTelemetryEntityTable1781200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TelemetryEntity" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "entityType" character varying(100) NOT NULL, "entityKey" character varying(100) NOT NULL, "displayName" character varying(100), "identifyingAttributes" jsonb, "descriptiveAttributes" jsonb, "resourceType" character varying(100), "resourceId" uuid, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_TelemetryEntity" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelemetryEntity_projectId" ON "TelemetryEntity" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelemetryEntity_proj_type" ON "TelemetryEntity" ("projectId", "entityType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelemetryEntity_proj_resource" ON "TelemetryEntity" ("projectId", "resourceType", "resourceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelemetryEntity_lastSeenAt" ON "TelemetryEntity" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_TelemetryEntity_proj_type_key" ON "TelemetryEntity" ("projectId", "entityType", "entityKey") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."UQ_TelemetryEntity_proj_type_key"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_TelemetryEntity_lastSeenAt"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_TelemetryEntity_proj_resource"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_TelemetryEntity_proj_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_TelemetryEntity_projectId"`,
    );
    await queryRunner.query(`DROP TABLE "TelemetryEntity"`);
  }
}
