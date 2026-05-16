import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRunbookSecret1778851431287 implements MigrationInterface {
  public name: string = "AddRunbookSecret1778851431287";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "RunbookSecret" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "secretValue" text, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_35a43e225e44f7dfd33e0137354" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_717b3c993d94aa5b4c3f0dda5c" ON "RunbookSecret" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "RunbookSecretRunbookAgent" ("runbookSecretId" uuid NOT NULL, "runbookAgentId" uuid NOT NULL, CONSTRAINT "PK_2a4703128457e9019b1eabf0a8f" PRIMARY KEY ("runbookSecretId", "runbookAgentId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dfcaca6663d57a8ca0cd045339" ON "RunbookSecretRunbookAgent" ("runbookSecretId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6b1307a959a26116c4a3f2a33a" ON "RunbookSecretRunbookAgent" ("runbookAgentId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecret" ADD CONSTRAINT "FK_717b3c993d94aa5b4c3f0dda5cf" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecret" ADD CONSTRAINT "FK_37b8e5e3018b3a5e2cccf1c1004" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecret" ADD CONSTRAINT "FK_66b41715de1e904ea9d3c82ae91" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunbookAgent" ADD CONSTRAINT "FK_dfcaca6663d57a8ca0cd045339d" FOREIGN KEY ("runbookSecretId") REFERENCES "RunbookSecret"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunbookAgent" ADD CONSTRAINT "FK_6b1307a959a26116c4a3f2a33ae" FOREIGN KEY ("runbookAgentId") REFERENCES "RunbookAgent"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunbookAgent" DROP CONSTRAINT "FK_6b1307a959a26116c4a3f2a33ae"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecretRunbookAgent" DROP CONSTRAINT "FK_dfcaca6663d57a8ca0cd045339d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecret" DROP CONSTRAINT "FK_66b41715de1e904ea9d3c82ae91"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecret" DROP CONSTRAINT "FK_37b8e5e3018b3a5e2cccf1c1004"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookSecret" DROP CONSTRAINT "FK_717b3c993d94aa5b4c3f0dda5cf"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6b1307a959a26116c4a3f2a33a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dfcaca6663d57a8ca0cd045339"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookSecretRunbookAgent"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_717b3c993d94aa5b4c3f0dda5c"`,
    );
    await queryRunner.query(`DROP TABLE "RunbookSecret"`);
  }
}
