import {
  AllowedEmailDomainsIssue,
  getAllowedEmailDomainEntries,
  getAllowedEmailDomainsIssue,
  MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS,
} from "Common/Types/StatusPage/SubscriberRestrictions";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * Who Can Subscribe, on Subscribers -> Subscriber Settings: Only Private
 * Users Can Subscribe (StatusPage.limitSubscribersToPrivateUsers) and
 * Allowed Email Domains (StatusPage.allowedSubscriberEmailDomains), the two
 * settings that keep a status page's notifications to the people it is for
 * (Common/Types/StatusPage/SubscriberRestrictions).
 *
 * Kept free of React so the components and their tests read these exact
 * strings. Every string is a whole sentence or a whole name, wrapped in
 * translationKey() so npm run i18n:extract finds it, and translated in all
 * seventeen Dashboard locale files.
 */

export const SUBSCRIBER_RESTRICTIONS_CARD_TEST_ID: string =
  "status-page-subscriber-restrictions";

export const PRIVATE_USERS_ONLY_SWITCH_TEST_ID: string =
  "subscriber-private-users-only-switch";

export const ALLOWED_EMAIL_DOMAINS_SETTING_TEST_ID: string =
  "subscriber-allowed-email-domains";

// What the box shows before anything is typed: two domains, one a line.
export const ALLOWED_EMAIL_DOMAINS_PLACEHOLDER: string = "acme.com\nacme.de";

/*
 * What the card restricts, told to its page: the card waits folded under
 * the page's More settings - an Enterprise access control few status pages
 * use - and the folded header marks it while anything is restricted.
 */
export interface SubscriberRestrictionsState {
  limitSubscribersToPrivateUsers: boolean;
  allowedEmailDomainCount: number;
}

// Whether anyone who would subscribe is turned away: either setting on.
export const isSubscriberRestrictionInForce: (
  restrictions: SubscriberRestrictionsState | null | undefined,
) => boolean = (
  restrictions: SubscriberRestrictionsState | null | undefined,
): boolean => {
  return Boolean(
    restrictions &&
      (restrictions.limitSubscribersToPrivateUsers ||
        restrictions.allowedEmailDomainCount > 0),
  );
};

export const SubscriberRestrictionsCopy: {
  cardTitle: string;
  cardDescription: string;
  privateUsersOnlyTitle: string;
  privateUsersOnlyOnDescription: string;
  privateUsersOnlyOffDescription: string;
  /*
   * Beside the switch on a page no reader signs in to: one open to anyone,
   * or to anyone with the password.
   */
  privateUsersOnlyNoSignInNote: string;
  allowedDomainsLabel: string;
  allowedDomainsDescription: string;
  allowedDomainsSave: string;
  allowedDomainsDiscard: string;
  invalidDomain: string;
  tooManyDomains: string;
} = {
  cardTitle: translationKey("Who Can Subscribe"),
  cardDescription: translationKey(
    "Limit subscriptions to the people this status page is for.",
  ),
  privateUsersOnlyTitle: translationKey("Only Private Users Can Subscribe"),
  privateUsersOnlyOnDescription: translationKey(
    "On: only people who can sign in to this page can subscribe, by email. Other subscribers are sent nothing.",
  ),
  privateUsersOnlyOffDescription: translationKey(
    "Off: anyone who can see this status page can subscribe.",
  ),
  privateUsersOnlyNoSignInNote: translationKey(
    "This page has no sign-in, so while this is on, only your team can add subscribers.",
  ),
  allowedDomainsLabel: translationKey("Allowed Email Domains"),
  allowedDomainsDescription: translationKey(
    "Only email addresses at these domains, or their subdomains, can subscribe and get notifications. One domain per line, such as acme.com. Leave empty to allow any domain. Phone, Slack, Microsoft Teams and webhook subscribers are not affected.",
  ),
  allowedDomainsSave: translationKey("Save Domains"),
  allowedDomainsDiscard: translationKey("Discard Changes"),
  invalidDomain: translationKey(
    "{{domain}} is not a valid domain. Enter one domain per line, such as acme.com.",
  ),
  tooManyDomains: translationKey(
    "Allowed Email Domains can hold at most {{count}} domains.",
  ),
};

// The sentence under the switch, for the way it is set.
export const getPrivateUsersOnlyDescription: (isOn: boolean) => string = (
  isOn: boolean,
): string => {
  return isOn
    ? SubscriberRestrictionsCopy.privateUsersOnlyOnDescription
    : SubscriberRestrictionsCopy.privateUsersOnlyOffDescription;
};

/*
 * Why a list cannot be saved, as the dashboard says it: an English template
 * and its values, to be translated (translateTemplate), or null when it can
 * be saved.
 */
export const getAllowedEmailDomainsInputProblem: (
  value: string,
) => { template: string; values: Record<string, string> } | null = (
  value: string,
): { template: string; values: Record<string, string> } | null => {
  const issue: AllowedEmailDomainsIssue | null =
    getAllowedEmailDomainsIssue(value);

  if (!issue) {
    return null;
  }

  if (issue.kind === "tooManyDomains") {
    return {
      template: SubscriberRestrictionsCopy.tooManyDomains,
      values: { count: String(MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS) },
    };
  }

  return {
    template: SubscriberRestrictionsCopy.invalidDomain,
    values: { domain: issue.domain },
  };
};

/*
 * Whether what is typed is the list that is saved: the same domains in the
 * same order, however they are spaced, cased or separated.
 */
export const isSameAllowedEmailDomains: (
  typed: string | null | undefined,
  saved: string | null | undefined,
) => boolean = (
  typed: string | null | undefined,
  saved: string | null | undefined,
): boolean => {
  const first: Array<string> = getAllowedEmailDomainEntries(typed);
  const second: Array<string> = getAllowedEmailDomainEntries(saved);

  return (
    first.length === second.length &&
    first.every((domain: string, index: number): boolean => {
      return domain === second[index];
    })
  );
};

/*
 * The list as the box shows it once saved: one domain a line, as the server
 * stores it.
 */
export const toAllowedEmailDomainsText: (
  value: string | null | undefined,
) => string = (value: string | null | undefined): string => {
  return getAllowedEmailDomainEntries(value).join("\n");
};

// What a status page holds, as the card tells its page.
export const getSubscriberRestrictionsState: (data: {
  limitSubscribersToPrivateUsers: boolean | null | undefined;
  allowedSubscriberEmailDomains: string | null | undefined;
}) => SubscriberRestrictionsState = (data: {
  limitSubscribersToPrivateUsers: boolean | null | undefined;
  allowedSubscriberEmailDomains: string | null | undefined;
}): SubscriberRestrictionsState => {
  return {
    limitSubscribersToPrivateUsers:
      data.limitSubscribersToPrivateUsers === true,
    allowedEmailDomainCount: getAllowedEmailDomainEntries(
      data.allowedSubscriberEmailDomains,
    ).length,
  };
};

/*
 * The card's place in the page's More settings: its title's
 * (#who-can-subscribe), the Enterprise card's and the upsell's alike.
 */
export const SUBSCRIBER_RESTRICTIONS_PLACE: string = getPageAnchorNameForTitle(
  SubscriberRestrictionsCopy.cardTitle,
);

/*
 * Who may subscribe, in the few words a folded chip has room for - as every
 * other chip in the fold says what it is set to ("Subscriber Timezones: 2",
 * "Custom SMTP: Acme mail"): the page's private users, a number of email
 * domains, or both. Each is one phrase, translated whole.
 */
export const SUBSCRIBER_RESTRICTIONS_PRIVATE_USERS_VALUE: string =
  translationKey("Private users");

export const SUBSCRIBER_RESTRICTIONS_EMAIL_DOMAINS_VALUE: PluralTemplate = {
  one: "{{count}} email domain",
  other: "{{count}} email domains",
};

export const SUBSCRIBER_RESTRICTIONS_PRIVATE_USERS_AND_EMAIL_DOMAINS_VALUE: PluralTemplate =
  {
    one: "Private users, {{count}} email domain",
    other: "Private users, {{count}} email domains",
  };

/*
 * What Who Can Subscribe's chip says it is set to, in the reader's
 * language: "Private users", "2 email domains" or "Private users, 2 email
 * domains". Nothing while nobody is turned away.
 */
export const getSubscriberRestrictionsValue: (
  restrictions: SubscriberRestrictionsState | null | undefined,
  translator: Translator,
) => string | undefined = (
  restrictions: SubscriberRestrictionsState | null | undefined,
  translator: Translator,
): string | undefined => {
  if (!restrictions || !isSubscriberRestrictionInForce(restrictions)) {
    return undefined;
  }

  const domainCount: number = restrictions.allowedEmailDomainCount;

  if (!restrictions.limitSubscribersToPrivateUsers) {
    return translator.translatePlural(
      SUBSCRIBER_RESTRICTIONS_EMAIL_DOMAINS_VALUE,
      domainCount,
    );
  }

  if (domainCount > 0) {
    return translator.translatePlural(
      SUBSCRIBER_RESTRICTIONS_PRIVATE_USERS_AND_EMAIL_DOMAINS_VALUE,
      domainCount,
    );
  }

  return (
    translator.translateText(SUBSCRIBER_RESTRICTIONS_PRIVATE_USERS_VALUE) ||
    SUBSCRIBER_RESTRICTIONS_PRIVATE_USERS_VALUE
  );
};

/*
 * Who Can Subscribe as the page's folded More settings names it: a chip
 * while anything turns a subscriber away, saying who may subscribe; its
 * name otherwise - where every page starts.
 */
export const getSubscriberRestrictionsFoldedItem: (
  restrictions: SubscriberRestrictionsState | null | undefined,
  translator: Translator,
) => FoldedSectionItem = (
  restrictions: SubscriberRestrictionsState | null | undefined,
  translator: Translator,
): FoldedSectionItem => {
  return foldedSectionItem(SubscriberRestrictionsCopy.cardTitle, {
    key: SUBSCRIBER_RESTRICTIONS_PLACE,
    isSet: isSubscriberRestrictionInForce(restrictions),
    value: getSubscriberRestrictionsValue(restrictions, translator),
  });
};

export default SubscriberRestrictionsCopy;
