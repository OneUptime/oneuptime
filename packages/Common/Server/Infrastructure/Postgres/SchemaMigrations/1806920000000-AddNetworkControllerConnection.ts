import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Network controller connections (OneUptime issue #5140): a Meraki
 * organization OneUptime reads network traffic from through the Meraki
 * dashboard API, on a schedule and with a read-only key.
 *
 *   - "NetworkControllerConnection", a new table: the controller, its
 *     settings (region, organization, read interval) and its API key
 *     (encrypted by the service before it is written, never read back),
 *     whether it is on, and what its reads found, where they got to and
 *     when it is read next. Indexed for the Workers' job that reads the
 *     connections that are due (isEnabled, nextPullAt).
 *
 * Generated with `typeorm migration:generate` against a fully migrated
 * throwaway database; only the file/class name, this comment and the
 * formatting are hand-written. Every index and foreign key is on the table
 * this migration creates, so none holds a lock on rows anyone writes.
 */
export class AddNetworkControllerConnection1806920000000
  implements MigrationInterface
{
  public name: string = "AddNetworkControllerConnection1806920000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "NetworkControllerConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "provider" character varying(100) NOT NULL, "config" jsonb, "secrets" text NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "nextPullAt" TIMESTAMP WITH TIME ZONE, "lastPulledAt" TIMESTAMP WITH TIME ZONE, "lastSuccessfulPullAt" TIMESTAMP WITH TIME ZONE, "lastPullResult" jsonb, "lastError" text, "pullState" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_952be8aa696a8f2bcff63857e16" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b3927b591b3bc3aa94ad8a9265" ON "NetworkControllerConnection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1c7ae95afe218c254cc0098b35" ON "NetworkControllerConnection" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5b8e9ff6fc6144a7a727ea025d" ON "NetworkControllerConnection" ("nextPullAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkControllerConnection" ADD CONSTRAINT "FK_b3927b591b3bc3aa94ad8a92659" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkControllerConnection" ADD CONSTRAINT "FK_7dd46e9362156a325bfa5f93353" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkControllerConnection" ADD CONSTRAINT "FK_2032969563f397798164038015b" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkControllerConnection" DROP CONSTRAINT "FK_2032969563f397798164038015b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkControllerConnection" DROP CONSTRAINT "FK_7dd46e9362156a325bfa5f93353"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkControllerConnection" DROP CONSTRAINT "FK_b3927b591b3bc3aa94ad8a92659"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5b8e9ff6fc6144a7a727ea025d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1c7ae95afe218c254cc0098b35"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b3927b591b3bc3aa94ad8a9265"`,
    );
    await queryRunner.query(`DROP TABLE "NetworkControllerConnection"`);
  }
}
