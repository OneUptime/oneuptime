import { TRANSLATED_LANGUAGES, readPage } from "./DocsContentSupport";
import { inlineCode } from "./DocsTranslationChecks";
import PublicMessageRateLimit, {
  PublicMessageKind,
  PublicMessageRateLimitConfig,
} from "Common/Server/Utils/RateLimit/PublicMessageRateLimit";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * The Subscribers & Announcements page says how many signups and management
 * links a visitor can ask for, how many a contact can be sent, what a
 * private user's password reset is held to, and which environment variable
 * changes each - all of it PublicMessageRateLimit's. Held here to the code:
 *
 *  - every number the page gives is the limit in force, and its window;
 *  - every variable the page names changes the limit it says it does, and
 *    starts at the default the page gives (each is set on a fresh load of
 *    the limiter, and read back from its config);
 *  - every language names the same variables and values (the inline code
 *    of the section is the English one's - StatusPageDocsTranslations holds
 *    the whole page's).
 */

const PAGE: string = "status-pages/subscribers";
const HEADING: string = "## Limits on signups and links";

type ConfigReading = (config: PublicMessageRateLimitConfig) => number;

// Each documented variable, and the limit it sets.
const VARIABLES: Record<string, ConfigReading> = {
  PUBLIC_MESSAGE_RATE_LIMIT_WINDOW_SECONDS: (
    config: PublicMessageRateLimitConfig,
  ): number => {
    return config.clientWindowSeconds;
  },
  PUBLIC_MESSAGE_RATE_LIMIT_PER_CONTACT_WINDOW_SECONDS: (
    config: PublicMessageRateLimitConfig,
  ): number => {
    return config.contactWindowSeconds;
  },
  PUBLIC_MESSAGE_RATE_LIMIT_STATUS_PAGE_SIGN_UPS_PER_IP: (
    config: PublicMessageRateLimitConfig,
  ): number => {
    return config.kinds[PublicMessageKind.StatusPageSignUp].perClientLimit;
  },
  PUBLIC_MESSAGE_RATE_LIMIT_TEXT_MESSAGES_PER_IP: (
    config: PublicMessageRateLimitConfig,
  ): number => {
    return config.perClientTextMessageLimit;
  },
  PUBLIC_MESSAGE_RATE_LIMIT_STATUS_PAGE_MANAGE_LINKS_PER_IP: (
    config: PublicMessageRateLimitConfig,
  ): number => {
    return config.kinds[PublicMessageKind.StatusPageManageLink].perClientLimit;
  },
  PUBLIC_MESSAGE_RATE_LIMIT_STATUS_PAGE_SIGN_UPS_PER_CONTACT: (
    config: PublicMessageRateLimitConfig,
  ): number => {
    return config.kinds[PublicMessageKind.StatusPageSignUp].perContactLimit;
  },
  PUBLIC_MESSAGE_RATE_LIMIT_STATUS_PAGE_MANAGE_LINKS_PER_CONTACT: (
    config: PublicMessageRateLimitConfig,
  ): number => {
    return config.kinds[PublicMessageKind.StatusPageManageLink].perContactLimit;
  },
  PUBLIC_MESSAGE_RATE_LIMIT_STATUS_PAGE_PASSWORD_RESETS_PER_IP: (
    config: PublicMessageRateLimitConfig,
  ): number => {
    return config.kinds[PublicMessageKind.StatusPagePasswordReset]
      .perClientLimit;
  },
  PUBLIC_MESSAGE_RATE_LIMIT_STATUS_PAGE_PASSWORD_RESETS_PER_CONTACT: (
    config: PublicMessageRateLimitConfig,
  ): number => {
    return config.kinds[PublicMessageKind.StatusPagePasswordReset]
      .perContactLimit;
  },
};

const TABLE_ROW: RegExp = /^\| `([A-Z_]+)` \| `(\d+)` \| .+ \|$/;

// The section of a page that gives the limits: its heading to the next one.
function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect(start).toBeGreaterThan(0);

  const end: number = lines.findIndex((line: string, index: number): boolean => {
    return index > start && line.startsWith("## ");
  });

  return lines.slice(start, end).join("\n");
}

function englishSection(): string {
  return sectionOf(readPage("en", PAGE), HEADING);
}

// The section of a translation: the same lines as the English one's.
function translatedSection(language: string): string {
  const english: Array<string> = readPage("en", PAGE).split("\n");
  const start: number = english.indexOf(HEADING);
  const end: number = english.findIndex(
    (line: string, index: number): boolean => {
      return index > start && line.startsWith("## ");
    },
  );

  return readPage(language, PAGE).split("\n").slice(start, end).join("\n");
}

// Load the limiter afresh, with the environment as it is now.
function freshConfig(): PublicMessageRateLimitConfig {
  let config: PublicMessageRateLimitConfig | undefined = undefined;

  jest.isolateModules(() => {
    const limiter: { default: typeof PublicMessageRateLimit } =
      jest.requireActual<{ default: typeof PublicMessageRateLimit }>(
        "Common/Server/Utils/RateLimit/PublicMessageRateLimit",
      );

    config = limiter.default.getConfig();
  });

  return config as unknown as PublicMessageRateLimitConfig;
}

afterEach(() => {
  for (const variable of Object.keys(VARIABLES)) {
    delete process.env[variable];
  }
});

describe("the English page gives the limits in force", () => {
  const config: PublicMessageRateLimitConfig =
    PublicMessageRateLimit.getConfig();
  const minutes: number = config.clientWindowSeconds / 60;

  it("has its windows: a quarter of an hour per network, an hour per contact", () => {
    expect(minutes).toBe(15);
    expect(config.contactWindowSeconds).toBe(60 * 60);
  });

  it("names each limit with its number and window, row by row", () => {
    const section: string = englishSection();
    const signUps: number =
      config.kinds[PublicMessageKind.StatusPageSignUp].perClientLimit;
    const manageLinks: number =
      config.kinds[PublicMessageKind.StatusPageManageLink].perClientLimit;
    const signUpsPerContact: number =
      config.kinds[PublicMessageKind.StatusPageSignUp].perContactLimit;
    const manageLinksPerContact: number =
      config.kinds[PublicMessageKind.StatusPageManageLink].perContactLimit;

    for (const row of [
      `| Signups from one network | ${signUps} in ${minutes} minutes |`,
      `| Signups and management links by SMS from one network, together | ${config.perClientTextMessageLimit} in ${minutes} minutes |`,
      `| Management links asked for from one network | ${manageLinks} in ${minutes} minutes |`,
      `| Signups of one email address, phone number, Slack or Microsoft Teams channel, or webhook, on all status pages together | ${signUpsPerContact} in an hour |`,
      `| Management links for one email address or phone number on all status pages together, or for one Slack or Microsoft Teams workspace name on one status page | ${manageLinksPerContact} in an hour |`,
    ]) {
      expect(section).toContain(row);
    }
  });

  it("gives a private user's password reset its limits", () => {
    const reset: { perClientLimit: number; perContactLimit: number } =
      config.kinds[PublicMessageKind.StatusPagePasswordReset];

    expect(englishSection()).toContain(
      `limited the same way: ${reset.perContactLimit} reset emails to one address in an hour, on all status pages together, and ${reset.perClientLimit} from one network in ${minutes} minutes.`,
    );
  });

  it("says each per-network limit counts an IPv6 /64 at ten times its number", () => {
    expect(englishSection()).toContain(
      "Each limit per network also counts the addresses of one IPv6 /64 together, at ten times its number.",
    );
  });
});

describe("every variable the page names", () => {
  const documented: Array<[string, number]> = englishSection()
    .split("\n")
    .map((line: string): RegExpMatchArray | null => {
      return line.match(TABLE_ROW);
    })
    .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
      return match !== null;
    })
    .map((match: RegExpMatchArray): [string, number] => {
      return [match[1] as string, Number(match[2])];
    });

  it("is one the limiter reads, and none is left out", () => {
    expect(
      documented.map((entry: [string, number]): string => {
        return entry[0];
      }),
    ).toEqual(Object.keys(VARIABLES));
  });

  it.each(Object.keys(VARIABLES))(
    "%s starts at the default the page gives, and changes the limit it says",
    (variable: string) => {
      const read: ConfigReading = VARIABLES[variable] as ConfigReading;
      const pageDefault: number | undefined = documented.find(
        (entry: [string, number]): boolean => {
          return entry[0] === variable;
        },
      )?.[1];

      expect(read(freshConfig())).toBe(pageDefault);

      process.env[variable] = "4321";

      expect(read(freshConfig())).toBe(4321);

      // Not a number, or not above zero: the default stays.
      process.env[variable] = "0";

      expect(read(freshConfig())).toBe(pageDefault);
    },
  );
});

describe("every language", () => {
  const english: Array<string> = inlineCode(englishSection());

  it.each(TRANSLATED_LANGUAGES)(
    "%s names the same variables and values in the section",
    (language: string) => {
      expect(inlineCode(translatedSection(language))).toEqual(english);
    },
  );

  it.each(TRANSLATED_LANGUAGES)(
    "%s says the per-network limits count an IPv6 /64 too",
    (language: string) => {
      const section: string = translatedSection(language);

      expect(section).toContain("IPv6");
      expect(section.split("/64").length - 1).toBe(1);
    },
  );
});
