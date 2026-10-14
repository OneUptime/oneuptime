import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The project API key an incident feed item is by, when no person made the
 * change (IncidentFeed.apiKeyId, apiKeyName; Server/Utils/Feed/
 * FeedApiKeyActor). A bare id with no foreign key, so revoking or deleting
 * a key keeps the history, and the name it had then. Existing items keep no
 * key. Nullable columns with no default rewrite no rows, and nothing is
 * indexed.
 */
export class AddIncidentFeedApiKeyActor1802050000000
  implements MigrationInterface
{
  public name: string = "AddIncidentFeedApiKeyActor1802050000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "IncidentFeed" ADD "apiKeyId" uuid`);
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" ADD "apiKeyName" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" DROP COLUMN "apiKeyName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentFeed" DROP COLUMN "apiKeyId"`,
    );
  }
}
