import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * A project's own call voice through the server's Twilio account (#11065,
 * Types/Call/ProjectCallVoice): the voice a project chose (Project.callVoice),
 * and whether the server's master admin lets projects choose one
 * (GlobalConfig.letProjectsChooseCallVoice).
 *
 * The voice is a nullable column with no default, and the switch's default
 * is a constant: adding either rewrites no row and holds each table's lock
 * for an instant (Docs/migrations/README.md). Nothing is backfilled: no
 * project has a voice, and the switch is off, so every call speaks exactly
 * as it did until a master admin lets projects choose.
 */
export class AddProjectCallVoice1809187801300 implements MigrationInterface {
  public name: string = "AddProjectCallVoice1809187801300";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "callVoice" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "letProjectsChooseCallVoice" boolean DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "letProjectsChooseCallVoice"`,
    );
    await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "callVoice"`);
  }
}
