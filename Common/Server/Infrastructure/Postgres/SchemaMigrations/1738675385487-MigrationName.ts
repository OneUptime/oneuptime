import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1738675385487 implements MigrationInterface {
  public name = "MigrationName1738675385487";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "UserAuthToken" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "authToken" text NOT NULL, "serviceType" character varying(500) NOT NULL, "miscData" jsonb NOT NULL, "userId" uuid, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_b42ef730c3c07b37018b9a7bbea" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c15a9e14212edba4035fa79a02" ON "UserAuthToken" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2f91de6c19e33bd3604ef8dcf6" ON "UserAuthToken" ("userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" ADD CONSTRAINT "FK_c15a9e14212edba4035fa79a021" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" ADD CONSTRAINT "FK_2f91de6c19e33bd3604ef8dcf65" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" ADD CONSTRAINT "FK_74d99b480d2ea5b897d65ab3f4a" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" ADD CONSTRAINT "FK_8dadaee2cb277865fd5f3bae2a4" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" DROP CONSTRAINT "FK_8dadaee2cb277865fd5f3bae2a4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" DROP CONSTRAINT "FK_74d99b480d2ea5b897d65ab3f4a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" DROP CONSTRAINT "FK_2f91de6c19e33bd3604ef8dcf65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserAuthToken" DROP CONSTRAINT "FK_c15a9e14212edba4035fa79a021"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2f91de6c19e33bd3604ef8dcf6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c15a9e14212edba4035fa79a02"`,
    );
    await queryRunner.query(`DROP TABLE "UserAuthToken"`);
  }
}
