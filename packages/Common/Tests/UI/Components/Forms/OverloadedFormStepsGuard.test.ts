// UX rule: Docs/ux/README.md#steps
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

/*
 * Steps over the limit that stay as they are, and why. A step split later
 * must leave this list (the guard says so). The incident, alert and
 * scheduled maintenance label and owner rules' six-switch inherit
 * checklists left it: they fold under Inherit Labels / Inherit Owners on
 * the rule's Labels or Owners step (Dashboard Utils/Form/ResourceRuleForm),
 * one row there.
 */
export const LONG_STEPS_ALLOWED: Array<ListedStep> = [
  /*
   * An SLO burn rate rule's Alert and Incident steps left this list when
   * their fields moved into the SLO record output helpers (Dashboard
   * Pages/Slo/Utils/SloRecordOutputForm.ts), which an error budget policy
   * tier's form shares: the helpers place a field on its step by an
   * argument, which the scan leaves to the helpers' own tests. Those pin
   * what this list said of the two steps - only the title and the severity
   * open, the rest in four folded sections - in App's
   * Tests/Dashboard/SloErrorBudgetPolicyTierForm.test.ts.
   */
  {
    file: `${DASHBOARD}/Components/SecurityPlaybook/SecurityPlaybookStepDialog.tsx`,
    form: "BasicFormModal #1",
    step: "settings",
    reason:
      "One dialog for every playbook action: only the one to three settings of the action picked on the step before ever show - a channel and a message to post to Slack, a connection to suspend an Okta user, the tasks to add - and then Needs Approval and the More fields line that folds Run This Step and Carry On If It Fails. The other settings are other actions', never on screen together.",
  },
  {
    file: `${DASHBOARD}/Pages/Metrics/Settings/PipelineRules.tsx`,
    form: "ModelTable: Metrics > Settings > Pipeline Rules",
    step: "action",
    reason:
      "Only the rule type and the one or two fields that type uses ever show: From and To to rename, Key and Value to add an attribute, a replacement to redact, a percentage to sample. The other fields are alternatives, never on screen together.",
  },
  {
    file: `${DASHBOARD}/Components/DataObservability/DataCheckTable.tsx`,
    form: "ModelTable: Checks",
    step: "reads",
    reason:
      "Only what the check picked on the step before reads ever shows: the column, with the accepted values of an Invalid Percent check, the pattern of a Format Mismatch Percent check, or the table and column an Orphan Count check refers to; a Custom SQL check's query in place of a column; then Segment By. Four rows at most (an Orphan Count check's); the others are alternatives, never on screen together.",
  },
  /*
   * A Twilio config asks what the account is used for on its Basic step
   * (Dashboard Components/CallSMS/TwilioConfigUseCopy), and this step then
   * shows the fields of that answer alone.
   */
  {
    file: `${DASHBOARD}/Components/CallSMS/CallSMSConfigTable.tsx`,
    form: "ModelTable: Settings > Custom CallSMS Config",
    step: "twilio-info",
    reason:
      "Every field after the token is written once for each answer to Use This Account For (calls and SMS, SMS only, calls only) with a showIf for that answer alone: the one number the answer takes, the default switch whose help names what goes through the default, and the folded extra numbers. The step shows five rows at most - the account SID, the token, one number, the switch and the More fields line - and four for SMS only.",
  },
  /*
   * A workspace summary names the team of its channels next to them, as a
   * notification rule does: Microsoft Teams by the team's name, Mattermost
   * by picking one of its bot's teams (#6776).
   */
  {
    file: `${DASHBOARD}/Components/Workspace/WorkspaceSummaryTable.tsx`,
    form: "ModelTable #1",
    step: "basic",
    reason:
      "The team of the summary's channels is written once for each workspace that has teams, each only on that workspace's summaries: Mattermost's team picker, shown when its bot is in two or more teams, and Microsoft Teams' Team Name. Slack's summaries show neither. The step shows five rows at most - the name, the description, the channel names, the team and Enabled - and four for Slack.",
  },
  /*
   * A grouping rule's Group By step shows only for a Custom mix: each named
   * answer - Monitor, Everything Together, Connected Services, Severity,
   * Title - is a card on the Grouping step and never reaches it.
   */
  ...[
    ["Alerts/Settings/AlertGroupingRules.tsx", "Alert"],
    ["Incidents/Settings/IncidentGroupingRules.tsx", "Incident"],
  ].map(([file, kind]: Array<string>): ListedStep => {
    return {
      file: `${DASHBOARD}/Pages/${file}`,
      form: `ModelTable: Settings > ${kind} Grouping Rules`,
      step: "group-by",
      reason:
        "Six checkboxes that answer one question - which of these split the rule's episodes - in two columns of three rows: monitor, severity, title, the two label sets and connected services. The step shows only for a Custom mix; a split would ask one question on two pages.",
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

  /*
   * A broken walk must not pass by finding nothing. These floors prove that
   * the scanner reads the project, nothing more: CI runs without ee/, and the
   * counts keep shrinking as forms are simplified (598 steps and 80 rule
   * forms in CI on 2026-10-03), so they sit far below them. See
   * MIN_SCANNED_FORMS.
   */
  test("are really read", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(stepCounts.length).toBeGreaterThan(300);
    expect(
      forms.filter((form: FormFacts): boolean => {
        return form.isRuleModel;
      }).length,
    ).toBeGreaterThan(40);
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
    /*
     * Five steps once (Basic Info, Sigma Rule, Evaluation, Security Cases,
     * On Match); two questions now - the rule, then what a match does -
     * with what a match raises one choice and how matches are counted
     * folded under More fields, so no step holds more than five rows.
     */
    [
      `${DASHBOARD}/Pages/SecurityEvents/DetectionRules.tsx`,
      "ModelTable: Security Events > Detection Rules",
      ["sigma-rule", "on-match"],
    ],
    /*
     * The same for a feed: where its indicators come from first, then only
     * that source's own step (a list's address, a TAXII server or a Google
     * SecOps connection), how a TAXII collection signs in a step of its own.
     */
    [
      `${DASHBOARD}/Pages/SecurityEvents/ThreatIntel.tsx`,
      "ModelTable: Security Events > Threat Intel Feeds",
      [
        "source",
        "list",
        "taxii-server",
        "google-secops",
        "sign-in",
        "on-match",
      ],
    ],
    /*
     * Five steps of fourteen fields once, as an auto remediation rule; with
     * investigation rules merged in, an AI rule asks three questions - which
     * incidents, when to investigate, and whether and how to fix - the rest
     * folded under More fields.
     */
    [
      `${DASHBOARD}/Components/AISettings/AiRulesTable.tsx`,
      "ModelTable: Settings > AI > AI Rules",
      ["match-criteria", "investigate", "remediation"],
    ],
    [
      `${DASHBOARD}/Pages/Rum/View/SessionReplaySettings.tsx`,
      "CardModelDetail: Session Replay Policy",
      ["recording", "privacy", "consent", "performance", "limits"],
    ],
    [
      `${DASHBOARD}/Pages/NetworkDevice/View/Settings.tsx`,
      "CardModelDetail: Device Settings",
      ["device-details", "address", "monitoring", "snmp"],
    ],
    /*
     * Its one Rules step drew the whole rule (its own form, so the scan sees
     * one field there - see LongFormStepsGuard for that form). A rule for
     * incidents, alerts, episodes or scheduled maintenance asks which
     * updates it posts on a step of its own (#7581), and one for incidents
     * or alerts whether it starts a video call for the event, and where.
     */
    [
      `${DASHBOARD}/Components/Workspace/WorkspaceNotificationRulesTable.tsx`,
      "ModelTable: Settings > Workspace Notification Rules",
      ["basic", "conditions", "destination", "updates", "videoCall"],
    ],
    /*
     * Grouping rules ask two questions and then create: Grouping (how to
     * group, how close together, name) and which incidents. Group By shows
     * only for a custom mix of switches. Everything else a rule can do -
     * paging and owners, the episode lifecycle, the details - is one More
     * fields fold at the end of Grouping, one row there, where a Show
     * advanced settings switch used to add three more steps.
     */
    ...[
      ["Alerts/Settings/AlertGroupingRules.tsx", "Alert"],
      ["Incidents/Settings/IncidentGroupingRules.tsx", "Incident"],
    ].map(([file, kind]: Array<string>): [string, string, Array<string>] => {
      return [
        `${DASHBOARD}/Pages/${file}`,
        `ModelTable: Settings > ${kind} Grouping Rules`,
        ["grouping", "group-by", "match-criteria"],
      ];
    }),
    /*
     * The event rules' owners and inherit checklist were split over two
     * steps; now they share the rule's one Owners (or Labels) step, the six
     * switches folded under Inherit Owners (Inherit Labels) - which keeps
     * that step at five rows on the Edit form, and four on Create.
     */
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
        ["match-criteria", "owners"],
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
        ["match-criteria", "labels"],
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
       * one a page that lets subscribers choose gets. The internal note is
       * no step of its own any more: it is folded under More fields.
       */
      return [
        `${DASHBOARD}/Pages/StatusPages/View/${file}`,
        `ModelTable: Status Page > ${name}`,
        ["subscriber-info", "notifications"],
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
