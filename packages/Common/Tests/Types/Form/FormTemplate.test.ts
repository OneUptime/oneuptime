import { FORM_MAX_FIELDS } from "../../../Types/Form/FormField";
import { FORM_DESCRIPTION_MAX_LENGTH } from "../../../Types/Form/FormTargetCatalog";
import {
  describeFormTemplate,
  duplicateFormTemplate,
  findFormTemplate,
  FORM_MAX_TEMPLATES,
  FORM_TEMPLATE_ANSWER_MAX_LENGTH,
  FORM_TEMPLATE_MAX_CHOICES,
  FORM_TEMPLATE_NAME_MAX_LENGTH,
  FORM_TEMPLATE_QUERY_PARAMETER,
  FormTemplate,
  FormTemplatesChange,
  generateFormTemplateId,
  getDefaultFormTemplate,
  getFormTemplateCopyName,
  getFormTemplateLink,
  isFormTemplateId,
  moveFormTemplate,
  readFormTemplateIdFromSearch,
  readFormTemplates,
  removeFormTemplate,
  saveFormTemplate,
  setDefaultFormTemplate,
  validateFormTemplates,
} from "../../../Types/Form/FormTemplate";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A form's templates (Form.templates): named sets of answers a submission
 * starts from. What is checked here is what a template is - its id, its
 * name, Default, the shape of its answers - and the list operations the
 * dashboard's Templates page makes. Whether each answer suits its question
 * is FormPublic's (FormPublicTemplates.test.ts).
 */

const TITLE_ID: string = "title";
const OFFICE_ID: string = "office";

function template(data: Partial<FormTemplate> & { id: string }): FormTemplate {
  return {
    name: data.id,
    answers: {},
    ...data,
  };
}

const OUTAGE: FormTemplate = template({
  id: "outage",
  name: "Application Outage",
  answers: { [TITLE_ID]: "The application is down", [OFFICE_ID]: "Berlin" },
});

const MAINTENANCE: FormTemplate = template({
  id: "maintenance",
  name: "Planned Maintenance",
  isDefault: true,
  answers: { [TITLE_ID]: "Planned maintenance tonight" },
});

const RESTORED: FormTemplate = template({
  id: "restored",
  name: "Service Restored",
});

function names(templates: Array<FormTemplate>): Array<string> {
  return templates.map((entry: FormTemplate): string => {
    return entry.name;
  });
}

function ids(templates: Array<FormTemplate>): Array<string> {
  return templates.map((entry: FormTemplate): string => {
    return entry.id;
  });
}

describe("ids", () => {
  test("a template's id has a question id's shape", () => {
    expect(isFormTemplateId("outage")).toBe(true);
    expect(isFormTemplateId("0f6c2b8e-6a8d-4f1c-9d3e-2b7a1c5e9f40")).toBe(true);
    expect(isFormTemplateId("a_b-c9")).toBe(true);
  });

  test.each([
    ["nothing", ""],
    ["a leading dash", "-outage"],
    ["a space", "planned outage"],
    ["a dot, which a link could read as a path", "a.b"],
    ["a slash", "a/b"],
    ["a query", "a?b=c"],
    ["sixty-five characters", "a".repeat(65)],
  ])("refuses %s", (_label: string, value: string) => {
    expect(isFormTemplateId(value)).toBe(false);
  });

  test.each([null, undefined, 7, {}, ["outage"]])(
    "refuses %j, which is not text",
    (value: unknown) => {
      expect(isFormTemplateId(value)).toBe(false);
    },
  );

  test("a new template's id is a fresh UUID, which is an id", () => {
    const first: string = generateFormTemplateId();
    const second: string = generateFormTemplateId();

    expect(ObjectID.isValidUUID(first)).toBe(true);
    expect(isFormTemplateId(first)).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe("readFormTemplates - what the dashboard and the server read", () => {
  test("reads stored templates, in order, exactly", () => {
    expect(readFormTemplates([OUTAGE, MAINTENANCE, RESTORED])).toEqual([
      OUTAGE,
      MAINTENANCE,
      RESTORED,
    ]);
  });

  test.each([undefined, null, "", "[]", {}, 7, true])(
    "reads %j as no templates",
    (value: unknown) => {
      expect(readFormTemplates(value)).toEqual([]);
    },
  );

  test("drops entries that cannot be a template, and keeps the rest", () => {
    expect(
      readFormTemplates([
        null,
        "outage",
        ["outage"],
        { name: "No id" },
        { id: "bad id", name: "Bad id" },
        { id: "noname" },
        { id: "blank", name: "   " },
        { id: "number", name: 7 },
        OUTAGE,
      ]),
    ).toEqual([OUTAGE]);
  });

  test("a second template with an id already listed is dropped", () => {
    expect(
      readFormTemplates([OUTAGE, { ...MAINTENANCE, id: OUTAGE.id }]),
    ).toEqual([OUTAGE]);
  });

  test("trims names, and cuts one that is too long", () => {
    const read: Array<FormTemplate> = readFormTemplates([
      { id: "a", name: "  Outage  " },
      { id: "b", name: "x".repeat(FORM_TEMPLATE_NAME_MAX_LENGTH + 20) },
    ]);

    expect(read[0]!.name).toBe("Outage");
    expect(read[1]!.name).toHaveLength(FORM_TEMPLATE_NAME_MAX_LENGTH);
  });

  test("only the first default is a default", () => {
    const read: Array<FormTemplate> = readFormTemplates([
      { ...OUTAGE, isDefault: true },
      MAINTENANCE,
    ]);

    expect(read[0]!.isDefault).toBe(true);
    expect(read[1]!.isDefault).toBeUndefined();
  });

  test.each(["true", 1, "yes", false])(
    "Default %j is not a default",
    (value: unknown) => {
      expect(
        readFormTemplates([{ ...RESTORED, isDefault: value }])[0]!.isDefault,
      ).toBeUndefined();
    },
  );

  test("a template with no answers, or answers that are not an object, answers nothing", () => {
    expect(
      readFormTemplates([
        { id: "a", name: "A" },
        { id: "b", name: "B", answers: "title=down" },
        { id: "c", name: "C", answers: ["down"] },
        { id: "d", name: "D", answers: null },
      ]).map((entry: FormTemplate): JSONObject => {
        return entry.answers;
      }),
    ).toEqual([{}, {}, {}, {}]);
  });

  test("keeps text, numbers, yes/no and lists of them; drops what cannot be an answer", () => {
    const read: FormTemplate = readFormTemplates([
      {
        id: "a",
        name: "A",
        answers: {
          text: "down",
          number: 3,
          yes: true,
          no: false,
          list: ["a", "b"],
          nested: [["a"]],
          object: { value: "a" },
          infinite: Number.POSITIVE_INFINITY,
          nothing: null,
          "bad key": "x",
          long: "x".repeat(FORM_TEMPLATE_ANSWER_MAX_LENGTH + 1),
          longList: Array(FORM_TEMPLATE_MAX_CHOICES + 1).fill("a"),
        },
      },
    ])[0]!;

    expect(read.answers).toEqual({
      text: "down",
      number: 3,
      yes: true,
      no: false,
      list: ["a", "b"],
    });
  });

  test("an answer list is copied, not shared with what was read", () => {
    const stored: Array<unknown> = [
      { id: "a", name: "A", answers: { list: ["a"] } },
    ];
    const read: FormTemplate = readFormTemplates(stored)[0]!;

    (read.answers["list"] as Array<string>).push("b");

    expect(
      (stored[0] as { answers: { list: Array<string> } }).answers.list.length,
    ).toBe(1);
  });

  test("a key such as __proto__ is stored as an answer - never as the object's prototype", () => {
    const answers: Record<string, unknown> = JSON.parse(
      '{"__proto__": {"polluted": true}, "title": "down"}',
    ) as Record<string, unknown>;
    const read: FormTemplate = readFormTemplates([
      { id: "a", name: "A", answers },
    ])[0]!;

    expect(read.answers["title"]).toBe("down");
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.getPrototypeOf(read.answers)).toBe(Object.prototype);
  });

  test("reads at most as many answers as a form has questions", () => {
    const answers: JSONObject = {};

    for (let index: number = 0; index < FORM_MAX_FIELDS + 10; index++) {
      answers[`q${index}`] = "x";
    }

    expect(
      Object.keys(
        readFormTemplates([{ id: "a", name: "A", answers }])[0]!.answers,
      ),
    ).toHaveLength(FORM_MAX_FIELDS);
  });

  test("reads at most as many templates as a form may have", () => {
    const many: Array<FormTemplate> = Array.from(
      { length: FORM_MAX_TEMPLATES + 5 },
      (_value: unknown, index: number): FormTemplate => {
        return template({ id: `t${index}`, name: `Template ${index}` });
      },
    );

    expect(readFormTemplates(many)).toHaveLength(FORM_MAX_TEMPLATES);
  });
});

describe("validateFormTemplates - what may be stored", () => {
  test.each([
    ["no templates", undefined],
    ["templates cleared", null],
    ["an empty list", []],
    ["templates of every kind", [OUTAGE, MAINTENANCE, RESTORED]],
    [
      "a template answering with a number, a yes/no and a list",
      [{ id: "a", name: "A", answers: { n: 3, b: false, l: ["x", "y"] } }],
    ],
    ["Default false", [{ ...RESTORED, isDefault: false }]],
    ["Default null", [{ ...RESTORED, isDefault: null }]],
    ["answers null", [{ ...RESTORED, answers: null }]],
  ])("accepts %s", (_label: string, value: unknown) => {
    expect(validateFormTemplates(value)).toBeNull();
  });

  test("refuses what is not a list", () => {
    expect(validateFormTemplates({ outage: OUTAGE })).toBe(
      "Templates must be a list.",
    );
    expect(validateFormTemplates("outage")).toBe("Templates must be a list.");
  });

  test("refuses more templates than a form may have", () => {
    expect(
      validateFormTemplates(
        Array.from(
          { length: FORM_MAX_TEMPLATES + 1 },
          (_value: unknown, index: number): FormTemplate => {
            return template({ id: `t${index}`, name: `Template ${index}` });
          },
        ),
      ),
    ).toBe(`A form cannot have more than ${FORM_MAX_TEMPLATES} templates.`);
  });

  test.each([
    [
      "an entry that is not an object",
      ["outage"],
      "Template 1 must be an object.",
    ],
    [
      "a template with no id",
      [{ name: "Outage" }],
      'Template 1 ("Outage") needs an id of letters, digits, "-" and "_", starting with a letter or digit, at most 64 characters.',
    ],
    [
      "a template with an id that is not one",
      [{ id: "../../admin", name: "Outage" }],
      'Template 1 ("Outage") needs an id of letters, digits, "-" and "_", starting with a letter or digit, at most 64 characters.',
    ],
    [
      "two templates with one id",
      [OUTAGE, { ...MAINTENANCE, id: OUTAGE.id }],
      'Template 2 ("Planned Maintenance") has the same id as another template.',
    ],
    ["a template with no name", [{ id: "a" }], "Template 1 needs a name."],
    [
      "a template with a blank name",
      [{ id: "a", name: "   " }],
      "Template 1 needs a name.",
    ],
    [
      "two templates with one name, whatever the case",
      [OUTAGE, { ...MAINTENANCE, name: "  application OUTAGE " }],
      'Template 2 ("application OUTAGE") has the same name as another template.',
    ],
    [
      "Default that is not true or false",
      [{ ...RESTORED, isDefault: "yes" }],
      'Template 1 ("Service Restored"): Default must be true or false.',
    ],
    [
      "two defaults",
      [
        { ...OUTAGE, isDefault: true },
        { ...MAINTENANCE, isDefault: true },
      ],
      "Only one template can be the default.",
    ],
    [
      "answers that are not an object",
      [{ ...RESTORED, answers: ["down"] }],
      'Template 1 ("Service Restored"): its answers must be an object keyed by question.',
    ],
    [
      "answers keyed by something that is not a question id",
      [{ ...RESTORED, answers: { "the title": "down" } }],
      'Template 1 ("Service Restored"): its answers must be keyed by question id.',
    ],
  ])("refuses %s", (_label: string, value: unknown, message: string) => {
    expect(validateFormTemplates(value)).toBe(message);
  });

  test("refuses a name that is too long", () => {
    expect(
      validateFormTemplates([
        { id: "a", name: "x".repeat(FORM_TEMPLATE_NAME_MAX_LENGTH + 1) },
      ]),
    ).toContain(
      `the name cannot be more than ${FORM_TEMPLATE_NAME_MAX_LENGTH} characters.`,
    );
  });

  test.each([
    ["an object", { value: "Berlin" }],
    ["a list of lists", [["Berlin"]]],
    ["a list of objects", [{ value: "Berlin" }]],
    [
      "text longer than any question takes",
      "x".repeat(FORM_TEMPLATE_ANSWER_MAX_LENGTH + 1),
    ],
    [
      "a list with more entries than a multi-select takes",
      Array(FORM_TEMPLATE_MAX_CHOICES + 1).fill("a"),
    ],
    ["a number that is not finite", Number.NaN],
    ["null", null],
  ])("refuses an answer that is %s", (_label: string, answer: unknown) => {
    expect(
      validateFormTemplates([{ ...RESTORED, answers: { [TITLE_ID]: answer } }]),
    ).toBe(
      `Template 1 ("Service Restored"): each answer must be text of at most ${FORM_TEMPLATE_ANSWER_MAX_LENGTH} characters, a number, true or false, or a list of at most ${FORM_TEMPLATE_MAX_CHOICES} of those.`,
    );
  });

  test("the longest text a template holds is the longest any question takes: a description", () => {
    expect(FORM_TEMPLATE_ANSWER_MAX_LENGTH).toBe(FORM_DESCRIPTION_MAX_LENGTH);
    expect(
      validateFormTemplates([
        {
          ...RESTORED,
          answers: { description: "x".repeat(FORM_DESCRIPTION_MAX_LENGTH) },
        },
      ]),
    ).toBeNull();
  });

  test("refuses a template answering more questions than a form has", () => {
    const answers: JSONObject = {};

    for (let index: number = 0; index <= FORM_MAX_FIELDS; index++) {
      answers[`q${index}`] = "x";
    }

    expect(validateFormTemplates([{ ...RESTORED, answers }])).toBe(
      `Template 1 ("Service Restored") cannot answer more than ${FORM_MAX_FIELDS} questions.`,
    );
  });

  test("names every problem, the first eight of them", () => {
    const problem: string | null = validateFormTemplates(
      Array.from({ length: 10 }, (): unknown => {
        return "not a template";
      }),
    );

    expect(problem).toContain("Template 1 must be an object.");
    expect(problem).toContain("Template 8 must be an object.");
    expect(problem).not.toContain("Template 9 must be an object.");
    expect(problem).toContain("And 2 more problems.");
  });

  test("whatever validateFormTemplates accepts, readFormTemplates reads whole", () => {
    const value: Array<unknown> = [
      { ...OUTAGE, isDefault: false },
      MAINTENANCE,
      RESTORED,
    ];

    expect(validateFormTemplates(value)).toBeNull();
    expect(readFormTemplates(value)).toHaveLength(value.length);
  });
});

describe("describeFormTemplate", () => {
  test("names a template by its position, and its name when it has one", () => {
    expect(describeFormTemplate({ index: 0 })).toBe("Template 1");
    expect(describeFormTemplate({ index: 2, name: "  Outage " })).toBe(
      'Template 3 ("Outage")',
    );
    expect(describeFormTemplate({ index: 0, name: 7 })).toBe("Template 1");
    expect(describeFormTemplate({ index: 0, name: "x".repeat(100) })).toBe(
      `Template 1 ("${"x".repeat(60)}")`,
    );
  });
});

describe("finding templates", () => {
  const templates: Array<FormTemplate> = [OUTAGE, MAINTENANCE, RESTORED];

  test("by id", () => {
    expect(findFormTemplate(templates, "restored")).toBe(RESTORED);
    expect(findFormTemplate(templates, "gone")).toBeUndefined();
    expect(findFormTemplate(templates, undefined)).toBeUndefined();
    expect(findFormTemplate(templates, "not an id")).toBeUndefined();
  });

  test("the default", () => {
    expect(getDefaultFormTemplate(templates)).toBe(MAINTENANCE);
    expect(getDefaultFormTemplate([OUTAGE, RESTORED])).toBeUndefined();
    expect(getDefaultFormTemplate([])).toBeUndefined();
  });
});

describe("getFormTemplateCopyName - a copy's name, as Duplicate names one", () => {
  test.each([
    ["Outage", ["Outage"], "Outage 2"],
    ["Outage", ["Outage", "Outage 2"], "Outage 3"],
    ["Outage", ["Outage", "outage 2"], "Outage 3"],
    // A copy of a copy goes on with the series while its first name is listed.
    ["Outage 2", ["Outage", "Outage 2"], "Outage 3"],
    ["Outage 7", ["Outage", "Outage 7"], "Outage 8"],
    // Otherwise the number is part of the name.
    ["Windows Server 2019", ["Windows Server 2019"], "Windows Server 2019 2"],
    ["  Outage  ", ["Outage"], "Outage 2"],
  ])(
    "a copy of %j among %j is %j",
    (name: string, existingNames: Array<string>, copy: string) => {
      expect(getFormTemplateCopyName({ name, existingNames })).toBe(copy);
    },
  );

  test("fits the name limit by shortening the name, never its number", () => {
    const long: string = "x".repeat(FORM_TEMPLATE_NAME_MAX_LENGTH);
    const copy: string = getFormTemplateCopyName({
      name: long,
      existingNames: [long],
    });

    expect(copy).toHaveLength(FORM_TEMPLATE_NAME_MAX_LENGTH);
    expect(copy.endsWith(" 2")).toBe(true);
  });

  test("never hands back a name the form has, however many copies there are", () => {
    const existing: Array<string> = ["Outage"];

    for (let index: number = 0; index < 20; index++) {
      const copy: string = getFormTemplateCopyName({
        name: "Outage",
        existingNames: existing,
      });

      expect(
        existing.map((name: string): string => {
          return name.toLowerCase();
        }),
      ).not.toContain(copy.toLowerCase());
      existing.push(copy);
    }
  });
});

describe("saveFormTemplate", () => {
  test("adds a new template at the end", () => {
    const change: FormTemplatesChange = saveFormTemplate({
      templates: [OUTAGE],
      template: RESTORED,
    });

    expect(ids(change.templates)).toEqual(["outage", "restored"]);
    expect(change.templateId).toBe("restored");
  });

  test("puts an edited template in its own place", () => {
    const edited: FormTemplate = { ...OUTAGE, name: "Outage (EU)" };
    const change: FormTemplatesChange = saveFormTemplate({
      templates: [OUTAGE, RESTORED],
      template: edited,
    });

    expect(change.templates).toEqual([edited, RESTORED]);
  });

  test("a template saved as the default takes the default from any other", () => {
    const change: FormTemplatesChange = saveFormTemplate({
      templates: [OUTAGE, MAINTENANCE],
      template: { ...RESTORED, isDefault: true },
    });

    expect(getDefaultFormTemplate(change.templates)?.id).toBe("restored");
    expect(change.templates[1]!.isDefault).toBeUndefined();
    // What it was handed is left as it was.
    expect(MAINTENANCE.isDefault).toBe(true);
  });

  test("a template saved as not the default carries no Default at all", () => {
    const change: FormTemplatesChange = saveFormTemplate({
      templates: [MAINTENANCE],
      template: { ...MAINTENANCE, isDefault: false },
    });

    expect(change.templates[0]).not.toHaveProperty("isDefault");
  });

  test("a full form gets no new template, but its templates can still be edited", () => {
    const full: Array<FormTemplate> = Array.from(
      { length: FORM_MAX_TEMPLATES },
      (_value: unknown, index: number): FormTemplate => {
        return template({ id: `t${index}`, name: `Template ${index}` });
      },
    );

    const added: FormTemplatesChange = saveFormTemplate({
      templates: full,
      template: RESTORED,
    });

    expect(added.templates).toHaveLength(FORM_MAX_TEMPLATES);
    expect(added.templateId).toBeNull();

    const edited: FormTemplatesChange = saveFormTemplate({
      templates: full,
      template: { ...full[0]!, name: "Renamed" },
    });

    expect(edited.templates[0]!.name).toBe("Renamed");
  });

  test("leaves the list it was given alone", () => {
    const templates: Array<FormTemplate> = [OUTAGE];

    saveFormTemplate({ templates, template: RESTORED });

    expect(templates).toEqual([OUTAGE]);
  });
});

describe("duplicateFormTemplate", () => {
  test("copies a template right after it, with a new id and the next name", () => {
    const change: FormTemplatesChange = duplicateFormTemplate({
      templates: [OUTAGE, RESTORED],
      id: "outage",
    });

    expect(change.templates).toHaveLength(3);
    expect(names(change.templates)).toEqual([
      "Application Outage",
      "Application Outage 2",
      "Service Restored",
    ]);

    const copy: FormTemplate = change.templates[1]!;

    expect(copy.id).not.toBe(OUTAGE.id);
    expect(isFormTemplateId(copy.id)).toBe(true);
    expect(change.templateId).toBe(copy.id);
    expect(copy.answers).toEqual(OUTAGE.answers);
  });

  test("the copy's answers are its own", () => {
    const original: FormTemplate = template({
      id: "a",
      name: "A",
      answers: { list: ["x"] },
    });
    const copy: FormTemplate = duplicateFormTemplate({
      templates: [original],
      id: "a",
    }).templates[1]!;

    (copy.answers["list"] as Array<string>).push("y");

    expect(original.answers["list"]).toEqual(["x"]);
  });

  test("the copy of the default is never the default: a form has one", () => {
    const copy: FormTemplate = duplicateFormTemplate({
      templates: [MAINTENANCE],
      id: "maintenance",
    }).templates[1]!;

    expect(copy.isDefault).toBeUndefined();
    expect(validateFormTemplates([MAINTENANCE, copy])).toBeNull();
  });

  test("a template that is not listed, or a full form, is left as it was", () => {
    expect(duplicateFormTemplate({ templates: [OUTAGE], id: "gone" })).toEqual({
      templates: [OUTAGE],
      templateId: null,
    });

    const full: Array<FormTemplate> = Array.from(
      { length: FORM_MAX_TEMPLATES },
      (_value: unknown, index: number): FormTemplate => {
        return template({ id: `t${index}`, name: `Template ${index}` });
      },
    );

    expect(
      duplicateFormTemplate({ templates: full, id: "t0" }).templates,
    ).toHaveLength(FORM_MAX_TEMPLATES);
  });
});

describe("removing and moving templates", () => {
  test("removes one", () => {
    expect(
      ids(removeFormTemplate({ templates: [OUTAGE, RESTORED], id: "outage" })),
    ).toEqual(["restored"]);
    expect(
      ids(removeFormTemplate({ templates: [OUTAGE], id: "gone" })),
    ).toEqual(["outage"]);
  });

  test("moves one up and down", () => {
    const templates: Array<FormTemplate> = [OUTAGE, MAINTENANCE, RESTORED];

    expect(
      ids(moveFormTemplate({ templates, id: "restored", offset: -1 })),
    ).toEqual(["outage", "restored", "maintenance"]);
    expect(
      ids(moveFormTemplate({ templates, id: "outage", offset: 1 })),
    ).toEqual(["maintenance", "outage", "restored"]);
    // The list it was given is left alone.
    expect(ids(templates)).toEqual(["outage", "maintenance", "restored"]);
  });

  test("a move past either end, or of a template not listed, changes nothing", () => {
    const templates: Array<FormTemplate> = [OUTAGE, RESTORED];

    expect(
      ids(moveFormTemplate({ templates, id: "outage", offset: -1 })),
    ).toEqual(["outage", "restored"]);
    expect(
      ids(moveFormTemplate({ templates, id: "restored", offset: 1 })),
    ).toEqual(["outage", "restored"]);
    expect(ids(moveFormTemplate({ templates, id: "gone", offset: 1 }))).toEqual(
      ["outage", "restored"],
    );
  });

  test("makes one template the default, or none", () => {
    const templates: Array<FormTemplate> = [OUTAGE, MAINTENANCE, RESTORED];

    expect(
      getDefaultFormTemplate(
        setDefaultFormTemplate({ templates, id: "outage" }),
      )?.id,
    ).toBe("outage");
    expect(
      setDefaultFormTemplate({ templates, id: "outage" }).filter(
        (entry: FormTemplate): boolean => {
          return entry.isDefault === true;
        },
      ),
    ).toHaveLength(1);
    expect(
      getDefaultFormTemplate(setDefaultFormTemplate({ templates, id: null })),
    ).toBeUndefined();
  });
});

describe("links that open the form with a template", () => {
  test("the parameter is template", () => {
    expect(FORM_TEMPLATE_QUERY_PARAMETER).toBe("template");
  });

  test("a form's link with a template's id", () => {
    expect(
      getFormTemplateLink({
        formLink: "https://oneuptime.example/accounts/form/7c9e6679",
        templateId: "outage",
      }),
    ).toBe("https://oneuptime.example/accounts/form/7c9e6679?template=outage");
    expect(
      getFormTemplateLink({
        formLink: "/accounts/form/7c9e6679?utm=x",
        templateId: "outage",
      }),
    ).toBe("/accounts/form/7c9e6679?utm=x&template=outage");
  });

  test("reads the template a link names back", () => {
    expect(readFormTemplateIdFromSearch("?template=outage")).toBe("outage");
    expect(readFormTemplateIdFromSearch("template=outage")).toBe("outage");
    expect(readFormTemplateIdFromSearch("?utm=x&template=outage")).toBe(
      "outage",
    );
    expect(readFormTemplateIdFromSearch("?template=%20outage%20")).toBe(
      "outage",
    );

    const link: string = getFormTemplateLink({
      formLink: "/accounts/form/key",
      templateId: "0f6c2b8e-6a8d-4f1c-9d3e-2b7a1c5e9f40",
    });

    expect(readFormTemplateIdFromSearch(link.slice(link.indexOf("?")))).toBe(
      "0f6c2b8e-6a8d-4f1c-9d3e-2b7a1c5e9f40",
    );
  });

  test.each([
    ["no query", ""],
    ["no template", "?utm=x"],
    ["an empty template", "?template="],
    ["something that is not an id", "?template=../../admin"],
    ["a script", "?template=%3Cscript%3E"],
  ])("a link with %s names no template", (_label: string, search: string) => {
    expect(readFormTemplateIdFromSearch(search)).toBeNull();
  });

  test.each([null, undefined])("%j names no template", (search: unknown) => {
    expect(readFormTemplateIdFromSearch(search as string | null)).toBeNull();
  });
});

describe("the module stays pure", () => {
  test("imports only other pure modules of Common", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Types/Form/FormTemplate.ts"),
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

  test("does not import FormPublic, which reads templates through it", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../Types/Form/FormTemplate.ts"),
      "utf8",
    );

    expect(source).not.toContain('from "./FormPublic"');
  });
});
