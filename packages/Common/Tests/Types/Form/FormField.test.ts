import { parseCustomFieldDropdownOptions } from "../../../Types/CustomField/CustomFieldDropdownOption";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import {
  FORM_CHOICE_QUESTION_TYPES,
  FORM_FIELD_HELP_TEXT_MAX_LENGTH,
  FORM_FIELD_LABEL_MAX_LENGTH,
  FORM_FIELD_MAX_ALLOWED_OPTIONS,
  FORM_MAX_FIELDS,
  FORM_QUESTION_MAX_OPTIONS,
  FORM_QUESTION_OPTION_MAX_LENGTH,
  FORM_QUESTION_TYPES,
  FORM_SUBMITTER_FIELDS,
  FORM_SUBMITTER_FIELD_DEFINITIONS,
  FormField,
  FormFieldSource,
  FormSubmitterField,
  convertFormFieldsForTarget,
  createCustomFieldField,
  createQuestionField,
  createSubmitterField,
  createTargetField,
  describeFormField,
  findCustomFieldField,
  findSubmitterField,
  findTargetField,
  generateFormFieldId,
  getDefaultFormFields,
  getDefaultQuestionOptions,
  isFormFieldId,
  readFormFields,
  translateFormFieldDefaults,
  validateFormFields,
} from "../../../Types/Form/FormField";
import {
  FormTargetFieldDefinition,
  getFormTargetField,
  getFormTargetFields,
} from "../../../Types/Form/FormTargetCatalog";
import FormTargetType, {
  FORM_TARGET_TYPES,
} from "../../../Types/Form/FormTargetType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Form.fields: the questions a form asks, in order - the form builder's
 * output, the public page's input, and what the server checks before it
 * stores them (validateFormFields) or reads them back (readFormFields).
 *
 * What matters most here:
 *
 *   - the strict check refuses everything a public page could not ask, with
 *     a message that names the question and the problem - from the builder,
 *     the API, Terraform or a workflow alike;
 *   - the lenient reader never throws on what is stored, and keeps only
 *     what it can use;
 *   - a new form, and a form whose target changes, are always valid;
 *   - nothing here changes what it is handed.
 */

const SEVERITY_ID: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";
const CUSTOM_FIELD_ID: string = "33333333-3333-4333-8333-333333333333";

type DeepFreezeFunction = <T>(value: T) => T;

const deepFreeze: DeepFreezeFunction = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
};

type QuestionFunction = (overrides?: Record<string, unknown>) => Record<
  string,
  unknown
>;

const question: QuestionFunction = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  return {
    id: "q1",
    source: FormFieldSource.Question,
    label: "Which office are you in?",
    isRequired: false,
    type: CustomFieldType.Text,
    ...overrides,
  };
};

type ValidateFunction = (
  value: unknown,
  targetType?: FormTargetType,
) => string | null;

const validate: ValidateFunction = (
  value: unknown,
  targetType: FormTargetType = FormTargetType.Incident,
): string | null => {
  return validateFormFields({ value, targetType });
};

describe("question ids", () => {
  test("a generated id is a fresh UUID every time, and a valid id", () => {
    const first: string = generateFormFieldId();
    const second: string = generateFormFieldId();

    expect(first).not.toBe(second);
    expect(isFormFieldId(first)).toBe(true);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test.each([
    ["q1", true],
    ["A", true],
    ["what_broke", true],
    ["what-broke-2", true],
    ["0", true],
    ["a".repeat(64), true],
    ["a".repeat(65), false],
    ["", false],
    ["-starts-with-a-dash", false],
    ["_starts_with_underscore", false],
    ["has space", false],
    ["has.dot", false],
    ["ümlaut", false],
    ["__proto__", false],
    [42, false],
    [null, false],
    [undefined, false],
  ])("isFormFieldId(%p) is %p", (value: unknown, expected: boolean) => {
    expect(isFormFieldId(value)).toBe(expected);
  });
});

describe("the constants", () => {
  test("are the limits the docs and the public page state", () => {
    expect(FORM_MAX_FIELDS).toBe(50);
    expect(FORM_FIELD_LABEL_MAX_LENGTH).toBe(200);
    expect(FORM_FIELD_HELP_TEXT_MAX_LENGTH).toBe(1000);
    expect(FORM_QUESTION_MAX_OPTIONS).toBe(100);
    expect(FORM_FIELD_MAX_ALLOWED_OPTIONS).toBe(100);
  });

  test("a question of the form's own has the nine types the palette offers, two of them choices", () => {
    expect(FORM_QUESTION_TYPES).toEqual([
      CustomFieldType.Text,
      CustomFieldType.LongText,
      CustomFieldType.Markdown,
      CustomFieldType.Number,
      CustomFieldType.Dropdown,
      CustomFieldType.MultiSelectDropdown,
      CustomFieldType.Boolean,
      CustomFieldType.Date,
      CustomFieldType.DateTime,
    ]);
    expect(FORM_CHOICE_QUESTION_TYPES).toEqual([
      CustomFieldType.Dropdown,
      CustomFieldType.MultiSelectDropdown,
    ]);
  });

  test("the submitter is asked for a name and an email, with these words", () => {
    expect(FORM_SUBMITTER_FIELDS).toEqual([
      FormSubmitterField.Name,
      FormSubmitterField.Email,
    ]);
    expect(FORM_SUBMITTER_FIELD_DEFINITIONS).toEqual({
      Name: {
        field: FormSubmitterField.Name,
        title: "Name",
        description: "Who is submitting. Kept with the submission.",
        defaultLabel: "Your Name",
      },
      Email: {
        field: FormSubmitterField.Email,
        title: "Email",
        description: "How to reach the submitter. Kept with the submission.",
        defaultLabel: "Your Email",
      },
    });
  });

  test("the stored values of the sources never change", () => {
    expect(Object.values(FormFieldSource)).toEqual([
      "Question",
      "TargetField",
      "TargetCustomField",
      "Submitter",
    ]);
  });
});

describe("describeFormField: how a problem names its question", () => {
  test("by its position, counted from one", () => {
    expect(describeFormField({ index: 0 })).toBe("Question 1");
    expect(describeFormField({ index: 4, label: "   " })).toBe("Question 5");
    expect(describeFormField({ index: 2, label: 7 })).toBe("Question 3");
  });

  test("and by its label, cut to 60 characters", () => {
    expect(describeFormField({ index: 1, label: "  What broke?  " })).toBe(
      'Question 2 ("What broke?")',
    );
    expect(describeFormField({ index: 0, label: "x".repeat(100) })).toBe(
      `Question 1 ("${"x".repeat(60)}")`,
    );
  });
});

describe("validateFormFields: what can be stored", () => {
  test("nothing at all is fine: the server fills in a new form's questions", () => {
    expect(validate(null)).toBeNull();
    expect(validate(undefined)).toBeNull();
  });

  test("an empty list is fine for an incident form", () => {
    expect(validate([])).toBeNull();
  });

  test.each([["a string", "fields"], ["an object", {}], ["a number", 3]])(
    "%s is refused",
    (_label: string, value: unknown) => {
      expect(validate(value)).toBe("Fields must be a list of questions.");
    },
  );

  test("more questions than a form can have are refused before anything else", () => {
    const fields: Array<Record<string, unknown>> = [];

    for (let index: number = 0; index <= FORM_MAX_FIELDS; index++) {
      fields.push(question({ id: `q${index}` }));
    }

    expect(validate(fields)).toBe(
      `A form cannot have more than ${FORM_MAX_FIELDS} questions.`,
    );
    expect(validate(fields.slice(0, FORM_MAX_FIELDS))).toBeNull();
  });

  test("a default form of every target is valid", () => {
    for (const target of FORM_TARGET_TYPES) {
      expect(validate(getDefaultFormFields(target), target)).toBeNull();
    }
  });

  describe("every question", () => {
    test("must be an object", () => {
      expect(validate([null, "x", ["y"]])).toBe(
        "Question 1 must be an object. Question 2 must be an object. Question 3 must be an object.",
      );
    });

    test.each([[undefined], [""], ["has space"], ["a".repeat(65)], [12]])(
      "needs an id it can be keyed by (%p)",
      (id: unknown) => {
        expect(validate([question({ id })])).toBe(
          'Question 1 ("Which office are you in?") needs an id of letters, digits, "-" and "_", starting with a letter or digit, at most 64 characters.',
        );
      },
    );

    test("ids are unique", () => {
      expect(validate([question(), question({ label: "Again" })])).toBe(
        'Question 2 ("Again") has the same id as another question.',
      );
    });

    test("must have a known source", () => {
      expect(validate([question({ source: "Banana" })])).toBe(
        'Question 1 ("Which office are you in?") must have one of these sources: Question, TargetField, TargetCustomField, Submitter.',
      );
    });

    test.each([[undefined], [""], ["   "], [5]])(
      "needs a label (%p)",
      (label: unknown) => {
        expect(validate([question({ label })])).toBe(
          "Question 1 needs a label.",
        );
      },
    );

    test("a label of up to 200 characters, not counting the spaces around it", () => {
      expect(
        validate([
          question({ label: `  ${"x".repeat(FORM_FIELD_LABEL_MAX_LENGTH)}  ` }),
        ]),
      ).toBeNull();
      expect(
        validate([
          question({ label: "x".repeat(FORM_FIELD_LABEL_MAX_LENGTH + 1) }),
        ]),
      ).toBe(
        `Question 1 ("${"x".repeat(60)}"): the label cannot be more than 200 characters.`,
      );
    });

    test("help text is optional text of up to 1,000 characters", () => {
      expect(validate([question({ helpText: null })])).toBeNull();
      expect(validate([question({ helpText: "Where you work." })])).toBeNull();
      expect(
        validate([
          question({
            helpText: "x".repeat(FORM_FIELD_HELP_TEXT_MAX_LENGTH),
          }),
        ]),
      ).toBeNull();
      expect(validate([question({ helpText: 7 })])).toBe(
        'Question 1 ("Which office are you in?"): the help text must be text.',
      );
      expect(
        validate([
          question({
            helpText: "x".repeat(FORM_FIELD_HELP_TEXT_MAX_LENGTH + 1),
          }),
        ]),
      ).toBe(
        'Question 1 ("Which office are you in?"): the help text cannot be more than 1000 characters.',
      );
    });

    test("Required is true or false, or left out", () => {
      expect(validate([question({ isRequired: undefined })])).toBeNull();
      expect(validate([question({ isRequired: true })])).toBeNull();
      expect(validate([question({ isRequired: "yes" })])).toBe(
        'Question 1 ("Which office are you in?"): Required must be true or false.',
      );
    });
  });

  describe("a question of the form's own", () => {
    test.each(FORM_QUESTION_TYPES.map((type: CustomFieldType) => {
      return [type];
    }))("can be a %s", (type: CustomFieldType) => {
      expect(
        validate([
          question({
            type,
            dropdownOptions: FORM_CHOICE_QUESTION_TYPES.includes(type)
              ? "Berlin\nLondon"
              : undefined,
          }),
        ]),
      ).toBeNull();
    });

    test.each([[undefined], ["Banana"], [CustomFieldType.URL], [3]])(
      "not of another type (%p)",
      (type: unknown) => {
        expect(validate([question({ type })])).toBe(
          `Question 1 ("Which office are you in?") must have one of these types: ${FORM_QUESTION_TYPES.join(", ")}.`,
        );
      },
    );

    test("a dropdown needs an option", () => {
      for (const dropdownOptions of [undefined, "", "\n\n"]) {
        expect(
          validate([
            question({ type: CustomFieldType.Dropdown, dropdownOptions }),
          ]),
        ).toBe(
          'Question 1 ("Which office are you in?") needs at least one option to choose from.',
        );
      }
    });

    test("a multi-select's options are text", () => {
      expect(
        validate([
          question({
            type: CustomFieldType.MultiSelectDropdown,
            dropdownOptions: ["Berlin"],
          }),
        ]),
      ).toBe('Question 1 ("Which office are you in?"): its options must be text.');
    });

    test("options in the colored JSON format are read like the custom fields' own", () => {
      expect(
        validate([
          question({
            type: CustomFieldType.Dropdown,
            dropdownOptions: JSON.stringify([
              { value: "Berlin", color: "#ff0000" },
              { value: "London" },
            ]),
          }),
        ]),
      ).toBeNull();
    });

    test("at most 100 options, each of at most 100 characters, each once", () => {
      const options: Array<string> = [];

      for (let index: number = 0; index <= FORM_QUESTION_MAX_OPTIONS; index++) {
        options.push(`Office ${index}`);
      }

      expect(
        validate([
          question({
            type: CustomFieldType.Dropdown,
            dropdownOptions: options.join("\n"),
          }),
        ]),
      ).toBe(
        'Question 1 ("Which office are you in?") cannot have more than 100 options.',
      );

      expect(
        validate([
          question({
            type: CustomFieldType.Dropdown,
            dropdownOptions: `Berlin\n${"x".repeat(FORM_QUESTION_OPTION_MAX_LENGTH + 1)}`,
          }),
        ]),
      ).toBe(
        'Question 1 ("Which office are you in?"): an option cannot be more than 100 characters.',
      );

      expect(
        validate([
          question({
            type: CustomFieldType.Dropdown,
            dropdownOptions: "Berlin\nLondon\nBerlin",
          }),
        ]),
      ).toBe('Question 1 ("Which office are you in?") lists the same option twice.');
    });

    test("options on a question that is not a choice are ignored", () => {
      expect(
        validate([
          question({ type: CustomFieldType.Number, dropdownOptions: 7 }),
        ]),
      ).toBeNull();
    });
  });

  describe("a question linked to a field of what the form creates", () => {
    type LinkedFunction = (
      targetField: unknown,
      extra?: Record<string, unknown>,
    ) => Record<string, unknown>;

    const linked: LinkedFunction = (
      targetField: unknown,
      extra: Record<string, unknown> = {},
    ): Record<string, unknown> => {
      return {
        id: "linked",
        source: FormFieldSource.TargetField,
        label: "Linked",
        isRequired: false,
        targetField,
        ...extra,
      };
    };

    test("names a field the target has, and the message lists the ones it does", () => {
      expect(validate([linked("severity")])).toBe(
        'Question 1 ("Linked") is linked to a field an incident does not have. Fields it can be linked to: title, description, incidentSeverityId, monitors, labels, impactStartedAt.',
      );
      expect(
        validate([linked("incidentSeverityId")], FormTargetType.ScheduledMaintenance),
      ).toContain(
        "is linked to a field a scheduled maintenance event does not have. Fields it can be linked to: title, description, startsAt, endsAt, monitors, statusPages, labels.",
      );
    });

    test("a field typed in takes no allowed options", () => {
      expect(validate([linked("title", { allowedOptionIds: [] })])).toBeNull();
      expect(validate([linked("title", { allowedOptionIds: null })])).toBeNull();
      expect(
        validate([linked("title", { allowedOptionIds: [SEVERITY_ID] })]),
      ).toBe(
        'Question 1 ("Linked"): Title is not answered by choosing, so it takes no allowed options.',
      );
    });

    test("the allowed options are a list of record ids", () => {
      expect(
        validate([
          linked("incidentSeverityId", { allowedOptionIds: SEVERITY_ID }),
        ]),
      ).toBe('Question 1 ("Linked"): the allowed options must be a list.');
      expect(
        validate([
          linked("incidentSeverityId", { allowedOptionIds: ["critical"] }),
        ]),
      ).toBe('Question 1 ("Linked"): every allowed option must be an id.');
      expect(
        validate([linked("incidentSeverityId", { allowedOptionIds: [7] })]),
      ).toBe('Question 1 ("Linked"): every allowed option must be an id.');
      expect(
        validate([
          linked("incidentSeverityId", {
            allowedOptionIds: [SEVERITY_ID.toUpperCase()],
          }),
        ]),
      ).toBeNull();
    });

    test("at most 100 allowed options", () => {
      const ids: Array<string> = [];

      for (
        let index: number = 0;
        index <= FORM_FIELD_MAX_ALLOWED_OPTIONS;
        index++
      ) {
        ids.push(
          `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
        );
      }

      expect(
        validate([linked("monitors", { allowedOptionIds: ids })]),
      ).toBe('Question 1 ("Linked") cannot offer more than 100 options.');
      expect(
        validate([
          linked("monitors", {
            allowedOptionIds: ids.slice(0, FORM_FIELD_MAX_ALLOWED_OPTIONS),
          }),
        ]),
      ).toBeNull();
    });

    test("a public page lists only the monitors, labels or status pages chosen for it", () => {
      expect(validate([linked("monitors")])).toBe(
        'Question 1 ("Linked"): choose which monitors the form offers. A public form only lists the ones you choose.',
      );
      expect(validate([linked("labels", { allowedOptionIds: [] })])).toBe(
        'Question 1 ("Linked"): choose which labels the form offers. A public form only lists the ones you choose.',
      );
      // (A maintenance form must also ask when it starts and ends.)
      expect(
        validate(
          [linked("statusPages")],
          FormTargetType.ScheduledMaintenance,
        ),
      ).toContain(
        'Question 1 ("Linked"): choose which status pages the form offers. A public form only lists the ones you choose.',
      );
      expect(
        validate([linked("monitors", { allowedOptionIds: [MONITOR_ID] })]),
      ).toBeNull();
    });

    test("the severity may offer every one: none chosen is fine", () => {
      expect(validate([linked("incidentSeverityId")])).toBeNull();
    });

    test("each field is asked once", () => {
      expect(
        validate([
          linked("title"),
          { ...linked("title"), id: "linked-2", label: "Again" },
        ]),
      ).toBe('Question 2 ("Again") asks for a field another question already asks.');
    });
  });

  describe("a question linked to a custom field", () => {
    test("names it by its id", () => {
      for (const customFieldId of [undefined, "", "impact", 4]) {
        expect(
          validate([
            {
              id: "cf",
              source: FormFieldSource.TargetCustomField,
              label: "Impact",
              isRequired: false,
              customFieldId,
            },
          ]),
        ).toBe('Question 1 ("Impact") must name a custom field by its id.');
      }
    });

    test("asks each custom field once, whatever the id's case", () => {
      expect(
        validate([
          {
            id: "cf1",
            source: FormFieldSource.TargetCustomField,
            label: "Impact",
            isRequired: false,
            customFieldId: CUSTOM_FIELD_ID,
          },
          {
            id: "cf2",
            source: FormFieldSource.TargetCustomField,
            label: "Impact again",
            isRequired: false,
            customFieldId: CUSTOM_FIELD_ID.toUpperCase(),
          },
        ]),
      ).toBe(
        'Question 2 ("Impact again") asks for a custom field another question already asks.',
      );
    });
  });

  describe("a question about the submitter", () => {
    test("asks for the name or the email", () => {
      expect(
        validate([
          {
            id: "who",
            source: FormFieldSource.Submitter,
            label: "Who are you?",
            isRequired: false,
            submitterField: "Phone",
          },
        ]),
      ).toBe('Question 1 ("Who are you?") must ask for the submitter\'s name or email.');
    });

    test("each once", () => {
      expect(
        validate([
          createSubmitterField({
            submitterField: FormSubmitterField.Email,
            id: "e1",
          }),
          createSubmitterField({
            submitterField: FormSubmitterField.Email,
            id: "e2",
          }),
        ]),
      ).toBe(
        'Question 2 ("Your Email") asks for a submitter detail another question already asks.',
      );
    });
  });

  describe("what the target cannot do without", () => {
    test("a maintenance form must ask when it starts and ends", () => {
      expect(validate([], FormTargetType.ScheduledMaintenance)).toBe(
        "A form that creates a scheduled maintenance event must ask for Starts At. A form that creates a scheduled maintenance event must ask for Ends At.",
      );
    });

    test("and require both", () => {
      const fields: Array<FormField> = getDefaultFormFields(
        FormTargetType.ScheduledMaintenance,
      ).map((field: FormField): FormField => {
        return field.targetField === "endsAt"
          ? { ...field, isRequired: false }
          : field;
      });

      expect(validate(fields, FormTargetType.ScheduledMaintenance)).toBe(
        "Ends At must be required: a scheduled maintenance event cannot be created without it.",
      );
    });

    test("an incident form need not ask anything", () => {
      expect(validate([], FormTargetType.Incident)).toBeNull();
    });
  });

  describe("the message", () => {
    test("lists the first eight problems, then how many more there are", () => {
      const fields: Array<unknown> = [];

      for (let index: number = 0; index < 10; index++) {
        fields.push(null);
      }

      const message: string = validate(fields)!;

      expect(message.match(/must be an object\./g)).toHaveLength(8);
      expect(message.endsWith(" And 2 more problems.")).toBe(true);
    });

    test("says problem for exactly one more", () => {
      const fields: Array<unknown> = [];

      for (let index: number = 0; index < 9; index++) {
        fields.push(null);
      }

      expect(validate(fields)!.endsWith(" And 1 more problem.")).toBe(true);
    });
  });

  test("does not change the questions it checks", () => {
    const fields: Array<FormField> = deepFreeze(
      getDefaultFormFields(FormTargetType.ScheduledMaintenance),
    );

    expect(() => {
      validate(fields, FormTargetType.ScheduledMaintenance);
    }).not.toThrow();
  });
});

describe("readFormFields: what is stored, as the builder and the page read it", () => {
  test.each([[undefined], [null], ["fields"], [{}], [7]])(
    "reads %p as no questions",
    (value: unknown) => {
      expect(readFormFields(value)).toEqual([]);
    },
  );

  test("keeps a good question as it is, trimming its label", () => {
    expect(
      readFormFields([
        question({ label: "  Which office?  ", helpText: "  Yours.  " }),
      ]),
    ).toEqual([
      {
        id: "q1",
        source: FormFieldSource.Question,
        label: "Which office?",
        helpText: "Yours.",
        isRequired: false,
        type: CustomFieldType.Text,
      },
    ]);
  });

  test("Required is true only when it is exactly true", () => {
    expect(readFormFields([question({ isRequired: "true" })])[0]!.isRequired).toBe(
      false,
    );
    expect(readFormFields([question({ isRequired: true })])[0]!.isRequired).toBe(
      true,
    );
  });

  test("drops what cannot be a question, and a second question with an id already read", () => {
    const fields: Array<FormField> = readFormFields([
      null,
      "x",
      question({ id: "" }),
      question({ source: "Banana" }),
      question({ type: "Banana" }),
      question({ id: "keep" }),
      question({ id: "keep", label: "Second with the same id" }),
      {
        id: "linked",
        source: FormFieldSource.TargetField,
        label: "No key",
        isRequired: false,
      },
      {
        id: "cf",
        source: FormFieldSource.TargetCustomField,
        label: "Bad id",
        isRequired: false,
        customFieldId: "impact",
      },
      {
        id: "who",
        source: FormFieldSource.Submitter,
        label: "Who?",
        isRequired: false,
        submitterField: "Phone",
      },
    ]);

    expect(
      fields.map((field: FormField): string => {
        return `${field.id}:${field.label}`;
      }),
    ).toEqual(["keep:Which office are you in?"]);
  });

  test("keeps a choice question's options, and drops options from anything else", () => {
    const [dropdown, text]: Array<FormField> = readFormFields([
      question({
        id: "d",
        type: CustomFieldType.Dropdown,
        dropdownOptions: "Berlin\nLondon",
      }),
      question({
        id: "t",
        type: CustomFieldType.Text,
        dropdownOptions: "Berlin\nLondon",
      }),
    ]);

    expect(dropdown!.dropdownOptions).toBe("Berlin\nLondon");
    expect(text!.dropdownOptions).toBeUndefined();
  });

  test("a linked field's allowed options are ids, lowercased, each once, junk dropped", () => {
    const [field]: Array<FormField> = readFormFields([
      {
        id: "monitors",
        source: FormFieldSource.TargetField,
        label: "Monitors",
        isRequired: false,
        targetField: "monitors",
        allowedOptionIds: [
          MONITOR_ID.toUpperCase(),
          MONITOR_ID,
          "not-an-id",
          7,
          ` ${SEVERITY_ID} `,
        ],
      },
    ]);

    expect(field!.allowedOptionIds).toEqual([MONITOR_ID, SEVERITY_ID]);
  });

  test("an empty list of allowed options is left out", () => {
    const [field]: Array<FormField> = readFormFields([
      {
        id: "monitors",
        source: FormFieldSource.TargetField,
        label: "Monitors",
        isRequired: false,
        targetField: "monitors",
        allowedOptionIds: [],
      },
    ]);

    expect(field).toEqual({
      id: "monitors",
      source: FormFieldSource.TargetField,
      label: "Monitors",
      isRequired: false,
      targetField: "monitors",
    });
  });

  test("a custom field's id is lowercased", () => {
    expect(
      readFormFields([
        {
          id: "cf",
          source: FormFieldSource.TargetCustomField,
          label: "Impact",
          isRequired: true,
          customFieldId: CUSTOM_FIELD_ID.toUpperCase(),
        },
      ])[0]!.customFieldId,
    ).toBe(CUSTOM_FIELD_ID);
  });

  test("properties that do not belong to the question's source are left behind", () => {
    expect(
      readFormFields([
        {
          ...question(),
          targetField: "title",
          customFieldId: CUSTOM_FIELD_ID,
          submitterField: FormSubmitterField.Email,
          allowedOptionIds: [MONITOR_ID],
          extra: "nope",
          __proto__: { polluted: true },
        },
      ]),
    ).toEqual([
      {
        id: "q1",
        source: FormFieldSource.Question,
        label: "Which office are you in?",
        isRequired: false,
        type: CustomFieldType.Text,
      },
    ]);
  });

  test("reads at most as many questions as a form can have", () => {
    const fields: Array<Record<string, unknown>> = [];

    for (let index: number = 0; index < FORM_MAX_FIELDS + 5; index++) {
      fields.push(question({ id: `q${index}` }));
    }

    expect(readFormFields(fields)).toHaveLength(FORM_MAX_FIELDS);
  });

  test("never throws, and leaves what it read alone", () => {
    const stored: Array<unknown> = deepFreeze([
      question(),
      { id: {}, source: [], label: {} },
    ]);

    expect(readFormFields(stored)).toHaveLength(1);
  });
});

describe("creating questions", () => {
  test("a new dropdown starts with two options to rename", () => {
    expect(getDefaultQuestionOptions()).toBe("Option 1\nOption 2");
    expect(
      parseCustomFieldDropdownOptions(getDefaultQuestionOptions()).map(
        (option: { value: string }): string => {
          return option.value;
        },
      ),
    ).toEqual(["Option 1", "Option 2"]);
  });

  test.each(FORM_QUESTION_TYPES.map((type: CustomFieldType) => {
    return [type];
  }))("a new %s question of the form's own", (type: CustomFieldType) => {
    const field: FormField = createQuestionField({
      type,
      label: "Untitled question",
    });

    expect(isFormFieldId(field.id)).toBe(true);
    expect(field.source).toBe(FormFieldSource.Question);
    expect(field.isRequired).toBe(false);
    expect(field.type).toBe(type);
    expect(field.dropdownOptions).toBe(
      FORM_CHOICE_QUESTION_TYPES.includes(type)
        ? getDefaultQuestionOptions()
        : undefined,
    );
    // Valid as it is, so a fresh question never blocks a save.
    expect(validate([field])).toBeNull();
  });

  test("a new question keeps the id and options it is given", () => {
    expect(
      createQuestionField({
        type: CustomFieldType.MultiSelectDropdown,
        label: "Offices",
        id: "offices",
        dropdownOptions: "Berlin\nLondon",
      }),
    ).toEqual({
      id: "offices",
      source: FormFieldSource.Question,
      label: "Offices",
      isRequired: false,
      type: CustomFieldType.MultiSelectDropdown,
      dropdownOptions: "Berlin\nLondon",
    });
  });

  test("a field of what the form creates starts with the catalog's words", () => {
    const title: FormTargetFieldDefinition = getFormTargetField(
      FormTargetType.Incident,
      "title",
    )!;

    expect(createTargetField({ definition: title, id: "t" })).toEqual({
      id: "t",
      source: FormFieldSource.TargetField,
      label: "Title",
      helpText: "A short summary of what is wrong.",
      // The form's name stands in for a missing title.
      isRequired: false,
      targetField: "title",
    });
  });

  test("a field the target cannot do without starts required, others do not", () => {
    for (const target of FORM_TARGET_TYPES) {
      for (const definition of getFormTargetFields(target)) {
        const field: FormField = createTargetField({ definition });

        expect(field.isRequired).toBe(
          definition.isRequiredByTarget && !definition.hasDefault,
        );
        expect(field.label).toBe(definition.defaultLabel);
        expect(field.helpText).toBe(definition.defaultHelpText);
      }
    }
  });

  test("a custom field's question starts with its name and description", () => {
    expect(
      createCustomFieldField({
        customFieldId: CUSTOM_FIELD_ID.toUpperCase(),
        name: "Impact",
        description: "  How many customers?  ",
        id: "cf",
      }),
    ).toEqual({
      id: "cf",
      source: FormFieldSource.TargetCustomField,
      label: "Impact",
      helpText: "How many customers?",
      isRequired: false,
      customFieldId: CUSTOM_FIELD_ID,
    });
  });

  test("a custom field's long name and description are cut to what a question holds", () => {
    const field: FormField = createCustomFieldField({
      customFieldId: CUSTOM_FIELD_ID,
      name: "n".repeat(300),
      description: "d".repeat(2000),
    });

    expect(field.label).toHaveLength(FORM_FIELD_LABEL_MAX_LENGTH);
    expect(field.helpText).toHaveLength(FORM_FIELD_HELP_TEXT_MAX_LENGTH);
    expect(validate([field])).toBeNull();
  });

  test("a custom field with no description gets no help text", () => {
    for (const description of [undefined, null, "", "   "]) {
      expect(
        createCustomFieldField({
          customFieldId: CUSTOM_FIELD_ID,
          name: "Impact",
          description,
        }).helpText,
      ).toBeUndefined();
    }
  });

  test("the submitter's questions are optional unless asked otherwise", () => {
    expect(
      createSubmitterField({ submitterField: FormSubmitterField.Name, id: "n" }),
    ).toEqual({
      id: "n",
      source: FormFieldSource.Submitter,
      label: "Your Name",
      isRequired: false,
      submitterField: FormSubmitterField.Name,
    });
    expect(
      createSubmitterField({
        submitterField: FormSubmitterField.Email,
        isRequired: true,
      }).isRequired,
    ).toBe(true);
  });
});

describe("getDefaultFormFields: what a new form asks", () => {
  type ShapeFunction = (fields: Array<FormField>) => Array<string>;

  const shape: ShapeFunction = (fields: Array<FormField>): Array<string> => {
    return fields.map((field: FormField): string => {
      const what: string =
        field.targetField || field.submitterField || field.type || "";
      return `${field.source}:${what}:${field.isRequired ? "required" : "optional"}`;
    });
  };

  test("an incident form: a required title, a description, and who is submitting", () => {
    expect(shape(getDefaultFormFields(FormTargetType.Incident))).toEqual([
      "TargetField:title:required",
      "TargetField:description:optional",
      "Submitter:Name:required",
      "Submitter:Email:required",
    ]);
  });

  test("a maintenance form also asks when it starts and ends, required", () => {
    expect(
      shape(getDefaultFormFields(FormTargetType.ScheduledMaintenance)),
    ).toEqual([
      "TargetField:title:required",
      "TargetField:description:optional",
      "TargetField:startsAt:required",
      "TargetField:endsAt:required",
      "Submitter:Name:required",
      "Submitter:Email:required",
    ]);
  });

  test("every question gets an id of its own, fresh each time", () => {
    const first: Array<FormField> = getDefaultFormFields(
      FormTargetType.Incident,
    );
    const second: Array<FormField> = getDefaultFormFields(
      FormTargetType.Incident,
    );

    const ids: Array<string> = first.map((field: FormField): string => {
      return field.id;
    });

    expect(new Set(ids).size).toBe(ids.length);
    expect(second[0]!.id).not.toBe(first[0]!.id);
  });

  test("with the catalog's help texts", () => {
    expect(
      getDefaultFormFields(FormTargetType.ScheduledMaintenance)[0]!.helpText,
    ).toBe("A short summary of the maintenance.");
  });
});

describe("translateFormFieldDefaults: a new form in the reader's language", () => {
  const GERMAN: Record<string, string> = {
    Title: "Titel",
    "A short summary of what is wrong.":
      "Eine kurze Zusammenfassung des Problems.",
    Description: "Beschreibung",
    "Your Name": "Ihr Name",
    "Your Email": "Ihre E-Mail-Adresse",
    "Starts At": "Beginnt um",
  };

  type TranslateFunction = (text: string) => string;

  const german: TranslateFunction = (text: string): string => {
    return GERMAN[text] || text;
  };

  test("translates the labels and help texts that are still the English defaults", () => {
    const translated: Array<FormField> = translateFormFieldDefaults({
      fields: getDefaultFormFields(FormTargetType.Incident),
      targetType: FormTargetType.Incident,
      translate: german,
    });

    expect(
      translated.map((field: FormField): [string, string | undefined] => {
        return [field.label, field.helpText];
      }),
    ).toEqual([
      ["Titel", "Eine kurze Zusammenfassung des Problems."],
      // No German for the description's help: it stays English.
      [
        "Beschreibung",
        "What happened, who is affected and what you have tried.",
      ],
      ["Ihr Name", undefined],
      ["Ihre E-Mail-Adresse", undefined],
    ]);
  });

  test("a label someone wrote is theirs, and stays as it is", () => {
    const [title]: Array<FormField> = translateFormFieldDefaults({
      fields: [
        {
          ...getDefaultFormFields(FormTargetType.Incident)[0]!,
          label: "Title",
          helpText: "Say it in one line.",
        },
      ],
      targetType: FormTargetType.Incident,
      translate: german,
    });

    expect(title!.label).toBe("Titel");
    expect(title!.helpText).toBe("Say it in one line.");

    const [renamed]: Array<FormField> = translateFormFieldDefaults({
      fields: [
        {
          ...getDefaultFormFields(FormTargetType.Incident)[0]!,
          label: "What is wrong?",
        },
      ],
      targetType: FormTargetType.Incident,
      translate: german,
    });

    expect(renamed!.label).toBe("What is wrong?");
  });

  test("questions of the form's own and custom fields are never translated", () => {
    const fields: Array<FormField> = [
      createQuestionField({
        type: CustomFieldType.Text,
        label: "Title",
        id: "own",
      }),
      createCustomFieldField({
        customFieldId: CUSTOM_FIELD_ID,
        name: "Description",
        id: "cf",
      }),
    ];

    expect(
      translateFormFieldDefaults({
        fields,
        targetType: FormTargetType.Incident,
        translate: german,
      }),
    ).toEqual(fields);
  });

  test("a translation that comes back empty keeps the English", () => {
    const [title]: Array<FormField> = translateFormFieldDefaults({
      fields: getDefaultFormFields(FormTargetType.Incident).slice(0, 1),
      targetType: FormTargetType.Incident,
      translate: (): string => {
        return "   ";
      },
    });

    expect(title!.label).toBe("Title");
  });

  test("reads the defaults of the form's own target", () => {
    const fields: Array<FormField> = getDefaultFormFields(
      FormTargetType.ScheduledMaintenance,
    );

    const translated: Array<FormField> = translateFormFieldDefaults({
      fields,
      targetType: FormTargetType.ScheduledMaintenance,
      translate: german,
    });

    expect(translated[2]!.label).toBe("Beginnt um");
    // A field the target does not have is left alone.
    expect(
      translateFormFieldDefaults({
        fields: [
          {
            id: "x",
            source: FormFieldSource.TargetField,
            targetField: "startsAt",
            label: "Starts At",
            isRequired: true,
          },
        ],
        targetType: FormTargetType.Incident,
        translate: german,
      })[0]!.label,
    ).toBe("Starts At");
  });

  test("returns new questions and changes none it was given", () => {
    const fields: Array<FormField> = deepFreeze(
      getDefaultFormFields(FormTargetType.Incident),
    );

    const translated: Array<FormField> = translateFormFieldDefaults({
      fields,
      targetType: FormTargetType.Incident,
      translate: german,
    });

    expect(translated[0]).not.toBe(fields[0]);
    expect(fields[0]!.label).toBe("Title");
  });
});

describe("convertFormFieldsForTarget: when a form starts creating something else", () => {
  type IncidentFormFunction = () => Array<FormField>;

  const incidentForm: IncidentFormFunction = (): Array<FormField> => {
    return [
      {
        id: "title",
        source: FormFieldSource.TargetField,
        targetField: "title",
        label: "What is wrong?",
        helpText: "One line.",
        isRequired: true,
      },
      {
        id: "description",
        source: FormFieldSource.TargetField,
        targetField: "description",
        label: "Details",
        isRequired: false,
      },
      {
        id: "severity",
        source: FormFieldSource.TargetField,
        targetField: "incidentSeverityId",
        label: "How bad is it?",
        helpText: "Pick one.",
        isRequired: true,
        allowedOptionIds: [SEVERITY_ID],
      },
      {
        id: "monitors",
        source: FormFieldSource.TargetField,
        targetField: "monitors",
        label: "Affected Monitors",
        isRequired: false,
        allowedOptionIds: [MONITOR_ID],
      },
      {
        id: "impact",
        source: FormFieldSource.TargetField,
        targetField: "impactStartedAt",
        label: "When did it start?",
        isRequired: false,
      },
      {
        id: "region",
        source: FormFieldSource.TargetCustomField,
        customFieldId: CUSTOM_FIELD_ID,
        label: "Region",
        helpText: "Where it is.",
        isRequired: true,
      },
      {
        id: "office",
        source: FormFieldSource.Question,
        type: CustomFieldType.Dropdown,
        dropdownOptions: "Berlin\nLondon",
        label: "Which office?",
        isRequired: false,
      },
      createSubmitterField({
        submitterField: FormSubmitterField.Email,
        isRequired: true,
        id: "email",
      }),
    ];
  };

  test("to the same target, a copy of every question", () => {
    const fields: Array<FormField> = incidentForm();
    const converted: Array<FormField> = convertFormFieldsForTarget({
      fields,
      from: FormTargetType.Incident,
      to: FormTargetType.Incident,
    });

    expect(converted).toEqual(fields);
    expect(converted[0]).not.toBe(fields[0]);
  });

  test("to maintenance: the shared fields stay linked, the rest become questions of the form's own", () => {
    const converted: Array<FormField> = convertFormFieldsForTarget({
      fields: incidentForm(),
      from: FormTargetType.Incident,
      to: FormTargetType.ScheduledMaintenance,
    });

    expect(converted.slice(0, 8)).toEqual([
      // Both kinds of record have a title, a description and monitors.
      incidentForm()[0],
      incidentForm()[1],
      // A severity has nothing to choose from on an event: a line of text.
      {
        id: "severity",
        source: FormFieldSource.Question,
        label: "How bad is it?",
        helpText: "Pick one.",
        isRequired: true,
        type: CustomFieldType.Text,
      },
      incidentForm()[3],
      // A date stays a date.
      {
        id: "impact",
        source: FormFieldSource.Question,
        label: "When did it start?",
        isRequired: false,
        type: CustomFieldType.DateTime,
      },
      // An incident custom field means nothing on an event.
      {
        id: "region",
        source: FormFieldSource.Question,
        label: "Region",
        helpText: "Where it is.",
        isRequired: true,
        type: CustomFieldType.Text,
      },
      incidentForm()[6],
      incidentForm()[7],
    ]);
  });

  test("to maintenance: the start and the end are added, required", () => {
    const converted: Array<FormField> = convertFormFieldsForTarget({
      fields: incidentForm(),
      from: FormTargetType.Incident,
      to: FormTargetType.ScheduledMaintenance,
    });

    expect(
      converted.slice(8).map((field: FormField): string => {
        return `${field.targetField}:${field.isRequired}`;
      }),
    ).toEqual(["startsAt:true", "endsAt:true"]);
    expect(
      validate(converted, FormTargetType.ScheduledMaintenance),
    ).toBeNull();
  });

  test("a question already asking for the start keeps its place and becomes required", () => {
    const converted: Array<FormField> = convertFormFieldsForTarget({
      fields: [
        {
          id: "start",
          source: FormFieldSource.TargetField,
          targetField: "startsAt",
          label: "From",
          isRequired: false,
        },
      ],
      from: FormTargetType.ScheduledMaintenance,
      to: FormTargetType.ScheduledMaintenance,
    });

    // Same target: copied as it is.
    expect(converted[0]!.isRequired).toBe(false);
  });

  test("back to incidents: the window and the status pages become questions of the form's own", () => {
    const maintenance: Array<FormField> = [
      ...getDefaultFormFields(FormTargetType.ScheduledMaintenance),
      {
        id: "pages",
        source: FormFieldSource.TargetField,
        targetField: "statusPages",
        label: "Which pages?",
        isRequired: false,
        allowedOptionIds: [MONITOR_ID],
      },
    ];

    const converted: Array<FormField> = convertFormFieldsForTarget({
      fields: maintenance,
      from: FormTargetType.ScheduledMaintenance,
      to: FormTargetType.Incident,
    });

    const byLabel: Record<string, FormField> = {};

    for (const field of converted) {
      byLabel[field.label] = field;
    }

    expect(byLabel["Starts At"]).toMatchObject({
      source: FormFieldSource.Question,
      type: CustomFieldType.DateTime,
      isRequired: true,
    });
    expect(byLabel["Which pages?"]).toMatchObject({
      source: FormFieldSource.Question,
      type: CustomFieldType.Text,
    });
    expect(byLabel["Which pages?"]!.allowedOptionIds).toBeUndefined();
    expect(byLabel["Title"]!.source).toBe(FormFieldSource.TargetField);
    expect(converted).toHaveLength(maintenance.length);
    expect(validate(converted, FormTargetType.Incident)).toBeNull();
  });

  test("the result of every conversion of every default form is valid for its new target", () => {
    for (const from of FORM_TARGET_TYPES) {
      for (const to of FORM_TARGET_TYPES) {
        expect(
          validate(
            convertFormFieldsForTarget({
              fields: getDefaultFormFields(from),
              from,
              to,
            }),
            to,
          ),
        ).toBeNull();
      }
    }
  });

  test("changes none of the questions it was given", () => {
    const fields: Array<FormField> = deepFreeze(incidentForm());

    expect(() => {
      convertFormFieldsForTarget({
        fields,
        from: FormTargetType.Incident,
        to: FormTargetType.ScheduledMaintenance,
      });
    }).not.toThrow();
  });
});

describe("finding a question", () => {
  const fields: Array<FormField> = [
    ...getDefaultFormFields(FormTargetType.Incident),
    createCustomFieldField({
      customFieldId: CUSTOM_FIELD_ID,
      name: "Impact",
      id: "cf",
    }),
  ];

  test("by the field of what the form creates it asks for", () => {
    expect(findTargetField(fields, "description")!.label).toBe("Description");
    expect(findTargetField(fields, "monitors")).toBeUndefined();
  });

  test("by its custom field, whatever the id's case", () => {
    expect(findCustomFieldField(fields, CUSTOM_FIELD_ID.toUpperCase())!.id).toBe(
      "cf",
    );
    expect(
      findCustomFieldField(fields, "44444444-4444-4444-8444-444444444444"),
    ).toBeUndefined();
  });

  test("by the submitter detail it asks for", () => {
    expect(findSubmitterField(fields, FormSubmitterField.Email)!.label).toBe(
      "Your Email",
    );
    expect(
      findSubmitterField(
        fields.filter((field: FormField): boolean => {
          return field.submitterField !== FormSubmitterField.Name;
        }),
        FormSubmitterField.Name,
      ),
    ).toBeUndefined();
  });
});

describe("the module stays pure", () => {
  test("imports only other pure modules of Common", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Types/Form/FormField.ts"),
      "utf8",
    );

    const imports: Array<string> = Array.from(
      source.matchAll(/from\s+"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(imports.length).toBeGreaterThan(0);

    for (const specifier of imports) {
      expect(specifier).toMatch(/^\.\.?\//);
      expect(specifier).not.toMatch(/Server|UI\/|Models|react/);
    }
  });
});
