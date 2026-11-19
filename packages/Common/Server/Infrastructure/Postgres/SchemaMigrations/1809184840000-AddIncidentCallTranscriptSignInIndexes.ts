import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddIncidentCallTranscriptPostsAndSignIn1809184830000, and moved into a
 * migration of its own: "IncidentVideoCall" is written by every call a
 * rule starts and by the transcript job, so its indexes are built online,
 * without blocking its readers or writers (Docs/migrations/README.md).
 *
 *   - The calls whose transcript was read through an account's sign-in,
 *     found when that account removes OneUptime (Zoom's app_deauthorized).
 *   - The calls waiting for what was read through a removed sign-in to be
 *     deleted, which the Workers job reads every minute.
 *
 * Both partial, so each holds only the few calls that have the value.
 * The names are TypeORM's own, so the drift check finds nothing to change.
 * Safe to run again after a stop part way.
 */
export class AddIncidentCallTranscriptSignInIndexes1809184840000
  implements MigrationInterface
{
  public name: string = "AddIncidentCallTranscriptSignInIndexes1809184840000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_9de180854541dc15c8d06111a7" ON "IncidentVideoCall" ("transcriptSignInRemovedAt") WHERE "transcriptSignInRemovedAt" IS NOT NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_0b478574bffaf40674fc5f4e40" ON "IncidentVideoCall" ("transcriptSignInAccountId") WHERE "transcriptSignInAccountId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_0b478574bffaf40674fc5f4e40"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_9de180854541dc15c8d06111a7"`,
    );
  }
}
