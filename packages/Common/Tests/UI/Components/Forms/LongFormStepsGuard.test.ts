import { describe, expect, test } from "@jest/globals";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  FormStepProblem,
  LONG_FORM_FIELD_LIMIT,
  MIN_SCANNED_FORMS,
  SHORT_FORM_ROW_LIMIT,
  ShortFormWithSteps,
  SourceFileSystem,
  countFieldRows,
  countFormRows,
  describeForm,
  describeShortFormWithSteps,
  findLongFormsWithoutSteps,
  findShortFormsWithSteps,
  findStepProblems,
  findUncountableForms,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "Please have formsteps in this form, and for any long forms in the project
 * (anything > 3 fields)." - the maintainer, on the Create Workflow Variable
 * form, whose four fields with a paragraph of help each made one long
 * scrolling page.
 *
 * Every create and edit form in the product was given steps when it had more
 * than three fields the user can see. This guard keeps it that way: it reads
 * every form host in the frontends (Tests/Helpers/FormStepsScan.ts says how)
 * and fails on a long form without steps, unless the form is listed below
 * with the reason it is better left as one page. It also fails on the three
 * ways a stepped form silently loses a field (no stepId, a stepId no step
 * declares, a step no field is on), because the sweep put a stepId on
 * hundreds of fields and each of those mistakes renders without an error.
 *
 * The detector is pinned on inline snippets first - every shape it must
 * follow and every shape it must leave alone - and only then run over the
 * real tree, with checks that the scan really read it, so a broken walk
 * cannot pass by finding nothing.
 *
 * And the other way round. "The idea is to make software as simple as
 * possible to use and reduce decision paralysis" - the maintainer, asking
 * for the same fix wherever the same problem is. A form of three rows or
 * fewer is one page: a stepper there only adds a step list and a Next
 * between a name and the one editor it names (the note and postmortem
 * template forms walked "Template Info" then "Note Details" for three
 * fields, and SLO create three steps when only its target had no default).
 * A folded section is one row, as above. So a short form that walks steps
 * fails too, unless it is listed in SHORT_FORMS_WITH_STEPS with the reason.
 * Together the two rules leave no gap: more than three rows walk steps,
 * three or fewer do not.
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

interface ListedForm {
  // Repository-relative, with "/".
  file: string;
  // The form's label: see getFormLabel in FormStepsScan.ts.
  form: string;
  reason: string;
}

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

/*
 * Long forms that stay one page, and why. Each one was looked at and left on
 * purpose; a form that gains steps must leave this list (the guard says so).
 */
export const LONG_FORMS_WITHOUT_STEPS: Array<ListedForm> = [
  {
    file: "packages/App/FeatureSet/Accounts/src/Pages/Register.tsx",
    form: "ModelForm: Register",
    reason:
      "The sign-up page, the product's front door: every field is needed to create the account, and whether sign-up becomes a two-step flow is a conversion decision for the maintainer, not a side effect of this sweep.",
  },
  ...[
    ["ExceptionMonitor/ExceptionMonitorStepForm.tsx", "exception-monitor-form"],
    ["LogMonitor/LogMonitorStepFrom.tsx", "logs-filter"],
    [
      "SecurityEventsMonitor/SecurityEventsMonitorStepForm.tsx",
      "security-events-filter",
    ],
    ["TraceMonitor/TraceMonitorStepForm.tsx", "Traces-filter"],
  ].map(([file, id]: Array<string>): ListedForm => {
    return {
      file: `${DASHBOARD}/Components/Form/Monitor/${file}`,
      form: `BasicForm: ${id}`,
      reason:
        "A filter embedded in one step of the monitor form, which walks its own steps; a stepper inside a step would nest one wizard in another. Most of its fields only appear behind its own Advanced toggle.",
    };
  }),
  {
    file: `${DASHBOARD}/Components/OnCallPolicy/OnCallScheduleLayer/LayerConfigForm.tsx`,
    form: "ModelForm: Layer Configuration",
    reason:
      "Not a dialog: the inline editor at the bottom of an expanded layer card, already split into three titled sections (Layer details, Rotation schedule, Active hours) with one Save, under the rotation preview it updates.",
  },
  {
    file: `${DASHBOARD}/Components/Workspace/NotificationRuleForm/NotificationRuleForm.tsx`,
    form: "BasicForm #1",
    reason:
      "One half of a workspace notification rule, drawn as one field on a step of the rule's own wizard (WorkspaceNotificationRulesTable): its Conditions step, or its Destination step, which is the long one. A stepper inside a step would nest one wizard in another. At rest the Destination step is two or three switches (an existing channel, a Microsoft Teams chat, a new channel), and each one's own options appear only when it is switched on.",
  },
  {
    file: `${DASHBOARD}/Pages/SecurityEvents/ThreatIntel.tsx`,
    form: "BasicFormModal: Security Events > Update Threat Intel Feed Credentials",
    reason:
      "Never more than three fields at once: the authentication mode, then either the API token or the basic auth username and password - the two are alternatives.",
  },
  /*
   * The maintainer, on the Create Custom Field form: "The only thing I
   * should see by default is: field name, field description, type. That's
   * basically it." Those three are the whole page; a step between them
   * would only add a Next.
   */
  ...[
    [
      `${DASHBOARD}/Pages/Settings/Base/CustomFieldsPageBase.tsx`,
      "ModelTable: custom-fields-table",
      "The custom field settings pages of eight resources (incidents, alerts, monitors and the rest): a field's name, description and type, which is all the maintainer asked to see when creating one. The fourth row, Dropdown Options, appears only under a dropdown type, right below the type it belongs to; everything else a field can have (an incident field's Show on Create and subscriber settings, and on Edit where its value is copied from and its template variable) is folded into one collapsed Advanced section, and a field that copies its value from a monitor is created from the card's More menu instead.",
    ],
    [
      `${DASHBOARD}/Pages/Users/CustomFields.tsx`,
      "ModelTable: Settings > Team Member Custom Fields",
      "The team member custom field form, one page like the other eight custom field settings pages: a field's name, description and type, with Dropdown Options appearing only under a dropdown type, right below the type it belongs to.",
    ],
  ].map(([file, form, reason]: Array<string>): ListedForm => {
    return { file: file!, form: form!, reason: reason! };
  }),
  {
    file: "packages/App/FeatureSet/StatusPage/src/Pages/Subscribe/UpdateSubscription.tsx",
    form: "ModelForm: Status Page > Update Subscription",
    reason:
      "A subscriber managing a subscription from an email link: the contact field is read-only and only one of the three ever shows, the pickers open only when an 'all' box is unticked, and Unsubscribe must not be hidden behind a Next.",
  },
  /*
   * Adding monitors to a status page asks only for the monitors; what is
   * shown beside them is folded under Advanced at its defaults. The status
   * page resource forms were three and four steps before that.
   */
  {
    file: `${DASHBOARD}/Pages/StatusPages/View/Resources.tsx`,
    form: "ModelFormModal #1",
    reason:
      "The status page group form: the group's name and its parent group (filled in by 'Add a sub group'), then two folded headers that say what they hold - Layout ('List', or 'Grid', which opens by itself to show the axes a grid needs) and Advanced. Two rows to fill in and two to open if wanted; a step between them would only add a Next.",
  },
  {
    file: `${DASHBOARD}/Components/StatusPage/BulkAddStatusPageMonitorsModal.tsx`,
    form: "BasicForm: Status Page > Add Multiple Monitors",
    reason:
      "Adding several monitors to a status page: the monitors, then the folded Advanced options. 'Keep this group in sync' shows only after monitors are picked by label and never on a grid group, and the row and column only on a grid group, where they are the one cell every picked monitor goes in - so it is never more than four rows, and usually two.",
  },
  /*
   * A discovered resource's create form asks for what its telemetry is
   * matched on, with the display name following it under Advanced
   * (DiscoveredResourceCreateFormsGuard).
   */
  {
    file: `${DASHBOARD}/Pages/Cloud/CloudResources.tsx`,
    form: "ModelTable: Cloud Environments",
    reason:
      "Adding a cloud environment by hand: the three values ingest matches an environment on - its platform, account and region, joined into the key - and one folded Advanced header with the display name (it follows the three, as a discovered environment is named), the description and the labels. The three must match the telemetry together, so they stay side by side on one page; the Details step that held only the optional name went away.",
  },
];

/*
 * Forms whose fields cannot be counted from the source - built from data or
 * handed in by a caller - with why they need no steps, or where the steps
 * live instead.
 */
export const UNCOUNTABLE_FORMS: Array<ListedForm> = [
  {
    file: "packages/App/FeatureSet/Accounts/src/Pages/Form.tsx",
    form: "BasicForm: public-form",
    reason:
      "A public form whose questions are the customer's own design in Forms (an incident report or a maintenance request: title, description, their custom fields, the submitter's details, a CAPTCHA). Someone reporting an outage fills it in one go, in two columns on a wide screen; a Next before the submitter's details and the CAPTCHA would only slow that down.",
  },
  {
    file: `${DASHBOARD}/Components/FormBuilder/Builder/FormPreviewModal.tsx`,
    form: "BasicForm: form-preview-form",
    reason:
      "The form builder's preview of the public form above: the same questions drawn the way the public page draws them, in one page, so what the builder shows is what a submitter will see.",
  },
  {
    file: `${DASHBOARD}/Components/Dashboard/Canvas/ArgumentsForm.tsx`,
    form: "BasicForm #1",
    reason:
      "A dashboard widget's settings, built from the widget's own argument list and already drawn as one small form per argument section in the side panel, not as one long dialog.",
  },
  {
    file: `${DASHBOARD}/Components/NumberPrefix/NumberPrefixCard.tsx`,
    form: "CardModelDetail #1",
    reason:
      "The Number Prefix pages' card builds one prefix field per kind of number from the page's rows (NumberPrefixSettings): two fields on the Incidents and Alerts pages, one on Scheduled Maintenance.",
  },
  {
    file: `${DASHBOARD}/Pages/Slo/View/Index.tsx`,
    form: "CardModelDetail: SLO Details",
    reason:
      "Picks the create form's name and description fields by column (pickSloFormFields), with the labels folded under an Advanced section of their own as on every form: three rows.",
  },
  {
    file: `${DASHBOARD}/Pages/Slo/View/Settings.tsx`,
    form: "CardModelDetail: SLO Objective",
    reason:
      "Picks the create form's target and at-risk threshold fields by column (pickSloFormFields): two fields.",
  },
  {
    file: `${DASHBOARD}/Pages/Slo/View/Settings.tsx`,
    form: "CardModelDetail: SLO Compliance Period",
    reason:
      "Picks the create form's window type, window days and timezone fields by column (pickSloFormFields): three fields, and only one of the last two shows for a window type.",
  },
  {
    file: "packages/Common/UI/Components/CustomFields/CustomFieldsDetail.tsx",
    form: "BasicFormModal #1",
    reason:
      "Edits a record's custom field values: its fields are the project's custom field definitions, as many as the customer made, with no grouping between them to make steps of.",
  },
  {
    file: "packages/Common/UI/Components/Workflow/ArgumentsForm.tsx",
    form: "BasicForm #1",
    reason:
      "A workflow component's arguments, built from the component's metadata inside its settings dialog, whose layout the component settings tasks own.",
  },
  {
    file: "packages/Common/UI/Components/Workflow/RunForm.tsx",
    form: "BasicForm #1",
    reason:
      "The arguments a workflow's manual trigger declares, built from its metadata: one question per argument the workflow author added.",
  },
];

/*
 * Forms of three rows or fewer that walk steps anyway, and why. Each one was
 * looked at; a form that loses its steps must leave this list (the guard
 * says so).
 */
export const SHORT_FORMS_WITH_STEPS: Array<ListedForm> = [
  /*
   * A rule's conditions are a builder, not a field: RuleCriteriaModelForm
   * draws it on the step with id "match-criteria", in place of the fields
   * listed there.
   */
  {
    file: `${DASHBOARD}/Pages/NetworkSite/AssignmentRules.tsx`,
    form: "ModelTable: Network Site Assignment Rules",
    reason:
      "The site, then the conditions a device must match. The second step is the conditions builder every rule form in the product draws on its Match Criteria step - a list of conditions added one at a time, with its own match-all or match-any choice - and it keeps that page of its own here too, so this rule reads and is built like every other rule.",
  },
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

// Scans `Page.tsx` (and whatever it imports from the other files given).
function scan(files: Record<string, string>): Array<FormFacts> {
  return scanFormFiles({
    repositoryRoot: VIRTUAL_ROOT,
    files: [path.join(VIRTUAL_ROOT, "Page.tsx")],
    fileSystem: virtualFileSystem(files),
  });
}

function only(files: Record<string, string>): FormFacts {
  const forms: Array<FormFacts> = scan(files);

  expect(forms).toHaveLength(1);

  return forms[0]!;
}

function field(key: string, extra: string = ""): string {
  return `{ field: { ${key}: true }, title: "${key}", fieldType: FormFieldSchemaType.Text, ${extra} }`;
}

function fields(count: number, extra: string = ""): string {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return field(`field${index + 1}`, extra);
  }).join(",\n");
}

describe("the long form detector", () => {
  test("counts an inline field list", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Things" isCreateable={true} formFields={[${fields(4)}]} />;`,
    });

    expect(form.host).toBe("ModelTable");
    expect(form.label).toBe("ModelTable: Things");
    expect(form.visibleFieldCount).toBe(4);
    expect(form.hasSteps).toBe(false);
    expect(findLongFormsWithoutSteps([form])).toEqual([form]);
  });

  test("reads every text a field's title can be, and none of a computed one", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => <ModelTable name="Things" isCreateable={true} formFields={[
          { field: { a: true }, title: "Incident Title", fieldType: FormFieldSchemaType.Text },
          { field: { b: true }, title: isIncident ? "Incident Labels" : ("Alert Labels"), fieldType: FormFieldSchemaType.Text },
          { field: { c: true }, title: copy.descriptionTitle, fieldType: FormFieldSchemaType.Text },
          { field: { d: true }, title: \`\${subject} Title\`, fieldType: FormFieldSchemaType.Text },
          { field: { e: true }, title: isIncident ? "Incident Name" : copy.nameTitle, fieldType: FormFieldSchemaType.Text },
          { field: { f: true }, fieldType: FormFieldSchemaType.Text },
        ]} />;`,
    });

    expect(
      form.fields.map((candidate: FormFieldFacts) => {
        return [candidate.key, candidate.title, candidate.titleTexts];
      }),
    ).toEqual([
      ["a", "Incident Title", ["Incident Title"]],
      [
        "b",
        'isIncident ? "Incident Labels" : ("Alert Labels")',
        ["Incident Labels", "Alert Labels"],
      ],
      ["c", "copy.descriptionTitle", null],
      ["d", "`${subject} Title`", null],
      ["e", 'isIncident ? "Incident Name" : copy.nameTitle', null],
      ["f", "", []],
    ]);
  });

  test(`leaves a form of ${LONG_FORM_FIELD_LIMIT} fields alone`, () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <CardModelDetail name="Card" formFields={[${fields(3)}]} />;`,
    });

    expect(form.visibleFieldCount).toBe(3);
    expect(findLongFormsWithoutSteps([form])).toEqual([]);
  });

  test("sees steps, and then does not ask for them", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Things" formSteps={[{ title: "One", id: "one" }, { title: "Two", id: "two" }]} formFields={[${fields(2, 'stepId: "one",')}, ${field("a", 'stepId: "two",')}, ${field("b", 'stepId: "two",')}]} />;`,
    });

    expect(form.hasSteps).toBe(true);
    expect(
      form.steps?.map((step: { id: string | null }) => {
        return step.id;
      }),
    ).toEqual(["one", "two"]);
    expect(findLongFormsWithoutSteps([form])).toEqual([]);
    expect(findStepProblems([form])).toEqual([]);
  });

  test("counts a turned-on summary as steps", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelFormModal title="Note" formProps={{ summary: { enabled: true }, fields: [${fields(4)}] }} />;`,
    });

    expect(form.hasSteps).toBe(true);
    expect(form.hasSummaryOnly).toBe(true);
    // BasicForm puts every field on the default step itself.
    expect(findStepProblems([form])).toEqual([]);
  });

  test("reads formProps on a modal, and its title as the label", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <BasicFormModal title="Add Things" formProps={{ fields: [${fields(5)}] }} />;`,
    });

    expect(form.label).toBe("BasicFormModal: Add Things");
    expect(form.visibleFieldCount).toBe(5);
  });

  test("follows a constant, a function's returned list and its pushes", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const BASE = [${fields(2)}];
        function getFields() {
          const list = [...BASE];
          list.push(${field("pushed")});
          if (flag) { list.push(${field("conditional")}); }
          return list;
        }
        const Page = () => <ModelForm id="form" fields={getFields()} />;`,
    });

    expect(form.visibleFieldCount).toBe(4);
    expect(form.uncountableReasons).toEqual([]);
  });

  test("follows useMemo, spreads and the larger branch of a ternary", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const Page = () => {
          const extra = isAdmin ? [${fields(2)}] : [];
          const all = useMemo(() => {
            if (!loaded) { return []; }
            return [${field("a")}, ...extra, ...(wide ? [${field("b")}] : [])];
          }, []);
          return <BasicForm id="form" fields={all} />;
        };`,
    });

    expect(form.visibleFieldCount).toBe(4);
  });

  test("follows a field list imported from another file", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import { getVariableFields, STEPS } from "./Fields";
        const Page = () => <ModelTable name="Variables" formSteps={STEPS} formFields={getVariableFields({ isGlobal: true })} />;`,
      "Fields.ts": `
        export const STEPS = [{ title: "Variable", id: "variable" }, { title: "Value", id: "value" }];
        export function getVariableFields(data) {
          return [${field("name", 'stepId: "variable",')}, ${field("description", 'stepId: "variable",')}, ${field("content", 'stepId: "value",')}, ${field("isSecret", 'stepId: "value",')}];
        }`,
    });

    expect(form.visibleFieldCount).toBe(4);
    expect(form.hasSteps).toBe(true);
    expect(findStepProblems([form])).toEqual([]);
  });

  test("does not count a registration that is never shown", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <CardModelDetail name="Card" formFields={[${fields(2)}, ${field("hidden1", "showIf: () => { return false; },")}, ${field("hidden2", "showIf: () => false,")}]} />;`,
    });

    expect(form.visibleFieldCount).toBe(2);
  });

  test("counts a field shown under a condition", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <CardModelDetail name="Card" formFields={[${fields(3)}, ${field("sometimes", "showIf: (values) => Boolean(values.on),")}]} />;`,
    });

    expect(form.visibleFieldCount).toBe(4);
  });

  test("judges a table by the longer of its Create and Edit forms", () => {
    const createOnly: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Secrets" isEditable={true} formFields={[${fields(3)}, ${field("secretValue", "doNotShowWhenEditing: true,")}]} />;`,
    });

    expect(createOnly.visibleFieldCount).toBe(4);

    const editOnly: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Secrets" isEditable={true} formFields={[${fields(3)}, ${field("a", "doNotShowWhenCreating: true,")}, ${field("b", "doNotShowWhenEditing: true,")}]} />;`,
    });

    expect(editOnly.visibleFieldCount).toBe(4);
  });

  /*
   * A folded section (an Advanced section, getAdvancedFormSection) is one
   * header on the page until the user opens it, so it is one row of the
   * form - however many options it holds.
   */
  test("counts a folded section once", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        const advanced = getAdvancedFormSection();
        const Page = () => <ModelTable name="Things" isEditable={true} formFields={[${fields(2)}, ${field("a", "collapsibleSection: advanced,")}, ${field("b", "collapsibleSection: advanced, showIf: (values) => Boolean(values.a),")}, ${field("c", "collapsibleSection: advanced,")}]} />;`,
    });

    expect(
      form.fields.map((candidate: FormFieldFacts) => {
        return candidate.collapsibleSection;
      }),
    ).toEqual([undefined, undefined, "advanced", "advanced", "advanced"]);
    expect(form.visibleFieldCount).toBe(3);
    expect(findLongFormsWithoutSteps([form])).toEqual([]);
  });

  test("still asks a long form with a folded section for steps", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Things" formFields={[${fields(3)}, ${field("a", "collapsibleSection: advanced,")}, ${field("b", "collapsibleSection: advanced,")}]} />;`,
    });

    expect(form.visibleFieldCount).toBe(4);
    expect(findLongFormsWithoutSteps([form])).toEqual([form]);
    expect(describeForm(form)).toContain("a (folded), b (folded)");
  });

  test("counts two different sections, or one split in two, as the rows BasicForm draws", () => {
    const twoSections: FormFacts = only({
      "Page.tsx": `const Page = () => <CardModelDetail name="Card" formFields={[${field("a", "collapsibleSection: routing,")}, ${field("b", "collapsibleSection: advanced,")}, ${field("c", "collapsibleSection: advanced,")}]} />;`,
    });

    expect(twoSections.visibleFieldCount).toBe(2);

    // BasicForm folds only fields next to each other into one section.
    const split: FormFacts = only({
      "Page.tsx": `const Page = () => <CardModelDetail name="Card" formFields={[${field("a", "collapsibleSection: advanced,")}, ${field("plain")}, ${field("b", "collapsibleSection: advanced,")}]} />;`,
    });

    expect(split.visibleFieldCount).toBe(3);
  });

  test("reads a helper's section from what its call writes down", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import getOwnersFormField from "./Owners";
        const Page = () => <CardModelDetail name="Card" formFields={[${fields(3)}, getOwnersFormField({ collapsibleSection: advanced }), ${field("a", "collapsibleSection: advanced,")}]} />;`,
      "Owners.ts": `
        export const getOwnersFormField = (options) => {
          return { title: "Owners", ...options, field: { owners: true }, fieldType: FormFieldSchemaType.PeoplePicker, formOnly: true };
        };
        export default getOwnersFormField;`,
    });

    expect(
      form.fields.map((candidate: FormFieldFacts) => {
        return candidate.collapsibleSection;
      }),
    ).toEqual([undefined, undefined, undefined, "advanced", "advanced"]);
    expect(form.visibleFieldCount).toBe(4);
  });

  test("judges a table's folded section on its Create and Edit forms apart", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Things" isEditable={true} formFields={[${fields(2)}, ${field("editOnly", "collapsibleSection: advanced, doNotShowWhenCreating: true,")}, ${field("plain")}, ${field("a", "collapsibleSection: advanced,")}]} />;`,
    });

    // Create: two fields, Plain, Advanced. Edit: two fields, Advanced, Plain, Advanced.
    expect(form.visibleFieldCount).toBe(5);
  });

  test("counts rows: a run of fields in one section is one", () => {
    const facts: (section: string | undefined) => FormFieldFacts = (
      section: string | undefined,
    ): FormFieldFacts => {
      return {
        key: "k",
        title: "t",
        titleTexts: ["t"],
        fieldType: "",
        stepId: undefined,
        isPlainLiteral: true,
        isNeverShown: false,
        isConditional: false,
        isCreateOnly: false,
        isEditOnly: false,
        defaultValue: undefined,
        hasDefault: false,
        hasSpread: false,
        collapsibleSection: section,
        customElementCanBeSkipped: false,
        customElementComponents: [],
        file: "Page.tsx",
        line: 1,
      };
    };

    expect(countFieldRows([])).toBe(0);
    expect(countFieldRows([facts(undefined), facts(undefined)])).toBe(2);
    expect(
      countFieldRows([facts("advanced"), facts("advanced"), facts("advanced")]),
    ).toBe(1);
    expect(
      countFieldRows([
        facts(undefined),
        facts("advanced"),
        facts("advanced"),
        facts("routing"),
        facts(undefined),
        facts("advanced"),
      ]),
    ).toBe(5);
  });

  test("marks fields handed in by the caller as a pass-through, not a long form", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Wrapper = (props) => <ModelTable name="Rules" formFields={props.formFields} />;`,
    });

    expect(form.isPassThrough).toBe(true);
    expect(findLongFormsWithoutSteps([form])).toEqual([]);
    expect(findUncountableForms([form])).toEqual([]);
  });

  test("calls a list it cannot follow uncountable, with the reason", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <BasicForm id="args" fields={component.metadata.arguments.map(toField)} />;`,
    });

    expect(findUncountableForms([form])).toEqual([form]);
    expect(form.uncountableReasons.join(" ")).toContain("cannot follow");
  });

  test("calls a list filled in a loop uncountable", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        function pick(columns) {
          const picked = [];
          for (const column of columns) { picked.push({ ...byColumn(column) }); }
          return picked;
        }
        const Page = () => <CardModelDetail name="Details" formFields={pick(["a", "b"])} />;`,
    });

    expect(form.uncountableReasons.join(" ")).toContain("filled in a loop");
  });

  test("tells two forms of one host with one name apart", () => {
    const forms: Array<FormFacts> = scan({
      "Page.tsx": `const Page = () => <>
        <CardModelDetail name="Settings" formFields={[${fields(1)}]} />
        <CardModelDetail name="Settings" formFields={[${fields(1)}]} />
        <ModelForm fields={[${fields(1)}]} />
      </>;`,
    });

    expect(
      forms.map((form: FormFacts): string => {
        return form.label;
      }),
    ).toEqual([
      "CardModelDetail: Settings",
      "CardModelDetail: Settings #2",
      "ModelForm #1",
    ]);
  });
});

describe("the short form detector", () => {
  function messagesOf(forms: Array<FormFacts>): Array<string> {
    return findShortFormsWithSteps(forms).map(
      (found: ShortFormWithSteps): string => {
        return `${found.form.label}: ${found.message}`;
      },
    );
  }

  test(`finds a stepper on a form of ${SHORT_FORM_ROW_LIMIT} rows`, () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Templates" isCreateable={true} formSteps={[{ title: "Template Info", id: "template-info" }, { title: "Note Details", id: "note-details" }]} formFields={[${fields(2, 'stepId: "template-info",')}, ${field("note", 'stepId: "note-details",')}]} />;`,
    });

    expect(countFormRows(form)).toBe(3);
    expect(messagesOf([form])).toEqual([
      "ModelTable: Templates: 3 rows walk steps (template-info, note-details). Three rows fit on one page: drop the steps.",
    ]);
    expect(
      describeShortFormWithSteps(findShortFormsWithSteps([form])[0]!),
    ).toBe(
      "Page.tsx:1 ModelTable: Templates - 3 rows walk steps (template-info, note-details). Three rows fit on one page: drop the steps. Fields: field1, field2, note",
    );
  });

  test("finds one of a single row or two as well", () => {
    const forms: Array<FormFacts> = scan({
      "Page.tsx": `const Page = () => <>
        <BasicForm id="one" steps={[{ title: "One", id: "one" }]} fields={[${field("a", 'stepId: "one",')}]} />
        <BasicForm id="two" steps={[{ title: "One", id: "one" }, { title: "Two", id: "two" }]} fields={[${field("a", 'stepId: "one",')}, ${field("b", 'stepId: "two",')}]} />
      </>;`,
    });

    expect(
      findShortFormsWithSteps(forms).map(
        (found: ShortFormWithSteps): number => {
          return found.rows;
        },
      ),
    ).toEqual([1, 2]);
  });

  test("leaves a stepped form of four rows alone, and a one-page form of three", () => {
    const forms: Array<FormFacts> = scan({
      "Page.tsx": `const Page = () => <>
        <ModelTable name="Long" isCreateable={true} formSteps={[{ title: "One", id: "one" }, { title: "Two", id: "two" }]} formFields={[${fields(2, 'stepId: "one",')}, ${field("a", 'stepId: "two",')}, ${field("b", 'stepId: "two",')}]} />
        <ModelTable name="Short" isCreateable={true} formFields={[${fields(3)}]} />
      </>;`,
    });

    expect(forms).toHaveLength(2);
    expect(countFormRows(forms[0]!)).toBe(4);
    expect(countFormRows(forms[1]!)).toBe(3);
    expect(findShortFormsWithSteps(forms)).toEqual([]);
  });

  /*
   * BasicForm walks a form with a Summary step turned on as two steps: its
   * fields, then the summary of them. Three rows need no read-back.
   */
  test("counts a turned-on Summary step as steps", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelFormModal title="Add Note" formProps={{ summary: { enabled: true }, fields: [${fields(2)}] }} />;`,
    });

    expect(form.hasSummaryOnly).toBe(true);
    expect(messagesOf([form])).toEqual([
      "ModelFormModal: Add Note: 2 rows walk steps (a Summary step). Three rows fit on one page: drop the steps.",
    ]);
  });

  test("counts a folded section once", () => {
    const forms: Array<FormFacts> = scan({
      "Page.tsx": `
        const advanced = getAdvancedFormSection();
        const Page = () => <>
          <ModelTable name="Folded" isCreateable={true} formSteps={[{ title: "One", id: "one" }, { title: "Two", id: "two" }]} formFields={[${field("name", 'stepId: "one",')}, ${field("target", 'stepId: "two",')}, ${field("a", 'stepId: "two", collapsibleSection: advanced,')}, ${field("b", 'stepId: "two", collapsibleSection: advanced,')}, ${field("c", 'stepId: "two", collapsibleSection: advanced,')}]} />
          <ModelTable name="Open" isCreateable={true} formSteps={[{ title: "One", id: "one" }, { title: "Two", id: "two" }]} formFields={[${field("name", 'stepId: "one",')}, ${field("target", 'stepId: "two",')}, ${field("a", 'stepId: "two",')}, ${field("b", 'stepId: "two", collapsibleSection: advanced,')}, ${field("c", 'stepId: "two", collapsibleSection: advanced,')}]} />
        </>;`,
    });

    expect(
      forms.map((form: FormFacts): number | null => {
        return countFormRows(form);
      }),
    ).toEqual([3, 4]);
    expect(messagesOf(forms)).toEqual([
      "ModelTable: Folded: 3 rows walk steps (one, two). Three rows fit on one page: drop the steps.",
    ]);
  });

  test("judges a table by the longer of the forms it offers", () => {
    const forms: Array<FormFacts> = scan({
      "Page.tsx": `const Page = () => <>
        <ModelTable name="Edited" isCreateable={true} isEditable={true} formSteps={[{ title: "One", id: "one" }, { title: "Two", id: "two" }]} formFields={[${fields(2, 'stepId: "one",')}, ${field("a", 'stepId: "two",')}, ${field("isEnabled", 'stepId: "two", doNotShowWhenCreating: true,')}]} />
        <ModelTable name="Created" isCreateable={true} isEditable={false} formSteps={[{ title: "One", id: "one" }, { title: "Two", id: "two" }]} formFields={[${fields(2, 'stepId: "one",')}, ${field("a", 'stepId: "two",')}, ${field("isEnabled", 'stepId: "two", doNotShowWhenCreating: true,')}]} />
      </>;`,
    });

    // The Edit form shows the switch the Create form leaves off: four rows.
    expect(countFormRows(forms[0]!)).toBe(4);
    // No Edit form is offered, so only the Create form's three count.
    expect(countFormRows(forms[1]!)).toBe(3);
    expect(messagesOf(forms)).toEqual([
      "ModelTable: Created: 3 rows walk steps (one, two). Three rows fit on one page: drop the steps.",
    ]);
  });

  /*
   * On a rule model ModelForm draws the Match Criteria step as one
   * conditions builder, whatever fields are listed on it.
   */
  test("counts a rule's Match Criteria step as one row, the conditions builder", () => {
    const steps: string = `[{ title: "Rule", id: "rule-info" }, { title: "Match", id: "match-criteria" }]`;
    const ruleFields: string = `[${field("name", 'stepId: "rule-info",')}, ${field("monitors", 'stepId: "match-criteria",')}, ${field("labels", 'stepId: "match-criteria",')}, ${field("titlePattern", 'stepId: "match-criteria",')}]`;

    const forms: Array<FormFacts> = scan({
      "Page.tsx": `
        import Rule from "./Rule";
        import Plain from "./Plain";
        const Page = () => <>
          <ModelTable name="Rules" modelType={Rule} isCreateable={true} formSteps={${steps}} formFields={${ruleFields}} />
          <ModelTable name="Plain" modelType={Plain} isCreateable={true} formSteps={${steps}} formFields={${ruleFields}} />
        </>;`,
      "Rule.ts": "export default class Rule extends RuleBaseModel {}",
      "Plain.ts": "export default class Plain extends BaseModel {}",
    });

    expect(
      forms.map((form: FormFacts): [boolean, number | null] => {
        return [form.isRuleModel, countFormRows(form)];
      }),
    ).toEqual([
      [true, 2],
      [false, 4],
    ]);
    expect(messagesOf(forms)).toEqual([
      "ModelTable: Rules: 2 rows walk steps (rule-info, match-criteria). Three rows fit on one page: drop the steps.",
    ]);
  });

  test("leaves to other checks a pass-through, an uncountable form and a table that draws no form", () => {
    const forms: Array<FormFacts> = scan({
      "Page.tsx": `const Page = (props) => <>
        <ModelTable name="Wrapper" formSteps={[{ title: "One", id: "one" }]} formFields={props.formFields} />
        <BasicForm id="args" steps={[{ title: "One", id: "one" }]} fields={component.arguments.map(toField)} />
        <ModelTable name="Dead" isCreateable={false} isEditable={false} formSteps={[{ title: "One", id: "one" }]} formFields={[${field("a", 'stepId: "one",')}]} />
      </>;`,
    });

    expect(forms).toHaveLength(3);
    expect(forms[0]!.isPassThrough).toBe(true);
    expect(forms[1]!.uncountableReasons.length).toBeGreaterThan(0);
    expect(countFormRows(forms[2]!)).toBeNull();
    expect(findShortFormsWithSteps(forms)).toEqual([]);
  });

  test("leaves a form without steps or a summary alone, however short", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelFormModal title="Add" formProps={{ summary: { enabled: false }, fields: [${fields(1)}] }} />;`,
    });

    expect(form.hasSteps).toBe(false);
    expect(findShortFormsWithSteps([form])).toEqual([]);
  });
});

describe("the stepped form checks", () => {
  test("flag a field written without a stepId, which is never shown", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Things" formSteps={[{ title: "One", id: "one" }]} formFields={[${field("a", 'stepId: "one",')}, ${field("forgotten")}]} />;`,
    });

    const problems: Array<FormStepProblem> = findStepProblems([form]);

    expect(
      problems.map((problem: FormStepProblem): string => {
        return problem.kind;
      }),
    ).toEqual(["field-without-step"]);
    expect(problems[0]?.message).toContain('"forgotten"');
  });

  test("leave a field from a helper, or with a spread, to the helper's own tests", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import { getSnmpFields } from "./Snmp";
        const Page = () => <ModelTable name="Devices" formSteps={[{ title: "One", id: "one" }]} formFields={[${field("a", 'stepId: "one",')}, ...getSnmpFields({ stepId: "one" }), { ...base, title: "Spread" }]} />;`,
      "Snmp.ts": `export function getSnmpFields(data) { return [${field("snmpVersion")}]; }`,
    });

    expect(findStepProblems([form])).toEqual([]);
  });

  /*
   * The owners field is a helper's (getOwnersFormField), written on some
   * forty forms with the step in the call. That step is the field's: a typo
   * in it, or a step left with nothing but it, is found like any other.
   */
  test("place a helper's field on the step its call names", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import getOwnersFormField from "./Owners";
        const Page = () => <ModelTable name="Rules" formSteps={[{ title: "One", id: "one" }, { title: "Owners", id: "owners" }]} formFields={[${field("a", 'stepId: "one",')}, getOwnersFormField({ stepId: "owners", description: "Who owns it." })]} />;`,
      "Owners.ts": `
        export const OWNERS_KEY = "owners";
        export const getOwnersFormField = (options) => {
          const { fieldKey, ...rest } = options;
          return { title: "Owners", ...rest, field: { [fieldKey || OWNERS_KEY]: true }, fieldType: FormFieldSchemaType.PeoplePicker, formOnly: true };
        };
        export default getOwnersFormField;`,
    });

    const owners: FormFieldFacts | undefined = form.fields.find(
      (candidate: FormFieldFacts): boolean => {
        return candidate.title === "Owners";
      },
    );

    expect(owners?.stepId).toBe("owners");
    expect(owners?.isPlainLiteral).toBe(false);
    // Reported where it is called, not inside the helper.
    expect(owners?.file).toBe("Page.tsx");
    expect(findStepProblems([form])).toEqual([]);
  });

  test("flag a helper's field on a step the form does not declare", () => {
    const form: FormFacts = only({
      "Page.tsx": `
        import getOwnersFormField from "./Owners";
        const Page = () => <ModelTable name="Rules" formSteps={[{ title: "One", id: "one" }, { title: "Owners", id: "owners" }]} formFields={[${field("a", 'stepId: "one",')}, getOwnersFormField({ stepId: "ownres" })]} />;`,
      "Owners.ts": `
        export const OWNERS_KEY = "owners";
        export const getOwnersFormField = (options) => {
          const { fieldKey, ...rest } = options;
          return { title: "Owners", ...rest, field: { [fieldKey || OWNERS_KEY]: true }, fieldType: FormFieldSchemaType.PeoplePicker, formOnly: true };
        };
        export default getOwnersFormField;`,
    });

    expect(
      findStepProblems([form]).map((problem: FormStepProblem): string => {
        return problem.kind;
      }),
    ).toEqual(["field-on-undeclared-step", "empty-step"]);
  });

  test("flag a field on a step the form does not declare", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <CardModelDetail name="Card" formSteps={[{ title: "One", id: "one" }, { title: "Two", id: "two" }]} formFields={[${field("a", 'stepId: "one",')}, ${field("b", 'stepId: "two",')}, ${field("typo", 'stepId: "tow",')}]} />;`,
    });

    expect(
      findStepProblems([form]).map((problem: FormStepProblem): string => {
        return problem.kind;
      }),
    ).toEqual(["field-on-undeclared-step"]);
  });

  test("flag a declared step no field is on", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <CardModelDetail name="Card" formSteps={[{ title: "One", id: "one" }, { title: "Empty", id: "empty" }]} formFields={[${fields(2, 'stepId: "one",')}]} />;`,
    });

    expect(
      findStepProblems([form]).map((problem: FormStepProblem): string => {
        return problem.kind;
      }),
    ).toEqual(["empty-step"]);
  });

  test("flag a step the Edit form would walk through empty", () => {
    const form: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Secrets" isEditable={true} formSteps={[{ title: "One", id: "one" }, { title: "Value", id: "value" }]} formFields={[${fields(2, 'stepId: "one",')}, ${field("secretValue", 'stepId: "value", doNotShowWhenEditing: true,')}]} />;`,
    });

    expect(
      findStepProblems([form]).map((problem: FormStepProblem): string => {
        return problem.kind;
      }),
    ).toEqual(["empty-step-on-edit"]);

    // A table with no Edit form never walks it.
    const createOnlyTable: FormFacts = only({
      "Page.tsx": `const Page = () => <ModelTable name="Secrets" isEditable={false} formSteps={[{ title: "One", id: "one" }, { title: "Value", id: "value" }]} formFields={[${fields(2, 'stepId: "one",')}, ${field("secretValue", 'stepId: "value", doNotShowWhenEditing: true,')}]} />;`,
    });

    expect(findStepProblems([createOnlyTable])).toEqual([]);
  });
});

function key(form: { file: string; form?: string; label?: string }): string {
  return `${form.file} :: ${form.form ?? form.label}`;
}

describe("the project's forms", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  /*
   * A broken walk must not pass by finding nothing. The floors sit far below
   * today's counts: see MIN_SCANNED_FORMS.
   */
  test("are really read", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(forms.length).toBeGreaterThan(MIN_SCANNED_FORMS);
    /*
     * 214 in CI on 2026-10-03, and falling as forms come down to one page
     * (labels-not-a-step alone took some 25 forms off their second step).
     */
    expect(
      forms.filter((form: FormFacts): boolean => {
        return form.hasSteps;
      }).length,
    ).toBeGreaterThan(100);
  });

  // The form the maintainer pointed at, found and stepped.
  test("include the Create Workflow Variable form, with its two steps", () => {
    const variableForm: FormFacts | undefined = forms.find(
      (form: FormFacts): boolean => {
        return (
          form.file ===
            "packages/App/FeatureSet/Dashboard/src/Components/Workflow/WorkflowVariablesTable.tsx" &&
          form.host === "ModelTable"
        );
      },
    );

    expect(variableForm).toBeDefined();
    expect(variableForm?.visibleFieldCount).toBe(4);
    expect(variableForm?.hasSteps).toBe(true);
    expect(
      variableForm?.steps?.map((step: { id: string | null }) => {
        return step.id;
      }),
    ).toEqual(["variable", "value"]);
  });

  /*
   * "The only thing I should see by default is: field name, field
   * description, type. That's basically it." - the custom field form is one
   * page, with everything else folded under one Advanced section, and the
   * mapped field dialog asks three things.
   */
  test("include the custom field form: one page, the rest folded under Advanced", () => {
    const customFieldForm: FormFacts | undefined = forms.find(
      (form: FormFacts): boolean => {
        return (
          form.file ===
            `${DASHBOARD}/Pages/Settings/Base/CustomFieldsPageBase.tsx` &&
          form.host === "ModelTable"
        );
      },
    );

    expect(customFieldForm).toBeDefined();
    expect(customFieldForm?.hasSteps).toBe(false);
    expect(
      customFieldForm?.fields
        .filter((candidate: FormFieldFacts): boolean => {
          return candidate.collapsibleSection === undefined;
        })
        .map((candidate: FormFieldFacts): string => {
          return candidate.key;
        }),
    ).toEqual(["name", "description", "customFieldType", "dropdownOptions"]);
    // Folded: one section, holding every other field.
    expect(
      new Set(
        customFieldForm?.fields
          .filter((candidate: FormFieldFacts): boolean => {
            return candidate.collapsibleSection !== undefined;
          })
          .map((candidate: FormFieldFacts): string => {
            return candidate.collapsibleSection!;
          }),
      ).size,
    ).toBe(1);
    expect(customFieldForm?.visibleFieldCount).toBe(5);

    const mappedFieldForm: FormFacts | undefined = forms.find(
      (form: FormFacts): boolean => {
        return (
          form.file ===
            `${DASHBOARD}/Components/CustomFields/CreateMappedCustomFieldModal.tsx` &&
          form.host === "ModelFormModal"
        );
      },
    );

    expect(mappedFieldForm).toBeDefined();
    expect(
      mappedFieldForm?.fields.map((candidate: FormFieldFacts): string => {
        return candidate.key;
      }),
    ).toEqual(["mapFromCustomFieldName", "name", "description"]);
    expect(mappedFieldForm?.visibleFieldCount).toBe(3);
    expect(findLongFormsWithoutSteps([mappedFieldForm!])).toEqual([]);
  });

  test("of more than three fields walk steps, or are listed with the reason they do not", () => {
    const listed: Set<string> = new Set<string>(
      LONG_FORMS_WITHOUT_STEPS.map(key),
    );

    const unlisted: Array<string> = findLongFormsWithoutSteps(forms)
      .filter((form: FormFacts): boolean => {
        return !listed.has(key(form));
      })
      .map(describeForm);

    expect(unlisted).toEqual([]);
  });

  test("that cannot be counted are listed, with the reason", () => {
    const listed: Set<string> = new Set<string>(UNCOUNTABLE_FORMS.map(key));

    const unlisted: Array<string> = findUncountableForms(forms)
      .filter((form: FormFacts): boolean => {
        return !listed.has(key(form));
      })
      .map((form: FormFacts): string => {
        return `${form.file}:${form.line} ${form.label} - ${form.uncountableReasons.join("; ")}`;
      });

    expect(unlisted).toEqual([]);
  });

  test("listed as one page are still long forms without steps, so the lists never go stale", () => {
    const longWithoutSteps: Set<string> = new Set<string>(
      findLongFormsWithoutSteps(forms).map(key),
    );
    const uncountable: Set<string> = new Set<string>(
      findUncountableForms(forms).map(key),
    );

    expect(
      LONG_FORMS_WITHOUT_STEPS.filter((entry: ListedForm): boolean => {
        return !longWithoutSteps.has(key(entry));
      }),
    ).toEqual([]);
    expect(
      UNCOUNTABLE_FORMS.filter((entry: ListedForm): boolean => {
        return !uncountable.has(key(entry));
      }),
    ).toEqual([]);
  });

  test("give every listed form a reason", () => {
    for (const entry of [
      ...LONG_FORMS_WITHOUT_STEPS,
      ...UNCOUNTABLE_FORMS,
      ...SHORT_FORMS_WITH_STEPS,
    ]) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  test("of three rows or fewer fit on one page, or are listed with the reason they walk steps", () => {
    const listed: Set<string> = new Set<string>(
      SHORT_FORMS_WITH_STEPS.map(key),
    );

    const unlisted: Array<string> = findShortFormsWithSteps(forms)
      .filter((found: ShortFormWithSteps): boolean => {
        return !listed.has(key(found.form));
      })
      .map(describeShortFormWithSteps);

    expect(unlisted).toEqual([]);
  });

  test("listed as short forms with steps still are, so the list never goes stale", () => {
    const shortWithSteps: Set<string> = new Set<string>(
      findShortFormsWithSteps(forms).map((found: ShortFormWithSteps) => {
        return key(found.form);
      }),
    );

    expect(
      SHORT_FORMS_WITH_STEPS.filter((entry: ListedForm): boolean => {
        return !shortWithSteps.has(key(entry));
      }),
    ).toEqual([]);
  });

  /*
   * The forms this rule was written for: each walked steps for three rows
   * and is one page now. Their fields are pinned in the order they show.
   */
  test.each([
    [
      `${DASHBOARD}/Pages/Incidents/Settings/IncidentNoteTemplates.tsx`,
      ["templateName", "templateDescription", "note"],
    ],
    [
      `${DASHBOARD}/Pages/Alerts/Settings/AlertNoteTemplates.tsx`,
      ["templateName", "templateDescription", "note"],
    ],
    [
      `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplates.tsx`,
      ["templateName", "templateDescription", "note"],
    ],
    [
      `${DASHBOARD}/Pages/Incidents/Settings/IncidentPostmortemTemplates.tsx`,
      ["templateName", "templateDescription", "postmortemNote"],
    ],
    [
      `${DASHBOARD}/Pages/NetworkDevice/Settings/OidCollectionTemplates.tsx`,
      ["name", "description", "oids"],
    ],
  ])(
    "include %s: one page of its three fields",
    (file: string, keys: Array<string>) => {
      const found: Array<FormFacts> = forms.filter(
        (form: FormFacts): boolean => {
          return form.file === file && form.host === "ModelTable";
        },
      );

      expect(found).toHaveLength(1);

      const form: FormFacts = found[0]!;

      expect(form.hasSteps).toBe(false);
      expect(form.uncountableReasons).toEqual([]);
      expect(countFormRows(form)).toBe(3);
      expect(
        form.fields.map((candidate: FormFieldFacts): string => {
          return candidate.key;
        }),
      ).toEqual(keys);
      // No field is left naming a step the form no longer has.
      expect(
        form.fields.filter((candidate: FormFieldFacts): boolean => {
          return candidate.stepId !== undefined;
        }),
      ).toEqual([]);
    },
  );

  /*
   * SLO create: the name and the target open, everything with a default
   * folded under one Advanced section - three rows, no steps.
   */
  test("include SLO create: the name and the target, the rest folded under Advanced", () => {
    const found: Array<FormFacts> = forms.filter((form: FormFacts): boolean => {
      return (
        form.file === `${DASHBOARD}/Pages/Slo/Slos.tsx` &&
        form.host === "ModelTable"
      );
    });

    expect(found).toHaveLength(1);

    const sloForm: FormFacts = found[0]!;

    expect(sloForm.hasSteps).toBe(false);
    expect(sloForm.uncountableReasons).toEqual([]);
    expect(countFormRows(sloForm)).toBe(3);
    expect(
      sloForm.fields
        .filter((candidate: FormFieldFacts): boolean => {
          return candidate.collapsibleSection === undefined;
        })
        .map((candidate: FormFieldFacts): string => {
          return candidate.key;
        }),
    ).toEqual(["name", "targetPercentage"]);
    expect(
      sloForm.fields
        .filter((candidate: FormFieldFacts): boolean => {
          return candidate.collapsibleSection !== undefined;
        })
        .map((candidate: FormFieldFacts): string => {
          return candidate.key;
        }),
    ).toEqual([
      "description",
      "atRiskThresholdPercentage",
      "windowType",
      "windowDays",
      "timezone",
      "labels",
    ]);
    // One section between them.
    expect(
      new Set(
        sloForm.fields
          .filter((candidate: FormFieldFacts): boolean => {
            return candidate.collapsibleSection !== undefined;
          })
          .map((candidate: FormFieldFacts): string => {
            return candidate.collapsibleSection!;
          }),
      ).size,
    ).toBe(1);
  });

  test("with steps never lose a field to a missing or mistyped step", () => {
    expect(
      findStepProblems(forms).map((problem: FormStepProblem): string => {
        return `${problem.form.file}:${problem.form.line} ${problem.form.label}: ${problem.message}`;
      }),
    ).toEqual([]);
  });
});
