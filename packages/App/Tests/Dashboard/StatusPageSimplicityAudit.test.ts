import { StatusPageOverviewCopy } from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageOverviewCopy";
import {
  EMAIL_SUBSCRIBER_STATUS,
  SUBSCRIBER_ADD_CHOICE,
  SubscriberFormCopy,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberFormChoices";
import SubscriberChoicesCopy from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberChoicesCopy";
import {
  EMAIL_FOOTER_CHOICE,
  SubscriberEmailFooterCopy,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberEmailFooterCopy";
import StatusPageCustomCodeCopy from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageCustomCodeCopy";
import { StatusPageSignInCopy } from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageSignInCopy";
import StatusPageBrandingCopy from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageBrandingCopy";
import { REPORT_PERIOD_TYPE_OPTIONS } from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageReportsCopy";
import {
  STATUS_PAGE_GROUP_NAME_PLACEHOLDER,
  STATUS_PAGE_GROUP_VIEW_MODE_OPTIONS,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageGroupFormSections";
import StatusPageGroupViewMode from "Common/Types/StatusPage/StatusPageGroupViewMode";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The status pages simplicity audit: switches whose help explained two
 * modes are plain choices, rarely used settings are folded, the words are
 * short and say what a visitor sees, and an empty page says its one next
 * step. Stored values, the API and Terraform are unchanged.
 *
 * These hold the screens to it from their sources: what each asks and how,
 * that no screen names a page that does not exist, and that every new word
 * is translated in all sixteen other Dashboard languages.
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
const I18N_DIR: string = path.join(DASHBOARD_SRC, "..", "i18n");

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

// Without its comments, collapsed to one line.
function readCode(relative: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\s+/g, " ");
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

const SOURCE_FILE: RegExp = /\.tsx?$/;

function listSources(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...listSources(full));
    } else if (SOURCE_FILE.test(entry.name)) {
      found.push(full);
    }
  }

  return found;
}

const PLACEHOLDER: RegExp = /\{\{\s*([\w.]+)\s*\}\}/g;

function placeholders(text: string): Array<string> {
  return Array.from(text.matchAll(PLACEHOLDER))
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    })
    .sort();
}

/*
 * Every word the audit put on a screen: from the copy modules, and the
 * sentences two pages keep in their own source.
 */
const NEW_WORDS: Array<string> = [
  ...Object.values(StatusPageOverviewCopy),
  ...Object.values(SubscriberFormCopy).filter((text: string): boolean => {
    // "Status" and the status names were translated long before.
    return ![
      "Status",
      "Subscribed",
      "Unsubscribed",
      "Awaiting Confirmation",
    ].includes(text);
  }),
  ...SUBSCRIBER_ADD_CHOICE.options.map((option: { description?: string }) => {
    return option.description as string;
  }),
  ...EMAIL_SUBSCRIBER_STATUS.options.map((option: { description?: string }) => {
    return option.description as string;
  }),
  ...Object.values(SubscriberChoicesCopy).filter((text: string): boolean => {
    return ![
      "Allow Subscribers to Choose Resources",
      "Allow Subscribers to Choose Event Types",
      "Subscriber Timezones",
      "Custom SMTP",
      "Twilio Config",
    ].includes(text);
  }),
  ...Object.values(SubscriberEmailFooterCopy).filter((text: string) => {
    return text !== "Default";
  }),
  ...Object.values(StatusPageCustomCodeCopy).filter((text: string) => {
    return ![
      "Custom Domains",
      "Header HTML",
      "Footer HTML",
      "Custom CSS",
      "Custom JavaScript",
    ].includes(text);
  }),
  ...Object.values(StatusPageSignInCopy),
  StatusPageBrandingCopy.imagesDescription,
  StatusPageBrandingCopy.titleDescription,
  StatusPageBrandingCopy.pageTitlePlaceholder,
  StatusPageBrandingCopy.pageDescriptionPlaceholder,
  StatusPageBrandingCopy.faviconDescription,
  StatusPageBrandingCopy.headerLinksDescription,
  StatusPageBrandingCopy.headerLink,
  StatusPageBrandingCopy.copyrightDescription,
  StatusPageBrandingCopy.footerLinksDescription,
  StatusPageBrandingCopy.footerLink,
  ...REPORT_PERIOD_TYPE_OPTIONS.map((option: { description: string }) => {
    return option.description;
  }),
  STATUS_PAGE_GROUP_NAME_PLACEHOLDER,
  ...STATUS_PAGE_GROUP_VIEW_MODE_OPTIONS.map(
    (option: { description: string }) => {
      return option.description;
    },
  ),
  // The answers themselves: List, and Grid, also the group's chip.
  ...STATUS_PAGE_GROUP_VIEW_MODE_OPTIONS.map((option: { title: string }) => {
    return option.title;
  }),
  // Embedded Status.
  "A small image of this page's overall status, for your website, a README or your docs.",
  "Serves the badge at a link that carries the token below.",
  "The secret part of the badge's link. Anyone with the link can show the badge.",
  "Create Token",
  "No token yet.",
  "Embed the Badge",
  "Paste one of these where the badge should show.",
  "Create a token to see the badge and the code to embed it.",
  "Turn on Enable Embedded Status Badge to see the badge and the code to embed it.",
  "Markdown, linked to the status page",
  // MCP.
  "Lets AI assistants such as Claude read this page's status, incidents and announcements.",
  "Connect an AI Assistant",
  "Add this server to your AI assistant. It needs no API key.",
  "The assistant names this page by its ID, or by one of its custom domains:",
  "Turning the server off does not hide the page itself: who can see it is set on {{accessLink}}. The tools are listed in the {{docsLink}}.",
  "MCP Server docs",
  // The resources' and groups' switches.
  "Shown in a tooltip beside the resource on the status page.",
  "Shows its current status, such as Operational, beside it.",
  "Shows its uptime beside it, over the days set under Uptime History on Advanced Settings.",
  "A bar for each day, over the days set under Uptime History on Advanced Settings.",
  "Shows the group's status beside its name.",
  "Shows the group's uptime beside it, over the days set under Uptime History on Advanced Settings.",
  // Announcements.
  "Notices on this status page, such as planned work or news.",
  "Notices on your status pages, such as planned work or news.",
];

describe("the words", () => {
  const english: Record<string, unknown> = readJson(
    path.join(LOCALES_DIR, "en.json"),
  );
  const sameEverywhere: Array<string> = readJson(
    path.join(I18N_DIR, "SameAsEnglish.json"),
  ) as unknown as Array<string>;

  test("are all keys of the English locale, each its own English", () => {
    expect(NEW_WORDS.length).toBeGreaterThan(90);

    for (const text of NEW_WORDS) {
      expect([text, english[text]]).toEqual([text, text]);
    }
  });

  test.each(OTHER_LOCALES)(
    "%s words every one of them, keeping its placeholders",
    (locale: string) => {
      const translations: Record<string, unknown> = readJson(
        path.join(LOCALES_DIR, `${locale}.json`),
      );
      const progress: Record<string, unknown> = readJson(
        path.join(I18N_DIR, "Progress", `${locale}.json`),
      );
      const sameHere: Array<string> =
        (progress["sameAsEnglish"] as Array<string> | undefined) || [];

      for (const text of NEW_WORDS) {
        const translated: unknown = translations[text];

        expect([text, typeof translated]).toEqual([text, "string"]);

        if (!sameEverywhere.includes(text) && !sameHere.includes(text)) {
          expect([text, translated]).not.toEqual([text, text]);
        }

        expect([text, placeholders(translated as string)]).toEqual([
          text,
          placeholders(text),
        ]);
      }
    },
  );

  test("the choice answers say what they mean, and the footer's default line is the emails' own", () => {
    expect(EMAIL_FOOTER_CHOICE.options.length).toBe(2);
    expect(StatusPageOverviewCopy.namePlaceholder).toBe("e.g., Acme Status");
    expect(STATUS_PAGE_GROUP_NAME_PLACEHOLDER).toBe("e.g., Core services");
  });
});

describe("the screens", () => {
  test("no status page screen sends people to a Status Page Settings page: there is none", () => {
    const sources: Array<string> = [
      ...listSources(path.join(DASHBOARD_SRC, "Pages", "StatusPages")),
      ...listSources(path.join(DASHBOARD_SRC, "Components", "StatusPage")),
    ];

    expect(sources.length).toBeGreaterThan(50);

    for (const file of sources) {
      const code: string = readCode(path.relative(DASHBOARD_SRC, file));

      expect([
        path.relative(DASHBOARD_SRC, file),
        code.includes("Status Page Settings"),
      ]).toEqual([path.relative(DASHBOARD_SRC, file), false]);
    }
  });

  test("a group's View Mode is two answers, List first, each with its line, and no label saying it is optional", () => {
    const resources: string = readCode("Pages/StatusPages/View/Resources.tsx");
    const field: string = resources.slice(
      resources.indexOf('title: "View Mode",'),
      resources.indexOf(
        "collapsibleSection: layoutSection,",
        resources.indexOf('title: "View Mode",'),
      ),
    );

    expect(field).toContain("fieldType: FormFieldSchemaType.RadioButton,");
    expect(field).toContain(
      "radioButtonOptions: STATUS_PAGE_GROUP_VIEW_MODE_OPTIONS,",
    );
    expect(field).toContain("hideOptionalLabel: true,");
    expect(field).toContain("hideColumnDescription: true,");
    expect(field).toContain("defaultValue: StatusPageGroupViewMode.List,");
    expect(field).not.toContain("FormFieldSchemaType.Dropdown");

    expect(
      STATUS_PAGE_GROUP_VIEW_MODE_OPTIONS.map(
        (option: { value: StatusPageGroupViewMode; title: string }) => {
          return [option.value, option.title];
        },
      ),
    ).toEqual([
      [StatusPageGroupViewMode.List, "List"],
      [StatusPageGroupViewMode.Grid, "Grid"],
    ]);

    // The group's name, by example, and no column help under it.
    expect(resources).toContain(
      'title: "Group Name", fieldType: FormFieldSchemaType.Text, required: true, placeholder: STATUS_PAGE_GROUP_NAME_PLACEHOLDER, hideColumnDescription: true,',
    );

    /*
     * A grid group's chip on the Resources page says Grid in the reader's
     * language, as its View Mode does, and so do the chips beside it.
     */
    const panel: string = readCode(
      "Components/StatusPage/StatusPageResourcePanel.tsx",
    );

    for (const chip of ["Grid", "Collapsed by default", "Uptime %"]) {
      expect([chip, panel.includes(`{translateString("${chip}")}`)]).toEqual([
        chip,
        true,
      ]);
      expect([chip, panel.includes(`> ${chip} </span>`)]).toEqual([
        chip,
        false,
      ]);
    }
  });

  test("the subscriber lists add with Add Subscriber, and fold the welcome and the note", () => {
    /*
     * The table puts its verb before its singular name: Add Subscriber, and
     * Add New Subscriber over its dialog. The copy keeps both phrases whole,
     * for the table to look up.
     */
    expect(SubscriberFormCopy.subscriberName).toBe("Subscriber");
    expect(SubscriberFormCopy.addButton).toBe("Add Subscriber");
    expect(SubscriberFormCopy.addDialogTitle).toBe("Add New Subscriber");

    for (const file of [
      "EmailSubscribers.tsx",
      "SMSSubscribers.tsx",
      "SlackSubscribers.tsx",
      "MicrosoftTeamsSubscribers.tsx",
      "WebhookSubscribers.tsx",
    ]) {
      const code: string = readCode(`Pages/StatusPages/View/${file}`);

      expect([file, code.includes('singularName="Subscriber"')]).toEqual([
        file,
        true,
      ]);
      expect([file, code.includes('createVerb="Add"')]).toEqual([file, true]);
      expect([
        file,
        code.includes("getSubscriberInternalNoteField(moreFields)"),
      ]).toEqual([file, true]);
      // The internal note is no step of its own any more.
      expect([file, code.includes('id: "internal-info"')]).toEqual([
        file,
        false,
      ]);

      if (file === "EmailSubscribers.tsx") {
        expect(code).toContain("...getEmailSubscriberAddChoiceFields(),");
        expect(code).toContain(
          "...getSubscriberStatusFields({ isEmail: true }),",
        );
      } else {
        expect([
          file,
          code.includes("getSubscriberWelcomeField(moreFields)"),
        ]).toEqual([file, true]);
        expect([
          file,
          code.includes("...getSubscriberStatusFields({ isEmail: false }),"),
        ]).toEqual([file, true]);
      }
    }
  });

  test("the custom code page says where the code runs, and each card what it replaces", () => {
    const page: string = readCode("Pages/StatusPages/View/CustomHtmlCss.tsx");

    expect(page).toContain("title={StatusPageCustomCodeCopy.notice}");
    expect(page).toContain("PageMap.STATUS_PAGE_VIEW_DOMAINS");
    expect(StatusPageCustomCodeCopy.notice).toBe(
      "This code runs only when the page is opened on one of its custom domains, not at its preview link.",
    );
    expect(StatusPageCustomCodeCopy.headerDescription).toBe(
      "Replaces the page's header: its logo and header links.",
    );
    expect(StatusPageCustomCodeCopy.footerDescription).toBe(
      "Replaces the page's footer, with its links and its language and theme switches.",
    );

    // And it is true: the public page draws the custom HTML instead of its own.
    const masterPage: string = fs
      .readFileSync(
        path.join(
          DASHBOARD_SRC,
          "..",
          "..",
          "StatusPage",
          "src",
          "Components",
          "MasterPage",
          "MasterPage.tsx",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(masterPage).toContain(
      "{!canRenderCustomHtml || !headerHtml ? ( <Header",
    );
    expect(masterPage).toContain(
      "{!canRenderCustomHtml || !footerHtml ? ( <Footer",
    );
  });

  test("the SSO and OIDC lists name their rows providers, and test sign-in only once there is one", () => {
    for (const [file, singular, plural] of [
      ["SSO.tsx", "ssoProvider", "ssoProviders"],
      ["OIDC.tsx", "oidcProvider", "oidcProviders"],
    ] as Array<[string, string, string]>) {
      const code: string = readCode(`Pages/StatusPages/View/${file}`);

      expect(code).toContain(`singularName={StatusPageSignInCopy.${singular}}`);
      expect(code).toContain(`pluralName={StatusPageSignInCopy.${plural}}`);
      expect(code).toContain('createVerb="Add"');
      expect(code).toContain(
        "{providerCount > 0 ? ( <StatusPageSignInTestCard statusPageId={modelId} /> ) : ( <></> )}",
      );
      expect(code).toContain("setProviderCount(totalCount);");
    }
  });
});
