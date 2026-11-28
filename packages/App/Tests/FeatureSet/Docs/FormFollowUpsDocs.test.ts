import FormsCopy from "../../../FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import Form from "Common/Models/DatabaseModels/Form";
import { FORM_FOLLOW_UP_MAX_PEOPLE } from "Common/Types/Form/FormFollowUp";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Following Up on a Submission (Docs Content/<language>/forms/follow-ups),
 * against the product:
 *
 *   - the On Submit page's switch and the record card's buttons, named as
 *     the Dashboard draws them (FormsCopy);
 *   - the public page's own buttons, as its English locale draws them;
 *   - the most people one request can have (FORM_FOLLOW_UP_MAX_PEOPLE);
 *   - on for every new form, off for a form made before follow-ups existed:
 *     the model's default, and what the migration does to the forms there;
 *   - the card on the page of each record a form can create;
 *   - in every docs language, and linked from every other Forms page.
 *
 * The Dashboard's pages are React components, which App tests never
 * import: what they mount is read from their source.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Docs/Content",
);
const ACCOUNTS_ENGLISH_LOCALE_FILE: string = path.join(
  PACKAGES_DIR,
  "App/FeatureSet/Accounts/src/Locales/en.json",
);
const MIGRATION_FILE: string = path.join(
  PACKAGES_DIR,
  "Common/Server/Infrastructure/Postgres/SchemaMigrations/1809188000000-AddFormFollowUps.ts",
);
const RECORD_PAGES: Array<string> = [
  "Incidents/View/Index.tsx",
  "Alerts/View/Index.tsx",
  "ScheduledMaintenanceEvents/View/Index.tsx",
];

const PAGE: string = "forms/follow-ups";
const OTHER_FORMS_PAGES: Array<string> = [
  "forms/index",
  "forms/building",
  "forms/on-submit",
  "forms/sharing-and-security",
];

const readPage: (page: string, language?: string) => string = (
  page: string,
  language?: string,
): string => {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language || "en", `${page}.md`),
    "utf8",
  );
};

const english: string = readPage(PAGE);

// A heading that ends a section of the page: a title, or another section.
const SECTION_HEADING: RegExp = /^#{1,2} /;

// A section's text: from its heading to the next heading of its level or above.
const sectionOf: (title: string) => string = (title: string): string => {
  const lines: Array<string> = english.split("\n");
  const start: number = lines.indexOf(`## ${title}`);

  expect({ title, found: start >= 0 }).toEqual({ title, found: true });

  const end: number = lines.findIndex((line: string, index: number) => {
    return index > start && SECTION_HEADING.test(line);
  });

  return lines.slice(start, end < 0 ? undefined : end).join("\n");
};

const publicPageCopy: () => Record<string, string> = (): Record<
  string,
  string
> => {
  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(ACCOUNTS_ENGLISH_LOCALE_FILE, "utf8"),
  ) as Record<string, unknown>;

  return locale["formFollowUp"] as Record<string, string>;
};

describe("Following Up on a Submission", () => {
  it("names the On Submit page's switch as the Dashboard draws it", () => {
    expect(sectionOf("Turn follow-ups on")).toContain(
      `switch **${FormsCopy.followUpsToggle}** on`,
    );
    expect(english).toContain(`With **${FormsCopy.followUpsToggle}** on`);
  });

  it("names the record card and its buttons as the card draws them", () => {
    const section: string = sectionOf("Reply from the record's page");

    expect(section).toContain(`a **${FormsCopy.followUpRecordTitle}** card`);
    expect(section).toContain(`**${FormsCopy.followUpSendReply}**`);
    expect(section).toContain(`**${FormsCopy.followUpAddPerson}**`);
    expect(section).toContain(`**${FormsCopy.followUpRemovePerson}**`);
  });

  it("names the public page's buttons as the page draws them", () => {
    const copy: Record<string, string> = publicPageCopy();

    expect(sectionOf("What the person who submits gets")).toContain(
      `**${copy["openRequest"]}**`,
    );
    expect(sectionOf("What the person who submits gets")).toContain(
      `**${copy["stopFollowing"]}**`,
    );
    expect(sectionOf("Who can open a request")).toContain(
      `**${copy["myRequests"]}**`,
    );
  });

  it("states the most people one request can have", () => {
    expect(sectionOf("What the person who submits gets")).toContain(
      `A request can have at most ${FORM_FOLLOW_UP_MAX_PEOPLE} people following it.`,
    );
  });

  it("says follow-ups are on for a new form, and off for one made before, as the model and the migration have it", () => {
    expect(sectionOf("Turn follow-ups on")).toContain(
      "Follow-ups are on for every new form; a form made before they existed has them off until you turn them on.",
    );

    // A new form's default.
    expect(
      new Form().getTableColumnMetadata("enableFollowUps").defaultValue,
    ).toBe(true);

    // The forms already there: the column is added as false, then given its default.
    const migration: string = fs.readFileSync(MIGRATION_FILE, "utf8");

    expect(migration).toContain(
      'ALTER TABLE "Form" ADD "enableFollowUps" boolean NOT NULL DEFAULT false',
    );
    expect(migration).toContain(
      'ALTER TABLE "Form" ALTER COLUMN "enableFollowUps" SET DEFAULT true',
    );
  });

  it("puts the card on the page of every record a form can create", () => {
    expect(english).toContain(
      "the page of the incident, alert or maintenance event the form created",
    );

    for (const page of RECORD_PAGES) {
      const source: string = fs.readFileSync(
        path.join(PACKAGES_DIR, "App/FeatureSet/Dashboard/src/Pages", page),
        "utf8",
      );

      expect({
        page,
        mounted: source.includes("<FormFollowUpRecordCard"),
      }).toEqual({ page, mounted: true });
    }
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "is written in %s, and every other Forms page links to it",
    (language: string) => {
      expect(
        fs.existsSync(path.join(CONTENT_DIR, language, `${PAGE}.md`)),
      ).toBe(true);

      for (const page of OTHER_FORMS_PAGES) {
        expect({
          language,
          page,
          linked: readPage(page, language).includes(`](/docs/${PAGE})`),
        }).toEqual({ language, page, linked: true });
      }
    },
  );
});
