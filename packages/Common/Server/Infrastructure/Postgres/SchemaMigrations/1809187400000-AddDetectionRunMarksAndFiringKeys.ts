import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A detection rule's scheduled run does what its matches ask exactly once
 * (#10489).
 *
 * DetectionRule.evaluatingUntil marks a stretch that found matches before
 * it does what they ask, and the run's record clears it: a worker that stops
 * in between leaves the mark, and the next run judges exactly that stretch
 * again. SecurityDetection.recentFiringKeys keeps the names of the latest
 * firings a case detection took, so the same firing handed again adds
 * nothing to its counts.
 *
 * Two nullable columns added to existing tables: no rewrite, no scan, no
 * default to fill. Every rule starts with no mark and every detection with
 * no names, as before.
 */
export class AddDetectionRunMarksAndFiringKeys1809187400000
  implements MigrationInterface
{
  public name: string = "AddDetectionRunMarksAndFiringKeys1809187400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ADD "evaluatingUntil" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" ADD "recentFiringKeys" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityDetection" DROP COLUMN "recentFiringKeys"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" DROP COLUMN "evaluatingUntil"`,
    );
  }
}
