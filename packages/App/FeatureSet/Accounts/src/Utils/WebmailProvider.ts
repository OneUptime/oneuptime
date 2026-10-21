/*
 * "Open Gmail" on the check-your-email screen.
 *
 * The button is a shortcut, never a promise: it is offered only when the
 * address typed at signup belongs, EXACTLY, to one of a handful of consumer
 * mail services whose inbox URL is fixed and public. Anything else -- a
 * company domain, a lookalike such as "gmail.com.evil.io" or "notgmail.com",
 * a malformed address -- gets no button at all, rather than a guess that sends
 * someone to the wrong sign-in page.
 *
 * Parsed here with anchored rules instead of Common's Email.isValid, which
 * matches a substring and would accept "a@b@gmail.com". The link target is
 * always one of the constant URLs below; nothing from the address is ever put
 * into it.
 */

export interface WebmailProvider {
  name: string;
  url: string;
}

interface WebmailProviderRule {
  provider: WebmailProvider;
  domains: Array<string>;
  domainPatterns: Array<RegExp>;
}

// Regional Outlook/Hotmail/Live domains: outlook.de, hotmail.co.uk, live.com.au.
const OUTLOOK_REGIONAL_DOMAIN_PATTERN: RegExp =
  /^(outlook|hotmail|live)\.(?:[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

// Regional Yahoo domains: yahoo.fr, yahoo.co.jp, yahoo.com.br.
const YAHOO_REGIONAL_DOMAIN_PATTERN: RegExp =
  /^yahoo\.(?:[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;

// Brand names, shown as they are in every language.
const WEBMAIL_PROVIDER_RULES: Array<WebmailProviderRule> = [
  {
    provider: {
      name: "Gmail",
      url: "https://mail.google.com/mail/u/0/#inbox",
    },
    domains: ["gmail.com", "googlemail.com"],
    domainPatterns: [],
  },
  {
    provider: {
      name: "Outlook",
      url: "https://outlook.live.com/mail/0/",
    },
    domains: ["outlook.com", "hotmail.com", "live.com", "msn.com"],
    domainPatterns: [OUTLOOK_REGIONAL_DOMAIN_PATTERN],
  },
  {
    provider: {
      name: "Yahoo Mail",
      url: "https://mail.yahoo.com/",
    },
    domains: ["yahoo.com", "ymail.com", "rocketmail.com"],
    domainPatterns: [YAHOO_REGIONAL_DOMAIN_PATTERN],
  },
  {
    provider: {
      name: "iCloud Mail",
      url: "https://www.icloud.com/mail",
    },
    domains: ["icloud.com", "me.com", "mac.com"],
    domainPatterns: [],
  },
  {
    provider: {
      name: "Proton Mail",
      url: "https://mail.proton.me/",
    },
    domains: ["proton.me", "protonmail.com", "protonmail.ch", "pm.me"],
    domainPatterns: [],
  },
];

export const getWebmailProvider: (
  email: string | null | undefined,
) => WebmailProvider | null = (
  email: string | null | undefined,
): WebmailProvider | null => {
  if (typeof email !== "string") {
    return null;
  }

  const parts: Array<string> = email.trim().split("@");

  // Exactly one "@", with something on both sides of it.
  if (parts.length !== 2) {
    return null;
  }

  const localPart: string = parts[0] || "";
  const domain: string = (parts[1] || "").toLowerCase();

  if (!localPart || !domain) {
    return null;
  }

  for (const rule of WEBMAIL_PROVIDER_RULES) {
    const matches: boolean =
      rule.domains.includes(domain) ||
      rule.domainPatterns.some((pattern: RegExp): boolean => {
        return pattern.test(domain);
      });

    if (matches) {
      // A copy, so no caller can edit the shared table.
      return { name: rule.provider.name, url: rule.provider.url };
    }
  }

  return null;
};
