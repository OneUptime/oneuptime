import { DAYS_LEFT, LicenseStatusCopy } from "./LicenseSettingsCopy";
import OneUptimeDate from "Common/Types/Date";
import {
  inEnglishDates,
  isEnglishDateLanguage,
  withDateDisplayLanguage,
} from "Common/Types/DateLanguage";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";
import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
import {
  ComposedValue,
  composedValue,
  createTranslator,
  SentenceOptions,
  TemplateValues,
  Translator,
} from "Common/Types/Translator";
import {
  GRACE_ENFORCEMENT_TEMPLATE,
  LICENSE_LAPSED_STATE,
  TRIAL_ENFORCEMENT_TEMPLATE,
} from "Common/UI/Components/EditionLabel/EditionLabel";
import { LicenseSnapshot } from "Common/UI/Components/EditionLabel/LicenseDetails";
import {
  getLicenseSeatUsage,
  LicenseSeatUsage,
} from "Common/UI/Components/EditionLabel/LicenseSeatUsage";
import VersionUtil from "Common/Utils/VersionUtil";

/*
 * What Settings > License says about the license, read from the answer of
 * GET /global-config/license (or of a write, which answers with the same
 * body). Pure, and free of React.
 *
 * In the reader's language: every sentence is a key of LicenseStatusCopy
 * (./LicenseSettingsCopy.ts), most of them the edition dialog's own, and
 * each date is written as the sentence around it is. What the license client
 * itself said (the server's message) is not OneUptime's to word: it is kept
 * apart, as written, so the page draws it on a line of its own.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// The sentences of a reader whose language is not known: English.
const ENGLISH: Translator = createTranslator(undefined, "en");

type DrawnOnThePageFunction = (translator: Translator) => Translator;

/*
 * The reader's translator, for sentences drawn on the page and nothing else
 * (a summary is never stored or sent): each value is set apart from its
 * sentence where it could move the words around it (SentenceOptions'
 * setsValuesApart). On a Persian page "Enterprise Edition trial: 10 days
 * left" keeps "Enterprise Edition" in Latin letters, and without the
 * isolate the browser drew the days' Persian digits beside it, inside the
 * Latin run: "دورهٔ آزمایشی ۱۰ :Enterprise Edition روز مانده" - the count on
 * the wrong side of the colon, away from its "days left". A marketplace's
 * name and a reporting problem in English sit in their own runs the same way.
 */
const drawnOnThePage: DrawnOnThePageFunction = (
  translator: Translator,
): Translator => {
  return {
    ...translator,
    translateTemplate: (
      template: string,
      values?: TemplateValues,
      options?: SentenceOptions,
    ): string => {
      return translator.translateTemplate(template, values, {
        setsValuesApart: true,
        ...options,
      });
    },
  };
};

/*
 * What the license client (LicenseToken.ts) says when it has nothing to add
 * to the status. The page's own sentence already says it, with the date.
 * Anything else in the message is a diagnosis, and is shown.
 */
const PLAIN_STATUS_MESSAGES: ReadonlyArray<string> = [
  "The OneUptime Enterprise license has expired.",
  "No OneUptime Enterprise license is installed.",
];

export type LicenseStatusTone = "healthy" | "warning" | "critical";

export interface LicenseStatusSummary {
  tone: LicenseStatusTone;
  title: string;
  // Where the license stands and what to do, in a sentence or two.
  description: string;
  /*
   * What the license client said about it, as the server sent it: a
   * diagnosis in English, drawn on a line of its own so it reads in its own
   * direction on an Arabic or Persian page.
   */
  serverMessage?: string | undefined;
  // What happens if nobody does: smaller, so the form stays near the top.
  note?: string | undefined;
}

type JoinSentencesFunction = (
  sentences: Array<string | null | undefined>,
) => string;

const joinSentences: JoinSentencesFunction = (
  sentences: Array<string | null | undefined>,
): string => {
  return sentences.filter(Boolean).join(" ");
};

type ToDateFunction = (value: unknown) => Date | null;

const toDate: ToDateFunction = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = OneUptimeDate.fromString(value);

  return Number.isNaN(date.getTime()) ? null : date;
};

type ToNumberFunction = (value: unknown) => number | null;

const toNumber: ToNumberFunction = (value: unknown): number | null => {
  return typeof value === "number" ? value : null;
};

type ToStringFunction = (value: unknown) => string;

const toText: ToStringFunction = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

type WriteDateFunction = (date: Date) => string;

/*
 * A date as the page writes one, with its day, its month and its year:
 * "02 Mar 2026", "2. März 2026", "۲ مارس ۲۰۲۶" - in the page's language
 * (OneUptimeDate's display language), never the browser's.
 */
export const writeLicenseDate: WriteDateFunction = (date: Date): string => {
  return OneUptimeDate.getDateAsLocalDayMonthYearString(date);
};

type DateInSentenceFunction = (date: Date) => ComposedValue;

/*
 * A date inside a sentence, in the sentence's language: the reader's where
 * their language words the sentence, English where it does not - so an
 * English sentence never holds a German date.
 */
const dateInSentence: DateInSentenceFunction = (date: Date): ComposedValue => {
  return composedValue((sentence: Translator): string => {
    const write: () => string = (): string => {
      return writeLicenseDate(date);
    };

    return isEnglishDateLanguage(sentence.language)
      ? inEnglishDates(write)
      : withDateDisplayLanguage(sentence.language, write);
  });
};

type DaysLeftFunction = (daysLeft: number) => ComposedValue;

// "10 days left", in the sentence's language, the count in the reader's digits.
const daysLeftInSentence: DaysLeftFunction = (
  daysLeft: number,
): ComposedValue => {
  return composedValue((sentence: Translator): string => {
    return sentence.translatePlural(DAYS_LEFT, daysLeft);
  });
};

/*
 * Enterprise Edition with no license yet, inside its first-run trial - or
 * holding a token it cannot date, which falls back to the same trial.
 */
type PayloadCheckFunction = (payload: JSONObject) => boolean;

export const isUnlicensedTrial: PayloadCheckFunction = (
  payload: JSONObject,
): boolean => {
  return (
    payload["status"] === "grace" && payload["graceReason"] === "unlicensed"
  );
};

// A real license (not the trial) is valid and loaded.
export const isLicensed: PayloadCheckFunction = (
  payload: JSONObject,
): boolean => {
  return payload["licenseValid"] === true && !isUnlicensedTrial(payload);
};

// What the seat usage and instance cards read, shown to a master admin.
type ToLicenseSnapshotFunction = (payload: JSONObject) => LicenseSnapshot;

export const toLicenseSnapshot: ToLicenseSnapshotFunction = (
  payload: JSONObject,
): LicenseSnapshot => {
  const userLimit: number | null = toNumber(payload["userLimit"]);
  const currentUserCount: number | null = toNumber(payload["currentUserCount"]);
  const isSeatLimitEnforced: boolean = payload["isSeatLimitEnforced"] === true;
  // Says nothing about enforcement: never warn about what there is no evidence for.
  const canAddMoreUsers: boolean = payload["canAddMoreUsers"] !== false;
  const currentVersion: string = toText(payload["currentVersion"]);

  const seatUsage: LicenseSeatUsage = getLicenseSeatUsage({
    licenseValid: payload["licenseValid"] === true,
    userLimit: userLimit,
    currentUserCount: currentUserCount,
    isSeatLimitEnforced: isSeatLimitEnforced,
    enforcedSeatsInUse: toNumber(payload["seatsInUse"]),
    canAddMoreUsers: canAddMoreUsers,
  });

  return {
    payload: payload,
    canManageLicense: true,
    showLicenseDetails: isLicensed(payload),
    companyName: toText(payload["companyName"]),
    licenseKey: toText(payload["licenseKey"]),
    userLimit: userLimit,
    currentUserCount: currentUserCount,
    effectiveUserCount: seatUsage.effectiveUserCount,
    isSeatLimitEnforced: isSeatLimitEnforced,
    canAddMoreUsers: canAddMoreUsers,
    seatTone: seatUsage.seatTone,
    seatUsageDisplayPercent: seatUsage.seatUsageDisplayPercent,
    currentVersion: currentVersion,
    latestVersion: toText(payload["latestVersion"]),
    hasComparableVersion: VersionUtil.isValid(currentVersion),
  };
};

/*
 * Whether a license token IS installed, whatever the license client made of
 * it: a token with no expiry beside it falls back to the trial and the lapse,
 * and a paying customer must not be told that no license is installed.
 */
const hasLicenseInstalled: PayloadCheckFunction = (
  payload: JSONObject,
): boolean => {
  return (
    Boolean(payload["token"]) ||
    payload["verification"] === "unverified" ||
    payload["verification"] === "verified"
  );
};

type DescribeMarketplaceFunction = (
  payload: JSONObject,
  marketplace: CloudMarketplace,
  translator: Translator,
) => LicenseStatusSummary;

/*
 * A license that is a cloud marketplace subscription: there is no key to
 * renew, only reports the marketplace takes or stops taking.
 */
const describeMarketplace: DescribeMarketplaceFunction = (
  payload: JSONObject,
  marketplace: CloudMarketplace,
  translator: Translator,
): LicenseStatusSummary => {
  // The listing's own name, as it is written in every language.
  const name: string = CloudMarketplaceUtil.getDisplayName(marketplace);
  const billing: JSONObject =
    payload["marketplaceBilling"] &&
    typeof payload["marketplaceBilling"] === "object" &&
    !Array.isArray(payload["marketplaceBilling"])
      ? (payload["marketplaceBilling"] as JSONObject)
      : {};
  const lastProblem: string = toText(billing["lastProblem"]);
  const problem: string = lastProblem
    ? translator.translateTemplate(LicenseStatusCopy.lastReportingProblem, {
        problem: lastProblem,
      })
    : "";

  if (payload["licenseValid"] === true && payload["status"] !== "grace") {
    return {
      tone: "healthy",
      title: translator.translateTemplate(LicenseStatusCopy.licensedThrough, {
        marketplace: name,
      }),
      description: translator.translateTemplate(
        LicenseStatusCopy.billedByTheHour,
        { marketplace: name },
      ),
      note: problem || undefined,
    };
  }

  if (payload["status"] === "grace") {
    const graceEndsAt: Date | null = toDate(payload["graceEndsAt"]);

    return {
      tone: "warning",
      title: translator.translateTemplate(
        LicenseStatusCopy.notAcceptingReports,
        { marketplace: name },
      ),
      description: joinSentences([
        graceEndsAt
          ? translator.translateTemplate(LicenseStatusCopy.keepsWorkingUntil, {
              date: dateInSentence(graceEndsAt),
            })
          : translator.translateText(
              LicenseStatusCopy.keepsWorkingUntilGraceEnds,
            ),
        translator.translateTemplate(LicenseStatusCopy.makeSureItCanReach, {
          marketplace: name,
        }),
      ]),
      note: problem || undefined,
    };
  }

  return {
    tone: "critical",
    title: translator.translateTemplate(LicenseStatusCopy.noLongerLicenses, {
      marketplace: name,
    }),
    description: joinSentences([
      translator.translateText(LICENSE_LAPSED_STATE),
      problem,
    ]),
    serverMessage: toText(payload["message"]) || undefined,
  };
};

type DescribeLicenseStatusFunction = (
  payload: JSONObject,
  now?: Date | undefined,
  translator?: Translator | undefined,
) => LicenseStatusSummary;

export const describeLicenseStatus: DescribeLicenseStatusFunction = (
  payload: JSONObject,
  now?: Date | undefined,
  readerTranslator: Translator = ENGLISH,
): LicenseStatusSummary => {
  const translator: Translator = drawnOnThePage(readerTranslator);

  if (CloudMarketplaceUtil.isCloudMarketplace(payload["marketplace"])) {
    return describeMarketplace(
      payload,
      payload["marketplace"] as CloudMarketplace,
      translator,
    );
  }

  const status: string = toText(payload["status"]);
  const message: string = toText(payload["message"]);
  const expiresAt: Date | null = toDate(payload["expiresAt"]);
  const graceEndsAt: Date | null = toDate(payload["graceEndsAt"]);
  const isInstalled: boolean = hasLicenseInstalled(payload);

  const daysLeft: number | null = graceEndsAt
    ? Math.max(
        0,
        Math.ceil(
          (graceEndsAt.getTime() - (now || new Date()).getTime()) / DAY_IN_MS,
        ),
      )
    : null;

  const translate: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  if (isUnlicensedTrial(payload)) {
    return {
      tone: "warning",
      title:
        daysLeft === null
          ? translate(LicenseStatusCopy.trial)
          : translator.translateTemplate(LicenseStatusCopy.trialDaysLeft, {
              daysLeft: daysLeftInSentence(daysLeft),
            }),
      description: joinSentences([
        translate(
          isInstalled
            ? LicenseStatusCopy.installedButUnsure
            : LicenseStatusCopy.noLicenseInstalled,
        ),
        graceEndsAt
          ? translator.translateTemplate(
              LicenseStatusCopy.fullyAvailableUntil,
              { date: dateInSentence(graceEndsAt) },
            )
          : translate(LicenseStatusCopy.fullyAvailable),
      ]),
      serverMessage: isInstalled && message ? message : undefined,
      // The number in the reader's digits, as the days left are.
      note: translator.translateTemplate(TRIAL_ENFORCEMENT_TEMPLATE, {
        days: translator.formatNumber(ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS),
      }),
    };
  }

  if (status === "grace") {
    return {
      tone: "warning",
      title: graceEndsAt
        ? translator.translateTemplate(LicenseStatusCopy.graceUntil, {
            date: dateInSentence(graceEndsAt),
          })
        : translate(LicenseStatusCopy.grace),
      description: joinSentences([
        expiresAt
          ? translator.translateTemplate(LicenseStatusCopy.expiredOn, {
              date: dateInSentence(expiresAt),
            })
          : translate(LicenseStatusCopy.expired),
        daysLeft === null
          ? translate(LicenseStatusCopy.keepsWorkingUntilGraceEnds)
          : translator.translateTemplate(
              LicenseStatusCopy.keepsWorkingUntilGraceEndsDaysLeft,
              { daysLeft: daysLeftInSentence(daysLeft) },
            ),
        translate(LicenseStatusCopy.renewThenRefreshHere),
      ]),
      note: translator.translateTemplate(GRACE_ENFORCEMENT_TEMPLATE, {
        days: translator.formatNumber(ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS),
      }),
    };
  }

  if (payload["licenseValid"] !== true) {
    /*
     * An invalid license: this page's sentence says what it means and what
     * to do, in the reader's language, and the license client's own message
     * says why, as it was sent. With the message alone, a German or Persian
     * admin's only explanation was an English sentence.
     */
    if (status === "invalid") {
      return {
        tone: "critical",
        title: translate(LicenseStatusCopy.licenseNotValid),
        description: translate(LicenseStatusCopy.couldNotBeVerified),
        serverMessage: message || undefined,
        note: translate(LICENSE_LAPSED_STATE),
      };
    }

    const reason: string =
      status === "expired"
        ? expiresAt
          ? translator.translateTemplate(LicenseStatusCopy.expiredOnGraceOver, {
              date: dateInSentence(expiresAt),
            })
          : translate(LicenseStatusCopy.expiredGraceOver)
        : translate(
            isInstalled
              ? LicenseStatusCopy.installedButNotConfirmed
              : LicenseStatusCopy.noValidLicenseInstalled,
          );

    return {
      tone: "critical",
      title: translate(
        status === "expired"
          ? LicenseStatusCopy.licenseExpired
          : LicenseStatusCopy.noValidLicense,
      ),
      description: reason,
      serverMessage:
        message && !PLAIN_STATUS_MESSAGES.includes(message)
          ? message
          : undefined,
      note: translate(LICENSE_LAPSED_STATE),
    };
  }

  if (payload["isEvaluation"] === true) {
    return {
      tone: "healthy",
      title: translate(LicenseStatusCopy.evaluationActive),
      description: translate(LicenseStatusCopy.evaluationDescription),
    };
  }

  // A license issued before OneUptime signed its licenses.
  if (payload["verification"] === "unverified") {
    return {
      tone: "healthy",
      title: translate(LicenseStatusCopy.licenseActive),
      description: translate(LicenseStatusCopy.legacyDescription),
    };
  }

  return {
    tone: "healthy",
    title: translate(LicenseStatusCopy.licenseActive),
    description: translate(LicenseStatusCopy.enterpriseFeaturesOn),
  };
};

/*
 * What to tell a master admin after a license write the server ACCEPTED.
 *
 * A 200 means the license was stored, not that it licenses anything. The
 * server deliberately stores a license it cannot date - a token with no expiry
 * beside it - because a token is better than nothing and the daily sync may
 * complete it (LicenseClient.validateWithLicenseServer refuses only a license
 * this installation cannot use at all). But such an install is on the
 * unlicensed trial, and past that trial SCIM provisioning and audit logging
 * are OFF. A green "License validated successfully." there tells the admin who
 * came to fix exactly that lapse that they have fixed it.
 *
 * Green only while the stored license is genuinely licensing this
 * installation: status "valid", or a grace period that belongs to a LICENSE
 * (graceReason anything but "unlicensed"). Otherwise the classification's own
 * message - which says what is missing and what to do - is shown as a warning,
 * with the license still stored.
 *
 * A response that says nothing about the status is treated as a success, as it
 * always was: that is an older server or a build that does not report one, and
 * inventing a warning out of silence would be its own lie.
 *
 * The message is a key the page's Alert draws in the reader's language: the
 * caller's success sentence, or this page's own warning. A message the server
 * sent is shown as it was sent (the Alert finds no wording for it).
 */
export interface LicenseWriteOutcome {
  isLicensed: boolean;
  message: string;
}

export const LICENSE_STORED_BUT_NOT_LICENSING: string =
  LicenseStatusCopy.storedButNotLicensing;

type DescribeLicenseWriteOutcomeFunction = (
  payload: JSONObject,
  successMessage: string,
) => LicenseWriteOutcome;

export const describeLicenseWriteOutcome: DescribeLicenseWriteOutcomeFunction =
  (payload: JSONObject, successMessage: string): LicenseWriteOutcome => {
    const status: string = toText(payload["status"]);
    const graceReason: string = toText(payload["graceReason"]);

    const isLicensedNow: boolean =
      status === "" ||
      status === "valid" ||
      (status === "grace" && graceReason !== "unlicensed");

    if (isLicensedNow) {
      return { isLicensed: true, message: successMessage };
    }

    return {
      isLicensed: false,
      message: toText(payload["message"]) || LICENSE_STORED_BUT_NOT_LICENSING,
    };
  };
