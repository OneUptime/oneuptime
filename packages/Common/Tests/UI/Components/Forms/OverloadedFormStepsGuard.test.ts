import { describe, expect, test } from "@jest/globals";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  STEP_FIELD_LIMIT,
  SourceFileSystem,
  StepFieldCount,
  countStepFields,
  describeStepFieldCount,
  findOverloadedSteps,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "This Oauth 2.0 form has a lot of form steps. Can we please split this into
 * multiple form steps so we make it easier for users to understand whats
 * happening? Infact please audit forms everywhere in the project and if there
 * are a lot of options in single step, we can split in into multiple steps."
 * - the maintainer, on Create OAuth 2.0 Variable, whose second step asked for
 * eight settings on one scrolling page.
 *
 * LongFormStepsGuard.test.ts makes every long form walk steps. This one keeps
 * each step short: no step may show more than STEP_FIELD_LIMIT fields, unless
 * it is listed below with the reason it reads as one question anyway. Every
 * step over the limit was split when this guard was written; the ones listed
 * are those a split would make worse.
 *
 * The detector (countStepFields in Tests/Helpers/FormStepsScan.ts) is pinned
 * on inline snippets first, then run over the real tree, with checks that the
 * scan really read it.
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

interface ListedStep {
  // Repository-relative, with "/".
  file: string;
  // The form's label: see getFormLabel in FormStepsScan.ts.
  form: string;
  step: string;
  reason: string;
}

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const INHERIT_CHECKLIST_REASON: string =
  "One question - which resources to inherit from - answered with six switches of one kind, laid out in two columns. Splitting a checklist across steps would make it harder to answer, not easier.";

/*
 * Steps over the limit that stay as they are, and why. A step split later
 * must leave this list (the guard says so).
 */
export const LONG_STEPS_ALLOWED: Array<ListedStep> = [
  ...[
    [
      "Alerts/Settings/AlertOwnerRules.tsx",
      "RuleTable: Settings > Alert Owner Rules",
    ],
    [
      "Incidents/Settings/IncidentOwnerRules.tsx",
      "RuleTable: Settings > Incident Owner Rules",
    ],
    [
      "ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceOwnerRules.tsx",
      "RuleTable: Settings > Scheduled Maintenance Owner Rules",
    ],
  ].map(([file, form]: Array<string>): ListedStep => {
    return {
      file: `${DASHBOARD}/Pages/${file}`,
      form: form!,
      step: "inherit-owners",
      reason: INHERIT_CHECKLIST_REASON,
    };
  }),
  ...[
    [
      "Alerts/Settings/AlertLabelRules.tsx",
      "LabelRuleTable: Settings > Alert Label Rules",
    ],
    [
      "Incidents/Settings/IncidentLabelRules.tsx",
      "LabelRuleTable: Settings > Incident Label Rules",
    ],
    [
      "ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceLabelRules.tsx",
      "LabelRuleTable: Settings > Scheduled Maintenance Label Rules",
    ],
  ].map(([file, form]: Array<string>): ListedStep => {
    return {
      file: `${DASHBOARD}/Pages/${file}`,
      form: form!,
      step: "inherit-labels",
      reason: INHERIT_CHECKLIST_REASON,
    };
  }),
  /*
   * Read since the form's fields stopped going through a wrapper the scan
   * could not follow (the owner-user loader the owners picker replaced).
   */
  ...["alert-details", "incident-details"].map((step: string): ListedStep => {
    return {
      file: `${DASHBOARD}/Pages/Slo/View/BurnRateRules.tsx`,
      form: "ModelTable: SLO > Burn Rate Rules",
      step,
      reason:
        "Only the title and the severity are open: everything else on the step sits in four collapsed sections (Description, Ownership & Labels, On-Call, Advanced Options) that open one at a time, so the step reads as two fields and four headings.",
    };
  }),
  {
    file: `${DASHBOARD}/Pages/Metrics/Settings/PipelineRules.tsx`,
    form: "ModelTable: Metrics > Settings > Pipeline Rules",
    step: "action",
    reason:
      "Only the rule type and the one or two fields that type uses ever show: From and To to rename, Key and Value to add an attribute, a replacement to redact, a percentage to sample. The other fields are alternatives, never on screen together.",
  },
  ...[
    "ModelTable: Network Device Discovery Scans",
    "ModelFormModal: Edit Discovery Scan",
  ].map((form: string): ListedStep => {
    return {
      file: `${DASHBOARD}/Pages/NetworkDevice/Discovery.tsx`,
      form,
      step: "scan-target",
      reason:
        "The target, its probe and three switches about the sweep, already grouped under the headings What to check and Device names. Where each switch sits is pinned by issues #3445, #3677 and #3678 (the method switch before the SNMP step it removes, the NetBIOS and naming switches on a step an ICMP-only scan keeps), and the create wizard and the Edit dialog must keep one layout between them.",
    };
  }),
];

const VIRTUAL_ROOT: string = "/repo";

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

function only(files: Record<string, string>): FormFacts {
  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: VIRTUAL_ROOT,
    files: [path.join(VIRTUAL_ROOT, "Page.tsx")],
    fileSystem: virtualFileSystem(files),
  });

  expect(forms).toHaveLength(1);

  return forms[0]!;
}

function field(key: string, extra: string = ""): string {
  return `{ field: { ${key}: true }, title: "${key}", fieldType: FormFieldSchemaType.Text, ${extra} }`;
}

const NOT_A_LETTER: RegExp = /[^a-zA-Z]/g;

// `count` fields on one step, keyed after it ("matchcriteriaField1", ...).
function fieldsOn(stepId: string, count: number, extra: string = ""): string {
  const prefix: string = stepId.replace(NOT_A_LETTER, "");

  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return field(`${prefix}Field${index + 1}`, `stepId: "${stepId}", ${extra}`);
  }).join(",\n");
}

const TWO_STEPS: string = `[{ title: "One", id: "one" }, { title: "Two", id: "two" }]`;

function counts(form: FormFacts): Record<string, number> {
  const result: Record<string, number> = {};

  for (const count of countStepFields(form)) {
    result[count.step.id || ""] = count.count;
  }

  return result;
}

describe("the step size detector", () => {
  test(`allows ${STEP_FIELD_LIMIT} fields on a step, and no more`, () => {
    expect(STEP_FIELD_LIMIT).toBe(5);

    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Things" formSteps={${TWO_STEPS}} formFields={[${fieldsOn("one", 5)}, ${fieldsOn("two", 6)}]} />;`,
    });

    expect(counts(form)).toEqual({ one: 5, two: 6 });
    expect(
      findOverloadedSteps([form]).map((count: StepFieldCount) => {
        return count.step.id;
      }),
    ).toEqual(["two"]);
  });

  test("counts a field shown under a condition: the step can be that long", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <CardModelDetail name="Card" formSteps={${TWO_STEPS}} formFields={[${fieldsOn("one", 4)}, ${fieldsOn("one", 2, "showIf: (values) => Boolean(values.on),").replace(/oneField/g, "shownField")}, ${fieldsOn("two", 1)}]} />;`,
    });

    expect(counts(form)).toEqual({ one: 6, two: 1 });
  });

  test("does not count a registration that is never shown", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <CardModelDetail name="Card" formSteps={${TWO_STEPS}} formFields={[${fieldsOn("one", 5)}, ${field("hidden", 'stepId: "one", showIf: () => false,')}, ${fieldsOn("two", 1)}]} />;`,
    });

    expect(counts(form)).toEqual({ one: 5, two: 1 });
  });

  test("judges a table's step by the longer of its Create and Edit forms", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Things" isEditable={true} formSteps={${TWO_STEPS}} formFields={[${fieldsOn("one", 4)}, ${field("createOnly", 'stepId: "one", doNotShowWhenEditing: true,')}, ${field("editOnly", 'stepId: "one", doNotShowWhenCreating: true,')}, ${fieldsOn("two", 1)}]} />;`,
    });

    // Five on either form, never six at once.
    expect(counts(form)).toEqual({ one: 5, two: 1 });
  });

  test("counts a rule model's Match Criteria step as its one criteria builder", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import AlertOwnerRule from "./AlertOwnerRule";
        const Page = () => <RuleTable modelType={AlertOwnerRule} name="Rules" formSteps={[{ title: "Basic Info", id: "basic-info" }, { title: "Match Criteria", id: "match-criteria" }]} formFields={[${fieldsOn("basic-info", 2)}, ${fieldsOn("match-criteria", 8)}]} />;`,
      "AlertOwnerRule.ts": `export default class AlertOwnerRule extends RuleBaseModel {}`,
    });

    expect(form.isRuleModel).toBe(true);
    expect(counts(form)).toEqual({ "basic-info": 2, "match-criteria": 1 });
  });

  test("counts every field of a Match Criteria step on a model that is not a rule", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import Thing from "./Thing";
        const Page = () => <ModelTable modelType={Thing} name="Things" formSteps={[{ title: "Match Criteria", id: "match-criteria" }]} formFields={[${fieldsOn("match-criteria", 8)}]} />;`,
      "Thing.ts": `export default class Thing extends BaseModel {}`,
    });

    expect(form.isRuleModel).toBe(false);
    expect(counts(form)).toEqual({ "match-criteria": 8 });
  });

  test("reads the model of a card from its detail props", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import Rule from "./Rule";
        const Page = () => <CardModelDetail name="Rule" modelDetailProps={{ modelType: Rule }} formSteps={[{ title: "Match Criteria", id: "match-criteria" }]} formFields={[${fieldsOn("match-criteria", 7)}]} />;`,
      "Rule.ts": `export default class Rule extends RelationOnlyRuleBaseModel {}`,
    });

    expect(form.isRuleModel).toBe(true);
    expect(counts(form)).toEqual({ "match-criteria": 1 });
  });

  /*
   * A helper's field is on the step its call names: the owners picker is
   * getOwnersFormField({ stepId: "owners", ... }) on some forty forms.
   */
  test("places a helper's field on the step its call writes down", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import { getMacField } from "./Mac";
        const Page = () => <CardModelDetail name="Card" formSteps={${TWO_STEPS}} formFields={[${fieldsOn("one", 5)}, getMacField({ stepId: "one" }), ${fieldsOn("two", 1)}]} />;`,
      "Mac.ts": `export function getMacField(data) { return { field: { mac: true }, title: "MAC", stepId: data.stepId }; }`,
    });

    expect(counts(form)).toEqual({ one: 6, two: 1 });
    expect(
      findOverloadedSteps([form]).map((count: StepFieldCount) => {
        return count.step.id;
      }),
    ).toEqual(["one"]);
  });

  // A step the call computes is left to the helper's own tests.
  test("does not place a field whose step is not written down", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import { getMacField } from "./Mac";
        const STEP = "one";
        const Page = () => <CardModelDetail name="Card" formSteps={${TWO_STEPS}} formFields={[${fieldsOn("one", 5)}, getMacField({ stepId: STEP }), ${fieldsOn("two", 1)}]} />;`,
      "Mac.ts": `export function getMacField(data) { return { field: { mac: true }, title: "MAC", stepId: data.stepId }; }`,
    });

    expect(counts(form)).toEqual({ one: 5, two: 1 });
  });

  /*
   * Options folded under Advanced (getAdvancedFormSection) are one header
   * on the step until it is opened: the step is judged by what it shows.
   */
  test("counts a folded section on a step once", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const advanced = getAdvancedFormSection();
        const Page = () => <ModelTable name="Things" formSteps={${TWO_STEPS}} formFields={[${fieldsOn("one", 4)}, ${fieldsOn("one", 6, "collapsibleSection: advanced,").replace(/oneField/g, "foldedField")}, ${fieldsOn("two", 1)}]} />;`,
    });

    expect(counts(form)).toEqual({ one: 5, two: 1 });
    expect(findOverloadedSteps([form])).toEqual([]);
  });

  test("names a folded field as folded when it finds a long step", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelTable name="Things" formSteps={${TWO_STEPS}} formFields={[${fieldsOn("one", 1)}, ${fieldsOn("two", 5)}, ${field("folded", 'stepId: "two", collapsibleSection: advanced,')}]} />;`,
    });

    expect(describeStepFieldCount(findOverloadedSteps([form])[0]!)).toBe(
      'Page.tsx:2 ModelTable: Things - step "two" (Two) shows 6 fields: twoField1, twoField2, twoField3, twoField4, twoField5, folded (folded)',
    );
  });

  test("says nothing about a form without steps", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Things" formFields={[${fieldsOn("one", 9)}]} />;`,
    });

    expect(countStepFields(form)).toEqual([]);
    expect(findOverloadedSteps([form])).toEqual([]);
  });

  test("names the form, the step and its fields when it finds one", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Things" formSteps={${TWO_STEPS}} formFields={[${fieldsOn("one", 1)}, ${fieldsOn("two", 6)}]} />;`,
    });

    expect(describeStepFieldCount(findOverloadedSteps([form])[0]!)).toBe(
      'Page.tsx:1 ModelTable: Things - step "two" (Two) shows 6 fields: twoField1, twoField2, twoField3, twoField4, twoField5, twoField6',
    );
  });
});

function key(entry: { file: string; form: string; step: string }): string {
  return `${entry.file} :: ${entry.form} :: ${entry.step}`;
}

function keyOfCount(count: StepFieldCount): string {
  return key({
    file: count.form.file,
    form: count.form.label,
    step: count.step.id || "",
  });
}

describe("the project's stepped forms", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  const stepCounts: Array<StepFieldCount> = forms.flatMap(countStepFields);

  // A broken walk must not pass by finding nothing.
  test("are really read", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(stepCounts.length).toBeGreaterThan(600);
    expect(
      forms.filter((form: FormFacts): boolean => {
        return form.isRuleModel;
      }).length,
    ).toBeGreaterThan(50);
  });

  test(`show at most ${STEP_FIELD_LIMIT} fields on a step, or are listed with the reason they do not`, () => {
    const listed: Set<string> = new Set<string>(LONG_STEPS_ALLOWED.map(key));

    expect(
      findOverloadedSteps(forms)
        .filter((count: StepFieldCount): boolean => {
          return !listed.has(keyOfCount(count));
        })
        .map(describeStepFieldCount),
    ).toEqual([]);
  });

  test("listed as long are still long, so the list never goes stale", () => {
    const overloaded: Set<string> = new Set<string>(
      findOverloadedSteps(forms).map(keyOfCount),
    );

    expect(
      LONG_STEPS_ALLOWED.filter((entry: ListedStep): boolean => {
        return !overloaded.has(key(entry));
      }),
    ).toEqual([]);
  });

  test("give every listed step a reason", () => {
    for (const entry of LONG_STEPS_ALLOWED) {
      expect(entry.reason.length).toBeGreaterThan(60);
    }
  });

  // The forms this sweep split, so a step folded back together shows up here.
  test.each([
    [
      `${DASHBOARD}/Pages/SecurityEvents/DetectionRules.tsx`,
      "ModelTable: Security Events > Detection Rules",
      ["basic-info", "sigma-rule", "evaluation", "on-match"],
    ],
    [
      `${DASHBOARD}/Pages/SecurityEvents/ThreatIntel.tsx`,
      "ModelTable: Security Events > Threat Intel Feeds",
      ["basic-info", "taxii-server", "authentication", "matching"],
    ],
    [
      `${DASHBOARD}/Components/AutoRemediation/AutoRemediationRulesTable.tsx`,
      "ModelTable: Auto Remediation Rules",
      [
        "basic-info",
        "match-criteria",
        "remediation",
        "ai-commands",
        "verification",
      ],
    ],
    [
      `${DASHBOARD}/Pages/Rum/View/SessionReplaySettings.tsx`,
      "CardModelDetail: Session Replay Policy",
      ["recording", "privacy", "consent", "performance", "limits"],
    ],
    [
      `${DASHBOARD}/Pages/CodeRepository/View/Index.tsx`,
      "CardModelDetail: Repository > Repository Details",
      // Its labels fold under Advanced on Repository Info.
      ["repository-info", "source"],
    ],
    [
      `${DASHBOARD}/Pages/NetworkDevice/View/Settings.tsx`,
      "CardModelDetail: Device Settings",
      ["device-details", "address", "monitoring", "snmp"],
    ],
    [
      `${DASHBOARD}/Pages/Runbook/Runners/RunnerCredentials.tsx`,
      "ModelTable: Runbooks > Runner Credentials",
      ["credential", "ssh", "ssh-authentication", "kubernetes", "runners"],
    ],
    /*
     * Its one Rules step drew the whole rule (its own form, so the scan sees
     * one field there - see LongFormStepsGuard for that form).
     */
    [
      `${DASHBOARD}/Components/Workspace/WorkspaceNotificationRulesTable.tsx`,
      "ModelTable: Settings > Workspace Notification Rules",
      ["basic", "conditions", "destination"],
    ],
    /*
     * Grouping rules ask two questions and then create: Grouping (how to
     * group, how close together, name) and which incidents. Group By shows
     * only for a custom mix of switches, and the last three only behind
     * "Show advanced settings" (each switch-and-minutes setting is one
     * control, so Episode Lifecycle holds three).
     */
    ...[
      ["Alerts/Settings/AlertGroupingRules.tsx", "Alert"],
      ["Incidents/Settings/IncidentGroupingRules.tsx", "Incident"],
    ].map(([file, kind]: Array<string>): [string, string, Array<string>] => {
      return [
        `${DASHBOARD}/Pages/${file}`,
        `ModelTable: Settings > ${kind} Grouping Rules`,
        [
          "grouping",
          "group-by",
          "match-criteria",
          "episode-lifecycle",
          "details",
          "on-call-ownership",
        ],
      ];
    }),
    ...[
      ["Alerts/Settings/AlertOwnerRules.tsx", "Alert"],
      ["Incidents/Settings/IncidentOwnerRules.tsx", "Incident"],
      [
        "ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceOwnerRules.tsx",
        "Scheduled Maintenance",
      ],
    ].map(([file, kind]: Array<string>): [string, string, Array<string>] => {
      return [
        `${DASHBOARD}/Pages/${file}`,
        `RuleTable: Settings > ${kind} Owner Rules`,
        ["basic-info", "match-criteria", "owners", "inherit-owners"],
      ];
    }),
    ...[
      ["Alerts/Settings/AlertLabelRules.tsx", "Alert"],
      ["Incidents/Settings/IncidentLabelRules.tsx", "Incident"],
      [
        "ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceLabelRules.tsx",
        "Scheduled Maintenance",
      ],
    ].map(([file, kind]: Array<string>): [string, string, Array<string>] => {
      return [
        `${DASHBOARD}/Pages/${file}`,
        `LabelRuleTable: Settings > ${kind} Label Rules`,
        ["basic-info", "match-criteria", "labels", "inherit-labels"],
      ];
    }),
    ...[
      ["EmailSubscribers.tsx", "Email Subscribers"],
      ["SMSSubscribers.tsx", "SMS Subscribers"],
      ["SlackSubscribers.tsx", "Slack Subscribers"],
      ["MicrosoftTeamsSubscribers.tsx", "Microsoft Teams Subscribers"],
      ["WebhookSubscribers.tsx", "Webhook Subscribers"],
    ].map(([file, name]: Array<string>): [string, string, Array<string>] => {
      /*
       * The scan reads the larger branch of the conditional step list: the
       * one a page that lets subscribers choose gets.
       */
      return [
        `${DASHBOARD}/Pages/StatusPages/View/${file}`,
        `ModelTable: Status Page > ${name}`,
        ["subscriber-info", "notifications", "internal-info"],
      ];
    }),
  ])(
    "%s %s walks its split steps",
    (file: string, label: string, steps: Array<string>) => {
      const form: FormFacts | undefined = forms.find(
        (candidate: FormFacts): boolean => {
          return candidate.file === file && candidate.label === label;
        },
      );

      expect(form).toBeDefined();
      expect(
        (form?.steps || []).map((step: { id: string | null }) => {
          return step.id;
        }),
      ).toEqual(steps);
    },
  );
});
