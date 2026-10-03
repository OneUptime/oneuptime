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

interface ListedForm {
  file: string;
  form: string;
  reason: string;
}

const STATUS_PAGE_RESOURCE_REASON: string =
  "The display options of a status page resource or group (current status, uptime and its precision), on a step the resource panel, bulk add and the status page monitor rules share - their own tests walk it. Left for a pass over the status page resource forms as a whole, so the four keep one layout.";

export const ADVANCED_STEPS_ALLOWED: Array<ListedForm> = [
  {
    file: `${DASHBOARD}/Pages/StatusPages/View/MonitorRules.tsx`,
    form: "RuleTable: Status Page > Monitor Rules",
    reason: STATUS_PAGE_RESOURCE_REASON,
  },
  {
    file: `${DASHBOARD}/Components/StatusPage/BulkAddStatusPageMonitorsModal.tsx`,
    form: "BasicForm: Status Page > Add Multiple Monitors",
    reason: STATUS_PAGE_RESOURCE_REASON,
  },
  {
    file: `${DASHBOARD}/Pages/StatusPages/View/Resources.tsx`,
    form: "ModelFormModal #1",
    reason: STATUS_PAGE_RESOURCE_REASON,
  },
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

function advancedSteps(form: FormFacts): Array<FormStepFacts> {
  return (form.steps || []).filter((step: FormStepFacts): boolean => {
    return ADVANCED_STEP_TITLE.test(step.title.replace(/^["'`]|["'`]$/g, ""));
  });
}

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
    expect(forms.length).toBeGreaterThan(500);
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
   * The two wizards that had an Advanced step of their own: an LLM provider
   * (Additional Parameters) and a dashboard data source (custom headers and
   * per-type options). Their options are folded at the end of the step
   * before - on the create form and on the record's own page.
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
