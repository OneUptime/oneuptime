import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  FormFacts,
  FormFieldFacts,
  SHORT_FORM_ROW_LIMIT,
  STEP_FIELD_LIMIT,
  countFieldRows,
  countFormRows,
  scanFormFiles,
} from "../../Helpers/FormStepsScan";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageAnnouncementTemplate from "../../../Models/DatabaseModels/StatusPageAnnouncementTemplate";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import {
  ADVANCED_FORM_SECTION_TITLE,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Announcement/AnnouncementForm";

/*
 * Creating an announcement takes two steps and a review: Announcement, then
 * Status Pages - the shape scheduled maintenance has had since #4291. The
 * four forms of an announcement put each field they hold on the same step:
 *
 *   - Create Announcement (Pages/StatusPages/AnnouncementCreate.tsx), and
 *     the review step after it;
 *   - the announcement's details card Edit (AnnouncementView.tsx), which
 *     cannot change the notify switch (its column takes no updates) and
 *     folds "Notify subscribers about this update" where the switch was;
 *   - an announcement template's Create (the templates table) and Edit (the
 *     template's page), which add the template's own name and description in
 *     front, and have no schedule: their one notification switch is drawn
 *     open on Status Pages, since folding a single field behind a header
 *     would only add a click.
 *
 * So Title and Description open on Announcement, Attachments under
 * Advanced; the status pages and the monitors open on Status Pages, the
 * schedule and the notification answer folded in Schedule & Notifications;
 * and no step exists for one field.
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
const FORM_MODULE_FILE: string = `${DASHBOARD}/Components/Announcement/AnnouncementForm.ts`;

const ADVANCED: string = ADVANCED_FORM_SECTION_TITLE;
const SCHEDULE: string = SCHEDULE_AND_NOTIFICATIONS_SECTION_TITLE;

const NOTIFY_SWITCH: string = "shouldStatusPageSubscribersBeNotified";
// The edit-only "Notify subscribers about this update" box (a misc key).
const UPDATE_BOX: string = "SubscriberUpdateNotification.miscDataKey";

/*
 * The section constants the pages fold fields with, by the name the source
 * gives them, and the call each must be built with (checked below).
 */
const SECTION_CONSTANTS: Record<
  string,
  { title: string; builtWith: string; file: string }
> = {
  advancedSection: {
    title: ADVANCED,
    builtWith: "getAdvancedFormSection<StatusPageAnnouncement>()",
    file: CREATE_FILE,
  },
  scheduleAndNotificationsSection: {
    title: SCHEDULE,
    builtWith:
      "getScheduleAndNotificationsSection<StatusPageAnnouncement>(AnnouncementFormKind.Create)",
    file: CREATE_FILE,
  },
  detailsAdvancedSection: {
    title: ADVANCED,
    builtWith: "getAdvancedFormSection<StatusPageAnnouncement>()",
    file: VIEW_FILE,
  },
  detailsScheduleSection: {
    title: SCHEDULE,
    builtWith:
      "getScheduleAndNotificationsSection<StatusPageAnnouncement>(AnnouncementFormKind.Edit)",
    file: VIEW_FILE,
  },
};

// Which part of the announcement a step id stands for.
const STEP_OF_THE_ANNOUNCEMENT: Record<string, string> = {
  "template-info": "the template",
  announcement: "what it says",
  "status-pages": "where and when it shows, and who hears",
};

// A field as this test compares it: where it is and what it is folded in.
interface Placement {
  key: string;
  stepId: string;
  section: string;
}

interface FormShape {
  name: string;
  form: FormFacts;
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

function shapeOf(name: string, form: FormFacts): FormShape {
  return {
    name,
    form,
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
          key: field.key,
          stepId: field.stepId || "",
          section,
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

const CREATE: FormShape = shapeOf(
  "Create Announcement",
  scannedForm(CREATE_FILE, "ModelForm: Create New Announcement"),
);

const EDIT: FormShape = shapeOf(
  "the announcement's details card Edit",
  scannedForm(VIEW_FILE, "CardModelDetail: Status Page Announcement Details"),
);

const TEMPLATE_CREATE: FormShape = shapeOf(
  "Create Announcement Template",
  scannedForm(
    TEMPLATES_FILE,
    "ModelTable: Settings > Status Page Announcement Templates",
  ),
);

const TEMPLATE_EDIT: FormShape = shapeOf(
  "the template's details card Edit",
  scannedForm(
    TEMPLATE_VIEW_FILE,
    "CardModelDetail: Status Page Announcement Template Details",
  ),
);

const ALL_FORMS: Array<FormShape> = [
  CREATE,
  EDIT,
  TEMPLATE_CREATE,
  TEMPLATE_EDIT,
];

const ANNOUNCEMENT_STEPS: Array<string> = [
  "announcement: Announcement",
  "status-pages: Status Pages",
];

const ANNOUNCEMENT_ROWS: Array<string> = [
  "title",
  "description",
  `${ADVANCED}: attachments`,
];

describe("the announcement forms", () => {
  test("are really read", () => {
    for (const shape of ALL_FORMS) {
      expect(`${shape.name}: ${shape.placements.length > 3}`).toBe(
        `${shape.name}: true`,
      );
      expect(`${shape.name}: ${shape.form.uncountableReasons.join(", ")}`).toBe(
        `${shape.name}: `,
      );
    }
  });

  test("Create walks Announcement and Status Pages, then the review", () => {
    expect(CREATE.steps).toEqual(ANNOUNCEMENT_STEPS);
    expect(readSource(CREATE_FILE)).toContain(
      compact("summary={{ enabled: true }}"),
    );

    expect(rowsByStep(CREATE)).toEqual({
      announcement: ANNOUNCEMENT_ROWS,
      "status-pages": [
        "statusPages",
        "monitors",
        `${SCHEDULE}: showAnnouncementAt, endAnnouncementAt, ${NOTIFY_SWITCH}`,
      ],
    });
  });

  test("Create starts now, with the subscribers told, and refuses an end before the start", () => {
    const source: string = readSource(CREATE_FILE);

    expect(source).toContain(
      compact(
        "getDefaultValue: () => { return OneUptimeDate.getCurrentDate(); }",
      ),
    );
    expect(source).toContain(
      compact("return getAnnouncementEndsAtError(values);"),
    );

    const notify: FormFieldFacts | undefined = CREATE.form.fields.find(
      (field: FormFieldFacts): boolean => {
        return field.key === NOTIFY_SWITCH;
      },
    );

    expect(notify?.defaultValue).toBe("true");
    // The column's own default: the form starts where the API does.
    expect(
      new StatusPageAnnouncement().getTableColumnMetadata(NOTIFY_SWITCH)
        .defaultValue,
    ).toBe(true);
  });

  test("the details card Edit walks the same steps, with the update box where the switch was", () => {
    expect(EDIT.steps).toEqual(ANNOUNCEMENT_STEPS);
    expect(rowsByStep(EDIT)).toEqual({
      announcement: ANNOUNCEMENT_ROWS,
      "status-pages": [
        "statusPages",
        "monitors",
        `${SCHEDULE}: showAnnouncementAt, endAnnouncementAt, ${UPDATE_BOX}`,
      ],
    });

    // The switch takes no updates, so an Edit form could never show it.
    const accessControl: Dictionary<ColumnAccessControl> =
      new StatusPageAnnouncement().getColumnAccessControlForAllColumns();

    expect(accessControl[NOTIFY_SWITCH]?.update).toEqual([]);
    expect(
      EDIT.placements.map((placement: Placement): string => {
        return placement.key;
      }),
    ).not.toContain(NOTIFY_SWITCH);
    expect(readSource(VIEW_FILE)).toContain(
      compact("return getAnnouncementEndsAtError(values);"),
    );
  });

  test("a template walks the announcement's steps with its own name in front, on both its forms", () => {
    for (const shape of [TEMPLATE_CREATE, TEMPLATE_EDIT]) {
      expect(shape.steps).toEqual([
        "template-info: Template Info",
        ...ANNOUNCEMENT_STEPS,
      ]);
      expect(rowsByStep(shape)).toEqual({
        "template-info": ["templateName", "templateDescription"],
        // A template has no attachments.
        announcement: ["title", "description"],
        // No schedule: the one switch is drawn open, not folded alone.
        "status-pages": ["statusPages", "monitors", NOTIFY_SWITCH],
      });
    }

    // The template's switch takes updates, so its Edit keeps it.
    expect(
      new StatusPageAnnouncementTemplate().getColumnAccessControlForAllColumns()[
        NOTIFY_SWITCH
      ]?.update?.length,
    ).toBeGreaterThan(0);

    // Both read one list, so they cannot drift apart.
    for (const file of [TEMPLATES_FILE, TEMPLATE_VIEW_FILE]) {
      const source: string = readSource(file);

      expect(source).toContain(
        compact("formSteps={ANNOUNCEMENT_TEMPLATE_FORM_STEPS}"),
      );
      expect(source).toContain(
        compact("formFields={getAnnouncementTemplateFormFields()}"),
      );
    }
  });

  test("put a field on the same step, folded the same way, in every form that has it", () => {
    const seen: Map<string, { form: string; at: string }> = new Map();
    const problems: Array<string> = [];

    for (const shape of ALL_FORMS) {
      for (const placement of shape.placements) {
        /*
         * A template has no schedule, so its notify switch would be the only
         * field in Schedule & Notifications: it is the one field drawn open
         * there.
         */
        const isTemplatesLoneSwitch: boolean =
          (shape === TEMPLATE_CREATE || shape === TEMPLATE_EDIT) &&
          placement.key === NOTIFY_SWITCH;
        const section: string = isTemplatesLoneSwitch
          ? SCHEDULE
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
    expect(seen.get("attachments")?.at).toBe(`what it says / ${ADVANCED}`);
    expect(seen.get("statusPages")?.at).toBe(
      "where and when it shows, and who hears / -",
    );
    expect(seen.get("showAnnouncementAt")?.at).toBe(
      `where and when it shows, and who hears / ${SCHEDULE}`,
    );
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
      }
    }
  });

  test(`keep every step to ${STEP_FIELD_LIMIT} rows or fewer, and are long enough to walk steps`, () => {
    for (const shape of ALL_FORMS) {
      for (const step of shape.form.steps || []) {
        const onStep: Array<FormFieldFacts> = shape.form.fields.filter(
          (field: FormFieldFacts): boolean => {
            return field.stepId === step.id && !field.isNeverShown;
          },
        );

        expect(
          `${shape.name} ${step.id}: ${countFieldRows(onStep) <= STEP_FIELD_LIMIT}`,
        ).toBe(`${shape.name} ${step.id}: true`);
      }

      expect(
        `${shape.name}: ${(countFormRows(shape.form) || 0) > SHORT_FORM_ROW_LIMIT}`,
      ).toBe(`${shape.name}: true`);
    }
  });

  test("name each field the same way in every form", () => {
    const titles: Map<string, Set<string>> = new Map();

    for (const shape of ALL_FORMS) {
      for (const field of shape.form.fields) {
        const seen: Set<string> = titles.get(field.key) || new Set<string>();
        seen.add(field.title);
        titles.set(field.key, seen);
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

  test("fold their fields with the shared sections, built once", () => {
    for (const [constant, spec] of Object.entries(SECTION_CONSTANTS)) {
      const source: string = readSource(spec.file);
      const declaration: string = compact(
        `const ${constant}: FormFieldCollapsibleSection<StatusPageAnnouncement> = ${spec.builtWith};`,
      );

      expect(`${spec.file}: ${source.includes(declaration)}`).toBe(
        `${spec.file}: true`,
      );
    }

    /*
     * The section always starts folded - its line says what is set - and
     * says what it holds in that line.
     */
    const module: string = readSource(FORM_MODULE_FILE);

    expect(module).toContain(compact("openWhenConfigured: false,"));
    expect(module).toContain(
      compact("return getScheduleAndNotificationsSummary(values, kind);"),
    );
  });
});
