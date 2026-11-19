import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * HostLogSession.note (#9966): why a log session is asked for, in the
 * requester's words, which the person at the Android device reads under the
 * request before they allow it.
 *
 * One nullable column on an existing table, with no default, no index and
 * no key: adding it rewrites nothing and blocks nothing. Sessions asked for
 * before it have no note.
 */
export class AddHostLogSessionNote1809186910000 implements MigrationInterface {
  public name: string = "AddHostLogSessionNote1809186910000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "HostLogSession" ADD "note" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "HostLogSession" DROP COLUMN "note"`);
  }
}
