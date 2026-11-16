import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * On-call history stays when the settings it names are deleted (issue
 * #9036).
 *
 * An on-call run (OnCallDutyPolicyExecutionLog), its timeline, each
 * person's page (UserOnCallLog) and that page's timeline name the
 * escalation rule, schedule and team that paged, and the people who were
 * paged, covered for and acknowledged. Fifteen of those references deleted
 * the history row with the setting (ON DELETE CASCADE): removing Level 2 of
 * a policy removed every run that last reached it - with its timeline, and
 * a run paging on Level 2 at that moment, so nobody paged its later levels
 * - and deleting a team, a schedule, or the account of somebody who once
 * acknowledged a page removed runs and their lines too. Now the database
 * clears the reference instead (ON DELETE SET NULL) and the row stays: who
 * was paged, by which level, when, and who acknowledged. A run whose level
 * was deleted under it moves on from where that level was (OnCallRunLevel).
 *
 * Generated as a DROP and an ADD of the same fifteen constraints. Each is
 * handed, its ADD as generated, to OnlineDdl.replaceForeignKey: dropped and
 * added NOT VALID in one statement - an instant's ACCESS EXCLUSIVE on both
 * tables, and never a moment without the key in which a delete could leave
 * a reference to nothing - then validated without blocking either table.
 * Safe to run again after a stop part way: a key already replaced is not
 * swapped again, and one left NOT VALID is validated. The index on
 * "lastExecutedEscalationRuleId" stays: the SET NULL finds the runs by it.
 */
export class KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000
  implements MigrationInterface
{
  public name: string =
    "KeepOnCallHistoryWhenItsSettingsAreDeleted1809182510000";

  // OnlineDdl.replaceForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The run: the level it is on, and who acknowledged it.
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_d4a0ffc5e9e698bb2612ba0e55f" FOREIGN KEY ("lastExecutedEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_63f6618df216b74b72e62491b09" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_3015ddfeb130417c55489da807e" FOREIGN KEY ("acknowledgedByTeamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // The run's timeline.
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_0ad4222a4c48b8a64e3a58b3519" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_0ae6ea2e2d38fd31543768e3609" FOREIGN KEY ("alertSentToUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_039098d4af133bd9c2b90978ef4" FOREIGN KEY ("userBelongsToTeamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_65998388ab4266dda712502ad65" FOREIGN KEY ("onCallDutyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_356ab0badd7e70f4d25045dcbf3" FOREIGN KEY ("overridedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Each person's page.
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_550f9f6177451d4902467991a15" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_3a4b15ce8357c6735ac1b4ae606" FOREIGN KEY ("userBelongsToTeamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_123b1825525b963fe9555d62641" FOREIGN KEY ("onCallDutyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_b70804c755c008c15794b6cc18d" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_702b8c74c8f0d7fb220bc407776" FOREIGN KEY ("overridedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );

    // Each person's page's timeline.
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_222212e7157f8816357a4f02536" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_6650020ce6e235164a09d1ca019" FOREIGN KEY ("userBelongsToTeamId") REFERENCES "Team"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_6650020ce6e235164a09d1ca019"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_222212e7157f8816357a4f02536"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_702b8c74c8f0d7fb220bc407776"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_b70804c755c008c15794b6cc18d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_123b1825525b963fe9555d62641"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_3a4b15ce8357c6735ac1b4ae606"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_550f9f6177451d4902467991a15"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_356ab0badd7e70f4d25045dcbf3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_65998388ab4266dda712502ad65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_039098d4af133bd9c2b90978ef4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_0ae6ea2e2d38fd31543768e3609"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_0ad4222a4c48b8a64e3a58b3519"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_3015ddfeb130417c55489da807e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_63f6618df216b74b72e62491b09"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_d4a0ffc5e9e698bb2612ba0e55f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_6650020ce6e235164a09d1ca019" FOREIGN KEY ("userBelongsToTeamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_222212e7157f8816357a4f02536" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_702b8c74c8f0d7fb220bc407776" FOREIGN KEY ("overridedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_b70804c755c008c15794b6cc18d" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_123b1825525b963fe9555d62641" FOREIGN KEY ("onCallDutyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_3a4b15ce8357c6735ac1b4ae606" FOREIGN KEY ("userBelongsToTeamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_550f9f6177451d4902467991a15" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_356ab0badd7e70f4d25045dcbf3" FOREIGN KEY ("overridedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_65998388ab4266dda712502ad65" FOREIGN KEY ("onCallDutyScheduleId") REFERENCES "OnCallDutyPolicySchedule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_039098d4af133bd9c2b90978ef4" FOREIGN KEY ("userBelongsToTeamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_0ae6ea2e2d38fd31543768e3609" FOREIGN KEY ("alertSentToUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_0ad4222a4c48b8a64e3a58b3519" FOREIGN KEY ("onCallDutyPolicyEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_3015ddfeb130417c55489da807e" FOREIGN KEY ("acknowledgedByTeamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_63f6618df216b74b72e62491b09" FOREIGN KEY ("acknowledgedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_d4a0ffc5e9e698bb2612ba0e55f" FOREIGN KEY ("lastExecutedEscalationRuleId") REFERENCES "OnCallDutyPolicyEscalationRule"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
