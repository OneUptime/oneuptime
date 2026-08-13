import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNetworkTopologySuppression1786639972982
  implements MigrationInterface
{
  public name: string = "AddNetworkTopologySuppression1786639972982";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkTopologySuppression" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "nodeKey" character varying(100) NOT NULL, "nodeName" character varying(100), "reason" character varying, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_23e2ab457691c1cd0540892f07c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_55b908ff54796e52649bc674db" ON "NetworkTopologySuppression" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_342a8f179fe044baa04c92c0f0" ON "NetworkTopologySuppression" ("projectId", "nodeKey") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkTopologySuppression" ADD CONSTRAINT "FK_55b908ff54796e52649bc674dba" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkTopologySuppression" ADD CONSTRAINT "FK_614e5f6ec61c79bf9beec90aeb5" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkTopologySuppression" ADD CONSTRAINT "FK_12c1cb1eb837b79e2f9f6c067ed" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkTopologySuppression" DROP CONSTRAINT "FK_12c1cb1eb837b79e2f9f6c067ed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkTopologySuppression" DROP CONSTRAINT "FK_614e5f6ec61c79bf9beec90aeb5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkTopologySuppression" DROP CONSTRAINT "FK_55b908ff54796e52649bc674dba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_342a8f179fe044baa04c92c0f0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_55b908ff54796e52649bc674db"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkTopologySuppression"`);
  }
}
