import TelemetryRetentionConfig from "Common/Types/Telemetry/TelemetryRetentionConfig";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import {
  getPageAnchorNameForTitle,
  isPageAnchorName,
} from "Common/UI/Utils/PageAnchor";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  API_KEY_MORE_SETTINGS_BLOCK_DESCRIPTION,
  API_KEY_MORE_SETTINGS_ROLES_DESCRIPTION,
  API_KEY_PERMISSIONS_EMPTY,
  API_KEY_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES,
  CUSTOM_ROLES_CARD_PLACE,
  CUSTOM_ROLES_CARD_TITLE,
  getApiKeyMoreSettingsDescription,
  getApiKeyPermissionsEmptyMessage,
  getCustomRoleCount,
  getCustomRolesFoldedItem,
  getTeamMoreSettingsDescription,
  getTeamPermissionsEmptyMessage,
  TEAM_MORE_SETTINGS_BLOCK_DESCRIPTION,
  TEAM_MORE_SETTINGS_ROLES_DESCRIPTION,
  TEAM_PERMISSIONS_EMPTY,
  TEAM_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES,
} from "../../FeatureSet/Dashboard/src/Components/CustomRole/CustomRolesFold";
import FormsCopy from "../../FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import {
  CUSTOM_SMTP_CONFIGS_PLACE,
  CUSTOM_SMTP_CONFIGS_TITLE,
  getOwnSendersFoldedItems,
  OWN_SENDERS_MORE_DESCRIPTION,
  TWILIO_CONFIG_PLACE,
  TWILIO_CONFIG_TITLE,
} from "../../FeatureSet/Dashboard/src/Components/NotificationMethods/OwnSendersFold";
import StatusPageAccessCopy from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageAccessCopy";
import StatusPagePoweredByCopy, {
  getPoweredByFoldedItem,
  STATUS_PAGE_POWERED_BY_PLACE,
  STATUS_PAGE_SETTINGS_MORE_DESCRIPTION,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPagePoweredByCopy";
import StatusPageSessionLengthCopy, {
  getSessionLengthFoldedItem,
  STATUS_PAGE_SESSION_LENGTH_PLACE,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSessionLengthCopy";
import SubscriberChoicesCopy, {
  getSubscriberSettingsMoreItems,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChoicesCopy";
import SubscriberRestrictionsCopy, {
  getSubscriberRestrictionsFoldedItem,
  getSubscriberRestrictionsState,
  isSubscriberRestrictionInForce,
  SUBSCRIBER_RESTRICTIONS_PLACE,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberRestrictionsCopy";
import {
  countRetentionTypeOverrides,
  getRetentionFoldedItems,
  PROJECT_RETENTION_MORE_DESCRIPTION,
  readRetentionDays,
  RESOURCE_RETENTION_MORE_DESCRIPTION,
  RETENTION_BY_TELEMETRY_TYPE_PLACE,
  RETENTION_BY_TELEMETRY_TYPE_TITLE,
  RETENTION_OVERRIDES_PLACE,
  RETENTION_OVERRIDES_TITLE,
  RUM_RETENTION_MORE_DESCRIPTION,
  SESSION_REPLAY_RETENTION_TITLE,
  TELEMETRY_DATA_RETENTION_PLACE,
  TELEMETRY_DATA_RETENTION_TITLE,
} from "../../FeatureSet/Dashboard/src/Components/TelemetryResource/TelemetryRetentionFold";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ADVANCED FEATURES OUT OF THE WAY.
 *
 * "Move custom roles to More settings because it is an advanced feature.
 * Please audit the entire project for advanced features just like these and
 * move them to More as well, so it is hidden by default and it doesn't
 * cause frustration and decision paralysis to users." - the maintainer.
 *
 * What moved into a page's More settings, and the React-free rules each
 * folded header follows: it names every card it holds - each with what it
 * is set to while it overrides anything - at the card's own place, so a
 * link lands on it. The pages are rendered for real in Common's suites
 * (MoreSettingsOneCard, MoreSettingsFoldsGuard and each page's own); this
 * holds the words, the places and the wiring the source must keep, and
 * that every new sentence is translated in all seventeen languages.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
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

function readSource(...parts: Array<string>): string {
  return fs.readFileSync(path.join(DASHBOARD_SRC, ...parts), "utf8");
}

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

// Writes counts as the Dashboard's English does: "1 day", "30 days".
const ENGLISH: Pick<Translator, "translatePlural"> = {
  translatePlural: (
    template: { one: string; other: string },
    count: number,
  ): string => {
    return (count === 1 ? template.one : template.other).replace(
      "{{count}}",
      String(count),
    );
  },
};

const formatDays: (days: number) => string = (days: number): string => {
  return ENGLISH.translatePlural(
    { one: "{{count}} day", other: "{{count}} days" },
    days,
  );
};

describe("custom roles, under More settings on a team's and a key's page", () => {
  test("named only while the card is drawn, with how many roles it holds", () => {
    expect(getCustomRolesFoldedItem(null)).toBeNull();
    expect(getCustomRolesFoldedItem({ isShown: false, count: 0 })).toBeNull();
    expect(getCustomRolesFoldedItem({ isShown: true, count: 0 })).toEqual({
      key: CUSTOM_ROLES_CARD_PLACE,
      title: CUSTOM_ROLES_CARD_TITLE,
      isSet: false,
    });
    expect(getCustomRolesFoldedItem({ isShown: true, count: 2 })).toEqual({
      key: CUSTOM_ROLES_CARD_PLACE,
      title: CUSTOM_ROLES_CARD_TITLE,
      isSet: true,
      value: "2",
    });
  });

  test("its place is its title's, which both editions' cards take", () => {
    expect(CUSTOM_ROLES_CARD_PLACE).toBe(
      getPageAnchorNameForTitle(CUSTOM_ROLES_CARD_TITLE),
    );
  });

  test("counts only what a drawn card says", () => {
    expect(getCustomRoleCount(null)).toBe(0);
    expect(getCustomRoleCount({ isShown: false, count: 3 })).toBe(0);
    expect(getCustomRoleCount({ isShown: true, count: 3 })).toBe(3);
  });

  test("the fold says it holds custom roles only while it does", () => {
    expect(getTeamMoreSettingsDescription(null)).toBe(
      TEAM_MORE_SETTINGS_BLOCK_DESCRIPTION,
    );
    expect(getTeamMoreSettingsDescription({ isShown: true, count: 0 })).toBe(
      TEAM_MORE_SETTINGS_ROLES_DESCRIPTION,
    );
    expect(getApiKeyMoreSettingsDescription(null)).toBe(
      API_KEY_MORE_SETTINGS_BLOCK_DESCRIPTION,
    );
    expect(getApiKeyMoreSettingsDescription({ isShown: true, count: 1 })).toBe(
      API_KEY_MORE_SETTINGS_ROLES_DESCRIPTION,
    );
  });

  test("an empty Permissions card says where the access is when a custom role gives it some", () => {
    expect(getTeamPermissionsEmptyMessage(0)).toBe(TEAM_PERMISSIONS_EMPTY);
    expect(getTeamPermissionsEmptyMessage(1)).toBe(
      TEAM_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES,
    );
    expect(getApiKeyPermissionsEmptyMessage(0)).toBe(API_KEY_PERMISSIONS_EMPTY);
    expect(getApiKeyPermissionsEmptyMessage(4)).toBe(
      API_KEY_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES,
    );
    // Both point at the fold by its name.
    expect(TEAM_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES).toContain(
      "under More settings",
    );
    expect(API_KEY_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES).toContain(
      "under More settings",
    );
  });
});

describe("a status page's reader sessions, under More settings on Access", () => {
  test("named at its title's place, with the length while one is set", () => {
    expect(STATUS_PAGE_SESSION_LENGTH_PLACE).toBe("reader-sessions");

    const translator: Translator = {
      translateText: (text: string | undefined): string | undefined => {
        return text;
      },
      translateTemplate: (
        template: string,
        values: Record<string, string>,
      ): string => {
        return template.replace("{{count}}", values["count"] || "");
      },
    } as unknown as Translator;

    expect(getSessionLengthFoldedItem(undefined, translator)).toEqual({
      key: "reader-sessions",
      title: StatusPageSessionLengthCopy.cardTitle,
      isSet: false,
    });
    expect(getSessionLengthFoldedItem(null, translator).isSet).toBe(false);
    expect(getSessionLengthFoldedItem(8, translator)).toEqual({
      key: "reader-sessions",
      title: StatusPageSessionLengthCopy.cardTitle,
      isSet: true,
      value: "8 hours",
    });
    expect(getSessionLengthFoldedItem(24, translator).value).toBe("1 day");
    expect(getSessionLengthFoldedItem(72, translator).value).toBe("3 days");
  });

  test("the fold says what it holds: both access controls", () => {
    expect(StatusPageAccessCopy.advancedDescription).toBe(
      "How long readers stay signed in, and which IP addresses can open this status page.",
    );
  });
});

describe("who can subscribe, under More settings on Subscriber Settings", () => {
  test("in force while either setting turns someone away", () => {
    expect(isSubscriberRestrictionInForce(null)).toBe(false);
    expect(
      isSubscriberRestrictionInForce({
        limitSubscribersToPrivateUsers: false,
        allowedEmailDomainCount: 0,
      }),
    ).toBe(false);
    expect(
      isSubscriberRestrictionInForce({
        limitSubscribersToPrivateUsers: true,
        allowedEmailDomainCount: 0,
      }),
    ).toBe(true);
    expect(
      isSubscriberRestrictionInForce({
        limitSubscribersToPrivateUsers: false,
        allowedEmailDomainCount: 1,
      }),
    ).toBe(true);
  });

  test("reads what a status page holds as the card does: domains one a line, blanks left out", () => {
    expect(
      getSubscriberRestrictionsState({
        limitSubscribersToPrivateUsers: null,
        allowedSubscriberEmailDomains: null,
      }),
    ).toEqual({
      limitSubscribersToPrivateUsers: false,
      allowedEmailDomainCount: 0,
    });
    expect(
      getSubscriberRestrictionsState({
        limitSubscribersToPrivateUsers: true,
        allowedSubscriberEmailDomains: "acme.com\n\n  acme.de  \n",
      }),
    ).toEqual({
      limitSubscribersToPrivateUsers: true,
      allowedEmailDomainCount: 2,
    });
  });

  test("named first in the fold, at its title's place, marked while in force", () => {
    expect(SUBSCRIBER_RESTRICTIONS_PLACE).toBe("who-can-subscribe");
    expect(getSubscriberRestrictionsFoldedItem(undefined)).toEqual({
      key: "who-can-subscribe",
      title: SubscriberRestrictionsCopy.cardTitle,
      isSet: false,
    });
    expect(
      getSubscriberRestrictionsFoldedItem({
        limitSubscribersToPrivateUsers: true,
        allowedEmailDomainCount: 0,
      }).isSet,
    ).toBe(true);

    const items: Array<FoldedSectionItem> = getSubscriberSettingsMoreItems({});

    expect(
      items.map((item: FoldedSectionItem): string => {
        return item.title;
      }),
    ).toEqual([
      SubscriberRestrictionsCopy.cardTitle,
      SubscriberChoicesCopy.timezonesTitle,
      "Email Footer",
      SubscriberChoicesCopy.smtpTitle,
      SubscriberChoicesCopy.twilioTitle,
    ]);
    expect(
      SubscriberChoicesCopy.moreDescription.startsWith("Who can subscribe"),
    ).toBe(true);
  });
});

describe("retention overrides, under More settings", () => {
  test("a type override counts each field that holds days", () => {
    expect(countRetentionTypeOverrides(undefined)).toBe(0);
    expect(countRetentionTypeOverrides(null)).toBe(0);
    expect(countRetentionTypeOverrides({})).toBe(0);

    const config: TelemetryRetentionConfig = {
      logs: {
        default: 30,
        bySeverity: { Error: 90, Debug: null } as unknown as Record<
          string,
          number | null
        >,
      },
      traces: { default: 0, byStatus: { Error: 60 } as never },
      metrics: { default: 14 },
      profiles: { default: null },
      // Kept by the replay policy and security events: not this card's.
      sessionReplay: { default: 30 },
      securityEvents: { default: 365 },
    } as TelemetryRetentionConfig;

    // logs default, logs Error, traces Error, metrics: four.
    expect(countRetentionTypeOverrides(config)).toBe(4);
  });

  test("a resource's own retention is days, or none", () => {
    expect(readRetentionDays(undefined)).toBeNull();
    expect(readRetentionDays(null)).toBeNull();
    expect(readRetentionDays(0)).toBeNull();
    expect(readRetentionDays(-1)).toBeNull();
    expect(readRetentionDays(30)).toBe(30);
  });

  test("each card at its title's place", () => {
    for (const [place, title] of [
      [TELEMETRY_DATA_RETENTION_PLACE, TELEMETRY_DATA_RETENTION_TITLE],
      [RETENTION_BY_TELEMETRY_TYPE_PLACE, RETENTION_BY_TELEMETRY_TYPE_TITLE],
      [RETENTION_OVERRIDES_PLACE, RETENTION_OVERRIDES_TITLE],
    ] as Array<[string, string]>) {
      expect(isPageAnchorName(place)).toBe(true);
      expect(place).toBe(getPageAnchorNameForTitle(title));
    }
  });

  test("where overrides cannot be set: the card that sells them, marked while a trial's override applies", () => {
    for (const hasOwnRetention of [true, false]) {
      expect(
        getRetentionFoldedItems({
          state: {},
          isEnterpriseCardDrawn: false,
          hasOwnRetention: hasOwnRetention,
          formatDays: formatDays,
        }),
      ).toEqual([
        {
          key: RETENTION_OVERRIDES_PLACE,
          title: RETENTION_OVERRIDES_TITLE,
          isSet: false,
        },
      ]);
    }

    expect(
      getRetentionFoldedItems({
        state: { isLeftoverOverrideSet: true },
        isEnterpriseCardDrawn: false,
        hasOwnRetention: true,
        formatDays: formatDays,
      })[0]!.isSet,
    ).toBe(true);
  });

  test("a resource's Enterprise cards: its own retention, then by type, each with what it overrides", () => {
    expect(
      getRetentionFoldedItems({
        state: {},
        isEnterpriseCardDrawn: true,
        hasOwnRetention: true,
        formatDays: formatDays,
      }),
    ).toEqual([
      {
        key: TELEMETRY_DATA_RETENTION_PLACE,
        title: TELEMETRY_DATA_RETENTION_TITLE,
        isSet: false,
      },
      {
        key: RETENTION_BY_TELEMETRY_TYPE_PLACE,
        title: RETENTION_BY_TELEMETRY_TYPE_TITLE,
        isSet: false,
      },
    ]);

    expect(
      getRetentionFoldedItems({
        state: { retainTelemetryDataForDays: 1, typeOverrideCount: 5 },
        isEnterpriseCardDrawn: true,
        hasOwnRetention: true,
        formatDays: formatDays,
      }),
    ).toEqual([
      {
        key: TELEMETRY_DATA_RETENTION_PLACE,
        title: TELEMETRY_DATA_RETENTION_TITLE,
        isSet: true,
        value: "1 day",
      },
      {
        key: RETENTION_BY_TELEMETRY_TYPE_PLACE,
        title: RETENTION_BY_TELEMETRY_TYPE_TITLE,
        isSet: true,
        value: "5",
      },
    ]);
  });

  test("the project's Enterprise card: by type alone - its default is above the fold", () => {
    expect(
      getRetentionFoldedItems({
        state: { typeOverrideCount: 2, retainTelemetryDataForDays: 30 },
        isEnterpriseCardDrawn: true,
        hasOwnRetention: false,
        formatDays: formatDays,
      }),
    ).toEqual([
      {
        key: RETENTION_BY_TELEMETRY_TYPE_PLACE,
        title: RETENTION_BY_TELEMETRY_TYPE_TITLE,
        isSet: true,
        value: "2",
      },
    ]);
  });

  /*
   * Every service and telemetry resource Settings page folds its retention:
   * through TelemetryResourceMoreSettings, or - a RUM application, which
   * folds its replay retention beside it - an AdvancedPageSection of its
   * own around the same shell. None draws the shell outside a fold.
   */
  test("every Settings page with retention folds it", () => {
    const pagesDir: string = path.join(DASHBOARD_SRC, "Pages");
    const pages: Array<string> = fs
      .readdirSync(pagesDir)
      .map((product: string): string => {
        return path.join(pagesDir, product, "View", "Settings.tsx");
      })
      .filter((file: string): boolean => {
        return fs.existsSync(file);
      })
      .filter((file: string): boolean => {
        return fs
          .readFileSync(file, "utf8")
          .includes("TelemetryResource/TelemetryResource");
      });

    expect(pages.length).toBeGreaterThanOrEqual(15);

    for (const file of pages) {
      const source: string = fs.readFileSync(file, "utf8");
      const name: string = path.relative(pagesDir, file);

      if (source.includes("<TelemetryResourceRetentionSettings")) {
        const fold: number = source.indexOf("<AdvancedPageSection");
        const shell: number = source.indexOf(
          "<TelemetryResourceRetentionSettings",
        );
        const foldEnd: number = source.indexOf("</AdvancedPageSection>");

        expect({
          name,
          isInFold: fold >= 0 && fold < shell && shell < foldEnd,
        }).toEqual({
          name,
          isInFold: true,
        });
      } else {
        expect({
          name,
          isFolded: source.includes("<TelemetryResourceMoreSettings"),
        }).toEqual({ name, isFolded: true });
      }
    }
  });

  test("a RUM application folds its replay retention beside them, named", () => {
    const rum: string = readSource("Pages", "Rum", "View", "Settings.tsx");

    expect(rum).toContain("foldedSectionItem(SESSION_REPLAY_RETENTION_TITLE)");
    expect(rum.indexOf("<SessionReplayRetentionSettingsCard")).toBeLessThan(
      rum.indexOf("</AdvancedPageSection>"),
    );
    expect(SESSION_REPLAY_RETENTION_TITLE).toBe("Session Replay Retention");
  });

  test("Settings > Telemetry folds its retention by type under the default", () => {
    const page: string = readSource(
      "Pages",
      "Settings",
      "TelemetrySettings.tsx",
    );

    expect(page.indexOf('name="Telemetry Data Retention"')).toBeLessThan(
      page.indexOf("<AdvancedPageSection"),
    );
    expect(page.indexOf("<AdvancedPageSection")).toBeLessThan(
      page.indexOf("<EnterprisePluginPage"),
    );
  });
});

describe("Powered by OneUptime, under More settings on a status page's Advanced Settings", () => {
  test("named at its title's place; Off while the line is hidden", () => {
    expect(STATUS_PAGE_POWERED_BY_PLACE).toBe("powered-by-oneuptime");
    expect(getPoweredByFoldedItem(null)).toEqual({
      key: "powered-by-oneuptime",
      title: StatusPagePoweredByCopy.cardTitle,
      isSet: false,
    });
    expect(getPoweredByFoldedItem(true).isSet).toBe(false);
    expect(getPoweredByFoldedItem(false)).toEqual({
      key: "powered-by-oneuptime",
      title: StatusPagePoweredByCopy.cardTitle,
      isSet: true,
      value: "Off",
      translateValue: true,
    });
  });
});

describe("your own mail servers and Twilio accounts, under More settings on Notification Settings", () => {
  test("each table named at its title's place, with how many configs it lists", () => {
    expect([CUSTOM_SMTP_CONFIGS_PLACE, TWILIO_CONFIG_PLACE]).toEqual([
      "custom-smtp-configs",
      "twilio-config",
    ]);
    expect(
      getOwnSendersFoldedItems({ smtpConfigCount: 0, twilioConfigCount: 2 }),
    ).toEqual([
      {
        key: "custom-smtp-configs",
        title: CUSTOM_SMTP_CONFIGS_TITLE,
        isSet: false,
      },
      {
        key: "twilio-config",
        title: TWILIO_CONFIG_TITLE,
        isSet: true,
        value: "2",
      },
    ]);
  });

  test("a link to a config's table lands on it, folded or not", () => {
    const policy: string = readSource(
      "Pages",
      "OnCallDuty",
      "IncomingCallPolicy",
      "Index.tsx",
    );

    /*
     * "create one in Project Settings" and "Go to Settings" both - the
     * import makes the third mention - each built at the table's place.
     */
    expect(policy.split("TWILIO_CONFIG_PLACE").length - 1).toBe(3);
    expect(policy.split("getRouteToPageAnchor(").length - 1).toBe(2);

    const smtpView: string = readSource(
      "Components",
      "CustomSMTP",
      "CustomSMTPView.tsx",
    );

    expect(smtpView).toContain("CUSTOM_SMTP_CONFIGS_PLACE");
    expect(smtpView).toContain("getRouteToPageAnchor(");
  });

  test("each table tells the page how many configs it lists", () => {
    for (const parts of [
      ["Components", "CustomSMTP", "CustomSMTPTable.tsx"],
      ["Components", "CallSMS", "CallSMSConfigTable.tsx"],
    ]) {
      expect(readSource(...parts)).toContain(
        "props.onCountChange?.(totalCount);",
      );
    }
  });
});

describe("a form's IP allowlist, under More settings on its Share page", () => {
  test("says, folded, whether every address can open the form", () => {
    expect(FormsCopy.moreSettingsDescription).toBe(
      "Limit which IP addresses can open and submit this form.",
    );
    expect(FormsCopy.moreSettingsSummaryOpen).toBe(
      "Every IP address can open this form.",
    );
    expect(FormsCopy.moreSettingsSummaryConfigured).toBe(
      "Only the IP addresses on the allowlist can open this form.",
    );
  });
});

/*
 * Every sentence this move added is in all seventeen Dashboard locales, and
 * translated in each of the sixteen other languages.
 */
describe("translations", () => {
  const NEW_SENTENCES: Array<string> = [
    TEAM_MORE_SETTINGS_ROLES_DESCRIPTION,
    API_KEY_MORE_SETTINGS_ROLES_DESCRIPTION,
    TEAM_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES,
    API_KEY_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES,
    StatusPageAccessCopy.advancedDescription,
    SubscriberChoicesCopy.moreDescription,
    PROJECT_RETENTION_MORE_DESCRIPTION,
    RUM_RETENTION_MORE_DESCRIPTION,
    RESOURCE_RETENTION_MORE_DESCRIPTION,
    STATUS_PAGE_SETTINGS_MORE_DESCRIPTION,
    OWN_SENDERS_MORE_DESCRIPTION,
    FormsCopy.moreSettingsDescription,
    FormsCopy.moreSettingsSummaryOpen,
    FormsCopy.moreSettingsSummaryConfigured,
  ];

  test("en.json has every one, as itself", () => {
    const english: Record<string, string> = readLocale("en");

    for (const sentence of NEW_SENTENCES) {
      expect([sentence, english[sentence]]).toEqual([sentence, sentence]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s words every one in its own language",
    (locale: string) => {
      const words: Record<string, string> = readLocale(locale);

      for (const sentence of NEW_SENTENCES) {
        const translation: string | undefined = words[sentence];

        expect([sentence, typeof translation]).toEqual([sentence, "string"]);
        expect([sentence, translation === sentence]).toEqual([sentence, false]);
        // The product's name stays as it is written.
        if (sentence.includes("OneUptime")) {
          expect([sentence, translation!.includes("OneUptime")]).toEqual([
            sentence,
            true,
          ]);
        }
      }
    },
  );

  test.each(OTHER_LOCALES)(
    "%s names the fold as its Dashboard draws it, where a sentence names it",
    (locale: string) => {
      const words: Record<string, string> = readLocale(locale);
      const moreSettings: string = words["More settings"] as string;

      for (const sentence of [
        TEAM_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES,
        API_KEY_PERMISSIONS_EMPTY_WITH_CUSTOM_ROLES,
      ]) {
        expect([
          locale,
          (words[sentence] || "").includes(moreSettings),
        ]).toEqual([locale, true]);
      }
    },
  );
});
