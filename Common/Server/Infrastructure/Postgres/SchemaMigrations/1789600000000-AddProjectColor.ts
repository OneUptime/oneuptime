import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Project colour, at two levels: a per-project colour and, on GlobalConfig,
 * the default used by projects that have not chosen one.
 *
 * Both columns are nullable with no default, so an installation that never
 * opens the Appearance page keeps the built-in appearance exactly.
 */
export class AddProjectColor1789600000000 implements MigrationInterface {
  public name: string = "AddProjectColor1789600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "color" character varying(10)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "defaultProjectColor" character varying(10)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "defaultProjectColor"`,
    );
    await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "color"`);
  }
}
