import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorSecretAccess, {
  MonitorSecretAccessUtil,
} from "Common/Types/Monitor/MonitorSecretAccess";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MONITOR_SECRET_ACCESS_OPTIONS,
  MONITOR_SECRET_ACCESS_STEP_ID,
  MONITOR_SECRET_ACCESS_TITLES,
  getMonitorSecretAccessFormFields,
  getMonitorSecretAccessOptions,
  isMonitorsWithLabelsAccess,
  isSpecificMonitorsAccess,
} from "../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorSecretAccessFormFields";

/*
 * The Access step of the monitor secret form (#1467), as configuration: one
 * card per access mode, and a picker that is shown - and required - only for
 * the mode that reads it. The real form is driven end to end in Common's
 * MonitorSecretsAccessForm.test.tsx; this pins the pieces it is built from,
 * and that the page still uses them.
 */

const PAGE_SOURCE: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorSecrets.tsx",
);

type Values = FormValues<MonitorSecret>;

function valuesFor(access: MonitorSecretAccess | undefined): Values {
  return { monitorAccess: access } as Values;
}

function fieldFor(
  fields: Array<ModelField<MonitorSecret>>,
  column: string,
): ModelField<MonitorSecret> {
  const field: ModelField<MonitorSecret> | undefined = fields.find(
    (candidate: ModelField<MonitorSecret>): boolean => {
      return Object.keys(candidate.field || {})[0] === column;
    },
  );

  if (!field) {
    throw new Error(`No ${column} field on the Access step.`);
  }

  return field;
}

function isRequired(field: ModelField<MonitorSecret>, values: Values): boolean {
  return typeof field.required === "function"
    ? field.required(values)
    : Boolean(field.required);
}

function isShown(field: ModelField<MonitorSecret>, values: Values): boolean {
  return field.showIf ? field.showIf(values) : true;
}

describe("monitor secret Access step configuration", () => {
  const fields: Array<ModelField<MonitorSecret>> =
    getMonitorSecretAccessFormFields();

  test("has the mode, then the monitors picker, then the labels picker, all on the Access step", () => {
    expect(
      fields.map((field: ModelField<MonitorSecret>): string => {
        return Object.keys(field.field || {})[0]!;
      }),
    ).toEqual(["monitorAccess", "monitors", "labels"]);

    for (const field of fields) {
      expect(field.stepId).toBe(MONITOR_SECRET_ACCESS_STEP_ID);
    }

    expect(MONITOR_SECRET_ACCESS_STEP_ID).toBe("access");
  });

  test("the mode is a required single-column card choice that starts on Specific monitors", () => {
    const mode: ModelField<MonitorSecret> = fieldFor(fields, "monitorAccess");

    expect(mode.fieldType).toBe(FormFieldSchemaType.CardSelect);
    expect(mode.cardSelectSingleColumn).toBe(true);
    expect(mode.required).toBe(true);
    expect(mode.defaultValue).toBe(MonitorSecretAccess.SpecificMonitors);
    expect(mode.defaultValue).toBe(MonitorSecretAccessUtil.DEFAULT_ACCESS);
    expect(mode.title).toBe("Which monitors can use this secret?");
  });

  test("offers one card per mode, widest first, each with a title, an icon and a description", () => {
    const options: Array<CardSelectOption> = fieldFor(fields, "monitorAccess")
      .cardSelectOptions as Array<CardSelectOption>;

    expect(
      options.map((option: CardSelectOption): string => {
        return option.value;
      }),
    ).toEqual(MonitorSecretAccessUtil.ALL_ACCESS_MODES);

    for (const option of options) {
      expect(option.title).toBe(
        MONITOR_SECRET_ACCESS_TITLES[option.value as MonitorSecretAccess],
      );
      expect(option.icon).toBeDefined();
      expect(option.description.length).toBeGreaterThan(20);
    }

    expect(
      new Set(
        options.map((option: CardSelectOption): unknown => {
          return option.icon;
        }),
      ).size,
    ).toBe(3);
  });

  test.each([
    [MonitorSecretAccess.AllMonitors, false, false],
    [MonitorSecretAccess.SpecificMonitors, true, false],
    [MonitorSecretAccess.MonitorsWithLabels, false, true],
  ])(
    "%s shows and requires the monitors picker: %s, the labels picker: %s",
    (
      access: MonitorSecretAccess,
      monitorsPicker: boolean,
      labelsPicker: boolean,
    ) => {
      const monitors: ModelField<MonitorSecret> = fieldFor(fields, "monitors");
      const labels: ModelField<MonitorSecret> = fieldFor(fields, "labels");
      const values: Values = valuesFor(access);

      expect(isShown(monitors, values)).toBe(monitorsPicker);
      expect(isRequired(monitors, values)).toBe(monitorsPicker);
      expect(isShown(labels, values)).toBe(labelsPicker);
      expect(isRequired(labels, values)).toBe(labelsPicker);
    },
  );

  test("before a mode is known, neither picker is shown or required", () => {
    const values: Values = valuesFor(undefined);

    expect(isSpecificMonitorsAccess(values)).toBe(false);
    expect(isMonitorsWithLabelsAccess(values)).toBe(false);
    expect(isShown(fieldFor(fields, "monitors"), values)).toBe(false);
    expect(isShown(fieldFor(fields, "labels"), values)).toBe(false);
  });

  test("the pickers list this project's monitors and labels by name", () => {
    const monitors: ModelField<MonitorSecret> = fieldFor(fields, "monitors");
    const labels: ModelField<MonitorSecret> = fieldFor(fields, "labels");

    expect(monitors.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(monitors.dropdownModal).toEqual({
      type: Monitor,
      labelField: "name",
      valueField: "_id",
    });
    expect(labels.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(labels.dropdownModal).toEqual({
      type: Label,
      labelField: "name",
      valueField: "_id",
    });
  });

  test("the cards go through the page's translator, and keep their values", () => {
    const shout: (text: string) => string = (text: string): string => {
      return text.toUpperCase();
    };

    const options: Array<CardSelectOption> =
      getMonitorSecretAccessOptions(shout);

    expect(
      options.map((option: CardSelectOption): string => {
        return option.value;
      }),
    ).toEqual(MonitorSecretAccessUtil.ALL_ACCESS_MODES);

    options.forEach((option: CardSelectOption, index: number) => {
      expect(option.title).toBe(
        MONITOR_SECRET_ACCESS_OPTIONS[index]!.title.toUpperCase(),
      );
      expect(option.description).toBe(
        MONITOR_SECRET_ACCESS_OPTIONS[index]!.description.toUpperCase(),
      );
    });

    // The shared list itself is never rewritten.
    expect(MONITOR_SECRET_ACCESS_OPTIONS[0]!.title).toBe("All monitors");
  });
});

describe("the Monitor Secrets page", () => {
  const source: string = fs.readFileSync(PAGE_SOURCE, "utf8");

  test("builds its Access step from these fields, translated", () => {
    expect(source).toContain("...getMonitorSecretAccessFormFields(translate)");
    expect(source).toContain(
      '{ title: "Access", id: MONITOR_SECRET_ACCESS_STEP_ID }',
    );
  });

  test("no longer asks for monitors unconditionally, or offers an on/off switch for all monitors", () => {
    expect(source).not.toContain("Monitors which have access to this secret");
    expect(source).not.toContain("isAvailableToAllMonitors");
    expect(source).not.toContain("FormFieldSchemaType.Toggle");
  });

  test("shows each secret's access through the Access cell", () => {
    expect(source).toContain("<MonitorSecretAccessElement secret={item} />");
  });
});
