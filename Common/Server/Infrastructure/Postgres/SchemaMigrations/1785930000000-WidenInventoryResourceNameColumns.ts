import { MigrationInterface, QueryRunner } from "typeorm";

export class WidenInventoryResourceNameColumns1785930000000
  implements MigrationInterface
{
  public name = "WidenInventoryResourceNameColumns1785930000000";

  /*
   * Same overflow class as WidenDockerResourceImageColumns1782800000000,
   * on the Podman and Kubernetes inventory tables. These services build
   * `INSERT ... ON CONFLICT` strings by hand and flush them in chunks of
   * 500 rows, so ONE value over varchar(100) raises "value too long for
   * type character varying(100)" (22001) and aborts the ENTIRE multi-row
   * INSERT — up to 500 inventory rows silently dropped per flush.
   *
   * The offenders, all previously varchar(100):
   *   - PodmanResource."name" / "imageName": full image references
   *     (registry host + org + repo + tag) routinely exceed 100 chars.
   *   - KubernetesResource."name" and KubernetesContainer."podName":
   *     Kubernetes DNS-subdomain names go up to 253 characters, and
   *     generated pod names (deployment + replicaset hash + pod hash)
   *     commonly clear 100.
   *   - KubernetesResource."controllerDeploymentName": written from the
   *     `k8s.deployment.name` resource attribute, same bound.
   *
   * 500 (ColumnLength.LongText) clears the 253-char Kubernetes ceiling
   * with room to spare and matches what DockerResource already uses.
   *
   * COST: raising a varchar length cap is binary-coercible, so Postgres
   * skips the table rewrite — but ALTER COLUMN TYPE still rebuilds every
   * index on the altered column ("any indexes on the affected columns
   * must still be rebuilt"). Three of these five columns are members of
   * composite UNIQUE indexes:
   *   - PodmanResource."name"        -> IDX_772c02b6419beb57fa47ccae1b
   *   - KubernetesResource."name"    -> IDX_3ae20a0d4346958dff73ba7fda
   *   - KubernetesContainer."podName" -> IDX_1dcb8fed322a9bddfabb60cbc7
   * Those three rebuild under ACCESS EXCLUSIVE, so on a large inventory
   * table this is not free: ingest for the affected tables blocks for
   * the duration, and TypeORM runs all pending migrations in one
   * transaction, so the locks are held until the whole batch commits.
   * "imageName" and "controllerDeploymentName" are in no index and are
   * genuinely metadata-only.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ALTER COLUMN "name" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ALTER COLUMN "imageName" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ALTER COLUMN "name" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ALTER COLUMN "controllerDeploymentName" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" ALTER COLUMN "podName" TYPE character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Narrowing back to varchar(100) fails outright if any row written
     * since up() exceeds 100 chars, so clip first. "name" / "podName"
     * are part of UNIQUE indexes: clipping two rows onto the same
     * truncated key would violate them, so the revert deletes rows
     * whose identity would collide after clipping instead of letting
     * the ALTER blow up. Inventory rows are a projection of what the
     * agent is reporting — the next snapshot re-creates them.
     */
    await queryRunner.query(
      `DELETE FROM "PodmanResource" a USING "PodmanResource" b
       WHERE a."projectId" = b."projectId"
         AND a."podmanHostId" = b."podmanHostId"
         AND a."kind" = b."kind"
         AND LEFT(a."name", 100) = LEFT(b."name", 100)
         AND a."_id" > b."_id"`,
    );
    await queryRunner.query(
      `DELETE FROM "KubernetesResource" a USING "KubernetesResource" b
       WHERE a."projectId" = b."projectId"
         AND a."kubernetesClusterId" = b."kubernetesClusterId"
         AND a."kind" = b."kind"
         AND a."namespaceKey" = b."namespaceKey"
         AND LEFT(a."name", 100) = LEFT(b."name", 100)
         AND a."_id" > b."_id"`,
    );
    await queryRunner.query(
      `DELETE FROM "KubernetesContainer" a USING "KubernetesContainer" b
       WHERE a."projectId" = b."projectId"
         AND a."kubernetesClusterId" = b."kubernetesClusterId"
         AND a."podNamespaceKey" = b."podNamespaceKey"
         AND LEFT(a."podName", 100) = LEFT(b."podName", 100)
         AND a."name" = b."name"
         AND a."_id" > b."_id"`,
    );

    await queryRunner.query(
      `UPDATE "PodmanResource" SET "name" = LEFT("name", 100) WHERE LENGTH("name") > 100`,
    );
    await queryRunner.query(
      `UPDATE "PodmanResource" SET "imageName" = LEFT("imageName", 100) WHERE "imageName" IS NOT NULL AND LENGTH("imageName") > 100`,
    );
    await queryRunner.query(
      `UPDATE "KubernetesResource" SET "name" = LEFT("name", 100) WHERE LENGTH("name") > 100`,
    );
    await queryRunner.query(
      `UPDATE "KubernetesResource" SET "controllerDeploymentName" = LEFT("controllerDeploymentName", 100) WHERE "controllerDeploymentName" IS NOT NULL AND LENGTH("controllerDeploymentName") > 100`,
    );
    await queryRunner.query(
      `UPDATE "KubernetesContainer" SET "podName" = LEFT("podName", 100) WHERE LENGTH("podName") > 100`,
    );

    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "PodmanResource" ALTER COLUMN "imageName" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ALTER COLUMN "controllerDeploymentName" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "KubernetesContainer" ALTER COLUMN "podName" TYPE character varying(100)`,
    );
  }
}
