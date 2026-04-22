import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Before this migration, KubernetesCluster had an app-level
 * @UniqueColumnBy("projectId") check and a non-unique index on
 * clusterIdentifier, but no DB-level uniqueness. Under concurrent telemetry
 * from multiple agent pods (happens every time the agent is installed or
 * rolls out), findOrCreateByClusterIdentifier would race between its find
 * and its create, and the DB accepted both inserts — producing duplicate
 * rows with identical (projectId, clusterIdentifier).
 *
 * This migration:
 *   1. Reparents all FKs that reference duplicate clusters — KubernetesResource,
 *      KubernetesClusterOwnerUser, KubernetesClusterOwnerTeam — onto the
 *      oldest surviving row in each duplicate group.
 *   2. Deletes the duplicate (non-survivor) rows.
 *   3. Creates a DB-level unique index on (projectId, clusterIdentifier) so
 *      future races are rejected by the DB — the service's existing
 *      catch-and-refetch in findOrCreateByClusterIdentifier then returns the
 *      winning row instead of producing a duplicate.
 *
 * The auto-generator also picked up unrelated OnCallDutyPolicyScheduleLayer
 * default-value drift. That's dev-environment drift, not the bug we're fixing;
 * stripped from this migration.
 */
export class DedupeKubernetesClustersAndAddUniqueIndex1776881254913
  implements MigrationInterface
{
  public name: string = "DedupeKubernetesClustersAndAddUniqueIndex1776881254913";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1: reparent KubernetesResource FKs from duplicates -> survivor.
    await queryRunner.query(`
      WITH survivors AS (
        SELECT DISTINCT ON ("projectId", "clusterIdentifier")
          _id AS survivor_id,
          "projectId",
          "clusterIdentifier"
        FROM "KubernetesCluster"
        ORDER BY "projectId", "clusterIdentifier", "createdAt" ASC, _id ASC
      ),
      losers AS (
        SELECT kc._id AS loser_id, s.survivor_id
        FROM "KubernetesCluster" kc
        JOIN survivors s
          ON s."projectId" = kc."projectId"
         AND s."clusterIdentifier" = kc."clusterIdentifier"
        WHERE kc._id <> s.survivor_id
      )
      UPDATE "KubernetesResource" kr
      SET "kubernetesClusterId" = l.survivor_id
      FROM losers l
      WHERE kr."kubernetesClusterId" = l.loser_id;
    `);

    // 2: reparent KubernetesClusterOwnerUser FKs.
    await queryRunner.query(`
      WITH survivors AS (
        SELECT DISTINCT ON ("projectId", "clusterIdentifier")
          _id AS survivor_id,
          "projectId",
          "clusterIdentifier"
        FROM "KubernetesCluster"
        ORDER BY "projectId", "clusterIdentifier", "createdAt" ASC, _id ASC
      ),
      losers AS (
        SELECT kc._id AS loser_id, s.survivor_id
        FROM "KubernetesCluster" kc
        JOIN survivors s
          ON s."projectId" = kc."projectId"
         AND s."clusterIdentifier" = kc."clusterIdentifier"
        WHERE kc._id <> s.survivor_id
      )
      UPDATE "KubernetesClusterOwnerUser" o
      SET "kubernetesClusterId" = l.survivor_id
      FROM losers l
      WHERE o."kubernetesClusterId" = l.loser_id;
    `);

    // 3: reparent KubernetesClusterOwnerTeam FKs.
    await queryRunner.query(`
      WITH survivors AS (
        SELECT DISTINCT ON ("projectId", "clusterIdentifier")
          _id AS survivor_id,
          "projectId",
          "clusterIdentifier"
        FROM "KubernetesCluster"
        ORDER BY "projectId", "clusterIdentifier", "createdAt" ASC, _id ASC
      ),
      losers AS (
        SELECT kc._id AS loser_id, s.survivor_id
        FROM "KubernetesCluster" kc
        JOIN survivors s
          ON s."projectId" = kc."projectId"
         AND s."clusterIdentifier" = kc."clusterIdentifier"
        WHERE kc._id <> s.survivor_id
      )
      UPDATE "KubernetesClusterOwnerTeam" o
      SET "kubernetesClusterId" = l.survivor_id
      FROM losers l
      WHERE o."kubernetesClusterId" = l.loser_id;
    `);

    // 4: delete duplicate rows now that nothing references them.
    await queryRunner.query(`
      WITH survivors AS (
        SELECT DISTINCT ON ("projectId", "clusterIdentifier")
          _id AS survivor_id,
          "projectId",
          "clusterIdentifier"
        FROM "KubernetesCluster"
        ORDER BY "projectId", "clusterIdentifier", "createdAt" ASC, _id ASC
      )
      DELETE FROM "KubernetesCluster" kc
      USING survivors s
      WHERE s."projectId" = kc."projectId"
        AND s."clusterIdentifier" = kc."clusterIdentifier"
        AND kc._id <> s.survivor_id;
    `);

    // 5: add the DB-level composite unique index.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_9756988b48848f4f7532a2af0d" ON "KubernetesCluster" ("projectId", "clusterIdentifier") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9756988b48848f4f7532a2af0d"`,
    );
    // Duplicate rows dropped in up() are lost — a down-migration cannot
    // resurrect them (and reinstating duplicates is not desirable anyway).
  }
}
