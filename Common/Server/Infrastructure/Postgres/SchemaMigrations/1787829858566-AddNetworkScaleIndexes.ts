import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Indexes for a network estate of eighty thousand devices and a thousand-odd
 * sites in one project.
 *
 * Before these, the hottest queries in the network product were sequential
 * scans of the whole NetworkDevice table — including the polling claim loop,
 * which every probe runs on every cycle and which had no index on `probeId`
 * at all (a foreign key creates none in Postgres).
 *
 * `(projectId, isArchived)` is REPLACED rather than joined by
 * `(projectId, isArchived, createdAt)`: the two-column index is a prefix of
 * the three-column one, so keeping both would cost every insert and update a
 * second write for nothing.
 */
export class AddNetworkScaleIndexes1787829858566 implements MigrationInterface {
  public name: string = "AddNetworkScaleIndexes1787829858566";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Superseded by IDX_15660584d280ed474504cb4021, which has it as a prefix.
    await queryRunner.query(
      `DROP INDEX "public"."IDX_878d6fc3878837bb01e09b2f3f"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_15660584d280ed474504cb4021" ON "NetworkDevice" ("projectId", "isArchived", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2eb97a5af768174a679a32b011" ON "NetworkDevice" ("projectId", "isArchived", "isReachable") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_42360e479fb36f6d34c0e3c485" ON "NetworkDevice" ("projectId", "siteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_52f8f551a9796060489ebaf31c" ON "NetworkDevice" ("probeId", "nextPollAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_387febc5598c05f9795463292c" ON "NetworkSite" ("projectId", "currentMonitorStatusId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_387febc5598c05f9795463292c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52f8f551a9796060489ebaf31c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42360e479fb36f6d34c0e3c485"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2eb97a5af768174a679a32b011"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15660584d280ed474504cb4021"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_878d6fc3878837bb01e09b2f3f" ON "NetworkDevice" ("projectId", "isArchived") `,
    );
  }
}
