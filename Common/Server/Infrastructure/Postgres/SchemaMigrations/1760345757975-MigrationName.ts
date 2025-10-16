import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1760345757975 implements MigrationInterface {
  public name = "MigrationName1760345757975";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" ADD "whatsAppMessageId" character varying(100)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2090742b9abffadde19dab2026" ON "WhatsAppLog" ("whatsAppMessageId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2090742b9abffadde19dab2026"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WhatsAppLog" DROP COLUMN "whatsAppMessageId"`,
    );
  }
}
