import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1764762146063 implements MigrationInterface {
  public name = "MigrationName1764762146063";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncidentPostmortemAttachmentFile" ("incidentId" uuid NOT NULL, "fileId" uuid NOT NULL, CONSTRAINT "PK_40b17c7d5bcfbde48d7ebab4130" PRIMARY KEY ("incidentId", "fileId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62b9c09c42e05df3f134aa14a4" ON "IncidentPostmortemAttachmentFile" ("incidentId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e09116a3b9672622bba9f8b2e" ON "IncidentPostmortemAttachmentFile" ("fileId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "showPostmortemOnStatusPage" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemAttachmentFile" ADD CONSTRAINT "FK_62b9c09c42e05df3f134aa14a46" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemAttachmentFile" ADD CONSTRAINT "FK_7e09116a3b9672622bba9f8b2e3" FOREIGN KEY ("fileId") REFERENCES "File"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemAttachmentFile" DROP CONSTRAINT "FK_7e09116a3b9672622bba9f8b2e3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPostmortemAttachmentFile" DROP CONSTRAINT "FK_62b9c09c42e05df3f134aa14a46"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "showPostmortemOnStatusPage"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e09116a3b9672622bba9f8b2e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_62b9c09c42e05df3f134aa14a4"`,
    );
    await queryRunner.query(`DROP TABLE "IncidentPostmortemAttachmentFile"`);
  }
}
