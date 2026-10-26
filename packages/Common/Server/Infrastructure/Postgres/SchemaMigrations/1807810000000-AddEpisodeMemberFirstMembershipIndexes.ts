import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddEpisodeMemberFirstMembership1807800000000, and moved into a migration of
 * its own: AlertEpisodeMember and IncidentEpisodeMember already exist, and
 * the grouping engine writes to them as incidents and alerts arrive, so their
 * partial unique indexes - one first membership per alert and per incident -
 * are built online. Every existing member's "isFirstMembership" is false, so
 * each build reads no row it could refuse. Safe to run again after a stop
 * part way: an index that is already there is left as it is.
 */
export class AddEpisodeMemberFirstMembershipIndexes1807810000000
  implements MigrationInterface
{
  public name: string = "AddEpisodeMemberFirstMembershipIndexes1807810000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE UNIQUE INDEX "IDX_AlertEpisodeMember_first_membership" ON "AlertEpisodeMember" ("alertId") WHERE "isFirstMembership" = true AND "deletedAt" IS NULL`,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE UNIQUE INDEX "IDX_IncidentEpisodeMember_first_membership" ON "IncidentEpisodeMember" ("incidentId") WHERE "isFirstMembership" = true AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_IncidentEpisodeMember_first_membership"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_AlertEpisodeMember_first_membership"`,
    );
  }
}
