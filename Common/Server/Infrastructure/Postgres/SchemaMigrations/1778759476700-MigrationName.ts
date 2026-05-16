import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1778759476700 implements MigrationInterface {
  public name: string = "MigrationName1778759476700";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "Runbook" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, "isEnabled" boolean NOT NULL DEFAULT true, "steps" jsonb, CONSTRAINT "PK_a94f7465b307da18706bdd87f10" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_be66200942c94cb4105b6c6591" ON "Runbook" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookExecution" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "runbookId" uuid NOT NULL, "runbookNameSnapshot" character varying(100) NOT NULL, "status" character varying(100) NOT NULL, "stepExecutions" jsonb, "triggeredByUserId" uuid, "startedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "failureReason" character varying(500), "deletedByUserId" uuid, CONSTRAINT "PK_74b62e7451c51ad98f11e1bafac" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8d0568cd02347c5fa915bf71da" ON "RunbookExecution" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3d35b2fbc17e650d3c827c4283" ON "RunbookExecution" ("runbookId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookLabel" ("runbookId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_8e1fad0e909b2abe4b4b01a93bf" PRIMARY KEY ("runbookId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_280210b650cf9896fdf3a74b4b" ON "RunbookLabel" ("runbookId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3833a37996480e880046d5a228" ON "RunbookLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type":"Recurring","value":{"intervalType":"Day","intervalCount":{"_type":"PositiveNumber","value":1}}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type":"RestrictionTimes","value":{"restictionType":"None","dayRestrictionTimes":null,"weeklyRestrictionTimes":[]}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD CONSTRAINT "FK_be66200942c94cb4105b6c65918" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD CONSTRAINT "FK_f425e1dd0415a3c34d4a849926a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" ADD CONSTRAINT "FK_ca61c9de42e8ae541e5dc7ab485" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD CONSTRAINT "FK_8d0568cd02347c5fa915bf71da7" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD CONSTRAINT "FK_3d35b2fbc17e650d3c827c42833" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD CONSTRAINT "FK_92be5881badeb5b8338f1d495de" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD CONSTRAINT "FK_5870f824eba8476cee1a480c327" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabel" ADD CONSTRAINT "FK_280210b650cf9896fdf3a74b4bd" FOREIGN KEY ("runbookId") REFERENCES "Runbook"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabel" ADD CONSTRAINT "FK_3833a37996480e880046d5a2283" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookLabel" DROP CONSTRAINT "FK_3833a37996480e880046d5a2283"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookLabel" DROP CONSTRAINT "FK_280210b650cf9896fdf3a74b4bd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP CONSTRAINT "FK_5870f824eba8476cee1a480c327"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP CONSTRAINT "FK_92be5881badeb5b8338f1d495de"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP CONSTRAINT "FK_3d35b2fbc17e650d3c827c42833"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP CONSTRAINT "FK_8d0568cd02347c5fa915bf71da7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP CONSTRAINT "FK_ca61c9de42e8ae541e5dc7ab485"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP CONSTRAINT "FK_f425e1dd0415a3c34d4a849926a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Runbook" DROP CONSTRAINT "FK_be66200942c94cb4105b6c65918"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "restrictionTimes" SET DEFAULT '{"_type": "RestrictionTimes", "value": {"restictionType": "None", "dayRestrictionTimes": null, "weeklyRestrictionTimes": []}}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ALTER COLUMN "rotation" SET DEFAULT '{"_type": "Recurring", "value": {"intervalType": "Day", "intervalCount": {"_type": "PositiveNumber", "value": 1}}}'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3833a37996480e880046d5a228"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_280210b650cf9896fdf3a74b4b"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3d35b2fbc17e650d3c827c4283"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8d0568cd02347c5fa915bf71da"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookExecution"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_be66200942c94cb4105b6c6591"`,
    );
    await queryRunner.query(`DROP TABLE "Runbook"`);
  }
}
