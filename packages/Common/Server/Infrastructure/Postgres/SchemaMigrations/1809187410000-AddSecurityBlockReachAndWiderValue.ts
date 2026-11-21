import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The blocklist takes domains, URLs and files, and an address can be
 * blocked on every machine too (#10346).
 *
 *   - "SecurityBlock"."reach": where a block is enforced. Edge - at the edge
 *     in front of the app - for every block made before, which were all
 *     addresses; Everywhere for a block on every machine too, through
 *     Microsoft Defender or CrowdStrike, which a domain, a URL and a file
 *     always are.
 *   - "SecurityBlock"."value" from varchar(100) to varchar(500): a URL is
 *     kept whole, up to 500 characters, and a domain runs to 253.
 *   - One active block per value and reach, where it was one per value: an
 *     address can be blocked at the edge and, on its own, everywhere. The old
 *     index is dropped here; the new one is built online by
 *     AddSecurityBlockValueReachIndex1809187410010, which runs after it.
 *
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration. TypeORM wrote the change of "value" as DROP
 * COLUMN + ADD: that drops every block's value, and the ADD - NOT NULL, no
 * default - fails outright on a table holding a block. ALTER COLUMN ... TYPE
 * reaches the same schema and keeps every value: a wider varchar is
 * binary-coercible, so Postgres rewrites no row and rebuilds no index. The
 * ALTER TABLE holds the table ACCESS EXCLUSIVE for its catalog change, so
 * dropping the old index in the same transaction takes no lock of its own
 * (SchemaMigrationsOnlineDdl allows it for that reason). Same shape as
 * WidenCodeRepositoryOwnerColumns1808995240000.
 */
export class AddSecurityBlockReachAndWiderValue1809187410000
  implements MigrationInterface
{
  public name: string = "AddSecurityBlockReachAndWiderValue1809187410000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a4755bd06e3601ee046fcd7fe4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" ADD "reach" character varying(100) NOT NULL DEFAULT 'Edge'`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" ALTER COLUMN "value" TYPE character varying(500)`,
    );
  }

  /*
   * Back to addresses at the edge alone. The blocks of a domain, a URL or a
   * file are taken away first - their enforcement rows with them, by the
   * key - since the blocklist before this holds none of them, and a value
   * longer than 100 could not be kept. So is a block of an address
   * everywhere while the same address is blocked at the edge, which the
   * one-per-value index could not hold.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "SecurityBlock" WHERE "indicatorType" NOT IN ('IpAddress', 'IpRange') OR LENGTH("value") > 100`,
    );
    await queryRunner.query(
      `DELETE FROM "SecurityBlock" AS "everywhere" WHERE "everywhere"."reach" = 'Everywhere' AND "everywhere"."state" = 'Active' AND "everywhere"."deletedAt" IS NULL AND EXISTS (SELECT 1 FROM "SecurityBlock" AS "edge" WHERE "edge"."projectId" = "everywhere"."projectId" AND "edge"."value" = "everywhere"."value" AND "edge"."reach" = 'Edge' AND "edge"."state" = 'Active' AND "edge"."deletedAt" IS NULL)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlock" ALTER COLUMN "value" TYPE character varying(100)`,
    );
    await queryRunner.query(`ALTER TABLE "SecurityBlock" DROP COLUMN "reach"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_a4755bd06e3601ee046fcd7fe4" ON "SecurityBlock" ("projectId", "value") WHERE (((state)::text = 'Active'::text) AND ("deletedAt" IS NULL))`,
    );
  }
}
