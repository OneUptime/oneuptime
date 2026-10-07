import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listSourceFiles } from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  countFormRows,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "Metric pipeline rules and recording rules lose their Basic Info steps;
 * All/Any appears only with two filters."
 *
 * Metrics > Settings > Pipeline Rules opened on a Basic Info step - a name,
 * a description, a service and an Enabled switch - and its Match step then
 * asked All or Any before there was a filter to combine. The metric and
 * trace Recording Rules opened on Basic Info too, with what the rule
 * computes on a second step. Now:
 *
 *   - a pipeline rule walks Match (the name, the filters, Match Condition
 *     only once there are two filters, then the description, the one
 *     service it is for and Enabled folded under More fields), then Action,
 *     unchanged;
 *   - a recording rule is one page: the name, the output metric line made
 *     from it (an ordinary field on Edit), the definition, then the
 *     description and Enabled folded;
 *   - both recording rule lists are in name order: every enabled rule is
 *     evaluated each minute on its own, and nothing reads sortOrder.
 *
 * This guard reads the three forms the way the long-form guards do
 * (Tests/Helpers/FormStepsScan) and pins those shapes, and holds every form
 * of the Logs, Metrics and Traces settings to opening on something other
 * than a Basic Info step - the log and trace data rules were brought there
 * by #4345, these three now.
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

interface RulePage {
  file: string;
  form: string;
}

const PIPELINE_RULES: RulePage = {
  file: `${DASHBOARD}/Pages/Metrics/Settings/PipelineRules.tsx`,
  form: "ModelTable: Metrics > Settings > Pipeline Rules",
};

const RECORDING_RULE_PAGES: Array<RulePage> = [
  {
    file: `${DASHBOARD}/Pages/Metrics/Settings/RecordingRules.tsx`,
    form: "ModelTable: Metrics > Settings > Recording Rules",
  },
  {
    file: `${DASHBOARD}/Pages/Traces/Settings/RecordingRules.tsx`,
    form: "ModelTable: Traces > Settings > Recording Rules",
  },
  // Log recording rules (logs in, metrics out) were made to the same shape.
  {
    file: `${DASHBOARD}/Pages/Logs/Settings/RecordingRules.tsx`,
    form: "ModelTable: Logs > Settings > Recording Rules",
  },
];

// Every settings page of the three telemetry products.
const TELEMETRY_SETTINGS_FILES: Array<string> = ["Logs", "Metrics", "Traces"]
  .map((product: string): string => {
    return path.join(REPOSITORY_ROOT, DASHBOARD, "Pages", product, "Settings");
  })
  .flatMap((directory: string): Array<string> => {
    return listSourceFiles(directory);
  });

const forms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: TELEMETRY_SETTINGS_FILES,
});

type FindFormFunction = (page: RulePage) => FormFacts;

const findForm: FindFormFunction = (page: RulePage): FormFacts => {
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

type SectionCountFunction = (form: FormFacts) => number;

const foldedSectionCount: SectionCountFunction = (form: FormFacts): number => {
  return new Set(
    foldedFields(form).map((field: FormFieldFacts): string | undefined => {
      return field.collapsibleSection;
    }),
  ).size;
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

describe("the Logs, Metrics and Traces settings forms", () => {
  test("are really read", () => {
    expect(TELEMETRY_SETTINGS_FILES.length).toBeGreaterThan(10);
    // Drop filters, scrub rules and pipelines twice; the three here.
    expect(forms.length).toBeGreaterThanOrEqual(9);

    for (const page of [PIPELINE_RULES, ...RECORDING_RULE_PAGES]) {
      expect(findForm(page).uncountableReasons).toEqual([]);
    }
  });

  test("open on no Basic Info step", () => {
    const basicInfoSteps: Array<string> = forms.flatMap(
      (form: FormFacts): Array<string> => {
        return (form.steps || [])
          .filter((step: FormStepFacts): boolean => {
            return (step.titleTexts || [step.title]).includes("Basic Info");
          })
          .map((): string => {
            return `${form.file}:${form.line} ${form.label}`;
          });
      },
    );

    expect(basicInfoSteps).toEqual([]);
  });

  test("never open on a step that only names the rule", () => {
    for (const page of [PIPELINE_RULES, ...RECORDING_RULE_PAGES]) {
      const form: FormFacts = findForm(page);
      const firstStep: FormStepFacts | undefined = (form.steps || [])[0];

      const firstKeys: Array<string> = firstStep?.id
        ? keysOnStep(form, firstStep.id)
        : keys(openFields(form));

      expect({
        form: page.form,
        asksAboutTheRule: firstKeys.some((key: string): boolean => {
          return !IDENTITY_KEYS.has(key);
        }),
      }).toEqual({ form: page.form, asksAboutTheRule: true });
    }
  });

  test("never ask whether a new rule is on with a switch out in the open", () => {
    for (const page of [PIPELINE_RULES, ...RECORDING_RULE_PAGES]) {
      expect(keys(openFields(findForm(page)))).not.toContain("isEnabled");
      expect(keys(foldedFields(findForm(page)))).toContain("isEnabled");
    }
  });
});

describe(PIPELINE_RULES.form, () => {
  const form: FormFacts = findForm(PIPELINE_RULES);

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

  test("asks for the name and the filters on Match, the rest folded at its end", () => {
    expect(keysOnStep(form, "match")).toEqual([
      "name",
      "filters",
      "filterCondition",
      "description",
      "service",
      "isEnabled",
    ]);
    expect(keys(foldedFields(form))).toEqual([
      "description",
      "service",
      "isEnabled",
    ]);
    expect(foldedSectionCount(form)).toBe(1);

    for (const field of foldedFields(form)) {
      expect(field.stepId).toBe("match");
    }
  });

  test('calls its service scope "Only for one service"', () => {
    const service: FormFieldFacts | undefined = form.fields.find(
      (field: FormFieldFacts): boolean => {
        return field.key === "service";
      },
    );

    expect(service?.titleTexts).toEqual(["Only for one service"]);
  });

  test("asks how to combine filters only once there are two", () => {
    const filterCondition: FormFieldFacts | undefined = form.fields.find(
      (field: FormFieldFacts): boolean => {
        return field.key === "filterCondition";
      },
    );

    expect(filterCondition?.isConditional).toBe(true);
    // Hidden, it is saved with its default.
    expect(filterCondition?.defaultValue).toBe("FilterCondition.All");

    const code: string = readCode(PIPELINE_RULES.file);

    expect(code).toContain("return isFilterConditionNeeded(values.filters);");
  });

  test("asks what the rule does on Action, as before", () => {
    expect(keysOnStep(form, "action")).toEqual([
      "ruleType",
      "renameFromKey",
      "renameToKey",
      "addAttributeKey",
      "addAttributeValue",
      "redactReplacement",
      "samplePercentage",
    ]);
  });

  test("starts a rule with no filters and keeps its list in the order rules run", () => {
    expect(form.createInitialValueKeys).toEqual(["filters"]);

    const code: string = readCode(PIPELINE_RULES.file);

    expect(code).toContain('sortBy="sortOrder"');
    expect(code).toContain("enableDragAndDrop={true}");
  });
});

describe.each(RECORDING_RULE_PAGES)("$form", (page: RulePage) => {
  const form: FormFacts = findForm(page);

  test("is one page", () => {
    expect(form.hasSteps).toBe(false);
    expect(form.steps || []).toEqual([]);

    // No field names a step (a helper's reads as computed: it takes none).
    for (const field of form.fields) {
      expect(typeof field.stepId).not.toBe("string");
    }
  });

  test("asks for the name, with the output metric line under it, then the definition", () => {
    expect(keys(openFields(form))).toEqual([
      "name",
      "outputMetricName",
      "outputMetricName",
      "definition",
    ]);

    const [generated, editOnly] = form.fields.filter(
      (field: FormFieldFacts): boolean => {
        return field.key === "outputMetricName";
      },
    );

    expect(generated?.helper).toBe("getGeneratedKeyFormField");
    expect(editOnly?.isEditOnly).toBe(true);
  });

  test("folds the description and Enabled under one More fields, last", () => {
    expect(keys(foldedFields(form))).toEqual(["description", "isEnabled"]);
    expect(foldedSectionCount(form)).toBe(1);
    expect(form.fields[form.fields.length - 1]?.key).toBe("isEnabled");
    // The name, the line under it, the definition and the folded header.
    expect(countFormRows(form)).toBe(4);
  });

  test("starts a rule on, with an empty definition to fill in", () => {
    expect(form.createInitialValueKeys).toEqual(["isEnabled", "definition"]);
  });

  /*
   * Every enabled rule is evaluated each minute on its own (the recording
   * rule workers never sort), so the list is in name order and a new rule
   * is given no order of its own.
   */
  test("lists rules by name and never makes up an order for a new one", () => {
    const code: string = readCode(page.file);

    expect(code).toContain('sortBy="name"');

    /*
     * The column, named any way a page could: read, written, sorted or
     * dragged by. (The table's sortOrder prop is the direction of the name
     * sort, so it is not one of them.)
     */
    expect(
      [
        '"sortOrder"',
        ".sortOrder",
        "sortOrder:",
        "enableDragAndDrop",
        "onBeforeCreate=",
      ].filter((snippet: string): boolean => {
        return code.includes(snippet);
      }),
    ).toEqual([]);
  });
});

describe("the metric, trace and log recording rule pages", () => {
  test("ask the same questions, in the same places", () => {
    const shapes: Array<Array<string>> = RECORDING_RULE_PAGES.map(
      (page: RulePage): Array<string> => {
        return findForm(page).fields.map((field: FormFieldFacts): string => {
          return `${field.key}@${field.stepId ?? "-"}${
            field.collapsibleSection ? " (folded)" : ""
          }${field.isEditOnly ? " (edit)" : ""}`;
        });
      },
    );

    expect(shapes).toHaveLength(3);
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  test("say what their folded defaults do with the one shared sentence", () => {
    for (const page of RECORDING_RULE_PAGES) {
      expect(readCode(page.file)).toContain(
        "getSummary: getRecordingRuleAdvancedSummary",
      );
    }
  });
});
