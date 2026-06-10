import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Phase 5 of the OpenTelemetry entity model
 * (Internal/Docs/OpenTelemetryEntities.md §4): the `TelemetryEntityRelationship`
 * topology graph. One row per directed co-occurrence edge
 * (projectId, fromEntityKey, toEntityKey, relationshipType) — "pod runs-on
 * node", "service hosted-on host", etc. Reconciled forward-only (no backfill)
 * at ingest; the unique index is the upsert conflict target.
 */
export class AddTelemetryEntityRelationshipTable1781200000001
  implements MigrationInterface
{
  public name = "AddTelemetryEntityRelationshipTable1781200000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TelemetryEntityRelationship" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "fromEntityKey" character varying(100) NOT NULL, "toEntityKey" character varying(100) NOT NULL, "relationshipType" character varying(100) NOT NULL, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_TelemetryEntityRelationship" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelEntityRel_projectId" ON "TelemetryEntityRelationship" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelEntityRel_proj_from" ON "TelemetryEntityRelationship" ("projectId", "fromEntityKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelEntityRel_proj_to" ON "TelemetryEntityRelationship" ("projectId", "toEntityKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_TelEntityRel_lastSeenAt" ON "TelemetryEntityRelationship" ("lastSeenAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_TelEntityRel_edge" ON "TelemetryEntityRelationship" ("projectId", "fromEntityKey", "toEntityKey", "relationshipType") `,
    );

    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" ADD CONSTRAINT "FK_TelEntityRel_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" ADD CONSTRAINT "FK_TelEntityRel_createdBy" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" ADD CONSTRAINT "FK_TelEntityRel_deletedBy" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_TelEntityRel_edge"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_TelEntityRel_lastSeenAt"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_TelEntityRel_proj_to"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_TelEntityRel_proj_from"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_TelEntityRel_projectId"`);
    await queryRunner.query(`DROP TABLE "TelemetryEntityRelationship"`);
  }
}
