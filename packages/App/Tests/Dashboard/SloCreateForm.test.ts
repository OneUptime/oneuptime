import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as SloFormFieldsModule from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import {
  getSloAdvancedSummary,
  getSloFormFields,
  getSloWindowTypeDropdownOptions,
  isSloAdvancedAtDefaults,
  SLO_ADVANCED_DEFAULTS_SUMMARY,
  SLO_CREATE_INITIAL_VALUES,
  SLO_SUGGESTED_TARGET_PERCENTAGE,
  SLO_WINDOW_TYPE_DESCRIPTIONS,
  validateAtRiskThreshold,
  validateTargetPercentage,
  validateWindowDays,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  DEFAULT_ROLLING_WINDOW_DAYS,
} from "Common/Utils/Slo/SloHealth";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_ID,
  ADVANCED_FORM_SECTION_TITLE,
} from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { getCreateFormColumnDefault } from "Common/UI/Components/Forms/Utils/CreateFormDefaults";
import Validation from "Common/UI/Components/Forms/Validation";

/*
 * SLO create used to walk three steps - Basic Info, Objective, Period - when
 * the one thing an SLO cannot start without, besides its name, is its
 * target. It is one page of three rows now: the name, the target (prefilled
 * with 99.9) and one folded Advanced section holding everything that starts
 * from a column default. These pin that shape on the real field list, how
 * it validates as the one page BasicForm draws, and what the folded section
 * says while its defaults are kept.
 *
 * They also pin what the form deliberately does not ask. Monitors, the
 * monitor label rule, the downtime statuses and the multi-monitor mode live
 * on the Monitors, Monitor Rules and Settings pages, and each starts from a
 * server default; a field that crept back in would ask a question the
 * product decided nobody has to answer before their SLO exists.
 */

type SloField = ModelField<ServiceLevelObjective>;
type SloValues = FormValues<ServiceLevelObjective>;

/*
 * Building the field list also builds the full timezone dropdown. Build it
 * once so this structural suite stays fast and deterministic.
 */
const CREATE_FIELDS: Array<SloField> = getSloFormFields();

const OPEN_COLUMNS: Array<string> = ["name", "targetPercentage"];

const FOLDED_COLUMNS: Array<string> = [
  "description",
  "atRiskThresholdPercentage",
  "windowType",
  "windowDays",
  "timezone",
  "labels",
];

const DEFAULTS_SUMMARY: string =
  "Measured over a rolling 30-day window, and At Risk when less than 20% of the error budget is left.";

function columnOf(field: SloField): string {
  const columns: Array<string> = Object.keys(
    field.field as unknown as Record<string, unknown>,
  );

  if (columns.length !== 1) {
    throw new Error(
      `Expected one column per SLO form field, got ${JSON.stringify(columns)}.`,
    );
  }

  return columns[0]!;
}

function fieldFor(column: string): SloField {
  const field: SloField | undefined = CREATE_FIELDS.find(
    (candidate: SloField): boolean => {
      return columnOf(candidate) === column;
    },
  );

  if (!field) {
    throw new Error(`No SLO form field found for column "${column}".`);
  }

  return field;
}

/*
 * The rows BasicForm draws: every field is one, except that fields next to
 * each other in one folded section are drawn as one header.
 */
function countRows(fields: Array<SloField>): number {
  let rows: number = 0;
  let previousSectionId: string | undefined = undefined;

  for (const field of fields) {
    const sectionId: string | undefined = field.collapsibleSection?.id;

    if (sectionId !== undefined && sectionId === previousSectionId) {
      continue;
    }

    rows++;
    previousSectionId = sectionId;
  }

  return rows;
}

/*
 * BasicForm fills each field's `name` from its key before validating;
 * Validation.validate throws without one, so do the same here. A form with
 * no steps validates every field at once: currentFormStepId null.
 */
function validateForm(values: SloValues): Record<string, string> {
  const namedFields: Array<SloField> = CREATE_FIELDS.map(
    (field: SloField): SloField => {
      return {
        ...field,
        name: columnOf(field),
      };
    },
  );

  return Validation.validate({
    formFields: namedFields,
    values: values,
    currentFormStepId: null,
    onValidate: undefined,
  });
}

function withValues(values: Record<string, unknown>): SloValues {
  return {
    ...SLO_CREATE_INITIAL_VALUES,
    ...values,
  } as unknown as SloValues;
}

function readSlosPage(): string {
  return fs
    .readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "FeatureSet",
        "Dashboard",
        "src",
        "Pages",
        "Slo",
        "Slos.tsx",
      ),
      "utf8",
    )
    .replace(/\s+/g, " ");
}

describe("the SLO create form", () => {
  test("is wired into the SLO create table as one page, with its seeds", () => {
    const pageSource: string = readSlosPage();

    expect(pageSource).toContain("formFields={getSloFormFields()}");
    expect(pageSource).toContain(
      "createInitialValues={SLO_CREATE_INITIAL_VALUES}",
    );
    expect(pageSource).not.toContain("formSteps=");
    expect(pageSource).not.toContain("SLO_FORM_STEPS");
  });

  test("walks no steps: no step list is exported, and no field names a step", () => {
    expect(Object.keys(SloFormFieldsModule)).not.toContain("SLO_FORM_STEPS");

    for (const field of CREATE_FIELDS) {
      expect({ column: columnOf(field), stepId: field.stepId }).toEqual({
        column: columnOf(field),
        stepId: undefined,
      });
    }
  });

  test("shows the name and the target, in that order, and nothing else open", () => {
    expect(
      CREATE_FIELDS.filter((field: SloField): boolean => {
        return !field.collapsibleSection;
      }).map(columnOf),
    ).toEqual(OPEN_COLUMNS);
  });

  test("folds everything else under Advanced, after the open fields, labels last", () => {
    expect(CREATE_FIELDS.map(columnOf)).toEqual([
      ...OPEN_COLUMNS,
      ...FOLDED_COLUMNS,
    ]);
    expect(
      CREATE_FIELDS.filter((field: SloField): boolean => {
        return Boolean(field.collapsibleSection);
      }).map(columnOf),
    ).toEqual(FOLDED_COLUMNS);
  });

  test("folds them into one section: the form's Advanced section, folded on open", () => {
    const sections: Set<FormFieldCollapsibleSection<ServiceLevelObjective>> =
      new Set(
        FOLDED_COLUMNS.map(
          (
            column: string,
          ): FormFieldCollapsibleSection<ServiceLevelObjective> => {
            return fieldFor(column).collapsibleSection!;
          },
        ),
      );

    expect(sections.size).toBe(1);

    const section: FormFieldCollapsibleSection<ServiceLevelObjective> =
      Array.from(sections)[0]!;

    expect(section.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(section.title).toBe(ADVANCED_FORM_SECTION_TITLE);
    // Never opened by a default value, only by the user or by an error.
    expect(section.openWhenConfigured).toBe(false);
    expect(section.getSummary).toBe(getSloAdvancedSummary);
  });

  test("is three rows: the name, the target and the folded section", () => {
    expect(countRows(CREATE_FIELDS)).toBe(3);
  });

  test("keeps the labels the shared Labels field, folded with the rest", () => {
    const labels: SloField = fieldFor("labels");

    expect(labels.title).toBe("Labels");
    expect(labels.required).toBe(false);
    expect(labels.collapsibleSection).toBe(
      fieldFor("description").collapsibleSection,
    );
    expect(CREATE_FIELDS[CREATE_FIELDS.length - 1]).toBe(labels);
  });

  test.each([
    "monitors",
    "monitorLabels",
    "autoAddedMonitors",
    "multiMonitorMode",
    "downtimeMonitorStatuses",
    "isEnabled",
    "isArchived",
  ])(
    "does not ask for %s: it has its own page and a server default",
    (column: string) => {
      expect(CREATE_FIELDS.map(columnOf)).not.toContain(column);
    },
  );

  test("keeps the at-risk threshold beside the window it is measured over", () => {
    // Both fold in the one section; neither is on a page of its own.
    expect(fieldFor("atRiskThresholdPercentage").collapsibleSection).toBe(
      fieldFor("windowType").collapsibleSection,
    );
  });
});

describe("the SLO create form's initial values", () => {
  test("seed the suggested target with the objective and period defaults", () => {
    expect(SLO_CREATE_INITIAL_VALUES).toEqual({
      targetPercentage: SLO_SUGGESTED_TARGET_PERCENTAGE,
      windowType: SloWindowType.Rolling,
      windowDays: DEFAULT_ROLLING_WINDOW_DAYS,
      atRiskThresholdPercentage: DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
    });
  });

  test("suggest the usual three nines, a target the form itself accepts", () => {
    expect(SLO_SUGGESTED_TARGET_PERCENTAGE).toBe(99.9);
    expect(
      validateTargetPercentage(
        withValues({ targetPercentage: SLO_SUGGESTED_TARGET_PERCENTAGE }),
      ),
    ).toBeNull();
    expect(String(fieldFor("targetPercentage").placeholder)).toBe("99.9");
  });

  /*
   * What a form shows before anyone touches it is what the server would
   * store if the field were left out - except the target, whose column has
   * no default. The form sends the 99.9 it shows.
   */
  test("seed exactly the column defaults, and a target the column has none for", () => {
    const model: ServiceLevelObjective = new ServiceLevelObjective();

    for (const column of [
      "windowType",
      "windowDays",
      "atRiskThresholdPercentage",
    ]) {
      expect({
        column: column,
        seeded: (SLO_CREATE_INITIAL_VALUES as Record<string, unknown>)[column],
      }).toEqual({
        column: column,
        seeded: getCreateFormColumnDefault(model, fieldFor(column)),
      });
    }

    expect(
      getCreateFormColumnDefault(model, fieldFor("targetPercentage")),
    ).toBeUndefined();
    expect(
      model.getTableColumnMetadata("targetPercentage")?.defaultValue,
    ).toBeUndefined();
  });

  test("seed nothing for columns the form does not carry", () => {
    const keys: Array<string> = Object.keys(SLO_CREATE_INITIAL_VALUES);

    expect(keys).not.toContain("monitors");
    expect(keys).not.toContain("multiMonitorMode");
    expect(keys).not.toContain("downtimeMonitorStatuses");
  });

  test("seed only columns that have a field on the form", () => {
    const formColumns: Array<string> = CREATE_FIELDS.map(columnOf);

    for (const key of Object.keys(SLO_CREATE_INITIAL_VALUES)) {
      expect(formColumns).toContain(key);
    }
  });
});

describe("validating the SLO create form, one page at once", () => {
  test("asks for the name and nothing else when the seeds are kept", () => {
    expect(Object.keys(validateForm(withValues({})))).toEqual(["name"]);
  });

  test("passes with a name, the suggested target and the folded defaults", () => {
    expect(validateForm(withValues({ name: "API Availability" }))).toEqual({});
  });

  test("asks for a target when the suggestion is cleared", () => {
    expect(
      Object.keys(
        validateForm(
          withValues({ name: "API Availability", targetPercentage: "" }),
        ),
      ),
    ).toEqual(["targetPercentage"]);
  });

  test("rejects a 100% target that leaves no error budget", () => {
    expect(
      validateForm(
        withValues({ name: "API Availability", targetPercentage: 100 }),
      ),
    ).toEqual({
      targetPercentage: "Target must be greater than 0 and at most 99.999.",
    });
  });

  /*
   * A folded field still validates; its section opens by itself on the
   * error (CollapsibleFormSection), so the message is never hidden.
   */
  test("rejects a fractional at-risk threshold from the folded section", () => {
    expect(
      validateForm(
        withValues({
          name: "API Availability",
          atRiskThresholdPercentage: 20.5,
        }),
      ),
    ).toEqual({
      atRiskThresholdPercentage: "At-risk threshold must be a whole number.",
    });
  });

  test("passes for Calendar Month with an empty Window (Days), because the field is hidden", () => {
    expect(
      validateForm(
        withValues({
          name: "API Availability",
          windowType: SloWindowType.CalendarMonth,
          windowDays: "",
        }),
      ),
    ).toEqual({});
  });

  test("still checks Window (Days) for a rolling window", () => {
    expect(
      Object.keys(
        validateForm(withValues({ name: "API Availability", windowDays: "" })),
      ),
    ).toEqual(["windowDays"]);
    expect(
      validateForm(withValues({ name: "API Availability", windowDays: 400 })),
    ).toEqual({
      windowDays: "Window must be between 1 and 366 days.",
    });
  });

  test("passes with no description and no labels: they are optional", () => {
    expect(
      validateForm(
        withValues({
          name: "API Availability",
          description: "",
          labels: [],
        }),
      ),
    ).toEqual({});
  });
});

describe("the folded Advanced section's summary", () => {
  test("says what the defaults do while nothing in it is changed", () => {
    expect(
      getSloAdvancedSummary(withValues({ name: "API Availability" })),
    ).toEqual([DEFAULTS_SUMMARY]);
  });

  test("says the same before any value is seeded", () => {
    expect(getSloAdvancedSummary({} as SloValues)).toEqual([DEFAULTS_SUMMARY]);
  });

  test("is worded from the defaults themselves, as one sentence to translate", () => {
    expect(SLO_ADVANCED_DEFAULTS_SUMMARY).toBe(
      "Measured over a rolling {{days}}-day window, and At Risk when less than {{threshold}}% of the error budget is left.",
    );
  });

  test.each([
    ["a description", { description: "The public API" }],
    ["labels", { labels: ["0198c8ec-2a1d-7f0c-9e75-384194162001"] }],
    ["another at-risk threshold", { atRiskThresholdPercentage: 25 }],
    ["a cleared at-risk threshold", { atRiskThresholdPercentage: "" }],
    ["a calendar month", { windowType: SloWindowType.CalendarMonth }],
    ["another window length", { windowDays: 28 }],
    ["a cleared window length", { windowDays: "" }],
    ["a timezone", { timezone: "Europe/Berlin" }],
  ])(
    "says nothing once %s is set, and the header says Configured instead",
    (_name: string, values: Record<string, unknown>) => {
      expect(isSloAdvancedAtDefaults(withValues(values))).toBe(false);
      expect(getSloAdvancedSummary(withValues(values))).toBeUndefined();
    },
  );

  test("ignores the name and the target, which are not folded", () => {
    expect(
      getSloAdvancedSummary(
        withValues({ name: "Checkout", targetPercentage: 99.95 }),
      ),
    ).toEqual([DEFAULTS_SUMMARY]);
  });

  test("reads a number typed as text, and an option picked as { label, value }, as the default they are", () => {
    expect(
      getSloAdvancedSummary(
        withValues({
          windowDays: "30",
          atRiskThresholdPercentage: "20",
          windowType: {
            label: SloWindowType.Rolling,
            value: SloWindowType.Rolling,
          },
        }),
      ),
    ).toEqual([DEFAULTS_SUMMARY]);
  });

  test("counts blank text and an empty label list as left empty", () => {
    expect(
      isSloAdvancedAtDefaults(
        withValues({ description: "   ", labels: [], timezone: "" }),
      ),
    ).toBe(true);
  });
});

describe("the SLO create form's window fields", () => {
  type WindowTypeOnChange = (
    value: SloWindowType,
    currentFormValues: SloValues,
    setNewFormValues: (values: SloValues) => void,
  ) => void;

  function windowTypeOnChange(): WindowTypeOnChange {
    return fieldFor("windowType").onChange as WindowTypeOnChange;
  }

  test("backfill a cleared Window (Days) when switching to Calendar Month", () => {
    const setNewFormValues: ReturnType<typeof jest.fn> = jest.fn();

    windowTypeOnChange()(
      SloWindowType.CalendarMonth,
      withValues({ windowDays: "" }),
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect((setNewFormValues.mock.calls[0]![0] as SloValues).windowDays).toBe(
      DEFAULT_ROLLING_WINDOW_DAYS,
    );
  });

  test("leave a real Window (Days) alone when switching to Calendar Month", () => {
    const setNewFormValues: ReturnType<typeof jest.fn> = jest.fn();

    windowTypeOnChange()(
      SloWindowType.CalendarMonth,
      withValues({ windowDays: 14 }),
      setNewFormValues,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });

  test("never rewrite values when switching to Rolling", () => {
    const setNewFormValues: ReturnType<typeof jest.fn> = jest.fn();

    windowTypeOnChange()(
      SloWindowType.Rolling,
      withValues({ windowDays: "" }),
      setNewFormValues,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });

  test("show Window (Days) only for rolling windows and Timezone only for calendar months", () => {
    const rolling: SloValues = withValues({});
    const calendar: SloValues = withValues({
      windowType: SloWindowType.CalendarMonth,
    });

    expect(fieldFor("windowDays").showIf!(rolling)).toBe(true);
    expect(fieldFor("windowDays").showIf!(calendar)).toBe(false);
    expect(fieldFor("timezone").showIf!(rolling)).toBe(false);
    expect(fieldFor("timezone").showIf!(calendar)).toBe(true);
  });

  test("explain every window type inside the dropdown itself", () => {
    const options: Array<DropdownOption> = getSloWindowTypeDropdownOptions();

    expect(
      options.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual(Object.values(SloWindowType));

    for (const option of options) {
      expect(option.description).toBe(
        SLO_WINDOW_TYPE_DESCRIPTIONS[option.value as SloWindowType],
      );
      expect(option.description!.length).toBeGreaterThan(0);
    }

    expect(fieldFor("windowType").dropdownOptions).toEqual(options);
  });

  test("put the client-side validators on the fields they guard", () => {
    expect(fieldFor("targetPercentage").customValidation).toBe(
      validateTargetPercentage,
    );
    expect(fieldFor("atRiskThresholdPercentage").customValidation).toBe(
      validateAtRiskThreshold,
    );
    expect(fieldFor("windowDays").customValidation).toBe(validateWindowDays);
  });

  /*
   * A bare "99.9" means nothing until it is turned into downtime; the help
   * text is where a first-time user learns what they are agreeing to.
   */
  test("translate the target into the downtime it allows", () => {
    expect(String(fieldFor("targetPercentage").description)).toContain(
      "downtime",
    );
  });
});
