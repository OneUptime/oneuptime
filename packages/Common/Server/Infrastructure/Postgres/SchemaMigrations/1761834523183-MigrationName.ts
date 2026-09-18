import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1761834523183 implements MigrationInterface {
  public name = "MigrationName1761834523183";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentPostmortemTemplate" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "postmortemNote" text NOT NULL, "templateName" character varying(100) NOT NULL, "templateDescription" character varying(500) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_76a09ebf10e7874f0c8ee1f0120" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2a18729813c7c666cc37683c4e" ON "IncidentPostmortemTemplate" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c791fe4d7179b57064ace561c3" ON "IncidentPostmortemTemplate" ("postmortemNote") `,
    );
    await queryRunner.query(`ALTER TABLE "Incident" ADD "postmortemNote" text`);
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemTemplate" ADD CONSTRAINT "FK_2a18729813c7c666cc37683c4ea" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemTemplate" ADD CONSTRAINT "FK_961ac93c4d7ea881170692333d0" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemTemplate" ADD CONSTRAINT "FK_2e886387888f1311f361d569b8e" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemTemplate" DROP CONSTRAINT "FK_2e886387888f1311f361d569b8e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemTemplate" DROP CONSTRAINT "FK_961ac93c4d7ea881170692333d0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemTemplate" DROP CONSTRAINT "FK_2a18729813c7c666cc37683c4ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "postmortemNote"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c791fe4d7179b57064ace561c3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2a18729813c7c666cc37683c4e"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPostmortemTemplate"`);
  }
}
