import { FORM_MAX_FIELDS } from "../../../Types/Form/FormField";
import {
  duplicateFormTemplate,
  FORM_TEMPLATE_FIELD_SETTINGS,
  FormQuestionAsked,
  FormTemplate,
  FormTemplateFieldSetting,
  FormTemplateFieldSettings,
  FormTemplatesChange,
  getFormQuestionAsked,
  getFormTemplateFieldSetting,
  isFormTemplateFieldSetting,
  limitFormTemplatesToQuestions,
  readFormTemplates,
  saveFormTemplate,
  validateFormTemplates,
} from "../../../Types/Form/FormTemplate";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * How a template asks the form's questions (FormTemplate.fieldSettings,
 * issue #4563): per question, Required, Optional or Hidden for submissions
 * that start from the template - and nothing at all for "use the form's
 * default", so a question added to the form later is asked as the form asks
 * it, in every template.
 *
 * Pinned here: the one rule that decides how a question is asked
 * (getFormQuestionAsked), how settings are read (readFormTemplates) and
 * checked before they are stored (validateFormTemplates), and that the list
 * operations carry them. Which questions a template may set, against the
 * form's own, is FormPublic's (FormPublicFieldSettings.test.ts).
 */

const Required: FormTemplateFieldSetting = FormTemplateFieldSetting.Required;
const Optional: FormTemplateFieldSetting = FormTemplateFieldSetting.Optional;
const Hidden: FormTemplateFieldSetting = FormTemplateFieldSetting.Hidden;

const OUTAGE: FormTemplate = {
  id: "outage",
  name: "Application Outage",
  answers: { title: "The application is down" },
  fieldSettings: { app: Required, facilities: Required, window: Hidden },
};

const MAINTENANCE: FormTemplate = {
  id: "maintenance",
  name: "Planned Maintenance",
  answers: { title: "Planned maintenance" },
  fieldSettings: { app: Required, facilities: Optional, window: Required },
};

const RESTORED: FormTemplate = {
  id: "restored",
  name: "Service Restored",
  answers: { title: "Service restored" },
};

function asked(isAsked: boolean, isRequired: boolean): FormQuestionAsked {
  return { isAsked, isRequired };
}

describe("the settings a template can give a question", () => {
  test("are Required, Optional and Hidden, spelled as they are stored, in the picker's order", () => {
    expect(FORM_TEMPLATE_FIELD_SETTINGS).toEqual([
      "Required",
      "Optional",
      "Hidden",
    ]);
    expect(Object.values(FormTemplateFieldSetting).sort()).toEqual(
      [...FORM_TEMPLATE_FIELD_SETTINGS].sort(),
    );
  });

  test.each(["Required", "Optional", "Hidden"])(
    "%s is a setting",
    (value: string) => {
      expect(isFormTemplateFieldSetting(value)).toBe(true);
    },
  );

  test.each([
    ["the form's default, which is no setting", "Default"],
    ["another spelling", "required"],
    ["padding", " Hidden"],
    ["nothing", ""],
    ["null", null],
    ["undefined", undefined],
    ["a boolean", true],
    ["a number", 1],
    ["a list", ["Hidden"]],
    ["an object", { setting: "Hidden" }],
  ])("%s is not one", (_label: string, value: unknown) => {
    expect(isFormTemplateFieldSetting(value)).toBe(false);
  });
});

describe("getFormQuestionAsked - how a question is asked once the template has had its say", () => {
  describe("with no setting, as the form asks it", () => {
    test("a required question is asked, and required", () => {
      expect(
        getFormQuestionAsked({ isRequired: true, isHidden: false }),
      ).toEqual(asked(true, true));
    });

    test("an optional question is asked, and optional", () => {
      expect(
        getFormQuestionAsked({ isRequired: false, isHidden: false }),
      ).toEqual(asked(true, false));
    });

    test("a hidden question is not asked", () => {
      expect(
        getFormQuestionAsked({ isRequired: false, isHidden: true }),
      ).toEqual(asked(false, false));
    });

    test("a hidden question is never required, whatever a stored row says", () => {
      expect(
        getFormQuestionAsked({ isRequired: true, isHidden: true }),
      ).toEqual(asked(false, false));
    });

    test.each([null, undefined])(
      "a setting of %s is the form's default",
      (setting: null | undefined) => {
        expect(
          getFormQuestionAsked({ isRequired: true, isHidden: false, setting }),
        ).toEqual(asked(true, true));
        expect(
          getFormQuestionAsked({ isRequired: false, isHidden: true, setting }),
        ).toEqual(asked(false, false));
      },
    );
  });

  // Every setting against every way the form can ask a question.
  const FORM_STATES: Array<[string, boolean, boolean]> = [
    ["a required question", true, false],
    ["an optional question", false, false],
    ["a hidden question", false, true],
  ];

  describe.each(FORM_STATES)(
    "%s",
    (_label: string, isRequired: boolean, isHidden: boolean) => {
      test("Required asks it, and requires it", () => {
        expect(
          getFormQuestionAsked({ isRequired, isHidden, setting: Required }),
        ).toEqual(asked(true, true));
      });

      test("Optional asks it, and lets it be left empty", () => {
        expect(
          getFormQuestionAsked({ isRequired, isHidden, setting: Optional }),
        ).toEqual(asked(true, false));
      });

      test("Hidden does not ask it", () => {
        expect(
          getFormQuestionAsked({ isRequired, isHidden, setting: Hidden }),
        ).toEqual(asked(false, false));
      });
    },
  );

  describe("a question the target cannot be created without", () => {
    test.each([undefined, Required, Optional, Hidden])(
      "is asked, and required, whatever the template says (%s)",
      (setting: FormTemplateFieldSetting | undefined) => {
        expect(
          getFormQuestionAsked({
            isRequired: true,
            isHidden: false,
            isLocked: true,
            setting,
          }),
        ).toEqual(asked(true, true));
      },
    );

    test("even when a stored row says the form hides it", () => {
      expect(
        getFormQuestionAsked({
          isRequired: false,
          isHidden: true,
          isLocked: true,
        }),
      ).toEqual(asked(true, true));
    });
  });
});

describe("getFormTemplateFieldSetting - one question's setting", () => {
  test("the setting the template lists for it", () => {
    expect(getFormTemplateFieldSetting(OUTAGE, "app")).toBe(Required);
    expect(getFormTemplateFieldSetting(OUTAGE, "window")).toBe(Hidden);
    expect(getFormTemplateFieldSetting(MAINTENANCE, "facilities")).toBe(
      Optional,
    );
  });

  test("nothing for a question it does not list, or a template with no settings", () => {
    expect(getFormTemplateFieldSetting(OUTAGE, "title")).toBeUndefined();
    expect(getFormTemplateFieldSetting(RESTORED, "app")).toBeUndefined();
    expect(getFormTemplateFieldSetting(null, "app")).toBeUndefined();
    expect(getFormTemplateFieldSetting(undefined, "app")).toBeUndefined();
    expect(
      getFormTemplateFieldSetting({ fieldSettings: null }, "app"),
    ).toBeUndefined();
  });

  test("never one of Object.prototype's: a question may be called constructor", () => {
    for (const id of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
      expect(getFormTemplateFieldSetting(OUTAGE, id)).toBeUndefined();
    }

    expect(
      getFormTemplateFieldSetting(
        { fieldSettings: { constructor: Hidden } },
        "constructor",
      ),
    ).toBe(Hidden);
  });

  test("nothing for a value that is not a setting", () => {
    expect(
      getFormTemplateFieldSetting(
        {
          fieldSettings: {
            app: "required",
          } as unknown as FormTemplateFieldSettings,
        },
        "app",
      ),
    ).toBeUndefined();
  });
});

describe("readFormTemplates - the settings, as the dashboard and the server read them", () => {
  test("keeps every setting of a question id, as stored", () => {
    expect(readFormTemplates([OUTAGE, MAINTENANCE])).toEqual([
      OUTAGE,
      MAINTENANCE,
    ]);
  });

  test("a template stored before templates had settings reads back exactly as it was", () => {
    const stored: Array<JSONObject> = [
      {
        id: "restored",
        name: "Service Restored",
        isDefault: true,
        answers: { title: "Service restored" },
      },
    ];

    const read: Array<FormTemplate> = readFormTemplates(stored);

    expect(read).toEqual(stored);
    expect(read[0]).not.toHaveProperty("fieldSettings");
  });

  test("drops a setting that is not one, a key that is not a question id, and null - the form's default", () => {
    const read: Array<FormTemplate> = readFormTemplates([
      {
        id: "outage",
        name: "Outage",
        answers: {},
        fieldSettings: {
          app: "Required",
          facilities: "required",
          window: null,
          title: "Default",
          "has space": "Hidden",
          _leading: "Hidden",
          severity: 7,
          email: "Hidden",
        },
      },
    ]);

    expect(read[0]!.fieldSettings).toEqual({ app: Required, email: Hidden });
  });

  test("a template left with no settings carries none", () => {
    for (const fieldSettings of [{}, { app: "Nope" }, null, "Hidden", []]) {
      const read: Array<FormTemplate> = readFormTemplates([
        { id: "a", name: "A", answers: {}, fieldSettings },
      ]);

      expect(read[0]).not.toHaveProperty("fieldSettings");
    }
  });

  test("a key such as __proto__ never becomes the settings' prototype", () => {
    const stored: unknown = JSON.parse(
      '[{"id":"a","name":"A","answers":{},"fieldSettings":{"__proto__":{"polluted":"Hidden"},"app":"Hidden"}}]',
    );

    const read: Array<FormTemplate> = readFormTemplates(stored);

    expect(read[0]!.fieldSettings).toEqual({ app: Hidden });
    expect(Object.getPrototypeOf(read[0]!.fieldSettings)).toBe(
      Object.prototype,
    );
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test("reads at most as many settings as a form has questions", () => {
    const fieldSettings: Record<string, string> = {};

    for (let index: number = 0; index < FORM_MAX_FIELDS + 10; index++) {
      fieldSettings[`q${index}`] = "Hidden";
    }

    const read: Array<FormTemplate> = readFormTemplates([
      { id: "a", name: "A", answers: {}, fieldSettings },
    ]);

    expect(Object.keys(read[0]!.fieldSettings!)).toHaveLength(FORM_MAX_FIELDS);
  });

  test("the settings read are a copy: changing them never changes what was stored", () => {
    const stored: Array<JSONObject> = [
      {
        id: "a",
        name: "A",
        answers: {},
        fieldSettings: { app: "Hidden" },
      },
    ];

    const read: Array<FormTemplate> = readFormTemplates(stored);
    read[0]!.fieldSettings!["app"] = Required;

    expect((stored[0]!["fieldSettings"] as JSONObject)["app"]).toBe("Hidden");
  });
});

describe("validateFormTemplates - what settings may be stored", () => {
  test("accepts templates with settings, and without", () => {
    expect(validateFormTemplates([OUTAGE, MAINTENANCE, RESTORED])).toBeNull();
  });

  test.each([null, undefined])(
    "accepts %s settings: the form's default for every question",
    (fieldSettings: null | undefined) => {
      expect(
        validateFormTemplates([{ ...RESTORED, fieldSettings }]),
      ).toBeNull();
    },
  );

  test("accepts null for one question: that question is asked as the form asks it", () => {
    expect(
      validateFormTemplates([
        { ...RESTORED, fieldSettings: { app: null, window: "Hidden" } },
      ]),
    ).toBeNull();
  });

  test.each([
    ["text", "Hidden"],
    ["a list", ["Hidden"]],
    ["a number", 3],
    ["true", true],
  ])(
    "refuses settings that are %s, not an object keyed by question",
    (_label: string, fieldSettings: unknown) => {
      expect(validateFormTemplates([{ ...RESTORED, fieldSettings }])).toBe(
        'Template 1 ("Service Restored"): its field settings must be an object keyed by question.',
      );
    },
  );

  test("refuses a key that cannot be a question id", () => {
    expect(
      validateFormTemplates([
        { ...RESTORED, fieldSettings: { "not an id": "Hidden" } },
      ]),
    ).toBe(
      'Template 1 ("Service Restored"): its field settings must be keyed by question id.',
    );
  });

  test.each([
    ["another spelling", "hidden"],
    ["the form's default spelled out", "Default"],
    ["an empty setting", ""],
    ["a number", 1],
    ["a yes/no", false],
    ["a list", ["Hidden"]],
  ])(
    "refuses %s, naming the three settings there are",
    (_label: string, setting: unknown) => {
      expect(
        validateFormTemplates([
          { ...RESTORED, fieldSettings: { app: setting } },
        ]),
      ).toBe(
        'Template 1 ("Service Restored"): each field setting must be Required, Optional or Hidden.',
      );
    },
  );

  test("refuses more settings than a form has questions", () => {
    const fieldSettings: Record<string, string> = {};

    for (let index: number = 0; index <= FORM_MAX_FIELDS; index++) {
      fieldSettings[`q${index}`] = "Hidden";
    }

    expect(validateFormTemplates([{ ...RESTORED, fieldSettings }])).toBe(
      `Template 1 ("Service Restored") cannot set more than ${FORM_MAX_FIELDS} questions.`,
    );
  });

  test("names the template a problem is in, among every other problem", () => {
    expect(
      validateFormTemplates([
        OUTAGE,
        { ...MAINTENANCE, fieldSettings: { app: "Mandatory" } },
        { id: "x", name: "", answers: {} },
      ]),
    ).toBe(
      'Template 2 ("Planned Maintenance"): each field setting must be Required, Optional or Hidden. Template 3 needs a name.',
    );
  });

  test("checks the settings of a template whose answers are missing too", () => {
    expect(
      validateFormTemplates([
        { id: "a", name: "A", fieldSettings: { app: "Sometimes" } },
      ]),
    ).toBe(
      'Template 1 ("A"): each field setting must be Required, Optional or Hidden.',
    );
  });
});

describe("the list operations carry the settings", () => {
  test("Duplicate copies how the template asks each question, as a copy of its own", () => {
    const change: FormTemplatesChange = duplicateFormTemplate({
      templates: [OUTAGE, MAINTENANCE],
      id: "outage",
    });

    const copy: FormTemplate = change.templates[1]!;

    expect(copy.name).toBe("Application Outage 2");
    expect(copy.fieldSettings).toEqual(OUTAGE.fieldSettings);
    expect(copy.fieldSettings).not.toBe(OUTAGE.fieldSettings);

    copy.fieldSettings!["window"] = Required;

    expect(OUTAGE.fieldSettings!["window"]).toBe(Hidden);
  });

  test("a copy of a template that sets nothing sets nothing", () => {
    const change: FormTemplatesChange = duplicateFormTemplate({
      templates: [RESTORED],
      id: "restored",
    });

    expect(change.templates[1]).not.toHaveProperty("fieldSettings");
  });

  test("saving keeps a template's settings, and drops an empty set of them", () => {
    expect(
      saveFormTemplate({ templates: [RESTORED], template: OUTAGE }).templates,
    ).toEqual([RESTORED, OUTAGE]);

    const saved: Array<FormTemplate> = saveFormTemplate({
      templates: [OUTAGE],
      template: { ...OUTAGE, fieldSettings: {} },
    }).templates;

    expect(saved[0]).not.toHaveProperty("fieldSettings");
  });
});

describe("limitFormTemplatesToQuestions - a copy of a form keeps what its questions can use", () => {
  test("keeps the answers to, and settings for, the questions listed, and drops the rest", () => {
    const limited: Array<FormTemplate> = limitFormTemplatesToQuestions({
      templates: [
        {
          ...OUTAGE,
          answers: { title: "Down", removed: "x" },
          fieldSettings: { app: "Required", removed: "Hidden" },
        },
      ],
      fieldIds: ["title", "app", "facilities"],
    });

    expect(limited).toEqual([
      {
        id: "outage",
        name: "Application Outage",
        answers: { title: "Down" },
        fieldSettings: { app: Required },
      },
    ]);
  });

  test("a template left with no settings carries none, and the default stays the default", () => {
    const limited: Array<FormTemplate> = limitFormTemplatesToQuestions({
      templates: [
        { ...MAINTENANCE, isDefault: true, fieldSettings: { gone: "Hidden" } },
      ],
      fieldIds: ["title"],
    });

    expect(limited[0]).not.toHaveProperty("fieldSettings");
    expect(limited[0]!.isDefault).toBe(true);
    expect(limited[0]!.answers).toEqual({ title: "Planned maintenance" });
  });

  test("templates that cannot be read are none; a form with no templates keeps none", () => {
    expect(
      limitFormTemplatesToQuestions({ templates: null, fieldIds: ["title"] }),
    ).toEqual([]);
    expect(
      limitFormTemplatesToQuestions({
        templates: [{ id: "no name", answers: {} }, OUTAGE],
        fieldIds: ["title"],
      }).map((template: FormTemplate): string => {
        return template.id;
      }),
    ).toEqual(["outage"]);
  });

  test("never changes the templates it was handed", () => {
    const templates: Array<FormTemplate> = [
      JSON.parse(JSON.stringify(OUTAGE)) as FormTemplate,
    ];

    limitFormTemplatesToQuestions({ templates, fieldIds: [] });

    expect(templates).toEqual([OUTAGE]);
  });
});
