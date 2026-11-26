import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Who an erasure request's worker found the person named as (#11044):
 * SecurityUserErasureRequest.namesToErase, kept encrypted while the request
 * is open and wiped when it is over. Exactly as `npm run
 * generate-postgres-migration` wrote it: a nullable column with no default,
 * which Postgres adds without rewriting the table or scanning it.
 */
export class AddSecurityUserErasureRequestNamesToErase1809187681044
  implements MigrationInterface
{
  public name: string =
    "AddSecurityUserErasureRequestNamesToErase1809187681044";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityUserErasureRequest" ADD "namesToErase" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityUserErasureRequest" DROP COLUMN "namesToErase"`,
    );
  }
}
