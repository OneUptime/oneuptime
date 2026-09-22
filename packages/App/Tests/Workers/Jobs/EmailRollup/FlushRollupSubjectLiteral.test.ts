import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import MailService from "Common/Server/Services/MailService";
import EmailRollupFlushRunner from "Common/Server/Utils/EmailRollup/EmailRollupFlushRunner";
import { FLUSH_AFTER_MINUTES } from "Common/Server/Utils/EmailRollup/EmailRollupConstants";
import {
  RollupHarness,
  emptyRollupHarness,
  installRollupHarness,
  seedItem,
  seedProject,
  seedVerifiedEmail,
} from "Common/Tests/Server/Utils/EmailRollup/EmailRollupTestHarness";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import ObjectID from "Common/Types/ObjectID";

/*
 * A rollup email's subject is composed in code from the project's name and
 * the queued notifications - "[Acme] 3 notifications: 3 Incidents" - so it is
 * finished text, like every other subject built in code, and the flush marks
 * it literal so the mailer does not compile it through Handlebars again. The
 * user-typed parts are also stripped of braces (the writer strips each queued
 * subject, the renderer the project name and lead title), which is covered by
 * the Common rollup suites.
 *
 * These tests run the real flush runner against the in-memory rollup harness
 * and read the message it hands MailService.sendMail.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const TO_EMAIL: Email = new Email("owner@example.com");
const NOW: Date = OneUptimeDate.fromString("2026-09-22T12:00:00.000Z");

describe("the rollup flush", () => {
  let harness: RollupHarness;

  beforeEach(() => {
    harness = emptyRollupHarness();
    installRollupHarness(harness);

    seedProject(harness, { projectId: PROJECT_ID, name: "Acme" });
    seedVerifiedEmail(harness, {
      projectId: PROJECT_ID,
      userId: USER_ID,
      email: TO_EMAIL,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function seedDue(subject: string): void {
    seedItem(harness, {
      projectId: PROJECT_ID,
      userId: USER_ID,
      toEmail: TO_EMAIL,
      createdAt: OneUptimeDate.addRemoveMinutes(
        NOW,
        (FLUSH_AFTER_MINUTES + 1) * -1,
      ),
      subject: subject,
    });
  }

  // The message the runner handed MailService.sendMail, flag included.
  function sentMessage(): EmailMessage {
    const sendMail: jest.Mock = MailService.sendMail as unknown as jest.Mock;

    expect(sendMail).toHaveBeenCalledTimes(1);

    return sendMail.mock.calls[0]![0] as EmailMessage;
  }

  test("sends a single notification with its subject marked literal", async () => {
    seedDue("[New Incident #12] - Checkout is down");

    await EmailRollupFlushRunner.runSweep({ now: NOW });

    const message: EmailMessage = sentMessage();
    expect(message.isSubjectLiteral).toBe(true);
    expect(message.subject).toBe(
      "[Acme] 1 notification: [New Incident #12] - Checkout is down",
    );
  });

  test("sends several notifications with their subject marked literal", async () => {
    seedDue("[New Incident #12] - Checkout is down");
    seedDue("[New Incident #13] - Payments are down");

    await EmailRollupFlushRunner.runSweep({ now: NOW });

    const message: EmailMessage = sentMessage();
    expect(message.isSubjectLiteral).toBe(true);
    expect(message.subject).toBe("[Acme] 2 notifications: 2 Incidents");
  });
});
