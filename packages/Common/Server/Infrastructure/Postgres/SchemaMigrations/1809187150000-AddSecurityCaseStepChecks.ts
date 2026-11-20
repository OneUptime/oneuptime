import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * OneUptime checks the steps of a security case's Response Plan itself
 * (#10340, Server/Utils/SecurityCase/StepChecks):
 *
 *   - "SecurityCaseStepCheck": what OneUptime found of each step of a case,
 *     one row a step ("securityCaseId", "stepKey" unique), its state, its
 *     evidence, and when it was checked, since when it has been so and when
 *     it is checked next.
 *   - "SecurityCase" gains "nextStepCheckAt": when the every-minute check
 *     next reads the case. Empty on every existing case until the data
 *     migration BackfillSecurityCaseNextStepCheckAt sets it on the open
 *     ones. Its index is built online, in
 *     AddSecurityCaseNextStepCheckIndex1809187150010.
 *   - "Project" gains "markSecurityCaseContainedWhenVerified", on for every
 *     project: a case moves to Contained once OneUptime has verified every
 *     step that contains it. A constant default: adding it does not rewrite
 *     the table.
 *
 * The new table is empty, so its indexes and foreign keys are built here.
 */
export class AddSecurityCaseStepChecks1809187150000
  implements MigrationInterface
{
  public name: string = "AddSecurityCaseStepChecks1809187150000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityCaseStepCheck" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "securityCaseId" uuid NOT NULL, "stepKey" character varying(100) NOT NULL, "state" character varying(100) NOT NULL, "evidence" jsonb NOT NULL, "checkedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "stateSince" TIMESTAMP WITH TIME ZONE NOT NULL, "nextCheckAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_de44f4ddd2902008d27391c9e81" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c1320e1d5c4527f7c2609485a" ON "SecurityCaseStepCheck" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_11fd871444fb770c0121dd83d2" ON "SecurityCaseStepCheck" ("securityCaseId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_47e85e0e5a20334ef64f3a5177" ON "SecurityCaseStepCheck" ("nextCheckAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_76d7bab8e922ce5c46fc7e24c5" ON "SecurityCaseStepCheck" ("securityCaseId", "stepKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "markSecurityCaseContainedWhenVerified" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" ADD "nextStepCheckAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStepCheck" ADD CONSTRAINT "FK_0c1320e1d5c4527f7c2609485aa" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStepCheck" ADD CONSTRAINT "FK_11fd871444fb770c0121dd83d23" FOREIGN KEY ("securityCaseId") REFERENCES "SecurityCase"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStepCheck" ADD CONSTRAINT "FK_7cfbe25964406f07824444dd20f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStepCheck" ADD CONSTRAINT "FK_8976d518bed4c473d40ac1026bb" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStepCheck" DROP CONSTRAINT "FK_8976d518bed4c473d40ac1026bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStepCheck" DROP CONSTRAINT "FK_7cfbe25964406f07824444dd20f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStepCheck" DROP CONSTRAINT "FK_11fd871444fb770c0121dd83d23"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseStepCheck" DROP CONSTRAINT "FK_0c1320e1d5c4527f7c2609485aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP COLUMN "nextStepCheckAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "markSecurityCaseContainedWhenVerified"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_76d7bab8e922ce5c46fc7e24c5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_47e85e0e5a20334ef64f3a5177"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_11fd871444fb770c0121dd83d2"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c1320e1d5c4527f7c2609485a"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityCaseStepCheck"`);
  }
}
