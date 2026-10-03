import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  FormStepFacts,
  MIN_SCANNED_FORMS,
  RULE_CRITERIA_STEP_ID,
  SourceFileSystem,
  countFieldRows,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";

/*
 * "The idea is to reduce decision / choice paralysis as much as possible:
 * show people as few options as possible (and hide those other 'advanced'
 * options), and have sane defaults." - the maintainer, closing the feedback
 * document.
 *
 * Labels decide what a team whose access is restricted by labels can see,
 * and group resources for filtering. The forms called the field "optional
 * and an advanced feature", yet dozens of them gave it a wizard step of its
 * own - renaming a status page or creating a host meant a Next for one
 * optional field - and the rest showed it as a plain field.
 *
 * Every form now asks for labels the same way:
 * getLabelsFormField (Dashboard Utils/Form/LabelsFormField.ts), folded under
 * the form's collapsed Advanced section at the end of the step that holds
 * the record's name. A form left with three rows or fewer has no steps. This
 * guard keeps it so:
 *
 *   - no step of any form holds nothing but Labels, or nothing but folded
 *     fields (a page with one closed header on it);
 *   - a resource whose labels decide access (its model declares
 *     @AccessControlColumn("labels")) asks for them with the shared field,
 *     folded, and that section is the last row of its step;
 *   - a form with labels that fits in three rows has no stepper;
 *   - and the shapes this sweep gave each form are pinned below, so a form
 *     changed later is changed on purpose.
 *
 * Rule forms are not touched: a rule's labels are what it matches on (its
 * Match Criteria step, drawn as one criteria builder), and a label rule's
 * labels are what it adds. Neither model's labels decide access.
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

const LABELS_KEY: string = "labels";

export const LABELS_FORM_FIELD_HELPER: string = "getLabelsFormField";

const ACCESS_CONTROL_LABELS: RegExp = /@AccessControlColumn\(\s*"labels"\s*\)/;

export interface LabelsProblem {
  form: FormFacts;
  message: string;
}

function describeProblem(problem: LabelsProblem): string {
  return `${problem.form.file}:${problem.form.line} ${problem.form.label}: ${problem.message}`;
}

/*
 * The forms a host draws from one field list: a table's Create and Edit
 * forms apart (doNotShowWhenCreating / doNotShowWhenEditing), any other
 * host's one form.
 */
interface FormVariant {
  name: string;
  fields: Array<FormFieldFacts>;
}

const TABLE_HOSTS: ReadonlySet<string> = new Set<string>([
  "ModelTable",
  "RuleTable",
  "LabelRuleTable",
]);

function variantsOf(form: FormFacts): Array<FormVariant> {
  const shown: Array<FormFieldFacts> = form.fields.filter(
    (field: FormFieldFacts): boolean => {
      return !field.isNeverShown;
    },
  );

  if (!TABLE_HOSTS.has(form.host)) {
    return [{ name: "form", fields: shown }];
  }

  const variants: Array<FormVariant> = [];

  if (form.hasCreateForm !== false) {
    variants.push({
      name: "Create form",
      fields: shown.filter((field: FormFieldFacts): boolean => {
        return !field.isEditOnly;
      }),
    });
  }

  if (form.hasEditForm) {
    variants.push({
      name: "Edit form",
      fields: shown.filter((field: FormFieldFacts): boolean => {
        return !field.isCreateOnly;
      }),
    });
  }

  return variants;
}

function isLabelsField(field: FormFieldFacts): boolean {
  return field.key === LABELS_KEY;
}

function isFolded(field: FormFieldFacts): boolean {
  return field.collapsibleSection !== undefined;
}

/*
 * Steps that hold nothing but Labels, or nothing but folded fields. A rule
 * model's Match Criteria step is the criteria builder, whatever is listed
 * on it, so it is left alone.
 */
export function findLonelySteps(forms: Array<FormFacts>): Array<LabelsProblem> {
  const problems: Array<LabelsProblem> = [];

  for (const form of forms) {
    if (!form.hasSteps || form.hasSummaryOnly || !form.steps) {
      continue;
    }

    for (const step of form.steps) {
      if (!step.id) {
        continue;
      }

      if (step.id === RULE_CRITERIA_STEP_ID && form.isRuleModel) {
        continue;
      }

      for (const variant of variantsOf(form)) {
        const onStep: Array<FormFieldFacts> = variant.fields.filter(
          (field: FormFieldFacts): boolean => {
            return field.stepId === step.id;
          },
        );

        // An empty step is LongFormStepsGuard's to report.
        if (onStep.length === 0) {
          continue;
        }

        if (onStep.every(isLabelsField)) {
          problems.push({
            form,
            message: `step "${step.id}" (${step.title}) of the ${variant.name} holds nothing but Labels. Fold it under Advanced at the end of the step before (getLabelsFormField) and drop the step.`,
          });
          continue;
        }

        if (onStep.every(isFolded)) {
          problems.push({
            form,
            message: `step "${step.id}" (${step.title}) of the ${variant.name} holds nothing but folded fields: one closed header on a page of its own. Fold them at the end of the step before and drop the step.`,
          });
        }
      }
    }
  }

  return problems;
}

export type DecidesAccessByLabels = (form: FormFacts) => boolean;

export function makeDecidesAccessByLabels(
  fileSystem: SourceFileSystem,
  repositoryRoot: string,
): DecidesAccessByLabels {
  const cache: Map<string, boolean> = new Map<string, boolean>();

  return (form: FormFacts): boolean => {
    const modelFile: string | null | undefined = form.modelType?.file;

    if (!modelFile) {
      return false;
    }

    if (!cache.has(modelFile)) {
      const text: string | null = fileSystem.readFile(
        path.join(repositoryRoot, modelFile),
      );
      cache.set(modelFile, Boolean(text && ACCESS_CONTROL_LABELS.test(text)));
    }

    return cache.get(modelFile)!;
  };
}

/*
 * The fields the Labels field's step shows, in order: the whole form when it
 * has no steps. Null when the step cannot be read (a computed stepId).
 */
function fieldsBesideLabels(
  form: FormFacts,
  variant: FormVariant,
  labels: FormFieldFacts,
): Array<FormFieldFacts> | null {
  if (!form.hasSteps || form.hasSummaryOnly) {
    return variant.fields;
  }

  if (typeof labels.stepId !== "string") {
    return null;
  }

  return variant.fields.filter((field: FormFieldFacts): boolean => {
    return field.stepId === labels.stepId;
  });
}

/*
 * A resource whose labels decide access asks for them with the shared
 * field, folded under Advanced, and that section is the last row of its
 * step. A form of nothing but labels - a card of their own - is theirs to
 * show open.
 */
export function findLabelsFieldProblems(
  forms: Array<FormFacts>,
  decidesAccessByLabels: DecidesAccessByLabels,
): Array<LabelsProblem> {
  const problems: Array<LabelsProblem> = [];

  for (const form of forms) {
    if (!decidesAccessByLabels(form)) {
      continue;
    }

    for (const variant of variantsOf(form)) {
      if (variant.fields.length === 0 || variant.fields.every(isLabelsField)) {
        continue;
      }

      for (const labels of variant.fields.filter(isLabelsField)) {
        if (labels.helper !== LABELS_FORM_FIELD_HELPER) {
          problems.push({
            form,
            message: `the ${variant.name} writes its own Labels field (${labels.file}:${labels.line}). Use ${LABELS_FORM_FIELD_HELPER} so it reads and folds like every other form's.`,
          });
          continue;
        }

        if (!isFolded(labels)) {
          problems.push({
            form,
            message: `the ${variant.name} shows Labels open (${labels.file}:${labels.line}). Leave it folded under Advanced: hand ${LABELS_FORM_FIELD_HELPER} no collapsibleSection, or the form's own Advanced section.`,
          });
          continue;
        }

        const beside: Array<FormFieldFacts> | null = fieldsBesideLabels(
          form,
          variant,
          labels,
        );

        if (!beside) {
          continue;
        }

        const after: Array<FormFieldFacts> = beside.slice(
          beside.indexOf(labels) + 1,
        );

        if (
          after.some((field: FormFieldFacts): boolean => {
            return field.collapsibleSection !== labels.collapsibleSection;
          })
        ) {
          problems.push({
            form,
            message: `the ${variant.name} shows fields after the Advanced section that holds Labels (${labels.file}:${labels.line}). The section is the last row of its step.`,
          });
        }
      }
    }
  }

  return problems;
}

/*
 * A form with labels whose rows fit in three - the Advanced header counting
 * as one - has no steps: a stepper there exists only for what is folded.
 */
export function findStepperForThreeRows(
  forms: Array<FormFacts>,
): Array<LabelsProblem> {
  return forms
    .filter((form: FormFacts): boolean => {
      return (
        form.hasSteps &&
        !form.hasSummaryOnly &&
        form.uncountableReasons.length === 0 &&
        form.visibleFieldCount <= 3 &&
        form.fields.some(isLabelsField)
      );
    })
    .map((form: FormFacts): LabelsProblem => {
      return {
        form,
        message: `${form.visibleFieldCount} rows walk steps (${(
          form.steps || []
        )
          .map((step: FormStepFacts): string => {
            return step.id || "?";
          })
          .join(", ")}). Three rows fit on one page: drop the steps.`,
      };
    });
}

/*
 * ---------------------------------------------------------------------------
 * The detector, on inline snippets first.
 * ---------------------------------------------------------------------------
 */

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

// The shared helper, as written in the Dashboard (its returned object).
const HELPER_SOURCE: string = `
  export const getLabelsFormField = (options) => {
    const { collapsibleSection, ...rest } = options || {};
    return {
      title: "Labels",
      description: "Labels group related resources.",
      ...rest,
      field: { labels: true } as unknown as SelectFormFields<TEntity>,
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      required: false,
      placeholder: "Labels",
      collapsibleSection: collapsibleSection || getAdvancedFormSection(),
    };
  };
  export default getLabelsFormField;`;

const ACCESS_MODEL: string = `
  @AccessControlColumn("labels")
  export default class Thing extends BaseModel {}`;

const PLAIN_MODEL: string = `export default class Rule extends BaseModel {}`;

function scanPage(
  page: string,
  extra: Record<string, string> = {},
): { forms: Array<FormFacts>; fileSystem: SourceFileSystem } {
  const fileSystem: SourceFileSystem = virtualFileSystem({
    "Page.tsx": page,
    "LabelsFormField.ts": HELPER_SOURCE,
    "Thing.ts": ACCESS_MODEL,
    "Rule.ts": PLAIN_MODEL,
    ...extra,
  });

  return {
    forms: scanFormFiles({
      repositoryRoot: VIRTUAL_ROOT,
      files: [path.join(VIRTUAL_ROOT, "Page.tsx")],
      fileSystem,
    }),
    fileSystem,
  };
}

const PAGE_IMPORTS: string = `
  import getLabelsFormField from "./LabelsFormField";
  import Thing from "./Thing";
  import Rule from "./Rule";`;

function field(key: string, extra: string = ""): string {
  return `{ field: { ${key}: true }, title: "${key}", fieldType: FormFieldSchemaType.Text, ${extra} }`;
}

// A Labels field written out, the way the forms used to.
function handWrittenLabels(extra: string = ""): string {
  return `{ field: { labels: true }, title: "Labels", fieldType: FormFieldSchemaType.MultiSelectDropdown, dropdownModal: { type: Label, labelField: "name", valueField: "_id" }, ${extra} }`;
}

describe("the labels detector", () => {
  test("reads which helper a field comes from, outermost first", () => {
    const { forms } = scanPage(
      `${PAGE_IMPORTS}
      import { getWrapped } from "./Wrapped";
      const Page = () => <CardModelDetail name="Card" modelDetailProps={{ modelType: Thing }} formFields={[${field("name")}, getLabelsFormField(), getWrapped({ stepId: "x" })]} />;`,
      {
        "Wrapped.ts": `
          import getLabelsFormField from "./LabelsFormField";
          export const getWrapped = (options) => { return getLabelsFormField(options); };`,
      },
    );

    expect(forms).toHaveLength(1);
    expect(
      forms[0]!.fields.map((candidate: FormFieldFacts) => {
        return [candidate.key, candidate.helper];
      }),
    ).toEqual([
      ["name", undefined],
      ["labels", LABELS_FORM_FIELD_HELPER],
      ["labels", "getWrapped"],
    ]);
    // The helper's own default section makes it folded.
    expect(forms[0]!.fields[1]!.collapsibleSection).toBeDefined();
  });

  test("finds a step that holds nothing but Labels", () => {
    const { forms } = scanPage(
      `${PAGE_IMPORTS}
      const Page = () => <CardModelDetail name="Card" modelDetailProps={{ modelType: Thing }} formSteps={[{ title: "Info", id: "info" }, { title: "Labels", id: "labels" }]} formFields={[${field("name", 'stepId: "info",')}, ${field("description", 'stepId: "info",')}, ${handWrittenLabels('stepId: "labels",')}]} />;`,
    );

    expect(findLonelySteps(forms).map(describeProblem)).toEqual([
      'Page.tsx:5 CardModelDetail: Card: step "labels" (Labels) of the form holds nothing but Labels. Fold it under Advanced at the end of the step before (getLabelsFormField) and drop the step.',
    ]);
  });

  test("finds a step that holds nothing but folded fields", () => {
    const { forms } = scanPage(
      `${PAGE_IMPORTS}
      const advanced = getAdvancedFormSection();
      const Page = () => <ModelTable name="Things" modelType={Thing} isCreateable={true} formSteps={[{ title: "Info", id: "info" }, { title: "More", id: "more" }]} formFields={[${field("name", 'stepId: "info",')}, ${field("description", 'stepId: "info",')}, ${field("isEnabled", 'stepId: "more", collapsibleSection: advanced,')}, getLabelsFormField({ stepId: "more", collapsibleSection: advanced })]} />;`,
    );

    expect(
      findLonelySteps(forms).map((problem: LabelsProblem): string => {
        return problem.message;
      }),
    ).toEqual([
      'step "more" (More) of the Create form holds nothing but folded fields: one closed header on a page of its own. Fold them at the end of the step before and drop the step.',
    ]);
  });

  test("finds a table step that only one of its forms leaves holding Labels", () => {
    const { forms } = scanPage(
      `${PAGE_IMPORTS}
      const Page = () => <ModelTable name="Things" modelType={Thing} isCreateable={true} isEditable={true} formSteps={[{ title: "Info", id: "info" }, { title: "Labels", id: "labels" }]} formFields={[${field("name", 'stepId: "info",')}, ${field("note", 'stepId: "labels", doNotShowWhenCreating: true,')}, getLabelsFormField({ stepId: "labels" })]} />;`,
    );

    expect(
      findLonelySteps(forms).map((problem: LabelsProblem): string => {
        return problem.message.split(" holds")[0]!;
      }),
    ).toEqual(['step "labels" (Labels) of the Create form']);
  });

  test("leaves alone a step where Labels sits with other fields, and a rule's Match Criteria step", () => {
    const { forms } = scanPage(
      `${PAGE_IMPORTS}
      const Page = () => <>
        <CardModelDetail name="Device" modelDetailProps={{ modelType: Thing }} formSteps={[{ title: "Info", id: "info" }, { title: "Site", id: "site" }]} formFields={[${field("name", 'stepId: "info",')}, ${field("site", 'stepId: "site",')}, getLabelsFormField({ stepId: "site" })]} />
        <ModelTable name="Rules" modelType={Rule} isRuleTable={true} formSteps={[{ title: "Rule", id: "rule-info" }, { title: "Match", id: "match-criteria" }]} formFields={[${field("name", 'stepId: "rule-info",')}, ${handWrittenLabels('stepId: "match-criteria",')}]} />
      </>;`,
      {
        "Rule.ts": "export default class Rule extends RuleBaseModel {}",
      },
    );

    expect(forms).toHaveLength(2);
    expect(forms[1]!.isRuleModel).toBe(true);
    expect(findLonelySteps(forms)).toEqual([]);
  });

  test("asks a resource whose labels decide access for the shared field, folded, last on its step", () => {
    const { forms, fileSystem } = scanPage(
      `${PAGE_IMPORTS}
      const Page = () => <>
        <CardModelDetail name="Written" modelDetailProps={{ modelType: Thing }} formFields={[${field("name")}, ${handWrittenLabels()}]} />
        <CardModelDetail name="Open" modelDetailProps={{ modelType: Thing }} formFields={[${field("name")}, getLabelsFormField({ collapsibleSection: undefined }), ${field("other")}]} />
        <CardModelDetail name="Shared" modelDetailProps={{ modelType: Thing }} formFields={[${field("name")}, getLabelsFormField()]} />
        <CardModelDetail name="Middle" modelDetailProps={{ modelType: Thing }} formFields={[${field("name")}, getLabelsFormField(), ${field("after")}]} />
        <CardModelDetail name="Own Card" modelDetailProps={{ modelType: Thing }} formFields={[${handWrittenLabels()}]} />
        <CardModelDetail name="Rule" modelDetailProps={{ modelType: Rule }} formFields={[${field("name")}, ${handWrittenLabels()}]} />
      </>;`,
    );

    const decides: DecidesAccessByLabels = makeDecidesAccessByLabels(
      fileSystem,
      VIRTUAL_ROOT,
    );

    expect(
      forms.map((form: FormFacts): [string, boolean] => {
        return [form.label, decides(form)];
      }),
    ).toEqual([
      ["CardModelDetail: Written", true],
      ["CardModelDetail: Open", true],
      ["CardModelDetail: Shared", true],
      ["CardModelDetail: Middle", true],
      ["CardModelDetail: Own Card", true],
      ["CardModelDetail: Rule", false],
    ]);

    expect(
      findLabelsFieldProblems(forms, decides).map(
        (problem: LabelsProblem): string => {
          return `${problem.form.label}: ${problem.message.split(" (")[0]}`;
        },
      ),
    ).toEqual([
      "CardModelDetail: Written: the form writes its own Labels field",
      /*
       * The Dashboard's helper cannot be handed an undefined section (its
       * options type has no undefined), so this is only ever a helper
       * that passes the section through.
       */
      "CardModelDetail: Open: the form shows Labels open",
      "CardModelDetail: Middle: the form shows fields after the Advanced section that holds Labels",
    ]);
  });

  test("lets the shared section run on after Labels", () => {
    const { forms, fileSystem } = scanPage(
      `${PAGE_IMPORTS}
      const advanced = getAdvancedFormSection();
      const Page = () => <CardModelDetail name="Alert" modelDetailProps={{ modelType: Thing }} formFields={[${field("title")}, getLabelsFormField({ collapsibleSection: advanced }), ${field("isPrivate", "collapsibleSection: advanced,")}]} />;`,
    );

    expect(
      findLabelsFieldProblems(
        forms,
        makeDecidesAccessByLabels(fileSystem, VIRTUAL_ROOT),
      ),
    ).toEqual([]);
    expect(forms[0]!.visibleFieldCount).toBe(2);
  });

  test("finds a stepper on a form of three rows that holds labels", () => {
    const { forms } = scanPage(
      `${PAGE_IMPORTS}
      const Page = () => <>
        <CardModelDetail name="Short" modelDetailProps={{ modelType: Thing }} formSteps={[{ title: "Info", id: "info" }, { title: "More", id: "more" }]} formFields={[${field("name", 'stepId: "info",')}, ${field("description", 'stepId: "more",')}, getLabelsFormField({ stepId: "more" })]} />
        <CardModelDetail name="Long" modelDetailProps={{ modelType: Thing }} formSteps={[{ title: "Info", id: "info" }, { title: "More", id: "more" }]} formFields={[${field("name", 'stepId: "info",')}, ${field("a", 'stepId: "info",')}, ${field("b", 'stepId: "more",')}, ${field("c", 'stepId: "more",')}, getLabelsFormField({ stepId: "more" })]} />
      </>;`,
    );

    expect(
      findStepperForThreeRows(forms).map((problem: LabelsProblem): string => {
        return `${problem.form.label}: ${problem.message}`;
      }),
    ).toEqual([
      "CardModelDetail: Short: 3 rows walk steps (info, more). Three rows fit on one page: drop the steps.",
    ]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The project's forms.
 * ---------------------------------------------------------------------------
 */

/*
 * What a form shows on one step ("" for a form without steps): the fields
 * drawn open, and the ones folded under Advanced after them. A helper's field
 * is named for what it asks (owners, macAddress).
 */
interface RowsShape {
  open?: Array<string> | undefined;
  folded: Array<string>;
}

interface FormShape {
  file: string;
  label: string;
  // The step ids, in order (those written as strings); [] for one page.
  steps: Array<string>;
  rows: Record<string, RowsShape>;
  /*
   * Why the scan cannot follow every field of the form, when it cannot: its
   * pinned rows are still checked.
   */
  uncountable?: string | undefined;
  /*
   * A one-page form of more than three rows - listed, with the reason, in
   * LongFormStepsGuard's LONG_FORMS_WITHOUT_STEPS: the rows it shows.
   */
  longOnePageRows?: number | undefined;
}

function onePage(
  file: string,
  label: string,
  open: Array<string>,
  folded: Array<string>,
): FormShape {
  return { file, label, steps: [], rows: { "": { open, folded } } };
}

const NAME_DESCRIPTION: Array<string> = ["name", "description"];

const LABELS_ONLY: Array<string> = [LABELS_KEY];

export const LABELS_FORM_SHAPES: Array<FormShape> = [
  // Edit dialogs of three fields: the stepper existed only for Labels.
  onePage(
    `${DASHBOARD}/Components/Monitor/Overview/MonitorOverviewDetailsCard.tsx`,
    "CardModelDetail: Monitor Details",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/StatusPages/View/Index.tsx`,
    "CardModelDetail: Status Page > Status Page Details",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/Dashboards/View/Overview.tsx`,
    "CardModelDetail: Dashboard > Dashboard Details",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/Database/View/Settings.tsx`,
    "CardModelDetail: Database Settings",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/MessageQueue/View/Settings.tsx`,
    "CardModelDetail: Queue Settings",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/MonitorGroup/View/Index.tsx`,
    "CardModelDetail: MonitorGroup Details",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/OnCallDuty/IncomingCallPolicy/Index.tsx`,
    "CardModelDetail: Incoming Call Policy > Details",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/OnCallDuty/OnCallDutyPolicy/Index.tsx`,
    "CardModelDetail: On-Call Policy > On-Call Policy Details",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/OnCallDuty/OnCallDutySchedule/Index.tsx`,
    "CardModelDetail: On-Call Schedule > On-Call Schedule Details",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/Proxmox/View/Index.tsx`,
    "CardModelDetail: Cluster Details",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/VMware/View/Index.tsx`,
    "CardModelDetail: vCenter Details",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/Runbook/View/Index.tsx`,
    "CardModelDetail: Runbook > Overview",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/Incidents/View/Index.tsx`,
    "CardModelDetail: Incident Details",
    ["title", "incidentSeverity"],
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/Incidents/EpisodeView/Index.tsx`,
    "CardModelDetail: Episode Details",
    ["title", "incidentSeverity"],
    LABELS_ONLY,
  ),
  onePage(
    `${DASHBOARD}/Pages/Alerts/EpisodeView/Index.tsx`,
    "CardModelDetail: Episode Details",
    ["title", "alertSeverity"],
    LABELS_ONLY,
  ),

  /*
   * Edit dialogs of four fields: the one people rarely change folds with the
   * labels - Private Alert (as Create Alert folds it), the cluster identifier
   * (it has to match the agent), the tech stack (also on Settings, and read
   * from telemetry when blank), a workflow's Enabled switch (the builder
   * turns workflows on and off).
   */
  onePage(
    `${DASHBOARD}/Pages/Alerts/View/Index.tsx`,
    "CardModelDetail: Alert Details",
    ["title", "alertSeverity"],
    ["labels", "isPrivate"],
  ),
  onePage(
    `${DASHBOARD}/Pages/Kubernetes/View/Index.tsx`,
    "CardModelDetail: Cluster Details",
    NAME_DESCRIPTION,
    ["clusterIdentifier", "labels"],
  ),
  onePage(
    `${DASHBOARD}/Pages/Service/View/Index.tsx`,
    "CardModelDetail: Service > Service Details",
    NAME_DESCRIPTION,
    ["techStack", "labels"],
  ),
  onePage(
    `${DASHBOARD}/Pages/Workflow/View/Index.tsx`,
    "CardModelDetail: Workflow > Workflow Details",
    NAME_DESCRIPTION,
    ["isEnabled", "labels"],
  ),

  /*
   * Create forms of a resource matched by an identifier: the identifier
   * open, and the display name (which follows it), the description and the
   * labels folded (DiscoveredResourceCreateFormsGuard).
   */
  ...[
    ["Host/Hosts.tsx", "ModelTable: Hosts", "hostIdentifier"],
    ["Docker/Hosts.tsx", "ModelTable: Docker Hosts", "hostIdentifier"],
    ["Podman/Hosts.tsx", "ModelTable: Podman Hosts", "hostIdentifier"],
    [
      "Kubernetes/Clusters.tsx",
      "ModelTable: Kubernetes Clusters",
      "clusterIdentifier",
    ],
    [
      "Rum/RumApplications.tsx",
      "ModelTable: RUM Applications",
      "appIdentifier",
    ],
    [
      "Serverless/ServerlessFunctions.tsx",
      "ModelTable: Serverless Functions",
      "functionIdentifier",
    ],
  ].map(([file, label, identifier]: Array<string>): FormShape => {
    return onePage(
      `${DASHBOARD}/Pages/${file}`,
      label!,
      [identifier!],
      ["name", "description", "labels"],
    );
  }),
  // The same for a cloud environment, matched on its platform, account and region.
  {
    ...onePage(
      `${DASHBOARD}/Pages/Cloud/CloudResources.tsx`,
      "ModelTable: Cloud Environments",
      ["cloudPlatform", "cloudAccountId", "cloudRegion"],
      ["name", "description", "labels"],
    ),
    longOnePageRows: 4,
  },
  /*
   * Name and "Who takes turns?" (OnCallScheduleCreateForm.ts); how long each
   * turn lasts and the timezone fold with the description and the labels.
   */
  onePage(
    `${DASHBOARD}/Pages/OnCallDuty/OnCallDutySchedules.tsx`,
    "ModelTable: On-Call > Schedules",
    ["name", "SCHEDULE_TAKES_TURNS_FIELD_KEY"],
    ["SCHEDULE_TURN_LENGTH_FIELD_KEY", "timezone", "description", "labels"],
  ),
  onePage(
    `${DASHBOARD}/Pages/Runbook/Runbooks.tsx`,
    "ModelTable: Runbooks",
    NAME_DESCRIPTION,
    ["isEnabled", "labels"],
  ),
  onePage(
    `${DASHBOARD}/Pages/OnCallDuty/IncomingCallPolicies.tsx`,
    "ModelTable: On-Call > Incoming Call Policies",
    NAME_DESCRIPTION,
    LABELS_ONLY,
  ),
  // Create and Edit Probe: the "More" step held the auto-enable switch and labels.
  ...[
    [
      `${DASHBOARD}/Pages/Monitor/Settings/MonitorProbes.tsx`,
      "ModelTable: Settings > Probes",
    ],
    [
      `${DASHBOARD}/Pages/Monitor/Settings/MonitorProbeView.tsx`,
      "CardModelDetail: Probe Details",
    ],
  ].map(([file, label]: Array<string>): FormShape => {
    return onePage(file!, label!, NAME_DESCRIPTION, [
      "iconFile",
      "shouldAutoEnableProbeOnNewMonitors",
      "labels",
    ]);
  }),
  // One-page create forms that showed Labels as a plain field.
  ...[
    ["Ceph/Clusters.tsx", "ModelTable: Ceph Clusters"],
    ["DockerSwarm/Clusters.tsx", "ModelTable: Docker Swarm Clusters"],
    ["IoT/Fleets.tsx", "ModelTable: IoT Fleets"],
    ["Proxmox/Clusters.tsx", "ModelTable: Proxmox Clusters"],
    ["VMware/VCenters.tsx", "ModelTable: vCenters"],
    ["Service/Services.tsx", "ModelTable: Services"],
  ].map(([file, label]: Array<string>): FormShape => {
    return onePage(
      `${DASHBOARD}/Pages/${file}`,
      label!,
      NAME_DESCRIPTION,
      LABELS_ONLY,
    );
  }),

  // Stepped forms: the Labels step goes, the field folds where the name is.
  {
    file: `${DASHBOARD}/Pages/Monitor/Create.tsx`,
    label: "ModelForm: Create New Monitor",
    steps: ["monitor-info", "criteria", "monitoring-interval"],
    rows: {
      "monitor-info": {
        open: ["name", "description", "monitorType"],
        folded: LABELS_ONLY,
      },
    },
  },
  {
    file: `${DASHBOARD}/Pages/Monitor/Settings/MonitorTemplates.tsx`,
    label: "ModelTable: Settings > Monitor Templates",
    steps: [
      "template-info",
      "monitor-defaults",
      "criteria",
      "monitoring-interval",
    ],
    rows: {
      "monitor-defaults": {
        open: ["monitorName", "monitorDescription", "monitorType"],
        folded: LABELS_ONLY,
      },
    },
  },
  {
    file: `${DASHBOARD}/Pages/Incidents/Settings/IncidentTemplates.tsx`,
    label: "ModelTable: Settings > Incident Templates",
    /*
     * The Owners and Labels steps, one optional field each, fold under
     * Advanced on Incident Details, as a maintenance template's do on Event.
     */
    steps: [
      "template-info",
      "incident-details",
      "resources-affected",
      "on-call",
    ],
    uncountable:
      "Its custom field steps are spread in between, from the project's custom fields at runtime.",
    rows: {
      "incident-details": {
        open: [
          "title",
          "description",
          "incidentSeverity",
          "initialIncidentState",
        ],
        folded: ["owners", "labels"],
      },
    },
  },
  {
    file: `${DASHBOARD}/Pages/Incidents/Settings/IncidentTemplatesView.tsx`,
    label: "CardModelDetail: Incident Template Details",
    steps: ["template-info", "incident-details", "on-call"],
    rows: {
      "incident-details": {
        open: [
          "title",
          "description",
          "incidentSeverity",
          "initialIncidentState",
        ],
        folded: LABELS_ONLY,
      },
    },
  },
  {
    file: `${DASHBOARD}/Pages/Database/Databases.tsx`,
    label: "ModelTable: Databases",
    steps: ["connection", "database-info"],
    rows: { "database-info": { open: NAME_DESCRIPTION, folded: LABELS_ONLY } },
  },
  {
    file: `${DASHBOARD}/Pages/MessageQueue/MessageQueues.tsx`,
    label: "ModelTable: Queues",
    steps: ["messaging-system", "queue-info"],
    rows: { "queue-info": { open: NAME_DESCRIPTION, folded: LABELS_ONLY } },
  },
  {
    file: `${DASHBOARD}/Pages/CodeRepository/View/Index.tsx`,
    label: "CardModelDetail: Repository > Repository Details",
    steps: ["repository-info", "source"],
    rows: {
      "repository-info": { open: NAME_DESCRIPTION, folded: LABELS_ONLY },
    },
  },
  {
    file: `${DASHBOARD}/Pages/Slo/Slos.tsx`,
    label: "ModelTable: SLOs",
    steps: ["basic-info", "objective", "period"],
    rows: { "basic-info": { open: NAME_DESCRIPTION, folded: LABELS_ONLY } },
  },
  {
    file: `${DASHBOARD}/Pages/NetworkDevice/View/Index.tsx`,
    label: "CardModelDetail: Network Device Details",
    // The site joins the device's details; it shared a last step with labels.
    steps: ["device-details", "address"],
    rows: {
      "device-details": {
        open: ["name", "description", "site"],
        folded: LABELS_ONLY,
      },
      address: { open: ["hostname", "macAddress"], folded: [] },
    },
  },
];

/*
 * The forms that hand getLabelsFormField a description of their own, in
 * file order: the templates, whose labels are handed on.
 */
const TEMPLATES_WORDING_THEIR_OWN_LABELS_HELP: Array<string> = [
  `${DASHBOARD}/Pages/Incidents/Settings/IncidentTemplates.tsx: Incidents declared from this template start with these labels.`,
  `${DASHBOARD}/Pages/Incidents/Settings/IncidentTemplatesView.tsx: Incidents declared from this template start with these labels.`,
  `${DASHBOARD}/Pages/Monitor/Settings/MonitorTemplates.tsx: Default labels applied to monitors created from this template.`,
  `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx: Events scheduled from this template start with these labels.`,
];

/*
 * Every getLabelsFormField call that hands the helper a description, as
 * "file: description", sorted by file.
 */
export function findLabelsDescriptionOverrides(
  files: Array<string>,
): Array<string> {
  const found: Array<string> = [];

  for (const file of files) {
    const text: string = fs.readFileSync(file, "utf8");

    if (!text.includes(LABELS_FORM_FIELD_HELPER)) {
      continue;
    }

    const source: ts.SourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === LABELS_FORM_FIELD_HELPER
      ) {
        const options: ts.Expression | undefined = node.arguments[0];

        if (options && ts.isObjectLiteralExpression(options)) {
          for (const property of options.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              property.name.getText(source) === "description"
            ) {
              const value: ts.Expression = property.initializer;

              found.push(
                `${path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/")}: ${
                  ts.isStringLiteralLike(value)
                    ? value.text
                    : value.getText(source)
                }`,
              );
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return found.sort();
}

// What a helper's field asks, for the shapes above.
const HELPER_KEYS: Record<string, string> = {
  getOwnersFormField: "owners",
  getMacAddressFormField: "macAddress",
};

function keyOf(field: FormFieldFacts): string {
  return (field.helper && HELPER_KEYS[field.helper]) || field.key;
}

describe("labels on the project's forms", () => {
  const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  );

  const forms: Array<FormFacts> = scanFormFiles({
    repositoryRoot: REPOSITORY_ROOT,
    files,
  });

  const decidesAccessByLabels: DecidesAccessByLabels =
    makeDecidesAccessByLabels(
      {
        readFile: (filePath: string): string | null => {
          try {
            return fs.readFileSync(filePath, "utf8");
          } catch {
            return null;
          }
        },
      },
      REPOSITORY_ROOT,
    );

  const withLabels: Array<FormFacts> = forms.filter(
    (form: FormFacts): boolean => {
      return form.fields.some(isLabelsField);
    },
  );

  /*
   * A broken walk must not pass by finding nothing. The floors sit far below
   * today's counts: see MIN_SCANNED_FORMS.
   */
  test("are really read", () => {
    expect(forms.length).toBeGreaterThan(MIN_SCANNED_FORMS);
    expect(withLabels.length).toBeGreaterThan(30);
    expect(withLabels.filter(decidesAccessByLabels).length).toBeGreaterThan(25);
  });

  test("never walk a step that holds nothing but Labels, or nothing but folded fields", () => {
    expect(findLonelySteps(forms).map(describeProblem)).toEqual([]);
  });

  test("ask for the labels that decide access with the shared field, folded under Advanced, last on its step", () => {
    expect(
      findLabelsFieldProblems(forms, decidesAccessByLabels).map(
        describeProblem,
      ),
    ).toEqual([]);
  });

  test("of three rows or fewer have no steps", () => {
    expect(findStepperForThreeRows(forms).map(describeProblem)).toEqual([]);
  });

  test.each(LABELS_FORM_SHAPES)(
    "$label ($file) has the shape this sweep gave it",
    (shape: FormShape) => {
      const found: Array<FormFacts> = forms.filter(
        (form: FormFacts): boolean => {
          return form.file === shape.file && form.label === shape.label;
        },
      );

      expect(found).toHaveLength(1);

      const form: FormFacts = found[0]!;

      if (shape.uncountable) {
        expect(form.uncountableReasons.length).toBeGreaterThan(0);
      } else {
        expect(form.uncountableReasons).toEqual([]);
      }

      expect(form.hasSteps).toBe(shape.steps.length > 0);
      expect(
        (form.steps || [])
          .map((step: FormStepFacts): string | null => {
            return step.id;
          })
          .filter((id: string | null): id is string => {
            return id !== null;
          }),
      ).toEqual(shape.steps);

      if (shape.steps.length === 0) {
        expect(Object.keys(shape.rows)).toEqual([""]);
        expect(form.visibleFieldCount).toBeLessThanOrEqual(
          shape.longOnePageRows ?? 3,
        );
      }

      const shown: Array<FormFieldFacts> = variantsOf(form)[0]!.fields;

      for (const [stepId, rows] of Object.entries(shape.rows)) {
        const onStep: Array<FormFieldFacts> =
          stepId === ""
            ? shown
            : shown.filter((field: FormFieldFacts): boolean => {
                return field.stepId === stepId;
              });
        const open: Array<FormFieldFacts> = onStep.filter(
          (field: FormFieldFacts): boolean => {
            return !isFolded(field);
          },
        );
        const folded: Array<FormFieldFacts> = onStep.filter(isFolded);

        if (rows.open) {
          expect({ step: stepId, open: open.map(keyOf) }).toEqual({
            step: stepId,
            open: rows.open,
          });
        }

        expect({ step: stepId, folded: folded.map(keyOf) }).toEqual({
          step: stepId,
          folded: rows.folded,
        });

        // The folded ones are one section, after everything open.
        expect(onStep.slice(onStep.length - folded.length).map(keyOf)).toEqual(
          folded.map(keyOf),
        );
        expect(
          new Set(
            folded.map((field: FormFieldFacts): string | undefined => {
              return field.collapsibleSection;
            }),
          ).size,
        ).toBeLessThanOrEqual(1);

        if (folded.length > 0) {
          expect(countFieldRows(onStep)).toBe(open.length + 1);
        }
      }
    },
  );

  /*
   * The Workflows table never draws its own form: creating goes through the
   * template wizard (CreateWorkflowModal), and a workflow is edited on its
   * page. Its stepped field list with a Labels step was never shown.
   */
  test("the Workflows table carries no form of its own", () => {
    expect(
      forms
        .filter((form: FormFacts): boolean => {
          return form.file === `${DASHBOARD}/Pages/Workflow/Workflows.tsx`;
        })
        .map((form: FormFacts): string => {
          return form.label;
        }),
    ).not.toContain("ModelTable: Workflows");
  });

  /*
   * One sentence says what labels do, on every form. Only a template words
   * its own: its labels are not the template's access, they are handed on
   * to what it creates, so it says that instead.
   */
  test("keep the shared help, except on a template, which says what it hands on", () => {
    expect(
      findLabelsDescriptionOverrides(
        files.filter((file: string): boolean => {
          return file.includes(`${path.sep}FeatureSet${path.sep}`);
        }),
      ),
    ).toEqual(TEMPLATES_WORDING_THEIR_OWN_LABELS_HELP);
  });

  /*
   * The old help ("... This is optional and an advanced feature.") said what
   * the folded section now says by itself, and its "Labels " title with a
   * trailing space was a translation key of its own.
   */
  test("leave the old Labels copy behind", () => {
    const dashboardFiles: Array<string> = files.filter(
      (file: string): boolean => {
        return file.includes(`${path.sep}FeatureSet${path.sep}`);
      },
    );
    const offenders: Array<string> = [];
    const titleWithTrailingSpace: RegExp = /title: "Labels "/;

    for (const file of dashboardFiles) {
      const text: string = fs.readFileSync(file, "utf8");

      if (
        text.includes("This is optional and an advanced feature.") ||
        titleWithTrailingSpace.test(text)
      ) {
        offenders.push(path.relative(REPOSITORY_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
