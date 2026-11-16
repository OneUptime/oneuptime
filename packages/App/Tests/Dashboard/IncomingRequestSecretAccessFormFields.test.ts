import IncomingRequestSecret from "Common/Models/DatabaseModels/IncomingRequestSecret";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecretAccess from "Common/Types/Monitor/MonitorSecretAccess";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getIncomingRequestSecretAccessFormFields } from "../../FeatureSet/Dashboard/src/Components/IncomingRequestSecret/IncomingRequestSecretAccessFormFields";
import { MONITOR_SECRET_ACCESS_OPTIONS } from "../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorSecretAccessFormFields";

/*
 * Which Incoming Request monitors accept an incoming request secret (issue
 * #8501), as the secret's form asks it: the three modes monitor secrets have,
 * in their words, starting on All monitors - what every secret did before -
 * and folded away under More fields with the secret's value, since only a
 * project shared by tenants needs it. The picker of a mode shows, and is
 * required, only for that mode, and the monitor picker offers Incoming
 * Request monitors alone.
 */

const PAGE_SOURCE: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/IncomingRequestSecrets.tsx",
);

const LOCALES: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Locales",
);

type Values = FormValues<IncomingRequestSecret>;

const moreFields: FormFieldCollapsibleSection<IncomingRequestSecret> =
  getAdvancedFormSection<IncomingRequestSecret>();

const fields: Array<ModelField<IncomingRequestSecret>> =
  getIncomingRequestSecretAccessFormFields({ collapsibleSection: moreFields });

function fieldFor(column: string): ModelField<IncomingRequestSecret> {
  const field: ModelField<IncomingRequestSecret> | undefined = fields.find(
    (candidate: ModelField<IncomingRequestSecret>): boolean => {
      return Object.keys(candidate.field || {})[0] === column;
    },
  );

  if (!field) {
    throw new Error(`No ${column} field.`);
  }

  return field;
}

function valuesFor(access: MonitorSecretAccess | undefined): Values {
  return { monitorAccess: access } as Values;
}

function isShown(
  field: ModelField<IncomingRequestSecret>,
  values: Values,
): boolean {
  return field.showIf ? field.showIf(values) : true;
}

function isRequired(
  field: ModelField<IncomingRequestSecret>,
  values: Values,
): boolean {
  return typeof field.required === "function"
    ? field.required(values)
    : Boolean(field.required);
}

describe("which monitors accept an incoming request secret, as its form asks", () => {
  test("is the mode, then the monitors picker, then the labels picker", () => {
    expect(
      fields.map((field: ModelField<IncomingRequestSecret>): string => {
        return Object.keys(field.field || {})[0]!;
      }),
    ).toEqual(["monitorAccess", "monitors", "labels"]);
  });

  test("starts on All monitors, what every secret did before a secret could be limited", () => {
    const mode: ModelField<IncomingRequestSecret> = fieldFor("monitorAccess");

    expect(mode.fieldType).toBe(FormFieldSchemaType.CardSelect);
    expect(mode.defaultValue).toBe(MonitorSecretAccess.AllMonitors);
    expect(mode.required).toBe(true);
  });

  test("folds every one of them away under More fields, with the secret's value", () => {
    for (const field of fields) {
      expect(field.collapsibleSection).toBe(moreFields);
    }

    const page: string = fs.readFileSync(PAGE_SOURCE, "utf8");

    expect(page).toContain(
      "...getIncomingRequestSecretAccessFormFields({\n            translate,\n            collapsibleSection: moreFields,\n          })",
    );
  });

  test("offers the three modes monitor secrets offer, in their words", () => {
    const options: Array<CardSelectOption> =
      fieldFor("monitorAccess").cardSelectOptions || [];

    expect(
      options.map((option: CardSelectOption): string => {
        return option.value;
      }),
    ).toEqual([
      MonitorSecretAccess.AllMonitors,
      MonitorSecretAccess.SpecificMonitors,
      MonitorSecretAccess.MonitorsWithLabels,
    ]);
    expect(options).toEqual(MONITOR_SECRET_ACCESS_OPTIONS);
  });

  test("shows and requires each picker only for its mode", () => {
    const monitors: ModelField<IncomingRequestSecret> = fieldFor("monitors");
    const labels: ModelField<IncomingRequestSecret> = fieldFor("labels");

    for (const access of [
      MonitorSecretAccess.AllMonitors,
      MonitorSecretAccess.SpecificMonitors,
      MonitorSecretAccess.MonitorsWithLabels,
      undefined,
    ]) {
      const values: Values = valuesFor(access);

      expect({
        access,
        monitors: [isShown(monitors, values), isRequired(monitors, values)],
        labels: [isShown(labels, values), isRequired(labels, values)],
      }).toEqual({
        access,
        monitors: [
          access === MonitorSecretAccess.SpecificMonitors,
          access === MonitorSecretAccess.SpecificMonitors,
        ],
        labels: [
          access === MonitorSecretAccess.MonitorsWithLabels,
          access === MonitorSecretAccess.MonitorsWithLabels,
        ],
      });
    }
  });

  test("the monitor picker offers Incoming Request monitors alone, and the label picker the project's labels", () => {
    expect(fieldFor("monitors").dropdownModal).toEqual({
      type: Monitor,
      labelField: "name",
      valueField: "_id",
      query: { monitorType: MonitorType.IncomingRequest },
    });
    expect(fieldFor("labels").dropdownModal).toEqual({
      type: Label,
      labelField: "name",
      valueField: "_id",
    });
  });

  test("every word it shows is in every Dashboard language", () => {
    const words: Array<string> = [];

    for (const field of fields) {
      words.push(field.title as string);

      if (field.description) {
        words.push(field.description as string);
      }

      if (field.placeholder) {
        words.push(field.placeholder);
      }

      for (const option of field.cardSelectOptions || []) {
        words.push(option.title, option.description || "");
      }
    }

    for (const file of fs.readdirSync(LOCALES)) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const locale: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES, file), "utf8"),
      ) as Record<string, unknown>;

      for (const word of words.filter(Boolean)) {
        expect({
          file,
          word,
          present: typeof locale[word] === "string",
        }).toEqual({ file, word, present: true });
      }
    }
  });

  test("the list shows which monitors each secret covers, reading a secret with no mode as All monitors", () => {
    const page: string = fs.readFileSync(PAGE_SOURCE, "utf8");

    expect(page).toContain("<MonitorSecretAccessElement");
    expect(page).toContain(
      "defaultAccess={INCOMING_REQUEST_SECRET_DEFAULT_ACCESS}",
    );
  });
});
