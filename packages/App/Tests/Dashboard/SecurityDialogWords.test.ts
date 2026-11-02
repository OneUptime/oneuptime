import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  Translator,
  createTranslator,
} from "Common/UI/Utils/TranslateTemplate";
import {
  SECURITY_CASE_FORM_STEPS,
  getSecurityCaseFormFields,
} from "../../FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseFormFields";
import {
  EDIT_STEP_TITLE,
  getStepDialogWords,
} from "../../FeatureSet/Dashboard/src/Components/SecurityPlaybook/SecurityPlaybookStepForm";

/*
 * The words of Security Events' dialogs, in every Dashboard language.
 *
 * The UI review of #5330 found English on them in every language:
 *
 * - Open Security Case drew "What the case is about, in a line." under
 *   Title and "Labels to filter and report on cases by." under Labels -
 *   its columns' descriptions, which a form shows in place of its own
 *   (ColumnDescriptionOnForm) and no locale holds. Edit Case drew all of
 *   its fields' columns' words, "ID of the person working the case." under
 *   Assign To among them. Both dialogs are one form now
 *   (SecurityCaseFormFields), every field in words of its own.
 * - A playbook step's dialog was titled "Edit Step 4", joined from English
 *   pieces, over "Add a note: Write a note on the case: ...". It is named
 *   by the step's place and what it does, as a run lists its steps.
 * - A message's help said "Markdown; a summary of the case when empty." -
 *   leave it empty, and a summary of the case is sent.
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

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".json") && name !== "en.json";
  })
  .map((name: string): string => {
    return name.replace(".json", "");
  })
  .sort();

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function translatorFor(language: string): Translator {
  const values: Record<string, string> = locale(language);

  return createTranslator((text: string): string | undefined => {
    return values[text];
  }, language);
}

interface FormFieldWords {
  title: string;
  description: string;
}

function fieldWords(
  fields: ReturnType<typeof getSecurityCaseFormFields>,
): Array<FormFieldWords> {
  return fields.map((field: { title?: string; description?: unknown }) => {
    return {
      title: field.title || "",
      description:
        typeof field.description === "string" ? field.description : "",
    };
  });
}

const OPEN_CASE_FIELDS: Array<FormFieldWords> = fieldWords(
  getSecurityCaseFormFields({
    priorityOptions: [{ label: "High", value: "high" }],
  }),
);

const EDIT_CASE_FIELDS: Array<FormFieldWords> = fieldWords(
  getSecurityCaseFormFields(),
);

// The message's help, reworded so it says what an empty message does.
const MESSAGE_LEAD: string =
  "Markdown. Leave it empty to send a summary of the case. These fill in from the case:";

const NOTE: SecurityPlaybookActionDefinition = getSecurityPlaybookAction(
  SecurityPlaybookActionType.AddCaseNote,
)!;

describe("a case's form", () => {
  test("Open Security Case asks what the case is, how urgent, then who works it", () => {
    expect(SECURITY_CASE_FORM_STEPS).toEqual([
      { title: "Case", id: "case" },
      { title: "Assignment", id: "assignment" },
    ]);
    expect(OPEN_CASE_FIELDS).toEqual([
      { title: "Title", description: "What the case is about, in a line." },
      {
        title: "Description",
        description: "What prompted this case, and what to look at first.",
      },
      { title: "Priority", description: "How urgent the case is." },
      { title: "Assign To", description: "The person working the case." },
      { title: "Team", description: "The team the case belongs to." },
      {
        title: "Labels",
        description: "Labels to filter and report on cases by.",
      },
    ]);
  });

  test("Edit Case asks the same, in the same words, the priority left to Set priority", () => {
    expect(EDIT_CASE_FIELDS).toEqual(
      OPEN_CASE_FIELDS.filter((field: FormFieldWords): boolean => {
        return field.title !== "Priority";
      }),
    );
  });

  test("each field's words are its own: never a column's for the API, never an Optional. lead", () => {
    for (const field of OPEN_CASE_FIELDS) {
      expect(field.description.length).toBeGreaterThan(0);
      expect(field.description.startsWith("ID of")).toBe(false);
      expect(field.description.startsWith("Optional")).toBe(false);
    }
  });

  test.each(LANGUAGES)(
    "%s words every field and its description",
    (language: string) => {
      const values: Record<string, string> = locale(language);

      for (const field of OPEN_CASE_FIELDS) {
        for (const words of [field.title, field.description]) {
          expect({ words, worded: Boolean(values[words]) }).toEqual({
            words,
            worded: true,
          });
        }

        expect({
          words: field.description,
          isEnglish: values[field.description] === field.description,
        }).toEqual({ words: field.description, isEnglish: false });
      }
    },
  );
});

describe("a playbook step's dialog", () => {
  test("names the step being changed by its place and what it does", () => {
    const english: Translator = createTranslator(undefined, "en");

    expect(EDIT_STEP_TITLE).toBe("Edit Step {{number}}: {{title}}");
    expect(
      getStepDialogWords({
        definition: NOTE,
        index: 3,
        isNew: false,
        translator: english,
      }),
    ).toEqual({
      title: "Edit Step 4: Add a note",
      description:
        "Write a note on the case: context for the analyst, a reminder, or what to check first.",
    });
  });

  test("a new step has its action still to pick", () => {
    expect(
      getStepDialogWords({
        definition: undefined,
        index: 0,
        isNew: true,
        translator: createTranslator(undefined, "en"),
      }),
    ).toEqual({
      title: "Add Step",
      description: "Pick what the step does, then fill in its settings.",
    });
  });

  test("German and Persian name the step in their own words and digits", () => {
    expect(
      getStepDialogWords({
        definition: NOTE,
        index: 3,
        isNew: false,
        translator: translatorFor("de"),
      }),
    ).toEqual({
      title: "Schritt 4 bearbeiten: Notiz hinzufügen",
      description: locale("de")[NOTE.description],
    });

    const persian: { title: string; description: string } = getStepDialogWords({
      definition: NOTE,
      index: 3,
      isNew: false,
      translator: translatorFor("fa"),
    });

    expect(persian.title).toBe(
      `ویرایش گام ۴: ${locale("fa")[NOTE.title] || ""}`,
    );
    expect(persian.description).toBe(locale("fa")[NOTE.description]);
  });

  test.each(LANGUAGES)(
    "%s words the step's title and the message's help",
    (language: string) => {
      const values: Record<string, string> = locale(language);
      const title: string | undefined = values[EDIT_STEP_TITLE];
      const lead: string | undefined = values[MESSAGE_LEAD];

      expect(title).toBeDefined();
      expect(title).not.toBe(EDIT_STEP_TITLE);
      expect(title).toContain("{{number}}");
      expect(title).toContain("{{title}}");

      expect(lead).toBeDefined();
      expect(lead).not.toBe(MESSAGE_LEAD);
      expect(lead).toContain("Markdown");
    },
  );

  test("the message's help is the dialog's, and its old words are in no locale", () => {
    const dialog: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "SecurityPlaybook",
        "SecurityPlaybookStepDialog.tsx",
      ),
      "utf8",
    );

    expect(dialog).toContain(`"${MESSAGE_LEAD}"`);
    expect(dialog).toContain("getStepDialogWords({");
    expect(dialog).not.toContain("`Edit Step ${");

    for (const language of ["en", ...LANGUAGES]) {
      expect({
        language,
        isKept:
          "Markdown; a summary of the case when empty. These fill in from the case:" in
          locale(language),
      }).toEqual({ language, isKept: false });
    }
  });
});
