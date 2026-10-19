import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration after
 * AddIncidentCallTranscriptAutoFetch1803850000000, and moved into a
 * migration of its own: Incident and IncidentVideoCall already exist, so
 * the indexes the Workers job reads by - the incidents whose postmortem
 * draft waits for their calls, the calls it is due to ask about - are built
 * online, without blocking the writes an incident in progress makes. Safe
 * to run again after a stop part way.
 */
export class AddIncidentCallTranscriptAutoFetchIndexes1803900000000
  implements MigrationInterface
{
  public name: string =
    "AddIncidentCallTranscriptAutoFetchIndexes1803900000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_9c0299e0e44be87fb5526fceda" ON "Incident" ("postmortemDraftWaitingSince") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_3cda148a4e927c1c2b5b5dc752" ON "IncidentVideoCall" ("transcriptFetchNextAttemptAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_3cda148a4e927c1c2b5b5dc752"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_9c0299e0e44be87fb5526fceda"`,
    );
  }
}
