import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Cloud resources are re-keyed from per-service.name to per cloud
 * *environment* (cloud.platform + cloud.account.id + cloud.region). The old
 * per-service rows no longer match the new composite resourceIdentifier and
 * would linger as stale entries, so clear CloudResource and its child rows.
 * Discovery recreates environment-level rows from live telemetry on the next
 * ingest. Project-level rule tables are intentionally left untouched.
 */
export class RecastCloudResourcesByEnvironment1780987192743
  implements MigrationInterface
{
  public name = "RecastCloudResourcesByEnvironment1780987192743";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "CloudResourceInstance"`);
    await queryRunner.query(`DELETE FROM "CloudResourceLabel"`);
    await queryRunner.query(`DELETE FROM "CloudResourceOwnerUser"`);
    await queryRunner.query(`DELETE FROM "CloudResourceOwnerTeam"`);
    await queryRunner.query(`DELETE FROM "CloudResource"`);
  }

  public async down(): Promise<void> {
    /*
     * Irreversible data cleanup — environment-level rows re-discover from
     * live telemetry, so there is nothing to restore on down().
     */
  }
}
