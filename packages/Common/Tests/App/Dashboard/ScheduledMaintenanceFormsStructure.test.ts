import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FormFacts,
  FormFieldFacts,
  STEP_FIELD_LIMIT,
  countFieldRows,
  scanFormFiles,
} from "../../Helpers/FormStepsScan";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/FoldedSection/FoldedSectionTitles";
import {
  getFormSteps,
  getTemplateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates";

/*
 * Scheduling maintenance takes two short steps and a review: Event, then
 * Resources Affected - the shape of Declare Incident. The four forms of a
 * scheduled maintenance event put each field they hold on the same step:
 *
 *   - Create Scheduled Maintenance Event (Pages/ScheduledMaintenanceEvents/
 *     Create.tsx), and the review step after them;
 *   - the event's details card Edit (View/Index.tsx) - its resources,
 *     description and owners are edited elsewhere on the page, so its
 *     second step is just its status pages and reminders, "Status Pages";
 *   - a template's create form, which adds its own name and description in
 *     front and its recurring schedule at the end, and the template's Edit,
 *     which leaves out the resources and owners its page has cards for.
 *
 * So a field is on the same step, folded the same way, in every form that
 * has it - Owners and Labels under Advanced on Event, the subscriber
 * switches in Subscriber Notifications - and no step exists for one field.
 *
 * Resources Affected asks for the monitors apart from every other resource,
 * with Change Monitor Status to right under them and never folded, as
 * Declare Incident does (#4354). The maintainer: "we also need to have
 * monitors and other affected resources as seperate things (so change
 * monitor sttate to makes more sense), only show that dropdown if any
 * monitor is selected."
 *
 * labels-not-a-step and other later sweeps: these forms are already done;
 * keep them matching this, or change this on purpose.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";
const CREATE_FILE: string = `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/Create.tsx`;
const VIEW_FILE: string = `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/View/Index.tsx`;
const TEMPLATE_FILE: string = `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx`;
const TEMPLATE_VIEW_FILE: string = `${DASHBOARD}/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView.tsx`;

// The folded section of rarely needed fields, as getAdvancedFormSection titles it.
const ADVANCED: string = MORE_FIELDS_SECTION_TITLE;
const SUBSCRIBER_NOTIFICATIONS: string = "Subscriber Notifications";

const NOTIFY_SWITCHES: Array<string> = [
  "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
  "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing",
  "shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded",
];

const REMINDERS: string = "sendSubscriberNotificationsOnBeforeTheEvent";

/*
 * The section constants the pages fold fields with, by the name the source
 * gives them, and the helper each must be built with (checked below).
 */
const SECTION_CONSTANTS: Record<
  string,
  { title: string; builtWith: string; files: Array<string> }
> = {
  advancedSection: {
    title: ADVANCED,
    builtWith: "getAdvancedFormSection",
    files: [CREATE_FILE, TEMPLATE_FILE],
  },
  subscriberNotificationsSection: {
    title: SUBSCRIBER_NOTIFICATIONS,
    builtWith: "getSubscriberNotificationsSection",
    files: [CREATE_FILE, TEMPLATE_FILE],
  },
  detailsAdvancedSection: {
    title: ADVANCED,
    builtWith: "getAdvancedFormSection",
    files: [VIEW_FILE],
  },
};

// Resources Affected: the monitors, the status they change to, everything else.
const RESOURCE_ROWS: Array<string> = [
  "monitors",
  "changeMonitorStatusTo",
  "hosts",
];

/*
 * Which step of the event a step id stands for. The Edit forms call their
 * second step after what is left on it ("Status Pages"): the resources are
 * edited in a card of their own on those pages.
 */
const STEP_OF_THE_EVENT: Record<string, string> = {
  "template-info": "the template",
  event: "the event",
  "resources-affected": "what it affects and who hears",
  "status-pages": "what it affects and who hears",
  recurring: "the schedule",
};

// A field as this test compares it: where it is and what it is folded in.
interface Placement {
  key: string;
  stepId: string;
  section: string;
}

interface FormShape {
  name: string;
  steps: Array<string>;
  placements: Array<Placement>;
}

function readSource(file: string): string {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8");
}

function normalizeKey(key: string): string {
  // The owners picker's key is computed in its helper (OwnersFormField).
  return key.includes("OWNERS_FORM_FIELD_KEY") ? "owners" : key;
}

const scannedForms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: [CREATE_FILE, VIEW_FILE, TEMPLATE_VIEW_FILE].map(
    (file: string): string => {
      return path.join(REPOSITORY_ROOT, file);
    },
  ),
});

function scannedForm(file: string, label: string): FormFacts {
  const found: FormFacts | undefined = scannedForms.find(
    (form: FormFacts): boolean => {
      return form.file === file && form.label === label;
    },
  );

  expect(`${file} ${label}: ${Boolean(found)}`).toBe(`${file} ${label}: true`);

  return found!;
}

function shapeOfScannedForm(name: string, form: FormFacts): FormShape {
  return {
    name,
    steps: (form.steps || []).map(
      (step: { id: string | null; title: string }): string => {
        return `${step.id}: ${step.title}`;
      },
    ),
    placements: form.fields
      .filter((field: FormFieldFacts): boolean => {
        return !field.isNeverShown;
      })
      .map((field: FormFieldFacts): Placement => {
        const section: string = field.collapsibleSection
          ? SECTION_CONSTANTS[field.collapsibleSection]?.title ||
            `unknown section ${field.collapsibleSection}`
          : "";

        return {
          key: normalizeKey(field.key),
          stepId: field.stepId || "",
          section,
        };
      }),
  };
}

// Recurring fields show once the template recurs; registrations never do.
const RECURRING_VALUES: FormValues<ScheduledMaintenanceTemplate> = {
  isRecurringEvent: true,
} as FormValues<ScheduledMaintenanceTemplate>;

function shapeOfTemplateForm(
  name: string,
  data: { isViewPage: boolean; excludeAffectedResources?: boolean },
): FormShape {
  return {
    name,
    steps: getFormSteps(data).map(
      (step: FormStep<ScheduledMaintenanceTemplate>): string => {
        return `${step.id}: ${step.title}`;
      },
    ),
    placements: getTemplateFormFields(data)
      .filter((field: ModelField<ScheduledMaintenanceTemplate>): boolean => {
        return !field.showIf || field.showIf(RECURRING_VALUES);
      })
      .map((field: ModelField<ScheduledMaintenanceTemplate>): Placement => {
        return {
          key: normalizeKey(
            field.overrideFieldKey || Object.keys(field.field || {})[0] || "",
          ),
          stepId: field.stepId || "",
          section: field.collapsibleSection?.title || "",
        };
      }),
  };
}

// "monitors" or "Advanced: owners, labels", step by step.
function rowsByStep(shape: FormShape): Record<string, Array<string>> {
  const rows: Record<string, Array<string>> = {};
  let previous: Placement | null = null;

  for (const placement of shape.placements) {
    const stepRows: Array<string> = rows[placement.stepId] || [];
    rows[placement.stepId] = stepRows;

    if (
      placement.section &&
      previous &&
      previous.stepId === placement.stepId &&
      previous.section === placement.section
    ) {
      stepRows[stepRows.length - 1] += `, ${placement.key}`;
    } else {
      stepRows.push(
        placement.section
          ? `${placement.section}: ${placement.key}`
          : placement.key,
      );
    }

    previous = placement;
  }

  return rows;
}

const CREATE: FormShape = shapeOfScannedForm(
  "Create Scheduled Maintenance Event",
  scannedForm(CREATE_FILE, "ModelForm: Create New Scheduled Maintenance Event"),
);

const EDIT: FormShape = shapeOfScannedForm(
  "the event's details card Edit",
  scannedForm(VIEW_FILE, "CardModelDetail: Scheduled Maintenance Details"),
);

const TEMPLATE_CREATE: FormShape = shapeOfTemplateForm(
  "Create Scheduled Maintenance Template",
  { isViewPage: false },
);

const TEMPLATE_EDIT: FormShape = shapeOfTemplateForm(
  "the template's details card Edit",
  { isViewPage: true, excludeAffectedResources: true },
);

const ALL_FORMS: Array<FormShape> = [
  CREATE,
  EDIT,
  TEMPLATE_CREATE,
  TEMPLATE_EDIT,
];

const NOTIFY_SECTION_ROW: string = `${SUBSCRIBER_NOTIFICATIONS}: ${[
  ...NOTIFY_SWITCHES,
  REMINDERS,
].join(", ")}`;

describe("the scheduled maintenance forms", () => {
  test("are really read", () => {
    for (const shape of ALL_FORMS) {
      expect(`${shape.name}: ${shape.placements.length > 3}`).toBe(
        `${shape.name}: true`,
      );
    }
  });

  test("Create walks Event and Resources Affected, then the review", () => {
    const form: FormFacts = scannedForm(
      CREATE_FILE,
      "ModelForm: Create New Scheduled Maintenance Event",
    );

    expect(CREATE.steps).toEqual([
      "event: Event",
      "resources-affected: Resources Affected",
    ]);
    expect(readSource(CREATE_FILE)).toContain("summary={{");
    expect(form.hasSteps).toBe(true);

    expect(rowsByStep(CREATE)).toEqual({
      event: [
        "title",
        "description",
        "startsAt",
        "endsAt",
        `${ADVANCED}: owners, labels`,
      ],
      "resources-affected": [
        ...RESOURCE_ROWS,
        "statusPages",
        NOTIFY_SECTION_ROW,
      ],
    });
  });

  test("Create starts the window at the next full hour, for an hour", () => {
    const form: FormFacts = scannedForm(
      CREATE_FILE,
      "ModelForm: Create New Scheduled Maintenance Event",
    );

    for (const key of ["startsAt", "endsAt"]) {
      const field: FormFieldFacts | undefined = form.fields.find(
        (candidate: FormFieldFacts): boolean => {
          return candidate.key === key;
        },
      );

      expect(`${key}: ${field?.hasDefault}`).toBe(`${key}: true`);
    }

    const source: string = readSource(CREATE_FILE);

    expect(source).toContain("return getDefaultMaintenanceStartsAt();");
    expect(source).toContain("return getDefaultMaintenanceEndsAt(values);");
    expect(source).toContain("onChange: moveMaintenanceEndWithStart,");
    expect(source).toContain("return getMaintenanceEndsAtError(values);");
  });

  test("the details card Edit walks Event and Status Pages", () => {
    expect(EDIT.steps).toEqual(["event: Event", "status-pages: Status Pages"]);
    expect(rowsByStep(EDIT)).toEqual({
      event: ["title", "startsAt", "endsAt", `${ADVANCED}: labels`],
      "status-pages": ["statusPages", REMINDERS],
    });

    const source: string = readSource(VIEW_FILE);

    expect(source).toContain("onChange: moveMaintenanceEndWithStart,");
    expect(source).toContain("return getMaintenanceEndsAtError(values);");
    expect(source).not.toContain("getDefaultMaintenanceStartsAt");
  });

  test("a template's create form adds its name in front and its schedule at the end", () => {
    expect(TEMPLATE_CREATE.steps).toEqual([
      "template-info: Template Info",
      "event: Event",
      "resources-affected: Resources Affected",
      "recurring: Recurring",
    ]);
    expect(rowsByStep(TEMPLATE_CREATE)).toEqual({
      "template-info": ["templateName", "templateDescription"],
      event: ["title", "description", `${ADVANCED}: owners, labels`],
      "resources-affected": [
        ...RESOURCE_ROWS,
        "statusPages",
        NOTIFY_SECTION_ROW,
      ],
      recurring: [
        "isRecurringEvent",
        "firstEventScheduledAt",
        "firstEventStartsAt",
        "firstEventEndsAt",
        "recurringInterval",
      ],
    });
  });

  test("a template's Edit leaves out the resources and owners its page has cards for", () => {
    expect(TEMPLATE_EDIT.steps).toEqual([
      "template-info: Template Info",
      "event: Event",
      "resources-affected: Status Pages",
      "recurring: Recurring",
    ]);

    const rows: Record<string, Array<string>> = rowsByStep(TEMPLATE_EDIT);

    expect(rows["event"]).toEqual([
      "title",
      "description",
      `${ADVANCED}: labels`,
    ]);
    expect(rows["resources-affected"]).toEqual([
      "statusPages",
      NOTIFY_SECTION_ROW,
    ]);

    // Its Affected Resources card asks for them as its create form does.
    const card: FormShape = shapeOfScannedForm(
      "the template's Affected Resources card",
      scannedForm(TEMPLATE_VIEW_FILE, "CardModelDetail: Affected Resources"),
    );

    expect(rowsByStep(card)).toEqual({
      "": RESOURCE_ROWS,
    });
  });

  test("Resources Affected never folds the monitor status: it sits right under the monitors", () => {
    for (const shape of [CREATE, TEMPLATE_CREATE]) {
      const keys: Array<string> = shape.placements
        .filter((placement: Placement): boolean => {
          return placement.stepId === "resources-affected";
        })
        .map((placement: Placement): string => {
          return placement.key;
        });

      expect(keys.slice(0, 3)).toEqual(RESOURCE_ROWS);

      const status: Placement | undefined = shape.placements.find(
        (placement: Placement): boolean => {
          return placement.key === "changeMonitorStatusTo";
        },
      );

      expect(`${shape.name}: ${status?.section}`).toBe(`${shape.name}: `);
    }

    // No More fields section is left on the step.
    for (const shape of [CREATE, TEMPLATE_CREATE]) {
      expect(
        rowsByStep(shape)["resources-affected"]!.some((row: string) => {
          return row.startsWith(`${ADVANCED}:`);
        }),
      ).toBe(false);
    }

    // The template view no longer builds a section for its card.
    expect(readSource(TEMPLATE_VIEW_FILE)).not.toContain(
      "getAdvancedFormSection",
    );
  });

  test("Create asks for the monitor status only once a monitor is picked; a template always asks", () => {
    const create: FormFacts = scannedForm(
      CREATE_FILE,
      "ModelForm: Create New Scheduled Maintenance Event",
    );
    const status: FormFieldFacts | undefined = create.fields.find(
      (field: FormFieldFacts): boolean => {
        return field.key === "changeMonitorStatusTo";
      },
    );

    expect(status?.isConditional).toBe(true);

    const templateStatus: ModelField<ScheduledMaintenanceTemplate> | undefined =
      getTemplateFormFields({ isViewPage: false }).find(
        (field: ModelField<ScheduledMaintenanceTemplate>): boolean => {
          return Object.keys(field.field || {})[0] === "changeMonitorStatusTo";
        },
      );

    expect(templateStatus).toBeDefined();
    expect(templateStatus!.showIf).toBeUndefined();
    expect(templateStatus!.collapsibleSection).toBeUndefined();
  });

  test("put a field on the same step, folded the same way, in every form that has it", () => {
    const seen: Map<string, { form: string; at: string }> = new Map();
    const problems: Array<string> = [];

    for (const shape of ALL_FORMS) {
      for (const placement of shape.placements) {
        /*
         * The event's Edit cannot change the three switches (their columns
         * take no updates), so its reminders would be the only field left in
         * Subscriber Notifications: folding one field behind a header would
         * only add a click. It is the one field drawn open there.
         */
        const isLoneReminders: boolean =
          shape === EDIT && placement.key === REMINDERS;
        const section: string = isLoneReminders
          ? SUBSCRIBER_NOTIFICATIONS
          : placement.section;
        const step: string =
          STEP_OF_THE_EVENT[placement.stepId] || `step ${placement.stepId}`;
        const at: string = `${step} / ${section || "-"}`;
        const first: { form: string; at: string } | undefined = seen.get(
          placement.key,
        );

        if (!first) {
          seen.set(placement.key, { form: shape.name, at });
          continue;
        }

        if (first.at !== at) {
          problems.push(
            `${placement.key}: ${first.at} in ${first.form}, ${at} in ${shape.name}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
    // Labels and owners are folded under Advanced on the event's step.
    expect(seen.get("labels")?.at).toBe(`the event / ${ADVANCED}`);
    expect(seen.get("owners")?.at).toBe(`the event / ${ADVANCED}`);
    expect(seen.get("statusPages")?.at).toBe(
      "what it affects and who hears / -",
    );
  });

  test("have no step for one field, and none named after the old one-field steps", () => {
    const retiredSteps: Array<string> = [
      "Event Info",
      "Event Time",
      "Owners",
      "Subscribers",
      "Labels",
      "Event Details",
    ];

    for (const shape of ALL_FORMS) {
      const rows: Record<string, Array<string>> = rowsByStep(shape);

      for (const step of shape.steps) {
        const [id, title] = step.split(": ") as [string, string];

        expect(retiredSteps).not.toContain(title);
        expect(`${shape.name} ${id}: ${(rows[id] || []).length > 1}`).toBe(
          `${shape.name} ${id}: true`,
        );
      }
    }

    // A create form's second step holds the resources, and is named for them.
    for (const shape of [CREATE, TEMPLATE_CREATE]) {
      expect(shape.steps).not.toContain("resources-affected: Status Pages");
    }
  });

  test(`keep every step to ${STEP_FIELD_LIMIT} rows or fewer`, () => {
    for (const label of ["ModelForm: Create New Scheduled Maintenance Event"]) {
      const form: FormFacts = scannedForm(CREATE_FILE, label);

      for (const step of form.steps || []) {
        const onStep: Array<FormFieldFacts> = form.fields.filter(
          (field: FormFieldFacts): boolean => {
            return field.stepId === step.id && !field.isNeverShown;
          },
        );

        expect(
          `${step.id}: ${countFieldRows(onStep) <= STEP_FIELD_LIMIT}`,
        ).toBe(`${step.id}: true`);
      }
    }
  });

  test("fold their fields with the shared sections, built once", () => {
    for (const [constant, spec] of Object.entries(SECTION_CONSTANTS)) {
      for (const file of spec.files) {
        const source: string = readSource(file);
        const declaration: RegExp = new RegExp(
          `const ${constant}: FormFieldCollapsibleSection<\\w+> =\\s*${spec.builtWith}<\\w+>\\(\\);`,
        );

        expect(`${file} ${constant}: ${declaration.test(source)}`).toBe(
          `${file} ${constant}: true`,
        );
      }
    }
  });
});
