import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import TelemetryIngestionKey from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { ADVANCED_FORM_SECTION_ID } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import Validation from "../../../UI/Components/Forms/Validation";
import Dictionary from "../../../Types/Dictionary";
import {
  BROWSER_INGESTION_KEY_NAME,
  IngestionKeyFormOptions,
  SERVER_INGESTION_KEY_NAME,
  getDefaultIngestionKeyName,
  getIngestionKeyFormFields,
  getIngestionKeyFormSteps,
  getIngestionKeyNameAfterTypeChange,
  getUniqueIngestionKeyName,
  isBrowserIngestionKey,
  prepareIngestionKeyForCreate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestionKeyForm";

/*
 * The one create form behind every door onto a new telemetry ingestion
 * key (Settings > Telemetry Ingestion Keys, and the key step of every setup
 * guide), read as data: which steps it walks, which fields sit on which
 * step, what is folded, what is filled in, and what reaches the request.
 * The rendered flows are in TelemetryIngestionKeyForm.test.tsx (Settings)
 * and IngestionKeySelectorCreate.test.tsx (the guides).
 */

let isFreePlan: boolean = false;

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/PayAsYouGo", () => {
  return {
    isProjectOnFreePlan: (): boolean => {
      return isFreePlan;
    },
  };
});

type Fields = Array<ModelField<TelemetryIngestionKey>>;

const SETTINGS: IngestionKeyFormOptions = {};
const SERVER_GUIDE: IngestionKeyFormOptions = {
  keyType: TelemetryIngestionKeyType.Server,
  keyName: "Kubernetes key",
};
const BROWSER_GUIDE: IngestionKeyFormOptions = {
  keyType: TelemetryIngestionKeyType.Browser,
  keyName: "RUM key",
};

function fieldKey(field: Field<TelemetryIngestionKey>): string {
  return (
    field.overrideFieldKey ||
    Object.keys(field.field || {})[0] ||
    Object.keys(
      (field as ModelField<TelemetryIngestionKey>).overrideField || {},
    )[0] ||
    ""
  );
}

function fieldNamed(
  fields: Fields,
  key: string,
): ModelField<TelemetryIngestionKey> {
  const field: ModelField<TelemetryIngestionKey> | undefined = fields.find(
    (candidate: ModelField<TelemetryIngestionKey>): boolean => {
      return fieldKey(candidate) === key;
    },
  );

  if (!field) {
    throw new Error(`No ${key} field`);
  }

  return field;
}

// [key, step, folded] for every field, in order.
function layout(fields: Fields): Array<[string, string | undefined, boolean]> {
  return fields.map(
    (
      field: ModelField<TelemetryIngestionKey>,
    ): [string, string | undefined, boolean] => {
      return [fieldKey(field), field.stepId, Boolean(field.collapsibleSection)];
    },
  );
}

function stepIds(steps: Array<FormStep<TelemetryIngestionKey>>): Array<string> {
  return steps.map((step: FormStep<TelemetryIngestionKey>): string => {
    return step.id;
  });
}

// The steps a reader walks for these values.
function visibleStepIds(
  steps: Array<FormStep<TelemetryIngestionKey>>,
  values: FormValues<TelemetryIngestionKey>,
): Array<string> {
  return stepIds(
    steps.filter((step: FormStep<TelemetryIngestionKey>): boolean => {
      return !step.showIf || step.showIf(values);
    }),
  );
}

function validate(
  fields: Fields,
  values: FormValues<TelemetryIngestionKey>,
): Dictionary<string> {
  return Validation.validate<TelemetryIngestionKey>({
    formFields: fields.map(
      (
        field: ModelField<TelemetryIngestionKey>,
      ): ModelField<TelemetryIngestionKey> => {
        return { ...field, name: fieldKey(field) };
      },
    ),
    values,
    onValidate: undefined,
    currentFormStepId: null,
  });
}

// The Key Type card picker's onChange, as BasicForm calls it.
function pickKeyType(
  fields: Fields,
  values: FormValues<TelemetryIngestionKey>,
  keyType: TelemetryIngestionKeyType,
): FormValues<TelemetryIngestionKey> {
  let next: FormValues<TelemetryIngestionKey> = { ...values };
  fieldNamed(fields, "keyType").onChange?.(
    keyType,
    values,
    (updated: FormValues<TelemetryIngestionKey>): void => {
      next = updated;
    },
  );

  // BasicForm then writes the picked value over what onChange set.
  return { ...next, keyType: keyType };
}

describe("Telemetry ingestion key create form", () => {
  beforeEach(() => {
    isFreePlan = false;
  });

  describe("steps", () => {
    test("Settings on a paid plan: the Key step, and Browser Settings only for a Browser key - no Summary", () => {
      const steps: Array<FormStep<TelemetryIngestionKey>> =
        getIngestionKeyFormSteps(SETTINGS);

      expect(stepIds(steps)).toEqual(["key", "browser-settings"]);
      expect(
        steps.map((step: FormStep<TelemetryIngestionKey>): string => {
          return step.title;
        }),
      ).toEqual(["Key", "Browser Settings"]);
      expect(
        visibleStepIds(steps, { keyType: TelemetryIngestionKeyType.Server }),
      ).toEqual(["key"]);
      expect(
        visibleStepIds(steps, { keyType: TelemetryIngestionKeyType.Browser }),
      ).toEqual(["key", "browser-settings"]);
      expect(
        steps.some((step: FormStep<TelemetryIngestionKey>): boolean => {
          return Boolean(step.isSummaryStep) || step.id === "summary";
        }),
      ).toBe(false);
    });

    test("Settings on the Free plan ends on Billing, for either type", () => {
      isFreePlan = true;
      const steps: Array<FormStep<TelemetryIngestionKey>> =
        getIngestionKeyFormSteps(SETTINGS);

      expect(
        visibleStepIds(steps, { keyType: TelemetryIngestionKeyType.Server }),
      ).toEqual(["key", "billing"]);
      expect(
        visibleStepIds(steps, { keyType: TelemetryIngestionKeyType.Browser }),
      ).toEqual(["key", "browser-settings", "billing"]);
    });

    test.each([
      ["a Server", SERVER_GUIDE],
      ["a Browser", BROWSER_GUIDE],
    ])(
      "a guide pinning %s key on a paid plan walks no steps at all",
      (_label: string, options: IngestionKeyFormOptions) => {
        expect(getIngestionKeyFormSteps(options)).toEqual([]);
      },
    );

    test.each([
      ["a Server", SERVER_GUIDE],
      ["a Browser", BROWSER_GUIDE],
    ])(
      "a guide pinning %s key on the Free plan walks Key, then Billing",
      (_label: string, options: IngestionKeyFormOptions) => {
        isFreePlan = true;
        expect(stepIds(getIngestionKeyFormSteps(options))).toEqual([
          "key",
          "billing",
        ]);
      },
    );
  });

  describe("fields", () => {
    test("Settings: Name and Key Type open, Description folded, the browser settings on their own step", () => {
      expect(layout(getIngestionKeyFormFields(SETTINGS))).toEqual([
        ["name", "key", false],
        ["keyType", "key", false],
        ["description", "key", true],
        ["allowedOrigins", "browser-settings", false],
        ["pinnedServiceName", "browser-settings", true],
      ]);
    });

    test("a Server guide asks for the name only, with the description folded", () => {
      expect(layout(getIngestionKeyFormFields(SERVER_GUIDE))).toEqual([
        ["name", "key", false],
        ["description", "key", true],
      ]);
    });

    test("a Browser guide asks for the name and the origins on one page, with the rest folded", () => {
      expect(layout(getIngestionKeyFormFields(BROWSER_GUIDE))).toEqual([
        ["name", "key", false],
        ["allowedOrigins", "key", false],
        ["description", "key", true],
        ["pinnedServiceName", "key", true],
      ]);
    });

    test.each([SETTINGS, SERVER_GUIDE, BROWSER_GUIDE])(
      "the Free plan adds the pricing notice on Billing, as a notice that has to be shown (%#)",
      (options: IngestionKeyFormOptions) => {
        isFreePlan = true;
        const fields: Fields = getIngestionKeyFormFields(options);
        const notice: ModelField<TelemetryIngestionKey> = fields[
          fields.length - 1
        ] as ModelField<TelemetryIngestionKey>;

        expect(fieldKey(notice)).toBe("telemetryPayAsYouGoNotice");
        expect(notice.stepId).toBe("billing");
        expect(notice.fieldType).toBe(FormFieldSchemaType.CustomComponent);
        // A gate: never finished past without being drawn.
        expect(notice.customElementCanBeSkipped).toBeFalsy();
        expect(notice.overrideFieldKey).toBeUndefined();
      },
    );

    test.each([SETTINGS, SERVER_GUIDE, BROWSER_GUIDE])(
      "no pricing notice off the Free plan (%#)",
      (options: IngestionKeyFormOptions) => {
        expect(getIngestionKeyFormFields(options).map(fieldKey)).not.toContain(
          "telemetryPayAsYouGoNotice",
        );
      },
    );

    test("the folded fields share one Advanced section", () => {
      for (const options of [SETTINGS, BROWSER_GUIDE]) {
        const fields: Fields = getIngestionKeyFormFields(options);
        const description: ModelField<TelemetryIngestionKey> = fieldNamed(
          fields,
          "description",
        );
        const pinned: ModelField<TelemetryIngestionKey> = fieldNamed(
          fields,
          "pinnedServiceName",
        );

        expect(description.collapsibleSection?.id).toBe(
          ADVANCED_FORM_SECTION_ID,
        );
        expect(description.collapsibleSection?.title).toBe("Advanced");
        expect(description.collapsibleSection?.openWhenConfigured).toBe(false);
        expect(pinned.collapsibleSection).toBe(description.collapsibleSection);
      }
    });

    test("every door writes a field the same way: one title, one help text, one placeholder", () => {
      const describe: (field: ModelField<TelemetryIngestionKey>) => string = (
        field: ModelField<TelemetryIngestionKey>,
      ): string => {
        return JSON.stringify({
          title: field.title,
          description: field.description,
          placeholder: field.placeholder,
          fieldType: field.fieldType,
          required: typeof field.required === "boolean" ? field.required : "fn",
          validation: field.validation,
        });
      };

      const settings: Fields = getIngestionKeyFormFields(SETTINGS);

      for (const options of [SERVER_GUIDE, BROWSER_GUIDE]) {
        for (const field of getIngestionKeyFormFields(options)) {
          expect(describe(field)).toBe(
            describe(fieldNamed(settings, fieldKey(field))),
          );
        }
      }
    });

    test("Key Type is cards, Server picked, and only on Settings", () => {
      const keyType: ModelField<TelemetryIngestionKey> = fieldNamed(
        getIngestionKeyFormFields(SETTINGS),
        "keyType",
      );

      expect(keyType.fieldType).toBe(FormFieldSchemaType.CardSelect);
      expect(keyType.defaultValue).toBe(TelemetryIngestionKeyType.Server);
      expect(keyType.required).toBe(true);
      expect(
        (keyType.cardSelectOptions || []).map((option: unknown): string => {
          return (option as { value: string }).value;
        }),
      ).toEqual([
        TelemetryIngestionKeyType.Server,
        TelemetryIngestionKeyType.Browser,
      ]);

      for (const options of [SERVER_GUIDE, BROWSER_GUIDE]) {
        expect(getIngestionKeyFormFields(options).map(fieldKey)).not.toContain(
          "keyType",
        );
      }
    });

    test("the browser settings show on Settings only once Browser is picked", () => {
      const fields: Fields = getIngestionKeyFormFields(SETTINGS);

      for (const key of ["allowedOrigins", "pinnedServiceName"]) {
        const field: ModelField<TelemetryIngestionKey> = fieldNamed(
          fields,
          key,
        );
        expect(
          field.showIf?.({ keyType: TelemetryIngestionKeyType.Server }),
        ).toBe(false);
        expect(
          field.showIf?.({ keyType: TelemetryIngestionKeyType.Browser }),
        ).toBe(true);
      }

      // A guide that makes Browser keys shows them from the start.
      for (const field of getIngestionKeyFormFields(BROWSER_GUIDE)) {
        expect(field.showIf).toBeUndefined();
      }
    });
  });

  describe("the name", () => {
    test("starts as what the door says the key is for", () => {
      expect(
        fieldNamed(getIngestionKeyFormFields(SERVER_GUIDE), "name")
          .defaultValue,
      ).toBe("Kubernetes key");
      expect(
        fieldNamed(getIngestionKeyFormFields(BROWSER_GUIDE), "name")
          .defaultValue,
      ).toBe("RUM key");
    });

    test("on Settings, starts as the type's name: a Server key", () => {
      expect(
        fieldNamed(getIngestionKeyFormFields(SETTINGS), "name").defaultValue,
      ).toBe("Server key");
      expect(getDefaultIngestionKeyName(undefined)).toBe("Server key");
      expect(getDefaultIngestionKeyName(TelemetryIngestionKeyType.Server)).toBe(
        SERVER_INGESTION_KEY_NAME,
      );
      expect(
        getDefaultIngestionKeyName(TelemetryIngestionKeyType.Browser),
      ).toBe(BROWSER_INGESTION_KEY_NAME);
    });

    test("a pinned type without a name of the door's own starts as that type's name", () => {
      expect(
        fieldNamed(
          getIngestionKeyFormFields({
            keyType: TelemetryIngestionKeyType.Browser,
          }),
          "name",
        ).defaultValue,
      ).toBe("Browser key");
    });

    test("is required, at least two characters", () => {
      const fields: Fields = getIngestionKeyFormFields(SERVER_GUIDE);

      expect(validate(fields, {})["name"]).toBe("Name is required.");
      expect(validate(fields, { name: "A" })["name"]).toMatch(
        /Name cannot be less than 2/,
      );
      expect(validate(fields, { name: "Kubernetes key" })).toEqual({});
    });

    test.each([
      // [name now, picked before, picked now, name after]
      ["Server key", "Server", "Browser", "Browser key"],
      ["Browser key", "Browser", "Server", "Server key"],
      ["", "Server", "Browser", "Browser key"],
      ["   ", "Browser", "Server", "Server key"],
      [undefined, "Server", "Browser", "Browser key"],
      ["Storefront", "Server", "Browser", null],
      ["Server key 2", "Server", "Browser", null],
      // A type name typed by hand that is not the type picked before.
      ["Browser key", "Server", "Browser", null],
      ["Server key", "Server", "Server", null],
    ])(
      "the name %j, with %s switched to %s, becomes %j",
      (
        name: string | undefined,
        previousKeyType: string,
        keyType: string,
        expected: string | null,
      ) => {
        expect(
          getIngestionKeyNameAfterTypeChange({
            name,
            previousKeyType,
            keyType,
          }),
        ).toBe(expected);
      },
    );

    test("follows the type picked on Settings until a name of one's own is typed", () => {
      const fields: Fields = getIngestionKeyFormFields(SETTINGS);
      let values: FormValues<TelemetryIngestionKey> = {
        name: "Server key",
        keyType: TelemetryIngestionKeyType.Server,
      };

      values = pickKeyType(fields, values, TelemetryIngestionKeyType.Browser);
      expect(values.name).toBe("Browser key");

      values = pickKeyType(fields, values, TelemetryIngestionKeyType.Server);
      expect(values.name).toBe("Server key");

      values = { ...values, name: "Storefront" };
      values = pickKeyType(fields, values, TelemetryIngestionKeyType.Browser);
      expect(values.name).toBe("Storefront");

      values = { ...values, name: "" };
      values = pickKeyType(fields, values, TelemetryIngestionKeyType.Server);
      expect(values.name).toBe("Server key");
    });

    test("a door's own name never follows the type", () => {
      const fields: Fields = getIngestionKeyFormFields({
        keyName: "Kubernetes key",
      });
      const values: FormValues<TelemetryIngestionKey> = pickKeyType(
        fields,
        { name: "Kubernetes key", keyType: TelemetryIngestionKeyType.Server },
        TelemetryIngestionKeyType.Browser,
      );

      expect(values.name).toBe("Kubernetes key");
    });

    test.each([
      ["Kubernetes key", [], "Kubernetes key"],
      ["Kubernetes key", ["Docker key"], "Kubernetes key"],
      ["Kubernetes key", ["Kubernetes key"], "Kubernetes key 2"],
      ["Kubernetes key", [" kubernetes KEY "], "Kubernetes key 2"],
      [
        "Kubernetes key",
        ["Kubernetes key", "Kubernetes key 2"],
        "Kubernetes key 3",
      ],
      [
        "Kubernetes key",
        ["Kubernetes key", "Kubernetes key 3"],
        "Kubernetes key 2",
      ],
      [
        "Kubernetes key",
        [null, undefined, "", "Kubernetes key"],
        "Kubernetes key 2",
      ],
    ])(
      "%j among %j is named %j",
      (
        name: string,
        existingNames: Array<string | null | undefined>,
        expected: string,
      ) => {
        expect(getUniqueIngestionKeyName({ name, existingNames })).toBe(
          expected,
        );
      },
    );

    test("numbering always finds a free name", () => {
      const existingNames: Array<string> = ["Queues key"];
      for (let number: number = 2; number <= 40; number++) {
        existingNames.push(`Queues key ${number}`);
      }

      expect(
        getUniqueIngestionKeyName({ name: "Queues key", existingNames }),
      ).toBe("Queues key 41");
    });
  });

  describe("allowed origins", () => {
    const ORIGINS: string =
      '["https://app.example.com", "app://com.example.mobile"]';

    test.each([SETTINGS, BROWSER_GUIDE])(
      "are required on a Browser key and checked before the submit (%#)",
      (options: IngestionKeyFormOptions) => {
        const fields: Fields = getIngestionKeyFormFields(options);
        const browser: FormValues<TelemetryIngestionKey> = {
          name: "Browser key",
          keyType: TelemetryIngestionKeyType.Browser,
        };

        expect(validate(fields, browser)["allowedOrigins"]).toBe(
          "Allowed Origins is required.",
        );

        for (const [value, error] of [
          ['["https://app.example.com"', /not valid JSON/],
          ["[]", /at least one allowed origin/],
          [
            '{"origin":"https://app.example.com"}',
            /at least one allowed origin/,
          ],
          ['["https://app.example.com", 17]', /must be text/],
          ['["https://app.example.com/path"]', /must not contain a path/],
        ] as Array<[string, RegExp]>) {
          expect(
            validate(fields, { ...browser, allowedOrigins: value as never })[
              "allowedOrigins"
            ],
          ).toMatch(error);
        }

        expect(
          validate(fields, { ...browser, allowedOrigins: ORIGINS as never }),
        ).toEqual({});
      },
    );

    test("are not asked of a Server key on Settings", () => {
      expect(
        validate(getIngestionKeyFormFields(SETTINGS), {
          name: "Server key",
          keyType: TelemetryIngestionKeyType.Server,
          allowedOrigins: "[" as never,
        }),
      ).toEqual({});
    });
  });

  describe("picking Server", () => {
    test("drops a Browser key's drafts", () => {
      const values: FormValues<TelemetryIngestionKey> = pickKeyType(
        getIngestionKeyFormFields(SETTINGS),
        {
          name: "Storefront",
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: '["https://app.example.com"' as never,
          pinnedServiceName: "storefront-web",
        },
        TelemetryIngestionKeyType.Server,
      );

      expect(values.allowedOrigins).toBeUndefined();
      expect(values.pinnedServiceName).toBeUndefined();
      expect(values.name).toBe("Storefront");
      expect(values.keyType).toBe(TelemetryIngestionKeyType.Server);
    });

    test("picking Browser keeps what is there", () => {
      const values: FormValues<TelemetryIngestionKey> = pickKeyType(
        getIngestionKeyFormFields(SETTINGS),
        { name: "Server key", keyType: TelemetryIngestionKeyType.Server },
        TelemetryIngestionKeyType.Browser,
      );

      expect(values).toEqual({
        name: "Browser key",
        keyType: TelemetryIngestionKeyType.Browser,
      });
    });
  });

  describe("the request", () => {
    function key(data: Partial<TelemetryIngestionKey>): TelemetryIngestionKey {
      const item: TelemetryIngestionKey = new TelemetryIngestionKey();
      Object.assign(item, data);
      return item;
    }

    test("a guide's key is of the guide's type, whatever the form held", () => {
      expect(
        prepareIngestionKeyForCreate(
          key({ name: "RUM key", keyType: TelemetryIngestionKeyType.Server }),
          BROWSER_GUIDE,
        ).keyType,
      ).toBe(TelemetryIngestionKeyType.Browser);
      expect(
        prepareIngestionKeyForCreate(
          key({ name: "Kubernetes key" }),
          SERVER_GUIDE,
        ).keyType,
      ).toBe(TelemetryIngestionKeyType.Server);
    });

    test("a Server key carries nothing of a Browser key's settings", () => {
      const item: TelemetryIngestionKey = prepareIngestionKeyForCreate(
        key({
          name: "Server key",
          keyType: TelemetryIngestionKeyType.Server,
          allowedOrigins: ["https://app.example.com"],
          pinnedServiceName: "storefront-web",
        }),
        SETTINGS,
      );

      expect(item.allowedOrigins).toBeUndefined();
      expect(item.pinnedServiceName).toBeUndefined();
      expect(item.name).toBe("Server key");
    });

    test("a Browser key keeps its origins and pinned service", () => {
      const item: TelemetryIngestionKey = prepareIngestionKeyForCreate(
        key({
          name: "Browser key",
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: ["https://app.example.com"],
          pinnedServiceName: "storefront-web",
        }),
        SETTINGS,
      );

      expect(item.allowedOrigins).toEqual(["https://app.example.com"]);
      expect(item.pinnedServiceName).toBe("storefront-web");
      expect(isBrowserIngestionKey({ keyType: item.keyType })).toBe(true);
    });
  });
});
