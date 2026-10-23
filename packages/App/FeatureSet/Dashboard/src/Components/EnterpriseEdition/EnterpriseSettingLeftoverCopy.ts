import { EnterpriseSettingLeftoverCopy } from "./EnterpriseSettingLeftover";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What each Enterprise setting says under its upsell while a record still
 * holds it (EnterpriseSettingLeftover): on the Community Edition, where it
 * keeps applying but cannot be changed, and on OneUptime Cloud below the
 * plan that sells it. Each one says what removing it changes.
 *
 * Kept free of React so the shells and the tests read these exact strings.
 * Every sentence is wrapped in translationKey() so npm run i18n:extract
 * finds it.
 */

// Why the setting cannot be changed here: the edition, or the plan.
export enum EnterpriseSettingLeftoverReason {
  Edition = "edition",
  Plan = "plan",
}

interface LeftoverSentences {
  title: string;
  // "It still applies, and changing it needs ..." - one per reason.
  editionDescription: string;
  planDescription: string;
  removeButton: string;
  confirmTitle: string;
  confirmDescription: string;
  removed: string;
}

const IP_ALLOWLIST: LeftoverSentences = {
  title: translationKey("IP allowlist still in force"),
  editionDescription: translationKey(
    "Only the addresses below can open this, as before. Changing the allowlist needs the Enterprise Edition. Removing it lets every address in again.",
  ),
  planDescription: translationKey(
    "Only the addresses below can open this, as before. Changing the allowlist needs the {{planName}} plan. Removing it lets every address in again.",
  ),
  removeButton: translationKey("Remove allowlist"),
  confirmTitle: translationKey("Remove the IP allowlist?"),
  confirmDescription: translationKey(
    "Every address can open this again as soon as the allowlist is removed.",
  ),
  removed: translationKey(
    "The IP allowlist was removed: every address can open this again.",
  ),
};

const SESSION_LENGTH: LeftoverSentences = {
  title: translationKey("Reader session limit still in force"),
  editionDescription: translationKey(
    "Readers are still signed out after the time below. Changing it needs the Enterprise Edition. Removing the limit keeps readers signed in while they open the page at least once every 30 days.",
  ),
  planDescription: translationKey(
    "Readers are still signed out after the time below. Changing it needs the {{planName}} plan. Removing the limit keeps readers signed in while they open the page at least once every 30 days.",
  ),
  removeButton: translationKey("Remove limit"),
  confirmTitle: translationKey("Remove the reader session limit?"),
  confirmDescription: translationKey(
    "Readers stay signed in while they open the page at least once every 30 days, including the readers signed in now.",
  ),
  removed: translationKey("The reader session limit was removed."),
};

const SUBSCRIBER_RESTRICTIONS: LeftoverSentences = {
  title: translationKey("Subscriber restrictions still in force"),
  editionDescription: translationKey(
    "This page still applies the restrictions below to its subscribers. Changing them needs the Enterprise Edition. Removing them lets anyone subscribe again, at any email domain.",
  ),
  planDescription: translationKey(
    "This page still applies the restrictions below to its subscribers. Changing them needs the {{planName}} plan. Removing them lets anyone subscribe again, at any email domain.",
  ),
  removeButton: translationKey("Remove restrictions"),
  confirmTitle: translationKey("Remove the subscriber restrictions?"),
  confirmDescription: translationKey(
    "Anyone can subscribe again, at any email domain, through every channel this page offers.",
  ),
  removed: translationKey("The subscriber restrictions were removed."),
};

/*
 * Powered by OneUptime is only hidden while the feature runs, so on the
 * Community Edition the page already shows it: this one is drawn for a
 * OneUptime Cloud project below the plan only.
 */
const POWERED_BY: LeftoverSentences = {
  title: translationKey("Powered by OneUptime is hidden"),
  editionDescription: translationKey(
    "This page still hides Powered by OneUptime. Hiding it needs the Enterprise Edition. You can show it again.",
  ),
  planDescription: translationKey(
    "This page still hides Powered by OneUptime. Hiding it needs the {{planName}} plan. You can show it again.",
  ),
  removeButton: translationKey("Show Powered by OneUptime"),
  confirmTitle: translationKey("Show Powered by OneUptime again?"),
  confirmDescription: translationKey(
    "The footer of this status page shows Powered by OneUptime again.",
  ),
  removed: translationKey("This page shows Powered by OneUptime again."),
};

export enum EnterpriseSettingLeftoverKind {
  IpAllowlist = "ip-allowlist",
  SessionLength = "session-length",
  SubscriberRestrictions = "subscriber-restrictions",
  PoweredBy = "powered-by",
}

export const ENTERPRISE_SETTING_LEFTOVER_SENTENCES: Record<
  EnterpriseSettingLeftoverKind,
  LeftoverSentences
> = {
  [EnterpriseSettingLeftoverKind.IpAllowlist]: IP_ALLOWLIST,
  [EnterpriseSettingLeftoverKind.SessionLength]: SESSION_LENGTH,
  [EnterpriseSettingLeftoverKind.SubscriberRestrictions]:
    SUBSCRIBER_RESTRICTIONS,
  [EnterpriseSettingLeftoverKind.PoweredBy]: POWERED_BY,
};

// The columns each setting is held in: Remove puts them all back.
export const ENTERPRISE_SETTING_LEFTOVER_COLUMNS: Record<
  EnterpriseSettingLeftoverKind,
  ReadonlyArray<string>
> = {
  [EnterpriseSettingLeftoverKind.IpAllowlist]: ["ipWhitelist"],
  [EnterpriseSettingLeftoverKind.SessionLength]: [
    "privateUserSessionLengthInHours",
  ],
  [EnterpriseSettingLeftoverKind.SubscriberRestrictions]: [
    "limitSubscribersToPrivateUsers",
    "allowedSubscriberEmailDomains",
  ],
  [EnterpriseSettingLeftoverKind.PoweredBy]: ["hidePoweredByOneUptimeBranding"],
};

/*
 * The card's words for one setting and one reason. The plan's name goes into
 * the description through the translator, where the card draws it, so the
 * description is handed over as its template with the plan already in it.
 */
export const getEnterpriseSettingLeftoverCopy: (data: {
  kind: EnterpriseSettingLeftoverKind;
  reason: EnterpriseSettingLeftoverReason;
  planName: string;
  translateTemplate: (
    template: string,
    values: Record<string, string>,
  ) => string;
}) => EnterpriseSettingLeftoverCopy = (data: {
  kind: EnterpriseSettingLeftoverKind;
  reason: EnterpriseSettingLeftoverReason;
  planName: string;
  translateTemplate: (
    template: string,
    values: Record<string, string>,
  ) => string;
}): EnterpriseSettingLeftoverCopy => {
  const sentences: LeftoverSentences =
    ENTERPRISE_SETTING_LEFTOVER_SENTENCES[data.kind];

  return {
    title: sentences.title,
    description:
      data.reason === EnterpriseSettingLeftoverReason.Plan
        ? data.translateTemplate(sentences.planDescription, {
            planName: data.planName,
          })
        : sentences.editionDescription,
    removeButton: sentences.removeButton,
    confirmTitle: sentences.confirmTitle,
    confirmDescription: sentences.confirmDescription,
    removed: sentences.removed,
  };
};

// Test ids, one per setting.
export const getEnterpriseSettingLeftoverTestId: (
  kind: EnterpriseSettingLeftoverKind,
) => string = (kind: EnterpriseSettingLeftoverKind): string => {
  return `enterprise-setting-leftover-${kind}`;
};
