import { ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import OneUptimeDate from "Common/Types/Date";

/*
 * What the license expiry reminder email (EnterpriseLicenseExpiryReminder.hbs,
 * sent by Jobs/SendLicenseNotificationEmails) says about where a license
 * stands.
 *
 * It has to say what actually happens. A lapsed license never stops a
 * self-hosted OneUptime instance: the instances keep running. What stops, at
 * the end of the grace period (ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS after
 * the expiry, the same period the customer's installation applies), is single
 * sign-on, SCIM provisioning and audit logging, and enterprise configuration
 * becomes read-only - until a renewed license is activated.
 *
 * The grace period is inclusive of its last moment, like the license
 * classifier's (ee/Server/License/LicenseToken.ts judgeExpiry).
 */

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

export interface LicenseExpiryReminderCopy {
  subject: string;
  emailTitle: string;
  expiryStatus: string;
  expiryStatusMessage: string;
}

// When the grace period after `expiresAt` ends (the last moment still in it).
export const getLicenseGraceEndsAt: (expiresAt: Date) => Date = (
  expiresAt: Date,
): Date => {
  return new Date(
    expiresAt.getTime() + ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS * DAY_IN_MS,
  );
};

export const getLicenseExpiryReminderCopy: (data: {
  companyName: string;
  expiresAt: Date;
  now: Date;
}) => LicenseExpiryReminderCopy = (data: {
  companyName: string;
  expiresAt: Date;
  now: Date;
}): LicenseExpiryReminderCopy => {
  const daysUntilExpiry: number = OneUptimeDate.getDaysBetweenTwoDates(
    data.now,
    data.expiresAt,
  );
  const isExpired: boolean = data.expiresAt.getTime() <= data.now.getTime();

  const graceEndsAt: Date = getLicenseGraceEndsAt(data.expiresAt);
  const graceEndsOn: string = OneUptimeDate.getDateAsFormattedString(
    graceEndsAt,
    {
      onlyShowDate: true,
    },
  );
  const gracePeriod: string = `${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period`;

  if (isExpired) {
    const daysAgo: number = Math.abs(daysUntilExpiry);
    const daysAgoText: string =
      daysAgo === 0 ? "today" : `${daysAgo} day${daysAgo === 1 ? "" : "s"} ago`;
    const isInGracePeriod: boolean =
      data.now.getTime() <= graceEndsAt.getTime();

    return {
      subject: `[Action Required] OneUptime Enterprise license for ${data.companyName} has expired`,
      emailTitle: "Your OneUptime Enterprise license has expired",
      expiryStatus: `Expired ${daysAgoText}`,
      expiryStatusMessage: isInGracePeriod
        ? `Your OneUptime Enterprise license expired ${daysAgoText}. Your self-hosted OneUptime instances keep running, and every enterprise feature stays on until its ${gracePeriod} ends on ${graceEndsOn}. Please renew it before then: when the grace period ends, single sign-on, SCIM provisioning and audit logging stop and enterprise configuration becomes read-only until a renewed license is activated. Here are the details:`
        : `Your OneUptime Enterprise license expired ${daysAgoText}, and its ${gracePeriod} ended on ${graceEndsOn}. Your self-hosted OneUptime instances keep running, but single sign-on, SCIM provisioning and audit logging have stopped and enterprise configuration is read-only. Please renew the license: everything resumes as soon as the renewed license is activated. Here are the details:`,
    };
  }

  const daysLeftText: string =
    daysUntilExpiry === 0
      ? "today"
      : `in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}`;

  return {
    subject: `[Reminder] OneUptime Enterprise license for ${data.companyName} expires ${daysLeftText}`,
    emailTitle: `Your OneUptime Enterprise license expires ${daysLeftText}`,
    expiryStatus: `Expires ${daysLeftText}`,
    expiryStatusMessage: `Your OneUptime Enterprise license expires ${daysLeftText}. Please renew it before then. Your self-hosted OneUptime instances keep running either way, but without a renewal, single sign-on, SCIM provisioning and audit logging stop and enterprise configuration becomes read-only when the ${gracePeriod} after the expiry ends, on ${graceEndsOn}. Here are the details:`,
  };
};
