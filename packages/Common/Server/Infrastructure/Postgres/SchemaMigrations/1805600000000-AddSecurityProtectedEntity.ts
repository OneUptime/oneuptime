import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * The project's protected users and hosts (SecurityProtectedEntity): the
 * break-glass accounts, domain controllers and gateways a playbook's
 * containment step reports as protected instead of acting on. A new table,
 * empty until somebody lists something, so its indexes and keys are built
 * with it.
 */
export class AddSecurityProtectedEntity1805600000000
  implements MigrationInterface
{
  public name: string = "AddSecurityProtectedEntity1805600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityProtectedEntity" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "entityType" character varying(100) NOT NULL, "value" character varying(500) NOT NULL, "description" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_9e706fd43f9044998aa59a6037c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62f1efa2c0fa2192d5fb721498" ON "SecurityProtectedEntity" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_944d339b3e91e2e896e1396b0e" ON "SecurityProtectedEntity" ("projectId", "entityType") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityProtectedEntity" ADD CONSTRAINT "FK_62f1efa2c0fa2192d5fb7214988" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityProtectedEntity" ADD CONSTRAINT "FK_c219542e85f8b61a42e396637e4" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityProtectedEntity" ADD CONSTRAINT "FK_5756b5c1ea4171dc2569aa36b75" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityProtectedEntity" DROP CONSTRAINT "FK_5756b5c1ea4171dc2569aa36b75"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityProtectedEntity" DROP CONSTRAINT "FK_c219542e85f8b61a42e396637e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityProtectedEntity" DROP CONSTRAINT "FK_62f1efa2c0fa2192d5fb7214988"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_944d339b3e91e2e896e1396b0e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_62f1efa2c0fa2192d5fb721498"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityProtectedEntity"`);
  }
}
