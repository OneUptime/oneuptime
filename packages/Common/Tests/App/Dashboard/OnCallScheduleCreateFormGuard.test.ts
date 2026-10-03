import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { listScanRoots, listSourceFiles } from "../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  countFieldRows,
  scanFormFiles,
} from "../../Helpers/FormStepsScan";
import {
  DEFAULT_SCHEDULE_TURN_LENGTH_VALUE,
  SCHEDULE_DEFAULT_TURN_SUMMARY,
  SCHEDULE_TAKES_TURNS_FIELD_KEY,
  SCHEDULE_TURN_LENGTHS,
  SCHEDULE_TURN_LENGTH_FIELD_KEY,
  ScheduleTurnLength,
  addScheduleFirstLayerMiscData,
  getOnCallScheduleCreateFormFields,
  getScheduleAdvancedSummary,
  getScheduleTakesTurnsPickerConfig,
  getScheduleTurnLengthRotation,
  readScheduleTakesTurnsUserIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleCreateForm";
import { LABELS_FORM_FIELD_DESCRIPTION } from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/LabelsFormField";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import {
  SCHEDULE_FIRST_LAYER_ROTATION_KEY,
  SCHEDULE_FIRST_LAYER_USERS_KEY,
  ScheduleFirstLayer,
  readScheduleFirstLayer,
  readScheduleFirstLayerRotation,
} from "../../../Types/OnCallDutyPolicy/ScheduleFirstLayer";
import { getDefaultLayerRotation } from "../../../Types/OnCallDutyPolicy/ScheduleLayerDefaults";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_ID,
  ADVANCED_FORM_SECTION_TITLE,
  isFormSectionConfigured,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  PeoplePickerKind,
  getPeoplePickerValueKeys,
} from "../../../UI/Components/PeoplePicker/PeoplePickerTypes";

/*
 * "A new on-call schedule asks who takes turns and starts with that
 * rotation."
 *
 * Every form that creates an on-call schedule asks who takes turns, with the
 * people picker, and keeps to three rows: Name, that question, and a folded
 * Advanced section holding how long each turn lasts, the timezone, the
 * description and the labels. What it sends is what the server reads
 * (OnCallDutyPolicyScheduleService.create, through readScheduleFirstLayer):
 * a form that asks the question and sends keys the server does not read
 * would make a schedule that silently covers nobody.
 *
 * Pinned on the form helper first, then on the project's forms as the
 * FormStepsScan detector reads them - so a second create form for
 * schedules, written later, is held to the same - and last on what is
 * built when a layer is added, which the server and Add Layer share.
 */

// packages/Common/Tests/App/Dashboard -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SCHEDULES_PAGE: string =
  "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedules.tsx";

const PEOPLE_PICKER_FIELD_TYPE: string = "FormFieldSchemaType.PeoplePicker";

const TAKES_TURNS_TITLE: string = "Who takes turns?";

const TURN_LENGTH_TITLE: string = "Each turn lasts";

const ALEX: string = "0e100000-0000-4000-8000-0000000000a1";
const SAM: string = "0e100000-0000-4000-8000-0000000000a2";

type ScheduleField = Field<OnCallDutyPolicySchedule>;

function fieldKey(field: ScheduleField): string {
  return (
    field.overrideFieldKey ||
    Object.keys(field.field || {})[0] ||
    Object.keys(
      (field as { overrideField?: Record<string, true> }).overrideField || {},
    )[0] ||
    ""
  );
}

function buildFields(canAddLayers: boolean): Array<ScheduleField> {
  return getOnCallScheduleCreateFormFields({
    canAddLayers: (): boolean => {
      return canAddLayers;
    },
  });
}

function fieldTitled(
  fields: Array<ScheduleField>,
  title: string,
): ScheduleField {
  const field: ScheduleField | undefined = fields.find(
    (candidate: ScheduleField): boolean => {
      return candidate.title === title;
    },
  );

  if (!field) {
    throw new Error(`No field titled ${title}`);
  }

  return field;
}

function values(
  record: Record<string, unknown>,
): FormValues<OnCallDutyPolicySchedule> {
  return record as FormValues<OnCallDutyPolicySchedule>;
}

function describeRotation(rotation: Recurring): string {
  return `${rotation.intervalCount.toNumber()} ${rotation.intervalType}`;
}

describe("the create form's fields", () => {
  const fields: Array<ScheduleField> = buildFields(true);

  test("are Name, who takes turns, then how long each turn lasts, the timezone, the description and the labels", () => {
    expect(fields.map(fieldKey)).toEqual([
      "name",
      SCHEDULE_TAKES_TURNS_FIELD_KEY,
      SCHEDULE_TURN_LENGTH_FIELD_KEY,
      "timezone",
      "description",
      "labels",
    ]);
    expect(fields[0]!.required).toBe(true);
    expect(fields[0]!.placeholder).toBe("Schedule Name");
  });

  test("ask who takes turns with the people picker, people only", () => {
    const field: ScheduleField = fieldTitled(fields, TAKES_TURNS_TITLE);

    expect(field.fieldType).toBe(FormFieldSchemaType.PeoplePicker);
    expect(field.peoplePicker).toEqual(getScheduleTakesTurnsPickerConfig());
    expect(
      field.peoplePicker!.kinds.map((entry: { kind: PeoplePickerKind }) => {
        return entry.kind;
      }),
    ).toEqual([PeoplePickerKind.User]);
    expect(field.peoplePicker!.addButtonText).toBe("Add user");
    // The picker's own key is the form's, never sent.
    expect(field.formOnly).toBe(true);
    expect(field.description).toBe(
      "On call one at a time, in the order you add them, starting now.",
    );
  });

  test("write the people under the key the server reads", () => {
    const field: ScheduleField = fieldTitled(fields, TAKES_TURNS_TITLE);

    expect(getPeoplePickerValueKeys(field.peoplePicker!)).toEqual([
      SCHEDULE_FIRST_LAYER_USERS_KEY,
    ]);
  });

  test("leave the question optional", () => {
    const field: ScheduleField = fieldTitled(fields, TAKES_TURNS_TITLE);

    expect(field.required).toBe(false);
    expect(field.customValidation).toBeUndefined();
  });

  test("ask it only of someone who may add layers, at the moment the form is drawn", () => {
    let allowed: boolean = false;

    const field: ScheduleField = fieldTitled(
      getOnCallScheduleCreateFormFields({
        canAddLayers: (): boolean => {
          return allowed;
        },
      }),
      TAKES_TURNS_TITLE,
    );

    expect(field.showIf!(values({}))).toBe(false);

    allowed = true;

    expect(field.showIf!(values({}))).toBe(true);
  });

  test("ask how long each turn lasts once somebody takes turns, and only of someone who may add layers", () => {
    const shown: ScheduleField = fieldTitled(
      buildFields(true),
      TURN_LENGTH_TITLE,
    );
    const notAllowed: ScheduleField = fieldTitled(
      buildFields(false),
      TURN_LENGTH_TITLE,
    );

    expect(shown.showIf!(values({}))).toBe(false);
    expect(shown.showIf!(values({ firstLayerUsers: [] }))).toBe(false);
    expect(shown.showIf!(values({ firstLayerUsers: [ALEX] }))).toBe(true);
    expect(notAllowed.showIf!(values({ firstLayerUsers: [ALEX] }))).toBe(false);
  });

  test("offer a day, a week, two weeks and a month, starting on a week", () => {
    const field: ScheduleField = fieldTitled(fields, TURN_LENGTH_TITLE);

    expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(field.description).toBe("Then the next person takes over.");
    expect(field.required).toBe(true);
    expect(field.formOnly).toBe(true);
    expect(field.showEvenIfPermissionDoesNotExist).toBe(true);
    expect(field.dropdownOptions).toEqual([
      { label: "1 day", value: "1-Day" },
      { label: "1 week", value: "1-Week" },
      { label: "2 weeks", value: "2-Week" },
      { label: "1 month", value: "1-Month" },
    ]);
    expect(field.defaultValue).toBe(DEFAULT_SCHEDULE_TURN_LENGTH_VALUE);
    expect(DEFAULT_SCHEDULE_TURN_LENGTH_VALUE).toBe("1-Week");
  });

  test("start on the layer default the server and Add Layer use", () => {
    expect(
      describeRotation(
        getScheduleTurnLengthRotation(DEFAULT_SCHEDULE_TURN_LENGTH_VALUE),
      ),
    ).toBe(describeRotation(getDefaultLayerRotation()));
  });

  test.each(
    SCHEDULE_TURN_LENGTHS.map((length: ScheduleTurnLength) => {
      return [length.value, length] as [string, ScheduleTurnLength];
    }),
  )(
    "the length %s is a rotation the server accepts, as it was picked",
    (_value: string, length: ScheduleTurnLength) => {
      const rotation: Recurring = getScheduleTurnLengthRotation(length.value);

      expect(rotation.intervalType).toBe(length.intervalType);
      expect(rotation.intervalCount.toNumber()).toBe(length.intervalCount);

      // As it travels: JSON, read back by the server.
      expect(
        describeRotation(readScheduleFirstLayerRotation(rotation.toJSON())),
      ).toBe(`${length.intervalCount} ${length.intervalType}`);

      // A dropdown can hold the option itself rather than its value.
      expect(
        describeRotation(
          getScheduleTurnLengthRotation({
            label: length.label,
            value: length.value,
          }),
        ),
      ).toBe(describeRotation(rotation));
    },
  );

  test.each([
    ["nothing", undefined],
    ["an empty value", ""],
    ["an unknown value", "3-Day"],
  ] as Array<[string, unknown]>)(
    "a turn length of %s is a week",
    (_label: string, value: unknown) => {
      expect(describeRotation(getScheduleTurnLengthRotation(value))).toBe(
        "1 Week",
      );
    },
  );

  test("start the timezone on the user's own", () => {
    const field: ScheduleField = fieldTitled(fields, "Timezone");

    expect(field.defaultValue).toBe(OneUptimeDate.getCurrentTimezone());
    expect(field.required).toBe(false);
  });

  test("fold how long each turn lasts, the timezone, the description and the labels under one Advanced section", () => {
    const [name, takesTurns, turnLength, timezone, description, labels] =
      fields as [
        ScheduleField,
        ScheduleField,
        ScheduleField,
        ScheduleField,
        ScheduleField,
        ScheduleField,
      ];

    expect(name.collapsibleSection).toBeUndefined();
    expect(takesTurns.collapsibleSection).toBeUndefined();

    for (const folded of [turnLength, timezone, description, labels]) {
      expect(folded.collapsibleSection).toBeDefined();
      expect(folded.collapsibleSection).toBe(turnLength.collapsibleSection);
    }

    expect(turnLength.collapsibleSection!.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(turnLength.collapsibleSection!.title).toBe(
      ADVANCED_FORM_SECTION_TITLE,
    );
    // Folded on Create, and says "Configured" rather than opening.
    expect(turnLength.collapsibleSection!.openWhenConfigured).toBe(false);

    // The shared Labels field, with its shared help.
    expect(labels.description).toBe(LABELS_FORM_FIELD_DESCRIPTION);
  });

  test("each form gets a section of its own", () => {
    expect(buildFields(true)[2]!.collapsibleSection).not.toBe(
      buildFields(true)[2]!.collapsibleSection,
    );
  });
});

describe("the folded Advanced section", () => {
  const fields: Array<ScheduleField> = buildFields(true);
  const folded: Array<ScheduleField> = fields.slice(2);
  const timezone: string = OneUptimeDate.getCurrentTimezone().toString();

  function configured(record: Record<string, unknown>): boolean {
    return isFormSectionConfigured<OnCallDutyPolicySchedule>({
      section: folded[0]!.collapsibleSection!,
      fields: folded,
      values: values(record),
    });
  }

  test("says nothing with nobody picked", () => {
    expect(getScheduleAdvancedSummary(values({}))).toBeUndefined();
    expect(
      getScheduleAdvancedSummary(values({ firstLayerUsers: [] })),
    ).toBeUndefined();
    expect(folded[0]!.collapsibleSection!.getSummary!(values({}))).toBe(
      undefined,
    );
  });

  test("with somebody picked and nothing changed, says each person is on call for a week", () => {
    expect(SCHEDULE_DEFAULT_TURN_SUMMARY).toBe(
      "Each person is on call for a week, then the next one takes over.",
    );

    for (const record of [
      { firstLayerUsers: [ALEX] },
      {
        firstLayerUsers: [ALEX, SAM],
        turnLength: "1-Week",
        timezone: timezone,
        description: "",
        labels: [],
      },
      // A dropdown can hold the option itself.
      {
        firstLayerUsers: [ALEX],
        turnLength: { label: "1 week", value: "1-Week" },
      },
    ]) {
      expect(getScheduleAdvancedSummary(values(record))).toEqual([
        SCHEDULE_DEFAULT_TURN_SUMMARY,
      ]);
      expect(
        folded[0]!.collapsibleSection!.getSummary!(values(record)),
      ).toEqual([SCHEDULE_DEFAULT_TURN_SUMMARY]);
    }
  });

  test.each([
    ["another turn length", { turnLength: "2-Week" }],
    [
      "another timezone",
      {
        timezone:
          timezone === "Asia/Kolkata" ? "Europe/Berlin" : "Asia/Kolkata",
      },
    ],
    ["a description", { description: "Pages the payments team." }],
    ["a label", { labels: ["0e100000-0000-4000-8000-0000000000b1"] }],
  ] as Array<[string, Record<string, unknown>]>)(
    "once %s is set, gives way to the Configured badge",
    (_label: string, change: Record<string, unknown>) => {
      const record: Record<string, unknown> = {
        firstLayerUsers: [ALEX],
        ...change,
      };

      expect(getScheduleAdvancedSummary(values(record))).toBeUndefined();
      expect(configured(record)).toBe(true);
    },
  );

  test("says Configured only for what is in it: picking people is not", () => {
    expect(configured({})).toBe(false);
    expect(configured({ firstLayerUsers: [ALEX] })).toBe(false);
    expect(configured({ turnLength: "1-Week", timezone: timezone })).toBe(
      false,
    );
    expect(configured({ description: "Weekly." })).toBe(true);
  });
});

describe("what a create sends", () => {
  test("the people, in the order picked, as the server reads them", () => {
    expect(
      readScheduleTakesTurnsUserIds({ firstLayerUsers: [SAM, ALEX] }),
    ).toEqual([SAM, ALEX]);
    expect(readScheduleTakesTurnsUserIds({})).toEqual([]);
    expect(readScheduleTakesTurnsUserIds(null)).toEqual([]);
  });

  test("adds how long each turn lasts to the people picked, and the server reads both back", () => {
    // What ModelForm puts in the misc data by itself: the picks.
    const miscDataProps: JSONObject = { firstLayerUsers: [SAM, ALEX] };

    addScheduleFirstLayerMiscData({
      miscDataProps,
      formValues: { firstLayerUsers: [SAM, ALEX], turnLength: "2-Week" },
    });

    expect(Object.keys(miscDataProps).sort()).toEqual([
      SCHEDULE_FIRST_LAYER_ROTATION_KEY,
      SCHEDULE_FIRST_LAYER_USERS_KEY,
    ]);

    // As the request carries it: JSON.
    const sent: JSONObject = JSON.parse(JSON.stringify(miscDataProps));

    const firstLayer: ScheduleFirstLayer = readScheduleFirstLayer(sent)!;

    expect(firstLayer.userIds).toEqual([SAM, ALEX]);
    expect(describeRotation(firstLayer.rotation)).toBe("2 Week");
  });

  test("sends a week when the turn length was left alone", () => {
    const miscDataProps: JSONObject = { firstLayerUsers: [ALEX] };

    addScheduleFirstLayerMiscData({
      miscDataProps,
      formValues: { firstLayerUsers: [ALEX] },
    });

    expect(
      describeRotation(
        readScheduleFirstLayer(JSON.parse(JSON.stringify(miscDataProps)))!
          .rotation,
      ),
    ).toBe("1 Week");
  });

  test.each([
    ["nobody picked", {}],
    ["every pick taken back", { firstLayerUsers: [] }],
  ] as Array<[string, Record<string, unknown>]>)(
    "with %s, adds nothing: the request is what it always was",
    (_label: string, formValues: Record<string, unknown>) => {
      const miscDataProps: JSONObject = {};

      addScheduleFirstLayerMiscData({
        miscDataProps,
        formValues: { ...formValues, turnLength: "1-Month" },
      });

      expect(miscDataProps).toEqual({});
      expect(readScheduleFirstLayer(miscDataProps)).toBeNull();
    },
  );
});

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
  });

  /*
   * By the file the model is imported from: pages import it under names of
   * their own (the schedules page calls it OnCallDutySchedule).
   */
  const scheduleCreateForms: Array<FormFacts> = forms.filter(
    (form: FormFacts): boolean => {
      return (
        form.hasCreateForm === true &&
        (form.modelType?.file || "").endsWith(
          "Models/DatabaseModels/OnCallDutyPolicySchedule.ts",
        )
      );
    },
  );

  test("one form creates on-call schedules: the schedules page's", () => {
    expect(
      scheduleCreateForms.map((form: FormFacts): string => {
        return form.file;
      }),
    ).toEqual([SCHEDULES_PAGE]);
  });

  test("every form that creates a schedule asks who takes turns, in three rows and no steps", () => {
    expect(scheduleCreateForms.length).toBeGreaterThan(0);

    for (const form of scheduleCreateForms) {
      expect({ form: form.label, reasons: form.uncountableReasons }).toEqual({
        form: form.label,
        reasons: [],
      });
      expect(form.hasSteps).toBe(false);
      expect(form.hasSummaryOnly).toBe(false);

      // Name, the question, and the folded Advanced section.
      expect(countFieldRows(form.fields)).toBe(3);

      const question: FormFieldFacts | undefined = form.fields.find(
        (field: FormFieldFacts): boolean => {
          return field.title === TAKES_TURNS_TITLE;
        },
      );

      expect(question).toBeDefined();
      expect(question!.fieldType).toBe(PEOPLE_PICKER_FIELD_TYPE);
      expect(question!.key).toBe("SCHEDULE_TAKES_TURNS_FIELD_KEY");
      // Asked only of someone who may add layers.
      expect(question!.isConditional).toBe(true);
      expect(question!.collapsibleSection).toBeUndefined();
    }
  });

  test("the schedules page's form folds everything but the name and the question together", () => {
    const form: FormFacts = scheduleCreateForms.find(
      (candidate: FormFacts): boolean => {
        return candidate.file === SCHEDULES_PAGE;
      },
    )!;

    expect(
      form.fields.map((field: FormFieldFacts): string => {
        return field.key;
      }),
    ).toEqual([
      "name",
      "SCHEDULE_TAKES_TURNS_FIELD_KEY",
      "SCHEDULE_TURN_LENGTH_FIELD_KEY",
      "timezone",
      "description",
      "labels",
    ]);

    const [name, question, ...folded] = form.fields as Array<FormFieldFacts>;

    expect(name!.collapsibleSection).toBeUndefined();
    expect(question!.collapsibleSection).toBeUndefined();

    for (const field of folded) {
      expect(field.collapsibleSection).toBeDefined();
      expect(field.collapsibleSection).toBe(folded[0]!.collapsibleSection);
    }
  });
});

/*
 * One layer to start from: the first layer the server adds and the layer
 * Add Layer adds are built by the same builder, so they start the same way
 * (on call from now, weekly, around the clock).
 */
describe("a new layer is built in one place", () => {
  function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");
  }

  const LAYERS: string = readSource(
    "packages/App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/Layers.tsx",
  );

  const SERVICE: string = readSource(
    "packages/Common/Server/Services/OnCallDutyPolicyScheduleService.ts",
  );

  test("Add Layer builds it with the shared builder", () => {
    expect(LAYERS).toContain("buildNewScheduleLayer({");
    expect(LAYERS).toContain("getNewLayerName({");

    // No defaults of its own any more.
    expect(LAYERS).not.toContain("Recurring.getDefault()");
    expect(LAYERS).not.toContain("RestrictionTimes.getDefault()");
    expect(LAYERS).not.toContain("new OnCallDutyPolicyScheduleLayer()");
  });

  test("the server's first layer is built by it too", () => {
    expect(SERVICE).toContain("buildNewScheduleLayer({");
    expect(SERVICE).toContain("readScheduleFirstLayer(createBy.miscDataProps)");
  });

  test("a new layer starts with a week's rotation, not the column's day", () => {
    expect(describeRotation(getDefaultLayerRotation())).toBe(
      `1 ${EventInterval.Week}`,
    );
  });
});
