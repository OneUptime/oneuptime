import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddResolvedRecordRetention1809110600000, and moved into a migration of its
 * own: the tables already exist, so their indexes are built online, without
 * blocking writes. Safe to run again after a stop part way: an index that is
 * already there is left as it is.
 *
 * The columns that point at an incident, an alert or an episode and had no
 * index: on-call runs and the people they paged (OnCallDutyPolicyExecutionLog,
 * UserOnCallLog), a pinned or watched session replay (RumSessionPin,
 * RumSessionReplayView) and a security case. Deleting the record they point
 * at deletes or clears them through the foreign key, which looked for them by
 * reading the whole table, once for every record deleted. The purge of
 * resolved incidents and alerts a project no longer keeps (issue #6903)
 * deletes them a hundred at a time, every hour.
 */
export class AddIndexesForIncidentAndAlertDeletes1809110700000
  implements MigrationInterface
{
  public name: string = "AddIndexesForIncidentAndAlertDeletes1809110700000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_4215567ecaeb1db1ef3d6cc2e6" ON "RumSessionReplayView" ("linkedIncidentId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_336ded09ba7bfaab73f0d05850" ON "RumSessionPin" ("incidentId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_e0815e51bbeb69666c0030d256" ON "RumSessionPin" ("alertId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_a230899d6c2b16621954c46fb1" ON "OnCallDutyPolicyExecutionLog" ("triggeredByIncidentId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_b495684ae5b9c2a5b8dba6c1d4" ON "OnCallDutyPolicyExecutionLog" ("triggeredByAlertId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_eeb0dd05d1dec542c3de5fb507" ON "UserOnCallLog" ("triggeredByIncidentId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_0ee3711cdc64957845d9d028c3" ON "UserOnCallLog" ("triggeredByAlertId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_114aa962f2bc3c6736a1469df3" ON "UserOnCallLog" ("triggeredByAlertEpisodeId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_587fec46a331e53d72bb6c72fd" ON "UserOnCallLog" ("triggeredByIncidentEpisodeId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_cdb94d76dcf480f39d0785a9fc" ON "SecurityCase" ("incidentId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_cdb94d76dcf480f39d0785a9fc"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_587fec46a331e53d72bb6c72fd"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_114aa962f2bc3c6736a1469df3"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_0ee3711cdc64957845d9d028c3"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_eeb0dd05d1dec542c3de5fb507"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_b495684ae5b9c2a5b8dba6c1d4"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_a230899d6c2b16621954c46fb1"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_e0815e51bbeb69666c0030d256"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_336ded09ba7bfaab73f0d05850"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_4215567ecaeb1db1ef3d6cc2e6"`,
    );
  }
}
