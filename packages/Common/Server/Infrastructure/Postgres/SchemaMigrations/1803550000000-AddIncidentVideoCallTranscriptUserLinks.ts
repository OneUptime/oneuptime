import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddIncidentVideoCallTranscript1803500000000, and moved into a migration
 * of its own: the foreign keys from IncidentVideoCall's transcriptAddedByUserId
 * and rootCauseSuggestionReviewedByUserId to "User" are added to a table
 * projects already have calls in, so they go through OnlineDdl - each added
 * NOT VALID and then validated - without blocking the writes that start and
 * remove calls. Both columns are new and NULL on every existing row, so the
 * validations find nothing to refuse. Safe to run again after a stop part
 * way.
 */
export class AddIncidentVideoCallTranscriptUserLinks1803550000000
  implements MigrationInterface
{
  public name: string = "AddIncidentVideoCallTranscriptUserLinks1803550000000";

  // OnlineDdl validates foreign keys outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "IncidentVideoCall" ADD CONSTRAINT "FK_a266b1ee7d197f69c0ff4b5d069" FOREIGN KEY ("transcriptAddedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "IncidentVideoCall" ADD CONSTRAINT "FK_77c2a11e31a23826f7d1d65dd4c" FOREIGN KEY ("rootCauseSuggestionReviewedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP CONSTRAINT "FK_77c2a11e31a23826f7d1d65dd4c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP CONSTRAINT "FK_a266b1ee7d197f69c0ff4b5d069"`,
    );
  }
}
