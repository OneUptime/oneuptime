import IncidentStatusPageScopeCopy from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import IncidentScopeAddedPagesNotification from "Common/Types/StatusPage/IncidentScopeAddedPagesNotification";
import IncidentSubscriberAudience from "Common/Types/StatusPage/IncidentSubscriberAudience";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Limiting an incident to some status pages shows up across the dashboard:
 * the picker on the Create page, the incident's Settings tab and overview,
 * incident templates, the incidents table, a status page's settings, and the
 * "Will notify" audience summary on declaring an incident and on public
 * notes. Every piece of text lives in IncidentStatusPageScopeCopy (and the
 * added-pages checkbox in IncidentScopeAddedPagesNotification, shared with
 * the server), and reaches the screen by looking its English text up in the
 * Dashboard locale files. A string with no entry silently stays English, so
 * this pins:
 *
 *   - en.json maps every string to itself, and all sixteen other locales
 *     carry a real translation with the same {{placeholders}};
 *   - the pages render through the shared constants, so rewording one cannot
 *     leave a page showing an untranslated copy;
 *   - the pages are wired to the scope where the feature says they are.
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

// Strings that are the same word in every language, or an existing entry.
const SHARED_WITH_OTHER_FEATURES: Array<string> = ["Status Page"];

const STRINGS: Array<string> = Array.from(
  new Set([
    ...Object.values(IncidentStatusPageScopeCopy),
    IncidentScopeAddedPagesNotification.formFieldTitle,
    IncidentScopeAddedPagesNotification.formFieldDescription,
  ]),
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

describe("status page scope strings in every Dashboard locale", () => {
  test("there are strings to check", () => {
    expect(STRINGS.length).toBeGreaterThan(40);
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

describe("the dashboard renders the shared strings", () => {
  test("the Create page offers the picker, its warnings and the audience", () => {
    const source: string = readSource("Pages", "Incidents", "Create.tsx");

    // The picker, right after the monitors, with a status page dropdown.
    expect(source).toContain("title: IncidentStatusPageScopeCopy.pickerTitle,");
    expect(source).toContain(
      "description: IncidentStatusPageScopeCopy.pickerDescription,",
    );
    expect(source).toContain(
      "placeholder: IncidentStatusPageScopeCopy.pickerPlaceholder,",
    );
    expect(source).toContain("dropdownModal: { type: StatusPage,");
    expect(source.indexOf("statusPages: true, }, title:")).toBeGreaterThan(
      source.indexOf("field: { monitors: true, }"),
    );

    // The three warnings - and no banner explaining an empty picker.
    expect(source).not.toContain("StatusPagePickerAccessHint");
    expect(source).toContain("<StatusPagesNotListingMonitorsWarning");
    expect(source).toContain(
      "IncidentStatusPageScopeCopy.changeMonitorStatusWarning",
    );
    expect(source).toContain(
      "IncidentStatusPageScopeCopy.privateIncidentWarning",
    );

    // The audience on the last step, with the reasons nothing would be sent.
    expect(source).toContain("<SubscriberAudienceSummary");
    expect(source).toContain(
      "IncidentStatusPageScopeCopy.audiencePrivateIncident",
    );
    expect(source).toContain("IncidentStatusPageScopeCopy.audienceNotifyOff");
  });

  test("the Create page prefills the scope from a template", () => {
    const source: string = readSource("Pages", "Incidents", "Create.tsx");

    /*
     * The one template request also reads the template's custom field
     * values and its Custom Fields on Create settings (issue #4114).
     */
    expect(source).toContain(
      "statusPages: true, isScopedToStatusPages: true, // Its custom field values: the Details step starts from them. customFields: true, // And which fields that step asks for, and requires. customFieldSettings: true, }, });",
    );
    expect(source).toContain(
      "statusPages: incidentTemplate.statusPages?.map( (statusPage: StatusPage) => { return statusPage.id!.toString(); }, ),",
    );
  });

  test("the Create page warns when the template's status pages were all deleted", () => {
    const source: string = readSource("Pages", "Incidents", "Create.tsx");

    expect(source).toContain("setIsTemplateScopedToDeletedStatusPages(");
    expect(source).toContain("isScopedToDeletedStatusPages({");
    expect(source).toContain(
      "IncidentStatusPageScopeCopy.declaringFromTemplateScopedToDeletedPagesWarning",
    );
  });

  test("the template view warns when the template's status pages were all deleted", () => {
    const source: string = readSource(
      "Pages",
      "Incidents",
      "Settings",
      "IncidentTemplatesView.tsx",
    );

    expect(source).toContain(
      "IncidentStatusPageScopeCopy.templateScopedToDeletedPagesWarning",
    );
    expect(source).toContain("isScopedToStatusPages: true,");
  });

  test("the Settings tab has the scope card with its checkbox and warnings", () => {
    const source: string = readSource(
      "Pages",
      "Incidents",
      "View",
      "Settings.tsx",
    );

    expect(source).toContain(
      "title: IncidentStatusPageScopeCopy.settingsCardTitle,",
    );
    expect(source).toContain("getIncidentScopeAddedPagesFormField(");
    expect(source).toContain(
      "IncidentStatusPageScopeCopy.removingNotifiedPagesWarning",
    );
    expect(source).toContain(
      "IncidentStatusPageScopeCopy.clearingScopeWarning",
    );
    expect(source).toContain("statusPagesNotifiedOnCreation: true,");
    expect(source).toContain("<IncidentStatusPageScopeView");

    // No banner explaining an empty picker.
    expect(source).not.toContain("StatusPagePickerAccessHint");
    expect(source).not.toContain("useStatusPagePickerAccess");
  });

  test("the added-pages checkbox takes its text from the shared constants", () => {
    const source: string = readSource(
      "Components",
      "Incident",
      "IncidentScopeAddedPagesFormField.ts",
    );

    expect(source).toContain(
      "title: IncidentScopeAddedPagesNotification.formFieldTitle,",
    );
    expect(source).toContain(
      "description: IncidentScopeAddedPagesNotification.formFieldDescription,",
    );
    expect(source).toContain(
      "overrideFieldKey: IncidentScopeAddedPagesNotification.miscDataKey,",
    );
  });

  test("the overview shows the scope read only, linking to Settings", () => {
    const source: string = readSource(
      "Pages",
      "Incidents",
      "View",
      "Index.tsx",
    );

    expect(source).toContain(
      "title: IncidentStatusPageScopeCopy.overviewFieldTitle,",
    );
    expect(source).toContain("<IncidentStatusPageScopeView");
    expect(source).toContain("RouteMap[PageMap.INCIDENT_VIEW_SETTINGS]");
  });

  test("incident templates offer the field when created and viewed", () => {
    for (const file of ["IncidentTemplates.tsx", "IncidentTemplatesView.tsx"]) {
      const source: string = readSource("Pages", "Incidents", "Settings", file);

      expect(source).toContain(
        "title: IncidentStatusPageScopeCopy.pickerTitle,",
      );
      expect(source).toContain(
        "description: IncidentStatusPageScopeCopy.templatePickerDescription,",
      );
      // No banner explaining an empty picker.
      expect(source).not.toContain("StatusPagePickerAccessHint");
      expect(source).not.toContain("useStatusPagePickerAccess");
    }
  });

  test("the incidents table filters by status page", () => {
    const source: string = readSource(
      "Components",
      "Incident",
      "IncidentsTable.tsx",
    );

    expect(source).toContain("buildStatusPageScopeFacet(),");
  });

  test("a status page can show only the incidents scoped to it", () => {
    const source: string = readSource(
      "Pages",
      "StatusPages",
      "View",
      "StatusPageSettings.tsx",
    );

    expect(source).toContain("onlyShowScopedIncidents: true,");
    expect(source).toContain(
      "title: IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle,",
    );
    expect(
      source.split("IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle")
        .length - 1,
    ).toBe(2);
  });

  test("the incident public note composer shows the audience", () => {
    const source: string = readSource(
      "Pages",
      "Incidents",
      "View",
      "PublicNote.tsx",
    );

    expect(source).toContain(
      "audienceSummary: ( <SubscriberAudienceSummary request={{ incidentId: modelId }}",
    );
  });

  test("the audience request reaches the route IncidentAPI registers", () => {
    const source: string = readSource(
      "Components",
      "Incident",
      "useSubscriberAudience.ts",
    );

    expect(source).toContain(`"${IncidentSubscriberAudience.apiPath}"`);
    expect(source).toContain("headers: ModelAPI.getCommonHeaders(),");
  });
});
