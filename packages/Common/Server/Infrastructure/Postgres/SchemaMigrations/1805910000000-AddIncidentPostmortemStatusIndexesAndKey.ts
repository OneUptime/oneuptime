import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddIncidentPostmortemStatus1805900000000, and moved into a migration of
 * its own: "Incident" is written all the time (monitors declare incidents,
 * people and jobs update them), so the two indexes on its new
 * "postmortemStatusId" column - one for the foreign key, one for the
 * Postmortems list's status filter and counts within a project - are built
 * online, and the foreign key to "IncidentPostmortemStatus" is added NOT
 * VALID and then validated, without blocking those writes. Every existing
 * row's column is null, so the validation finds nothing to refuse. Safe to
 * run again after a stop part way.
 */
export class AddIncidentPostmortemStatusIndexesAndKey1805910000000
  implements MigrationInterface
{
  public name: string = "AddIncidentPostmortemStatusIndexesAndKey1805910000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_74ac107944041db672d4534195" ON "Incident" ("postmortemStatusId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_28e61d365962e3ee04211484c6" ON "Incident" ("projectId", "postmortemStatusId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Incident" ADD CONSTRAINT "FK_74ac107944041db672d4534195b" FOREIGN KEY ("postmortemStatusId") REFERENCES "IncidentPostmortemStatus"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP CONSTRAINT "FK_74ac107944041db672d4534195b"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_28e61d365962e3ee04211484c6"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_74ac107944041db672d4534195"`,
    );
  }
}
