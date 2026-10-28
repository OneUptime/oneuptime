import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Address Names (issue #5340): a name someone gave an IP address or a
 * subnet, which the Traffic pages show the address by.
 *
 *   - "NetworkAddressName": one row per address or subnet a project named,
 *     kept the one way it can be written (NetworkAddressBlockUtil), with
 *     the name and who added it.
 *
 * The table is new and empty, so its indexes and foreign keys are built
 * here; no existing table changes.
 */
export class AddNetworkAddressNames1808200000000 implements MigrationInterface {
  public name: string = "AddNetworkAddressNames1808200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkAddressName" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "address" character varying(100) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_c2a77a051c0b8ce3e028a04d98c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1dc3a5608c83a04069eae15968" ON "NetworkAddressName" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_986127703d15bd79aebbf0331d" ON "NetworkAddressName" ("projectId", "address") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAddressName" ADD CONSTRAINT "FK_1dc3a5608c83a04069eae15968e" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAddressName" ADD CONSTRAINT "FK_1bfa74d145934921213b2ebd5b1" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAddressName" ADD CONSTRAINT "FK_b5d14bd884f50f2806b6f2d4715" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkAddressName" DROP CONSTRAINT "FK_b5d14bd884f50f2806b6f2d4715"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAddressName" DROP CONSTRAINT "FK_1bfa74d145934921213b2ebd5b1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkAddressName" DROP CONSTRAINT "FK_1dc3a5608c83a04069eae15968e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_986127703d15bd79aebbf0331d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1dc3a5608c83a04069eae15968"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkAddressName"`);
  }
}
