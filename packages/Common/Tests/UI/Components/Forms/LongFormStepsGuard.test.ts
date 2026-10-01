import { describe, expect, test } from "@jest/globals";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormStepProblem,
  LONG_FORM_FIELD_LIMIT,
  SourceFileSystem,
  describeForm,
  findLongFormsWithoutSteps,
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
      "The conditions and channel options of a workspace notification rule, drawn as one field inside the Rules step of the rule's own wizard (WorkspaceNotificationRulesTable); a stepper inside a step would nest one wizard in another. Most of its fields appear only for the posting option picked.",
  },
  {
    file: `${DASHBOARD}/Pages/SecurityEvents/ThreatIntel.tsx`,
    form: "BasicFormModal: Security Events > Update Threat Intel Feed Credentials",
    reason:
      "Never more than three fields at once: the authentication mode, then either the API token or the basic auth username and password - the two are alternatives.",
  },
  {
    file: "packages/App/FeatureSet/StatusPage/src/Pages/Subscribe/UpdateSubscription.tsx",
    form: "ModelForm: Status Page > Update Subscription",
    reason:
      "A subscriber managing a subscription from an email link: the contact field is read-only and only one of the three ever shows, the pickers open only when an 'all' box is unticked, and Unsubscribe must not be hidden behind a Next.",
  },
];

/*
 * Forms whose fields cannot be counted from the source - built from data or
 * handed in by a caller - with why they need no steps, or where the steps
 * live instead.
 */
export const UNCOUNTABLE_FORMS: Array<ListedForm> = [
  {
    file: "packages/App/FeatureSet/Accounts/src/Pages/IncidentForm.tsx",
    form: "BasicForm: incident-form",
    reason:
      "A public incident report form whose questions are the customer's own Incident Form design (title, description, severity, their custom fields, the reporter's details, a CAPTCHA). Someone reporting an outage fills it in one go, in two columns on a wide screen; a Next before the reporter's details and the CAPTCHA would only slow that down.",
  },
  {
    file: `${DASHBOARD}/Components/Dashboard/Canvas/ArgumentsForm.tsx`,
    form: "BasicForm #1",
    reason:
      "A dashboard widget's settings, built from the widget's own argument list and already drawn as one small form per argument section in the side panel, not as one long dialog.",
  },
  {
    file: `${DASHBOARD}/Pages/Slo/View/Index.tsx`,
    form: "CardModelDetail: SLO Details",
    reason:
      "Picks the create form's name, description and labels fields by column (pickSloFormFields): three fields.",
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

  // A broken walk must not pass by finding nothing.
  test("are really read", () => {
    expect(files.length).toBeGreaterThan(2000);
    expect(forms.length).toBeGreaterThan(500);
    expect(
      forms.filter((form: FormFacts): boolean => {
        return form.hasSteps;
      }).length,
    ).toBeGreaterThan(250);
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
    for (const entry of [...LONG_FORMS_WITHOUT_STEPS, ...UNCOUNTABLE_FORMS]) {
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  test("with steps never lose a field to a missing or mistyped step", () => {
    expect(
      findStepProblems(forms).map((problem: FormStepProblem): string => {
        return `${problem.form.file}:${problem.form.line} ${problem.form.label}: ${problem.message}`;
      }),
    ).toEqual([]);
  });
});
