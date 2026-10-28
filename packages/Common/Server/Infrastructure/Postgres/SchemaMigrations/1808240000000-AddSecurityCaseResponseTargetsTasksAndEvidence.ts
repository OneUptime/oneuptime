import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * A security case's response targets, tasks and evidence
 * (Common/Utils/SecurityCase/SecurityCaseTargets):
 *
 *   - "SecurityCasePriority" gains "acknowledgeWithinInMinutes" and
 *     "containWithinInMinutes": how fast a case at the priority must be taken
 *     on and contained. Empty on every existing priority, so nothing changes
 *     for a project until someone sets them; a new project's built-in
 *     priorities start with targets (DEFAULT_SECURITY_CASE_PRIORITIES).
 *   - "SecurityCase" gains its due times ("acknowledgeDueAt",
 *     "containDueAt"), when OneUptime warned about and recorded a missed
 *     target, the next due time the lists sort by ("nextDueAt") and when the
 *     every-minute check looks next ("nextTargetCheckAt"). Empty on every
 *     existing case: the targets apply to cases from now on. Its index on
 *     "nextTargetCheckAt" is built online, in
 *     AddSecurityCaseNextTargetCheckIndex1808250000000.
 *   - "SecurityCaseTask": what has to be done on a case, who does it, and
 *     whether it is done.
 *   - "SecurityCaseEvidence": files and links kept on a case, a file with its
 *     size, type and SHA-256.
 *
 * The two tables are new and empty, so their indexes and foreign keys are
 * built here. The new columns of the two existing tables are nullable with no
 * default: adding them does not rewrite either table.
 */
export class AddSecurityCaseResponseTargetsTasksAndEvidence1808240000000
  implements MigrationInterface
{
  public name: string =
    "AddSecurityCaseResponseTargetsTasksAndEvidence1808240000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityCaseTask" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "securityCaseId" uuid NOT NULL, "title" character varying(500) NOT NULL, "assignedToUserId" uuid, "isDone" boolean NOT NULL DEFAULT false, "doneAt" TIMESTAMP WITH TIME ZONE, "doneByUserId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_ca0f7b7daf4f2d42b3d69731f36" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_560bafc2396dd4155c2ec5138a" ON "SecurityCaseTask" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3121fc1c68842c4a441afdeed7" ON "SecurityCaseTask" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6068551e30057e70b20e90f8a5" ON "SecurityCaseTask" ("assignedToUserId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d527037580b6949e45b5addb97" ON "SecurityCaseTask" ("securityCaseId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityCaseEvidence" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "securityCaseId" uuid NOT NULL, "kind" character varying(100) NOT NULL, "name" character varying(500) NOT NULL, "description" text, "fileId" uuid, "url" text, "fileName" character varying(100), "fileType" character varying(100), "fileSizeInBytes" integer, "sha256" character varying(100), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_23260d6e11a3f711fb010b2f61e" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9b85dadc277d94b41126feea75" ON "SecurityCaseEvidence" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9ab9491b47f5670e412bda3bf7" ON "SecurityCaseEvidence" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_67990f728da2d8b9297d430636" ON "SecurityCaseEvidence" ("securityCaseId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" ADD "acknowledgeWithinInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" ADD "containWithinInMinutes" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "acknowledgeDueAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "containDueAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "acknowledgeWarnedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "acknowledgeMissedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "containWarnedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "containMissedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "nextDueAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "nextTargetCheckAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" ADD CONSTRAINT "FK_560bafc2396dd4155c2ec5138af" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" ADD CONSTRAINT "FK_3121fc1c68842c4a441afdeed7c" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" ADD CONSTRAINT "FK_6068551e30057e70b20e90f8a50" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" ADD CONSTRAINT "FK_a1cc24c6c7ff3e98aa45985147e" FOREIGN KEY ("doneByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" ADD CONSTRAINT "FK_87481440121b94dccf51794a47e" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" ADD CONSTRAINT "FK_86a5069de9b8174db621d62c9d3" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" ADD CONSTRAINT "FK_9b85dadc277d94b41126feea756" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" ADD CONSTRAINT "FK_9ab9491b47f5670e412bda3bf77" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" ADD CONSTRAINT "FK_0e621e4045d7aa3b47c4bd8312b" FOREIGN KEY ("fileId") REFERENCES "File"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" ADD CONSTRAINT "FK_ced3224f5866956aa884eddc072" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" ADD CONSTRAINT "FK_fa8da65136bffcab040fd9c0f47" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" DROP CONSTRAINT "FK_fa8da65136bffcab040fd9c0f47"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" DROP CONSTRAINT "FK_ced3224f5866956aa884eddc072"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" DROP CONSTRAINT "FK_0e621e4045d7aa3b47c4bd8312b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" DROP CONSTRAINT "FK_9ab9491b47f5670e412bda3bf77"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" DROP CONSTRAINT "FK_9b85dadc277d94b41126feea756"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" DROP CONSTRAINT "FK_86a5069de9b8174db621d62c9d3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" DROP CONSTRAINT "FK_87481440121b94dccf51794a47e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" DROP CONSTRAINT "FK_a1cc24c6c7ff3e98aa45985147e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" DROP CONSTRAINT "FK_6068551e30057e70b20e90f8a50"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" DROP CONSTRAINT "FK_3121fc1c68842c4a441afdeed7c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" DROP CONSTRAINT "FK_560bafc2396dd4155c2ec5138af"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "nextTargetCheckAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "nextDueAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "containMissedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "containWarnedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "acknowledgeMissedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "acknowledgeWarnedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "containDueAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "acknowledgeDueAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" DROP COLUMN "containWithinInMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCasePriority" DROP COLUMN "acknowledgeWithinInMinutes"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_67990f728da2d8b9297d430636"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9ab9491b47f5670e412bda3bf7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9b85dadc277d94b41126feea75"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCaseEvidence"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d527037580b6949e45b5addb97"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6068551e30057e70b20e90f8a5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3121fc1c68842c4a441afdeed7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_560bafc2396dd4155c2ec5138a"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCaseTask"`);
  }
}
