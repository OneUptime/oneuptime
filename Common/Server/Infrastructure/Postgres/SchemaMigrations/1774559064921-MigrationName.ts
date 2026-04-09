import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1774559064921 implements MigrationInterface {
  public name = "MigrationName1774559064921";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // First, deduplicate existing services by keeping the oldest one (smallest _id / earliest createdAt).
    // Reassign any foreign key references from duplicate services to the kept service,
    // then delete the duplicates.

    // Find and delete duplicate services, keeping the one with the earliest createdAt.
    // For each (projectId, name) group with duplicates, keep the min(_id) row.
    await queryRunner.query(`
      DELETE FROM "Service"
      WHERE "_id" IN (
        SELECT s."_id"
        FROM "Service" s
        INNER JOIN (
          SELECT "projectId", LOWER("name") as lower_name, MIN("createdAt") as min_created
          FROM "Service"
          WHERE "deletedAt" IS NULL
          GROUP BY "projectId", LOWER("name")
          HAVING COUNT(*) > 1
        ) dups
        ON s."projectId" = dups."projectId"
        AND LOWER(s."name") = dups.lower_name
        AND s."createdAt" > dups.min_created
        AND s."deletedAt" IS NULL
      )
    `);

    // Now add a unique index on (projectId, name) for non-deleted rows.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_SERVICE_PROJECT_NAME_UNIQUE" ON "Service" ("projectId", LOWER("name")) WHERE "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_SERVICE_PROJECT_NAME_UNIQUE"`,
    );
  }
}
