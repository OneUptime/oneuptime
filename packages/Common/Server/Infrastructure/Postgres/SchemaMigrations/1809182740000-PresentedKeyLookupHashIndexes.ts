import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * PresentedKeysEncryptedColumns1809182700000 and
 * MonitorKeysEncryptedColumns1809182730000, and moved into a migration of
 * its own: the indexes of the lookup hash columns those added (#9012), which
 * a request presenting a key - a heartbeat, an ingestion key, a workflow's
 * webhook or email - finds its record by. "Monitor", "Workflow" and
 * "TelemetryIngestionKey" already hold rows, and the first is written on
 * every probe result, so each index is built online, without blocking the
 * writes meanwhile. A workflow's email key is unique across workflows, as
 * the key itself was, so its hash's index is unique. Safe to run again
 * after a stop part way.
 */
export class PresentedKeyLookupHashIndexes1809182740000
  implements MigrationInterface
{
  public name: string = "PresentedKeyLookupHashIndexes1809182740000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_3ccdeb7dfdb56af5de3d0daad3" ON "Monitor" ("serverMonitorSecretKeyHash") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_61e9c345250e6b586075e739c4" ON "Monitor" ("incomingRequestSecretKeyHash") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_8122540d388a69cffe5f28326b" ON "Monitor" ("incomingEmailSecretKeyHash") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_1b5082ddca2d2ce8d0c8eb2ea5" ON "Workflow" ("webhookSecretKeyHash") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE UNIQUE INDEX "IDX_c296bd752d5365df60789af6f1" ON "Workflow" ("incomingEmailSecretKeyHash") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_76072ca7a5ce5e6c03f8d628e4" ON "TelemetryIngestionKey" ("secretKeyHash") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_76072ca7a5ce5e6c03f8d628e4"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_c296bd752d5365df60789af6f1"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_1b5082ddca2d2ce8d0c8eb2ea5"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_8122540d388a69cffe5f28326b"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_61e9c345250e6b586075e739c4"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_3ccdeb7dfdb56af5de3d0daad3"`,
    );
  }
}
