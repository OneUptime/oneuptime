import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. Its index is built online, in a migration
 * of its own (AddVideoCallConnectionSignInIndex1801050000000).
 *
 * The one-click Connect of a video call provider: someone signs in to Zoom,
 * Google or Microsoft and the connection keeps the sign-in.
 *
 *  - authMethod: OAuth for a connection made by signing in, AppCredentials
 *    for one with the project's own app. Connections stored before this have
 *    none, and are read as app credentials - which they all are.
 *  - connectedAccount: who signed in, as the provider names them.
 *  - connectedAccountId: the provider's id of that account. Connections
 *    signed in as the same account share one sign-in, because Zoom keeps
 *    only one per account.
 *
 * Every column is nullable with no default, so adding them changes no row.
 */
export class AddVideoCallConnectionSignIn1801000000000
  implements MigrationInterface
{
  public name: string = "AddVideoCallConnectionSignIn1801000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" ADD "authMethod" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" ADD "connectedAccount" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" ADD "connectedAccountId" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" DROP COLUMN "connectedAccountId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" DROP COLUMN "connectedAccount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "VideoCallConnection" DROP COLUMN "authMethod"`,
    );
  }
}
