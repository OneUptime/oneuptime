import {
  describeLicenseStatus,
  describeLicenseWriteOutcome,
  isLicensed,
  isUnlicensedTrial,
  LICENSE_STORED_BUT_NOT_LICENSING,
  LicenseStatusSummary,
  LicenseWriteOutcome,
  toLicenseSnapshot,
  writeLicenseDate,
} from "../../../AdminDashboard/License/LicenseStatus";
import { LicenseStatusCopy } from "../../../AdminDashboard/License/LicenseSettingsCopy";
import { withoutIsolateMarks } from "Common/Tests/Helpers/IsolateMarks";
import { inEnglishDates } from "Common/Types/DateLanguage";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "Common/Types/ReadingDirection";
import { createTranslator, Translator } from "Common/Types/Translator";
import {
  GRACE_ENFORCEMENT_SUMMARY,
  LICENSE_LAPSED_STATE,
  TRIAL_ENFORCEMENT_SUMMARY,
} from "Common/UI/Components/EditionLabel/EditionLabel";
import { LicenseSnapshot } from "Common/UI/Components/EditionLabel/LicenseDetails";
import {
  getLicenseSeatUsage,
  LicenseSeatUsage,
} from "Common/UI/Components/EditionLabel/LicenseSeatUsage";
import { JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "@jest/globals";

/*
 * What Settings > License says about the license, from what the server
 * answers. Pure, so every state of a license is pinned here, and the page's
 * tests can stay on what a master admin does.
 */

const NOW: Date = new Date("2026-06-15T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const inDays: (days: number) => string = (days: number): string => {
  return new Date(NOW.getTime() + days * DAY_IN_MS).toISOString();
};

// A date as an English sentence of the page writes it: "25 Jun 2026".
const dateOf: (iso: string) => string = (iso: string): string => {
  return inEnglishDates((): string => {
    return writeLicenseDate(new Date(iso));
  });
};

type PayloadFunction = (overrides?: Record<string, unknown>) => JSONObject;

const payloadOf: PayloadFunction = (
  overrides?: Record<string, unknown>,
): JSONObject => {
  return {
    status: "valid",
    verification: "verified",
    graceReason: null,
    graceEndsAt: null,
    licenseValid: true,
    companyName: "Acme Inc",
    expiresAt: inDays(200),
    isEvaluation: false,
    marketplace: null,
    marketplaceBilling: null,
    message: null,
    licenseKey: "acme-license-key",
    token: "signed.license.token",
    activationMode: "online",
    userLimit: 50,
    currentUserCount: 10,
    isSeatLimitEnforced: false,
    seatsInUse: null,
    canAddMoreUsers: true,
    currentVersion: "13.0.0",
    latestVersion: "13.0.0",
    ...(overrides || {}),
  };
};

const trialOf: PayloadFunction = (
  overrides?: Record<string, unknown>,
): JSONObject => {
  return payloadOf({
    status: "grace",
    graceReason: "unlicensed",
    graceEndsAt: inDays(10),
    verification: "none",
    token: null,
    licenseKey: null,
    expiresAt: null,
    ...(overrides || {}),
  });
};

const describeOf: (payload: JSONObject) => LicenseStatusSummary = (
  payload: JSONObject,
): LicenseStatusSummary => {
  return describeLicenseStatus(payload, NOW);
};

describe("a valid license", () => {
  it("reads as active, with no warning", () => {
    expect(describeOf(payloadOf())).toEqual({
      tone: "healthy",
      title: "License active",
      description: "Enterprise features are on for this installation.",
    });
  });

  it("says when it is an evaluation license, and never that it is a production one", () => {
    const status: LicenseStatusSummary = describeOf(
      payloadOf({ isEvaluation: true }),
    );

    expect(status.tone).toBe("healthy");
    expect(status.title).toBe("Evaluation license active");
    expect(status.description).toContain("not licensed for production use");
  });

  it("explains a legacy license it cannot verify offline", () => {
    const status: LicenseStatusSummary = describeOf(
      payloadOf({ verification: "unverified" }),
    );

    expect(status.tone).toBe("healthy");
    expect(status.title).toBe("License active");
    expect(status.description).toContain("cannot verify it offline");
  });
});

describe("the trial", () => {
  it("counts the days and says when it ends, and what stops then", () => {
    const status: LicenseStatusSummary = describeOf(trialOf());

    expect(status.tone).toBe("warning");
    expect(status.title).toBe("Enterprise Edition trial: 10 days left");
    expect(status.description).toBe(
      `No Enterprise license is installed. Enterprise features stay fully available until ${dateOf(inDays(10))}, counted from the first time this installation ran the Enterprise Edition.`,
    );
    expect(status.note).toBe(TRIAL_ENFORCEMENT_SUMMARY);
    expect(status.serverMessage).toBeUndefined();
  });

  it("says one day, not one days", () => {
    expect(describeOf(trialOf({ graceEndsAt: inDays(0.5) })).title).toBe(
      "Enterprise Edition trial: 1 day left",
    );
  });

  it("rounds a part of a day up: a day that has started is still left", () => {
    expect(describeOf(trialOf({ graceEndsAt: inDays(2.1) })).title).toBe(
      "Enterprise Edition trial: 3 days left",
    );
  });

  it("never counts below zero", () => {
    expect(describeOf(trialOf({ graceEndsAt: inDays(-3) })).title).toBe(
      "Enterprise Edition trial: 0 days left",
    );
  });

  it("makes no claim about a date the server did not send", () => {
    const status: LicenseStatusSummary = describeOf(
      trialOf({ graceEndsAt: null }),
    );

    expect(status.title).toBe("Enterprise Edition trial");
    expect(status.description).toContain(
      "Enterprise features stay fully available, counted from the first time this installation ran the Enterprise Edition.",
    );
  });

  it("makes no claim about a date it cannot read", () => {
    expect(describeOf(trialOf({ graceEndsAt: "not a date" })).title).toBe(
      "Enterprise Edition trial",
    );
  });

  /*
   * A token with no expiry beside it falls back to the same trial. A paying
   * customer must not be told that no license is installed.
   */
  it("does not tell somebody holding a license that none is installed", () => {
    const status: LicenseStatusSummary = describeOf(
      trialOf({
        token: "signed.license.token",
        verification: "unverified",
        message: "This license has no recorded expiry.",
      }),
    );

    expect(status.description).toContain("A license is installed");
    expect(status.description).not.toContain("No Enterprise license");
    // The client's diagnosis, as it said it, on a line of its own.
    expect(status.serverMessage).toBe("This license has no recorded expiry.");
    expect(status.description).not.toContain("no recorded expiry");
  });

  it("leaves out a message for an install with no license at all", () => {
    const status: LicenseStatusSummary = describeOf(
      trialOf({ message: "No OneUptime Enterprise license is installed." }),
    );

    expect(status.description).not.toContain("No OneUptime Enterprise license");
    expect(status.serverMessage).toBeUndefined();
  });
});

describe("an expired license in its grace period", () => {
  const grace: PayloadFunction = (
    overrides?: Record<string, unknown>,
  ): JSONObject => {
    return payloadOf({
      status: "grace",
      graceReason: "expired",
      expiresAt: inDays(-5),
      graceEndsAt: inDays(25),
      ...(overrides || {}),
    });
  };

  it("says when it expired, when the grace ends, and what to do", () => {
    const status: LicenseStatusSummary = describeOf(grace());

    expect(status.tone).toBe("warning");
    expect(status.title).toBe(
      `License expired, grace period until ${dateOf(inDays(25))}`,
    );
    expect(status.description).toContain(
      `The Enterprise license expired on ${dateOf(inDays(-5))}.`,
    );
    expect(status.description).toContain("(25 days left)");
    expect(status.description).toContain(
      "Renew the license with OneUptime, then refresh it here.",
    );
    expect(status.note).toBe(GRACE_ENFORCEMENT_SUMMARY);
  });

  it("never calls it a trial", () => {
    const status: LicenseStatusSummary = describeOf(grace());

    expect(status.title).not.toMatch(/trial/i);
    expect(status.description).not.toMatch(/trial/i);
  });

  it("makes no claim about dates the server did not send", () => {
    const status: LicenseStatusSummary = describeOf(
      grace({ expiresAt: null, graceEndsAt: null }),
    );

    expect(status.title).toBe("License expired, grace period");
    expect(status.description).toContain("The Enterprise license expired.");
    expect(status.description).toContain(
      "Every enterprise feature keeps working until the grace period ends.",
    );
  });
});

describe("no usable license", () => {
  it("says an expired license has expired, and when", () => {
    const status: LicenseStatusSummary = describeOf(
      payloadOf({
        status: "expired",
        licenseValid: false,
        expiresAt: inDays(-40),
      }),
    );

    expect(status.tone).toBe("critical");
    expect(status.title).toBe("License expired");
    expect(status.description).toBe(
      `The Enterprise license expired on ${dateOf(inDays(-40))} and its grace period is over.`,
    );
    expect(status.note).toBe(LICENSE_LAPSED_STATE);
  });

  it("says what the license client said about an invalid license", () => {
    const status: LicenseStatusSummary = describeOf(
      payloadOf({
        status: "invalid",
        licenseValid: false,
        message: "The stored license does not match this instance.",
      }),
    );

    expect(status.tone).toBe("critical");
    expect(status.title).toBe("License not valid");
    /*
     * The page's own sentence says what it means and what to do, and the
     * client's reason follows as it was sent: a reader of another language
     * is never left with the English reason alone.
     */
    expect(status.description).toBe(
      "The stored license could not be verified. Validate the license again.",
    );
    expect(status.serverMessage).toBe(
      "The stored license does not match this instance.",
    );
    expect(status.note).toBe(LICENSE_LAPSED_STATE);
  });

  it("falls back to its own words for an invalid license with no message", () => {
    const status: LicenseStatusSummary = describeOf(
      payloadOf({ status: "invalid", licenseValid: false }),
    );

    expect(status.description).toBe(
      "The stored license could not be verified. Validate the license again.",
    );
    expect(status.serverMessage).toBeUndefined();
  });

  it("says there is none", () => {
    const status: LicenseStatusSummary = describeOf(
      payloadOf({
        status: "missing",
        verification: "none",
        licenseValid: false,
        token: null,
        licenseKey: null,
      }),
    );

    expect(status.title).toBe("No valid license");
    expect(status.description).toBe(
      "This installation has no valid Enterprise license.",
    );
  });

  it("tells a held license apart from no license, with the client's diagnosis", () => {
    const status: LicenseStatusSummary = describeOf(
      payloadOf({
        status: "missing",
        verification: "unverified",
        licenseValid: false,
        message: "No expiry is recorded for it.",
      }),
    );

    expect(status.description).toContain("A license is installed");
    expect(status.serverMessage).toBe("No expiry is recorded for it.");
  });

  /*
   * The two sentences a verified license gets from the client say nothing the
   * page's own sentence does not; anything else is a diagnosis and is shown.
   */
  it.each([
    ["expired", "The OneUptime Enterprise license has expired."],
    ["missing", "No OneUptime Enterprise license is installed."],
  ])(
    "does not repeat the license client's plain reading of %s",
    (status: string, message: string) => {
      const summary: LicenseStatusSummary = describeOf(
        payloadOf({
          status,
          licenseValid: false,
          message,
          token: null,
          verification: "none",
        }),
      );

      expect(summary.description).not.toContain(message);
      expect(summary.serverMessage).toBeUndefined();
    },
  );

  it("keeps a message that adds a reason", () => {
    const message: string =
      "The OneUptime Enterprise license has expired. It could not be verified offline.";

    expect(
      describeOf(payloadOf({ status: "expired", licenseValid: false, message }))
        .serverMessage,
    ).toBe(message);
  });

  /*
   * If the client's wording ever moves, the page would only show both
   * sentences; still, the list above is meant to be those two.
   */
  it("lists the sentences the license client actually writes", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "Server",
        "License",
        "LicenseToken.ts",
      ),
      "utf8",
    );

    expect(source).toContain("The OneUptime Enterprise license has expired.");
    expect(source).toContain("No OneUptime Enterprise license is installed.");
  });

  it("says the same as the dialog about what has stopped", () => {
    for (const status of ["expired", "missing", "invalid"]) {
      expect(describeOf(payloadOf({ status, licenseValid: false })).note).toBe(
        LICENSE_LAPSED_STATE,
      );
    }
  });
});

describe("a marketplace license", () => {
  const marketplace: PayloadFunction = (
    overrides?: Record<string, unknown>,
  ): JSONObject => {
    return payloadOf({
      marketplace: "AWS",
      licenseKey: null,
      ...(overrides || {}),
    });
  };

  it("says where it comes from", () => {
    const status: LicenseStatusSummary = describeOf(marketplace());

    expect(status.tone).toBe("healthy");
    expect(status.title).toBe("Licensed through AWS Marketplace");
    expect(status.description).toContain("billed by the hour");
    expect(status.note).toBeUndefined();
  });

  it("speaks of the reports while they are not accepted, never of renewing", () => {
    const status: LicenseStatusSummary = describeOf(
      marketplace({ status: "grace", graceEndsAt: inDays(4) }),
    );

    expect(status.tone).toBe("warning");
    expect(status.title).toBe("AWS Marketplace is not accepting usage reports");
    expect(status.description).toContain(dateOf(inDays(4)));
    expect(status.description).not.toMatch(/renew/i);
  });

  it("says the subscription no longer licenses the installation", () => {
    const status: LicenseStatusSummary = describeOf(
      marketplace({
        status: "expired",
        licenseValid: false,
        message: "AWS Marketplace says this installation is not subscribed.",
      }),
    );

    expect(status.tone).toBe("critical");
    expect(status.title).toBe(
      "AWS Marketplace no longer licenses this installation",
    );
    expect(status.serverMessage).toContain("not subscribed");
    expect(status.description).not.toContain("not subscribed");
    expect(status.description).toContain(LICENSE_LAPSED_STATE);
  });

  it("shows the last reporting problem, where there is one", () => {
    expect(
      describeOf(
        marketplace({ marketplaceBilling: { lastProblem: "Access denied." } }),
      ).note,
    ).toBe("Last reporting problem: Access denied.");
  });

  it.each([
    ["AWS", "AWS Marketplace"],
    ["Azure", "Microsoft Marketplace"],
    ["GoogleCloud", "Google Cloud Marketplace"],
  ])("names %s the way the listing does", (value: string, name: string) => {
    expect(describeOf(marketplace({ marketplace: value })).title).toContain(
      name,
    );
  });

  it("ignores a marketplace it does not know", () => {
    expect(describeOf(marketplace({ marketplace: "Elsewhere" })).title).toBe(
      "License active",
    );
  });
});

describe("whether there is a license", () => {
  it("is a valid license", () => {
    expect(isLicensed(payloadOf())).toBe(true);
    expect(isUnlicensedTrial(payloadOf())).toBe(false);
  });

  it("is an expired license in its grace period: everything still works", () => {
    const grace: JSONObject = payloadOf({
      status: "grace",
      graceReason: "expired",
    });

    expect(isLicensed(grace)).toBe(true);
    expect(isUnlicensedTrial(grace)).toBe(false);
  });

  it("is not the trial, valid as the server says it is", () => {
    expect(isLicensed(trialOf())).toBe(false);
    expect(isUnlicensedTrial(trialOf())).toBe(true);
  });

  it.each(["expired", "missing", "invalid"])(
    "is not a %s license",
    (status: string) => {
      expect(isLicensed(payloadOf({ status, licenseValid: false }))).toBe(
        false,
      );
    },
  );

  it("is not an answer that says nothing", () => {
    expect(isLicensed({})).toBe(false);
  });
});

describe("what the seat and instance cards read", () => {
  it("is what the server answered", () => {
    const body: JSONObject = payloadOf();
    const snapshot: LicenseSnapshot = toLicenseSnapshot(body);

    expect(snapshot).toEqual(
      expect.objectContaining({
        payload: body,
        canManageLicense: true,
        showLicenseDetails: true,
        companyName: "Acme Inc",
        licenseKey: "acme-license-key",
        userLimit: 50,
        currentUserCount: 10,
        effectiveUserCount: 10,
        isSeatLimitEnforced: false,
        canAddMoreUsers: true,
        seatTone: "healthy",
        seatUsageDisplayPercent: 20,
        currentVersion: "13.0.0",
        latestVersion: "13.0.0",
        hasComparableVersion: true,
      }),
    );
  });

  it("reads the figures through the calculation the pill uses", () => {
    const body: JSONObject = payloadOf({
      isSeatLimitEnforced: true,
      seatsInUse: 50,
      canAddMoreUsers: false,
    });

    const usage: LicenseSeatUsage = getLicenseSeatUsage({
      licenseValid: true,
      userLimit: 50,
      currentUserCount: 10,
      isSeatLimitEnforced: true,
      enforcedSeatsInUse: 50,
      canAddMoreUsers: false,
    });

    expect(toLicenseSnapshot(body)).toEqual(
      expect.objectContaining({
        effectiveUserCount: usage.effectiveUserCount,
        seatTone: usage.seatTone,
        seatUsageDisplayPercent: usage.seatUsageDisplayPercent,
      }),
    );
  });

  it("never warns about seats it has no evidence for", () => {
    const snapshot: LicenseSnapshot = toLicenseSnapshot({ licenseValid: true });

    expect(snapshot.canAddMoreUsers).toBe(true);
    expect(snapshot.seatTone).toBe("healthy");
    expect(snapshot.effectiveUserCount).toBeNull();
    expect(snapshot.seatUsageDisplayPercent).toBeNull();
    expect(snapshot.licenseKey).toBe("");
    expect(snapshot.companyName).toBe("");
  });

  it("does not compare a build that has no version", () => {
    expect(
      toLicenseSnapshot(payloadOf({ currentVersion: "unknown" }))
        .hasComparableVersion,
    ).toBe(false);
  });

  it("shows no details for the trial", () => {
    expect(toLicenseSnapshot(trialOf()).showLicenseDetails).toBe(false);
  });
});

describe("what a write the server accepted means", () => {
  const SUCCESS: string = "License validated successfully.";

  const outcomeOf: (payload: JSONObject) => LicenseWriteOutcome = (
    payload: JSONObject,
  ): LicenseWriteOutcome => {
    return describeLicenseWriteOutcome(payload, SUCCESS);
  };

  it("is a success for a valid license", () => {
    expect(outcomeOf(payloadOf())).toEqual({
      isLicensed: true,
      message: SUCCESS,
    });
  });

  it("is a success for a license in its own grace period", () => {
    expect(
      outcomeOf(payloadOf({ status: "grace", graceReason: "expired" })),
    ).toEqual({ isLicensed: true, message: SUCCESS });
  });

  it("is a success from a build that says nothing about the status", () => {
    expect(outcomeOf({})).toEqual({ isLicensed: true, message: SUCCESS });
  });

  it.each([
    ["the trial", { status: "grace", graceReason: "unlicensed" }],
    ["no license", { status: "missing" }],
    ["an expired license", { status: "expired" }],
    ["an invalid license", { status: "invalid" }],
  ])(
    "is a warning, in the server's words, on %s",
    (_name: string, overrides: Record<string, unknown>) => {
      expect(outcomeOf({ ...overrides, message: "Why it is not." })).toEqual({
        isLicensed: false,
        message: "Why it is not.",
      });
    },
  );

  it("is a warning in its own words when the server gives none", () => {
    expect(outcomeOf({ status: "missing" })).toEqual({
      isLicensed: false,
      message: LICENSE_STORED_BUT_NOT_LICENSING,
    });
  });

  it("never shows anything but text", () => {
    expect(
      outcomeOf({ status: "missing", message: { nested: true } }).message,
    ).toBe(LICENSE_STORED_BUT_NOT_LICENSING);
  });

  it("warns with a sentence of the page's copy, which the alert translates", () => {
    expect(LICENSE_STORED_BUT_NOT_LICENSING).toBe(
      LicenseStatusCopy.storedButNotLicensing,
    );
  });
});

/*
 * IN THE READER'S LANGUAGE (#7132). The status is written with the
 * translator the page hands it, from the Admin Dashboard's own locale: its
 * sentences in the reader's language, the dates in them written as the
 * sentence is, the counts in the reader's digits - and what the license
 * client said kept apart, as it said it.
 */
describe("the status in the reader's language", () => {
  const ADMIN_LOCALES: string = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "packages/App/FeatureSet/AdminDashboard/src/Locales",
  );

  const translatorFor: (language: string) => Translator = (
    language: string,
  ): Translator => {
    const words: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(ADMIN_LOCALES, `${language}.json`), "utf8"),
    ) as Record<string, unknown>;

    return createTranslator((key: string): string | undefined => {
      const value: unknown = words[key];

      return typeof value === "string" ? value : undefined;
    }, language);
  };

  // Ten whole days before the second of March 2027.
  const TODAY: Date = new Date("2027-02-20T12:00:00.000Z");
  const MARCH: string = "2027-03-02T12:00:00.000Z";

  const inLanguage: (
    payload: JSONObject,
    language: string,
  ) => LicenseStatusSummary = (
    payload: JSONObject,
    language: string,
  ): LicenseStatusSummary => {
    const summary: LicenseStatusSummary = describeLicenseStatus(
      payload,
      TODAY,
      translatorFor(language),
    );

    return {
      ...summary,
      title: withoutIsolateMarks(summary.title),
      description: withoutIsolateMarks(summary.description),
      note: summary.note ? withoutIsolateMarks(summary.note) : summary.note,
    };
  };

  it("German: a license in place", () => {
    expect(inLanguage(payloadOf(), "de")).toEqual({
      tone: "healthy",
      title: "Lizenz aktiv",
      description:
        "Enterprise-Funktionen sind für diese Installation aktiviert.",
    });
  });

  it("German: the trial's days and its end, a German date in a German sentence", () => {
    const status: LicenseStatusSummary = inLanguage(
      trialOf({ graceEndsAt: MARCH }),
      "de",
    );

    expect(status.title).toBe("Testphase der Enterprise Edition: noch 10 Tage");
    expect(status.description).toContain("2. März 2027");
    expect(status.description).not.toContain("Mar 2027");
    expect(status.description).not.toContain("3/2/2027");
    expect(status.note).toContain("14");
    expect(status.note).not.toContain("Without a valid license");
  });

  it("English: the same trial, an English date", () => {
    const status: LicenseStatusSummary = describeLicenseStatus(
      trialOf({ graceEndsAt: MARCH }),
      TODAY,
    );

    expect(status.title).toBe("Enterprise Edition trial: 10 days left");
    expect(status.description).toContain("02 Mar 2027");
  });

  /*
   * Persian keeps "Enterprise Edition" in Latin letters in the trial's
   * title. Without an isolate around the days left, the browser drew their
   * Persian digits inside that Latin run, on the far side of the colon:
   * "دورهٔ آزمایشی ۱۰ :Enterprise Edition روز مانده".
   */
  it("Persian: the trial's days left are set apart from the Latin edition name", () => {
    const title: string = describeLicenseStatus(
      trialOf({ graceEndsAt: MARCH }),
      TODAY,
      translatorFor("fa"),
    ).title;

    expect(title).toBe(
      `دورهٔ آزمایشی Enterprise Edition: ${FIRST_STRONG_ISOLATE}۱۰ روز مانده${POP_DIRECTIONAL_ISOLATE}`,
    );
  });

  it("Persian: a marketplace's English name and reporting problem sit in runs of their own", () => {
    const status: LicenseStatusSummary = describeLicenseStatus(
      payloadOf({
        marketplace: "AWS",
        licenseKey: null,
        marketplaceBilling: { lastProblem: "AccessDeniedException" },
      }),
      TODAY,
      translatorFor("fa"),
    );

    expect(status.title).toContain(
      `${FIRST_STRONG_ISOLATE}AWS Marketplace${POP_DIRECTIONAL_ISOLATE}`,
    );
    expect(status.note).toContain(
      `${FIRST_STRONG_ISOLATE}AccessDeniedException${POP_DIRECTIONAL_ISOLATE}`,
    );
  });

  it("English and German: nothing to set apart, so no isolate marks", () => {
    for (const translator of [undefined, translatorFor("de")]) {
      const status: LicenseStatusSummary = describeLicenseStatus(
        trialOf({ graceEndsAt: MARCH }),
        TODAY,
        translator,
      );

      for (const text of [status.title, status.description, status.note]) {
        expect(withoutIsolateMarks(text || "")).toBe(text || "");
      }
    }
  });

  it("Persian: the days in Persian digits, the date a Persian date", () => {
    const status: LicenseStatusSummary = inLanguage(
      trialOf({ graceEndsAt: MARCH }),
      "fa",
    );

    expect(status.title).toContain("۱۰");
    expect(status.title).not.toMatch(/[0-9]/);
    expect(status.description).toContain("۲۰۲۷");
    expect(status.description).not.toContain("2027");
  });

  it("Russian: an expired license's grace period, and what to do here", () => {
    const status: LicenseStatusSummary = inLanguage(
      payloadOf({
        status: "grace",
        graceReason: "expired",
        expiresAt: "2027-02-10T12:00:00.000Z",
        graceEndsAt: MARCH,
      }),
      "ru",
    );

    expect(status.title).toMatch(/^Лицензия истекла, льготный период до /);
    expect(status.title).toContain("2027");
    expect(status.title).not.toContain("Mar");
    expect(status.description).toContain(
      "Продлите лицензию в OneUptime, затем обновите её здесь.",
    );
    expect(status.description).toContain("осталось 10 дн.");
  });

  it.each(["de", "fa", "ar", "ru"])(
    "%s: what the license client said is kept apart, as it said it",
    (language: string) => {
      const message: string =
        "The stored license does not match this instance.";
      const invalid: LicenseStatusSummary = inLanguage(
        payloadOf({ status: "invalid", licenseValid: false, message }),
        language,
      );

      expect(invalid.serverMessage).toBe(message);
      // The page's own sentence first, in the reader's language.
      expect(invalid.description).toBe(
        translatorFor(language).translateText(
          LicenseStatusCopy.couldNotBeVerified,
        ),
      );
      expect(invalid.description).not.toBe(
        LicenseStatusCopy.couldNotBeVerified,
      );
      expect(invalid.description).not.toContain(message);
      expect(invalid.title).toBe(
        translatorFor(language).translateText(
          LicenseStatusCopy.licenseNotValid,
        ),
      );
      expect(invalid.title).not.toBe("License not valid");

      const held: LicenseStatusSummary = inLanguage(
        payloadOf({
          status: "missing",
          verification: "unverified",
          licenseValid: false,
          message: "No expiry is recorded for it.",
        }),
        language,
      );

      expect(held.serverMessage).toBe("No expiry is recorded for it.");
      expect(held.description).not.toContain("No expiry is recorded");
    },
  );

  it("Arabic: the marketplace's name as the listing writes it, in an Arabic sentence", () => {
    const status: LicenseStatusSummary = inLanguage(
      payloadOf({ marketplace: "AWS", licenseKey: null }),
      "ar",
    );

    expect(status.title).toContain("AWS Marketplace");
    expect(status.title).not.toBe("Licensed through AWS Marketplace");
  });

  /*
   * A sentence a language has no wording for is drawn in English, and its
   * date with it: an English sentence never holds a German date.
   */
  it("an English sentence keeps an English date on a German page", () => {
    const unworded: Translator = createTranslator((): string | undefined => {
      return undefined;
    }, "de");
    const status: LicenseStatusSummary = describeLicenseStatus(
      trialOf({ graceEndsAt: MARCH }),
      TODAY,
      unworded,
    );

    expect(withoutIsolateMarks(status.description)).toContain("02 Mar 2027");
    expect(status.description).not.toContain("März");
  });
});
