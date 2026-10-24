import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import IncidentFeed from "Common/Models/DatabaseModels/IncidentFeed";
import {
  SUBSCRIBER_NOTIFICATIONS_COLUMN,
  SUBSCRIBER_NOTIFICATIONS_OFF_MESSAGE,
  SUBSCRIBER_NOTIFICATIONS_OFF_TEXT,
} from "Common/Types/StatusPage/SubscriberNotificationsSwitch";
import {
  ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN,
  LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN,
  MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS,
} from "Common/Types/StatusPage/SubscriberRestrictions";
import SubscriberNotificationsCopy, {
  getSubscriberNotificationsDescription,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationsCopy";
import SubscriberRestrictionsCopy, {
  getAllowedEmailDomainsInputProblem,
  getPrivateUsersOnlyDescription,
  isSameAllowedEmailDomains,
  toAllowedEmailDomainsText,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberRestrictionsCopy";
import IncidentStatusPageScopeCopy from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import SubscriberNotificationPreviewCopy from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationPreviewCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The cards Subscriber Settings gained - Notifications (Send Notifications
 * to Subscribers) and Who Can Subscribe (Only Private Users Can Subscribe,
 * Allowed Email Domains) - and the words that say elsewhere what they do:
 * the audience summary, the notification preview and the feed's "API key"
 * author. Their copy, the columns they write, where they live, and that
 * every string they show is translated in all seventeen Dashboard locales.
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

const readLocale: (code: string) => Record<string, unknown> = (
  code: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, unknown>;
};

// Without its comments, collapsed to one line.
function readSource(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

// Strings that read the same in another language, or are shared with another feature.
const SHARED: Record<string, Array<string>> = {
  [SubscriberNotificationsCopy.cardTitle]: ["fr"],
};

// Every English string the new cards and their companions can show.
const SHOWN: Array<string> = [
  SubscriberNotificationsCopy.cardTitle,
  SubscriberNotificationsCopy.cardDescription,
  SubscriberNotificationsCopy.switchTitle,
  SubscriberNotificationsCopy.switchOnDescription,
  SubscriberNotificationsCopy.switchOffDescription,
  SubscriberNotificationsCopy.offWarningTitle,
  SubscriberNotificationsCopy.offWarningDescription,
  SubscriberNotificationsCopy.offWarningLink,
  SubscriberRestrictionsCopy.cardTitle,
  SubscriberRestrictionsCopy.cardDescription,
  SubscriberRestrictionsCopy.privateUsersOnlyTitle,
  SubscriberRestrictionsCopy.privateUsersOnlyOnDescription,
  SubscriberRestrictionsCopy.privateUsersOnlyOffDescription,
  SubscriberRestrictionsCopy.privateUsersOnlyNoSignInNote,
  SubscriberRestrictionsCopy.allowedDomainsLabel,
  SubscriberRestrictionsCopy.allowedDomainsDescription,
  SubscriberRestrictionsCopy.allowedDomainsSave,
  SubscriberRestrictionsCopy.allowedDomainsDiscard,
  SubscriberRestrictionsCopy.invalidDomain,
  SubscriberRestrictionsCopy.tooManyDomains,
  IncidentStatusPageScopeCopy.audienceNotificationsOff,
  IncidentStatusPageScopeCopy.audienceNotificationsOffEverywhere,
  SubscriberNotificationPreviewCopy.notificationsOff,
  "API key",
];

describe("the columns the cards write", () => {
  const page: StatusPage = new StatusPage();

  test("Send Notifications to Subscribers: on by default, on every plan", () => {
    expect(
      page.getTableColumnMetadata(SUBSCRIBER_NOTIFICATIONS_COLUMN).defaultValue,
    ).toBe(true);
    expect(
      page.getColumnBillingAccessControl(SUBSCRIBER_NOTIFICATIONS_COLUMN),
    ).toBeUndefined();
  });

  test("the two restrictions: off and empty by default, set on the Scale plan", () => {
    expect(
      page.getTableColumnMetadata(LIMIT_SUBSCRIBERS_TO_PRIVATE_USERS_COLUMN)
        .defaultValue,
    ).toBe(false);
    expect(
      page.getTableColumnMetadata(ALLOWED_SUBSCRIBER_EMAIL_DOMAINS_COLUMN)
        .defaultValue,
    ).toBeUndefined();
  });

  test("the feed keeps an API key's name", () => {
    expect(new IncidentFeed().getTableColumnMetadata("apiKeyName").title).toBe(
      "API Key Name",
    );
  });
});

describe("the Notifications card's words", () => {
  test("say what each way of the switch means", () => {
    expect(getSubscriberNotificationsDescription(true)).toBe(
      SubscriberNotificationsCopy.switchOnDescription,
    );
    expect(getSubscriberNotificationsDescription(false)).toBe(
      SubscriberNotificationsCopy.switchOffDescription,
    );
    expect(SubscriberNotificationsCopy.switchTitle).toBe(
      "Send Notifications to Subscribers",
    );
  });

  test("off keeps the subscribers and says so", () => {
    expect(SubscriberNotificationsCopy.switchOffDescription).toContain(
      "They are kept",
    );
  });

  test("the server says it in the words the switch is named with", () => {
    expect(SUBSCRIBER_NOTIFICATIONS_OFF_MESSAGE).toContain(
      SubscriberNotificationsCopy.switchTitle,
    );
    expect(SUBSCRIBER_NOTIFICATIONS_OFF_TEXT).toContain(
      "does not send notifications to its subscribers",
    );
    expect(IncidentStatusPageScopeCopy.audienceNotificationsOff).toContain(
      "does not send notifications to its subscribers",
    );
  });
});

describe("the Who Can Subscribe card's words", () => {
  test("say what each way of the switch means", () => {
    expect(getPrivateUsersOnlyDescription(true)).toBe(
      SubscriberRestrictionsCopy.privateUsersOnlyOnDescription,
    );
    expect(getPrivateUsersOnlyDescription(false)).toBe(
      SubscriberRestrictionsCopy.privateUsersOnlyOffDescription,
    );
  });

  test("a list's problems are said with the entry, translated by template", () => {
    expect(
      getAllowedEmailDomainsInputProblem("acme.com\nnot-a-domain"),
    ).toEqual({
      template: SubscriberRestrictionsCopy.invalidDomain,
      values: { domain: "not-a-domain" },
    });
    expect(
      getAllowedEmailDomainsInputProblem(
        Array.from(
          { length: MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS + 1 },
          (_value: unknown, index: number): string => {
            return `d${index}.example.com`;
          },
        ).join("\n"),
      ),
    ).toEqual({
      template: SubscriberRestrictionsCopy.tooManyDomains,
      values: { count: String(MAX_ALLOWED_SUBSCRIBER_EMAIL_DOMAINS) },
    });
    expect(getAllowedEmailDomainsInputProblem("acme.com\nacme.de")).toBeNull();
    expect(getAllowedEmailDomainsInputProblem("")).toBeNull();
  });

  test("the same domains written another way are the same list", () => {
    expect(
      isSameAllowedEmailDomains(" ACME.com,\n@acme.de", "acme.com\nacme.de"),
    ).toBe(true);
    expect(
      isSameAllowedEmailDomains("acme.de\nacme.com", "acme.com\nacme.de"),
    ).toBe(false);
    expect(isSameAllowedEmailDomains("", null)).toBe(true);
    expect(isSameAllowedEmailDomains("acme.com", null)).toBe(false);
  });

  test("the box shows a list one domain a line", () => {
    expect(toAllowedEmailDomainsText(" @ACME.com, acme.de ")).toBe(
      "acme.com\nacme.de",
    );
    expect(toAllowedEmailDomainsText(null)).toBe("");
  });

  test("the plan's name, the domain and the count are the only placeholders", () => {
    expect(SubscriberRestrictionsCopy.invalidDomain).toContain("{{domain}}");
    expect(SubscriberRestrictionsCopy.tooManyDomains).toContain("{{count}}");
  });
});

describe("their strings", () => {
  const en: Record<string, unknown> = readLocale("en");

  test("are each a key of en.json that reads as itself", () => {
    for (const text of SHOWN) {
      expect([text, en[text]]).toEqual([text, text]);
    }
  });

  test.each(OTHER_LOCALES)(
    "are translated in %s, keeping their placeholders",
    (code: string) => {
      const locale: Record<string, unknown> = readLocale(code);

      for (const text of SHOWN) {
        const translated: unknown = locale[text];

        expect([code, text, typeof translated]).toEqual([code, text, "string"]);

        if (!(SHARED[text] || []).includes(code)) {
          expect([code, text, translated === text]).toEqual([
            code,
            text,
            false,
          ]);
        }

        const placeholders: Array<string> = (
          text.match(/\{\{\w+\}\}/g) || []
        ).sort();

        expect([
          code,
          text,
          ((translated as string).match(/\{\{\w+\}\}/g) || []).sort(),
        ]).toEqual([code, text, placeholders]);
      }
    },
  );
});

describe("where they live", () => {
  const settingsPage: string = readSource(
    path.join(
      DASHBOARD_SRC,
      "Pages",
      "StatusPages",
      "View",
      "SubscriberSettings.tsx",
    ),
  );

  test("on Subscriber Settings: what the page sends, then how visitors sign up, then who may", () => {
    const warnings: number = settingsPage.indexOf(
      "<SubscriberNotificationWarnings",
    );
    const notifications: number = settingsPage.indexOf(
      "<SubscriberNotificationsCard",
    );
    const channels: number = settingsPage.indexOf("<SubscriberChannelsCard");
    const restrictions: number = settingsPage.indexOf(
      "<SubscriberRestrictionsSettings",
    );

    expect(warnings).toBeGreaterThan(-1);
    expect(notifications).toBeGreaterThan(warnings);
    expect(channels).toBeGreaterThan(notifications);
    expect(restrictions).toBeGreaterThan(channels);
  });

  test("the warning reads the switch again whenever it is saved", () => {
    expect(settingsPage).toContain(
      "key={`subscriber-notification-warnings-${notificationsRevision}`}",
    );
    expect(settingsPage).toContain("setNotificationsRevision(");
  });

  test.each(["SubscriberNotificationsCard", "SubscriberRestrictionsSettings"])(
    "%s is on that page only",
    (card: string) => {
      const viewDir: string = path.join(DASHBOARD_SRC, "Pages");
      const files: Array<string> = [];

      const walk: (dir: string) => void = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full: string = path.join(dir, entry.name);

          if (entry.isDirectory()) {
            walk(full);
          } else if (
            entry.name.endsWith(".ts") ||
            entry.name.endsWith(".tsx")
          ) {
            files.push(full);
          }
        }
      };

      walk(viewDir);

      expect(
        files
          .filter((file: string): boolean => {
            return readSource(file).includes(`<${card}`);
          })
          .map((file: string): string => {
            return path.basename(file);
          }),
      ).toEqual(["SubscriberSettings.tsx"]);
    },
  );
});
