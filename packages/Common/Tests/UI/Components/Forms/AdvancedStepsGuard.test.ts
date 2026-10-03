import { describe, expect, test } from "@jest/globals";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  MIN_SCANNED_FORMS,
  SourceFileSystem,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "Options like 'Show on create' and stuff ... should be hidden in the
 * advanced section of the page. There should be an advanced section, which
 * should be collapsed by default. You can expand it and click on those
 * options." - the maintainer, on the Create Custom Field form, and: "Can you
 * please do this everywhere else in the project where we have the same
 * issue?"
 *
 * A wizard step called "Advanced" is that issue in another shape: every new
 * record has to walk through a page of options almost nobody changes. Those
 * options now go in a collapsed Advanced section (getAdvancedFormSection) at
 * the end of the step before, which a create wizard walks past and an edit
 * dialog shows folded, saying "Configured" when something in it is set.
 *
 * This guard keeps it that way: no form host may declare a step titled
 * Advanced (Advanced Options, Advanced Settings...) unless it is listed
 * below with the reason it stays.
 *
 * It judges the title the step shows, not how the source spells it. The
 * Admin Dashboard's Global LLM Providers form kept an Advanced step after
 * the Dashboard's lost theirs, because its title was written
 * t("pages.settings.llmProviders.stepAdvanced") - a key, which a check of
 * the literal text never saw. The scan now reads a title through the
 * translation call, in the English locale of the front end it is drawn in
 * (FormStepFacts.titleTexts), through a constant or an object of copy, and
 * through both branches of a condition; a title it still cannot read fails
 * here too, so none can slip past again.
 */

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

const ADMIN_DASHBOARD: string = "packages/App/FeatureSet/AdminDashboard/src";

interface ListedForm {
  file: string;
  form: string;
  reason: string;
}

/*
 * The status page resource forms (a resource, a group, Add Multiple
 * Monitors and the status page monitor rules) left this list when their
 * display options were folded: StatusPageResourceFormsGuard.test.ts pins
 * where each one keeps them now.
 */
export const ADVANCED_STEPS_ALLOWED: Array<ListedForm> = [
  ...[
    [
      `${DASHBOARD}/Components/Workflow/CreateOAuthWorkflowVariableModal.tsx`,
      "ModelFormModal: Workflow > Create OAuth 2.0 Variable",
    ],
    [
      `${DASHBOARD}/Components/Workflow/WorkflowVariableView.tsx`,
      "CardModelDetail: Workflow > OAuth 2.0 Settings",
    ],
  ].map(([file, form]: Array<string>): ListedForm => {
    return {
      file: file!,
      form: form!,
      reason:
        "The OAuth 2.0 variable wizard (Variable, Provider, Credentials, Advanced) was laid out step by step with provider presets so its eight settings are never on one page; its Advanced step holds the token request's own options, which the presets fill in.",
    };
  }),
];

function key(form: { file: string; form?: string; label?: string }): string {
  return `${form.file} :: ${form.form ?? form.label}`;
}

const ADVANCED_STEP_TITLE: RegExp = /^Advanced\b/i;

// What a step's title can say on screen; its source text when unread.
function titleTextsOf(step: FormStepFacts): Array<string> {
  return step.titleTexts ?? [step.title.replace(/^["'`]|["'`]$/g, "")];
}

function isAdvancedStep(step: FormStepFacts): boolean {
  return titleTextsOf(step).some((text: string): boolean => {
    return ADVANCED_STEP_TITLE.test(text.trim());
  });
}

function advancedSteps(form: FormFacts): Array<FormStepFacts> {
  return (form.steps || []).filter(isAdvancedStep);
}

/*
 * The detector, on snippets: each front end's way of writing a translated
 * title is read as the text it shows. The snippets live where their front
 * end does, beside the English locale it reads.
 */
const VIRTUAL_ROOT: string = "/repo";

const ADMIN_PAGE: string = `${ADMIN_DASHBOARD}/Pages/Settings/Page.tsx`;
const ADMIN_LOCALE: string = `${ADMIN_DASHBOARD}/Locales/en.json`;
const DASHBOARD_PAGE: string = `${DASHBOARD}/Pages/Settings/Page.tsx`;
const DASHBOARD_LOCALE: string = `${DASHBOARD}/Locales/en.json`;
const STATUS_PAGE_PAGE: string =
  "packages/App/FeatureSet/StatusPage/src/Pages/Subscribe/Page.tsx";
const STATUS_PAGE_LOCALE: string =
  "packages/App/FeatureSet/StatusPage/src/Locales/en.json";

function virtualFileSystem(files: Record<string, string>): SourceFileSystem {
  return {
    readFile: (filePath: string): string | null => {
      const relative: string = path
        .relative(VIRTUAL_ROOT, filePath)
        .split(path.sep)
        .join("/");

      return Object.prototype.hasOwnProperty.call(files, relative)
        ? (files[relative] as string)
        : null;
    },
  };
}

// The one form on `page`, read with the other files given beside it.
function scanPage(page: string, files: Record<string, string>): FormFacts {
  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: VIRTUAL_ROOT,
    files: [path.join(VIRTUAL_ROOT, page)],
    fileSystem: virtualFileSystem(files),
  });

  expect(forms).toHaveLength(1);

  return forms[0]!;
}

// A ModelTable whose formSteps are `steps`, as written in source.
function tableWithSteps(steps: Array<string>, before: string = ""): string {
  const fieldLines: Array<string> = steps.map(
    (_step: string, index: number): string => {
      return `{ field: { field${index}: true }, title: "Field ${index}", stepId: "step-${index}", fieldType: FormFieldSchemaType.Text }`;
    },
  );
  const stepLines: Array<string> = steps.map(
    (title: string, index: number): string => {
      return `{ title: ${title}, id: "step-${index}" }`;
    },
  );

  return `${before}
    const Page = () => {
      const { t } = useTranslation();
      const translator = useTranslator();
      return <ModelTable name="Things" isCreateable={true} formSteps={[${stepLines.join(", ")}]} formFields={[${fieldLines.join(", ")}]} />;
    };`;
}

function titleTexts(form: FormFacts): Array<Array<string> | null> {
  return (form.steps || []).map((step: FormStepFacts): Array<string> | null => {
    return step.titleTexts;
  });
}

describe("the step title reader", () => {
  test("reads an Admin Dashboard t() key in the Admin Dashboard's English locale", () => {
    const form: FormFacts = scanPage(ADMIN_PAGE, {
      [ADMIN_PAGE]: tableWithSteps([
        't("pages.settings.things.stepBasicInfo")',
        't("pages.settings.things.stepAdvanced")',
      ]),
      [ADMIN_LOCALE]: JSON.stringify({
        pages: {
          settings: {
            things: {
              stepBasicInfo: "Basic Info",
              stepAdvanced: "Advanced",
            },
          },
        },
      }),
    });

    expect(titleTexts(form)).toEqual([["Basic Info"], ["Advanced"]]);
    expect(
      advancedSteps(form).map((step: FormStepFacts): string | null => {
        return step.id;
      }),
    ).toEqual(["step-1"]);
  });

  test("leaves an Admin Dashboard key its locale does not have unread, as it would be drawn as the key", () => {
    const form: FormFacts = scanPage(ADMIN_PAGE, {
      [ADMIN_PAGE]: tableWithSteps([
        't("pages.settings.things.stepBasicInfo")',
        't("pages.settings.things.stepGone")',
      ]),
      [ADMIN_LOCALE]: JSON.stringify({
        pages: { settings: { things: { stepBasicInfo: "Basic Info" } } },
      }),
    });

    expect(titleTexts(form)).toEqual([["Basic Info"], null]);
  });

  test("reads the Dashboard's English keys: translationKey, translateText, translateString and a template", () => {
    const form: FormFacts = scanPage(DASHBOARD_PAGE, {
      [DASHBOARD_PAGE]: tableWithSteps([
        'translationKey("Basic Info")',
        'translator.translateText("Advanced Options")',
        // Not extracted into en.json yet: shown in English all the same.
        'translateString("Advanced Settings")',
        'translator.translateTemplate("Advanced {{kind}} Options", { kind: kindName })',
      ]),
      [DASHBOARD_LOCALE]: JSON.stringify({
        "Basic Info": "Basic Info",
        "Advanced Options": "Advanced Options",
      }),
    });

    expect(titleTexts(form)).toEqual([
      ["Basic Info"],
      ["Advanced Options"],
      ["Advanced Settings"],
      ["Advanced {{kind}} Options"],
    ]);
    expect(advancedSteps(form)).toHaveLength(3);
  });

  test("reads the status page's translate() keys in its own locale", () => {
    const form: FormFacts = scanPage(STATUS_PAGE_PAGE, {
      [STATUS_PAGE_PAGE]: tableWithSteps([
        'data.translate("subscribe.steps.details")',
        'data.translate("subscribe.steps.more")',
      ]),
      [STATUS_PAGE_LOCALE]: JSON.stringify({
        subscribe: {
          steps: { details: "Details", more: "Advanced Preferences" },
        },
      }),
    });

    expect(titleTexts(form)).toEqual([["Details"], ["Advanced Preferences"]]);
    expect(advancedSteps(form)).toHaveLength(1);
  });

  test("follows a constant, an object of copy and a re-export to the text", () => {
    const form: FormFacts = scanPage(DASHBOARD_PAGE, {
      [DASHBOARD_PAGE]: tableWithSteps(
        [
          "BASIC_STEP_TITLE",
          "StepCopy.advanced",
          'StepCopy["details"]',
          "StepCopy.byKind[kind]",
          "ADVANCED_FROM_INDEX",
          "translator.translateText(StepCopy.advanced)",
        ],
        `import { StepCopy } from "./StepCopy";
         import { ADVANCED_FROM_INDEX } from "./Steps";
         const BASIC_STEP_TITLE = "Basic Info";`,
      ),
      [`${DASHBOARD}/Pages/Settings/StepCopy.ts`]: `
        export const StepCopy = {
          advanced: translationKey("Advanced"),
          details: "Details",
          byKind: { [Kind.Incident]: "Which Incidents", [Kind.Alert]: "Advanced Alerts" },
        };`,
      [`${DASHBOARD}/Pages/Settings/Steps.ts`]: `export { ADVANCED_STEP as ADVANCED_FROM_INDEX } from "./StepTitles";`,
      [`${DASHBOARD}/Pages/Settings/StepTitles.ts`]: `export const ADVANCED_STEP: string = "Advanced Options";`,
    });

    expect(titleTexts(form)).toEqual([
      ["Basic Info"],
      ["Advanced"],
      ["Details"],
      ["Which Incidents", "Advanced Alerts"],
      ["Advanced Options"],
      ["Advanced"],
    ]);
    expect(
      advancedSteps(form).map((step: FormStepFacts): string | null => {
        return step.id;
      }),
    ).toEqual(["step-1", "step-3", "step-4", "step-5"]);
  });

  test("reads both branches of a condition, and calls an Advanced step one when either is", () => {
    const form: FormFacts = scanPage(ADMIN_PAGE, {
      [ADMIN_PAGE]: tableWithSteps([
        'isEditing ? t("pages.things.stepMore") : "Details"',
      ]),
      [ADMIN_LOCALE]: JSON.stringify({
        pages: { things: { stepMore: "Advanced" } },
      }),
    });

    expect(titleTexts(form)).toEqual([["Advanced", "Details"]]);
    expect(advancedSteps(form)).toHaveLength(1);
  });

  test("leaves a title built at runtime unread", () => {
    const form: FormFacts = scanPage(DASHBOARD_PAGE, {
      [DASHBOARD_PAGE]: tableWithSteps([
        "getStepTitle()",
        "`${prefix} Settings`",
        "props.stepTitle",
        "t(someKey)",
      ]),
    });

    expect(titleTexts(form)).toEqual([null, null, null, null]);
  });
});

describe("rarely used options", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  test("are really read", () => {
    expect(forms.length).toBeGreaterThan(MIN_SCANNED_FORMS);
  });

  /*
   * A title the scan cannot read could say Advanced. Write it as a string,
   * a constant or a property of a constant object of copy, or a translation
   * call with its key written out (and in the locale).
   */
  test("on every step have a title the scan can read, translated ones included", () => {
    expect(
      forms.flatMap((form: FormFacts): Array<string> => {
        return (form.steps || [])
          .filter((step: FormStepFacts): boolean => {
            return step.titleTexts === null;
          })
          .map((step: FormStepFacts): string => {
            return `${form.file}:${form.line} ${form.label} - step "${step.id}" titled ${step.title}`;
          });
      }),
    ).toEqual([]);
  });

  test("on the Admin Dashboard are read in its own locale", () => {
    const adminTitles: Array<string> = forms
      .filter((form: FormFacts): boolean => {
        return form.file.startsWith(`${ADMIN_DASHBOARD}/`);
      })
      .flatMap((form: FormFacts): Array<FormStepFacts> => {
        return form.steps || [];
      })
      .filter((step: FormStepFacts): boolean => {
        return step.title.startsWith("t(");
      })
      .flatMap(titleTextsOf);

    // Some are written t("pages...") - and read as the English they show.
    expect(adminTitles.length).toBeGreaterThan(0);
    expect(
      adminTitles.filter((text: string): boolean => {
        return text.startsWith("pages.");
      }),
    ).toEqual([]);
  });

  test("sit in a folded Advanced section, never a wizard step of their own", () => {
    const allowed: Set<string> = new Set<string>(
      ADVANCED_STEPS_ALLOWED.map(key),
    );

    expect(
      forms
        .filter((form: FormFacts): boolean => {
          return advancedSteps(form).length > 0 && !allowed.has(key(form));
        })
        .map((form: FormFacts): string => {
          return `${form.file}:${form.line} ${form.label}`;
        }),
    ).toEqual([]);
  });

  test("the forms listed with an Advanced step still have one, so the list never goes stale", () => {
    const withAdvancedStep: Set<string> = new Set<string>(
      forms
        .filter((form: FormFacts): boolean => {
          return advancedSteps(form).length > 0;
        })
        .map(key),
    );

    expect(
      ADVANCED_STEPS_ALLOWED.filter((entry: ListedForm): boolean => {
        return !withAdvancedStep.has(key(entry));
      }),
    ).toEqual([]);

    for (const entry of ADVANCED_STEPS_ALLOWED) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  /*
   * The wizards that had an Advanced step of their own: an LLM provider
   * (Additional Parameters) on the Dashboard and the Admin Dashboard - where
   * the cost per million tokens, a step of its own too when projects are
   * billed for AI, is folded with it - a dashboard data source (custom
   * headers and per-type options) and a status page monitor rule (what is
   * shown beside the monitors it adds). Their options are folded at the end
   * of the step before - on the create form and on the record's own page.
   */
  test.each([
    [
      `${DASHBOARD}/Pages/Settings/LlmProviders.tsx`,
      "ModelTable",
      "provider-settings",
      ["isDefault", "additionalParams"],
    ],
    [
      `${DASHBOARD}/Pages/Settings/LlmProviderView.tsx`,
      "CardModelDetail",
      "provider-settings",
      ["isDefault", "additionalParams"],
    ],
    [
      `${ADMIN_DASHBOARD}/Pages/Settings/LlmProviders/Index.tsx`,
      "ModelTable",
      "provider-settings",
      ["additionalParams", "costPerMillionTokensInUSDCents"],
    ],
    [
      `${DASHBOARD}/Pages/Dashboards/Settings/DataSources.tsx`,
      "ModelTable",
      "auth",
      ["customHeaders", "additionalOptions"],
    ],
    [
      `${DASHBOARD}/Pages/Dashboards/Settings/DataSourceView.tsx`,
      "CardModelDetail",
      "auth",
      ["additionalOptions"],
    ],
    /*
     * A status page monitor rule: how each monitor it adds is shown, folded
     * on the step that says where the monitors land.
     */
    [
      `${DASHBOARD}/Pages/StatusPages/View/MonitorRules.tsx`,
      "RuleTable",
      "group",
      [
        "showCurrentStatus",
        "showUptimePercent",
        "uptimePercentPrecision",
        "showStatusHistoryChart",
      ],
    ],
  ])(
    "%s folds its options at the end of its last step",
    (file: string, host: string, stepId: string, folded: Array<string>) => {
      const form: FormFacts | undefined = forms.find(
        (candidate: FormFacts): boolean => {
          return candidate.file === file && candidate.host === host;
        },
      );

      expect(form).toBeDefined();
      expect(advancedSteps(form!)).toEqual([]);

      const steps: Array<string | null> = (form!.steps || []).map(
        (step: FormStepFacts): string | null => {
          return step.id;
        },
      );

      expect(steps[steps.length - 1]).toBe(stepId);

      const onStep: Array<FormFieldFacts> = form!.fields.filter(
        (field: FormFieldFacts): boolean => {
          return field.stepId === stepId;
        },
      );

      // The folded ones are the step's last fields, in one section.
      expect(
        onStep.slice(-folded.length).map((field: FormFieldFacts): string => {
          return field.key;
        }),
      ).toEqual(folded);

      const sections: Set<string | undefined> = new Set<string | undefined>(
        onStep.slice(-folded.length).map((field: FormFieldFacts) => {
          return field.collapsibleSection;
        }),
      );

      expect(sections.size).toBe(1);
      expect(Array.from(sections)[0]).toBe("advancedSection");

      for (const field of onStep.slice(0, -folded.length)) {
        expect(field.collapsibleSection).toBeUndefined();
      }
    },
  );
});
