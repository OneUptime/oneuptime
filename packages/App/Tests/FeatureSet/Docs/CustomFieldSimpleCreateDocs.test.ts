import {
  CustomFieldFormCopy,
  IncidentCustomFieldSettingsCopy,
  MAPPED_CUSTOM_FIELD_SOURCE_COPY,
} from "../../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldSettingsCopy";
import slugify from "Common/Server/Types/MarkdownSlugify";
import CustomFieldMappingSourceResource from "Common/Types/CustomField/CustomFieldMappingSourceResource";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The incident custom field docs, after the form was made simple: "The only
 * thing I should see by default is: field name, field description, type."
 *
 * The settings page's docs must say what the form now does - three fields
 * on one page, the rest under a collapsed Advanced, a field copied from a
 * monitor made from the card's More menu - in the names the dashboard shows
 * (the shared copy), in English and in Persian, and the link to the new
 * section must land on its heading.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LANGUAGES: ReadonlyArray<string> = ["en", "fa"];

const CUSTOM_FIELDS_SECTION: Record<string, string> = {
  en: "Custom fields",
  fa: "فیلدهای سفارشی",
};

const MAPPED_SECTION: Record<string, string> = {
  en: "Fields copied from a monitor",
  fa: "فیلدهای کپی‌شده از مانیتور",
};

const HEADING: RegExp = /^(#{1,6}) (.*)$/;

function readSettingsPage(language: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "incidents", "settings.md"),
    "utf8",
  );
}

// The heading with this text and everything under it, to the next heading of its level.
function sectionOf(markdown: string, headingText: string): string {
  const lines: Array<string> = markdown.split("\n");
  let start: number = -1;
  let level: number = 0;

  for (let index: number = 0; index < lines.length; index++) {
    const match: RegExpMatchArray | null = (lines[index] as string).match(
      HEADING,
    );

    if (!match) {
      continue;
    }

    const lineLevel: number = (match[1] as string).length;
    const text: string = (match[2] as string).replace(/^‏/, "").trim();

    if (start === -1) {
      if (text === headingText) {
        start = index;
        level = lineLevel;
      }
      continue;
    }

    if (lineLevel <= level) {
      return lines.slice(start, index).join("\n");
    }
  }

  expect({ heading: headingText, found: start !== -1 }).toEqual({
    heading: headingText,
    found: true,
  });

  return lines.slice(start).join("\n");
}

function boldText(markdown: string): Set<string> {
  return new Set<string>(
    Array.from(markdown.matchAll(/\*\*([^*\n]+)\*\*/g)).map(
      (match: RegExpMatchArray): string => {
        return match[1] as string;
      },
    ),
  );
}

describe("the incident custom field docs describe the simple form", () => {
  test.each(LANGUAGES)(
    "%s: names the form's three fields, Advanced and Configured",
    (language: string) => {
      const names: Set<string> = boldText(
        sectionOf(
          readSettingsPage(language),
          CUSTOM_FIELDS_SECTION[language] as string,
        ),
      );

      for (const name of [
        "Field Name",
        "Field Description",
        "Field Type",
        MORE_FIELDS_SECTION_TITLE,
        "Configured",
        CustomFieldFormCopy.createMappedFieldTitle,
        "Create Incident Custom Field",
      ]) {
        expect({ language, name, named: names.has(name) }).toEqual({
          language,
          name,
          named: true,
        });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: puts every incident setting under Advanced",
    (language: string) => {
      const section: string = sectionOf(
        readSettingsPage(language),
        CUSTOM_FIELDS_SECTION[language] as string,
      );
      const under: string =
        language === "en" ? "under **Advanced**" : "زیر **Advanced**";

      for (const setting of [
        IncidentCustomFieldSettingsCopy.showOnCreateTitle,
        IncidentCustomFieldSettingsCopy.isRequiredOnCreateTitle,
        IncidentCustomFieldSettingsCopy.includeInSubscriberNotificationsTitle,
      ]) {
        const bullet: string | undefined = section
          .split("\n")
          .find((line: string): boolean => {
            return line.startsWith(`- **${setting}** — `);
          });

        expect({ language, setting, bullet: Boolean(bullet) }).toEqual({
          language,
          setting,
          bullet: true,
        });
        expect(bullet).toContain(under);
      }
    },
  );

  test.each(LANGUAGES)(
    "%s: has a section on fields copied from a monitor, naming the dialog's fields",
    (language: string) => {
      const section: string = sectionOf(
        readSettingsPage(language),
        MAPPED_SECTION[language] as string,
      );
      const names: Set<string> = boldText(section);

      for (const name of [
        CustomFieldFormCopy.createMappedFieldTitle,
        MAPPED_CUSTOM_FIELD_SOURCE_COPY[
          CustomFieldMappingSourceResource.Monitor
        ].sourceFieldTitle,
        "Field Name",
        "Field Description",
        CustomFieldFormCopy.mapValueFromTitle,
        MORE_FIELDS_SECTION_TITLE,
        "Edit",
      ]) {
        expect({ language, name, named: names.has(name) }).toEqual({
          language,
          name,
          named: true,
        });
      }

      // A level-3 heading inside Custom fields, in both languages.
      expect(section.startsWith("### ")).toBe(true);
    },
  );

  test.each(LANGUAGES)(
    "%s: the link to that section lands on its heading",
    (language: string) => {
      const markdown: string = readSettingsPage(language);
      const slug: string = slugify(MAPPED_SECTION[language] as string);

      expect(markdown).toContain(`](#${slug})`);

      const headings: Array<string> = markdown
        .split("\n")
        .map((line: string): string | null => {
          const match: RegExpMatchArray | null = line.match(HEADING);
          return match ? slugify(match[2] as string) : null;
        })
        .filter((value: string | null): value is string => {
          return value !== null;
        });

      expect(headings).toContain(slug);
    },
  );

  test("still says the list shows the name and type, and Edit opens the rest", () => {
    const section: string = sectionOf(
      readSettingsPage("en"),
      CUSTOM_FIELDS_SECTION["en"] as string,
    );

    expect(section).toContain(
      "each by its **Field Name** and **Field Type** alone. **Edit** on a field's row opens the rest of its settings.",
    );
    // A new field's values are typed in: no "Map Value From" on Create.
    expect(section).toContain("A new field's values are typed in.");
  });
});

/*
 * The same change elsewhere: an LLM provider's Set as Default and Additional
 * Parameters left a wizard step of their own for a collapsed Advanced
 * section, and its docs say where they are now.
 */
describe("the LLM provider docs say what is under Advanced", () => {
  test.each(LANGUAGES)("%s", (language: string) => {
    const markdown: string = fs.readFileSync(
      path.join(CONTENT_DIR, language, "ai", "llm-provider.md"),
      "utf8",
    );

    const bullet: string | undefined = markdown
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith(`- **${MORE_FIELDS_SECTION_TITLE}**`);
      });

    expect(bullet).toBeDefined();
    expect(bullet).toContain("**Set as Default**");
    expect(bullet).toContain("**Additional Parameters**");
  });
});
