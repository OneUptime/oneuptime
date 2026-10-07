import EmailRollupFlushRunner, {
  ROLLUP_RECIPIENT_NOT_A_MEMBER_MESSAGE,
  RollupSweepStats,
} from "../../../../Server/Utils/EmailRollup/EmailRollupFlushRunner";
import ProjectMembership, {
  ProjectUserPair,
} from "../../../../Server/Utils/TeamMember/ProjectMembership";
import { RollupBatchStatus } from "../../../../Models/DatabaseModels/UserNotificationEmailRollupBatch";
import OneUptimeDate from "../../../../Types/Date";
import Email from "../../../../Types/Email";
import ObjectID from "../../../../Types/ObjectID";
import {
  FakeBatchRow,
  RollupHarness,
  batchesOfStatus,
  emptyRollupHarness,
  installRollupHarness,
  pendingItems,
  seedItem,
  seedProject,
  seedVerifiedEmail,
} from "./EmailRollupTestHarness";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A rollup is project mail: it reaches only a member of that project. Mail
 * that was queued for somebody who has since left is consumed - stamped,
 * so it is never rediscovered - and the batch is recorded as Skipped with
 * the reason; nothing is sent. Whether each recipient still is a member is
 * read once for the whole sweep (ProjectMembership), never per bucket.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const LEAVER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MEMBER_EMAIL: Email = new Email("member@example.com");
const LEAVER_EMAIL: Email = new Email("former-member@example.com");
const NOW: Date = OneUptimeDate.fromString("2026-09-03T17:07:30.000Z");

describe("EmailRollupFlushRunner - recipients who left the project", () => {
  let harness: RollupHarness;

  beforeEach(() => {
    harness = emptyRollupHarness();
    installRollupHarness(harness);
    seedProject(harness, { projectId: PROJECT_ID, name: "Acme" });

    for (const [userId, email] of [
      [MEMBER_ID, MEMBER_EMAIL],
      [LEAVER_ID, LEAVER_EMAIL],
    ] as Array<[ObjectID, Email]>) {
      seedVerifiedEmail(harness, { projectId: PROJECT_ID, userId, email });
    }

    harness.formerMembers.push({ projectId: PROJECT_ID, userId: LEAVER_ID });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function seedDue(userId: ObjectID, toEmail: Email, subject: string): void {
    seedItem(harness, {
      projectId: PROJECT_ID,
      userId: userId,
      toEmail: toEmail,
      createdAt: OneUptimeDate.addRemoveMinutes(NOW, -12),
      subject: subject,
    });
  }

  test("mail queued for somebody who left is consumed and skipped, never sent", async () => {
    seedDue(LEAVER_ID, LEAVER_EMAIL, "Checkout is down");
    seedDue(LEAVER_ID, LEAVER_EMAIL, "Payments are slow");

    const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: NOW,
    });

    expect(stats.sent).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(harness.sendAttempts).toHaveLength(0);

    // Consumed: the next sweep does not find them again.
    expect(pendingItems(harness)).toHaveLength(0);

    const skipped: Array<FakeBatchRow> = batchesOfStatus(
      harness,
      RollupBatchStatus.Skipped,
    );

    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.itemCount).toBe(2);
    expect(skipped[0]!.statusMessage).toContain(
      ROLLUP_RECIPIENT_NOT_A_MEMBER_MESSAGE,
    );
    expect(skipped[0]!.userId.toString()).toBe(LEAVER_ID.toString());

    const nextSweep: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: OneUptimeDate.addRemoveMinutes(NOW, 15),
    });

    expect(nextSweep.bucketsDue).toBe(0);
    expect(harness.sendAttempts).toHaveLength(0);
  });

  test("members in the same sweep still get theirs", async () => {
    seedDue(MEMBER_ID, MEMBER_EMAIL, "Checkout is down");
    seedDue(LEAVER_ID, LEAVER_EMAIL, "Checkout is down");

    const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: NOW,
    });

    expect(stats.sent).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(
      harness.sent.map((mail: { toEmail: string }) => {
        return mail.toEmail;
      }),
    ).toEqual([MEMBER_EMAIL.toString()]);
  });

  test("membership is read once for the sweep, for exactly the recipients due", async () => {
    seedDue(MEMBER_ID, MEMBER_EMAIL, "Checkout is down");
    seedDue(MEMBER_ID, MEMBER_EMAIL, "Payments are slow");
    seedDue(LEAVER_ID, LEAVER_EMAIL, "Checkout is down");

    await EmailRollupFlushRunner.runSweep({ now: NOW });

    expect(harness.membershipReads).toHaveLength(1);
    expect(
      harness.membershipReads[0]!.map((pair: ProjectUserPair): string => {
        return ProjectMembership.getKey(pair.projectId, pair.userId);
      }).sort(),
    ).toEqual(
      [
        ProjectMembership.getKey(PROJECT_ID, MEMBER_ID),
        ProjectMembership.getKey(PROJECT_ID, LEAVER_ID),
      ].sort(),
    );
  });

  test("somebody who joins again gets the mail queued after they joined", async () => {
    seedDue(LEAVER_ID, LEAVER_EMAIL, "Queued while away");
    await EmailRollupFlushRunner.runSweep({ now: NOW });

    harness.formerMembers = [];
    seedItem(harness, {
      projectId: PROJECT_ID,
      userId: LEAVER_ID,
      toEmail: LEAVER_EMAIL,
      createdAt: OneUptimeDate.addRemoveMinutes(NOW, 3),
      subject: "Queued after joining again",
    });

    const stats: RollupSweepStats = await EmailRollupFlushRunner.runSweep({
      now: OneUptimeDate.addRemoveMinutes(NOW, 30),
    });

    expect(stats.sent).toBe(1);
    expect(JSON.stringify(harness.sent[0]!.vars)).toContain(
      "Queued after joining again",
    );
    expect(JSON.stringify(harness.sent[0]!.vars)).not.toContain(
      "Queued while away",
    );
  });
});
