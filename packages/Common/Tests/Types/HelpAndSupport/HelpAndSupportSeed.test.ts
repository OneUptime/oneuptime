import {
  HELP_ITEMS,
  HELP_LINK_MAX_LENGTH,
  HelpAndSupportProblems,
  HelpAndSupportSettings,
  HelpChoice,
  HelpItem,
  INVITE_MESSAGE_MAX_LENGTH,
  getDefaultHelpAndSupportSettings,
  readHelpAndSupportSettings,
  toHelpAndSupportJSON,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import {
  HELP_AND_SUPPORT_SEED_VARIABLES,
  HelpAndSupportSeed,
  HelpAndSupportSeedProblems,
  SEEDED_ITEMS_KEY,
  getHelpAndSupportHelmValue,
  getHelpAndSupportSeedSourceName,
  getUnappliedSeedItems,
  readHelpAndSupportSeed,
  readSeededItems,
  toSeededHelpAndSupportJSON,
  withSeededItemsKept,
} from "../../../Types/HelpAndSupport/HelpAndSupportSeed";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * HELP AND SUPPORT FROM THE SERVER'S CONFIGURATION, AS RULES (#10938).
 *
 * The Helm chart's helpAndSupport values reach the app as HELP_AND_SUPPORT_*
 * (config.env sets them for docker-compose), and seed Admin Dashboard >
 * Settings > Help and Support while nothing is saved there. Each value is
 * read the way a person writes it - an address, a link, "hidden", "shown",
 * true or false, words - and checked exactly as the page checks it, so the
 * configuration can never store what the page would refuse: a javascript:
 * link, an address with a name in it, markup in the message.
 */

type Environment = Record<string, string | undefined>;

const seedOf: (environment: Environment) => HelpAndSupportSeed = (
  environment: Environment,
): HelpAndSupportSeed => {
  return readHelpAndSupportSeed(environment);
};

// What one variable seeds, or the problem it was refused with.
const oneValue: (
  item: HelpItem,
  value: string,
) => { choice: HelpChoice; value: string | null } | string | null = (
  item: HelpItem,
  value: string,
): { choice: HelpChoice; value: string | null } | string | null => {
  const seed: HelpAndSupportSeed = seedOf({
    [HELP_AND_SUPPORT_SEED_VARIABLES[item]]: value,
  });

  if (seed.problems.length > 0) {
    return seed.problems[0]!.problem;
  }

  return seed.changes[0]?.setting || null;
};

describe("the variables", () => {
  test("every setting has its own, named HELP_AND_SUPPORT_*", () => {
    const variables: Array<string> = HELP_ITEMS.map(
      (item: HelpItem): string => {
        return HELP_AND_SUPPORT_SEED_VARIABLES[item];
      },
    );

    expect(new Set(variables).size).toBe(HELP_ITEMS.length);

    for (const variable of variables) {
      expect(variable).toMatch(/^HELP_AND_SUPPORT_[A-Z_]+$/);
    }
  });

  test("are named as the docs and config.env name them", () => {
    expect(HELP_AND_SUPPORT_SEED_VARIABLES).toEqual({
      [HelpItem.SupportEmail]: "HELP_AND_SUPPORT_SUPPORT_EMAIL",
      [HelpItem.Chat]: "HELP_AND_SUPPORT_CHAT",
      [HelpItem.RequestDemo]: "HELP_AND_SUPPORT_REQUEST_DEMO",
      [HelpItem.GiveFeedback]: "HELP_AND_SUPPORT_GIVE_FEEDBACK",
      [HelpItem.HelpLink]: "HELP_AND_SUPPORT_HELP_LINK",
      [HelpItem.GitHub]: "HELP_AND_SUPPORT_GITHUB",
      [HelpItem.MobileApp]: "HELP_AND_SUPPORT_MOBILE_APP",
      [HelpItem.InviteMessage]: "HELP_AND_SUPPORT_INVITE_MESSAGE",
    });
  });

  test("the Helm value of each is helpAndSupport.<the setting>", () => {
    expect(getHelpAndSupportHelmValue(HelpItem.SupportEmail)).toBe(
      "helpAndSupport.supportEmail",
    );
    expect(getHelpAndSupportHelmValue(HelpItem.GitHub)).toBe(
      "helpAndSupport.gitHub",
    );
  });

  test("the page names both, since either may have set a setting", () => {
    expect(getHelpAndSupportSeedSourceName(HelpItem.Chat)).toBe(
      "HELP_AND_SUPPORT_CHAT (helpAndSupport.chat)",
    );
    expect(getHelpAndSupportSeedSourceName(HelpItem.InviteMessage)).toBe(
      "HELP_AND_SUPPORT_INVITE_MESSAGE (helpAndSupport.inviteMessage)",
    );
  });

  test("the key that records what was seeded is no setting's", () => {
    expect(HELP_ITEMS as ReadonlyArray<string>).not.toContain(SEEDED_ITEMS_KEY);
  });
});

describe("a server configured with nothing", () => {
  test("seeds nothing, and writes nothing", () => {
    const seed: HelpAndSupportSeed = seedOf({});

    expect(seed).toEqual({ changes: [], problems: [] });
    expect(toSeededHelpAndSupportJSON(seed)).toBeNull();
  });

  test("empty values, spaces and the word default seed nothing either", () => {
    const environment: Environment = {};

    for (const item of HELP_ITEMS) {
      environment[HELP_AND_SUPPORT_SEED_VARIABLES[item]] = "";
    }

    expect(seedOf(environment)).toEqual({ changes: [], problems: [] });

    for (const item of HELP_ITEMS) {
      expect(oneValue(item, "   ")).toBeNull();
      expect(oneValue(item, "default")).toBeNull();
      expect(oneValue(item, "Default")).toBeNull();
    }
  });

  test("other variables of the server are never read as settings", () => {
    expect(
      seedOf({
        HELP_AND_SUPPORT: '{"chat":{"choice":"hidden"}}',
        SERVER_PRODUCTS: "everything",
        HELP_AND_SUPPORT_SUPPORT: "it-help@example.com",
      }),
    ).toEqual({ changes: [], problems: [] });
  });
});

describe("each setting, as a person writes it", () => {
  test("the support address: an address, kept as the page keeps one", () => {
    expect(oneValue(HelpItem.SupportEmail, " IT-Help@Example.com ")).toEqual({
      choice: HelpChoice.Email,
      value: "it-help@example.com",
    });
    expect(oneValue(HelpItem.SupportEmail, "hidden")).toEqual({
      choice: HelpChoice.Hidden,
      value: null,
    });
  });

  test("the chat: a link, or hidden", () => {
    expect(
      oneValue(HelpItem.Chat, "https://acme.slack.com/archives/C024BE91L"),
    ).toEqual({
      choice: HelpChoice.Link,
      value: "https://acme.slack.com/archives/C024BE91L",
    });
    expect(oneValue(HelpItem.Chat, "HIDDEN")).toEqual({
      choice: HelpChoice.Hidden,
      value: null,
    });
  });

  test("the help page and the mobile app's page: a link, or hidden", () => {
    for (const item of [HelpItem.HelpLink, HelpItem.MobileApp]) {
      expect(oneValue(item, "https://help.acme.example/oneuptime")).toEqual({
        choice: HelpChoice.Link,
        value: "https://help.acme.example/oneuptime",
      });
      expect(oneValue(item, "hide")).toEqual({
        choice: HelpChoice.Hidden,
        value: null,
      });
    }
  });

  test("Give feedback: an address, a link, or hidden, told apart by the scheme", () => {
    expect(oneValue(HelpItem.GiveFeedback, "feedback@acme.example")).toEqual({
      choice: HelpChoice.Email,
      value: "feedback@acme.example",
    });
    expect(
      oneValue(HelpItem.GiveFeedback, "https://help.acme.example/feedback"),
    ).toEqual({
      choice: HelpChoice.Link,
      value: "https://help.acme.example/feedback",
    });
    expect(
      oneValue(HelpItem.GiveFeedback, "mailto:feedback@acme.example"),
    ).toEqual({
      choice: HelpChoice.Link,
      value: "mailto:feedback@acme.example",
    });
    expect(oneValue(HelpItem.GiveFeedback, "hidden")).toEqual({
      choice: HelpChoice.Hidden,
      value: null,
    });
  });

  test.each([HelpItem.RequestDemo, HelpItem.GitHub])(
    "%s: shown or hidden, and YAML's true and false as the chart writes them",
    (item: HelpItem) => {
      for (const word of ["hidden", "Hidden", "hide", "false", "FALSE", "no"]) {
        expect({ word, seeds: oneValue(item, word) }).toEqual({
          word,
          seeds: { choice: HelpChoice.Hidden, value: null },
        });
      }

      for (const word of ["shown", "Shown", "show", "true", "yes", "default"]) {
        expect({ word, seeds: oneValue(item, word) }).toEqual({
          word,
          seeds: null,
        });
      }
    },
  );

  test.each([HelpItem.RequestDemo, HelpItem.GitHub])(
    "%s: any other word is refused, with what to write",
    (item: HelpItem) => {
      expect(oneValue(item, "off-please")).toBe(
        HelpAndSupportSeedProblems.notShownOrHidden,
      );
      expect(oneValue(item, "https://github.com/acme/issues")).toBe(
        HelpAndSupportSeedProblems.notShownOrHidden,
      );
    },
  );

  test("the sign-in message: plain text, its lines kept as the page keeps them", () => {
    expect(
      oneValue(
        HelpItem.InviteMessage,
        "Ask the IT service desk to invite you:\r\nit-help@example.com  \n",
      ),
    ).toEqual({
      choice: HelpChoice.Text,
      value: "Ask the IT service desk to invite you:\nit-help@example.com",
    });
  });

  test("the sign-in message cannot be hidden: the word is refused, never shown as the message", () => {
    expect(oneValue(HelpItem.InviteMessage, "hidden")).toBe(
      HelpAndSupportSeedProblems.wordNotAChoice,
    );
  });
});

describe("a value the page would refuse is refused here too", () => {
  test.each([
    ["javascript:alert(document.cookie)", HelpAndSupportProblems.linkScheme],
    ["JavaScript:alert(1)", HelpAndSupportProblems.linkScheme],
    [
      "data:text/html,<script>alert(1)</script>",
      HelpAndSupportProblems.linkScheme,
    ],
    ["vbscript:msgbox(1)", HelpAndSupportProblems.linkScheme],
    ["file:///etc/passwd", HelpAndSupportProblems.linkScheme],
    // The URL parser glues a scheme split by a tab back together.
    ["java\tscript:alert(1)", HelpAndSupportProblems.linkScheme],
    [
      'https://help.acme.example/"onmouseover="x',
      HelpAndSupportProblems.linkInvalid,
    ],
    ["https://help.acme.example/<b>", HelpAndSupportProblems.linkInvalid],
    ["https://oneuptime.com@evil.example", HelpAndSupportProblems.linkInvalid],
    ["https:help.acme.example", HelpAndSupportProblems.linkInvalid],
    ["help.acme.example", HelpAndSupportProblems.linkInvalid],
    [
      `https://help.acme.example/${"a".repeat(HELP_LINK_MAX_LENGTH)}`,
      HelpAndSupportProblems.linkTooLong,
    ],
  ])("the chat link %j", (value: string, problem: string) => {
    expect(oneValue(HelpItem.Chat, value)).toBe(problem);
  });

  test.each([
    "Ada <ada@acme.example>",
    '"quoted"@acme.example',
    "it-help@acme.example, other@acme.example",
    "not an address",
    "it-help@acme.example\nBcc: x@evil.example",
  ])("the support address %j", (value: string) => {
    expect(oneValue(HelpItem.SupportEmail, value)).toBe(
      HelpAndSupportProblems.emailInvalid,
    );
  });

  test("a link of the right scheme on the address alone is refused as an address", () => {
    expect(oneValue(HelpItem.SupportEmail, "https://help.acme.example")).toBe(
      HelpAndSupportProblems.emailInvalid,
    );
  });

  test("Give feedback refuses an unsafe link as the page does", () => {
    expect(oneValue(HelpItem.GiveFeedback, "javascript:alert(1)")).toBe(
      HelpAndSupportProblems.linkScheme,
    );
  });

  test("the sign-in message refuses markup and a message too long", () => {
    expect(oneValue(HelpItem.InviteMessage, "<script>alert(1)</script>")).toBe(
      HelpAndSupportProblems.textHtml,
    );
    expect(
      oneValue(
        HelpItem.InviteMessage,
        "a".repeat(INVITE_MESSAGE_MAX_LENGTH + 1),
      ),
    ).toBe(HelpAndSupportProblems.textTooLong);
  });

  test("each refusal names its setting and its variable, and the rest are still seeded", () => {
    const seed: HelpAndSupportSeed = seedOf({
      HELP_AND_SUPPORT_SUPPORT_EMAIL: "it-help@acme.example",
      HELP_AND_SUPPORT_CHAT: "javascript:alert(1)",
      HELP_AND_SUPPORT_GITHUB: "hidden",
      HELP_AND_SUPPORT_HELP_LINK: "data:text/html,x",
    });

    expect(seed.problems).toEqual([
      {
        item: HelpItem.Chat,
        variable: "HELP_AND_SUPPORT_CHAT",
        problem: HelpAndSupportProblems.linkScheme,
      },
      {
        item: HelpItem.HelpLink,
        variable: "HELP_AND_SUPPORT_HELP_LINK",
        problem: HelpAndSupportProblems.linkScheme,
      },
    ]);
    expect(
      seed.changes.map((change: { item: HelpItem }): HelpItem => {
        return change.item;
      }),
    ).toEqual([HelpItem.SupportEmail, HelpItem.GitHub]);
  });
});

describe("what a seed writes", () => {
  const SEED: HelpAndSupportSeed = seedOf({
    HELP_AND_SUPPORT_SUPPORT_EMAIL: "it-help@acme.example",
    HELP_AND_SUPPORT_CHAT: "https://acme.slack.com/archives/C024BE91L",
    HELP_AND_SUPPORT_REQUEST_DEMO: "false",
    HELP_AND_SUPPORT_INVITE_MESSAGE: "Ask the IT service desk.",
  });

  test("the settings as the page keeps them, and which of them it seeded", () => {
    expect(toSeededHelpAndSupportJSON(SEED)).toEqual({
      supportEmail: { choice: "email", value: "it-help@acme.example" },
      chat: {
        choice: "link",
        value: "https://acme.slack.com/archives/C024BE91L",
      },
      requestDemo: { choice: "hidden" },
      inviteMessage: { choice: "text", value: "Ask the IT service desk." },
      [SEEDED_ITEMS_KEY]: [
        "supportEmail",
        "chat",
        "requestDemo",
        "inviteMessage",
      ],
    });
  });

  test("read back as the settings every page reads, the record of the seed passed over", () => {
    const read: HelpAndSupportSettings = readHelpAndSupportSettings(
      toSeededHelpAndSupportJSON(SEED),
    );

    expect(read[HelpItem.SupportEmail]).toEqual({
      choice: HelpChoice.Email,
      value: "it-help@acme.example",
    });
    expect(read[HelpItem.RequestDemo]).toEqual({
      choice: HelpChoice.Hidden,
      value: null,
    });
    expect(read[HelpItem.GitHub]).toEqual({
      choice: HelpChoice.Default,
      value: null,
    });
    expect(toHelpAndSupportJSON(read)).not.toHaveProperty(SEEDED_ITEMS_KEY);
  });

  test("a seed of only refused values writes nothing, so a fixed value still seeds", () => {
    expect(
      toSeededHelpAndSupportJSON(
        seedOf({ HELP_AND_SUPPORT_CHAT: "javascript:alert(1)" }),
      ),
    ).toBeNull();
  });
});

describe("what the page says was seeded", () => {
  const seeded: JSONObject = toSeededHelpAndSupportJSON(
    seedOf({
      HELP_AND_SUPPORT_SUPPORT_EMAIL: "it-help@acme.example",
      HELP_AND_SUPPORT_GITHUB: "hidden",
    }),
  )!;

  test("each item seeded and not changed since", () => {
    expect(readSeededItems(seeded)).toEqual([
      HelpItem.SupportEmail,
      HelpItem.GitHub,
    ]);
  });

  test("nothing for settings an admin saved without a seed, or none saved", () => {
    expect(readSeededItems(null)).toEqual([]);
    expect(readSeededItems({ chat: { choice: "hidden" } })).toEqual([]);
    expect(readSeededItems("seeded")).toEqual([]);
    expect(readSeededItems([])).toEqual([]);
  });

  test("never an item that is back on its default, or one that is no setting", () => {
    expect(
      readSeededItems({
        supportEmail: { choice: "email", value: "it-help@acme.example" },
        [SEEDED_ITEMS_KEY]: ["supportEmail", "chat", "notASetting", 3],
      }),
    ).toEqual([HelpItem.SupportEmail]);
  });

  test("never an item whose value would be refused", () => {
    expect(
      readSeededItems({
        chat: { choice: "link", value: "javascript:alert(1)" },
        [SEEDED_ITEMS_KEY]: ["chat"],
      }),
    ).toEqual([]);
  });
});

describe("a change an admin saves", () => {
  const stored: JSONObject = toSeededHelpAndSupportJSON(
    seedOf({
      HELP_AND_SUPPORT_SUPPORT_EMAIL: "it-help@acme.example",
      HELP_AND_SUPPORT_GITHUB: "hidden",
    }),
  )!;

  test("makes that item the admin's own, and keeps the record of the rest", () => {
    const next: HelpAndSupportSettings = {
      ...readHelpAndSupportSettings(stored),
      [HelpItem.SupportEmail]: {
        choice: HelpChoice.Email,
        value: "desk@acme.example",
      },
    };

    const saved: JSONObject = withSeededItemsKept({
      stored: stored,
      next: next,
      changedItem: HelpItem.SupportEmail,
    });

    expect(saved).toEqual({
      supportEmail: { choice: "email", value: "desk@acme.example" },
      gitHub: { choice: "hidden" },
      [SEEDED_ITEMS_KEY]: ["gitHub"],
    });
    expect(readSeededItems(saved)).toEqual([HelpItem.GitHub]);
  });

  test("of the last seeded item leaves no record at all", () => {
    const afterOne: JSONObject = withSeededItemsKept({
      stored: stored,
      next: readHelpAndSupportSettings(stored),
      changedItem: HelpItem.SupportEmail,
    });
    const afterBoth: JSONObject = withSeededItemsKept({
      stored: afterOne,
      next: getDefaultHelpAndSupportSettings(),
      changedItem: HelpItem.GitHub,
    });

    expect(afterBoth).toEqual({});
  });

  test("set back to the very value it was seeded with, is still the admin's own", () => {
    const saved: JSONObject = withSeededItemsKept({
      stored: stored,
      next: readHelpAndSupportSettings(stored),
      changedItem: HelpItem.GitHub,
    });

    expect(readSeededItems(saved)).toEqual([HelpItem.SupportEmail]);
  });

  test("of settings never seeded saves exactly what it always did", () => {
    const next: HelpAndSupportSettings = {
      ...getDefaultHelpAndSupportSettings(),
      [HelpItem.Chat]: { choice: HelpChoice.Hidden, value: null },
    };

    expect(
      withSeededItemsKept({
        stored: null,
        next: next,
        changedItem: HelpItem.Chat,
      }),
    ).toEqual(toHelpAndSupportJSON(next));
  });
});

describe("a configuration that changed after the settings were saved", () => {
  const seed: HelpAndSupportSeed = seedOf({
    HELP_AND_SUPPORT_SUPPORT_EMAIL: "it-help@acme.example",
    HELP_AND_SUPPORT_GITHUB: "hidden",
  });

  test("the values the settings hold are applied already: nothing to say", () => {
    expect(
      getUnappliedSeedItems({
        seed: seed,
        settings: readHelpAndSupportSettings(toSeededHelpAndSupportJSON(seed)),
      }),
    ).toEqual([]);
  });

  test("each value that differs from them is not applied", () => {
    expect(
      getUnappliedSeedItems({
        seed: seed,
        settings: {
          ...getDefaultHelpAndSupportSettings(),
          [HelpItem.SupportEmail]: {
            choice: HelpChoice.Email,
            value: "desk@acme.example",
          },
          [HelpItem.GitHub]: { choice: HelpChoice.Hidden, value: null },
        },
      }),
    ).toEqual([HelpItem.SupportEmail]);
  });
});
