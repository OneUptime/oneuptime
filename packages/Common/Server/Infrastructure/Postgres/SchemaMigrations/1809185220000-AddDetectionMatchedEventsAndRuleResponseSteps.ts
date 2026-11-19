import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate for the models, and numbered
 * after the last registered migration.
 *
 * A detection keeps the events it matched when it fires
 * (SecurityDetection.matchedEvents, #9619), so a case still shows them as
 * they were matched once the events pass their retention, or the rule is
 * edited. A detection rule carries its own response steps
 * (DetectionRule.responseSteps, #9621), which a case's Response Plan shows
 * ahead of its general steps.
 *
 * Two nullable jsonb columns, no default, no index, nothing backfilled:
 * adding them rewrites no row, and a server of the release before ignores
 * them. A detection that fired before keeps nothing, and the case reads its
 * events again as it did; a Rule Library rule added before reads its steps
 * from the library.
 */
export class AddDetectionMatchedEventsAndRuleResponseSteps1809185220000
  implements MigrationInterface
{
  public name: string =
    "AddDetectionMatchedEventsAndRuleResponseSteps1809185220000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD "responseSteps" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" ADD "matchedEvents" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" DROP COLUMN "matchedEvents"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP COLUMN "responseSteps"`,
    );
  }
}
