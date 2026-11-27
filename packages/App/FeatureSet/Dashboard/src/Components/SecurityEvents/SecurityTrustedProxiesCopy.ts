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

// A range wider than any proxy's: trusted, anyone could choose the address they are blamed on.
export const TRUSTED_PROXIES_TOO_BROAD: string = translationKey(
  "{{entry}} covers too much of the internet to be a proxy. List your proxy's own addresses or ranges, such as 203.0.113.0/24.",
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
    case TrustedProxyListProblemKind.TooBroad:
      return translator.translateTemplate(TRUSTED_PROXIES_TOO_BROAD, {
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

/*
 * ---------------------------------------------------------------------------
 * Trusted Automatically (#10546): what Security Events trusts as a proxy
 * without being listed, and why - the private addresses, a connected edge,
 * the project's own load balancers (a switch) - and what it never trusts.
 * ---------------------------------------------------------------------------
 */

export const TRUSTED_AUTOMATICALLY_TITLE: string = translationKey(
  "Trusted Automatically",
);

export const TRUSTED_AUTOMATICALLY_DESCRIPTION: string = translationKey(
  "Security Events trusts these as proxies without your listing them.",
);

// The switch: whether the project's own load balancers are trusted.
export const OWN_LOAD_BALANCERS_TITLE: string = translationKey(
  "Your Load Balancers",
);

export const OWN_LOAD_BALANCERS_ON: string = translationKey(
  "Your application load balancers in AWS, Google Cloud and Azure. Each adds the client it forwards to X-Forwarded-For.",
);

export const OWN_LOAD_BALANCERS_OFF: string = translationKey(
  "Off: an attack that comes through one of them is blamed on the load balancer itself.",
);

// The load balancers found, under the switch.
export const OWN_LOAD_BALANCERS_NONE: string = translationKey(
  "None in your connected cloud accounts.",
);

export const OWN_LOAD_BALANCERS_UNREAD: string = translationKey(
  "Your load balancers couldn't be listed: you can't read cloud resources, or they couldn't be read.",
);

export const OWN_LOAD_BALANCERS_MORE: string = translationKey(
  "Not every one is listed here.",
);

export const OWN_LOAD_BALANCERS_NOT_TRUSTED: string = translationKey(
  "Not trusted while the switch is off.",
);

// The ranges every project trusts.
export const ALWAYS_TRUSTED_TITLE: string = translationKey("Private addresses");

export const ALWAYS_TRUSTED_DESCRIPTION: string = translationKey(
  "Always. Nobody has them on the internet, so each is a load balancer or an ingress inside your network.",
);

// A connected edge, such as Cloudflare: its name is the line's title.
export const EDGE_TRUSTED_DESCRIPTION: { one: string; other: string } = {
  one: translationKey(
    "Because you connected it: its {{count}} published range.",
  ),
  other: translationKey(
    "Because you connected it: its {{count}} published ranges.",
  ),
};

// What is never trusted automatically, and what to do when one is a proxy.
export const NEVER_TRUSTED_TITLE: string = translationKey(
  "Never trusted automatically",
);

export const NEVER_TRUSTED_DESCRIPTION: string = translationKey(
  "Your hosts, Kubernetes nodes and probes: whatever runs on one could name any client. If one of them is your proxy, add it to Trusted Proxies.",
);

/*
 * ---------------------------------------------------------------------------
 * Access Logs (#10548): whether the project's access logs end with the
 * X-Forwarded-For header, which a line itself never says.
 * ---------------------------------------------------------------------------
 */

export const ACCESS_LOGS_TITLE: string = translationKey("Access Logs");

export const ACCESS_LOGS_DESCRIPTION: string = translationKey(
  "How Security Events reads the client of a line in your web servers' access logs.",
);

export const ACCESS_LOGS_SWITCH_TITLE: string = translationKey(
  "Logs End With X-Forwarded-For",
);

export const ACCESS_LOGS_ON: string = translationKey(
  "Each line's last field is read as X-Forwarded-For when its first is a proxy you trust, as nginx's main format writes them.",
);

export const ACCESS_LOGS_OFF: string = translationKey(
  "Turn on if your web servers log X-Forwarded-For last, as nginx's main format does. Until then, each line's first field is its client.",
);

export const TRUSTED_PROXIES_TEST_IDS: Readonly<{
  card: string;
  fold: string;
  automatic: string;
  ownLoadBalancersSwitch: string;
  ownLoadBalancers: string;
  alwaysTrusted: string;
  edges: string;
  neverTrusted: string;
  accessLogsSwitch: string;
}> = {
  card: "security-trusted-proxies",
  fold: "security-connections-more-settings",
  automatic: "security-trusted-automatically",
  ownLoadBalancersSwitch: "security-trust-own-load-balancers",
  ownLoadBalancers: "security-own-load-balancers",
  alwaysTrusted: "security-always-trusted-proxies",
  edges: "security-trusted-edges",
  neverTrusted: "security-never-trusted-proxies",
  accessLogsSwitch: "security-access-logs-forwarded-for",
};
