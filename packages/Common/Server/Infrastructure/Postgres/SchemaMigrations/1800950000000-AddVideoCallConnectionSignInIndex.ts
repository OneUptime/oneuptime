import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddVideoCallConnectionSignIn1800900000000, and moved into a migration of
 * its own: the index of VideoCallConnection.connectedAccountId - how the
 * connections signed in as one account are found together - is built
 * through OnlineDdl.createIndex (CREATE INDEX CONCURRENTLY), so the table's
 * writers are never blocked. Safe to run again after a stop part way:
 * OnlineDdl drops an index an earlier run left invalid and builds it again.
 */
export class AddVideoCallConnectionSignInIndex1800950000000
  implements MigrationInterface
{
  public name: string = "AddVideoCallConnectionSignInIndex1800950000000";

  // CREATE INDEX CONCURRENTLY cannot run inside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_afda86e923be5a1a736cdf7a2b" ON "VideoCallConnection" ("connectedAccountId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_afda86e923be5a1a736cdf7a2b"`,
    );
  }
}
