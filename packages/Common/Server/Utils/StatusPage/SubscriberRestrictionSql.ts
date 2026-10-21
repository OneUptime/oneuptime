/*
 * WHICH SUBSCRIBERS A STATUS PAGE TAKES, IN SQL: the page's Only Private
 * Users Can Subscribe and Allowed Email Domains
 * (Types/StatusPage/SubscriberRestrictions) as conditions on a subscriber
 * row, so a send reaches, and the audience summary counts, the same
 * subscribers.
 *
 * Asked in the database rather than of rows read out: the subscriber loader
 * reads a page in _id batches (StatusPageSubscriberService.
 * getSubscribersByStatusPage), and "a batch smaller than the limit is the
 * last" only holds when the rows a batch leaves out are never read.
 *
 *   - Only Private Users Can Subscribe on: a subscriber is taken when its
 *     email is a private user's, and it has no other contact.
 *   - Allowed Email Domains set: a subscriber with an email is taken when
 *     the address is at one of them. A subscriber with no email has no
 *     domain, and is left to the setting above.
 *
 * One condition for each contact column, so the loader can put each on its
 * own column of a find; the counts ask all of them together. Every builder
 * takes the SQL expressions it applies to - a column, a bound parameter, a
 * subquery - and never a value: values are bound.
 */

// The page settings a condition reads, as SQL expressions.
export interface SubscriberRestrictionSettingsSql {
  limitSubscribersToPrivateUsers: string;
  allowedSubscriberEmailDomains: string;
}

// The contact columns of a subscriber row, as SQL expressions.
export interface SubscriberContactColumnsSql {
  email: string;
  phone: string;
  slack: string;
  microsoftTeams: string;
  webhook: string;
}

/*
 * Where the private users an email is matched against come from: the
 * subscriber's page, and a condition on "privateUser"."statusPageId" that
 * reads no private user of a page not asked about - which keeps the
 * subquery free of the subscriber row, so Postgres reads it once.
 */
export interface SubscriberPrivateUsersSql {
  statusPageId: string;
  privateUsersOf: string;
}

/*
 * The domains of an allowed domains list, as the list is stored: split the
 * way getAllowedEmailDomainEntries splits it (on spaces, line breaks,
 * commas and semicolons), lower-cased, a leading "@" taken off. An entry
 * left blank by the split is skipped by the conditions that read the list.
 */
const getDomainEntriesSql: (list: string) => string = (
  list: string,
): string => {
  return `regexp_split_to_array(LOWER(COALESCE(${list}, '')), '[[:space:],;]+')`;
};

const getDomainEntrySql: (entry: string) => string = (
  entry: string,
): string => {
  return `LTRIM(${entry}, '@')`;
};

/*
 * The domain an address is at, lower-cased, or NULL: as
 * getEmailAddressDomain reads it, one "@" and no space, comma or semicolon,
 * so "x@acme.com@evil.com" is at no domain.
 */
export const getEmailDomainSql: (email: string) => string = (
  email: string,
): string => {
  return `SUBSTRING(LOWER(TRIM(${email})) FROM '^[^@[:space:],;]+@([^@[:space:],;]+)$')`;
};

// Whether a text column holds nothing: NULL, empty or blank.
export const getIsBlankSql: (column: string) => string = (
  column: string,
): string => {
  return `(NULLIF(TRIM(${column}), '') IS NULL)`;
};

// Whether a list names at least one domain.
export const getHasAllowedDomainsSql: (list: string) => string = (
  list: string,
): string => {
  const entry: string = getDomainEntrySql(`"listedDomain"."entry"`);

  return `EXISTS (SELECT 1 FROM UNNEST(${getDomainEntriesSql(list)}) AS "listedDomain"("entry") WHERE ${entry} <> '')`;
};

/*
 * Whether an address is at one of a list's domains: exactly, or at a
 * subdomain of one ("eu.acme.com" for "acme.com"), as
 * isEmailAtAllowedDomain decides.
 */
export const getIsAtAllowedDomainSql: (data: {
  email: string;
  list: string;
}) => string = (data: { email: string; list: string }): string => {
  const domain: string = getEmailDomainSql(data.email);
  const entry: string = getDomainEntrySql(`"allowedDomain"."entry"`);

  return `EXISTS (SELECT 1 FROM UNNEST(${getDomainEntriesSql(data.list)}) AS "allowedDomain"("entry") WHERE ${entry} <> '' AND (${domain} = ${entry} OR RIGHT(${domain}, LENGTH(${entry}) + 1) = '.' || ${entry}))`;
};

/*
 * Whether an address is the email of one of its page's private users:
 * compared trimmed and lower-cased, as isPrivateUserEmail compares it. A
 * private user deleted - by hand, or by SCIM - is one no longer. A blank
 * address is no one's.
 */
export const getIsPrivateUserEmailSql: (
  data: SubscriberPrivateUsersSql & { email: string },
) => string = (data: SubscriberPrivateUsersSql & { email: string }): string => {
  return `(NOT ${getIsBlankSql(data.email)} AND (${data.statusPageId}, LOWER(TRIM(${data.email}))) IN (SELECT "privateUser"."statusPageId", LOWER(TRIM("privateUser"."email")) FROM "StatusPagePrivateUser" "privateUser" WHERE ${data.privateUsersOf} AND "privateUser"."deletedAt" IS NULL AND "privateUser"."email" IS NOT NULL))`;
};

// Whether the page takes only its private users.
const getTakesOnlyPrivateUsersSql: (
  settings: SubscriberRestrictionSettingsSql,
) => string = (settings: SubscriberRestrictionSettingsSql): string => {
  return `(${settings.limitSubscribersToPrivateUsers}) IS TRUE`;
};

/*
 * The condition on a subscriber's email: a private user's, when the page
 * takes only those; at an allowed domain, when it has any.
 */
export const getEmailConditionSql: (
  data: SubscriberPrivateUsersSql & {
    email: string;
    settings: SubscriberRestrictionSettingsSql;
  },
) => string = (
  data: SubscriberPrivateUsersSql & {
    email: string;
    settings: SubscriberRestrictionSettingsSql;
  },
): string => {
  const list: string = data.settings.allowedSubscriberEmailDomains;

  return `((NOT ${getTakesOnlyPrivateUsersSql(data.settings)} OR ${getIsPrivateUserEmailSql(data)}) AND (${getIsBlankSql(data.email)} OR NOT ${getHasAllowedDomainsSql(list)} OR ${getIsAtAllowedDomainSql({ email: data.email, list: list })}))`;
};

/*
 * The condition on each of a subscriber's other contacts - phone, Slack,
 * Microsoft Teams, webhook: none, when the page takes only its private
 * users.
 */
export const getOtherContactConditionSql: (data: {
  column: string;
  settings: SubscriberRestrictionSettingsSql;
}) => string = (data: {
  column: string;
  settings: SubscriberRestrictionSettingsSql;
}): string => {
  return `(NOT ${getTakesOnlyPrivateUsersSql(data.settings)} OR ${getIsBlankSql(data.column)})`;
};

/*
 * Whether the page takes a subscriber row: the condition on every contact
 * column, together.
 */
export const getIsTakenByItsStatusPageSql: (
  data: SubscriberPrivateUsersSql & {
    subscriber: SubscriberContactColumnsSql;
    settings: SubscriberRestrictionSettingsSql;
  },
) => string = (
  data: SubscriberPrivateUsersSql & {
    subscriber: SubscriberContactColumnsSql;
    settings: SubscriberRestrictionSettingsSql;
  },
): string => {
  return [
    getEmailConditionSql({
      email: data.subscriber.email,
      statusPageId: data.statusPageId,
      privateUsersOf: data.privateUsersOf,
      settings: data.settings,
    }),
    ...[
      data.subscriber.phone,
      data.subscriber.slack,
      data.subscriber.microsoftTeams,
      data.subscriber.webhook,
    ].map((column: string): string => {
      return getOtherContactConditionSql({
        column: column,
        settings: data.settings,
      });
    }),
  ].join(" AND ");
};
