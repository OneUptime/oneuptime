import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Runbook variables (RunbookVariable): values runbook steps name as
 * {{global.variables.NAME}} or {{local.variables.NAME}}, plain or secret,
 * the project's own or one runbook's, and the Runners a secret reaches
 * (RunbookVariableRunner). They take the place of runbook secrets and of the
 * credentials runbook steps used; the Workers' data migration
 * MoveRunbookSecretsAndCredentialsToVariables copies those over and rewrites
 * the steps, and leaves the old tables as they are.
 *
 * Two new tables: every index is built and every foreign key checked on an
 * empty table, so no existing table is scanned.
 */
export class AddRunbookVariable1804200000000 implements MigrationInterface {
  public name: string = "AddRunbookVariable1804200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RunbookVariable" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "runbookId" uuid, "name" character varying(100) NOT NULL, "description" character varying(500), "isSecret" boolean NOT NULL DEFAULT false, "value" text, "secretValue" text, "isAvailableToGlobalRunners" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_510e16a81fb2d5658fe2ed8ce6c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8317da94785de787ce004a0f16" ON "RunbookVariable" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_501810d15edfa564181070ba61" ON "RunbookVariable" ("runbookId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookVariableRunner" ("runbookVariableId" uuid NOT NULL, "runnerId" uuid NOT NULL, CONSTRAINT "PK_4c2e964d7b1f271b289af9b6b30" PRIMARY KEY ("runbookVariableId", "runnerId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0868a768d1aa6c22caccc93ef8" ON "RunbookVariableRunner" ("runbookVariableId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_addd5a3968c71e3a3b090ade5c" ON "RunbookVariableRunner" ("runnerId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookVariable" ADD CONSTRAINT "FK_8317da94785de787ce004a0f16b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookVariable" ADD CONSTRAINT "FK_501810d15edfa564181070ba615" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookVariable" ADD CONSTRAINT "FK_5714b929bc202c2a52ee52f558d" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookVariable" ADD CONSTRAINT "FK_6bc1cbb3031621f088fbc475af9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookVariableRunner" ADD CONSTRAINT "FK_0868a768d1aa6c22caccc93ef87" FOREIGN KEY ("runbookVariableId") REFERENCES "RunbookVariable"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookVariableRunner" ADD CONSTRAINT "FK_addd5a3968c71e3a3b090ade5ce" FOREIGN KEY ("runnerId") REFERENCES "Runner"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookVariableRunner" DROP CONSTRAINT "FK_addd5a3968c71e3a3b090ade5ce"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookVariableRunner" DROP CONSTRAINT "FK_0868a768d1aa6c22caccc93ef87"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookVariable" DROP CONSTRAINT "FK_6bc1cbb3031621f088fbc475af9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookVariable" DROP CONSTRAINT "FK_5714b929bc202c2a52ee52f558d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookVariable" DROP CONSTRAINT "FK_501810d15edfa564181070ba615"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookVariable" DROP CONSTRAINT "FK_8317da94785de787ce004a0f16b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_addd5a3968c71e3a3b090ade5c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0868a768d1aa6c22caccc93ef8"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookVariableRunner"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_501810d15edfa564181070ba61"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8317da94785de787ce004a0f16"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookVariable"`);
  }
}
