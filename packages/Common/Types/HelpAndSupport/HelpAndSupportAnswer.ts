import { JSONObject } from "../JSON";
import {
  HELP_ITEMS,
  HelpAndSupportSettings,
  HelpItem,
  isHelpItem,
  readHelpAndSupportSettings,
  toHelpAndSupportJSON,
} from "./HelpAndSupport";
import {
  HELP_AND_SUPPORT_SEED_VARIABLES,
  HelpAndSupportSeedProblem,
} from "./HelpAndSupportSeed";

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
 *                           by default, as it always has;
 *   seededItems             the places set from the server's configuration
 *                           (Helm values or config.env, #10938) and not
 *                           changed on the page since, so the page says
 *                           where their values came from;
 *   seedProblems            the values the configuration sets that the page
 *                           would refuse, which were left out, with why.
 */

export interface HelpAndSupportAnswer {
  settings: HelpAndSupportSettings;
  isOneUptimeCloud: boolean;
  adminNotificationEmail: string | null;
  canSendEmail: boolean;
  isProductRenamed: boolean;
  seededItems: Array<HelpItem>;
  seedProblems: Array<HelpAndSupportSeedProblem>;
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
    seededItems: [...answer.seededItems],
    seedProblems: answer.seedProblems.map(
      (problem: HelpAndSupportSeedProblem): JSONObject => {
        return {
          item: problem.item,
          variable: problem.variable,
          problem: problem.problem,
        };
      },
    ),
  };
};

// The places the answer says were seeded: known places, each once, in order.
const readSeededItemList: (value: unknown) => Array<HelpItem> = (
  value: unknown,
): Array<HelpItem> => {
  if (!Array.isArray(value)) {
    return [];
  }

  return HELP_ITEMS.filter((item: HelpItem): boolean => {
    return value.includes(item);
  });
};

/*
 * The refused values the answer lists, each for a known place, named by
 * the variable that place is seeded from, never by a name the answer made
 * up.
 */
const readSeedProblemList: (
  value: unknown,
) => Array<HelpAndSupportSeedProblem> = (
  value: unknown,
): Array<HelpAndSupportSeedProblem> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const problems: Array<HelpAndSupportSeedProblem> = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const data: Record<string, unknown> = entry as Record<string, unknown>;
    const item: unknown = data["item"];
    const problem: unknown = data["problem"];

    if (!isHelpItem(item) || typeof problem !== "string" || !problem.trim()) {
      continue;
    }

    problems.push({
      item: item,
      variable: HELP_AND_SUPPORT_SEED_VARIABLES[item],
      problem: problem,
    });
  }

  return problems;
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
    seededItems: readSeededItemList(data["seededItems"]),
    seedProblems: readSeedProblemList(data["seedProblems"]),
  };
};
