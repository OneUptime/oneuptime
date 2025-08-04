import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1754304193228 implements MigrationInterface {
  public name = "MigrationName1754304193228";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ProjectSCIM" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "bearerToken" character varying(500) NOT NULL, "autoProvisionUsers" boolean NOT NULL DEFAULT true, "autoDeprovisionUsers" boolean NOT NULL DEFAULT true, "isEnabled" boolean NOT NULL DEFAULT false, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_51e71d70211675a5c918aee4e68" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f916360335859c26c4d7051239" ON "ProjectSCIM" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ProjectScimTeam" ("projectScimId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_db724b66b4fa8c880ce5ccf820b" PRIMARY KEY ("projectScimId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b9a28efd66600267f0e9de0731" ON "ProjectScimTeam" ("projectScimId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bb0eda2ef0c773f975e9ad8448" ON "ProjectScimTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" ADD CONSTRAINT "FK_f916360335859c26c4d7051239b" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" ADD CONSTRAINT "FK_5d5d587984f156e5215d51daff7" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" ADD CONSTRAINT "FK_9cadda4fc2af268b5670d02bf76" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectScimTeam" ADD CONSTRAINT "FK_b9a28efd66600267f0e9de0731b" FOREIGN KEY ("projectScimId") REFERENCES "ProjectSCIM"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectScimTeam" ADD CONSTRAINT "FK_bb0eda2ef0c773f975e9ad8448a" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectScimTeam" DROP CONSTRAINT "FK_bb0eda2ef0c773f975e9ad8448a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectScimTeam" DROP CONSTRAINT "FK_b9a28efd66600267f0e9de0731b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" DROP CONSTRAINT "FK_9cadda4fc2af268b5670d02bf76"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" DROP CONSTRAINT "FK_5d5d587984f156e5215d51daff7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSCIM" DROP CONSTRAINT "FK_f916360335859c26c4d7051239b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_bb0eda2ef0c773f975e9ad8448"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b9a28efd66600267f0e9de0731"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectScimTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f916360335859c26c4d7051239"`,
    );
    await queryRunner.query(`DROP TABLE "ProjectSCIM"`);
  }
}
