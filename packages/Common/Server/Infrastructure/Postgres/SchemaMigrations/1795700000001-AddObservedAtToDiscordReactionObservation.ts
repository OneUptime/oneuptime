import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * HOM-43 review 3: observedAt is the claim's generation token. claim()
 * stamps it on take/steal; markDone()/release() match it so a stale worker
 * cannot terminate a claim a fresh worker holds. Existing Pending rows back
 * off by the stale threshold so they remain stealable immediately; existing
 * Done rows keep NULL (terminal rows are never matched by token).
 */
export class AddObservedAtToDiscordReactionObservation1795700000001
  implements MigrationInterface
{
  public name = "AddObservedAtToDiscordReactionObservation1795700000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DiscordReactionObservation" ADD "observedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `UPDATE "DiscordReactionObservation" SET "observedAt" = now() - interval '20 minutes' WHERE "observationState" = 'Pending' AND "observedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DiscordReactionObservation" DROP COLUMN "observedAt"`,
    );
  }
}
