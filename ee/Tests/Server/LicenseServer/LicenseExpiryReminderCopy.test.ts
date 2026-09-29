import { describe, expect, test } from "@jest/globals";
import { ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import OneUptimeDate from "Common/Types/Date";
import {
  getLicenseExpiryReminderCopy,
  getLicenseGraceEndsAt,
  LicenseExpiryReminderCopy,
} from "../../../Server/LicenseServer/LicenseExpiryReminderCopy";

/*
 * What the license expiry reminder email says about where a license stands.
 *
 * It used to tell customers to renew "to keep your self-hosted OneUptime
 * instances running". That was never what a lapse does: the instances keep
 * running. What stops, when the 30-day grace period after the expiry ends, is
 * single sign-on, SCIM provisioning and audit logging, and enterprise
 * configuration becomes read-only - until a renewed license is activated.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const MINUTE_IN_MS: number = 60 * 1000;
const EXPIRES_AT: Date = new Date("2026-09-01T12:00:00.000Z");

const copyAt: (now: Date) => LicenseExpiryReminderCopy = (
  now: Date,
): LicenseExpiryReminderCopy => {
  return getLicenseExpiryReminderCopy({
    companyName: "Acme Inc",
    expiresAt: EXPIRES_AT,
    now,
  });
};

const graceEndsOn: string = OneUptimeDate.getDateAsFormattedString(
  new Date(EXPIRES_AT.getTime() + 30 * DAY_IN_MS),
  { onlyShowDate: true },
);

// What stops, named the way the rest of the product names it.
const WHAT_STOPS: Array<string> = [
  "single sign-on",
  "SCIM provisioning",
  "audit logging",
  "enterprise configuration",
  "read-only",
];

const expectNamesWhatStops: (message: string) => void = (
  message: string,
): void => {
  for (const phrase of WHAT_STOPS) {
    expect({ phrase, present: message.includes(phrase) }).toEqual({
      phrase,
      present: true,
    });
  }
};

describe("the license expiry reminder copy", () => {
  test("the grace period is 30 days after the expiry", () => {
    expect(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS).toBe(30);
    expect(getLicenseGraceEndsAt(EXPIRES_AT)).toEqual(
      new Date(EXPIRES_AT.getTime() + 30 * DAY_IN_MS),
    );
  });

  test("never says renewing keeps the instances running (they keep running either way)", () => {
    for (const now of [
      new Date(EXPIRES_AT.getTime() - 10 * DAY_IN_MS),
      new Date(EXPIRES_AT.getTime() - MINUTE_IN_MS),
      new Date(EXPIRES_AT.getTime() + 3 * DAY_IN_MS),
      new Date(EXPIRES_AT.getTime() + 31 * DAY_IN_MS),
    ]) {
      const message: string = copyAt(now).expiryStatusMessage;

      expect(message).not.toContain("to keep your self-hosted OneUptime");
      expect(message).toContain(
        "Your self-hosted OneUptime instances keep running",
      );
    }
  });

  test("before the expiry: renew, and what stops when the 30-day grace period after it ends", () => {
    const copy: LicenseExpiryReminderCopy = copyAt(
      new Date(EXPIRES_AT.getTime() - 10 * DAY_IN_MS),
    );

    expect(copy.subject).toBe(
      "[Reminder] OneUptime Enterprise license for Acme Inc expires in 10 days",
    );
    expect(copy.emailTitle).toBe(
      "Your OneUptime Enterprise license expires in 10 days",
    );
    expect(copy.expiryStatus).toBe("Expires in 10 days");
    expect(copy.expiryStatusMessage).toContain(
      "Your OneUptime Enterprise license expires in 10 days. Please renew it before then.",
    );
    expect(copy.expiryStatusMessage).toContain(
      `when the 30-day grace period after the expiry ends, on ${graceEndsOn}`,
    );
    expectNamesWhatStops(copy.expiryStatusMessage);
    expect(copy.expiryStatusMessage).not.toContain("14");
  });

  test("expired, still inside the grace period: says when the features stop", () => {
    const copy: LicenseExpiryReminderCopy = copyAt(
      new Date(EXPIRES_AT.getTime() + 3 * DAY_IN_MS),
    );

    expect(copy.subject).toBe(
      "[Action Required] OneUptime Enterprise license for Acme Inc has expired",
    );
    expect(copy.emailTitle).toBe(
      "Your OneUptime Enterprise license has expired",
    );
    expect(copy.expiryStatus).toBe("Expired 3 days ago");
    expect(copy.expiryStatusMessage).toContain(
      `every enterprise feature stays on until its 30-day grace period ends on ${graceEndsOn}`,
    );
    expect(copy.expiryStatusMessage).toContain(
      "when the grace period ends, single sign-on, SCIM provisioning and audit logging stop and enterprise configuration becomes read-only until a renewed license is activated",
    );
    expectNamesWhatStops(copy.expiryStatusMessage);
    expect(copy.expiryStatusMessage).not.toContain("have stopped");
  });

  test("expired, 29 days 23 hours 59 minutes ago: still inside the grace period", () => {
    expect(
      copyAt(new Date(EXPIRES_AT.getTime() + 30 * DAY_IN_MS - MINUTE_IN_MS))
        .expiryStatusMessage,
    ).toContain("stays on until its 30-day grace period ends");
  });

  test("expired, at the last moment of the grace period: still inside it (inclusive, like the classifier)", () => {
    expect(
      copyAt(new Date(EXPIRES_AT.getTime() + 30 * DAY_IN_MS))
        .expiryStatusMessage,
    ).toContain("stays on until its 30-day grace period ends");
  });

  test("expired, just past the grace period: says the features have stopped", () => {
    const copy: LicenseExpiryReminderCopy = copyAt(
      new Date(EXPIRES_AT.getTime() + 30 * DAY_IN_MS + 1),
    );

    expect(copy.expiryStatusMessage).toContain(
      `its 30-day grace period ended on ${graceEndsOn}`,
    );
    expect(copy.expiryStatusMessage).toContain(
      "single sign-on, SCIM provisioning and audit logging have stopped and enterprise configuration is read-only",
    );
    expect(copy.expiryStatusMessage).toContain(
      "everything resumes as soon as the renewed license is activated",
    );
    expect(copy.expiryStatusMessage).not.toContain("stays on");
  });

  test("expires today and expired today read naturally", () => {
    expect(
      copyAt(new Date(EXPIRES_AT.getTime() - MINUTE_IN_MS)).expiryStatus,
    ).toBe("Expires today");
    expect(copyAt(EXPIRES_AT).expiryStatus).toBe("Expired today");
    expect(
      copyAt(new Date(EXPIRES_AT.getTime() + DAY_IN_MS)).expiryStatus,
    ).toBe("Expired 1 day ago");
  });
});
