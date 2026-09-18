import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIncidentIsPrivate1778359982682 implements MigrationInterface {
  public name: string = "AddIncidentIsPrivate1778359982682";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "isPrivate" boolean DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8e93734f75511dd202eee548e1" ON "Incident" ("isPrivate") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8e93734f75511dd202eee548e1"`,
    );
    await queryRunner.query(`ALTER TABLE "Incident" DROP COLUMN "isPrivate"`);
  }
}
