import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * YOUR OWN MAIL SERVERS AND TWILIO ACCOUNTS, IN MORE SETTINGS.
 *
 * "Please audit the entire project for advanced features just like these
 * and move them to More as well, so it is hidden by default and it doesn't
 * cause frustration and decision paralysis to users." - the maintainer.
 *
 * Project Settings -> Notifications -> Notification Settings drew two tables
 * under the channel switches: Custom SMTP Configs and Twilio Config - a
 * project's own mail server and Twilio account, for a status page to send
 * its subscribers through, and for an incoming call policy to answer on.
 * Most projects never add either: OneUptime sends their email, SMS and
 * calls. Both wait folded under the page's More settings now:
 *
 *   - folded, the header names the two, each with how many configs it
 *     holds while it holds any ("Custom SMTP Configs: 2"), so a server in
 *     use is never hidden;
 *   - a link to #custom-smtp-configs or #twilio-config (the docs, a status
 *     page's Subscriber Settings) opens the fold at the table.
 *
 * Nothing changes what is sent, or through which server.
 *
 * React-free, so the page and the tests read the same names and words.
 */

// The tables' titles, as they draw them.
export const CUSTOM_SMTP_CONFIGS_TITLE: string = translationKey(
  "Custom SMTP Configs",
);

export const TWILIO_CONFIG_TITLE: string = translationKey("Twilio Config");

// Each table's place on the page: its title's, as in any More settings.
export const CUSTOM_SMTP_CONFIGS_PLACE: string = getPageAnchorNameForTitle(
  CUSTOM_SMTP_CONFIGS_TITLE,
);

export const TWILIO_CONFIG_PLACE: string =
  getPageAnchorNameForTitle(TWILIO_CONFIG_TITLE);

// What the fold holds, under its title once open.
export const OWN_SENDERS_MORE_DESCRIPTION: string = translationKey(
  "Your own mail servers and Twilio accounts, for messages OneUptime would otherwise send itself.",
);

/*
 * The two tables as the folded header names them, each with how many
 * configs it lists once loaded.
 */
export const getOwnSendersFoldedItems: (counts: {
  smtpConfigCount: number;
  twilioConfigCount: number;
}) => Array<FoldedSectionItem> = (counts: {
  smtpConfigCount: number;
  twilioConfigCount: number;
}): Array<FoldedSectionItem> => {
  return [
    foldedSectionItem(CUSTOM_SMTP_CONFIGS_TITLE, {
      key: CUSTOM_SMTP_CONFIGS_PLACE,
      isSet: counts.smtpConfigCount > 0,
      value: String(counts.smtpConfigCount),
    }),
    foldedSectionItem(TWILIO_CONFIG_TITLE, {
      key: TWILIO_CONFIG_PLACE,
      isSet: counts.twilioConfigCount > 0,
      value: String(counts.twilioConfigCount),
    }),
  ];
};
