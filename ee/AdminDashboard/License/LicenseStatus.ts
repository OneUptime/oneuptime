import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import CloudMarketplace, {
  CloudMarketplaceUtil,
} from "Common/Types/Marketplace/CloudMarketplace";
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
import VersionUtil from "Common/Utils/VersionUtil";

/*
 * What Settings > License says about the license, read from the answer of
 * GET /global-config/license (or of a write, which answers with the same
 * body). Pure, and free of React.
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

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

/*
 * Enterprise Edition with no license yet, inside its first-run trial - or
 * holding a token it cannot date, which falls back to the same trial.
 */
type PayloadCheckFunction = (payload: JSONObject) => boolean;

export const isUnlicensedTrial: PayloadCheckFunction = (
  payload: JSONObject,
): boolean => {
  return payload["status"] === "grace" && payload["graceReason"] === "unlicensed";
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
) => LicenseStatusSummary;

/*
 * A license that is a cloud marketplace subscription: there is no key to
 * renew, only reports the marketplace takes or stops taking.
 */
const describeMarketplace: DescribeMarketplaceFunction = (
  payload: JSONObject,
  marketplace: CloudMarketplace,
): LicenseStatusSummary => {
  const name: string = CloudMarketplaceUtil.getDisplayName(marketplace);
  const billing: JSONObject =
    payload["marketplaceBilling"] &&
    typeof payload["marketplaceBilling"] === "object" &&
    !Array.isArray(payload["marketplaceBilling"])
      ? (payload["marketplaceBilling"] as JSONObject)
      : {};
  const lastProblem: string = toText(billing["lastProblem"]);
  const problem: string = lastProblem
    ? `Last reporting problem: ${lastProblem}`
    : "";

  if (payload["licenseValid"] === true && payload["status"] !== "grace") {
    return {
      tone: "healthy",
      title: `Licensed through ${name}`,
      description: `Every user of this installation is billed by the hour on your ${name} account. Enterprise features stay licensed for as long as ${name} accepts the installation's hourly usage reports.`,
      note: problem || undefined,
    };
  }

  if (payload["status"] === "grace") {
    const graceEndsAt: Date | null = toDate(payload["graceEndsAt"]);

    return {
      tone: "warning",
      title: `${name} is not accepting usage reports`,
      description: joinSentences([
        graceEndsAt
          ? `Every enterprise feature keeps working until ${graceEndsAt.toLocaleDateString()}.`
          : "Every enterprise feature keeps working until the grace period ends.",
        `Make sure this installation can reach ${name} and is set up as the listing's instructions say.`,
      ]),
      note: problem || undefined,
    };
  }

  return {
    tone: "critical",
    title: `${name} no longer licenses this installation`,
    description: joinSentences([
      toText(payload["message"]),
      LICENSE_LAPSED_STATE,
      problem,
    ]),
  };
};

type DescribeLicenseStatusFunction = (
  payload: JSONObject,
  now?: Date | undefined,
) => LicenseStatusSummary;

export const describeLicenseStatus: DescribeLicenseStatusFunction = (
  payload: JSONObject,
  now?: Date | undefined,
): LicenseStatusSummary => {
  if (CloudMarketplaceUtil.isCloudMarketplace(payload["marketplace"])) {
    return describeMarketplace(
      payload,
      payload["marketplace"] as CloudMarketplace,
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
  const daysLeftText: string =
    daysLeft === null
      ? ""
      : daysLeft === 1
        ? "1 day left"
        : `${daysLeft} days left`;

  if (isUnlicensedTrial(payload)) {
    return {
      tone: "warning",
      title: daysLeftText
        ? `Enterprise Edition trial: ${daysLeftText}`
        : "Enterprise Edition trial",
      description: joinSentences([
        isInstalled
          ? "A license is installed, but this installation cannot tell whether it is still current, so it is treating this as an unlicensed install."
          : "No Enterprise license is installed.",
        isInstalled ? message : "",
        graceEndsAt
          ? `Enterprise features stay fully available until ${graceEndsAt.toLocaleDateString()}.`
          : "Enterprise features stay fully available during the trial.",
      ]),
      note: TRIAL_ENFORCEMENT_SUMMARY,
    };
  }

  if (status === "grace") {
    return {
      tone: "warning",
      title: graceEndsAt
        ? `License expired, grace period until ${graceEndsAt.toLocaleDateString()}`
        : "License expired, grace period",
      description: joinSentences([
        expiresAt
          ? `The Enterprise license expired on ${expiresAt.toLocaleDateString()}.`
          : "The Enterprise license expired.",
        daysLeftText
          ? `Every enterprise feature keeps working until the grace period ends (${daysLeftText}).`
          : "Every enterprise feature keeps working until the grace period ends.",
        "Renew the license with OneUptime, then refresh it here.",
      ]),
      note: GRACE_ENFORCEMENT_SUMMARY,
    };
  }

  if (payload["licenseValid"] !== true) {
    if (status === "invalid") {
      return {
        tone: "critical",
        title: "License not valid",
        description:
          message ||
          "The stored license could not be verified. Validate the license again.",
        note: LICENSE_LAPSED_STATE,
      };
    }

    const reason: string =
      status === "expired"
        ? expiresAt
          ? `The Enterprise license expired on ${expiresAt.toLocaleDateString()} and its grace period is over.`
          : "The Enterprise license expired and its grace period is over."
        : isInstalled
          ? "A license is installed, but this installation cannot confirm that it is current, so nothing is licensed by it."
          : "This installation has no valid Enterprise license.";

    return {
      tone: "critical",
      title: status === "expired" ? "License expired" : "No valid license",
      description: joinSentences([
        reason,
        PLAIN_STATUS_MESSAGES.includes(message) ? "" : message,
      ]),
      note: LICENSE_LAPSED_STATE,
    };
  }

  if (payload["isEvaluation"] === true) {
    return {
      tone: "healthy",
      title: "Evaluation license active",
      description:
        "This key was issued for evaluation and testing. It is not licensed for production use. Reach out whenever you are ready to go live and we will get a production license sorted for you.",
    };
  }

  // A license issued before OneUptime signed its licenses.
  if (payload["verification"] === "unverified") {
    return {
      tone: "healthy",
      title: "License active",
      description:
        "This license was issued before OneUptime signed its licenses, so this installation cannot verify it offline. It keeps working; refreshing the license replaces it with a signed one once OneUptime issues them.",
    };
  }

  return {
    tone: "healthy",
    title: "License active",
    description: "Enterprise features are on for this installation.",
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
 */
export interface LicenseWriteOutcome {
  isLicensed: boolean;
  message: string;
}

export const LICENSE_STORED_BUT_NOT_LICENSING: string =
  "The license was stored, but this installation cannot confirm that it is current, so enterprise features are not being licensed by it. Refresh the license, or check it on oneuptime.com.";

type DescribeLicenseWriteOutcomeFunction = (
  payload: JSONObject,
  successMessage: string,
) => LicenseWriteOutcome;

export const describeLicenseWriteOutcome: DescribeLicenseWriteOutcomeFunction = (
  payload: JSONObject,
  successMessage: string,
): LicenseWriteOutcome => {
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
