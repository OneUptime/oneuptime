import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Team and label ingestion budgets (#6386): a daily budget, inside a
 * project, for the telemetry of the services a team owns or a label is on
 * (TelemetryIngestionTeamLabelBudget). A new table, so it is empty while its
 * indexes and keys are made.
 *
 * And whether a project publishes its telemetry usage as metrics (#6355,
 * Project.publishTelemetryUsageMetrics): a column with a constant default,
 * which Postgres adds without rewriting the table.
 */
export class AddTelemetryIngestionTeamLabelBudgets1809186705386
  implements MigrationInterface
{
  public name: string = "AddTelemetryIngestionTeamLabelBudgets1809186705386";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "TelemetryIngestionTeamLabelBudget" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "teamId" uuid, "labelId" uuid, "logsDailyIngestionBudgetInGB" numeric, "tracesDailyIngestionBudgetInGB" numeric, "metricsDailyIngestionBudgetInGB" numeric, "profilesDailyIngestionBudgetInGB" numeric, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_156f5948bf2d69b4af3681567d3" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8bff5303b7047212ee6e668336" ON "TelemetryIngestionTeamLabelBudget" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_514987da415bae34c0093eef88" ON "TelemetryIngestionTeamLabelBudget" ("projectId", "labelId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_8288357880fe966e1fef71e99a" ON "TelemetryIngestionTeamLabelBudget" ("projectId", "teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "publishTelemetryUsageMetrics" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionTeamLabelBudget" ADD CONSTRAINT "FK_8bff5303b7047212ee6e6683361" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionTeamLabelBudget" ADD CONSTRAINT "FK_dfebd5b94fa18c0b56c6316a6dd" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionTeamLabelBudget" ADD CONSTRAINT "FK_40f0110ff3a9470fb2290537ee6" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionTeamLabelBudget" ADD CONSTRAINT "FK_364345b69cc386109416c0841ea" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionTeamLabelBudget" ADD CONSTRAINT "FK_b8de3015ef4dd31a09374dbef50" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionTeamLabelBudget" DROP CONSTRAINT "FK_b8de3015ef4dd31a09374dbef50"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionTeamLabelBudget" DROP CONSTRAINT "FK_364345b69cc386109416c0841ea"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionTeamLabelBudget" DROP CONSTRAINT "FK_40f0110ff3a9470fb2290537ee6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionTeamLabelBudget" DROP CONSTRAINT "FK_dfebd5b94fa18c0b56c6316a6dd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryIngestionTeamLabelBudget" DROP CONSTRAINT "FK_8bff5303b7047212ee6e6683361"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "publishTelemetryUsageMetrics"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8288357880fe966e1fef71e99a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_514987da415bae34c0093eef88"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8bff5303b7047212ee6e668336"`,
    );
    await queryRunner.query(`DROP TABLE "TelemetryIngestionTeamLabelBudget"`);
  }
}
