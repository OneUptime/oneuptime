import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Creates the OpenTelemetry-entity registry (TelemetryEntity) and the
 * topology graph (TelemetryEntityRelationship), plus the TelemetryEntity
 * label join table. See Internal/Docs/OpenTelemetryEntities.md §Data Model
 * Changes (Postgres).
 *
 * NOTE: hand-written (the standard generate-postgres-migration flow needs a
 * live DB to diff against, which was unavailable). The DDL mirrors what the
 * TypeORM generator emits for these decorated entities (base columns,
 * indexes, FKs, the ManyToMany join table). Safe to regenerate against a
 * live DB later — the tables will already exist, so the generator is a
 * no-op for them.
 */
export class AddTelemetryEntityTables1780900000000
  implements MigrationInterface
{
  public name = "AddTelemetryEntityTables1780900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TelemetryEntity" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "entityType" character varying(100) NOT NULL, "entityKey" character varying(100) NOT NULL, "displayName" character varying(100), "identifyingAttributes" jsonb, "descriptiveAttributes" jsonb, "resourceType" character varying(100), "resourceId" uuid, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_telemetry_entity_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_telemetry_entity_project" ON "TelemetryEntity" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_telemetry_entity_type" ON "TelemetryEntity" ("entityType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_telemetry_entity_key" ON "TelemetryEntity" ("entityKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_telemetry_entity_resource" ON "TelemetryEntity" ("resourceId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_telemetry_entity_unique" ON "TelemetryEntity" ("projectId", "entityType", "entityKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "TelemetryEntityLabel" ("telemetryEntityId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_telemetry_entity_label" PRIMARY KEY ("telemetryEntityId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_telemetry_entity_label_entity" ON "TelemetryEntityLabel" ("telemetryEntityId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_telemetry_entity_label_label" ON "TelemetryEntityLabel" ("labelId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "TelemetryEntityRelationship" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "fromEntityKey" character varying(100) NOT NULL, "toEntityKey" character varying(100) NOT NULL, "relType" character varying(100) NOT NULL, "firstSeenAt" TIMESTAMP WITH TIME ZONE, "lastSeenAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_telemetry_entity_rel_id" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_telemetry_entity_rel_project" ON "TelemetryEntityRelationship" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_telemetry_entity_rel_from" ON "TelemetryEntityRelationship" ("fromEntityKey") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_telemetry_entity_rel_to" ON "TelemetryEntityRelationship" ("toEntityKey") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_telemetry_entity_rel_unique" ON "TelemetryEntityRelationship" ("projectId", "fromEntityKey", "toEntityKey", "relType") `,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" ADD CONSTRAINT "FK_telemetry_entity_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" ADD CONSTRAINT "FK_telemetry_entity_created_by" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" ADD CONSTRAINT "FK_telemetry_entity_deleted_by" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityLabel" ADD CONSTRAINT "FK_telemetry_entity_label_entity" FOREIGN KEY ("telemetryEntityId") REFERENCES "TelemetryEntity"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityLabel" ADD CONSTRAINT "FK_telemetry_entity_label_label" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" ADD CONSTRAINT "FK_telemetry_entity_rel_project" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" DROP CONSTRAINT "FK_telemetry_entity_rel_project"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityLabel" DROP CONSTRAINT "FK_telemetry_entity_label_label"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityLabel" DROP CONSTRAINT "FK_telemetry_entity_label_entity"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" DROP CONSTRAINT "FK_telemetry_entity_deleted_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" DROP CONSTRAINT "FK_telemetry_entity_created_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" DROP CONSTRAINT "FK_telemetry_entity_project"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_telemetry_entity_rel_unique"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_telemetry_entity_rel_to"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_telemetry_entity_rel_from"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_telemetry_entity_rel_project"`,
    );
    await queryRunner.query(`DROP TABLE "TelemetryEntityRelationship"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_telemetry_entity_label_label"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_telemetry_entity_label_entity"`,
    );
    await queryRunner.query(`DROP TABLE "TelemetryEntityLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_telemetry_entity_unique"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_telemetry_entity_resource"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_telemetry_entity_key"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_telemetry_entity_type"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_telemetry_entity_project"`,
    );
    await queryRunner.query(`DROP TABLE "TelemetryEntity"`);
  }
}
