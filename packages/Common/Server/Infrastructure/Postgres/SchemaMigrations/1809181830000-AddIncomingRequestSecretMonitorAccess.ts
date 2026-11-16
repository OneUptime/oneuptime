import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Which Incoming Request monitors accept an incoming request secret (issue
 * #8501): its mode, and the monitors or labels a limited secret names.
 *
 * "monitorAccess" defaults to 'All Monitors', so every secret that exists
 * keeps covering every monitor of its project, as before: an upgrade limits
 * nothing. "IncomingRequestSecret" is a small table (a handful of secrets a
 * project), and the column's default is a constant, so Postgres adds it
 * without rewriting a row.
 *
 * The two join tables are new, so their indexes and foreign keys are built
 * on empty tables: instant, and holding "Monitor" and "Label" only for the
 * moment each foreign key is added.
 */
export class AddIncomingRequestSecretMonitorAccess1809181830000
  implements MigrationInterface
{
  public name: string = "AddIncomingRequestSecretMonitorAccess1809181830000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "IncomingRequestSecretMonitor" ("incomingRequestSecretId" uuid NOT NULL, "monitorId" uuid NOT NULL, CONSTRAINT "PK_95f1c88701edf8ed4012e65ff47" PRIMARY KEY ("incomingRequestSecretId", "monitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_43a0185a639c0ead150e941299" ON "IncomingRequestSecretMonitor" ("incomingRequestSecretId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9a687ebc59f3a9756f261ef828" ON "IncomingRequestSecretMonitor" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "IncomingRequestSecretLabel" ("incomingRequestSecretId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_98f07ed2791d9097800069ac773" PRIMARY KEY ("incomingRequestSecretId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_59555a5b70c1df75c234772157" ON "IncomingRequestSecretLabel" ("incomingRequestSecretId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f1bbb61348a06045886be819ba" ON "IncomingRequestSecretLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecret" ADD "monitorAccess" character varying(100) NOT NULL DEFAULT 'All Monitors'`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecretMonitor" ADD CONSTRAINT "FK_43a0185a639c0ead150e9412992" FOREIGN KEY ("incomingRequestSecretId") REFERENCES "IncomingRequestSecret"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecretMonitor" ADD CONSTRAINT "FK_9a687ebc59f3a9756f261ef8280" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecretLabel" ADD CONSTRAINT "FK_59555a5b70c1df75c234772157f" FOREIGN KEY ("incomingRequestSecretId") REFERENCES "IncomingRequestSecret"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecretLabel" ADD CONSTRAINT "FK_f1bbb61348a06045886be819ba9" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecretLabel" DROP CONSTRAINT "FK_f1bbb61348a06045886be819ba9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecretLabel" DROP CONSTRAINT "FK_59555a5b70c1df75c234772157f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecretMonitor" DROP CONSTRAINT "FK_9a687ebc59f3a9756f261ef8280"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecretMonitor" DROP CONSTRAINT "FK_43a0185a639c0ead150e9412992"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncomingRequestSecret" DROP COLUMN "monitorAccess"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f1bbb61348a06045886be819ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_59555a5b70c1df75c234772157"`,
    );
    await queryRunner.query(`DROP TABLE "IncomingRequestSecretLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9a687ebc59f3a9756f261ef828"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_43a0185a639c0ead150e941299"`,
    );
    await queryRunner.query(`DROP TABLE "IncomingRequestSecretMonitor"`);
  }
}
