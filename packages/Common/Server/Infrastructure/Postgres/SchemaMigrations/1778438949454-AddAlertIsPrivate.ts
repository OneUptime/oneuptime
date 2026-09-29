import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAlertIsPrivate1778438949454 implements MigrationInterface {
  public name: string = "AddAlertIsPrivate1778438949454";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Alert" ADD "isPrivate" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a6350f26b69b51e43bcc8857cd" ON "Alert" ("isPrivate") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a6350f26b69b51e43bcc8857cd"`,
    );
    await queryRunner.query(`ALTER TABLE "Alert" DROP COLUMN "isPrivate"`);
  }
}
