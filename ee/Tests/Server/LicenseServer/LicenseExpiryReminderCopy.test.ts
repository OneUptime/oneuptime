import { describe, expect, test } from "@jest/globals";
import { ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import OneUptimeDate from "Common/Types/Date";
import fs from "fs";
import path from "path";
import {
  getLicenseExpiryReminderCopy,
  getLicenseGraceEndsAt,
  LAST_RELEASE_WHERE_SSO_STOPS_WITH_THE_LICENSE,
  LicenseExpiryReminderCopy,
} from "../../../Server/LicenseServer/LicenseExpiryReminderCopy";

/*
 * What the license expiry reminder email says about where a license stands.
 *
 * It used to tell customers to renew "to keep your self-hosted OneUptime
 * instances running". That was never what a lapse does: the instances keep
 * running. What stops, when the 30-day grace period after the expiry ends, is
 * SCIM provisioning and audit logging, and enterprise configuration becomes
 * read-only - until a renewed license is activated.
 *
 * Single sign-on is part of the Community Edition in the releases after
 * 14.0.10, so a lapse no longer stops it there. oneuptime.com sends this email
 * to every self-hosted version, though, and 14.0.10 and earlier still stop
 * single sign-on at the end of the grace period - so the email names single
 * sign-on only in one sentence scoped to those releases, never as something
 * that stops everywhere.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const MINUTE_IN_MS: number = 60 * 1000;
const EXPIRES_AT: Date = new Date("2026-09-01T12:00:00.000Z");

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");
const EMAIL_TEMPLATE: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Notification",
  "Templates",
  "EnterpriseLicenseExpiryReminder.hbs",
);

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

// One moment in each of the three states the email describes.
const BEFORE_EXPIRY: Date = new Date(EXPIRES_AT.getTime() - 10 * DAY_IN_MS);
const IN_GRACE_PERIOD: Date = new Date(EXPIRES_AT.getTime() + 3 * DAY_IN_MS);
const PAST_GRACE_PERIOD: Date = new Date(
  EXPIRES_AT.getTime() + 30 * DAY_IN_MS + 1,
);

const EVERY_STATE: Array<[string, Date]> = [
  ["before the expiry", BEFORE_EXPIRY],
  ["in the grace period", IN_GRACE_PERIOD],
  ["past the grace period", PAST_GRACE_PERIOD],
];

// What stops in every release, named the way the rest of the product names it.
const WHAT_STOPS: Array<string> = [
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

const SINGLE_SIGN_ON_WORDING: RegExp =
  /\bSSO\b|single sign-on|\bSAML\b|\bOIDC\b|OpenID Connect/i;

const OLDER_RELEASES: string = "On OneUptime 14.0.10 and earlier,";

/*
 * The sentences of a message. A sentence ends at a full stop followed by a
 * space, so the dots of a version number do not split one.
 */
const sentencesOf: (message: string) => Array<string> = (
  message: string,
): Array<string> => {
  return message.split(/(?<=\.)\s+/);
};

/*
 * True when the message names single sign-on in exactly one sentence, and
 * that sentence is about 14.0.10 and earlier.
 */
const namesSingleSignOnOnlyForOlderReleases: (message: string) => boolean = (
  message: string,
): boolean => {
  const mentions: Array<string> = sentencesOf(message).filter(
    (sentence: string) => {
      return SINGLE_SIGN_ON_WORDING.test(sentence);
    },
  );

  return mentions.length === 1 && mentions[0]!.startsWith(OLDER_RELEASES);
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
    const copy: LicenseExpiryReminderCopy = copyAt(BEFORE_EXPIRY);

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
      `without a renewal, SCIM provisioning and audit logging stop and enterprise configuration becomes read-only when the 30-day grace period after the expiry ends, on ${graceEndsOn}.`,
    );
    expect(copy.expiryStatusMessage).toContain(
      "On OneUptime 14.0.10 and earlier, single sign-on (SSO) stops then too.",
    );
    expectNamesWhatStops(copy.expiryStatusMessage);
    expect(copy.expiryStatusMessage).not.toContain("14-day");
  });

  test("expired, still inside the grace period: says when the features stop", () => {
    const copy: LicenseExpiryReminderCopy = copyAt(IN_GRACE_PERIOD);

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
      "when the grace period ends, SCIM provisioning and audit logging stop and enterprise configuration becomes read-only until a renewed license is activated.",
    );
    expect(copy.expiryStatusMessage).toContain(
      "On OneUptime 14.0.10 and earlier, single sign-on (SSO) stops then too.",
    );
    expectNamesWhatStops(copy.expiryStatusMessage);
    expect(copy.expiryStatusMessage).not.toContain("have stopped");
    expect(copy.expiryStatusMessage).not.toContain("has stopped");
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
    const copy: LicenseExpiryReminderCopy = copyAt(PAST_GRACE_PERIOD);

    expect(copy.expiryStatusMessage).toContain(
      `its 30-day grace period ended on ${graceEndsOn}`,
    );
    expect(copy.expiryStatusMessage).toContain(
      "SCIM provisioning and audit logging have stopped and enterprise configuration is read-only.",
    );
    expect(copy.expiryStatusMessage).toContain(
      "On OneUptime 14.0.10 and earlier, single sign-on (SSO) has stopped too.",
    );
    expect(copy.expiryStatusMessage).toContain(
      "everything resumes as soon as the renewed license is activated",
    );
    expectNamesWhatStops(copy.expiryStatusMessage);
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

describe("the license expiry reminder copy and single sign-on", () => {
  test("names 14.0.10 as the last release where single sign-on stops with the license", () => {
    expect(LAST_RELEASE_WHERE_SSO_STOPS_WITH_THE_LICENSE).toBe("14.0.10");
  });

  test.each(EVERY_STATE)(
    "%s: names single sign-on only in the sentence about 14.0.10 and earlier",
    (_state: string, now: Date) => {
      const message: string = copyAt(now).expiryStatusMessage;

      expect(namesSingleSignOnOnlyForOlderReleases(message)).toBe(true);
    },
  );

  test.each(EVERY_STATE)(
    "%s: never lists single sign-on with what stops in every release",
    (_state: string, now: Date) => {
      const message: string = copyAt(now).expiryStatusMessage;

      expect(message).not.toMatch(
        /single sign-on, SCIM provisioning and audit logging/,
      );
    },
  );

  test.each(EVERY_STATE)(
    "%s: never claims single sign-on keeps working without a license",
    (_state: string, now: Date) => {
      // Single sign-on as the subject of the verb, in the same sentence.
      expect(copyAt(now).expiryStatusMessage).not.toMatch(
        /\b(?:SSO|single sign-on|OIDC)\b[^.]{0,100}\b(?:keeps? (?:working|running)|never stops?|continues|still works|(?:is|are) not affected)\b/i,
      );
    },
  );

  test.each(EVERY_STATE)(
    "%s: the subject and title stay about the license, not single sign-on",
    (_state: string, now: Date) => {
      const copy: LicenseExpiryReminderCopy = copyAt(now);

      expect(copy.subject).not.toMatch(SINGLE_SIGN_ON_WORDING);
      expect(copy.emailTitle).not.toMatch(SINGLE_SIGN_ON_WORDING);
      expect(copy.expiryStatus).not.toMatch(SINGLE_SIGN_ON_WORDING);
    },
  );

  /*
   * The check above has to catch what this email said before single sign-on
   * moved into the Community Edition, or it proves nothing.
   */
  test.each([
    "Your OneUptime Enterprise license expires in 10 days. Please renew it before then. Your self-hosted OneUptime instances keep running either way, but without a renewal, single sign-on, SCIM provisioning and audit logging stop and enterprise configuration becomes read-only when the 30-day grace period after the expiry ends, on Oct 1, 2026. Here are the details:",
    "Your OneUptime Enterprise license expired 3 days ago. Your self-hosted OneUptime instances keep running, and every enterprise feature stays on until its 30-day grace period ends on Oct 1, 2026. Please renew it before then: when the grace period ends, single sign-on, SCIM provisioning and audit logging stop and enterprise configuration becomes read-only until a renewed license is activated. Here are the details:",
    "Your OneUptime Enterprise license expired 31 days ago, and its 30-day grace period ended on Oct 1, 2026. Your self-hosted OneUptime instances keep running, but single sign-on, SCIM provisioning and audit logging have stopped and enterprise configuration is read-only. Please renew the license: everything resumes as soon as the renewed license is activated. Here are the details:",
  ])(
    "the check catches the copy this email used to send: %s",
    (old: string) => {
      expect(namesSingleSignOnOnlyForOlderReleases(old)).toBe(false);
    },
  );

  test("the email template names the same release", () => {
    const template: string = fs.readFileSync(EMAIL_TEMPLATE, "utf8");

    expect(template).toContain(
      `On OneUptime ${LAST_RELEASE_WHERE_SSO_STOPS_WITH_THE_LICENSE} and earlier, SSO and OIDC sign-in stop too`,
    );
  });
});
