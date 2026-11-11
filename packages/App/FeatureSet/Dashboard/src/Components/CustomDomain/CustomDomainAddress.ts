import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The address typed into Add Custom Domain (status.example.com), and the
 * project domain it belongs to (example.com).
 *
 * Adding a custom domain used to ask for a subdomain and one of the
 * project's verified domains, from a list that left out every domain not
 * verified yet - so a person who started on the status page had to leave it,
 * add and verify the domain in Project Settings, wait for DNS, and come
 * back. Now the dialog asks for the address people will open, and works out
 * the rest:
 *
 *   - the project domain is the longest of the project's domains that the
 *     address is, or ends with: status.eu.example.com belongs to
 *     eu.example.com before example.com;
 *   - when the project has none, the domain to add is the address without
 *     its first label (status.example.com -> example.com), or the address
 *     itself when that would leave a public suffix (example.co.uk, or a
 *     two-label address: the root of the domain).
 *
 * The TXT record then goes on that domain, the CNAME on the address. They
 * can never be on the same name: a name with a CNAME may have no other
 * record.
 *
 * Kept free of React, so App/Tests and the dialog read the same rules.
 */

export interface ProjectDomainOption {
  id: string;
  // The domain's name, as the project has it: example.com.
  domain: string;
  isVerified: boolean;
  // The TXT record's value that verifies it.
  verificationText?: string | undefined;
}

export interface ParsedCustomDomainAddress {
  // The whole address, normalized: status.example.com.
  fullDomain: string;
}

/*
 * Second-level labels under a two-letter country code that are public
 * suffixes in their own right (example.co.uk, example.com.au): the domain a
 * person owns is one label longer there.
 */
const COUNTRY_SECOND_LEVEL_LABELS: ReadonlyArray<string> = [
  "ac",
  "co",
  "com",
  "edu",
  "gov",
  "net",
  "org",
  "ne",
  "or",
  "gen",
  "ltd",
  "plc",
];

const LABEL: RegExp = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const ALL_DIGITS: RegExp = /^\d+$/;

export const CustomDomainAddressCopy: {
  invalidAddress: string;
} = {
  invalidAddress: translationKey(
    "Enter the address people will open, such as status.example.com: letters, digits, dots and hyphens only.",
  ),
};

/*
 * Reads what was typed: a pasted URL is cut to its host, and case, spaces
 * and the root's trailing dot do not count. Answers undefined for anything
 * that is not a hostname of at least two labels.
 */
export const parseCustomDomainAddress: (
  typed: string | undefined | null,
) => ParsedCustomDomainAddress | undefined = (
  typed: string | undefined | null,
): ParsedCustomDomainAddress | undefined => {
  let address: string = (typed || "").trim().toLowerCase();

  // A pasted URL: its scheme, its path and its port go.
  address = address.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");

  const end: number = address.search(/[/?#]/);

  if (end >= 0) {
    address = address.substring(0, end);
  }

  // Credentials, then a port.
  address = address.substring(address.lastIndexOf("@") + 1);
  address = address.replace(/:\d+$/, "");

  while (address.endsWith(".")) {
    address = address.substring(0, address.length - 1);
  }

  if (!address || address.length > 253) {
    return undefined;
  }

  const labels: Array<string> = address.split(".");

  if (labels.length < 2) {
    return undefined;
  }

  for (const label of labels) {
    if (!LABEL.test(label)) {
      return undefined;
    }
  }

  // A top-level domain is never all digits: that is an IP address.
  if (ALL_DIGITS.test(labels[labels.length - 1]!)) {
    return undefined;
  }

  return { fullDomain: address };
};

const normalizeDomain: (domain: string) => string = (
  domain: string,
): string => {
  let normalized: string = domain.trim().toLowerCase();

  while (normalized.endsWith(".")) {
    normalized = normalized.substring(0, normalized.length - 1);
  }

  return normalized;
};

// Whether the address is the domain, or a name under it.
export const isAddressOnDomain: (
  fullDomain: string,
  domain: string,
) => boolean = (fullDomain: string, domain: string): boolean => {
  const normalizedDomain: string = normalizeDomain(domain);

  if (!normalizedDomain) {
    return false;
  }

  return (
    fullDomain === normalizedDomain ||
    fullDomain.endsWith(`.${normalizedDomain}`)
  );
};

/*
 * The project's domain the address belongs to: the longest one it is, or
 * ends with. Of two with the same name, a verified one.
 */
export const findProjectDomainForAddress: (
  fullDomain: string,
  projectDomains: Array<ProjectDomainOption>,
) => ProjectDomainOption | undefined = (
  fullDomain: string,
  projectDomains: Array<ProjectDomainOption>,
): ProjectDomainOption | undefined => {
  let best: ProjectDomainOption | undefined = undefined;

  for (const option of projectDomains) {
    if (!isAddressOnDomain(fullDomain, option.domain)) {
      continue;
    }

    if (!best) {
      best = option;
      continue;
    }

    const length: number = normalizeDomain(option.domain).length;
    const bestLength: number = normalizeDomain(best.domain).length;

    if (
      length > bestLength ||
      (length === bestLength && option.isVerified && !best.isVerified)
    ) {
      best = option;
    }
  }

  return best;
};

/*
 * The domain to add to the project for an address none of its domains
 * covers: the address without its first label, unless that leaves a
 * public suffix - then the address itself.
 */
export const getDomainToAddForAddress: (fullDomain: string) => string = (
  fullDomain: string,
): string => {
  const labels: Array<string> = fullDomain.split(".");

  if (labels.length <= 2) {
    return fullDomain;
  }

  const parent: Array<string> = labels.slice(1);

  const isCountrySuffix: boolean =
    parent.length === 2 &&
    parent[1]!.length === 2 &&
    COUNTRY_SECOND_LEVEL_LABELS.includes(parent[0]!);

  return isCountrySuffix ? fullDomain : parent.join(".");
};

/*
 * The subdomain the custom domain is added with: what comes before its
 * domain, or "" for the domain itself (its root).
 */
export const getSubdomainOnDomain: (
  fullDomain: string,
  domain: string,
) => string = (fullDomain: string, domain: string): string => {
  const normalizedDomain: string = normalizeDomain(domain);

  if (fullDomain === normalizedDomain) {
    return "";
  }

  return fullDomain.substring(
    0,
    fullDomain.length - normalizedDomain.length - 1,
  );
};
