import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * What a network estate of eighty thousand devices and a thousand-odd sites
 * needs from Postgres.
 *
 * Before this, the hottest queries in the network product were sequential
 * scans of the whole NetworkDevice table — including the polling claim loop,
 * which every probe runs on every cycle and which had no index on `probeId` at
 * all, a foreign key creating none in Postgres.
 *
 * Measured on a seeded 80,000-device fleet, before → after:
 *
 *   device list, first page          14.4 ms → 0.10 ms
 *   device list, Status facet        13.7 ms → 0.12 ms
 *   probe claim (40,000 devices)      117 ms → 0.85 ms   (2,702 → 86 buffers)
 */
export class AddNetworkScaleIndexes1789700000000 implements MigrationInterface {
  public name: string = "AddNetworkScaleIndexes1789700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    /*
     * `nextPollAt` becomes NOT NULL, defaulting to now.
     *
     * NULL meant "poll as soon as possible", so the claim query had to read
     * `(nextPollAt IS NULL OR nextPollAt <= now)` ordered `ASC NULLS FIRST`.
     * A btree is ASC NULLS LAST, so that ordering could never be served by an
     * index however the index was declared: every claim cycle sequentially
     * scanned the probe's whole slice of the fleet and top-N sorted it, inside
     * a transaction already holding FOR UPDATE row locks.
     *
     * `now()` says exactly what NULL said, in a value the index can order.
     *
     * The backfill runs first and must: SET NOT NULL rejects the statement
     * outright if a single row still holds NULL. `createdAt` rather than
     * `now()` for those rows, so a device that has been waiting to be polled
     * since it was created keeps its place at the front of the queue instead
     * of going to the back of it.
     */
    await queryRunner.query(
      `UPDATE "NetworkDevice" SET "nextPollAt" = "createdAt" WHERE "nextPollAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "nextPollAt" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "nextPollAt" SET DEFAULT now()`,
    );

    /*
     * Superseded by IDX_15660584d280ed474504cb4021, which has it as a prefix.
     * Keeping both would cost every insert and update a second index write for
     * nothing — and this is a table every SNMP poll updates.
     */
    await queryRunner.query(
      `DROP INDEX "public"."IDX_878d6fc3878837bb01e09b2f3f"`,
    );

    // The device list's default page, and every fleet-wide count over it.
    await queryRunner.query(
      `CREATE INDEX "IDX_15660584d280ed474504cb4021" ON "NetworkDevice" ("projectId", "isArchived", "createdAt") `,
    );
    /*
     * The Status facet and the summary strip's three counts, plus the
     * Overview's "longest out of contact" list, which is what `lastSeenAt` is
     * doing on the end.
     */
    await queryRunner.query(
      `CREATE INDEX "IDX_87566f1ca6cc63ee3afd3aeaff" ON "NetworkDevice" ("projectId", "isArchived", "isReachable", "lastSeenAt") `,
    );
    // Every per-site rollup, the hierarchy drill-down, and the unassigned count.
    await queryRunner.query(
      `CREATE INDEX "IDX_42360e479fb36f6d34c0e3c485" ON "NetworkDevice" ("projectId", "siteId") `,
    );
    /*
     * PARTIAL: dark ports are a small minority of a healthy fleet, so this
     * stays tiny and an interface flap only touches it when the count crosses
     * zero. A full index on a column every SNMP walk rewrites would be write
     * amplification for the sake of one eight-row list.
     */
    await queryRunner.query(
      `CREATE INDEX "IDX_5767b485012a9b4b49d0f99b6a" ON "NetworkDevice" ("projectId", "interfacesDown") WHERE "interfacesDown" > 0 AND "isArchived" = false`,
    );
    // The polling claim loop. See the nextPollAt note above.
    await queryRunner.query(
      `CREATE INDEX "IDX_52f8f551a9796060489ebaf31c" ON "NetworkDevice" ("probeId", "nextPollAt") `,
    );
    // The Sites summary strip's grouped status count, and the unhealthy list.
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
      `DROP INDEX "public"."IDX_5767b485012a9b4b49d0f99b6a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_42360e479fb36f6d34c0e3c485"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_87566f1ca6cc63ee3afd3aeaff"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_15660584d280ed474504cb4021"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_878d6fc3878837bb01e09b2f3f" ON "NetworkDevice" ("projectId", "isArchived") `,
    );
    /*
     * The rows the backfill filled in are indistinguishable from real
     * schedules, so `down` restores the shape of the column and not its
     * former NULLs. Nothing reads NULL as anything but "due now", which is
     * what those rows already say.
     */
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "nextPollAt" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ALTER COLUMN "nextPollAt" DROP NOT NULL`,
    );
  }
}
