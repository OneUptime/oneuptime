import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  TrustedProxyListProblem,
  TrustedProxyListProblemKind,
  getTrustedProxyListProblem,
} from "Common/Utils/SecurityEvent/ClientAddressTrust";

/*
 * THE WORDS OF TRUSTED PROXIES (#10416): the proxies a project's apps sit
 * behind, whose forwarded client address Security Events trusts
 * (Project.securityTrustedProxies, Common/Utils/SecurityEvent/
 * ClientAddressTrust). Under More settings on Security Events >
 * Connections, beside the sources the scans read. Each is an en.json key,
 * looked up where it is drawn.
 */

export const TRUSTED_PROXIES_TITLE: string = translationKey("Trusted Proxies");

export const TRUSTED_PROXIES_DESCRIPTION: string = translationKey(
  "The proxies your apps sit behind, such as a CDN or a load balancer. Security Events trusts the client address they forward in X-Forwarded-For.",
);

export const TRUSTED_PROXIES_FIELD_DESCRIPTION: string = translationKey(
  "One IP address or range a line, such as 203.0.113.0/24. Private addresses are always trusted.",
);

// Why the list cannot be saved as typed (getTrustedProxyListProblem).
export const TRUSTED_PROXIES_TOO_LONG: string = translationKey(
  "Trusted Proxies is too long. Use ranges, such as 203.0.113.0/24, for a block of addresses.",
);

export const TRUSTED_PROXIES_NOT_AN_ADDRESS: string = translationKey(
  "{{entry}} is not an IP address or a range. Write an address, such as 203.0.113.7, or a range, such as 203.0.113.0/24.",
);

export const TRUSTED_PROXIES_TOO_MANY: string = translationKey(
  "Trusted Proxies holds at most {{max}} addresses and ranges. Use ranges, such as 203.0.113.0/24, for a block of addresses.",
);

/*
 * Why the list cannot be saved as typed, in the reader's language, or null.
 * The server refuses the same lists, in English
 * (ProjectService.applySecurityTrustedProxyRules).
 */
export function getTrustedProxiesProblemText(
  text: string | undefined | null,
  translator: Translator,
): string | null {
  const problem: TrustedProxyListProblem | null =
    getTrustedProxyListProblem(text);

  if (!problem) {
    return null;
  }

  switch (problem.kind) {
    case TrustedProxyListProblemKind.TooLong:
      return translator.translateTemplate(TRUSTED_PROXIES_TOO_LONG, {});
    case TrustedProxyListProblemKind.NotAnAddress:
      return translator.translateTemplate(TRUSTED_PROXIES_NOT_AN_ADDRESS, {
        entry: problem.entry,
      });
    case TrustedProxyListProblemKind.TooMany:
      return translator.translateTemplate(TRUSTED_PROXIES_TOO_MANY, {
        max: translator.formatNumber(problem.max),
      });
  }
}

// The More settings fold on Connections, which holds the card.
export const CONNECTIONS_MORE_SETTINGS_DESCRIPTION: string = translationKey(
  "How Security Events reads where requests come from.",
);

export const TRUSTED_PROXIES_TEST_IDS: Readonly<{
  card: string;
  fold: string;
}> = {
  card: "security-trusted-proxies",
  fold: "security-connections-more-settings",
};
