import { ReadinessStatus } from "../../../Server/Services/OnCallReadinessService";
import {
  READY_READINESS_STATUS,
  hasNotificationSetupToFinish,
} from "../../../Types/OnCallDutyPolicy/NotificationSetupToFinish";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * ONE RULE FOR "THIS PERSON HAS THEIR NOTIFICATION SETUP TO FINISH" (#7040):
 * what the setup reminder mails about, what Readiness lets an admin pick, and
 * what the bell asks the person themselves to finish. Each reads it from
 * here, never a second definition beside it.
 */

describe("whether a person has their notification setup to finish", () => {
  test("nothing reaches them, or a severity has no rule: yes", () => {
    expect(
      hasNotificationSetupToFinish({ status: ReadinessStatus.NotReachable }),
    ).toBe(true);
    expect(
      hasNotificationSetupToFinish({ status: ReadinessStatus.PartiallyReady }),
    ).toBe(true);
  });

  test("Ready: no", () => {
    expect(
      hasNotificationSetupToFinish({ status: ReadinessStatus.Ready }),
    ).toBe(false);
    expect(
      hasNotificationSetupToFinish({
        status: ReadinessStatus.Ready,
        isMissingPhoneMethod: false,
      }),
    ).toBe(false);
  });

  test("Ready, while the project asks people on call for a phone method they do not have (#7449): yes", () => {
    expect(
      hasNotificationSetupToFinish({
        status: ReadinessStatus.Ready,
        isMissingPhoneMethod: true,
      }),
    ).toBe(true);
    expect(
      hasNotificationSetupToFinish({
        status: ReadinessStatus.NotReachable,
        isMissingPhoneMethod: true,
      }),
    ).toBe(true);
  });

  test("an answer from a server that says nothing of a phone reads as it always did", () => {
    expect(hasNotificationSetupToFinish({ status: "Ready" })).toBe(false);
    // A status it does not know is not Ready: never claimed done.
    expect(hasNotificationSetupToFinish({ status: "" })).toBe(true);
  });

  test("its Ready is the server's", () => {
    expect(READY_READINESS_STATUS).toBe(ReadinessStatus.Ready);
  });
});

describe("every place that says so reads this rule", () => {
  const ROOT: string = path.join(__dirname, "../../../..");

  const read: (file: string) => string = (file: string): string => {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
  };

  test.each([
    "Common/Server/Services/OnCallSetupReminderService.ts",
    "App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Readiness.tsx",
    "App/FeatureSet/Dashboard/src/Components/Header/NotificationSetupNudge.ts",
  ])("%s", (file: string) => {
    const source: string = read(file);

    expect(source).toContain("hasNotificationSetupToFinish(");
    // Not a second definition: it never reads the phone flag beside a status of its own.
    expect(source).not.toMatch(
      /status\s*[!=]==\s*(ReadinessStatus\.Ready|READINESS_STATUS_READY)[\s\S]{0,200}isMissingPhoneMethod/,
    );
  });
});
