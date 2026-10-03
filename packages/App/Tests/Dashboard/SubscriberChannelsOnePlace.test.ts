import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import TableColumnType from "Common/Types/Database/TableColumnType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import SubscriberChannelsCopy, {
  getSubscriberChannel,
  getSubscriberChannelNote,
  SUBSCRIBER_CHANNELS,
  SubscriberChannelDefinition,
  SUBSCRIPTION_SWITCH_COLUMNS,
  SubscriptionSwitchColumn,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelsCopy";
import {
  getTemplateConfigurationWarning,
  TemplateConfigurationWarning,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberTemplateConfiguration";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A status page's subscription switches - Show Subscriber Page and the five
 * channels (email, SMS, Slack, Microsoft Teams, webhook) - live in one place
 * in the dashboard: the Channels card on Subscribers -> Subscriber Settings.
 *
 * They used to be five one-switch cards there and all six again in a
 * three-step card on Advanced Settings, and each channel's subscriber list
 * opened with a red "not enabled" banner while its channel was off, which
 * four of the five are on a new status page. A list now carries its own
 * channel's switch in a quiet panel instead.
 *
 * This reads the sources so a second home for a switch, or the banner, does
 * not come back unnoticed, checks the channel list against the model, and
 * checks every new string is translated in all seventeen Dashboard locales.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const VIEW_DIR: string = path.join(
  DASHBOARD_SRC,
  "Pages",
  "StatusPages",
  "View",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

interface ChannelPage {
  file: string;
  method: StatusPageSubscriberNotificationMethod;
  stateVariable: string;
}

const CHANNEL_PAGES: Array<ChannelPage> = [
  {
    file: "EmailSubscribers.tsx",
    method: StatusPageSubscriberNotificationMethod.Email,
    stateVariable: "isEmailSubscribersEnabled",
  },
  {
    file: "SMSSubscribers.tsx",
    method: StatusPageSubscriberNotificationMethod.SMS,
    stateVariable: "isSMSSubscribersEnabled",
  },
  {
    file: "SlackSubscribers.tsx",
    method: StatusPageSubscriberNotificationMethod.Slack,
    stateVariable: "isSlackSubscribersEnabled",
  },
  {
    file: "MicrosoftTeamsSubscribers.tsx",
    method: StatusPageSubscriberNotificationMethod.MicrosoftTeams,
    stateVariable: "isMicrosoftTeamsSubscribersEnabled",
  },
  {
    file: "WebhookSubscribers.tsx",
    method: StatusPageSubscriberNotificationMethod.Webhook,
    stateVariable: "isWebhookSubscribersEnabled",
  },
];

// Without its comments, collapsed to one line.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

function readView(file: string): string {
  return readSource(path.join(VIEW_DIR, file));
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "Locales") {
        continue;
      }

      found.push(...listSources(full));
      continue;
    }

    if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

const COLUMN_PATTERN: RegExp =
  /\b(showSubscriberPageOnStatusPage|enable(?:Email|Sms|Slack|MicrosoftTeams|Webhook)Subscribers)\b/g;

describe("the channels", () => {
  test("are the five ways a status page sends to subscribers, each once", () => {
    expect(
      SUBSCRIBER_CHANNELS.map((channel: SubscriberChannelDefinition) => {
        return channel.method;
      }).sort(),
    ).toEqual(Object.values(StatusPageSubscriberNotificationMethod).sort());
  });

  test("come in the side menu's order, after Show Subscriber Page", () => {
    const menu: string = readView("SideMenu.tsx");
    const positions: Array<number> = [
      "Email Subscribers",
      "SMS Subscribers",
      "Slack Subscribers",
      "MS Teams Subscribers",
      "Webhook Subscribers",
    ].map((title: string): number => {
      return menu.indexOf(`title: "${title}"`);
    });

    expect(
      positions.every((position: number) => {
        return position > -1;
      }),
    ).toBe(true);
    expect(
      [...positions].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(positions);

    expect(
      SUBSCRIBER_CHANNELS.map((channel: SubscriberChannelDefinition) => {
        return channel.method;
      }),
    ).toEqual([
      StatusPageSubscriberNotificationMethod.Email,
      StatusPageSubscriberNotificationMethod.SMS,
      StatusPageSubscriberNotificationMethod.Slack,
      StatusPageSubscriberNotificationMethod.MicrosoftTeams,
      StatusPageSubscriberNotificationMethod.Webhook,
    ]);

    expect(SUBSCRIPTION_SWITCH_COLUMNS[0]).toBe(
      "showSubscriberPageOnStatusPage",
    );
  });

  test("each switches a boolean column of the status page, with the default the docs give it", () => {
    const statusPage: StatusPage = new StatusPage();

    const defaults: Record<SubscriptionSwitchColumn, boolean> = {
      showSubscriberPageOnStatusPage: true,
      enableEmailSubscribers: true,
      enableSmsSubscribers: false,
      enableSlackSubscribers: false,
      enableMicrosoftTeamsSubscribers: false,
      enableWebhookSubscribers: false,
    };

    expect([...SUBSCRIPTION_SWITCH_COLUMNS].sort()).toEqual(
      Object.keys(defaults).sort(),
    );

    for (const column of SUBSCRIPTION_SWITCH_COLUMNS) {
      const metadata: ReturnType<StatusPage["getTableColumnMetadata"]> =
        statusPage.getTableColumnMetadata(column);

      expect([column, metadata?.type]).toEqual([
        column,
        TableColumnType.Boolean,
      ]);
      expect([column, metadata?.defaultValue]).toEqual([
        column,
        defaults[column],
      ]);
    }
  });

  test("are looked up by method", () => {
    for (const channel of SUBSCRIBER_CHANNELS) {
      expect(getSubscriberChannel(channel.method)).toBe(channel);
    }

    expect(() => {
      return getSubscriberChannel(
        "Carrier Pigeon" as StatusPageSubscriberNotificationMethod,
      );
    }).toThrow();
  });

  test("only SMS, and only where OneUptime bills for texts, says what it costs", () => {
    for (const channel of SUBSCRIBER_CHANNELS) {
      expect(
        getSubscriberChannelNote(channel.method, { isBillingEnabled: false }),
      ).toBeUndefined();

      expect(
        getSubscriberChannelNote(channel.method, { isBillingEnabled: true }),
      ).toBe(
        channel.method === StatusPageSubscriberNotificationMethod.SMS
          ? SubscriberChannelsCopy.smsBalanceSentence
          : undefined,
      );
    }

    expect(SubscriberChannelsCopy.smsBalanceSentence).toContain(
      "SMS and call balance",
    );
    expect(SubscriberChannelsCopy.smsBalanceSentence).toContain(
      "Twilio Config",
    );
  });

  test("say what off means on a channel's own list: no sign-ups that way, and the team's subscribers still get updates", () => {
    for (const channel of SUBSCRIBER_CHANNELS) {
      expect(channel.listSwitchOffDescription).toMatch(
        /^Off for this status page: visitors can't subscribe /,
      );
      expect(channel.listSwitchOffDescription).toContain(
        "Subscribers your team adds here still get updates.",
      );
      expect(channel.listSwitchOnDescription).toMatch(
        /^On: visitors can subscribe .+ on the status page\.$/,
      );
    }
  });
});

describe("one place for each switch", () => {
  test("no Dashboard file names a subscription column except the Channels card, its copy, and each list reading its own channel", () => {
    const allowed: Record<string, Array<string>> = {
      "Components/StatusPage/SubscriberChannelsCopy.ts": [
        ...SUBSCRIPTION_SWITCH_COLUMNS,
      ],
      // The card selects the six columns it shows.
      "Components/StatusPage/SubscriberChannelsCard.tsx": [
        "showSubscriberPageOnStatusPage",
      ],
    };

    for (const page of CHANNEL_PAGES) {
      allowed[`Pages/StatusPages/View/${page.file}`] = [
        getSubscriberChannel(page.method).column,
      ];
    }

    const found: Record<string, Array<string>> = {};

    for (const file of listSources(DASHBOARD_SRC)) {
      const columns: Array<string> = Array.from(
        new Set(
          Array.from(readSource(file).matchAll(COLUMN_PATTERN)).map(
            (match: RegExpMatchArray): string => {
              return match[1]!;
            },
          ),
        ),
      ).sort();

      if (columns.length > 0) {
        found[relative(file)] = columns;
      }
    }

    const expected: Record<string, Array<string>> = {};

    for (const [file, columns] of Object.entries(allowed)) {
      expected[file] = [...columns].sort();
    }

    expect(found).toEqual(expected);
  });

  test("Advanced Settings has no Subscriber Settings card", () => {
    const source: string = readView("StatusPageSettings.tsx");

    expect(source).not.toContain('title: "Subscriber Settings"');
    expect(source).not.toMatch(COLUMN_PATTERN);
  });

  test("Subscriber Settings draws the Channels card, for this page, instead of a card per channel", () => {
    const source: string = readView("SubscriberSettings.tsx");

    expect(source).toContain(
      "<SubscriberChannelsCard statusPageId={modelId} />",
    );
    expect(source).not.toMatch(COLUMN_PATTERN);

    for (const name of [
      "Status Page > Branding > Subscriber > Email",
      "Status Page > Branding > Subscriber > SMS",
      "Status Page > Branding > Subscriber > Slack",
      "Status Page > Branding > Subscriber > Microsoft Teams",
      "Status Page > Branding > Subscriber > Webhook",
    ]) {
      expect(source).not.toContain(`name="${name}"`);
    }

    // The cards that stay.
    for (const title of [
      "Advanced Subscriber Settings",
      "Email Footer Settings",
      "Custom SMTP",
      "Twilio Config",
    ]) {
      expect(source).toContain(`title: "${title}"`);
    }
  });
});

describe.each(CHANNEL_PAGES)("$file", (page: ChannelPage) => {
  const source: string = readView(page.file);

  test("draws its channel's switch panel, with whether the channel is on", () => {
    expect(source).toContain(
      `<SubscriberChannelOffPanel statusPageId={modelId} method={StatusPageSubscriberNotificationMethod.${
        Object.entries(StatusPageSubscriberNotificationMethod).find(
          ([, value]: [string, string]) => {
            return value === page.method;
          },
        )![0]
      }} isEnabled={${page.stateVariable}} />`,
    );
  });

  test("has no red 'not enabled' banner, and no Alert at all", () => {
    expect(source).not.toContain("not enabled for this status page");
    expect(source).not.toContain("Please enable it in Subscriber Settings");
    expect(source).not.toContain("AlertType.DANGER");
    expect(source).not.toContain("<Alert");
  });

  test("is loading from its first render, so the panel never draws a channel that is on as off", () => {
    expect(source).toContain(
      "const [isLoading, setIsLoading] = React.useState<boolean>(true);",
    );
  });
});

describe("the Notification Templates warning", () => {
  const { Email, SMS, Slack, MicrosoftTeams, Webhook } =
    StatusPageSubscriberNotificationMethod;

  test.each([
    // Nothing linked: nothing to warn about, whatever is configured.
    [[], false, false, null],
    [[], true, true, null],
    // Chat and webhook templates need nothing more.
    [[Slack, MicrosoftTeams, Webhook], false, false, null],
    // Email templates need a Custom SMTP.
    [[Email], false, false, TemplateConfigurationWarning.Smtp],
    [[Email], false, true, TemplateConfigurationWarning.Smtp],
    [[Email], true, false, null],
    // SMS templates need a Twilio Config.
    [[SMS], false, false, TemplateConfigurationWarning.Twilio],
    [[SMS], true, false, TemplateConfigurationWarning.Twilio],
    [[SMS], false, true, null],
    // Both.
    [[Email, SMS], false, false, TemplateConfigurationWarning.SmtpAndTwilio],
    [[Email, SMS], true, false, TemplateConfigurationWarning.Twilio],
    [[Email, SMS], false, true, TemplateConfigurationWarning.Smtp],
    [[Email, SMS], true, true, null],
    [[Slack, Email, Email], false, false, TemplateConfigurationWarning.Smtp],
    // A link whose template could not be read counts for nothing.
    [[undefined], false, false, null],
  ] as Array<
    [
      Array<StatusPageSubscriberNotificationMethod | undefined>,
      boolean,
      boolean,
      TemplateConfigurationWarning | null,
    ]
  >)(
    "linked %j, Custom SMTP %s, Twilio Config %s: %s",
    (
      linkedMethods: Array<StatusPageSubscriberNotificationMethod | undefined>,
      hasCustomSmtp: boolean,
      hasCustomTwilio: boolean,
      expected: TemplateConfigurationWarning | null,
    ) => {
      expect(
        getTemplateConfigurationWarning({
          linkedMethods,
          hasCustomSmtp,
          hasCustomTwilio,
        }),
      ).toBe(expected);
    },
  );

  test("Subscriber Settings warns from the linked templates, read again whenever the table loads", () => {
    const source: string = readView("SubscriberSettings.tsx");

    expect(source).toContain("getTemplateConfigurationWarning({");
    expect(source).toContain(
      "onFetchSuccess={() => { void fetchLinkedMethods(); }}",
    );
    // The title the docs quote is unchanged.
    expect(source).toContain(
      'strongTitle="Custom Templates Require Configuration"',
    );
    // And no longer shown merely for a page without SMTP or Twilio.
    expect(source).not.toContain("hasNoCustomSMTP || hasNoCustomTwilio");
  });
});

describe("translations", () => {
  /*
   * Brand and channel names may read the same in a language; the sentences
   * may not.
   */
  const names: Array<string> = [
    SubscriberChannelsCopy.cardTitle,
    SubscriberChannelsCopy.subscribePageTitle,
    ...SUBSCRIBER_CHANNELS.map((channel: SubscriberChannelDefinition) => {
      return channel.title;
    }),
  ];

  const sentences: Array<string> = [
    SubscriberChannelsCopy.cardDescription,
    SubscriberChannelsCopy.subscribePageDescription,
    SubscriberChannelsCopy.smsBalanceSentence,
    ...SUBSCRIBER_CHANNELS.flatMap((channel: SubscriberChannelDefinition) => {
      return [
        channel.description,
        channel.listSwitchTitle,
        channel.listSwitchOffDescription,
        channel.listSwitchOnDescription,
      ];
    }),
    "Status page not found.",
  ];

  test("en.json maps every string to itself", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const text of [...names, ...sentences]) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s has every name, and its own words for every sentence",
    (locale: string) => {
      const translations: Record<string, unknown> = readLocale(locale);

      for (const text of names) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
      }

      for (const text of sentences) {
        expect([text, typeof translations[text]]).toEqual([text, "string"]);
        expect([text, translations[text]]).not.toEqual([text, text]);
      }

      // The card's title, a plain word every language has its own for.
      expect(translations[SubscriberChannelsCopy.cardTitle]).not.toBe(
        SubscriberChannelsCopy.cardTitle,
      );
    },
  );
});
