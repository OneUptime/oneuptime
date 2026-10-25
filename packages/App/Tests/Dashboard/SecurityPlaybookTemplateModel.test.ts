import { describe, expect, test } from "@jest/globals";
import { SecurityPlaybookTemplateValues } from "Common/Types/SecurityPlaybook/SecurityPlaybookTemplates";
import {
  SECURITY_PLAYBOOK_TEMPLATES,
  SecurityPlaybookTemplate,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTemplates";
import {
  CREATE_FROM_TEMPLATE,
  PLAYBOOK_NOT_ADDED_TITLE,
  PLAYBOOK_TEMPLATES_DESCRIPTION,
  PLAYBOOK_TEMPLATES_TITLE,
  findPlaybookOfTemplate,
  getTemplateStepCount,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookTemplateModel";
import { TRANSLATED_LOCALES } from "../../FeatureSet/Dashboard/scripts/i18n/LocaleFiles";
import { isSaidInLocale, readDashboardLocale } from "./SecurityLocaleSentences";

/*
 * Security Events > Playbooks offers its templates in place of an empty
 * list, and from Create from Template once there are playbooks. A template
 * the project has a playbook of says Added, with View: these are the
 * React-free parts that decide it, and the words the picker shows.
 */

// A playbook as the model holds it: its name may be missing (exactOptionalPropertyTypes).
interface NamedPlaybook {
  name?: string;
  id: string;
}

const ENRICH: SecurityPlaybookTemplate = SECURITY_PLAYBOOK_TEMPLATES.find(
  (template: SecurityPlaybookTemplate): boolean => {
    return template.key === "enrich";
  },
)!;

describe("which templates the project has a playbook of", () => {
  test("a playbook with the template's name is the template's, whatever its case or spacing", () => {
    const playbooks: Array<NamedPlaybook> = [
      { id: "1", name: "Something else" },
      { id: "2", name: `  ${ENRICH.name.toUpperCase()} ` },
    ];

    expect(findPlaybookOfTemplate(playbooks, ENRICH)?.id).toBe("2");
  });

  test("a playbook named as the reader's language words the template is the template's too", () => {
    const playbooks: Array<NamedPlaybook> = [
      { id: "7", name: "Neue Fälle anreichern" },
    ];

    expect(findPlaybookOfTemplate(playbooks, ENRICH)).toBeUndefined();
    expect(
      findPlaybookOfTemplate(playbooks, ENRICH, ["Neue Fälle anreichern"])?.id,
    ).toBe("7");
  });

  test("no playbook of that name, no template's playbook", () => {
    expect(findPlaybookOfTemplate([], ENRICH)).toBeUndefined();
    const unnamed: Array<NamedPlaybook> = [{ id: "1" }];
    expect(findPlaybookOfTemplate(unnamed, ENRICH)).toBeUndefined();
  });

  test("each template is known by its own name only", () => {
    const playbooks: Array<NamedPlaybook> = SECURITY_PLAYBOOK_TEMPLATES.map(
      (template: SecurityPlaybookTemplate): NamedPlaybook => {
        return { id: template.key, name: template.name };
      },
    );

    for (const template of SECURITY_PLAYBOOK_TEMPLATES) {
      expect(findPlaybookOfTemplate(playbooks, template)?.id).toBe(
        template.key,
      );
    }
  });
});

describe("a template's facts", () => {
  test("its step count is its steps' whatever the project's priorities and statuses are", () => {
    const values: SecurityPlaybookTemplateValues = {
      priorityId: (): string => {
        return "11111111-1111-4111-8111-111111111111";
      },
      statusId: (): string => {
        return "22222222-2222-4222-8222-222222222222";
      },
    };

    for (const template of SECURITY_PLAYBOOK_TEMPLATES) {
      expect([template.key, getTemplateStepCount(template)]).toEqual([
        template.key,
        template.getSteps(values).length,
      ]);
      expect(getTemplateStepCount(template)).toBeGreaterThan(0);
    }
  });
});

describe("the picker's words", () => {
  test("are the sentences the Dashboard translates", () => {
    expect(PLAYBOOK_TEMPLATES_TITLE).toBe("Start from a template");
    expect(PLAYBOOK_TEMPLATES_DESCRIPTION).toBe(
      "Each template is a working playbook you can save as it is and change later.",
    );
    expect(CREATE_FROM_TEMPLATE).toBe("Create from Template");
    expect(PLAYBOOK_NOT_ADDED_TITLE).toBe("The playbook could not be added");
  });

  test("are in every Dashboard locale", () => {
    for (const locale of TRANSLATED_LOCALES) {
      const entries: Record<string, unknown> = readDashboardLocale(locale);

      for (const sentence of [
        PLAYBOOK_TEMPLATES_TITLE,
        PLAYBOOK_TEMPLATES_DESCRIPTION,
        CREATE_FROM_TEMPLATE,
        PLAYBOOK_NOT_ADDED_TITLE,
        "Add Playbook",
        "Create a blank playbook",
      ]) {
        expect([locale, sentence, typeof entries[sentence]]).toEqual([
          locale,
          sentence,
          "string",
        ]);
      }

      // The picker's own new words are said in the language.
      for (const sentence of ["Add Playbook", "Create a blank playbook"]) {
        expect([
          locale,
          sentence,
          isSaidInLocale(locale, sentence, entries[sentence]),
        ]).toEqual([locale, sentence, true]);
      }
    }
  });
});
