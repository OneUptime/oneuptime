import SubscriberNotificationPreviewCopy, {
  formatPreviewText,
} from "../../FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationPreviewCopy";
import {
  describeHiddenPages,
  describeNothingSent,
  describePreviewStatusPage,
  describeTemplateChoice,
} from "../../FeatureSet/Dashboard/src/Components/Incident/SubscriberNotificationPreviewText";
import {
  getIncidentCreatedPreviewRequest,
  getPublicNotePreviewRequest,
} from "../../FeatureSet/Dashboard/src/Components/Incident/SubscriberNotificationPreviewRequests";
import { TranslateFunction } from "../../FeatureSet/Dashboard/src/Components/Incident/SubscriberAudienceText";
import ObjectID from "Common/Types/ObjectID";
import IncidentSubscriberAudience from "Common/Types/StatusPage/IncidentSubscriberAudience";
import SubscriberNotificationPreview, {
  SubscriberEmailTemplateChoiceReason,
  SubscriberNotificationPreviewEvent,
  SubscriberNotificationPreviewNothingSentReason,
} from "Common/Types/StatusPage/SubscriberNotificationPreview";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * 'Preview notification', 'Send test to me' and the template editor's live
 * preview, on the dashboard side:
 *
 *   - every string is in all seventeen Dashboard locales, with its
 *     {{placeholders}} (the dashboard translates by English text, so a
 *     string with no entry silently stays English);
 *   - what the dialog says for each reason, page and count, through the
 *     locale lookup with the placeholders filled in after it;
 *   - the requests the dashboard builds from the Declare Incident form and
 *     the note being written;
 *   - that the pages are wired where the feature says they are, to the
 *     routes the notification API mounts.
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

// Strings that were in the locales already, for other features.
const SHARED_WITH_OTHER_FEATURES: Array<string> = ["Subject"];

const STRINGS: Array<string> = Array.from(
  new Set(Object.values(SubscriberNotificationPreviewCopy)),
);

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function readSource(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8")
    .replace(/\s+/g, " ");
}

const english: TranslateFunction = (text: string): string => {
  return text;
};

// Marks every looked-up string, so a test can see what was translated.
const marked: TranslateFunction = (text: string): string => {
  return `<${text}>`;
};

describe("preview strings in every Dashboard locale", () => {
  test("there are strings to check", () => {
    expect(STRINGS.length).toBeGreaterThan(30);
  });

  test.each(STRINGS)("en.json maps %j to itself", (text: string) => {
    expect(readLocale("en")[text]).toBe(text);
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(
      STRINGS.filter((text: string): boolean => {
        return !SHARED_WITH_OTHER_FEATURES.includes(text);
      }),
    )("translates %j", (text: string) => {
      const value: unknown = translations[text];

      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect(value).not.toBe(text);
      expect(placeholders(value as string)).toEqual(placeholders(text));
    });
  });
});

describe("what the dialog says", () => {
  test("each reason nothing will be sent has its own line, looked up", () => {
    const lines: Array<string> = Object.values(
      SubscriberNotificationPreviewNothingSentReason,
    ).map((reason: SubscriberNotificationPreviewNothingSentReason): string => {
      return describeNothingSent(reason, english);
    });

    expect(new Set(lines).size).toBe(lines.length);
    expect(
      describeNothingSent(
        SubscriberNotificationPreviewNothingSentReason.NoMonitors,
        marked,
      ),
    ).toBe(`<${SubscriberNotificationPreviewCopy.noMonitors}>`);
  });

  test("which template and why, with the template's name filled in after the lookup", () => {
    expect(
      describeTemplateChoice(
        {
          usesCustomTemplate: true,
          reason: SubscriberEmailTemplateChoiceReason.CustomTemplate,
          customTemplateName: "Site 03 branded",
        },
        english,
      ),
    ).toBe(
      'This status page\'s custom email template "Site 03 branded" is used.',
    );

    expect(
      describeTemplateChoice(
        {
          usesCustomTemplate: false,
          reason:
            SubscriberEmailTemplateChoiceReason.CustomTemplateNeedsCustomSmtp,
          customTemplateName: "Branded",
        },
        marked,
      ),
    ).toBe(
      `<${SubscriberNotificationPreviewCopy.defaultCustomTemplateNeedsSmtp.replace("{{name}}", "Branded")}>`,
    );

    expect(
      describeTemplateChoice(
        {
          usesCustomTemplate: false,
          reason: SubscriberEmailTemplateChoiceReason.NoCustomTemplate,
        },
        english,
      ),
    ).toBe(SubscriberNotificationPreviewCopy.defaultNoCustomTemplate);

    expect(
      describeTemplateChoice(
        {
          usesCustomTemplate: false,
          reason: SubscriberEmailTemplateChoiceReason.CustomTemplateIsEmpty,
          customTemplateName: "Draft",
        },
        english,
      ),
    ).toBe(
      'The default email is used: the custom template "Draft" has no body.',
    );
  });

  test("a page reads with its 'up to' counts, as the audience summary reads it", () => {
    expect(
      describePreviewStatusPage(
        {
          statusPageId: "b0000000-0000-4000-8000-000000000003",
          name: "Site 03",
          subscriberCounts: {
            ...IncidentSubscriberAudience.getEmptyCounts(),
            email: 41,
            sms: 3,
          },
          subject: "",
          html: "",
          templateChoice: {
            usesCustomTemplate: false,
            reason: SubscriberEmailTemplateChoiceReason.NoCustomTemplate,
          },
        },
        english,
      ),
    ).toBe("Site 03 (up to 41 email, 3 SMS)");
  });

  test("pages the caller cannot see: none, one, or several", () => {
    expect(describeHiddenPages(0, english)).toBeNull();
    expect(describeHiddenPages(1, english)).toBe(
      SubscriberNotificationPreviewCopy.oneHiddenPageNotPreviewed,
    );
    expect(describeHiddenPages(4, marked)).toBe(
      `<${SubscriberNotificationPreviewCopy.hiddenPagesNotPreviewed.replace("{{number}}", "4")}>`,
    );
  });

  test("placeholders are filled in after the lookup", () => {
    expect(
      formatPreviewText(SubscriberNotificationPreviewCopy.sendTestSent, {
        email: "me@acme.com",
      }),
    ).toBe(
      "Test email sent to me@acme.com. It can take a few minutes to arrive.",
    );
  });
});

describe("the requests the dashboard builds", () => {
  test("from the Declare Incident form, in whatever shape it holds its values", () => {
    expect(
      getIncidentCreatedPreviewRequest({
        values: {
          title: "Checkout failing",
          description: "Payments fail.",
          incidentSeverity: { value: "d0000000-0000-4000-8000-000000000001" },
          monitors: [
            "C0000000-0000-4000-8000-000000000001",
            { _id: "c0000000-0000-4000-8000-000000000002" },
          ],
          statusPages: [new ObjectID("b0000000-0000-4000-8000-000000000001")],
          labels: [{ value: "e0000000-0000-4000-8000-000000000001" }],
          isPrivate: false,
        },
        customFields: { Impact: "High" },
      }),
    ).toEqual({
      event: SubscriberNotificationPreviewEvent.IncidentCreated,
      incident: {
        title: "Checkout failing",
        description: "Payments fail.",
        incidentSeverityId: "d0000000-0000-4000-8000-000000000001",
        monitorIds: [
          "c0000000-0000-4000-8000-000000000001",
          "c0000000-0000-4000-8000-000000000002",
        ],
        statusPageIds: ["b0000000-0000-4000-8000-000000000001"],
        labelIds: ["e0000000-0000-4000-8000-000000000001"],
        customFields: { Impact: "High" },
        isPrivate: false,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      },
    });
  });

  test("an empty form: nothing picked, notify on, private off", () => {
    expect(
      getIncidentCreatedPreviewRequest({
        values: {
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
          isPrivate: true,
        },
        customFields: undefined,
      }),
    ).toEqual({
      event: SubscriberNotificationPreviewEvent.IncidentCreated,
      incident: {
        title: "",
        description: "",
        incidentSeverityId: null,
        monitorIds: [],
        statusPageIds: [],
        labelIds: [],
        customFields: {},
        isPrivate: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      },
    });
  });

  test("from the note being written; nothing while it is blank", () => {
    const postedAt: Date = new Date("2026-09-27T10:30:00.000Z");

    expect(
      getPublicNotePreviewRequest({
        incidentId: new ObjectID("a0000000-0000-4000-8000-00000000000a"),
        note: "Rolling back.",
        postedAt: postedAt,
      }),
    ).toEqual({
      event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
      incidentId: "a0000000-0000-4000-8000-00000000000a",
      note: "Rolling back.",
      postedAt: postedAt,
    });

    expect(
      getPublicNotePreviewRequest({
        incidentId: "a0000000-0000-4000-8000-00000000000a",
        note: "   \n ",
        postedAt: null,
      }),
    ).toBeNull();
  });
});

describe("the dashboard is wired where the feature says", () => {
  test("the requests reach the routes the notification API mounts, naming the project", () => {
    const source: string = readSource(
      "Components",
      "Incident",
      "SubscriberNotificationPreviewApi.ts",
    );

    expect(source).toContain(
      `"${SubscriberNotificationPreview.routerPath}${SubscriberNotificationPreview.previewPath}"`,
    );
    expect(source).toContain(
      `"${SubscriberNotificationPreview.routerPath}${SubscriberNotificationPreview.sendTestPath}"`,
    );
    expect(source).toContain("URL.fromString(NOTIFICATION_URL.toString())");
    expect(
      source.split("headers: ModelAPI.getCommonHeaders(),").length - 1,
    ).toBe(2);

    const notificationIndex: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Notification",
          "Index.ts",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(notificationIndex).toContain(
      "`/${APP_NAME}${SubscriberNotificationPreview.routerPath}`, SubscriberNotificationPreview.routerPath, ], SubscriberNotificationPreviewAPI,",
    );
  });

  test("Declare Incident offers the preview on its last step, with the Details step's values", () => {
    const source: string = readSource("Pages", "Incidents", "Create.tsx");

    expect(source).toContain(
      '<SubscriberNotificationPreviewButton dataTestId="incident-create-preview-notification"',
    );
    expect(source).toContain(
      "return getIncidentCreatedPreviewRequest({ values: item as Record<string, unknown>, customFields: packCustomFieldFormValues({ definitions: detailsStepDefinitions, formValues: item as JSONObject, startingCustomFields: startingCustomFields, isShown: isAskedOnIncidentForm, }), });",
    );
    /*
     * On the summary of the notify field: whether it is ticked, the
     * audience, then the preview - offered only when something can be sent
     * (notifying, not private, on a monitor).
     */
    expect(source).toContain(
      'getSummaryElement: (item: FormValues<Incident>) => { return ( <> <BooleanValue value={isNotifyTicked(item)} dataTestId="incident-create-notify-subscribers-value" /> {getAudienceSummary(item)} {isNotifyingSubscribers(item) && hasMonitors(item) ? ( <SubscriberNotificationPreviewButton dataTestId="incident-create-preview-notification"',
    );
    expect(
      source.split("<SubscriberNotificationPreviewButton").length - 1,
    ).toBe(1);
  });

  test("the public note composer offers it while notifying, with the note being written", () => {
    const page: string = readSource(
      "Pages",
      "Incidents",
      "View",
      "PublicNote.tsx",
    );

    expect(page).toContain("renderPreview: (draft: {");
    expect(page).toContain(
      "return getPublicNotePreviewRequest({ incidentId: modelId, note: draft.note, postedAt: draft.postedAt, });",
    );
    expect(page).toContain(
      "SubscriberNotificationPreviewCopy.previewButtonDisabledNoNote",
    );

    const notes: string = readSource(
      "Components",
      "EventNotes",
      "EventNotes.tsx",
    );
    expect(notes).toContain("props.subscriberNotifications?.renderPreview");

    const composer: string = readSource(
      "Components",
      "EventNotes",
      "NoteComposer.tsx",
    );
    expect(composer).toContain(
      "{props.values.shouldNotify && props.notifyPreview ? (",
    );
  });

  test("the template editor previews as it is typed, when creating and when editing", () => {
    const create: string = readSource(
      "Pages",
      "StatusPages",
      "Settings",
      "SubscriberNotificationTemplates.tsx",
    );
    const view: string = readSource(
      "Pages",
      "StatusPages",
      "Settings",
      "SubscriberNotificationTemplateView.tsx",
    );

    expect(create).toContain("<SubscriberTemplateLivePreview");
    expect(create).toContain(
      "templateBody={values.templateBody as string | undefined}",
    );
    // Email and the other channels each get it on the edit form.
    expect(view.split("<SubscriberTemplateLivePreview").length - 1).toBe(2);
  });
});
