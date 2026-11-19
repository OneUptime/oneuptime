import MaintenanceStatusPagesCopy, {
  hasNoStatusPagePicked,
} from "../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceStatusPagesCopy";
import IncidentStatusPageScopeCopy from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE MAINTENANCE EVENT'S STATUS PAGE PICKER SAYS WHAT EMPTY MEANS (#9131).
 *
 * An event shows only on the status pages it names; an incident, left
 * empty, shows on every status page that lists its monitors. The pickers
 * looked alike, so someone who had learned incidents read an event with no
 * page picked as one on their status page. The event's picker now says so
 * in its placeholder and help, and the review warns - in words defined once
 * (MaintenanceStatusPagesCopy) for Create, the event's Edit and the
 * templates, every one of them translated.
 *
 * The forms are drawn for real in Common's Tests/App/Dashboard/
 * ScheduledMaintenanceStatusPageSuggestions.test.tsx.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const readLocale: (locale: string) => Record<string, string> = (
  locale: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
};

const readSource: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
};

const SENTENCES: Array<string> = Object.values(MaintenanceStatusPagesCopy);

describe("the maintenance event's status page picker", () => {
  test("its words are Dashboard locale keys", () => {
    const english: Record<string, string> = readLocale("en");

    for (const sentence of SENTENCES) {
      expect({ sentence, isKey: english[sentence] === sentence }).toEqual({
        sentence,
        isKey: true,
      });
    }
  });

  test("its words are translated in every other locale", () => {
    for (const locale of DASHBOARD_LANGUAGES) {
      const translations: Record<string, string> = readLocale(locale);

      for (const sentence of SENTENCES) {
        const translation: string | undefined = translations[sentence];

        expect({
          locale,
          sentence,
          isTranslated: Boolean(translation) && translation !== sentence,
        }).toEqual({ locale, sentence, isTranslated: true });
      }
    }
  });

  test("its label is the one the docs name, written without a trailing space, and keyed only that way", () => {
    const english: Record<string, string> = readLocale("en");

    expect(MaintenanceStatusPagesCopy.pickerTitle).toBe(
      "Show event on these status pages",
    );
    expect(english["Show event on these status pages "]).toBeUndefined();
    // The help it replaced said nothing of what empty means.
    expect(english["Select status pages to show this event on"]).toBe(
      undefined,
    );
  });

  test("says empty means no status page, where an incident's picker says every page that lists the monitors", () => {
    expect(MaintenanceStatusPagesCopy.pickerPlaceholder).toBe(
      "Not shown on any status page",
    );
    expect(MaintenanceStatusPagesCopy.pickerDescription).toContain(
      "Unlike an incident",
    );
    expect(MaintenanceStatusPagesCopy.pickerDescription).toContain(
      "shows on no status page",
    );
    expect(MaintenanceStatusPagesCopy.templatePickerDescription).toContain(
      "they show on no status page",
    );
    // Not the incident's placeholder: the two empty pickers read differently.
    expect(MaintenanceStatusPagesCopy.pickerPlaceholder).not.toBe(
      IncidentStatusPageScopeCopy.pickerPlaceholder,
    );
  });

  test("its help is one short sentence or two, as every field's is", () => {
    for (const description of [
      MaintenanceStatusPagesCopy.pickerDescription,
      MaintenanceStatusPagesCopy.templatePickerDescription,
    ]) {
      expect(description.length).toBeLessThanOrEqual(150);
      expect(description.endsWith(".")).toBe(true);
    }
  });

  test("is defined once: Create, the event's Edit and the templates draw the shared field", () => {
    for (const page of [
      "Pages/ScheduledMaintenanceEvents/Create.tsx",
      "Pages/ScheduledMaintenanceEvents/View/Index.tsx",
      "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx",
    ]) {
      const source: string = readSource(page);

      expect({
        page,
        shared: source.includes("getMaintenanceStatusPagesFormField<"),
      }).toEqual({
        page,
        shared: true,
      });
      expect({
        page,
        copied: source.includes("Show event on these status pages"),
      }).toEqual({ page, copied: false });
    }

    expect(
      readSource(
        "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx",
      ),
    ).toMatch(
      /getMaintenanceStatusPagesFormField<ScheduledMaintenanceTemplate>\(\{\s*stepId: "resources-affected",\s*isTemplate: true,/,
    );
  });

  test("the event's header and details say an event on no status page is on none", () => {
    const overview: string = readSource(
      "Pages/ScheduledMaintenanceEvents/View/Index.tsx",
    );

    expect(overview).toContain(
      "translator.translateText(MaintenanceStatusPagesCopy.notShownFact)",
    );
    expect(overview.replace(/\s+/g, "")).toContain(
      "noItemsMessage={MaintenanceStatusPagesCopy.notShownFact}",
    );
  });
});

describe("hasNoStatusPagePicked", () => {
  test.each([
    [undefined, true],
    [null, true],
    ["", true],
    [[], true],
    [[""], true],
    [["22222222-2222-4222-8222-222222222222"], false],
    [[{ _id: "22222222-2222-4222-8222-222222222222" }], false],
    [
      [{ value: "22222222-2222-4222-8222-222222222222", label: "Public" }],
      false,
    ],
  ])("reads %j as %s", (value: unknown, empty: boolean) => {
    expect(hasNoStatusPagePicked(value)).toBe(empty);
  });

  test("reads a list of ObjectIDs as picked", () => {
    expect(
      hasNoStatusPagePicked([
        new ObjectID("22222222-2222-4222-8222-222222222222"),
      ]),
    ).toBe(false);
  });
});
