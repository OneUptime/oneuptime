import {
  DocsClientUrl,
  Host,
  HomeClientUrl,
} from "Common/Server/EnvironmentConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import SecurityAdvisoryEmail, {
  SecurityAdvisoryEmailContent,
} from "Common/Server/Utils/UpdateCheck/SecurityAdvisoryEmail";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import User from "Common/Models/DatabaseModels/User";
import Route from "Common/Types/API/Route";
import PartialEntity from "Common/Types/Database/PartialEntity";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import SecurityAdvisoryUtil, {
  SecurityAdvisory,
} from "Common/Types/UpdateCheck/SecurityAdvisory";
import { AffectingAdvisory } from "Common/Types/UpdateCheck/UpdateStatus";
import SecurityAdvisoryMatcher from "Common/Utils/SecurityAdvisoryMatcher";

/*
 * Telling a self-hosted installation's owners that a published security
 * advisory affects the version it runs: once per advisory, never daily.
 *
 * Who the owners are. On a self-hosted installation the people who can
 * upgrade it are its master admins - the first account made on it is one,
 * and they run the Admin Dashboard - so every master admin who is neither
 * disabled nor blocked is emailed. So is the Admin Notification Email
 * (Admin Dashboard > Settings > Emails), the address an operator gave for
 * "where OneUptime writes about this server", which may be a team's inbox
 * rather than a person's. A project's owners are not told: they can do
 * nothing about the server, and the server's version is not theirs to know.
 *
 * Once per advisory. The advisories that were emailed are recorded on
 * GlobalConfig.securityAdvisoriesEmailed (GHSA id -> when), and a later run
 * emails only the ones not recorded there - a new advisory, or one that
 * affects the version after an upgrade that did not fix it. An email is
 * recorded once at least one owner received it; when nobody did (no mail
 * server set up yet, no owner with an email), nothing is recorded and the
 * next run tries again, which reaches nobody twice.
 */

export interface SecurityAdvisoryRecipient {
  email: Email;
  userId?: ObjectID | undefined;
}

export interface SecurityAdvisoryNotificationOutcome {
  // The advisories this run had to tell about.
  advisoryIds: Array<string>;
  attempted: number;
  succeeded: number;
  failed: number;
  // Whether the advisories were recorded as emailed.
  recorded: boolean;
}

// The most emailed advisories kept on record: far more than OneUptime publishes.
export const MAX_EMAILED_RECORDS: number = 2000;

// How long one email may take to be handed to the mail service.
const SEND_TIMEOUT_IN_MS: number = 30000;

// The emailed record as stored, read without trusting it.
export function parseEmailedRecord(value: unknown): Record<string, string> {
  const record: Record<string, string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return record;
  }

  for (const [key, emailedAt] of Object.entries(value as JSONObject)) {
    if (Object.keys(record).length >= MAX_EMAILED_RECORDS) {
      break;
    }

    if (SecurityAdvisoryUtil.isGhsaId(key) && typeof emailedAt === "string") {
      record[SecurityAdvisoryUtil.normalizeGhsaId(key)] = emailedAt.substring(
        0,
        64,
      );
    }
  }

  return record;
}

/*
 * The installation's owners: every master admin who is neither disabled nor
 * blocked and has an email, then the Admin Notification Email when it is
 * someone else's. One entry per address, whatever its case.
 */
export async function getSecurityAdvisoryRecipients(
  adminNotificationEmail: Email | string | null | undefined,
): Promise<Array<SecurityAdvisoryRecipient>> {
  const recipients: Array<SecurityAdvisoryRecipient> = [];
  const seen: Set<string> = new Set<string>();
  let skip: number = 0;

  for (;;) {
    const users: Array<User> = await UserService.findBy({
      query: {
        isMasterAdmin: true,
        isDisabled: false,
        isBlocked: false,
      },
      select: {
        _id: true,
        email: true,
      },
      skip: skip,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    for (const user of users) {
      const address: string = user.email ? user.email.toString() : "";

      if (!address || seen.has(address.toLowerCase())) {
        continue;
      }

      seen.add(address.toLowerCase());
      recipients.push({
        email: user.email as Email,
        userId: user.id || undefined,
      });
    }

    if (users.length < LIMIT_MAX) {
      break;
    }

    skip += users.length;
  }

  const notificationAddress: string = adminNotificationEmail
    ? adminNotificationEmail.toString().trim()
    : "";

  if (
    notificationAddress &&
    Email.isValid(notificationAddress) &&
    !seen.has(notificationAddress.toLowerCase())
  ) {
    recipients.push({ email: new Email(notificationAddress) });
  }

  return recipients;
}

// The installation's own upgrade guide, or "" when HOST is not set.
export function getUpgradeGuideUrl(): string {
  if (!Host) {
    return "";
  }

  // addRoute changes the URL it is called on: build from a copy.
  return URL.fromString(DocsClientUrl.toString())
    .addRoute(new Route("/installation/upgrading"))
    .toString();
}

export async function notifyOwnersOfSecurityAdvisories(data: {
  currentVersion: string;
  latestVersion: string | null | undefined;
  // Every published advisory the check knows of.
  advisories: Array<SecurityAdvisory>;
  // GlobalConfig.securityAdvisoriesEmailed, as stored.
  emailed: unknown;
  adminNotificationEmail: Email | string | null | undefined;
}): Promise<SecurityAdvisoryNotificationOutcome> {
  const affecting: Array<AffectingAdvisory> =
    SecurityAdvisoryMatcher.getAffectingAdvisories(
      data.currentVersion,
      data.advisories,
    );

  const emailed: Record<string, string> = parseEmailedRecord(data.emailed);

  const toTell: Array<AffectingAdvisory> = affecting.filter(
    (advisory: AffectingAdvisory): boolean => {
      return !emailed[advisory.ghsaId];
    },
  );

  const outcome: SecurityAdvisoryNotificationOutcome = {
    advisoryIds: toTell.map((advisory: AffectingAdvisory): string => {
      return advisory.ghsaId;
    }),
    attempted: 0,
    succeeded: 0,
    failed: 0,
    recorded: false,
  };

  if (toTell.length === 0) {
    return outcome;
  }

  const recipients: Array<SecurityAdvisoryRecipient> =
    await getSecurityAdvisoryRecipients(data.adminNotificationEmail);

  if (recipients.length === 0) {
    logger.debug(
      `InstanceUpdate:SecurityAdvisories: ${toTell.length} security advisories affect ${data.currentVersion}, but there is no master admin or admin notification email to tell. Trying again on the next check.`,
    );
    return outcome;
  }

  const email: SecurityAdvisoryEmailContent = SecurityAdvisoryEmail.build({
    productName: ProductBrandingText.getProductName(),
    host: Host,
    currentVersion: data.currentVersion,
    recommendedVersion: SecurityAdvisoryMatcher.getRecommendedVersion({
      currentVersion: data.currentVersion,
      latestVersion: data.latestVersion,
      advisories: data.advisories,
    }),
    advisories: toTell,
    upgradeGuideUrl: getUpgradeGuideUrl(),
    homeUrl: Host ? HomeClientUrl.toString() : "",
  });

  for (const recipient of recipients) {
    outcome.attempted++;

    try {
      const response: Awaited<ReturnType<typeof MailService.sendMail>> =
        await MailService.sendMail(
          {
            toEmail: recipient.email,
            templateType: EmailTemplateType.SecurityAdvisoryAffectsInstallation,
            subject: email.subject,
            isSubjectLiteral: true,
            vars: email.vars,
          },
          {
            userId: recipient.userId,
            timeoutInMs: SEND_TIMEOUT_IN_MS,
          },
        );

      if (response.isSuccess()) {
        outcome.succeeded++;
      } else {
        outcome.failed++;
      }
    } catch (error) {
      outcome.failed++;
      logger.debug(
        `InstanceUpdate:SecurityAdvisories: Could not email a security advisory notice: ${
          (error as Error)?.message || String(error)
        }`,
      );
    }
  }

  if (outcome.succeeded === 0) {
    logger.debug(
      `InstanceUpdate:SecurityAdvisories: No owner could be emailed about ${outcome.advisoryIds.join(
        ", ",
      )}. Trying again on the next check.`,
    );
    return outcome;
  }

  const emailedAt: string = OneUptimeDate.getCurrentDate().toISOString();
  const record: JSONObject = { ...emailed };

  for (const ghsaId of outcome.advisoryIds) {
    record[ghsaId] = emailedAt;
  }

  /*
   * Built as a plain record: checking a JSON value against the entity's
   * deep-partial type makes TypeScript recurse without end.
   */
  const update: PartialEntity<GlobalConfig> = {};
  (update as Record<string, unknown>)["securityAdvisoriesEmailed"] = record;

  await GlobalConfigService.updateOneById({
    id: ObjectID.getZeroObjectID(),
    data: update,
    props: {
      isRoot: true,
      ignoreHooks: true,
    },
  });

  outcome.recorded = true;

  logger.info(
    `InstanceUpdate:SecurityAdvisories: Told ${outcome.succeeded} of ${outcome.attempted} owners that ${outcome.advisoryIds.join(
      ", ",
    )} affect ${data.currentVersion}.`,
  );

  return outcome;
}
