import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Cloud connections (Cloud > Connect): AWS accounts, Azure subscriptions
 * and Google Cloud projects OneUptime reads on a schedule with read-only
 * access, listing their resources and reading their key metrics.
 *
 *   - "CloudConnection", a new table: the cloud, its settings and its
 *     credentials (encrypted by the service before they are written, never
 *     read back), whether it is on, its telemetry service, and what its
 *     reads found and when it is read next. Indexed for the Workers' job
 *     that reads the connections that are due (isEnabled, nextPullAt).
 *   - "CloudResource"."cloudConnectionId": the connection that found a
 *     resource, null for every existing row. A nullable column with no
 *     default is added without rewriting the table; its index and its
 *     foreign key are built online by
 *     AddCloudResourceCloudConnectionIndexAndKey1805450000000.
 *
 * Generated with `typeorm migration:generate` against a fully migrated
 * throwaway database; only the file/class name, this comment, the
 * formatting and the move of the "CloudResource" index and key are
 * hand-written. The other indexes and foreign keys are on the table this
 * migration creates, so they hold no lock on rows anyone writes.
 */
export class AddCloudConnection1805400000000 implements MigrationInterface {
  public name: string = "AddCloudConnection1805400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "CloudConnection" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(50) NOT NULL, "provider" character varying(100) NOT NULL, "config" jsonb, "secrets" text NOT NULL, "isEnabled" boolean NOT NULL DEFAULT true, "serviceId" uuid, "nextPullAt" TIMESTAMP WITH TIME ZONE, "lastPulledAt" TIMESTAMP WITH TIME ZONE, "lastSuccessfulPullAt" TIMESTAMP WITH TIME ZONE, "lastPullResult" jsonb, "lastError" text, "pullState" jsonb, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_cf7b1209a226f748922750e4012" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1794bbe69ccbf70e93d47f19af" ON "CloudConnection" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c4cb64629c6de142071d9cd658" ON "CloudConnection" ("provider") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2f7afa7f55dea5a9b2d5f20bd5" ON "CloudConnection" ("isEnabled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6cda8cb138191d0df9c6298dcc" ON "CloudConnection" ("serviceId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3132f7985533fa714d7e4d5a57" ON "CloudConnection" ("nextPullAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" ADD "cloudConnectionId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" ADD CONSTRAINT "FK_1794bbe69ccbf70e93d47f19af8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" ADD CONSTRAINT "FK_6cda8cb138191d0df9c6298dcc5" FOREIGN KEY ("serviceId") REFERENCES "Service"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" ADD CONSTRAINT "FK_536b3a8bf7b6ec72c8976ee6eda" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" ADD CONSTRAINT "FK_9992dcd91ef05a794ba983cbcd9" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" DROP CONSTRAINT "FK_9992dcd91ef05a794ba983cbcd9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" DROP CONSTRAINT "FK_536b3a8bf7b6ec72c8976ee6eda"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" DROP CONSTRAINT "FK_6cda8cb138191d0df9c6298dcc5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudConnection" DROP CONSTRAINT "FK_1794bbe69ccbf70e93d47f19af8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CloudResource" DROP COLUMN "cloudConnectionId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3132f7985533fa714d7e4d5a57"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6cda8cb138191d0df9c6298dcc"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2f7afa7f55dea5a9b2d5f20bd5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c4cb64629c6de142071d9cd658"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1794bbe69ccbf70e93d47f19af"`,
    );
    await queryRunner.query(`DROP TABLE "CloudConnection"`);
  }
}
