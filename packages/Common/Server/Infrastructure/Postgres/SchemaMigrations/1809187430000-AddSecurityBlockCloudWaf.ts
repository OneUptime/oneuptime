import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renamed and
 * renumbered after the last registered migration. Made after
 * AddRecordCreatedByAndLastModifiedColumns1809187400000, the table is made
 * with the base model's six record actor columns of its own.
 *
 * The cloud WAFs that enforce a project's blocklist (#10344):
 * SecurityBlockCloudWaf, one AWS WAF web ACL a project picked from its cloud
 * connection's inventory - one row a web ACL, by a partial unique index -
 * with where it reads the client's address and where it stands. It goes
 * with its project and its connection; the inventory row it was picked from
 * may go, and it stays. A new table, empty until someone picks a web ACL, so
 * its indexes and keys are built with it.
 */
export class AddSecurityBlockCloudWaf1809187430000
  implements MigrationInterface
{
  public name: string = "AddSecurityBlockCloudWaf1809187430000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityBlockCloudWaf" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "cloudConnectionId" uuid NOT NULL, "cloudResourceId" uuid, "cloudProvider" character varying(100) NOT NULL, "wafId" character varying(500) NOT NULL, "name" character varying(100) NOT NULL, "region" character varying(100), "clientAddress" character varying(100) NOT NULL DEFAULT 'SourceIp', "status" character varying(100) NOT NULL DEFAULT 'Checking', "statusMessage" text, "ruleDetails" jsonb, "checkedAt" TIMESTAMP WITH TIME ZONE, "createdByUserId" uuid, CONSTRAINT "PK_4640cbde393f696ed34baa89f16" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_71e08e47838c3e59db5959b631" ON "SecurityBlockCloudWaf" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6febf4aecdf66b28a29d04abb" ON "SecurityBlockCloudWaf" ("cloudConnectionId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_55e1abf5db3ea6b76f194dcce1" ON "SecurityBlockCloudWaf" ("cloudResourceId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_910cf27864b22caaeefc7fc788" ON "SecurityBlockCloudWaf" ("projectId", "wafId") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockCloudWaf" ADD CONSTRAINT "FK_71e08e47838c3e59db5959b6311" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockCloudWaf" ADD CONSTRAINT "FK_c6febf4aecdf66b28a29d04abbf" FOREIGN KEY ("cloudConnectionId") REFERENCES "CloudConnection"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockCloudWaf" ADD CONSTRAINT "FK_55e1abf5db3ea6b76f194dcce1e" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockCloudWaf" ADD CONSTRAINT "FK_a17bab429b3c1ad1ea2d583d0f2" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockCloudWaf" DROP CONSTRAINT "FK_a17bab429b3c1ad1ea2d583d0f2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockCloudWaf" DROP CONSTRAINT "FK_55e1abf5db3ea6b76f194dcce1e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockCloudWaf" DROP CONSTRAINT "FK_c6febf4aecdf66b28a29d04abbf"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlockCloudWaf" DROP CONSTRAINT "FK_71e08e47838c3e59db5959b6311"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_910cf27864b22caaeefc7fc788"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_55e1abf5db3ea6b76f194dcce1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c6febf4aecdf66b28a29d04abb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_71e08e47838c3e59db5959b631"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityBlockCloudWaf"`);
  }
}
