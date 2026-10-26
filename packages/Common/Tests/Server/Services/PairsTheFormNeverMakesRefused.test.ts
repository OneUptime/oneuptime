import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import IncomingCallPolicyService from "../../../Server/Services/IncomingCallPolicyService";
import ScheduledMaintenanceReminderRuleService from "../../../Server/Services/ScheduledMaintenanceReminderRuleService";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import ScheduledMaintenanceReminderStopState from "../../../Types/Reminder/ScheduledMaintenanceReminderStopState";
import { SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL } from "../../../Types/Reminder/ScheduledMaintenanceReminderNeverReminds";
import { ON_CALL_POLICY_REPEAT_TIMES_REFUSAL } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import { INCOMING_CALL_POLICY_REPEAT_TIMES_REFUSAL } from "../../../Types/IncomingCall/IncomingCallPolicyRepeat";
import fs from "fs";
import path from "path";

/*
 * PAIRS THE FORMS NEVER MAKE ARE REFUSED BY THE API TOO.
 *
 * A scheduled maintenance reminder rule that waits for its event to start
 * and stops when it starts, an on-call policy that "repeats" 0 times and an
 * incoming call policy that rings again 0 times: their Dashboard forms
 * cannot save any of them, and now neither can the API, Terraform, MCP or a
 * workflow. Each service checks before anything else is looked up
 * (checkCreateBeforeReferences / checkUpdateBeforeReferences). A record
 * stored that way before keeps working, and an update that leaves the pair
 * as it is still saves.
 */

type CheckWrite = (write: unknown) => Promise<void>;

interface Subject {
  name: string;
  service: unknown;
  // A pair the form never makes, and one it does.
  broken: Record<string, unknown>;
  fine: Record<string, unknown>;
  // An update that turns a fine record into the broken pair.
  breaking: {
    stored: Record<string, unknown>;
    written: Record<string, unknown>;
  };
  refusal: string;
}

const SUBJECTS: Array<Subject> = [
  {
    name: "a scheduled maintenance reminder rule",
    service: ScheduledMaintenanceReminderRuleService,
    broken: {
      remindWhileScheduled: false,
      stopRemindersOnState: ScheduledMaintenanceReminderStopState.Ongoing,
    },
    fine: {
      remindWhileScheduled: true,
      stopRemindersOnState: ScheduledMaintenanceReminderStopState.Ongoing,
    },
    breaking: {
      stored: {
        remindWhileScheduled: false,
        stopRemindersOnState: ScheduledMaintenanceReminderStopState.Completed,
      },
      written: {
        stopRemindersOnState: ScheduledMaintenanceReminderStopState.Ongoing,
      },
    },
    refusal: SCHEDULED_MAINTENANCE_REMINDER_NEVER_REMINDS_REFUSAL,
  },
  {
    name: "an on-call policy",
    service: OnCallDutyPolicyService,
    broken: {
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
    },
    fine: {
      repeatPolicyIfNoOneAcknowledges: true,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: 2,
    },
    breaking: {
      stored: {
        repeatPolicyIfNoOneAcknowledges: false,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 0,
      },
      written: { repeatPolicyIfNoOneAcknowledges: true },
    },
    refusal: ON_CALL_POLICY_REPEAT_TIMES_REFUSAL,
  },
  {
    name: "an incoming call policy",
    service: IncomingCallPolicyService,
    broken: {
      repeatPolicyIfNoOneAnswers: true,
      repeatPolicyIfNoOneAnswersTimes: 0,
    },
    fine: {
      repeatPolicyIfNoOneAnswers: true,
      repeatPolicyIfNoOneAnswersTimes: 1,
    },
    breaking: {
      stored: {
        repeatPolicyIfNoOneAnswers: true,
        repeatPolicyIfNoOneAnswersTimes: 2,
      },
      written: { repeatPolicyIfNoOneAnswersTimes: 0 },
    },
    refusal: INCOMING_CALL_POLICY_REPEAT_TIMES_REFUSAL,
  },
];

function checkCreate(subject: Subject, data: unknown): Promise<void> {
  return (
    subject.service as { checkCreateBeforeReferences: CheckWrite }
  ).checkCreateBeforeReferences({ data: data, props: { isRoot: true } });
}

/*
 * An update of one stored record: the service's own read of the rows it
 * writes answers that record.
 */
async function checkUpdate(
  subject: Subject,
  written: Record<string, unknown>,
  stored: Record<string, unknown>,
): Promise<{ reads: number }> {
  let reads: number = 0;

  jest
    .spyOn(
      subject.service as {
        findRowsAndHoldUpdateToThem: (...args: Array<unknown>) => unknown;
      },
      "findRowsAndHoldUpdateToThem",
    )
    .mockImplementation(async (): Promise<Array<unknown>> => {
      reads++;
      return [stored];
    });

  await (
    subject.service as { checkUpdateBeforeReferences: CheckWrite }
  ).checkUpdateBeforeReferences({
    query: { _id: ObjectID.generate().toString() },
    data: written,
    props: { isRoot: true },
  });

  return { reads };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(SUBJECTS)("$name", (subject: Subject) => {
  test("is refused on create with the pair its form never makes, in the rule's words", async () => {
    await expect(checkCreate(subject, subject.broken)).rejects.toThrow(
      new BadDataException(subject.refusal),
    );
  });

  test("is saved on create with a pair its form makes, and with neither column written", async () => {
    await expect(checkCreate(subject, subject.fine)).resolves.toBeUndefined();
    await expect(
      checkCreate(subject, { name: "Payments" }),
    ).resolves.toBeUndefined();
  });

  test("is refused on an update that turns a stored record into that pair", async () => {
    await expect(
      checkUpdate(subject, subject.breaking.written, subject.breaking.stored),
    ).rejects.toThrow(new BadDataException(subject.refusal));
  });

  test("stored that way already, is saved by an update that leaves the pair as it is", async () => {
    await expect(
      checkUpdate(
        subject,
        { ...subject.broken, name: "Renamed" },
        subject.broken,
      ),
    ).resolves.toEqual({ reads: 1 });
  });

  test("stored that way already, is saved by an update that mends it", async () => {
    await expect(
      checkUpdate(subject, subject.fine, subject.broken),
    ).resolves.toEqual({ reads: 1 });
  });

  test("an update that writes neither column reads nothing more", async () => {
    await expect(
      checkUpdate(subject, { name: "Renamed" }, subject.broken),
    ).resolves.toEqual({ reads: 0 });
  });
});

describe("an on-call policy's other checks still run beside the repeat's", () => {
  test("an acknowledgement timeout out of range is refused before the repeat is read", async () => {
    await expect(
      checkCreate(SUBJECTS[1]!, {
        acknowledgementTimeoutInMinutes: 2,
        repeatPolicyIfNoOneAcknowledges: true,
        repeatPolicyIfNoOneAcknowledgesNoOfTimes: 3,
      }),
    ).rejects.toThrow(BadDataException);
  });
});

/*
 * Every place these records are made through their services goes through
 * the same hooks, so a test of the hooks is a test of every way in. The
 * services must keep calling them from the hooks the base class runs first.
 */
describe("the services hold the rules where every write passes", () => {
  const SERVICES_DIR: string = path.resolve(
    __dirname,
    "../../../Server/Services",
  );

  test.each([
    [
      "ScheduledMaintenanceReminderRuleService.ts",
      "SCHEDULED_MAINTENANCE_REMINDER_TIMING_RULE",
    ],
    ["OnCallDutyPolicyService.ts", "ON_CALL_POLICY_REPEAT_RULE"],
    ["IncomingCallPolicyService.ts", "INCOMING_CALL_POLICY_REPEAT_RULE"],
  ])("%s checks %s on create and on update", (file: string, rule: string) => {
    const source: string = fs.readFileSync(
      path.join(SERVICES_DIR, file),
      "utf8",
    );

    const createHook: number = source.indexOf(
      "protected override async checkCreateBeforeReferences(",
    );
    const updateHook: number = source.indexOf(
      "protected override async checkUpdateBeforeReferences(",
    );

    expect(createHook).toBeGreaterThan(-1);
    expect(updateHook).toBeGreaterThan(-1);
    expect(source.indexOf("ColumnRuleCheck.checkCreate(", createHook)).toBe(
      source.indexOf("ColumnRuleCheck.checkCreate("),
    );
    expect(
      source.indexOf("ColumnRuleCheck.checkUpdate({", updateHook),
    ).toBeGreaterThan(updateHook);
    expect(source.split(rule).length - 1).toBeGreaterThanOrEqual(3);
  });
});
