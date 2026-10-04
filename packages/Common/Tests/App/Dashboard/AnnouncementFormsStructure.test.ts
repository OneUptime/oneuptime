import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FormFacts,
  SHORT_FORM_ROW_LIMIT,
  STEP_FIELD_LIMIT,
  countFormRows,
  scanFormFiles,
} from "../../Helpers/FormStepsScan";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAnnouncementTemplate from "../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { ADVANCED_FORM_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  AnnouncementFormKind,
  SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE,
  SCHEDULE_SECTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementForm";
import {
  ANNOUNCEMENT_FORM_STEPS,
  ANNOUNCEMENT_TEMPLATE_FORM_STEPS,
  getAnnouncementFormFields,
  getAnnouncementTemplateFormFields,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementFormFields";

/*
 * Creating an announcement takes two steps and a review: Announcement, then
 * Status Pages - the shape scheduled maintenance has had since #4291. The
 * four forms of an announcement read their fields from one module
 * (Components/Announcement/AnnouncementFormFields), and put each field
 * they hold on the same step:
 *
 *   - Create Announcement (Pages/StatusPages/AnnouncementCreate.tsx), and
 *     the review step after it: the schedule and the notify switch folded
 *     in Schedule & Notifications;
 *   - the announcement's details card Edit (AnnouncementView.tsx), which
 *     cannot change the notify switch (its column takes no updates): it
 *     asks "Notify subscribers about this update" under the description it
 *     is about, and folds only the Schedule;
 *   - an announcement template's Create (the templates table) and Edit (the
 *     template's page), which add the template's own name and description in
 *     front, and have no schedule: their one notify switch is drawn open on
 *     Status Pages, since folding a single field behind a header would only
 *     add a click.
 *
 * Later sweeps: these forms are done; keep them matching this, or change
 * this on purpose.
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
const CREATE_FILE: string = `${DASHBOARD}/Pages/StatusPages/AnnouncementCreate.tsx`;
const VIEW_FILE: string = `${DASHBOARD}/Pages/StatusPages/AnnouncementView.tsx`;
const TEMPLATES_FILE: string = `${DASHBOARD}/Pages/StatusPages/Settings/StatusPageAnnouncementTemplates.tsx`;
const TEMPLATE_VIEW_FILE: string = `${DASHBOARD}/Pages/StatusPages/Settings/StatusPageAnnouncementTemplateView.tsx`;
const FIELDS_FILE: string = `${DASHBOARD}/Components/Announcement/AnnouncementFormFields.tsx`;
const RULES_FILE: string = `${DASHBOARD}/Components/Announcement/AnnouncementForm.ts`;

const ADVANCED: string = ADVANCED_FORM_SECTION_TITLE;
const SCHEDULE_AND_NOTIFICATIONS: string =
  SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE;
const SCHEDULE: string = SCHEDULE_SECTION_TITLE;

const NOTIFY_SWITCH: string = "shouldStatusPageSubscribersBeNotified";
// The edit-only "Notify subscribers about this update" box (a misc key).
const UPDATE_BOX: string = SubscriberUpdateNotification.miscDataKey;

// Which part of the announcement a step id stands for.
const STEP_OF_THE_ANNOUNCEMENT: Record<string, string> = {
  "template-info": "the template",
  announcement: "what it says",
  "status-pages": "where and when it shows",
};

// The schedule's section is called after what it holds in each form.
const SCHEDULE_SECTIONS: Array<string> = [SCHEDULE_AND_NOTIFICATIONS, SCHEDULE];

// A field as this test compares it: where it is and what it is folded in.
interface Placement {
  key: string;
  title: string;
  stepId: string;
  section: string;
}

interface FormShape {
  name: string;
  steps: Array<string>;
  placements: Array<Placement>;
}

/*
 * Source with no whitespace and no trailing commas, so a check reads the
 * same however prettier wraps the line.
 */
function compact(text: string): string {
  return text.replace(/\s+/g, "").replace(/,([)\]}])/g, "$1");
}

function readSource(file: string): string {
  return compact(fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"));
}

function keyOf<T extends BaseModel>(field: ModelField<T>): string {
  return field.overrideFieldKey || Object.keys(field.field || {})[0] || "";
}

function shapeOf<T extends BaseModel>(
  name: string,
  steps: Array<FormStep<T>>,
  fields: Array<ModelField<T>>,
): FormShape {
  return {
    name,
    steps: steps.map((step: FormStep<T>): string => {
      return `${step.id}: ${step.title}`;
    }),
    placements: fields.map((field: ModelField<T>): Placement => {
      return {
        key: keyOf(field),
        title: field.title || "",
        stepId: field.stepId || "",
        section: field.collapsibleSection?.title || "",
      };
    }),
  };
}

// "monitors" or "Advanced: attachments", step by step.
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

const CREATE_FIELDS: Array<ModelField<StatusPageAnnouncement>> =
  getAnnouncementFormFields(AnnouncementFormKind.Create);

const EDIT_FIELDS: Array<ModelField<StatusPageAnnouncement>> =
  getAnnouncementFormFields(AnnouncementFormKind.Edit);

const TEMPLATE_FIELDS: Array<ModelField<StatusPageAnnouncementTemplate>> =
  getAnnouncementTemplateFormFields();

const CREATE: FormShape = shapeOf(
  "Create Announcement",
  ANNOUNCEMENT_FORM_STEPS,
  CREATE_FIELDS,
);

const EDIT: FormShape = shapeOf(
  "the announcement's details card Edit",
  ANNOUNCEMENT_FORM_STEPS,
  EDIT_FIELDS,
);

const TEMPLATE: FormShape = shapeOf(
  "an announcement template's Create and Edit",
  ANNOUNCEMENT_TEMPLATE_FORM_STEPS,
  TEMPLATE_FIELDS,
);

const ALL_FORMS: Array<FormShape> = [CREATE, EDIT, TEMPLATE];

const ANNOUNCEMENT_STEPS: Array<string> = [
  "announcement: Announcement",
  "status-pages: Status Pages",
];

function fieldOf<T extends BaseModel>(
  fields: Array<ModelField<T>>,
  key: string,
): ModelField<T> {
  const found: ModelField<T> | undefined = fields.find(
    (field: ModelField<T>): boolean => {
      return keyOf(field) === key;
    },
  );

  expect(`${key}: ${Boolean(found)}`).toBe(`${key}: true`);

  return found!;
}

const scannedForms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: [CREATE_FILE, VIEW_FILE, TEMPLATES_FILE, TEMPLATE_VIEW_FILE].map(
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

describe("the announcement forms", () => {
  test("Create walks Announcement and Status Pages, then the review", () => {
    expect(CREATE.steps).toEqual(ANNOUNCEMENT_STEPS);
    expect(rowsByStep(CREATE)).toEqual({
      announcement: ["title", "description", `${ADVANCED}: attachments`],
      "status-pages": [
        "statusPages",
        "monitors",
        `${SCHEDULE_AND_NOTIFICATIONS}: showAnnouncementAt, endAnnouncementAt, ${NOTIFY_SWITCH}`,
      ],
    });

    const source: string = readSource(CREATE_FILE);

    expect(source).toContain(compact("steps={ANNOUNCEMENT_FORM_STEPS}"));
    expect(source).toContain(
      compact("return getAnnouncementFormFields(AnnouncementFormKind.Create);"),
    );
    expect(source).toContain(compact("summary={{ enabled: true }}"));
  });

  test("the details card Edit walks the same steps, asking about this edit under the description", () => {
    expect(EDIT.steps).toEqual(ANNOUNCEMENT_STEPS);
    expect(rowsByStep(EDIT)).toEqual({
      announcement: [
        "title",
        "description",
        UPDATE_BOX,
        `${ADVANCED}: attachments`,
      ],
      "status-pages": [
        "statusPages",
        "monitors",
        `${SCHEDULE}: showAnnouncementAt, endAnnouncementAt`,
      ],
    });

    // The switch takes no updates, so an Edit form could never show it.
    const accessControl: Dictionary<ColumnAccessControl> =
      new StatusPageAnnouncement().getColumnAccessControlForAllColumns();

    expect(accessControl[NOTIFY_SWITCH]?.update).toEqual([]);

    const source: string = readSource(VIEW_FILE);

    expect(source).toContain(compact("formSteps={ANNOUNCEMENT_FORM_STEPS}"));
    expect(source).toContain(
      compact("return getAnnouncementFormFields(AnnouncementFormKind.Edit);"),
    );
    expect(source).toContain(compact("formFields={formFields}"));
  });

  test("a template walks the announcement's steps with its own name in front, on both its forms", () => {
    expect(TEMPLATE.steps).toEqual([
      "template-info: Template Info",
      ...ANNOUNCEMENT_STEPS,
    ]);
    expect(rowsByStep(TEMPLATE)).toEqual({
      "template-info": ["templateName", "templateDescription"],
      // A template has no attachments.
      announcement: ["title", "description"],
      // No schedule: the one switch is drawn open, not folded alone.
      "status-pages": ["statusPages", "monitors", NOTIFY_SWITCH],
    });

    // The template's switch takes updates, so its Edit keeps it.
    expect(
      new StatusPageAnnouncementTemplate().getColumnAccessControlForAllColumns()[
        NOTIFY_SWITCH
      ]?.update?.length,
    ).toBeGreaterThan(0);

    // Both forms read the one list, so they cannot drift apart.
    for (const file of [TEMPLATES_FILE, TEMPLATE_VIEW_FILE]) {
      const source: string = readSource(file);

      expect(source).toContain(
        compact("formSteps={ANNOUNCEMENT_TEMPLATE_FORM_STEPS}"),
      );
      expect(source).toContain(
        compact("return getAnnouncementTemplateFormFields();"),
      );
      expect(source).toContain(compact("formFields={formFields}"));
    }
  });

  test("the pages hand the scanner a form it can read, long enough to walk steps", () => {
    const forms: Array<FormFacts> = [
      scannedForm(CREATE_FILE, "ModelForm: Create New Announcement"),
      scannedForm(
        VIEW_FILE,
        "CardModelDetail: Status Page Announcement Details",
      ),
      scannedForm(
        TEMPLATES_FILE,
        "ModelTable: Settings > Status Page Announcement Templates",
      ),
      scannedForm(
        TEMPLATE_VIEW_FILE,
        "CardModelDetail: Status Page Announcement Template Details",
      ),
    ];

    for (const form of forms) {
      expect(`${form.label}: ${form.uncountableReasons.join(", ")}`).toBe(
        `${form.label}: `,
      );
      expect(`${form.label}: ${form.hasSteps}`).toBe(`${form.label}: true`);
      expect(
        `${form.label}: ${(countFormRows(form) || 0) > SHORT_FORM_ROW_LIMIT}`,
      ).toBe(`${form.label}: true`);
    }
  });

  test("put a field on the same step, folded the same way, in every form that has it", () => {
    const seen: Map<string, { form: string; at: string }> = new Map();
    const problems: Array<string> = [];

    for (const shape of ALL_FORMS) {
      for (const placement of shape.placements) {
        /*
         * The schedule's section is one section, called after what it holds.
         * A template has no schedule, so its notify switch would be the only
         * field in it: it is the one field drawn open there.
         */
        const isTemplatesLoneSwitch: boolean =
          shape === TEMPLATE && placement.key === NOTIFY_SWITCH;
        const section: string =
          isTemplatesLoneSwitch || SCHEDULE_SECTIONS.includes(placement.section)
            ? "the schedule"
            : placement.section;
        const step: string =
          STEP_OF_THE_ANNOUNCEMENT[placement.stepId] ||
          `step ${placement.stepId}`;
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
    expect(seen.get("title")?.at).toBe("what it says / -");
    expect(seen.get(UPDATE_BOX)?.at).toBe("what it says / -");
    expect(seen.get("attachments")?.at).toBe(`what it says / ${ADVANCED}`);
    expect(seen.get("statusPages")?.at).toBe("where and when it shows / -");
    expect(seen.get("showAnnouncementAt")?.at).toBe(
      "where and when it shows / the schedule",
    );
  });

  test("name each field the same way in every form", () => {
    const titles: Map<string, Set<string>> = new Map();

    for (const shape of ALL_FORMS) {
      for (const placement of shape.placements) {
        const seen: Set<string> = titles.get(placement.key) || new Set();
        seen.add(placement.title);
        titles.set(placement.key, seen);
      }
    }

    for (const [key, seen] of titles) {
      expect(`${key}: ${Array.from(seen).join(" | ")}`).toBe(
        `${key}: ${Array.from(seen)[0]}`,
      );
    }

    expect(Array.from(titles.get("title")!)).toEqual(["Title"]);
    // The label adds "(Optional)" itself: the title does not say it again.
    expect(Array.from(titles.get("monitors")!)).toEqual(["Monitors Affected"]);
    expect(Array.from(titles.get(NOTIFY_SWITCH)!)).toEqual([
      "Notify Status Page Subscribers",
    ]);
  });

  test("ask for a description on every form, as the server requires one", () => {
    // The model's own rule: required, and NOT NULL.
    expect(new StatusPageAnnouncement().getRequiredColumns().columns).toContain(
      "description",
    );
    expect(
      new StatusPageAnnouncementTemplate().getRequiredColumns().columns,
    ).toContain("description");

    expect(fieldOf(CREATE_FIELDS, "description").required).toBe(true);
    expect(fieldOf(EDIT_FIELDS, "description").required).toBe(true);
    expect(fieldOf(TEMPLATE_FIELDS, "description").required).toBe(true);

    // The pages are required on the announcement; a template may leave them.
    expect(fieldOf(CREATE_FIELDS, "statusPages").required).toBe(true);
    expect(fieldOf(EDIT_FIELDS, "statusPages").required).toBe(true);
    expect(fieldOf(TEMPLATE_FIELDS, "statusPages").required).toBe(false);
  });

  test("keep the rules templates already had, so no saved template is refused", () => {
    // The announcement's title has always needed two characters...
    expect(fieldOf(CREATE_FIELDS, "title").validation?.minLength).toBe(2);
    expect(fieldOf(EDIT_FIELDS, "title").validation?.minLength).toBe(2);
    // ...a template's never did.
    expect(fieldOf(TEMPLATE_FIELDS, "title").validation?.minLength).toBe(
      undefined,
    );
  });

  test("Create starts now, with the subscribers told; an end has to come after the start, and on Create still be to come", () => {
    const start: ModelField<StatusPageAnnouncement> = fieldOf(
      CREATE_FIELDS,
      "showAnnouncementAt",
    );

    expect(start.getDefaultValue).toBeDefined();
    expect(fieldOf(CREATE_FIELDS, NOTIFY_SWITCH).defaultValue).toBe(true);
    // The column's own default: the form starts where the API does.
    expect(
      new StatusPageAnnouncement().getTableColumnMetadata(NOTIFY_SWITCH)
        .defaultValue,
    ).toBe(true);

    // Times as the date input holds what is typed into it: ISO strings.
    const yesterday: FormValues<StatusPageAnnouncement> = {
      showAnnouncementAt: "2020-01-01T08:00:00.000Z",
      endAnnouncementAt: "2020-01-01T10:00:00.000Z",
    } as unknown as FormValues<StatusPageAnnouncement>;

    // An end that has passed: refused on Create, how an Edit takes it down.
    expect(
      fieldOf(CREATE_FIELDS, "endAnnouncementAt").customValidation!(yesterday),
    ).toBe("End Showing Announcement At must be in the future.");
    expect(
      fieldOf(EDIT_FIELDS, "endAnnouncementAt").customValidation!(yesterday),
    ).toBeNull();
  });

  test("have no step for one field, and none named after the old ones", () => {
    const retiredSteps: Array<string> = [
      "Basic Information",
      "Resources Affected",
      "Schedule & Settings",
      "Announcement Details",
      "Notification Settings",
    ];

    for (const shape of ALL_FORMS) {
      const rows: Record<string, Array<string>> = rowsByStep(shape);

      for (const step of shape.steps) {
        const [id, title] = step.split(": ") as [string, string];

        expect(retiredSteps).not.toContain(title);
        expect(`${shape.name} ${id}: ${(rows[id] || []).length > 1}`).toBe(
          `${shape.name} ${id}: true`,
        );
        expect(
          `${shape.name} ${id}: ${(rows[id] || []).length <= STEP_FIELD_LIMIT}`,
        ).toBe(`${shape.name} ${id}: true`);
      }
    }
  });

  test("fold their fields with the shared sections, built once", () => {
    const source: string = readSource(FIELDS_FILE);

    for (const [constant, builtWith] of [
      ["advancedSection", "getAdvancedFormSection<StatusPageAnnouncement>()"],
      [
        "createScheduleSection",
        "getAnnouncementScheduleSection<StatusPageAnnouncement>(AnnouncementFormKind.Create)",
      ],
      [
        "editScheduleSection",
        "getAnnouncementScheduleSection<StatusPageAnnouncement>(AnnouncementFormKind.Edit)",
      ],
    ] as Array<[string, string]>) {
      const declaration: string = compact(
        `const ${constant}: FormFieldCollapsibleSection<StatusPageAnnouncement> = ${builtWith};`,
      );

      expect(`${constant}: ${source.includes(declaration)}`).toBe(
        `${constant}: true`,
      );
    }

    // The section always starts folded: its line says what is set.
    const rules: string = readSource(RULES_FILE);

    expect(rules).toContain(compact("openWhenConfigured: false,"));
    expect(rules).toContain(
      compact("return getAnnouncementScheduleSectionSummary(values, kind);"),
    );
  });
});
