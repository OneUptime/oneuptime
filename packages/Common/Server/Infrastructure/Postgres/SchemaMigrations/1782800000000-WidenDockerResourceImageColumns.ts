import { MigrationInterface, QueryRunner } from "typeorm";

export class WidenDockerResourceImageColumns1782800000000
  implements MigrationInterface
{
  public name = "WidenDockerResourceImageColumns1782800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * DockerResource."name" holds the FULL image reference for Image-kind
     * rows, and "imageName" holds the container's image reference — both can
     * exceed varchar(100) (registry host + path + tag + @sha256 digest). An
     * oversized value raised "value too long for type character varying(100)"
     * (22001) and aborted the ENTIRE Docker snapshot batch INSERT, dropping
     * every container in the flush. Widen both to varchar(500) (LongText).
     * Increasing a varchar length cap is a metadata-only change in Postgres
     * (no table rewrite).
     */
    await queryRunner.query(
      `ALTER TABLE "DockerResource" ALTER COLUMN "name" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerResource" ALTER COLUMN "imageName" TYPE character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /*
     * Narrowing back to varchar(100) will fail if any stored value now
     * exceeds 100 chars; truncate first so the down migration is safe.
     */
    await queryRunner.query(
      `UPDATE "DockerResource" SET "name" = LEFT("name", 100) WHERE LENGTH("name") > 100`,
    );
    await queryRunner.query(
      `UPDATE "DockerResource" SET "imageName" = LEFT("imageName", 100) WHERE "imageName" IS NOT NULL AND LENGTH("imageName") > 100`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerResource" ALTER COLUMN "name" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "DockerResource" ALTER COLUMN "imageName" TYPE character varying(100)`,
    );
  }
}
