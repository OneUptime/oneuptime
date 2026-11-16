import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberChannel, {
  STATUS_PAGE_SUBSCRIBER_CHANNELS,
} from "Common/Types/StatusPage/StatusPageSubscriberChannel";
import SubscriberChannelsCopy, {
  getSubscriberChannel,
  SUBSCRIBER_CHANNELS,
  SubscriberChannelDefinition,
  SUBSCRIPTION_SWITCH_COLUMNS,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChannelsCopy";
import {
  getTemplateConfigurationWarning,
  TemplateConfigurationWarning,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberTemplateConfiguration";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";

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

const OTHER_LOCALES: Array<string> = [...DASHBOARD_LANGUAGES];

/*
 * The five subscriber lists are one component since #9125
 * (StatusPageSubscriberList), a tab each on the Subscribers page, configured
 * per channel (SubscriberListChannels): which channel each tab is, and so
 * which switch it reads.
 */
const CHANNEL_KEYS: Array<{
  key: string;
  method: StatusPageSubscriberNotificationMethod;
}> = [
  { key: "Email", method: StatusPageSubscriberNotificationMethod.Email },
  { key: "SMS", method: StatusPageSubscriberNotificationMethod.SMS },
  { key: "Slack", method: StatusPageSubscriberNotificationMethod.Slack },
  {
    key: "MicrosoftTeams",
    method: StatusPageSubscriberNotificationMethod.MicrosoftTeams,
  },
  { key: "Webhook", method: StatusPageSubscriberNotificationMethod.Webhook },
];

const LIST_FILE: string = "Components/StatusPage/StatusPageSubscriberList.tsx";
const LIST_CHANNELS_FILE: string =
  "Components/StatusPage/SubscriberListChannels.ts";

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

function readDashboard(file: string): string {
  return readSource(path.join(DASHBOARD_SRC, ...file.split("/")));
}

// One channel's entry in SubscriberListChannels.
function channelDefinition(key: string): string {
  const source: string = readDashboard(LIST_CHANNELS_FILE);
  const start: number = source.indexOf(
    `[StatusPageSubscriberChannel.${key}]: {`,
  );

  expect(start).toBeGreaterThan(-1);

  return source.slice(start, source.indexOf("writeBulkEntry", start));
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

  test("come in the Subscribers page's tab order, after Show Subscriber Page", () => {
    // The tabs, in Common's order, which the list's channels follow.
    expect([...STATUS_PAGE_SUBSCRIBER_CHANNELS]).toEqual([
      StatusPageSubscriberChannel.Email,
      StatusPageSubscriberChannel.SMS,
      StatusPageSubscriberChannel.Slack,
      StatusPageSubscriberChannel.MicrosoftTeams,
      StatusPageSubscriberChannel.Webhook,
    ]);
    expect(readDashboard(LIST_CHANNELS_FILE)).toContain(
      "STATUS_PAGE_SUBSCRIBER_CHANNELS.map(",
    );

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

    // Each channel's list reads its own switch, named once per channel.
    allowed[LIST_CHANNELS_FILE] = CHANNEL_KEYS.map(
      (entry: { method: StatusPageSubscriberNotificationMethod }): string => {
        return getSubscriberChannel(entry.method).column;
      },
    );

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

    /*
     * The cards that stay: what visitors can pick, then the rest folded
     * under More settings - the timezones, the email footer, your own mail
     * server and Twilio account.
     */
    expect(source).toContain(
      "<SubscriberChoicesCard statusPageId={modelId} />",
    );
    expect(source).toContain("<AdvancedPageSection");
    for (const title of [
      "SubscriberChoicesCopy.timezonesTitle",
      "SubscriberChoicesCopy.smtpTitle",
      "SubscriberChoicesCopy.twilioTitle",
    ]) {
      expect(source).toContain(`title: ${title},`);
    }
    expect(source).toContain("<SubscriberEmailFooterCard");
    expect(source).not.toContain('title: "Advanced Subscriber Settings"');
    expect(source).not.toContain('title: "Email Footer Settings"');
  });
});

describe("every channel's list", () => {
  const source: string = readDashboard(LIST_FILE);

  test("draws its channel's switch panel, with whether the channel is on", () => {
    expect(source).toContain(
      "<SubscriberChannelOffPanel statusPageId={modelId} method={channel.method} isEnabled={isChannelEnabled} />",
    );
    expect(source).toContain("[channel.enabledColumn]: true,");
    expect(source).toContain(
      "setIsChannelEnabled(Boolean(statusPage?.[channel.enabledColumn]));",
    );
  });

  test.each(CHANNEL_KEYS)(
    "$key reads its own channel's switch",
    (entry: {
      key: string;
      method: StatusPageSubscriberNotificationMethod;
    }) => {
      const definition: string = channelDefinition(entry.key);
      const methodKey: string = Object.entries(
        StatusPageSubscriberNotificationMethod,
      ).find(([, value]: [string, string]) => {
        return value === entry.method;
      })![0];

      expect(definition).toContain(
        `method: StatusPageSubscriberNotificationMethod.${methodKey},`,
      );
      expect(definition).toContain(
        `enabledColumn: "${getSubscriberChannel(entry.method).column}",`,
      );
    },
  );

  test("has no red 'not enabled' banner, and no Alert at all", () => {
    for (const file of [LIST_FILE, LIST_CHANNELS_FILE]) {
      const code: string = readDashboard(file);

      expect(code).not.toContain("not enabled for this status page");
      expect(code).not.toContain("Please enable it in Subscriber Settings");
      expect(code).not.toContain("AlertType.DANGER");
      expect(code).not.toContain("<Alert");
    }
  });

  test("is loading from its first render, so the panel never draws a channel that is on as off", () => {
    expect(source).toContain(
      "const [isLoading, setIsLoading] = useState<boolean>(true);",
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
