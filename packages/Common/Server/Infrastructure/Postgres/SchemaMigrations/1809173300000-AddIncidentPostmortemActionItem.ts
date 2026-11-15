import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration (issue #6801) for
 * IncidentPostmortemActionItem: a postmortem's action items, each with its
 * incident, its owner, its due date, its status, who closed it, and the code
 * task and monitor it became. A new table, empty when its indexes and keys
 * are built, so they need nothing online.
 */

export class AddIncidentPostmortemActionItem1809173300000
  implements MigrationInterface
{
  public name: string = "AddIncidentPostmortemActionItem1809173300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentPostmortemActionItem" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "incidentId" uuid NOT NULL, "title" character varying(500) NOT NULL, "description" text, "status" character varying(100) NOT NULL DEFAULT 'Open', "ownerUserId" uuid, "dueDate" TIMESTAMP WITH TIME ZONE, "closedAt" TIMESTAMP WITH TIME ZONE, "closedByUserId" uuid, "codeTaskId" uuid, "monitorId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_15ce0498d06a16b109b05d5dd1a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_108bc892d2286530777950f9b6" ON "IncidentPostmortemActionItem" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b1c3db1872450405237eb18097" ON "IncidentPostmortemActionItem" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_037b18899cdb0b81f1f640ecd7" ON "IncidentPostmortemActionItem" ("ownerUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd376a66270022ddc33ad679bc" ON "IncidentPostmortemActionItem" ("codeTaskId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_135972bfe2781eb800202a038e" ON "IncidentPostmortemActionItem" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b4aa6074287300c31590e2ae08" ON "IncidentPostmortemActionItem" ("projectId", "status", "dueDate") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_194eeb083be8c843702282ed02" ON "IncidentPostmortemActionItem" ("incidentId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" ADD CONSTRAINT "FK_108bc892d2286530777950f9b6a" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" ADD CONSTRAINT "FK_b1c3db1872450405237eb180972" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" ADD CONSTRAINT "FK_037b18899cdb0b81f1f640ecd72" FOREIGN KEY ("ownerUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" ADD CONSTRAINT "FK_d63e3f24d78c38ae3d4f0204394" FOREIGN KEY ("closedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" ADD CONSTRAINT "FK_135972bfe2781eb800202a038e0" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" ADD CONSTRAINT "FK_0828efb2d93e50cb42946c0b69b" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" ADD CONSTRAINT "FK_bbba6603e305832c2d7406f1485" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" DROP CONSTRAINT "FK_bbba6603e305832c2d7406f1485"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" DROP CONSTRAINT "FK_0828efb2d93e50cb42946c0b69b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" DROP CONSTRAINT "FK_135972bfe2781eb800202a038e0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" DROP CONSTRAINT "FK_d63e3f24d78c38ae3d4f0204394"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" DROP CONSTRAINT "FK_037b18899cdb0b81f1f640ecd72"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" DROP CONSTRAINT "FK_b1c3db1872450405237eb180972"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemActionItem" DROP CONSTRAINT "FK_108bc892d2286530777950f9b6a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_194eeb083be8c843702282ed02"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b4aa6074287300c31590e2ae08"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_135972bfe2781eb800202a038e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fd376a66270022ddc33ad679bc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_037b18899cdb0b81f1f640ecd7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b1c3db1872450405237eb18097"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_108bc892d2286530777950f9b6"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPostmortemActionItem"`);
  }
}
