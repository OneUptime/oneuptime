import { describe, expect, jest, test } from "@jest/globals";
import {
  getSloFormFields,
  validateAtRiskThreshold,
  validateTargetPercentage,
  validateWindowDays,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloFormFields";
import {
  describeSloErrorBudget,
  describeSloWindow,
  getSloDowntimeSettingsFormFields,
  getSloEvaluationSettingsFormFields,
  getSloMultiMonitorModeDropdownOptions,
  getSloObjectiveSettingsFormFields,
  getSloPeriodSettingsFormFields,
  orderDowntimeMonitorStatuses,
  SLO_MULTI_MONITOR_MODE_DESCRIPTIONS,
} from "../../FeatureSet/Dashboard/src/Pages/Slo/SloSettingsFormFields";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import Permission from "Common/Types/Permission";
import SloMultiMonitorMode from "Common/Types/ServiceLevelObjective/SloMultiMonitorMode";
import SloWindowType from "Common/Types/ServiceLevelObjective/SloWindowType";
import { DEFAULT_ROLLING_WINDOW_DAYS } from "Common/Utils/Slo/SloHealth";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Validation from "Common/UI/Components/Forms/Validation";

/*
 * The SLO Settings page is where everything the create wizard stopped
 * asking now lives, so a field that silently drops out of one of its cards
 * leaves a setting nobody can change from the product. These pin each
 * card's fields, how they validate as the flat forms CardModelDetail
 * renders, and the plain-language summaries the cards show.
 */

type SloField = ModelField<ServiceLevelObjective>;
type SloValues = FormValues<ServiceLevelObjective>;

const OBJECTIVE_FIELDS: Array<SloField> = getSloObjectiveSettingsFormFields();
const PERIOD_FIELDS: Array<SloField> = getSloPeriodSettingsFormFields();
const DOWNTIME_FIELDS: Array<SloField> = getSloDowntimeSettingsFormFields();
const EVALUATION_FIELDS: Array<SloField> = getSloEvaluationSettingsFormFields();
const CREATE_FIELDS: Array<SloField> = getSloFormFields();

const SETTINGS_CARDS: Array<{ name: string; fields: Array<SloField> }> = [
  { name: "Objective", fields: OBJECTIVE_FIELDS },
  { name: "Compliance Period", fields: PERIOD_FIELDS },
  { name: "Downtime Calculation", fields: DOWNTIME_FIELDS },
  { name: "Evaluation", fields: EVALUATION_FIELDS },
];

function columnOf(field: SloField): string {
  const columns: Array<string> = Object.keys(
    field.field as unknown as Record<string, unknown>,
  );

  if (columns.length !== 1) {
    throw new Error(
      `Expected one column per SLO settings field, got ${JSON.stringify(columns)}.`,
    );
  }

  return columns[0]!;
}

function fieldIn(fields: Array<SloField>, column: string): SloField {
  const field: SloField | undefined = fields.find(
    (candidate: SloField): boolean => {
      return columnOf(candidate) === column;
    },
  );

  if (!field) {
    throw new Error(`No field for column "${column}".`);
  }

  return field;
}

// The parts of a field a user sees; functions are compared by behaviour elsewhere.
function visibleDefinitionOf(field: SloField): Record<string, unknown> {
  return {
    title: field.title,
    description: field.description,
    fieldType: field.fieldType,
    required: field.required,
    placeholder: field.placeholder,
    dropdownModal: field.dropdownModal,
    dropdownOptions: field.dropdownOptions,
  };
}

/*
 * CardModelDetail opens its edit modal with no steps, so Validation runs
 * with currentFormStepId null and every field on the form is checked at
 * once — the same call made here.
 */
function validateCard(
  fields: Array<SloField>,
  values: Record<string, unknown>,
): Record<string, string> {
  return Validation.validate({
    formFields: fields.map((field: SloField): SloField => {
      return { ...field, name: columnOf(field) };
    }),
    values: values as unknown as SloValues,
    currentFormStepId: null,
    onValidate: undefined,
  });
}

function makeStatus(
  name: string,
  priority?: number | undefined,
): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.name = name;

  if (priority !== undefined) {
    status.priority = priority;
  }

  return status;
}

describe("SLO settings cards", () => {
  test("edit the objective, period, downtime rules and evaluation switch, one card each", () => {
    expect(OBJECTIVE_FIELDS.map(columnOf)).toEqual([
      "targetPercentage",
      "atRiskThresholdPercentage",
    ]);
    expect(PERIOD_FIELDS.map(columnOf)).toEqual([
      "windowType",
      "windowDays",
      "timezone",
    ]);
    expect(DOWNTIME_FIELDS.map(columnOf)).toEqual([
      "multiMonitorMode",
      "downtimeMonitorStatuses",
    ]);
    expect(EVALUATION_FIELDS.map(columnOf)).toEqual(["isEnabled"]);
  });

  test("never edit the same column from two cards", () => {
    const columns: Array<string> = SETTINGS_CARDS.flatMap(
      (card: { fields: Array<SloField> }): Array<string> => {
        return card.fields.map(columnOf);
      },
    );

    expect(new Set(columns).size).toBe(columns.length);
  });

  test.each([
    "name",
    "description",
    "labels",
    "monitors",
    "monitorLabels",
    "isArchived",
  ])("leave %s to the page that owns it", (column: string) => {
    for (const card of SETTINGS_CARDS) {
      expect(card.fields.map(columnOf)).not.toContain(column);
    }
  });

  test("carry no wizard step ids — each card is a single flat form", () => {
    for (const card of SETTINGS_CARDS) {
      for (const field of card.fields) {
        expect(Object.prototype.hasOwnProperty.call(field, "stepId")).toBe(
          false,
        );
      }
    }
  });

  /*
   * ModelForm drops any field the viewer cannot update, and a card whose
   * every field is dropped shows a permission error. A column an SLO editor
   * cannot write would make that card useless for exactly the people it is
   * for.
   */
  test("only edit columns an SLO editor is allowed to update", () => {
    const model: ServiceLevelObjective = new ServiceLevelObjective();

    for (const card of SETTINGS_CARDS) {
      for (const field of card.fields) {
        const update: Array<Permission> | undefined =
          model.getColumnAccessControlFor(columnOf(field))?.update;

        expect(update).toContain(Permission.EditServiceLevelObjective);
      }
    }
  });
});

describe("the Objective and Compliance Period cards", () => {
  test("use exactly the create form's fields, so help text never drifts", () => {
    for (const field of [...OBJECTIVE_FIELDS, ...PERIOD_FIELDS]) {
      expect(visibleDefinitionOf(field)).toEqual(
        visibleDefinitionOf(fieldIn(CREATE_FIELDS, columnOf(field))),
      );
    }
  });

  test("keep the create form's validators", () => {
    expect(fieldIn(OBJECTIVE_FIELDS, "targetPercentage").customValidation).toBe(
      validateTargetPercentage,
    );
    expect(
      fieldIn(OBJECTIVE_FIELDS, "atRiskThresholdPercentage").customValidation,
    ).toBe(validateAtRiskThreshold);
    expect(fieldIn(PERIOD_FIELDS, "windowDays").customValidation).toBe(
      validateWindowDays,
    );
  });

  test("reject a 100% target when edited on Settings", () => {
    expect(
      validateCard(OBJECTIVE_FIELDS, {
        targetPercentage: 100,
        atRiskThresholdPercentage: 20,
      }),
    ).toEqual({
      targetPercentage: "Target must be greater than 0 and at most 99.999.",
    });
  });

  test("accept a valid objective", () => {
    expect(
      validateCard(OBJECTIVE_FIELDS, {
        targetPercentage: 99.95,
        atRiskThresholdPercentage: 25,
      }),
    ).toEqual({});
  });

  test("let a calendar-month period save with an empty Window (Days)", () => {
    expect(
      validateCard(PERIOD_FIELDS, {
        windowType: SloWindowType.CalendarMonth,
        windowDays: "",
        timezone: "Europe/Berlin",
      }),
    ).toEqual({});
  });

  test("still check Window (Days) on a rolling period", () => {
    expect(
      validateCard(PERIOD_FIELDS, {
        windowType: SloWindowType.Rolling,
        windowDays: 0,
      }),
    ).toEqual({ windowDays: "Window must be between 1 and 366 days." });
  });

  test("keep the Calendar Month backfill on the Settings form", () => {
    const setNewFormValues: ReturnType<typeof jest.fn> = jest.fn();
    const onChange: (
      value: SloWindowType,
      values: SloValues,
      setValues: (values: SloValues) => void,
    ) => void = fieldIn(PERIOD_FIELDS, "windowType").onChange as (
      value: SloWindowType,
      values: SloValues,
      setValues: (values: SloValues) => void,
    ) => void;

    onChange(
      SloWindowType.CalendarMonth,
      {
        windowType: SloWindowType.Rolling,
        windowDays: "",
      } as unknown as SloValues,
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledTimes(1);
    expect((setNewFormValues.mock.calls[0]![0] as SloValues).windowDays).toBe(
      DEFAULT_ROLLING_WINDOW_DAYS,
    );
  });

  test("keep the conditional visibility of the window fields", () => {
    const calendar: SloValues = {
      windowType: SloWindowType.CalendarMonth,
    } as unknown as SloValues;

    expect(fieldIn(PERIOD_FIELDS, "windowDays").showIf!(calendar)).toBe(false);
    expect(fieldIn(PERIOD_FIELDS, "timezone").showIf!(calendar)).toBe(true);
  });
});

describe("the Downtime Calculation card", () => {
  test("offers every multi-monitor mode, each explained in plain language", () => {
    const field: SloField = fieldIn(DOWNTIME_FIELDS, "multiMonitorMode");
    const options: Array<DropdownOption> =
      field.dropdownOptions as Array<DropdownOption>;

    expect(field.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(field.required).toBe(true);
    expect(options).toEqual(getSloMultiMonitorModeDropdownOptions());
    expect(
      options.map((option: DropdownOption): unknown => {
        return option.value;
      }),
    ).toEqual(Object.values(SloMultiMonitorMode));

    for (const option of options) {
      expect(option.label).toBe(option.value);
      expect(option.description).toBe(
        SLO_MULTI_MONITOR_MODE_DESCRIPTIONS[
          option.value as SloMultiMonitorMode
        ],
      );
    }
  });

  test("explains both modes differently, so the choice is never between two identical sentences", () => {
    const descriptions: Array<string> = Object.values(
      SLO_MULTI_MONITOR_MODE_DESCRIPTIONS,
    );

    expect(descriptions).toHaveLength(
      Object.values(SloMultiMonitorMode).length,
    );
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  test("picks downtime statuses from the project's monitor statuses by id", () => {
    const field: SloField = fieldIn(DOWNTIME_FIELDS, "downtimeMonitorStatuses");

    expect(field.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(field.dropdownModal).toEqual({
      type: MonitorStatus,
      labelField: "name",
      valueField: "_id",
    });
  });

  /*
   * An empty list is a meaningful setting — the worker falls back to every
   * non-operational status — so the field must never demand a value.
   */
  test("lets the downtime statuses be left empty", () => {
    expect(fieldIn(DOWNTIME_FIELDS, "downtimeMonitorStatuses").required).toBe(
      false,
    );
    expect(
      validateCard(DOWNTIME_FIELDS, {
        multiMonitorMode: SloMultiMonitorMode.AnyDown,
        downtimeMonitorStatuses: [],
      }),
    ).toEqual({});
  });
});

describe("the Evaluation card", () => {
  test("switches evaluation with a toggle that may be left off", () => {
    const field: SloField = fieldIn(EVALUATION_FIELDS, "isEnabled");

    expect(field.fieldType).toBe(FormFieldSchemaType.Toggle);
    expect(field.required).toBe(false);
    expect(String(field.description)).toContain("resolves");
  });
});

describe("describeSloWindow", () => {
  test("names a rolling window by its length", () => {
    expect(
      describeSloWindow({ windowType: SloWindowType.Rolling, windowDays: 28 }),
    ).toBe("Rolling 28-day window");
  });

  test("falls back to the 30-day default for a missing or nonsensical length", () => {
    expect(describeSloWindow({ windowType: SloWindowType.Rolling })).toBe(
      "Rolling 30-day window",
    );
    expect(describeSloWindow({ windowDays: 0 })).toBe("Rolling 30-day window");
    expect(describeSloWindow({ windowDays: Number.NaN })).toBe(
      "Rolling 30-day window",
    );
  });

  test("names a calendar month by its timezone, defaulting to UTC", () => {
    expect(
      describeSloWindow({
        windowType: SloWindowType.CalendarMonth,
        windowDays: 30,
        timezone: "America/New_York",
      }),
    ).toBe("Calendar month (America/New_York)");
    expect(
      describeSloWindow({
        windowType: SloWindowType.CalendarMonth,
        timezone: null,
      }),
    ).toBe("Calendar month (UTC)");
  });
});

describe("describeSloErrorBudget", () => {
  test("turns 99.9% over 30 days into the textbook 43m 12s", () => {
    expect(
      describeSloErrorBudget({
        targetPercentage: 99.9,
        windowType: SloWindowType.Rolling,
        windowDays: 30,
      }),
    ).toBe("43m 12s of downtime per 30-day window");
  });

  test("scales with the window and the target", () => {
    expect(
      describeSloErrorBudget({ targetPercentage: 99, windowDays: 90 }),
    ).toBe("21h 36m of downtime per 90-day window");
    expect(
      describeSloErrorBudget({ targetPercentage: 99.99, windowDays: 7 }),
    ).toBe("1m of downtime per 7-day window");
  });

  test("reads a target that arrived as a decimal string", () => {
    expect(
      describeSloErrorBudget({
        targetPercentage: "99.5" as unknown as number,
        windowDays: 30,
      }),
    ).toBe("3h 36m of downtime per 30-day window");
  });

  test("describes a calendar month as a share of the month, not a fixed length", () => {
    expect(
      describeSloErrorBudget({
        targetPercentage: 99.9,
        windowType: SloWindowType.CalendarMonth,
        windowDays: 7,
      }),
    ).toBe("0.1% of each month: 43m 12s of downtime in a 30-day month");
  });

  test.each([
    { name: "missing", targetPercentage: undefined },
    { name: "null", targetPercentage: null },
    { name: "zero", targetPercentage: 0 },
    { name: "100%", targetPercentage: 100 },
    { name: "above 100%", targetPercentage: 120 },
    { name: "not a number", targetPercentage: Number.NaN },
  ])(
    "says nothing for a $name target rather than a misleading 0s",
    ({ targetPercentage }: { targetPercentage: number | undefined | null }) => {
      expect(
        describeSloErrorBudget({
          targetPercentage: targetPercentage,
          windowDays: 30,
        }),
      ).toBeNull();
    },
  );
});

describe("orderDowntimeMonitorStatuses", () => {
  test("lists statuses in the project's priority order", () => {
    const ordered: Array<MonitorStatus> = orderDowntimeMonitorStatuses([
      makeStatus("Offline", 3),
      makeStatus("Degraded", 2),
      makeStatus("Maintenance", 4),
    ]);

    expect(
      ordered.map((status: MonitorStatus): string | undefined => {
        return status.name;
      }),
    ).toEqual(["Degraded", "Offline", "Maintenance"]);
  });

  test("puts statuses without a priority last, keeping their order", () => {
    const ordered: Array<MonitorStatus> = orderDowntimeMonitorStatuses([
      makeStatus("Unranked A"),
      makeStatus("Offline", 3),
      makeStatus("Unranked B"),
    ]);

    expect(
      ordered.map((status: MonitorStatus): string | undefined => {
        return status.name;
      }),
    ).toEqual(["Offline", "Unranked A", "Unranked B"]);
  });

  test("never reorders the list it was handed", () => {
    const statuses: Array<MonitorStatus> = [
      makeStatus("Offline", 3),
      makeStatus("Degraded", 2),
    ];

    orderDowntimeMonitorStatuses(statuses);

    expect(statuses[0]!.name).toBe("Offline");
  });

  test("treats a missing list as empty", () => {
    expect(orderDowntimeMonitorStatuses(undefined)).toEqual([]);
    expect(orderDowntimeMonitorStatuses(null)).toEqual([]);
  });
});
