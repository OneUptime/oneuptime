/*
 * The answers the server refuses a new custom domain with that are about
 * one field of the Create dialog - a status page's, a dashboard's or a
 * form's (CustomDomainsTable) - so the dialog shows each under its field
 * (Field.ownsServerError) instead of over the whole form:
 *
 *   - Subdomain: a name another status page, dashboard or form has already
 *     ("report.acme.com is already in use: ...", CustomDomainConflicts),
 *     and a subdomain that is not a plain DNS label ("Subdomain x/y is not
 *     valid. ...", the domain services' normalizeAndValidateSubdomain). The
 *     subdomain is what the person changes to get past either.
 *   - Domain: a domain that stopped being verified while the dialog was
 *     open ("This domain is not verified. ..."), or none the server could
 *     read ("Please select a valid domain.").
 *
 * Read with indexOf, never a pattern: the words are the server's, and the
 * subdomain in them is whatever was typed. Matched in any case. Kept free of
 * React, so App's tests can read it.
 */

// The words of a name another status page, dashboard or form already has.
export const NAME_IN_USE_WORDS: string = "is already in use";

// Every answer about the subdomain names it.
export const SUBDOMAIN_WORDS: string = "subdomain";

// The words of a domain the server will not put a custom domain on.
export const DOMAIN_REFUSAL_WORDS: ReadonlyArray<string> = [
  "domain is not verified",
  "select a valid domain",
];

/*
 * Whether the answer is about the subdomain: the name is taken, or the
 * subdomain is not a plain label.
 */
export const isSubdomainServerError: (message: string) => boolean = (
  message: string,
): boolean => {
  const text: string = message.toLowerCase();

  return (
    text.indexOf(NAME_IN_USE_WORDS) !== -1 ||
    text.indexOf(SUBDOMAIN_WORDS) !== -1
  );
};

// Whether the answer is about the domain picked under Domain.
export const isDomainServerError: (message: string) => boolean = (
  message: string,
): boolean => {
  const text: string = message.toLowerCase();

  return DOMAIN_REFUSAL_WORDS.some((words: string): boolean => {
    return text.indexOf(words) !== -1;
  });
};
