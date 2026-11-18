import { readPage, TRANSLATED_LANGUAGES } from "./DocsContentSupport";
import { escapeRegExp } from "./DocsTranslationChecks";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import {
  ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES,
  canAcknowledgeOnCallTestPageBy,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import { OnCallPageChannel } from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import { CustomDomainReadinessWords } from "Common/Types/CustomDomain/CustomDomainServerReadiness";
import { formatProjectBalanceAmount } from "Common/Utils/Project/ProjectBalance";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { withPlainSpaces } from "Common/Types/NoBreakSpaces";

/*
 * What the guides (#6821) say about the product, held to the product.
 *
 * A guide walks a guided setup screen by screen, with its defaults, limits
 * and messages. These tests read each from the code that decides it, so a
 * changed default, a renamed step or a new limit fails here and the guide
 * is changed with it. GuidesDocs.test.ts holds the guides' shape, their
 * Dashboard words in every language and their links.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

function repoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function dashboardFile(relativePath: string): string {
  return repoFile(`${DASHBOARD}/${relativePath}`);
}

// One entry of an array literal of objects, from a line inside it.
function entryOf(source: string, marker: string): string {
  const at: number = source.indexOf(marker);

  if (at === -1) {
    throw new Error(`No ${marker}`);
  }

  const start: number = source.lastIndexOf("\n  {", at);
  const end: number = source.indexOf("\n  },", at);

  return source.slice(start, end);
}

/*
 * The Dashboard's copy files load the browser's config on import, so they
 * are read as source: the English of the translationKey("...") a property
 * of their copy object holds, and the number a constant is set to.
 */
function copyValue(source: string, property: string): string {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(
      `\\b${escapeRegExp(property)}: translationKey\\(\\s*"((?:[^"\\\\]|\\\\.)*)"`,
    ),
  );

  if (!match) {
    throw new Error(`No ${property}`);
  }

  return JSON.parse(`"${match[1] as string}"`) as string;
}

function numberConstant(source: string, name: string): number {
  const match: RegExpMatchArray | null = source.match(
    new RegExp(`export const ${escapeRegExp(name)}: number = (\\d+);`),
  );

  if (!match) {
    throw new Error(`No ${name}`);
  }

  return Number(match[1]);
}

// The class-member column a property belongs to: its decorators and their options.
function columnOf(model: string, property: string): string {
  const at: number = model.indexOf(`public ${property}`);

  return model.slice(model.lastIndexOf("@ColumnAccessControl", at), at);
}

const ON_CALL_SETUP: string = dashboardFile(
  "Components/GuidedSetup/OnCall/OnCallSetup.ts",
);
const ON_CALL_SETUP_PAGE: string = dashboardFile(
  "Components/GuidedSetup/OnCall/OnCallGuidedSetup.tsx",
);
const STATUS_PAGE_SETUP: string = dashboardFile(
  "Components/GuidedSetup/StatusPage/StatusPageSetup.ts",
);
const CUSTOM_DOMAIN_COPY: string = dashboardFile(
  "Components/CustomDomain/CustomDomainCopy.ts",
);
const WELCOME_CATALOG: string = dashboardFile(
  "Components/Home/WelcomeChecklist/WelcomeChecklistCatalog.ts",
);
const PAGE_SEARCH_INDEX: string = dashboardFile(
  "Components/CommandPalette/PageSearchIndex.ts",
);
const ROUTE_MAP: string = dashboardFile("Utils/RouteMap.ts");
const PROJECT: string = repoFile(
  "packages/Common/Models/DatabaseModels/Project.ts",
);

const PAGING: string = readPage("en", "guides/paging");
const STATUS_PAGE: string = readPage("en", "guides/status-page");

/*
 * One step of a guide's :::steps, from its heading to the next step or the
 * container's end.
 */
function stepOf(markdown: string, heading: string): string {
  const at: number = markdown.indexOf(`\n${heading}\n`);

  if (at === -1) {
    throw new Error(`No ${heading}`);
  }

  const rest: string = markdown.slice(at + heading.length + 2);
  const ends: Array<number> = [rest.indexOf("\n### "), rest.indexOf("\n:::")]
    .filter((end: number): boolean => {
      return end !== -1;
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });

  return rest.slice(0, ends[0] ?? rest.length);
}

// The last step of a guide: the one its :::steps container closes after.
function lastStepOf(markdown: string): string {
  const steps: string = markdown.slice(
    markdown.indexOf(":::steps"),
    markdown.indexOf("\n:::\n", markdown.indexOf(":::steps")),
  );

  return steps.slice(steps.lastIndexOf("\n### "));
}

/*
 * WHERE A TEST PAGE IS ACKNOWLEDGED FROM (#9401): the words "Acknowledge
 * the test page" says it with for each channel the guide sets up, held to
 * the product's own answer (canAcknowledgeOnCallTestPageBy) - push
 * included, which the On-Call app answers since #7014. A channel the guide
 * does not set up is null, so a new channel is decided on here.
 */
const TEST_PAGE_ACKNOWLEDGED_FROM: Readonly<
  Record<OnCallPageChannel, string | null>
> = {
  [OnCallPageChannel.SMS]: "Open the link in the text message",
  [OnCallPageChannel.Email]: "or the email and acknowledge the page there",
  [OnCallPageChannel.Call]: "press 1 during the phone call",
  [OnCallPageChannel.Push]:
    "you can also acknowledge it from its push notification",
  [OnCallPageChannel.WhatsApp]: null,
  [OnCallPageChannel.Telegram]: null,
  [OnCallPageChannel.Slack]: null,
  [OnCallPageChannel.MicrosoftTeams]: null,
  [OnCallPageChannel.Mattermost]: null,
  [OnCallPageChannel.Webhook]: null,
  [OnCallPageChannel.CustomChannel]: null,
};

/*
 * The last store release of the On-Call app without Acknowledge test page
 * under a test's push (#7014): packages/MobileApp/app.json carried it when
 * the action was added.
 */
const LAST_APP_RELEASE_WITHOUT_TEST_PAGE_ACTION: string = "1.6.0";

function versionNumber(version: string): number {
  const match: RegExpMatchArray | null = version.match(/^(\d+)\.(\d+)\.(\d+)$/);

  if (!match) {
    throw new Error(`Not a version: ${version}`);
  }

  return (
    Number(match[1]) * 1000000 + Number(match[2]) * 1000 + Number(match[3])
  );
}

// The latest store release of the On-Call app (packages/MobileApp/RELEASING.md).
function appVersion(): string {
  return (
    JSON.parse(repoFile("packages/MobileApp/app.json")) as {
      expo: { version: string };
    }
  ).expo.version;
}

// The search entry for a page, from its "page:" line to the end of its keywords.
function searchEntryOf(page: string): string {
  const at: number = PAGE_SEARCH_INDEX.indexOf(`page: PageMap.${page},`);

  if (at === -1) {
    throw new Error(`No search entry for ${page}`);
  }

  return PAGE_SEARCH_INDEX.slice(at, PAGE_SEARCH_INDEX.indexOf("],", at));
}

describe("Get Paged by Phone, SMS or Push, against the product", () => {
  it("walks the guided setup at /on-call-duty/setup, by its own title", () => {
    const title: string = copyValue(ON_CALL_SETUP, "pageTitle");

    expect(title).toBe("Page the right person when something breaks");
    expect(PAGING).toContain(`**${title}**`);
    expect(ROUTE_MAP).toContain(
      '[PageMap.ON_CALL_DUTY_GUIDED_SETUP]: "setup",',
    );
    expect(ROUTE_MAP).toContain(
      "`/dashboard/${RouteParams.ProjectID}/on-call-duty/${\n      OnCallDutyRoutePath[PageMap.ON_CALL_DUTY_GUIDED_SETUP]",
    );
  });

  it("opens it from Home's checklist, whose question offers the job, or from Search by the words it gives", () => {
    const step: string = entryOf(WELCOME_CATALOG, "step: WelcomeStep.OnCall,");

    expect(step).toContain('title: translationKey("Set up an on-call policy")');
    expect(step).toContain(
      "guidedSetupPage: PageMap.ON_CALL_DUTY_GUIDED_SETUP,",
    );
    expect(WELCOME_CATALOG).toContain(
      'title: translationKey("Page the right person when something breaks")',
    );
    expect(WELCOME_CATALOG).toContain('title: "Welcome to OneUptime 👋"');
    expect(WELCOME_CATALOG).toContain(
      'title: translationKey("What do you want to do first?")',
    );
    expect(PAGING).toContain("type `get paged`");
    expect(searchEntryOf("ON_CALL_DUTY_GUIDED_SETUP")).toContain(
      '"get paged",',
    );
  });

  it("meets the setup's four steps in the setup's order", () => {
    const list: string = ON_CALL_SETUP.slice(
      ON_CALL_SETUP.indexOf("export const ON_CALL_SETUP_STEPS"),
    );
    const steps: string = list.slice(0, list.indexOf("];"));
    const places: Array<number> = [
      "reachTitle",
      "whoTitle",
      "noAnswerTitle",
      "testTitle",
    ].map((property: string): number => {
      return PAGING.indexOf(`**${copyValue(ON_CALL_SETUP, property)}**`);
    });

    expect(steps.match(/OnCallSetupStep\.\w+,/g)).toHaveLength(places.length);
    expect(places).not.toContain(-1);
    expect(
      [...places].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(places);
  });

  it("gives the setup's defaults: 30 minutes before the next person, 2 more pages on the Free plan, and the policy's name", () => {
    const repeat: number = numberConstant(
      ON_CALL_SETUP,
      "DEFAULT_REPEAT_TIMES",
    );

    expect(DEFAULT_ESCALATE_AFTER_IN_MINUTES).toBe(30);
    expect(PAGING).toContain(
      `nobody acknowledges within ${DEFAULT_ESCALATE_AFTER_IN_MINUTES} minutes`,
    );
    expect(PAGING).toContain(
      `**Minutes to wait** at \`${DEFAULT_ESCALATE_AFTER_IN_MINUTES}\``,
    );
    expect(PAGING).toContain(`**Times to page again** at \`${repeat}\``);
    // The setup's policy is the website setup's, which is the guided setups' one name.
    expect(ON_CALL_SETUP).toContain(
      "export const ON_CALL_POLICY_NAME: string = WEBSITE_DOWN_POLICY_NAME;",
    );
    expect(
      dashboardFile("Components/GuidedSetup/WebsiteDown/WebsiteDownSetup.ts"),
    ).toContain(
      "export const WEBSITE_DOWN_POLICY_NAME: string = GUIDED_SETUP_POLICY_NAME;",
    );
    /*
     * Its English name, which the docs quote; a reader of another language
     * gets it in theirs (getFirstOnCallPolicyName, #7995).
     */
    expect(
      repoFile("packages/Common/Utils/GuidedSetup/OnCallPolicyRecords.ts"),
    ).toContain(
      'export const GUIDED_SETUP_POLICY_NAME: string = translationKey(\n  "Default on-call policy",\n);',
    );
    expect(PAGING).toContain("**Default on-call policy**");
    expect(copyValue(ON_CALL_SETUP, "whoPeopleLabel")).toBe("Paged first");
    expect(copyValue(ON_CALL_SETUP, "whoAddToLevel")).toBe(
      "Add to the first escalation rule",
    );
  });

  it("says what Cloud's balance starts at, and what it must be above before a number is added", () => {
    // The docs write an amount with a plain space; the page holds it (#8826).
    const floor: number = numberConstant(
      ON_CALL_SETUP,
      "PHONE_BALANCE_FLOOR_IN_USD_CENTS",
    );

    expect(columnOf(PROJECT, "smsOrCallCurrentBalanceInUSDCents")).toContain(
      "defaultValue: 0,",
    );
    expect(PAGING).toContain(
      `which starts at ${withPlainSpaces(formatProjectBalanceAmount(0))}`,
    );
    expect(PAGING).toContain(
      `above ${withPlainSpaces(formatProjectBalanceAmount(floor))} first`,
    );
    expect(PAGING).toContain(
      `if the balance is ${withPlainSpaces(formatProjectBalanceAmount(floor))} or less`,
    );
  });

  it("gives the recharge's limits and words, and that it charges the project's card", () => {
    expect(ON_CALL_SETUP_PAGE).toContain(
      "validation: { minValue: 20, maxValue: 1000 },",
    );
    expect(ON_CALL_SETUP_PAGE).toContain('submitButtonText="Recharge"');
    expect(
      dashboardFile("Components/ProjectBalance/ProjectBalanceCopy.ts"),
    ).toContain('translationKey("Amount (USD)")');
    expect(PAGING).toContain(
      "enter 20 to 1,000 USD under **Amount (USD)** and click **Recharge**",
    );
    expect(
      repoFile("packages/Common/Server/Services/NotificationService.ts"),
    ).toContain("No payment methods found for the project.");
    expect(PAGING).toContain("Adding balance charges the project's card.");
  });

  it("says SMS and calls start off, and that an owner, not an admin, turns them on", () => {
    const column: string = columnOf(PROJECT, "enableSmsNotifications");
    const updaters: string = column.slice(column.indexOf("update: ["));

    expect(column).toContain("defaultValue: false,");
    expect(updaters).toContain("Permission.ProjectOwner");
    expect(updaters).not.toContain("Permission.ProjectAdmin");
    expect(PAGING).toContain(
      "New projects start with SMS and phone calls off.",
    );
    expect(PAGING).toContain("turning SMS and calls on takes its owner");
    expect(copyValue(ON_CALL_SETUP, "turnOnSmsAndCalls")).toBe(
      "Turn on SMS and phone calls",
    );
  });

  it("says a test page is acknowledged from each channel it sets up exactly when the product acknowledges one from it, push included", () => {
    const section: string = stepOf(PAGING, "### Acknowledge the test page");

    for (const channel of Object.values(OnCallPageChannel)) {
      const words: string | null = TEST_PAGE_ACKNOWLEDGED_FROM[channel];

      if (words === null) {
        continue;
      }

      expect({ channel, saysSo: section.includes(words) }).toEqual({
        channel,
        saysSo: canAcknowledgeOnCallTestPageBy(channel),
      });
    }

    // The channels the guide sets up: the app's push, a text, a call and email.
    expect(
      Object.values(OnCallPageChannel)
        .filter((channel: OnCallPageChannel): boolean => {
          return TEST_PAGE_ACKNOWLEDGED_FROM[channel] !== null;
        })
        .sort(),
    ).toEqual(
      [
        OnCallPageChannel.Call,
        OnCallPageChannel.Email,
        OnCallPageChannel.Push,
        OnCallPageChannel.SMS,
      ].sort(),
    );
    // What it said before #7014 made the push acknowledge a test (#9401).
    expect(section).not.toContain("cannot acknowledge a test");

    const words: string = repoFile(
      "packages/Common/Types/OnCallDutyPolicy/OnCallTestPageWords.ts",
    );

    expect(words).toContain('"To acknowledge this test page, press 1."');
    expect(words).toContain("Acknowledge: {{link}}");
  });

  /*
   * The app draws Acknowledge test page under a test's push from the release
   * after 1.6.0 (#7014), the release that registers its push category: the
   * mobile FAQ names the action once app.json moves past 1.6.0
   * (MobileDesktopDocsFacts), and On-Call Policies names the versions as
   * "newer than 1.6.0" - true whatever number that release takes. The guide
   * names them in the same words.
   */
  it("names the app's versions that acknowledge a test from its push as On-Call Policies does: newer than 1.6.0", () => {
    const section: string = stepOf(PAGING, "### Acknowledge the test page");

    expect(
      repoFile("packages/MobileApp/src/notifications/categories.ts"),
    ).toContain(
      'export const ON_CALL_TEST_PAGE_CATEGORY: string = "ON_CALL_TEST_PAGE";',
    );
    expect(repoFile("packages/MobileApp/src/oncall/testPage.ts")).toContain(
      'acknowledgeButton: "Acknowledge test page",',
    );
    expect(section).toContain(
      `In the OneUptime On-Call app, in versions newer than ${LAST_APP_RELEASE_WITHOUT_TEST_PAGE_ACTION}, you can also acknowledge it from its push notification.`,
    );
    expect(readPage("en", "on-call/policies")).toContain(
      `or its push notification in the OneUptime On-Call app, in versions newer than ${LAST_APP_RELEASE_WITHOUT_TEST_PAGE_ACTION}.`,
    );
    // A release that shipped: the store's latest (app.json) is it or later.
    expect(versionNumber(appVersion())).toBeGreaterThanOrEqual(
      versionNumber(LAST_APP_RELEASE_WITHOUT_TEST_PAGE_ACTION),
    );
  });

  it("says the same of the push in every language: its last step names the app and the version as the English writes them", () => {
    expect(lastStepOf(PAGING)).toContain("### Acknowledge the test page");

    for (const language of TRANSLATED_LANGUAGES) {
      const step: string = lastStepOf(readPage(language, "guides/paging"));

      expect({
        language,
        namesTheVersion: step.includes(
          LAST_APP_RELEASE_WITHOUT_TEST_PAGE_ACTION,
        ),
        namesTheApp: step.includes("OneUptime On-Call"),
      }).toEqual({ language, namesTheVersion: true, namesTheApp: true });
    }
  });

  it("walks the escalation in a test 2 minutes apart, from the policy's own Test this policy", () => {
    expect(ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES).toBe(2);
    expect(PAGING).toContain(
      `paged up to ${ON_CALL_TEST_PAGE_ESCALATION_WAIT_IN_MINUTES} minutes later`,
    );
    expect(
      dashboardFile(
        "Components/OnCallPolicy/EscalationRule/EscalationRules.tsx",
      ),
    ).toContain('kind: "policy",');
    expect(
      dashboardFile("Components/OnCallTestPage/SendTestPageButton.tsx"),
    ).toContain('return "Test this policy";');
  });

  it("says the Free plan holds one person and one escalation rule", () => {
    expect(
      repoFile("packages/Common/Server/Services/TeamMemberService.ts"),
    ).toContain("export const ALLOWED_PEOPLE_IN_FREE_PLAN: number = 1;");
    expect(
      dashboardFile("Components/GuidedSetup/OnCall/OnCallSetupApi.ts"),
    ).toContain("return ProjectUtil.getCurrentPlan() !== PlanType.Free;");
    expect(PAGING).toContain(
      "The Free plan holds one person and one escalation rule",
    );
  });

  it("finds the phone in the reach step once the app is in, with Recheck", () => {
    expect(copyValue(ON_CALL_SETUP, "pushRow")).toBe("Mobile app or browser");
    expect(ON_CALL_SETUP_PAGE).toContain('title="Recheck"');
    expect(PAGING).toContain("click **Recheck**: **Mobile app or browser**");
  });

  it("sends a self-hosted server's admin to /admin/setup and npm run doctor", () => {
    expect(
      repoFile("packages/App/FeatureSet/AdminDashboard/src/Utils/RouteMap.ts"),
    ).toContain("[PageMap.SERVER_SETUP]: new Route(`/admin/setup`),");
    expect(
      (
        JSON.parse(repoFile("package.json")) as {
          scripts: Record<string, string>;
        }
      ).scripts["doctor"],
    ).toBeTruthy();
    expect(PAGING).toContain("`/admin/setup`");
    expect(PAGING).toContain("`npm run doctor`");
    expect(copyValue(ON_CALL_SETUP, "setUpTwilio")).toBe(
      "Set up SMS and calls",
    );
  });

  it("points to schedules with the plan they need on Cloud", () => {
    expect(
      repoFile(
        "packages/Common/Models/DatabaseModels/OnCallDutyPolicySchedule.ts",
      ),
    ).toContain("PlanType.Growth");
    expect(PAGING).toContain("On Cloud, from the Growth plan.");
  });
});

describe("Publish a Status Page, against the product", () => {
  it("walks the guided setup at /status-pages/setup, by its own title", () => {
    const title: string = copyValue(STATUS_PAGE_SETUP, "setupTitle");

    expect(title).toBe("Publish a status page");
    expect(STATUS_PAGE).toContain(`**${title}**`);
    expect(ROUTE_MAP).toContain(
      '[PageMap.STATUS_PAGES_GUIDED_SETUP]: "setup",',
    );
  });

  it("opens it from Home's checklist, whose question offers the job, or from Search", () => {
    const step: string = entryOf(
      WELCOME_CATALOG,
      "step: WelcomeStep.StatusPage,",
    );

    expect(step).toContain('title: translationKey("Publish a status page")');
    expect(step).toContain(
      "guidedSetupPage: PageMap.STATUS_PAGES_GUIDED_SETUP,",
    );
    expect(WELCOME_CATALOG).toContain(
      'title: translationKey("Tell my customers with a status page")',
    );
    expect(searchEntryOf("STATUS_PAGES_GUIDED_SETUP")).toContain(
      'title: "Publish a status page",',
    );
    expect(STATUS_PAGE).toContain("type `status page`");
  });

  it("meets the setup's two steps and its summary in order", () => {
    const places: Array<number> = [
      "pickTitle",
      "createButton",
      "reviewTitle",
      "linkLabel",
      "reviewButton",
      "summaryOptional",
    ].map((property: string): number => {
      return STATUS_PAGE.indexOf(
        `**${copyValue(STATUS_PAGE_SETUP, property)}**`,
      );
    });

    expect(places).not.toContain(-1);
    expect(
      [...places].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(places);
  });

  it("opens Custom Domains from the summary's own domain line, which needs no plan", () => {
    const domain: string = entryOf(STATUS_PAGE_SETUP, 'key: "domain",');
    const isPrivate: string = entryOf(STATUS_PAGE_SETUP, 'key: "private",');

    expect(domain).toContain('title: translationKey("Your own domain")');
    expect(domain).toContain("page: PageMap.STATUS_PAGE_VIEW_DOMAINS,");
    expect(domain).toContain("plan: null,");
    expect(isPrivate).toContain("plan: PlanType.Growth,");
    expect(STATUS_PAGE).toContain(
      "A custom domain and its free SSL certificate come with every plan.",
    );
    expect(STATUS_PAGE).toContain("making it private needs the Growth plan");
  });

  it("says the Free plan has one status page", () => {
    expect(repoFile("packages/Common/Server/EnvironmentConfig.ts")).toMatch(
      /ALLOWED_STATUS_PAGE_COUNT_IN_FREE_PLAN"\]\.toString\(\)\)\n\s+: 1;/,
    );
    expect(STATUS_PAGE).toContain(
      "The Free plan has one status page per project",
    );
  });

  it("adds the domain in Add Custom Domain's words, and checks it in DNS Setup's", () => {
    const words: Record<string, string> = {
      addTitle: "Add Custom Domain",
      addAddressTitle: "Domain",
      addSubmit: "Continue",
      dnsSetupTitle: "DNS Setup",
      dnsSetupRecordType: "Type",
      dnsSetupRecordName: "Name",
      dnsSetupRecordValue: "Value",
      dnsSetupCheckNow: "Check now",
      dnsSetupVerified: "Your CNAME record is verified.",
    };

    for (const [property, english] of Object.entries(words)) {
      expect({
        property,
        words: copyValue(CUSTOM_DOMAIN_COPY, property),
      }).toEqual({ property, words: english });
      expect(STATUS_PAGE).toContain(`**${english}**`);
    }
    expect(STATUS_PAGE).toContain("Click **Add Custom Domain**. In **Domain**");
  });

  it("says the TXT record is checked first, and the domain added only once it is found", () => {
    expect(
      copyValue(CUSTOM_DOMAIN_COPY, "dnsSetupWhatHappensNextTwoRecords"),
    ).toContain("As soon as the TXT record is found, we add this domain");
    expect(
      dashboardFile("Components/CustomDomain/CustomDomainDnsSetupModal.tsx"),
    ).toContain(
      "// The project's domain first: the custom domain cannot be added before.",
    );
    expect(STATUS_PAGE).toContain(
      "until it is found, the domain is not added, so click **Check now** again until it is",
    );
  });

  it("gives the certificate's 15 minutes, the 15-minute check and the order limit", () => {
    expect(CUSTOM_DOMAIN_COPY).toContain(
      "We are issuing a free SSL certificate for {{domain}}. It is usually live within 15 minutes.",
    );
    expect(copyValue(CUSTOM_DOMAIN_COPY, "dnsSetupWhatHappensNext")).toContain(
      "We check for this record every 15 minutes",
    );
    expect(
      repoFile("packages/Common/Server/Utils/Greenlock/CertificateOrder.ts"),
    ).toContain(
      "public static readonly ON_DEMAND_ORDER_WINDOW_IN_MINUTES: number = 15;",
    );
    expect(STATUS_PAGE).toContain("usually within 15 minutes");
    expect(STATUS_PAGE).toContain("checks its CNAME record every 15 minutes");
    expect(STATUS_PAGE).toContain("at most once every 15 minutes per domain");
  });

  it("quotes the Status column as the table says it", () => {
    for (const state of [
      "CertificateIssued",
      "IssuingCertificate",
      "VerifiedWithoutFreeCertificate",
    ]) {
      const match: RegExpMatchArray | null = CUSTOM_DOMAIN_COPY.match(
        new RegExp(
          `\\[CustomDomainState\\.${escapeRegExp(state)}\\]: translationKey\\(\\s*"([^"]+)"`,
        ),
      );

      expect({ state, found: Boolean(match) }).toEqual({ state, found: true });
      expect(STATUS_PAGE).toContain(`**${match![1] as string}**`);
    }
  });

  it("names the self-hosted settings as config.env and the chart name them", () => {
    const template: string = repoFile("config.example.env");
    const values: string = repoFile("HelmChart/Public/oneuptime/values.yaml");

    expect(template).toMatch(/^STATUS_PAGE_CNAME_RECORD=\S+$/m);
    expect(template).toMatch(/^LETS_ENCRYPT_ACCOUNT_KEY=$/m);
    expect(template).toContain(
      "Generate a private key via openssl, encode it to base64",
    );
    expect(values).toMatch(/^statusPage:\n {2}cnameRecord:/m);
    expect(values).toMatch(/^letsEncrypt:\n(?: {2}#.*\n)* {2}accountKey:/m);
    for (const name of [
      "`STATUS_PAGE_CNAME_RECORD`",
      "`statusPage.cnameRecord`",
      "`LETS_ENCRYPT_ACCOUNT_KEY`",
      "`letsEncrypt.accountKey`",
    ]) {
      expect(STATUS_PAGE).toContain(name);
    }
    expect(STATUS_PAGE).toContain("in place of the example value there");
    expect(CustomDomainReadinessWords.notReadyTitle).toBe(
      "This server is not ready for custom domains yet",
    );
  });

  it("says when Home's checklist counts the step done", () => {
    expect(WELCOME_CATALOG).toContain(
      "Keep customers in the loop on uptime, incidents and maintenance. Done when the page shows a monitor.",
    );
    expect(STATUS_PAGE).toContain(
      "it is done once a status page shows a monitor",
    );
  });
});

const WEBSITE_DOWN: string = readPage("en", "guides/website-down");
const WEBSITE_DOWN_SETUP: string = dashboardFile(
  "Components/GuidedSetup/WebsiteDown/WebsiteDownSetup.ts",
);
const WEBSITE_DOWN_PAGE: string = dashboardFile(
  "Components/GuidedSetup/WebsiteDown/WebsiteDownGuidedSetup.tsx",
);

describe("Know When Your Website or API Is Down, against the product", () => {
  it("walks the guided setup at /monitors/setup, by its own title", () => {
    const title: string = copyValue(WEBSITE_DOWN_SETUP, "pageTitle");

    expect(title).toBe("Know when my website or API is down");
    expect(WEBSITE_DOWN).toContain(`**${title}**`);
    expect(ROUTE_MAP).toContain('[PageMap.MONITOR_GUIDED_SETUP]: "setup",');
  });

  it("opens it from Home's checklist, whose question offers the job, or from Search by the words it gives", () => {
    const step: string = entryOf(WELCOME_CATALOG, "step: WelcomeStep.Monitor,");

    expect(step).toContain(
      'title: translationKey("Create your first monitor")',
    );
    expect(step).toContain("guidedSetupPage: PageMap.MONITOR_GUIDED_SETUP,");
    expect(WELCOME_CATALOG).toContain(
      'title: translationKey("Know when my website or API is down")',
    );
    expect(WEBSITE_DOWN).toContain("type `website down`");
    expect(searchEntryOf("MONITOR_GUIDED_SETUP")).toContain('"website down",');
  });

  /*
   * Step 4 (#7053) is walked only where it can be done, after the three
   * every run walks, so the guide meets it after the test and before the
   * summary. Each word is looked for after the one before it: step 1's
   * notice of a teammate's monitor (#7254) says "Open the monitor" long
   * before the summary does.
   */
  it("meets the setup's three steps in the setup's order, then its optional step, then its summary", () => {
    const listOf: (name: string) => string = (name: string): string => {
      const list: string = WEBSITE_DOWN_SETUP.slice(
        WEBSITE_DOWN_SETUP.indexOf(`export const ${name}`),
      );

      return list.slice(0, list.indexOf("];"));
    };
    const places: Array<number> = [];

    for (const property of [
      "checkTitle",
      "addressLabel",
      "startChecking",
      "whoTitle",
      "testTitle",
      "statusPageTitle",
      "summaryChecked",
      "nextMonitor",
      "startOver",
    ]) {
      places.push(
        WEBSITE_DOWN.indexOf(
          `**${copyValue(WEBSITE_DOWN_SETUP, property)}**`,
          (places[places.length - 1] ?? -1) + 1,
        ),
      );
    }

    expect(
      listOf("WEBSITE_DOWN_STEPS").match(/WebsiteDownStep\.\w+,/g),
    ).toHaveLength(3);
    expect(
      listOf("WEBSITE_DOWN_OPTIONAL_STEPS").match(/WebsiteDownStep\.\w+,/g),
    ).toEqual(["WebsiteDownStep.StatusPage,"]);
    expect(places).not.toContain(-1);
  });

  it("checks every 5 minutes, and counts no answer or an answer outside 200 to 399 as down", () => {
    expect(
      dashboardFile("Utils/Form/Monitor/MonitoringIntervalDefault.ts"),
    ).toContain(
      'export const DEFAULT_MONITORING_INTERVAL: string = "*/5 * * * *";',
    );
    expect(copyValue(WEBSITE_DOWN_SETUP, "checkHelp")).toContain(
      "every 5 minutes",
    );
    const criteria: string = repoFile(
      "packages/Common/Types/Monitor/MonitorCriteriaInstance.ts",
    );

    expect(criteria).toContain(
      "public static readonly DEFAULT_HEALTHY_STATUS_CODE_FROM: number = 200;",
    );
    expect(criteria).toContain(
      "public static readonly DEFAULT_HEALTHY_STATUS_CODE_BELOW: number = 400;",
    );
    expect(WEBSITE_DOWN).toContain("every 5 minutes");
    expect(WEBSITE_DOWN).toContain("an answer outside 200 to 399, as down");
  });

  it("says who may create a monitor, and that a member is told they are emailed instead", () => {
    const monitor: string = repoFile(
      "packages/Common/Models/DatabaseModels/Monitor.ts",
    );
    const creators: string = monitor.slice(
      monitor.indexOf("@TableAccessControl({"),
      monitor.indexOf("read: [", monitor.indexOf("@TableAccessControl({")),
    );

    for (const role of ["ProjectOwner", "ProjectAdmin", "ProjectMember"]) {
      expect(creators).toContain(`Permission.${role},`);
    }
    expect(WEBSITE_DOWN).toContain("an owner, admin or member may");
    expect(copyValue(WEBSITE_DOWN_SETUP, "whoOwnerOnlyHelp")).toContain(
      "You own this monitor, so you are emailed when it goes down.",
    );
  });

  it("names the policy the setup makes, and when it makes one", () => {
    /*
     * A single-quoted sentence (it quotes the policy's name), read as
     * written, with the Glossary's word marked in it (#7057).
     */
    expect(WEBSITE_DOWN_SETUP).toContain(
      `'This makes the {{onCallPolicy}} "{{policy}}", which pages them for every new incident and alert in this project.'`,
    );
    expect(WEBSITE_DOWN_SETUP).toContain(
      'onCallPolicy: translationKey("on-call policy"),',
    );
    expect(WEBSITE_DOWN).toContain("**Default on-call policy**");
    expect(WEBSITE_DOWN).toContain(
      "With no on-call policy or on-call rule yet",
    );
  });

  it("sends the test page to the person setting up, from Send me a test page", () => {
    expect(WEBSITE_DOWN_PAGE).toContain('target={{ kind: "self" }}');
    expect(
      dashboardFile("Components/OnCallTestPage/SendTestPageButton.tsx"),
    ).toContain('return "Send me a test page";');
    expect(WEBSITE_DOWN).toContain("click **Send me a test page**");
  });

  /*
   * The server never makes a master admin the owner of what they create, so
   * the guide told one to add themselves on the monitor's Owners page. The
   * setup makes the person setting it up the owner now (#7409), so no
   * reader has a workaround to follow.
   */
  it("gives the master admin no workaround: the setup makes whoever sets it up the monitor's owner", () => {
    const api: string = dashboardFile(
      "Components/GuidedSetup/WebsiteDown/WebsiteDownApi.ts",
    );

    expect(
      repoFile("packages/Common/Server/Services/DatabaseService.ts"),
    ).toContain("if (props.isRoot || props.isMasterAdmin || !props.userId) {");
    expect(api).toContain("public static async ensureMonitorOwner(data: {");
    expect(WEBSITE_DOWN_PAGE).toContain(
      "await WebsiteDownApi.ensureMonitorOwner({",
    );
    expect(WEBSITE_DOWN).not.toContain(
      "The master admin is not made the owner",
    );
    expect(WEBSITE_DOWN).not.toContain("**Owners**");
  });

  /*
   * On Cloud's Free plan a project with no card on file may not make a
   * monitor that runs checks (PayAsYouGoBillingService.requirePayAsYouGo);
   * the step says so before Start checking (#7367), and the guide says it
   * does.
   */
  it("says a Free plan project needs a payment method first, as the step says before Start checking", () => {
    expect(copyValue(WEBSITE_DOWN_SETUP, "addPaymentMethod")).toBe(
      "Add Payment Method",
    );
    expect(copyValue(WEBSITE_DOWN_SETUP, "paymentNeeded")).toContain(
      "Add a payment method before you start checking.",
    );
    expect(WEBSITE_DOWN_PAGE).toContain("WebsiteDownApi.needsPaymentMethod()");
    expect(WEBSITE_DOWN).toContain(
      "They are billed as they are used, so the project needs a payment method first: without one, the first step says so, with **Add Payment Method**.",
    );
  });

  /*
   * A new monitor's probes must all agree before its status changes
   * (minimumProbeAgreement unset: ProbeAgreementRule), and the step's help
   * says so (#7410).
   */
  it("says an incident opens only when all of the probes find it down", () => {
    expect(copyValue(WEBSITE_DOWN_SETUP, "checkHelp")).toContain(
      "An {{incident}} opens when every location that checks it finds it down",
    );
    // With the number of locations (#7461), as the guide says it.
    expect(WEBSITE_DOWN_SETUP).toContain(
      "from {{count}} locations. An {{incident}} opens when all of them find it down",
    );
    expect(
      repoFile("packages/Common/Utils/Monitor/ProbeAgreementRule.ts"),
    ).toContain("isSet ? minimum : data.activeProbeCount");
    expect(WEBSITE_DOWN).toContain(
      "an incident opens only when all of them find it down.",
    );
  });

  it("says the Free plan has 10 active monitors", () => {
    expect(repoFile("packages/Common/Server/EnvironmentConfig.ts")).toMatch(
      /ALLOWED_ACTIVE_MONITOR_COUNT_IN_FREE_PLAN"\]\.toString\(\),\n\s+\)\n\s+: 10;/,
    );
    expect(WEBSITE_DOWN).toContain("The Free plan has 10 active monitors.");
  });

  it("explains the first check's two silences as the setup words them", () => {
    expect(WEBSITE_DOWN_SETUP).toContain(
      '"No location checks {{host}} yet. Probes are added under Monitors > Settings > Probes."',
    );
    expect(WEBSITE_DOWN_SETUP).toContain(
      'one: "Checking {{host}} from {{count}} location...",',
    );
    expect(WEBSITE_DOWN).toContain("no location checks the address");
    expect(WEBSITE_DOWN).toContain("keeps saying it is checking");
  });
});
