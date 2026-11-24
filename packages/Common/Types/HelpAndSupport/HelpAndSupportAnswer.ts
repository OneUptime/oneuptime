import { JSONObject } from "../JSON";
import {
  HelpAndSupportSettings,
  readHelpAndSupportSettings,
  toHelpAndSupportJSON,
} from "./HelpAndSupport";

/*
 * WHAT ADMIN DASHBOARD > SETTINGS > HELP AND SUPPORT IS TOLD
 * (GET and POST HELP_AND_SUPPORT_SETTINGS_ROUTE, #10864-#10866).
 *
 * The settings, every item with its value, and what the page needs to say
 * truly what each default does and what a choice will do:
 *
 *   isOneUptimeCloud        Give feedback's default goes to the OneUptime
 *                           team on OneUptime Cloud, and to the server's
 *                           admins elsewhere;
 *   adminNotificationEmail  where a self-hosted server's admins get Give
 *                           feedback by default (Settings > Email), or null;
 *   canSendEmail            whether the server can send email: Give feedback
 *                           sent to an address is hidden until it can, and
 *                           the page says so;
 *   isProductRenamed        the server goes by a name of its own, so the
 *                           footer leaves OneUptime's Help and Support out
 *                           by default, as it always has.
 */

export interface HelpAndSupportAnswer {
  settings: HelpAndSupportSettings;
  isOneUptimeCloud: boolean;
  adminNotificationEmail: string | null;
  canSendEmail: boolean;
  isProductRenamed: boolean;
}

export const toHelpAndSupportAnswerJSON: (
  answer: HelpAndSupportAnswer,
) => JSONObject = (answer: HelpAndSupportAnswer): JSONObject => {
  return {
    settings: toHelpAndSupportJSON(answer.settings),
    isOneUptimeCloud: answer.isOneUptimeCloud,
    adminNotificationEmail: answer.adminNotificationEmail,
    canSendEmail: answer.canSendEmail,
    isProductRenamed: answer.isProductRenamed,
  };
};

/*
 * The answer as the page reads it, or null when it is not one: every
 * setting read by the same rules the server keeps them by, so the page
 * never shows a value the server would not.
 */
export const parseHelpAndSupportAnswer: (
  value: unknown,
) => HelpAndSupportAnswer | null = (
  value: unknown,
): HelpAndSupportAnswer | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data: Record<string, unknown> = value as Record<string, unknown>;

  if (
    typeof data["isOneUptimeCloud"] !== "boolean" ||
    typeof data["canSendEmail"] !== "boolean"
  ) {
    return null;
  }

  const adminNotificationEmail: unknown = data["adminNotificationEmail"];

  return {
    settings: readHelpAndSupportSettings(data["settings"]),
    isOneUptimeCloud: data["isOneUptimeCloud"],
    adminNotificationEmail:
      typeof adminNotificationEmail === "string" &&
      adminNotificationEmail.trim()
        ? adminNotificationEmail.trim()
        : null,
    canSendEmail: data["canSendEmail"],
    isProductRenamed: data["isProductRenamed"] === true,
  };
};
