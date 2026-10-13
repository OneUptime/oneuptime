import Domain from "../Domain";

/*
 * WHO MAY BE A SUBSCRIBER OF A STATUS PAGE, BEYOND HOW THEY SIGN UP.
 *
 * Two settings on the status page, each on its own, together the way to keep
 * a page's notifications to the people it is for:
 *
 *   - Only Private Users Can Subscribe (limitSubscribersToPrivateUsers): a
 *     subscriber is one of the page's private users - someone who can sign in
 *     to it - subscribed by the email address they sign in with. A visitor
 *     signed in to the page may subscribe that address and no other, and no
 *     phone, Slack, Microsoft Teams or webhook; the team may add the address
 *     of a private user, and no other. A subscriber whose address is not a
 *     private user of the page now - one added before the setting, or a
 *     reader removed since, by SCIM or by hand - is sent nothing.
 *   - Allowed Email Domains (allowedSubscriberEmailDomains): the domains an
 *     email subscriber's address may be at, one a line. An address matches a
 *     domain it is at exactly, or a subdomain of one ("eu.acme.com" for
 *     "acme.com"). Sign-ups and the team's additions at any other domain are
 *     refused, and an email subscriber already at another one is sent
 *     nothing. Empty, any domain may subscribe. Phone, Slack, Microsoft
 *     Teams and webhook subscribers have no domain and are not affected:
 *     their channels have switches of their own.
 *
 * What a sign-up or an addition is refused with is worked out here, so the
 * server, the dashboard and the status page say the same thing. Which
 * subscribers a send reaches is worked out in SQL, by
 * StatusPageSubscriberService, from the same rules.
 */

export type LimitSubscribersToPrivateUsersColumn =
  "limitSubscribersToPrivateUsers";

export const LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN: LimitSubscribersToPrivateUsersColumn =
  "limitSubscribersToPrivateUsers";

export type AllowedSubscriberEmailDomainsColumn =
  "allowedSubscriberEmailDomains";

export const ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN: AllowedSubscriberEmailDomainsColumn =
  "allowedSubscriberEmailDomains";

// The most domains the list may hold.
export const MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS: number = 100;

/*
 * The longest a list may be written: room for the most domains at their
 * longest, with spaces to spare. A longer value is refused before it is
 * split, so no write can make the server read a list of megabytes.
 */
export const MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_TEXT_LENGTH: number =
  64 * 1024;

export const SubscriberRestrictionMessages: {
  notPrivateUser: string;
  notOwnEmail: string;
  notSignedIn: string;
  emailOnly: string;
  teamAddedNotPrivateUser: string;
  domainNotAllowed: string;
  invalidDomain: string;
  tooManyDomains: string;
} = {
  notPrivateUser:
    "Only people who can sign in to this status page can subscribe to it, with the email address they sign in with.",
  notOwnEmail:
    "Subscribe with the email address you sign in to this status page with.",
  notSignedIn: "Sign in to this status page to subscribe to it.",
  emailOnly: "This status page only takes email subscriptions.",
  teamAddedNotPrivateUser:
    "This status page only takes subscribers who are its private users. Add {{email}} as a private user first, or turn off Only Private Users Can Subscribe.",
  domainNotAllowed:
    "Only email addresses at {{domains}} can subscribe to this status page.",
  invalidDomain:
    "{{domain}} is not a valid domain. Enter one domain per line, such as acme.com.",
  tooManyDomains: `Allowed Email Domains can hold at most ${MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS} domains.`,
};

// Fills {{placeholders}} in one of the messages above.
export const fillSubscriberRestrictionMessage: (
  message: string,
  values: Record<string, string>,
) => string = (message: string, values: Record<string, string>): string => {
  let filled: string = message;

  for (const [key, value] of Object.entries(values)) {
    filled = filled.split(`{{${key}}}`).join(value);
  }

  return filled;
};

/*
 * The entries of an allowed domains list as written: one a line (commas and
 * spaces separate too), trimmed, lower-cased, a leading "@" taken off, blank
 * entries and repeats left out, in the order written.
 */
export const getAllowedEmailDomainEntries: (
  value: string | null | undefined,
) => Array<string> = (value: string | null | undefined): Array<string> => {
  if (!value || typeof value !== "string") {
    return [];
  }

  // A Set keeps the order written, and finds a repeat in one step.
  const entries: Set<string> = new Set<string>();

  for (const raw of value.split(/[\s,;]+/)) {
    const entry: string = raw.trim().toLowerCase().replace(/^@+/, "");

    if (entry) {
      entries.add(entry);
    }
  }

  return Array.from(entries);
};

// The domains of a list that can be matched: its valid entries.
export const getAllowedEmailDomains: (
  value: string | null | undefined,
) => Array<string> = (value: string | null | undefined): Array<string> => {
  return getAllowedEmailDomainEntries(value).filter(
    (entry: string): boolean => {
      return Domain.isValidDomain(entry);
    },
  );
};

/*
 * What is wrong with a list, for whoever words it: the server below, in
 * English, and the dashboard, in the reader's language.
 */
export type AllowedEmailDomainsIssue =
  | { kind: "invalidDomain"; domain: string }
  | { kind: "tooManyDomains" };

// What keeps a list from being saved, or null when it can be.
export const getAllowedEmailDomainsIssue: (
  value: unknown,
) => AllowedEmailDomainsIssue | null = (
  value: unknown,
): AllowedEmailDomainsIssue | null => {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return { kind: "invalidDomain", domain: String(value).slice(0, 253) };
  }

  if (value.length > MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_TEXT_LENGTH) {
    return { kind: "tooManyDomains" };
  }

  const entries: Array<string> = getAllowedEmailDomainEntries(value);

  for (const entry of entries) {
    if (!Domain.isValidDomain(entry)) {
      return { kind: "invalidDomain", domain: entry };
    }
  }

  if (entries.length > MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS) {
    return { kind: "tooManyDomains" };
  }

  return null;
};

// Why a list cannot be saved, or null when it can.
export const getAllowedEmailDomainsProblem: (
  value: unknown,
) => string | null = (value: unknown): string | null => {
  const issue: AllowedEmailDomainsIssue | null =
    getAllowedEmailDomainsIssue(value);

  if (!issue) {
    return null;
  }

  if (issue.kind === "tooManyDomains") {
    return SubscriberRestrictionMessages.tooManyDomains;
  }

  return fillSubscriberRestrictionMessage(
    SubscriberRestrictionMessages.invalidDomain,
    { domain: issue.domain },
  );
};

// The list as it is stored: its valid entries, one a line, or null for none.
export const normalizeAllowedEmailDomains: (
  value: string | null | undefined,
) => string | null = (value: string | null | undefined): string | null => {
  const domains: Array<string> = getAllowedEmailDomains(value);

  return domains.length > 0 ? domains.join("\n") : null;
};

// What separates one address from another: no single address holds one.
const ADDRESS_SEPARATOR: RegExp = /[\s,;]/;

/*
 * The domain an email address is at, lower-cased, or null when the address
 * cannot be read as one address at one domain: an address with more than
 * one "@", or with a space or a comma in it, has no domain here, so
 * "x@acme.com@evil.com" is never read as being at acme.com.
 */
export const getEmailAddressDomain: (
  email: string | null | undefined,
) => string | null = (email: string | null | undefined): string | null => {
  if (!email || typeof email !== "string") {
    return null;
  }

  const address: string = email.trim().toLowerCase();

  if (ADDRESS_SEPARATOR.test(address)) {
    return null;
  }

  const at: number = address.indexOf("@");

  if (at <= 0 || at !== address.lastIndexOf("@")) {
    return null;
  }

  const domain: string = address.slice(at + 1);

  return Domain.isValidDomain(domain) ? domain : null;
};

/*
 * Whether an address is at one of the domains: exactly, or at a subdomain
 * of one. No domains means any address.
 */
export const isEmailAtAllowedDomain: (data: {
  email: string | null | undefined;
  domains: Array<string>;
}) => boolean = (data: {
  email: string | null | undefined;
  domains: Array<string>;
}): boolean => {
  if (data.domains.length === 0) {
    return true;
  }

  const domain: string | null = getEmailAddressDomain(data.email);

  if (!domain) {
    return false;
  }

  return data.domains.some((allowed: string): boolean => {
    return domain === allowed || domain.endsWith(`.${allowed}`);
  });
};

// "acme.com", "acme.com or acme.de", "acme.com, acme.de or acme.fr".
export const formatAllowedEmailDomains: (domains: Array<string>) => string = (
  domains: Array<string>,
): string => {
  if (domains.length <= 1) {
    return domains[0] || "";
  }

  return `${domains.slice(0, -1).join(", ")} or ${domains[domains.length - 1]}`;
};

// What a sign-up or an addition at another domain is refused with.
export const getDomainNotAllowedMessage: (domains: Array<string>) => string = (
  domains: Array<string>,
): string => {
  return fillSubscriberRestrictionMessage(
    SubscriberRestrictionMessages.domainNotAllowed,
    { domains: formatAllowedEmailDomains(domains) },
  );
};

/*
 * Whether two email addresses are the same address: compared trimmed and
 * lower-cased, as every email column stores them.
 */
export const isSameEmailAddress: (
  first: string | null | undefined,
  second: string | null | undefined,
) => boolean = (
  first: string | null | undefined,
  second: string | null | undefined,
): boolean => {
  if (!first || !second) {
    return false;
  }

  return first.trim().toLowerCase() === second.trim().toLowerCase();
};
