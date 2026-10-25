import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddSecurityCasePrioritiesAndStatuses1807200000000, and moved into a
 * migration of its own: "SecurityCase" is written by every detection that
 * opens or joins a case, so the indexes on its new "securityCaseStatusId"
 * and "securityCasePriorityId" columns - one for each key, one for the open
 * and closed lists within a project - are built online, and its two keys,
 * the playbooks' minimum priority key and the notification settings'
 * minimum priority key are added NOT VALID and then validated, without
 * blocking those writes. Every value the validation reads was given by the
 * migration before this one, so it finds nothing to refuse. Safe to run
 * again after a stop part way.
 */
export class AddSecurityCasePriorityAndStatusIndexesAndKeys1807210000000
  implements MigrationInterface
{
  public name: string =
    "AddSecurityCasePriorityAndStatusIndexesAndKeys1807210000000";

  // CREATE INDEX CONCURRENTLY and the validation run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_f2af4ab7b126b96515175e07ee" ON "SecurityCase" ("securityCaseStatusId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_32920766651c575ace350e8fc3" ON "SecurityCase" ("securityCasePriorityId") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_3c5930a265457719de7441c839" ON "SecurityCase" ("projectId", "securityCaseStatusId") `,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "SecurityCase" ADD CONSTRAINT "FK_f2af4ab7b126b96515175e07eec" FOREIGN KEY ("securityCaseStatusId") REFERENCES "SecurityCaseStatus"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "SecurityCase" ADD CONSTRAINT "FK_32920766651c575ace350e8fc3e" FOREIGN KEY ("securityCasePriorityId") REFERENCES "SecurityCasePriority"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "SecurityPlaybook" ADD CONSTRAINT "FK_38871ef4c6f43f8daef0c886d9d" FOREIGN KEY ("minimumSecurityCasePriorityId") REFERENCES "SecurityCasePriority"("_id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "UserNotificationSetting" ADD CONSTRAINT "FK_076708cc1ac24b0fa5f5cc184fe" FOREIGN KEY ("minimumSecurityCasePriorityId") REFERENCES "SecurityCasePriority"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserNotificationSetting" DROP CONSTRAINT "FK_076708cc1ac24b0fa5f5cc184fe"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityPlaybook" DROP CONSTRAINT "FK_38871ef4c6f43f8daef0c886d9d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP CONSTRAINT "FK_32920766651c575ace350e8fc3e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCase" DROP CONSTRAINT "FK_f2af4ab7b126b96515175e07eec"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_3c5930a265457719de7441c839"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_32920766651c575ace350e8fc3"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_f2af4ab7b126b96515175e07ee"`,
    );
  }
}
