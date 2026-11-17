import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as SloFormFieldsModule from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import {
  getSloAdvancedSummary,
  getSloFormFields,
  getSloSliTypeChoices,
  getSloWindowTypeChoices,
  isSloAdvancedAtDefaults,
  SLO_ADVANCED_DEFAULTS_SUMMARY,
  SLO_CREATE_FORM_STEPS,
  SLO_CREATE_INITIAL_VALUES,
  SLO_MAX_LATENCY_THRESHOLD_IN_MILLISECONDS,
  SLO_SLI_TYPE_CHOICE_DESCRIPTIONS,
  SLO_SUGGESTED_TARGET_PERCENTAGE,
  SLO_WINDOW_TYPE_CHOICE_DESCRIPTIONS,
  validateAtRiskThreshold,
  validateLatencyThreshold,
  validateRequestFilter,
  validateTargetPercentage,
  validateWindowDays,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import SliType from "Common/Types/ServiceLevelObjective/SliType";
import Service from "Common/Models/DatabaseModels/Service";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import {
  DEFAULT_AT_RISK_THRESHOLD_PERCENTAGE,
  DEFAULT_ROLLING_WINDOW_DAYS,
} from "Common/Utils/Slo/SloHealth";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_ID,
  MORE_FIELDS_SECTION_TITLE,
  isFormSectionConfigured,
} from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { getCreateFormColumnDefault } from "Common/UI/Components/Forms/Utils/CreateFormDefaults";
import { getFoldedFormFieldItems } from "Common/UI/Components/Forms/Utils/FoldedFormFields";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import Validation from "Common/UI/Components/Forms/Validation";
import { isMetricForm } from "../../FeatureSet/Dashboard/src/Pages/Slo/SloMetricQueryFields";
import { SLO_REQUEST_FILTER_EXPLORER_FIELDS } from "Common/Utils/Slo/SloRequestFilter";
import { TRACE_FIELD_ALIAS_MAP } from "../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile";

/*
 * SLO create used to walk three steps - Basic Info, Objective, Period - when
 * the one thing an SLO cannot start without, besides its name, is its
 * target. It became one page of three rows: the name, the target (prefilled
 * with 99.9) and one folded Advanced section holding everything that starts
 * from a column default.
 *
 * An SLO can measure requests now, as well as monitor uptime, so what it
 * measures is the first question, on a step of its own: the answer (Monitor
 * uptime, prefilled, Request success or Request latency), and for a request
 * SLO its services and for a latency one its threshold, which show only for
 * those answers. The second step is the one page it was: the name, the
 * target and the fold. Each step is three rows at most. These pin that
 * shape on the real field list, how it validates, and what the folded
 * section says while its defaults are kept.
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

// The first step: what the SLO measures.
const MEASURES_COLUMNS: Array<string> = [
  "sliType",
  "services",
  "latencyThresholdInMilliseconds",
  // Which of the services' requests count (#8444).
  "requestFilter",
];

/*
 * A Metric SLO's step (#8445): its metric's column, registered unseen, then
 * each part of it the form asks, by its own key.
 */
const METRIC_COLUMNS: Array<string> = [
  "metricQueryConfig",
  "sloMetricName",
  "sloMetricKind",
  "sloMetricGoodFilter",
  "sloMetricGoodAtOrUnder",
  "sloMetricFilter",
];

// The last step's open fields.
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
  /*
   * A Metric SLO's metric is asked part by part (#8445): each part is a
   * form-only field of its own key, editing a part of metricQueryConfig.
   */
  if (field.overrideFieldKey) {
    return field.overrideFieldKey;
  }

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
  test("is wired into the SLO create table in its two steps, with its seeds", () => {
    const pageSource: string = readSlosPage();

    expect(pageSource).toContain("formFields={getSloFormFields()}");
    expect(pageSource).toContain("formSteps={SLO_CREATE_FORM_STEPS}");
    expect(pageSource).toContain(
      "createInitialValues={SLO_CREATE_INITIAL_VALUES}",
    );
    expect(Object.keys(SloFormFieldsModule)).not.toContain("SLO_FORM_STEPS");
  });

  test("walks what it measures, a Metric SLO's metric, then the objective", () => {
    expect(SLO_CREATE_FORM_STEPS).toEqual([
      { id: "measures", title: "What It Measures" },
      { id: "metric", title: "Metric", showIf: isMetricForm },
      { id: "objective", title: "Objective" },
    ]);

    // The Metric step is a Metric SLO's only.
    const metricStep: { showIf?: (values: SloValues) => boolean } =
      SLO_CREATE_FORM_STEPS[1] as { showIf?: (values: SloValues) => boolean };

    expect(metricStep.showIf!(withValues({ sliType: SliType.Metric }))).toBe(
      true,
    );

    for (const sliType of [
      SliType.MonitorUptime,
      SliType.RequestSuccess,
      SliType.RequestLatency,
    ]) {
      expect(metricStep.showIf!(withValues({ sliType: sliType }))).toBe(false);
    }

    for (const field of CREATE_FIELDS) {
      const column: string = columnOf(field);
      let stepId: string = "objective";

      if (MEASURES_COLUMNS.includes(column)) {
        stepId = "measures";
      } else if (METRIC_COLUMNS.includes(column)) {
        stepId = "metric";
      }

      expect({ column: column, stepId: field.stepId }).toEqual({
        column: column,
        stepId: stepId,
      });
    }
  });

  test("shows what it measures, then the name and the target, and nothing else open", () => {
    expect(
      CREATE_FIELDS.filter((field: SloField): boolean => {
        return !field.collapsibleSection;
      }).map(columnOf),
    ).toEqual([...MEASURES_COLUMNS, ...METRIC_COLUMNS, ...OPEN_COLUMNS]);
  });

  test("folds everything else under Advanced, after the open fields, labels last", () => {
    expect(CREATE_FIELDS.map(columnOf)).toEqual([
      ...MEASURES_COLUMNS,
      ...METRIC_COLUMNS,
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
    expect(section.title).toBe(MORE_FIELDS_SECTION_TITLE);
    // Never opened by a default value, only by the user or by an error.
    expect(section.openWhenConfigured).toBe(false);
    expect(section.getSummary).toBe(getSloAdvancedSummary);
  });

  /*
   * What it measures, and for a request SLO its services, a latency SLO's
   * threshold and an optional request filter (#8444) - only the answer is
   * shown for a monitor uptime SLO; a Metric SLO's metric (#8445), its
   * column unseen and one of its two good parts shown, so four at most;
   * then the name, the target and the fold.
   */
  test("is four rows on what it measures, six on a metric and three on the objective", () => {
    const rowsOn: (stepId: string) => number = (stepId: string): number => {
      return countRows(
        CREATE_FIELDS.filter((field: SloField): boolean => {
          return field.stepId === stepId;
        }),
      );
    };

    expect(
      SLO_CREATE_FORM_STEPS.map((step: { id: string }) => {
        return [step.id, rowsOn(step.id)];
      }),
    ).toEqual([
      ["measures", 4],
      ["metric", 6],
      ["objective", 3],
    ]);
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
      sliType: SliType.MonitorUptime,
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
      windowDays: "Window must be between 1 and 366\u00A0days.",
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
      "Measured over a rolling {{days}}-day window, and At Risk when less than {{threshold}} of the error budget is left.",
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

  /*
   * Window Type was a dropdown under one description explaining both kinds
   * ("Rolling suits ... Calendar Month suits ..."). Its two answers are on
   * the form, each with one line saying what the window is and when to
   * pick it, Rolling - a new SLO's - first.
   */
  test("ask the window type as two answers, each with its line, Rolling first", () => {
    const options: Array<RadioButton> = getSloWindowTypeChoices();
    const field: ModelField<ServiceLevelObjective> = fieldFor("windowType");

    expect(
      options.map((option: RadioButton): string => {
        return option.value;
      }),
    ).toEqual([SloWindowType.Rolling, SloWindowType.CalendarMonth]);

    for (const option of options) {
      expect(option.title).toBe(option.value);
      expect(option.description).toBe(
        SLO_WINDOW_TYPE_CHOICE_DESCRIPTIONS[option.value as SloWindowType],
      );
      expect(option.description!.length).toBeLessThanOrEqual(100);
    }

    expect(field.fieldType).toBe(FormFieldSchemaType.RadioButton);
    expect(field.radioButtonOptions).toEqual(options);
    expect(field.dropdownOptions).toBeUndefined();
    // The answers explain themselves: no sentence above them about both.
    expect(field.description).toBeUndefined();
    expect(field.hideColumnDescription).toBe(true);
    expect(SLO_CREATE_INITIAL_VALUES.windowType).toBe(SloWindowType.Rolling);
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

/*
 * The folded More fields line on Create SLO, as the form draws it inside
 * ModelForm - which hands each field of a Create form its column's default
 * (Utils/CreateFormDefaults) - so with the three seeds that are exactly
 * those defaults. The line names them plainly, as every form names what it
 * holds, and the sentence under it says what they do. Called set ("At-Risk
 * Threshold (%): 20, Window Type: Rolling, Window (Days): 30") they would
 * claim choices nobody made, and say twice what the sentence says once.
 */
describe("the folded More fields line on Create SLO", () => {
  // The folded fields as ModelForm hands them to the form, on screen for these values.
  function foldedAsDrawn(values: SloValues): Array<SloField> {
    const model: ServiceLevelObjective = new ServiceLevelObjective();

    return CREATE_FIELDS.filter((field: SloField): boolean => {
      return (
        Boolean(field.collapsibleSection) &&
        (!field.showIf || field.showIf(values))
      );
    }).map((field: SloField): SloField => {
      const columnDefault: string | number | boolean | undefined =
        getCreateFormColumnDefault(model, field);

      return columnDefault === undefined
        ? field
        : {
            ...field,
            defaultValue: columnDefault,
            columnDefaultValue: columnDefault,
          };
    });
  }

  function lineItems(values: SloValues): Array<FoldedSectionItem> {
    const fields: Array<SloField> = foldedAsDrawn(values);

    return getFoldedFormFieldItems(fields, values, {
      isSectionConfigured: isFormSectionConfigured({
        section: fields[0]!.collapsibleSection!,
        fields: fields,
        values: values,
      }),
    });
  }

  test("names the seeded defaults without calling them set, and says what they do under the line", () => {
    const values: SloValues = withValues({});
    const items: Array<FoldedSectionItem> = lineItems(values);

    expect(
      items.map((item: FoldedSectionItem): string => {
        return item.title;
      }),
    ).toEqual([
      "Description",
      "At-Risk Threshold (%)",
      "Window Type",
      "Window (Days)",
      "Labels",
    ]);
    expect(
      items.filter((item: FoldedSectionItem): boolean => {
        return item.isSet;
      }),
    ).toEqual([]);
    expect(getSloAdvancedSummary(values)).toEqual([DEFAULTS_SUMMARY]);
  });

  test("a window changed from its default is a set value, and the defaults sentence goes", () => {
    const values: SloValues = withValues({ windowDays: 7 });
    const items: Array<FoldedSectionItem> = lineItems(values);

    expect(
      items
        .filter((item: FoldedSectionItem): boolean => {
          return item.isSet;
        })
        .map((item: FoldedSectionItem): string => {
          return `${item.title}: ${item.value}`;
        }),
    ).toEqual(["Window (Days): 7"]);
    expect(getSloAdvancedSummary(values)).toBeUndefined();
  });
});

describe("what the SLO create form asks an SLO to measure", () => {
  // A metric is the newest answer (#8445), so it comes last.
  test("offers monitor uptime first, then request success, request latency and a metric", () => {
    const choices: Array<RadioButton> = getSloSliTypeChoices();

    expect(
      choices.map((choice: RadioButton) => {
        return [choice.value, choice.title];
      }),
    ).toEqual([
      [SliType.MonitorUptime, "Monitor uptime"],
      [SliType.RequestSuccess, "Request success"],
      [SliType.RequestLatency, "Request latency"],
      [SliType.Metric, "Metric"],
    ]);

    for (const choice of choices) {
      expect(choice.description).toBe(
        SLO_SLI_TYPE_CHOICE_DESCRIPTIONS[choice.value as string],
      );
      // One short sentence each, under 150 characters.
      expect((choice.description as string).length).toBeLessThan(150);
    }
  });

  test("is a required answer, drawn as radio buttons that say where the numbers come from", () => {
    const sliType: SloField = fieldFor("sliType");

    expect(sliType.fieldType).toBe(FormFieldSchemaType.RadioButton);
    expect(sliType.required).toBe(true);
    expect(sliType.hideColumnDescription).toBe(true);
  });

  test("asks for services only of a request SLO, and requires them there", () => {
    const services: SloField = fieldFor("services");
    const show: (values: SloValues) => boolean = services.showIf!;
    const required: (values: SloValues) => boolean = services.required as (
      values: SloValues,
    ) => boolean;

    expect(services.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(services.dropdownModal?.type).toBe(Service);

    for (const sliType of [SliType.RequestSuccess, SliType.RequestLatency]) {
      expect(show(withValues({ sliType: sliType }))).toBe(true);
      expect(required(withValues({ sliType: sliType }))).toBe(true);
    }

    expect(show(withValues({ sliType: SliType.MonitorUptime }))).toBe(false);
    expect(required(withValues({ sliType: SliType.MonitorUptime }))).toBe(
      false,
    );
  });

  test("asks for a latency threshold only of a Request Latency SLO, and requires it there", () => {
    const threshold: SloField = fieldFor("latencyThresholdInMilliseconds");
    const show: (values: SloValues) => boolean = threshold.showIf!;
    const required: (values: SloValues) => boolean = threshold.required as (
      values: SloValues,
    ) => boolean;

    expect(threshold.fieldType).toBe(FormFieldSchemaType.Number);
    expect(threshold.placeholder).toBe("300");
    expect(show(withValues({ sliType: SliType.RequestLatency }))).toBe(true);
    expect(required(withValues({ sliType: SliType.RequestLatency }))).toBe(
      true,
    );

    for (const sliType of [SliType.MonitorUptime, SliType.RequestSuccess]) {
      expect(show(withValues({ sliType: sliType }))).toBe(false);
      expect(required(withValues({ sliType: sliType }))).toBe(false);
    }
  });

  test("a threshold is a whole number of milliseconds from 1 to an hour", () => {
    for (const value of [
      1,
      300,
      "250",
      SLO_MAX_LATENCY_THRESHOLD_IN_MILLISECONDS,
    ]) {
      expect(
        validateLatencyThreshold(
          withValues({ latencyThresholdInMilliseconds: value }),
        ),
      ).toBeNull();
    }

    for (const value of [0, -1, 2.5, "fast", 3600001]) {
      expect(
        validateLatencyThreshold(
          withValues({ latencyThresholdInMilliseconds: value }),
        ),
      ).toBe(
        "Latency threshold must be a whole number of milliseconds from 1 to 3,600,000.",
      );
    }

    expect(SLO_MAX_LATENCY_THRESHOLD_IN_MILLISECONDS).toBe(3600000);
  });

  test("a monitor uptime SLO validates without services or a threshold", () => {
    expect(validateForm(withValues({ name: "API" }))).toEqual({});
  });

  test("a request SLO without services, or a latency SLO without a threshold, does not", () => {
    const missingServices: Record<string, string> = validateForm(
      withValues({ name: "Checkout", sliType: SliType.RequestSuccess }),
    );

    expect(Object.keys(missingServices)).toContain("services");

    const missingThreshold: Record<string, string> = validateForm(
      withValues({
        name: "Checkout",
        sliType: SliType.RequestLatency,
        services: [{ _id: "6b000000-0000-4000-8000-000000000001" }],
      }),
    );

    expect(Object.keys(missingThreshold)).toEqual([
      "latencyThresholdInMilliseconds",
    ]);
  });
});

/*
 * A request SLO's request filter (#8444): optional, asked only of a request
 * SLO, a traces search the counting can read - checked here as the server
 * checks it, in the reader's language.
 */
describe("the SLO create form's request filter", () => {
  test("is asked of a request SLO only, and never required", () => {
    const filter: SloField = fieldFor("requestFilter");
    const show: (values: SloValues) => boolean = filter.showIf!;

    expect(filter.title).toBe("Request Filter");
    expect(filter.fieldType).toBe(FormFieldSchemaType.Text);
    expect(filter.required).toBe(false);
    expect(filter.stepId).toBe("measures");
    expect(filter.placeholder).toBe(
      "@http.route:/checkout* -@http.route:/health",
    );

    for (const sliType of [SliType.RequestSuccess, SliType.RequestLatency]) {
      expect(show(withValues({ sliType: sliType }))).toBe(true);
    }

    expect(show(withValues({ sliType: SliType.MonitorUptime }))).toBe(false);
  });

  test("accepts no filter, and any traces search of attributes and names", () => {
    for (const value of [
      undefined,
      "",
      "   ",
      "@http.route:/checkout*",
      '-@http.route:/health name:"POST /checkout"',
      "@http.request.method:[POST, PUT] @http.response.status_code:>=200",
    ]) {
      expect(
        validateRequestFilter(withValues({ requestFilter: value })),
      ).toBeNull();
    }
  });

  test("refuses free text, saying what to write instead", () => {
    expect(
      validateRequestFilter(withValues({ requestFilter: "checkout" })),
    ).toBe(
      'The request filter takes span attributes and the span\'s name, such as @http.route:/checkout* or name:"POST /checkout". "checkout" is neither.',
    );
  });

  test("refuses the Traces explorer's status, service and duration, which the SLO already decides", () => {
    expect(
      validateRequestFilter(
        withValues({ requestFilter: "@http.route:/checkout* status:error" }),
      ),
    ).toBe(
      'The request filter takes span attributes and the span\'s name, such as @http.route:/checkout* or name:"POST /checkout". "status:error" is neither.',
    );
    expect(
      validateRequestFilter(withValues({ requestFilter: "@status:error" })),
    ).toBeNull();
  });

  /*
   * The SLO's filter knows the explorer's fields from a copy in Common, as
   * Common cannot read the Dashboard: a field the explorer adds is one a
   * filter must refuse or take on purpose.
   */
  test("knows every field the Traces explorer has, and no other", () => {
    expect([...SLO_REQUEST_FILTER_EXPLORER_FIELDS].sort()).toEqual(
      Object.keys(TRACE_FIELD_ALIAS_MAP).sort(),
    );
  });

  test("refuses a filter too long, or with too many terms, with the limit grouped", () => {
    expect(
      validateRequestFilter(
        withValues({ requestFilter: `@k:${"a".repeat(600)}` }),
      ),
    ).toBe("The request filter can be at most 500 characters long.");

    const terms: Array<string> = [];

    for (let index: number = 0; index < 11; index++) {
      terms.push(`@k${index}:v`);
    }

    expect(
      validateRequestFilter(withValues({ requestFilter: terms.join(" ") })),
    ).toBe("The request filter can have at most 10 terms.");
  });

  test("a monitor uptime SLO validates without one", () => {
    expect(validateForm(withValues({ name: "API" }))).toEqual({});
  });
});
