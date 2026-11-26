import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Where an erasure request's worker has got to (#11160):
 * SecurityUserErasureRequest.progress, so a project too large to read in
 * one run is read over several, each going on where the last one stopped.
 * Exactly as `npm run generate-postgres-migration` wrote it: a nullable
 * column with no default, which Postgres adds without rewriting the table
 * or scanning it.
 */
export class AddSecurityUserErasureRequestProgress1809187741160
  implements MigrationInterface
{
  public name: string = "AddSecurityUserErasureRequestProgress1809187741160";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityUserErasureRequest" ADD "progress" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityUserErasureRequest" DROP COLUMN "progress"`,
    );
  }
}
