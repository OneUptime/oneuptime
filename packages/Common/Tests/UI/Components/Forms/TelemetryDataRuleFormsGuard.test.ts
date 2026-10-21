import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "Log and trace drop filters, scrub rules and pipelines start from what
 * the rule does, with server defaults shown and no empty custom regex."
 *
 * Logs > Settings and Traces > Settings opened every create form on a Basic
 * Info step - a name, a description and an Enabled switch - and asked what
 * the rule does only after it. Each now starts from the rule:
 *
 *   - a drop filter walks Match (the name and the filter query), then Action
 *     (the action, the sample percentage for Sample), with the description
 *     and Enabled folded under Advanced at the end;
 *   - a scrub rule is one page: the pattern type, its regex right under it
 *     for Custom Regex, the name (it follows the type), then the
 *     description, action, fields and Enabled folded under Advanced;
 *   - a pipeline is a name, with the description folded; Enabled is not
 *     asked (the column defaults to on, and a pipeline without processors
 *     changes nothing).
 *
 * The two pages of each kind build their form from one builder
 * (Components/Telemetry/DropFilterForm, ScrubRuleForm), so they cannot
 * drift apart. This guard reads the six forms the way the long-form guards
 * do (Tests/Helpers/FormStepsScan) and pins those shapes.
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

interface DataRulePage {
  file: string;
  form: string;
}

type PagesFunction = (page: string, kind: string) => Array<DataRulePage>;

// The Logs and the Traces page of one kind of rule.
const pagesOf: PagesFunction = (
  page: string,
  kind: string,
): Array<DataRulePage> => {
  return [
    {
      file: `${DASHBOARD}/Pages/Logs/Settings/${page}`,
      form: `ModelTable: Logs > Settings > ${kind}`,
    },
    {
      file: `${DASHBOARD}/Pages/Traces/Settings/${page}`,
      form: `ModelTable: Traces > Settings > ${kind}`,
    },
  ];
};

const DROP_FILTER_PAGES: Array<DataRulePage> = pagesOf(
  "DropFilters.tsx",
  "Drop Filters",
);
const SCRUB_RULE_PAGES: Array<DataRulePage> = pagesOf(
  "ScrubRules.tsx",
  "Scrub Rules",
);
const PIPELINE_PAGES: Array<DataRulePage> = pagesOf(
  "Pipelines.tsx",
  "Pipelines",
);

const ALL_PAGES: Array<DataRulePage> = [
  ...DROP_FILTER_PAGES,
  ...SCRUB_RULE_PAGES,
  ...PIPELINE_PAGES,
];

const forms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: ALL_PAGES.map((page: DataRulePage): string => {
    return path.join(REPOSITORY_ROOT, page.file);
  }),
});

type FindFormFunction = (page: DataRulePage) => FormFacts;

const findForm: FindFormFunction = (page: DataRulePage): FormFacts => {
  const form: FormFacts | undefined = forms.find(
    (candidate: FormFacts): boolean => {
      return candidate.file === page.file && candidate.label === page.form;
    },
  );

  if (!form) {
    throw new Error(`${page.file} has no form labelled ${page.form}.`);
  }

  return form;
};

type KeysFunction = (fields: Array<FormFieldFacts>) => Array<string>;

const keys: KeysFunction = (fields: Array<FormFieldFacts>): Array<string> => {
  return fields.map((field: FormFieldFacts): string => {
    return field.key;
  });
};

type FieldsFunction = (form: FormFacts) => Array<FormFieldFacts>;

const openFields: FieldsFunction = (form: FormFacts): Array<FormFieldFacts> => {
  return form.fields.filter((field: FormFieldFacts): boolean => {
    return field.collapsibleSection === undefined;
  });
};

const foldedFields: FieldsFunction = (
  form: FormFacts,
): Array<FormFieldFacts> => {
  return form.fields.filter((field: FormFieldFacts): boolean => {
    return field.collapsibleSection !== undefined;
  });
};

type OnStepFunction = (form: FormFacts, stepId: string) => Array<string>;

const keysOnStep: OnStepFunction = (
  form: FormFacts,
  stepId: string,
): Array<string> => {
  return keys(
    form.fields.filter((field: FormFieldFacts): boolean => {
      return field.stepId === stepId;
    }),
  );
};

// Comments out: what the code does, not what a comment says about it.
type ReadCodeFunction = (file: string) => string;

const readCode: ReadCodeFunction = (file: string): string => {
  return fs
    .readFileSync(path.join(REPOSITORY_ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
};

// The fields that only say what a record is called and whether it is on.
const IDENTITY_KEYS: ReadonlySet<string> = new Set<string>([
  "name",
  "description",
  "isEnabled",
  "labels",
]);

describe("the log and trace data rule forms", () => {
  test("open on no Basic Info step", () => {
    for (const page of ALL_PAGES) {
      for (const step of findForm(page).steps || []) {
        expect(step.titleTexts).not.toContain("Basic Info");
      }
    }
  });

  test("are really read", () => {
    expect(forms.length).toBeGreaterThanOrEqual(ALL_PAGES.length);

    for (const page of ALL_PAGES) {
      expect(findForm(page).uncountableReasons).toEqual([]);
    }
  });

  /*
   * A pipeline is the exception, on purpose: what it does - its filter and
   * processors - is set up on its own page, which creating one opens.
   */
  test("never open on a step that only names the rule", () => {
    for (const page of [...DROP_FILTER_PAGES, ...SCRUB_RULE_PAGES]) {
      const form: FormFacts = findForm(page);

      const firstStep: FormStepFacts | undefined = (form.steps || [])[0];

      const firstKeys: Array<string> = firstStep?.id
        ? keysOnStep(form, firstStep.id)
        : keys(openFields(form));

      expect(
        firstKeys.some((key: string): boolean => {
          return !IDENTITY_KEYS.has(key);
        }),
      ).toBe(true);
    }
  });

  test("never ask whether a new rule is on with a switch out in the open", () => {
    for (const page of ALL_PAGES) {
      const form: FormFacts = findForm(page);

      expect(keys(openFields(form))).not.toContain("isEnabled");
    }
  });
});

describe.each(DROP_FILTER_PAGES)("$form", (page: DataRulePage) => {
  const form: FormFacts = findForm(page);

  test("walks Match, then Action", () => {
    expect(
      (form.steps || []).map((step: FormStepFacts): Array<unknown> => {
        return [step.id, step.titleTexts];
      }),
    ).toEqual([
      ["match", ["Match"]],
      ["action", ["Action"]],
    ]);
  });

  test("asks for the name and the filter query on Match", () => {
    expect(keysOnStep(form, "match")).toEqual(["name", "filterQuery"]);
  });

  test("asks what happens on Action, the description and Enabled folded at its end", () => {
    expect(keysOnStep(form, "action")).toEqual([
      "action",
      "samplePercentage",
      "description",
      "isEnabled",
    ]);
    expect(keys(foldedFields(form))).toEqual(["description", "isEnabled"]);
    expect(
      new Set(
        foldedFields(form).map((field: FormFieldFacts): string | undefined => {
          return field.collapsibleSection;
        }),
      ).size,
    ).toBe(1);
    expect(form.fields[form.fields.length - 1]?.key).toBe("isEnabled");
  });

  test("shows the percentage only for Sample", () => {
    const samplePercentage: FormFieldFacts | undefined = form.fields.find(
      (field: FormFieldFacts): boolean => {
        return field.key === "samplePercentage";
      },
    );

    expect(samplePercentage?.isConditional).toBe(true);
  });

  test("builds its form with the shared drop filter builder", () => {
    const code: string = readCode(page.file);

    expect(code).toMatch(/get(Log|Trace)DropFilterFormFields\(\)/);
    expect(code).toContain("getDropFilterFormSteps<");
    expect(code).not.toContain("FormFieldSchemaType.");
    expect(code).not.toContain("stepId:");
  });
});

describe.each(SCRUB_RULE_PAGES)("$form", (page: DataRulePage) => {
  const form: FormFacts = findForm(page);

  test("is one page", () => {
    expect(form.hasSteps).toBe(false);
  });

  test("starts from the pattern type, its regex under it, then the name", () => {
    expect(keys(openFields(form))).toEqual([
      "patternType",
      "customRegex",
      "name",
    ]);

    const customRegex: FormFieldFacts | undefined = form.fields.find(
      (field: FormFieldFacts): boolean => {
        return field.key === "customRegex";
      },
    );
    expect(customRegex?.isConditional).toBe(true);
  });

  test("folds the description, the action, the fields and Enabled under one Advanced, last", () => {
    expect(keys(foldedFields(form))).toEqual([
      "description",
      "scrubAction",
      "fieldsToScrub",
      "isEnabled",
    ]);
    expect(
      new Set(
        foldedFields(form).map((field: FormFieldFacts): string | undefined => {
          return field.collapsibleSection;
        }),
      ).size,
    ).toBe(1);
    expect(form.fields[form.fields.length - 1]?.key).toBe("isEnabled");
  });

  test("starts the folded columns at the server's defaults", () => {
    const defaults: Record<string, string | undefined> = {};

    for (const field of foldedFields(form)) {
      defaults[field.key] = field.defaultValue;
    }

    expect(defaults).toMatchObject({
      scrubAction: "options.defaults.scrubAction",
      fieldsToScrub: "options.defaults.fieldsToScrub",
      isEnabled: "options.defaults.isEnabled",
    });
  });

  test("is four rows, the fourth only for Custom Regex", () => {
    expect(form.visibleFieldCount).toBe(4);
  });

  test("builds its form with the shared scrub rule builder, and flags rules that scrub nothing", () => {
    const code: string = readCode(page.file);

    expect(code).toMatch(/get(Log|Trace)ScrubRuleFormFields\(\)/);
    expect(code).not.toContain("FormFieldSchemaType.");
    expect(code).not.toContain("formSteps=");
    expect(code).toContain("<ScrubRulePatternPill");
    expect(code).toContain("customRegex: true");
  });
});

describe.each(PIPELINE_PAGES)("$form", (page: DataRulePage) => {
  const form: FormFacts = findForm(page);

  test("asks for the name, the description folded, and not whether it is on", () => {
    expect(form.hasSteps).toBe(false);
    expect(keys(openFields(form))).toEqual(["name"]);
    expect(keys(foldedFields(form))).toEqual(["description"]);
    expect(keys(form.fields)).not.toContain("isEnabled");
    expect(form.visibleFieldCount).toBe(2);
  });

  test("opens the new pipeline's page, where its filter and processors are set up", () => {
    const code: string = readCode(page.file);

    expect(code).toContain("onCreateSuccess=");
    expect(code).toContain("Navigation.navigate(getPipelineRoute(item))");
    expect(code).toMatch(/PageMap\.(LOGS|TRACES)_SETTINGS_PIPELINE_VIEW/);
  });
});

describe("the Logs and the Traces page of each kind", () => {
  test.each([
    ["drop filters", DROP_FILTER_PAGES],
    ["scrub rules", SCRUB_RULE_PAGES],
    ["pipelines", PIPELINE_PAGES],
  ] as Array<[string, Array<DataRulePage>]>)(
    "ask the same %s questions, on the same steps",
    (_kind: string, pages: Array<DataRulePage>) => {
      const shapes: Array<Array<string>> = pages.map(
        (page: DataRulePage): Array<string> => {
          return findForm(page).fields.map((field: FormFieldFacts): string => {
            return `${field.key}@${field.stepId ?? "-"}${
              field.collapsibleSection ? " (folded)" : ""
            }`;
          });
        },
      );

      expect(shapes[1]).toEqual(shapes[0]);
    },
  );
});
