import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Entity risk (Types/SecurityCase/SecurityEntityRisk): every finding adds
 * risk points to the user, host or address it is about, and an entity whose
 * risk of the last week reaches the project's threshold opens a case.
 *
 *   - "SecurityEntityRisk": one row per project and entity (unique on
 *     projectId + entityKey), with its score, its sources (contributions)
 *     and a month of history. Written by OneUptime alone.
 *   - "SecurityEntityCriticality": the project's list of how much each
 *     entity matters (Low, High, Extreme), which weighs its risk.
 *   - Project "enableSecurityRiskCases": whether risk opens cases. Off here
 *     for every project that exists - an upgrade opens no case nobody asked
 *     for - and on for new projects as they are created
 *     (ProjectService.applyNewProjectSecurityDefaults).
 *   - Project "securityRiskCaseThreshold": where a case opens, 100.
 *   - DetectionRule "riskScore": a rule's own Risk Points; empty is its
 *     level's.
 *
 * Both tables are new and empty, so their indexes and foreign keys are built
 * here; the columns added to existing tables carry constant defaults or none,
 * so no row is rewritten.
 */
export class AddSecurityEntityRisk1807600000000 implements MigrationInterface {
  public name: string = "AddSecurityEntityRisk1807600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityEntityRisk" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "entityType" character varying(100) NOT NULL, "entityValue" character varying(500) NOT NULL, "entityKey" character varying(500) NOT NULL, "riskScore" integer NOT NULL DEFAULT '0', "criticality" character varying(100), "contributorCount" integer NOT NULL DEFAULT '0', "contributions" jsonb, "mitreTactics" jsonb, "mitreTechniques" jsonb, "firstRiskAt" TIMESTAMP WITH TIME ZONE, "lastRiskAt" TIMESTAMP WITH TIME ZONE, "riskExpiresAt" TIMESTAMP WITH TIME ZONE, "riskCaseAt" TIMESTAMP WITH TIME ZONE, "riskHistory" jsonb, "deletedByUserId" uuid, CONSTRAINT "PK_7db2192a4c1e9979fcc03363186" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cfa825ed6eb0d0980ba25780ef" ON "SecurityEntityRisk" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15ff555c30babe99c5df369e74" ON "SecurityEntityRisk" ("lastRiskAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c4ac751d6a24bd1c84143abaf8" ON "SecurityEntityRisk" ("riskExpiresAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_153d859f997df79a1856b62884" ON "SecurityEntityRisk" ("projectId", "riskScore") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_7186685c1b6a9ed7ca7bac9036" ON "SecurityEntityRisk" ("projectId", "entityKey") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityEntityCriticality" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "value" character varying(500) NOT NULL, "entityType" character varying(100), "criticality" character varying(100) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_74ab9905eb61995de64f9a3086a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d6b4c6792f23d4b0cd721b3742" ON "SecurityEntityCriticality" ("projectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "enableSecurityRiskCases" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "securityRiskCaseThreshold" integer NOT NULL DEFAULT '100'`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD "riskScore" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEntityRisk" ADD CONSTRAINT "FK_cfa825ed6eb0d0980ba25780ef2" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEntityRisk" ADD CONSTRAINT "FK_a81067842fc4466199cd449682a" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEntityCriticality" ADD CONSTRAINT "FK_d6b4c6792f23d4b0cd721b37420" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEntityCriticality" ADD CONSTRAINT "FK_a2f87f571b0ba70361be2298134" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEntityCriticality" ADD CONSTRAINT "FK_c84373fd124e70d4f7c20834003" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityEntityCriticality" DROP CONSTRAINT "FK_c84373fd124e70d4f7c20834003"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEntityCriticality" DROP CONSTRAINT "FK_a2f87f571b0ba70361be2298134"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEntityCriticality" DROP CONSTRAINT "FK_d6b4c6792f23d4b0cd721b37420"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEntityRisk" DROP CONSTRAINT "FK_a81067842fc4466199cd449682a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityEntityRisk" DROP CONSTRAINT "FK_cfa825ed6eb0d0980ba25780ef2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP COLUMN "riskScore"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "securityRiskCaseThreshold"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "enableSecurityRiskCases"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d6b4c6792f23d4b0cd721b3742"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityEntityCriticality"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7186685c1b6a9ed7ca7bac9036"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_153d859f997df79a1856b62884"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c4ac751d6a24bd1c84143abaf8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15ff555c30babe99c5df369e74"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cfa825ed6eb0d0980ba25780ef"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityEntityRisk"`);
  }
}
