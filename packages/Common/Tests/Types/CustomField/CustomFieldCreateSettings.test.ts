import {
  CUSTOM_FIELD_CREATE_SETTINGS,
  CUSTOM_FIELD_CREATE_SETTINGS_MAX_ENTRIES,
  CustomFieldCreateSetting,
  CustomFieldCreateSettings,
  applyTemplateCustomFieldCreateSettings,
  compactCustomFieldCreateSettings,
  getCustomFieldCreateSetting,
  getEffectiveCustomFieldCreateSetting,
  isCustomFieldCreateSetting,
  readCustomFieldCreateSettings,
  validateCustomFieldCreateSettings,
} from "../../../Types/CustomField/CustomFieldCreateSettings";
import { sortCustomFieldDefinitions } from "../../../Types/CustomField/CustomFieldOrder";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH } from "../../../Types/CustomField/CustomFieldVariableKey";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A template's say over which incident custom fields are asked
 * when an incident is declared, and which must be filled in (issue #4114).
 *
 * What matters most here:
 *
 *   - the server refuses a malformed value and never rewrites a good one
 *     (Terraform compares the column with its configuration);
 *   - a TEMPLATE only overrides: Default and unlisted fields keep their own
 *     Show on Create / Required on Create;
 *   - nothing here changes the definitions it is handed.
 */

interface Definition {
  name: string;
  variableKey?: string | null | undefined;
  showOnCreate?: boolean | null | undefined;
  isRequiredOnCreate?: boolean | null | undefined;
  sortOrder?: number | null | undefined;
  customFieldType?: CustomFieldType | undefined;
  description?: string | undefined;
  dropdownOptions?: string | undefined;
  mapFromResourceType?: string | undefined;
}

type DefinitionFunction = (
  name: string,
  variableKey: string | null | undefined,
  switches?: {
    showOnCreate?: boolean | null | undefined;
    isRequiredOnCreate?: boolean | null | undefined;
    sortOrder?: number | null | undefined;
  },
) => Definition;

const definition: DefinitionFunction = (
  name: string,
  variableKey: string | null | undefined,
  switches: {
    showOnCreate?: boolean | null | undefined;
    isRequiredOnCreate?: boolean | null | undefined;
    sortOrder?: number | null | undefined;
  } = {},
): Definition => {
  return {
    name: name,
    variableKey: variableKey,
    customFieldType: CustomFieldType.Text,
    ...switches,
  };
};

// The project's fields, one of each project-wide behaviour.
type ProjectFieldsFunction = () => Array<Definition>;

const projectFields: ProjectFieldsFunction = (): Array<Definition> => {
  return [
    definition("Impact", "impact", {
      showOnCreate: true,
      isRequiredOnCreate: true,
      sortOrder: 1,
    }),
    definition("Affected Location", "affected_location", {
      showOnCreate: true,
      isRequiredOnCreate: false,
      sortOrder: 2,
    }),
    definition("Additional Information", "additional_information", {
      showOnCreate: false,
      isRequiredOnCreate: false,
      sortOrder: 3,
    }),
    definition("Customer", "customer", {}),
  ];
};

type DeepFreezeFunction = <T>(value: T) => T;

// Frozen inputs make any write to them throw (modules run in strict mode).
const deepFreeze: DeepFreezeFunction = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const child of Object.values(
      value as unknown as Record<string, unknown>,
    )) {
      deepFreeze(child);
    }

    Object.freeze(value);
  }

  return value;
};

type NamesFunction = (definitions: Array<{ name: string }>) => Array<string>;

const names: NamesFunction = (
  definitions: Array<{ name: string }>,
): Array<string> => {
  return definitions.map((entry: { name: string }): string => {
    return entry.name;
  });
};

type SwitchesFunction = (definitions: Array<Definition>) => Array<{
  name: string;
  showOnCreate: boolean | null | undefined;
  isRequiredOnCreate: boolean | null | undefined;
}>;

const switchesOf: SwitchesFunction = (
  definitions: Array<Definition>,
): Array<{
  name: string;
  showOnCreate: boolean | null | undefined;
  isRequiredOnCreate: boolean | null | undefined;
}> => {
  return definitions.map(
    (
      entry: Definition,
    ): {
      name: string;
      showOnCreate: boolean | null | undefined;
      isRequiredOnCreate: boolean | null | undefined;
    } => {
      return {
        name: entry.name,
        showOnCreate: entry.showOnCreate,
        isRequiredOnCreate: entry.isRequiredOnCreate,
      };
    },
  );
};

const NOT_SETTINGS: Array<[string, unknown]> = [
  ["an array", ["impact"]],
  ["an empty array", []],
  ["a JSON string", '{"impact":"Required"}'],
  ["a string", "Required"],
  ["a number", 5],
  ["true", true],
  ["false", false],
  ["a date", new Date("2026-01-01T00:00:00.000Z")],
];

describe("CustomFieldCreateSetting", () => {
  test("stores the four settings under these exact strings", () => {
    /*
     * They are what the JSON column holds and what API, MCP and Terraform
     * users write: renaming one would strand every stored value.
     */
    expect(CustomFieldCreateSetting.Default).toBe("Default");
    expect(CustomFieldCreateSetting.Required).toBe("Required");
    expect(CustomFieldCreateSetting.Optional).toBe("Optional");
    expect(CustomFieldCreateSetting.Hidden).toBe("Hidden");
    expect(Object.values(CustomFieldCreateSetting)).toHaveLength(4);
  });

  test("lists every setting once, Default first, for a picker", () => {
    expect(CUSTOM_FIELD_CREATE_SETTINGS).toEqual([
      CustomFieldCreateSetting.Default,
      CustomFieldCreateSetting.Required,
      CustomFieldCreateSetting.Optional,
      CustomFieldCreateSetting.Hidden,
    ]);
    expect([...CUSTOM_FIELD_CREATE_SETTINGS].sort()).toEqual(
      Object.values(CustomFieldCreateSetting).sort(),
    );
  });

  test("allows one entry per field a project can hold", () => {
    expect(CUSTOM_FIELD_CREATE_SETTINGS_MAX_ENTRIES).toBe(LIMIT_PER_PROJECT);
    expect(CUSTOM_FIELD_CREATE_SETTINGS_MAX_ENTRIES).toBe(10000);
  });
});

describe("isCustomFieldCreateSetting", () => {
  test.each(Object.values(CustomFieldCreateSetting))(
    "%s is a setting",
    (setting: string) => {
      expect(isCustomFieldCreateSetting(setting)).toBe(true);
    },
  );

  test.each([
    "required",
    "REQUIRED",
    " Required",
    "Required ",
    "optional",
    "hidden",
    "default",
    "",
    "NotAsked",
    "Not Asked",
    "Shown",
  ])("%j is not: only the exact spelling is stored", (value: string) => {
    expect(isCustomFieldCreateSetting(value)).toBe(false);
  });

  test.each([[null], [undefined], [1], [true], [{}], [["Required"]]])(
    "%j is not a setting",
    (value: unknown) => {
      expect(isCustomFieldCreateSetting(value)).toBe(false);
    },
  );
});

describe("validateCustomFieldCreateSettings: what the API accepts", () => {
  test("no value at all is fine: it clears the settings", () => {
    expect(validateCustomFieldCreateSettings(null)).toBeNull();
    expect(validateCustomFieldCreateSettings(undefined)).toBeNull();
  });

  test("an empty object is fine: every field is Default", () => {
    expect(validateCustomFieldCreateSettings({})).toBeNull();
  });

  test("every setting, on valid keys, is fine", () => {
    expect(
      validateCustomFieldCreateSettings({
        impact: "Required",
        affected_location: "Optional",
        additional_information: "Hidden",
        customer: "Default",
        "2fa_status": "Required",
        severity_2: "Optional",
      }),
    ).toBeNull();
  });

  test("a key as long as a template variable key may be is fine; one longer is not", () => {
    const longest: string = "a".repeat(CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH);
    const tooLong: string = "a".repeat(
      CUSTOM_FIELD_VARIABLE_KEY_MAX_LENGTH + 1,
    );

    expect(validateCustomFieldCreateSettings({ [longest]: "Required" })).toBe(
      null,
    );
    expect(
      validateCustomFieldCreateSettings({ [tooLong]: "Required" }),
    ).toContain("is not an incident custom field's template variable key");
  });

  /*
   * A field named "Constructor" is given the key "constructor", which is a
   * perfectly good key - and one that plain-object lookups trip over.
   */
  test.each(["constructor", "hasownproperty", "prototype", "valueof"])(
    "the key %j is a valid key like any other",
    (key: string) => {
      expect(validateCustomFieldCreateSettings({ [key]: "Hidden" })).toBeNull();
    },
  );

  test.each([
    ["Impact", "uppercase"],
    ["affected location", "a space"],
    ["affected-location", "a hyphen"],
    ["_impact", "a leading underscore"],
    ["impact_", "a trailing underscore"],
    ["impact__level", "a doubled underscore"],
    ["customFields.impact", "the template placeholder"],
    ["{{customFields.impact}}", "a whole placeholder"],
    ["", "nothing"],
    ["__proto__", "the prototype key"],
    ["ímpact", "an accent"],
    ["影响", "another script"],
  ])(
    "refuses the key %j (%s): it is not a template variable key",
    (key: string) => {
      const message: string | null = validateCustomFieldCreateSettings(
        JSON.parse(JSON.stringify({ [key]: "Required" })),
      );

      expect(message).toContain(`"${key}"`);
      expect(message).toContain(
        "is not an incident custom field's template variable key",
      );
      expect(message).toContain('"affected_location"');
    },
  );

  test.each([
    ["required"],
    ["REQUIRED"],
    [" Required"],
    ["Mandatory"],
    ["Not Asked"],
    [""],
    [null],
    [true],
    [1],
    [{}],
    [["Required"]],
  ])(
    "refuses the setting %j: only Required, Optional, Hidden or Default",
    (setting: unknown) => {
      const message: string | null = validateCustomFieldCreateSettings({
        impact: setting,
      });

      expect(message).toContain('The setting for "impact"');
      expect(message).toContain(
        "must be Required, Optional, Hidden or Default",
      );
      expect(message).toContain(`but was sent "`);
    },
  );

  test.each(NOT_SETTINGS)(
    "refuses %s: the settings are an object keyed by template variable key",
    (_label: string, value: unknown) => {
      const message: string | null = validateCustomFieldCreateSettings(value);

      expect(message).toContain(
        "Custom Field Settings must be an object that maps each incident custom field's template variable key to Required, Optional, Hidden or Default",
      );
      expect(message).toContain('{"impact": "Required"}');
    },
  );

  test("reports every problem at once, bounded to five", () => {
    const five: string | null = validateCustomFieldCreateSettings({
      a: "x1",
      b: "x2",
      c: "x3",
      d: "x4",
      e: "x5",
    });

    for (const value of ["x1", "x2", "x3", "x4", "x5"]) {
      expect(five).toContain(`"${value}"`);
    }
    expect(five).not.toContain("not valid either");

    const six: string | null = validateCustomFieldCreateSettings({
      a: "x1",
      b: "x2",
      c: "x3",
      d: "x4",
      e: "x5",
      f: "x6",
    });

    expect(six).not.toContain('"x6"');
    expect(six).toContain("1 more entry is not valid either.");

    const seven: string | null = validateCustomFieldCreateSettings({
      a: "x1",
      b: "x2",
      c: "x3",
      d: "x4",
      e: "x5",
      f: "x6",
      g: "x7",
    });

    expect(seven).toContain("2 more entries are not valid either.");
  });

  test("valid entries next to invalid ones are not mentioned", () => {
    const message: string | null = validateCustomFieldCreateSettings({
      impact: "Required",
      customer: "Sometimes",
    });

    expect(message).toContain('"customer"');
    expect(message).not.toContain('"impact"');
  });

  test("quotes a pasted essay back cut short", () => {
    const essay: string = "x".repeat(500);

    const message: string = validateCustomFieldCreateSettings({
      impact: essay,
    })!;

    expect(message).toContain(`"${"x".repeat(80)}..."`);
    expect(message).not.toContain("x".repeat(81));
  });

  test("never throws on values JSON cannot quote", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    expect(validateCustomFieldCreateSettings({ impact: circular })).toContain(
      'The setting for "impact"',
    );
    expect(validateCustomFieldCreateSettings({ impact: BigInt(10) })).toContain(
      'but was sent "10"',
    );
    expect(
      validateCustomFieldCreateSettings({ impact: Symbol("x") }),
    ).toContain('but was sent "Symbol(x)"');
    expect(validateCustomFieldCreateSettings({ impact: undefined })).toContain(
      'but was sent "undefined"',
    );
  });

  test("a settings object with one entry per possible field is fine; one more is not", () => {
    const full: Record<string, string> = {};

    for (let index: number = 0; index < LIMIT_PER_PROJECT; index++) {
      full[`field_${index}`] = "Optional";
    }

    expect(validateCustomFieldCreateSettings(full)).toBeNull();

    full[`field_${LIMIT_PER_PROJECT}`] = "Optional";

    expect(validateCustomFieldCreateSettings(full)).toBe(
      `Custom Field Settings can list at most ${LIMIT_PER_PROJECT} fields, but lists ${
        LIMIT_PER_PROJECT + 1
      }.`,
    );
  });

  test("judges without rewriting: the value is left exactly as it was sent", () => {
    const sent: Record<string, unknown> = deepFreeze({
      impact: "Required",
      customer: "Default",
      Broken: "nope",
    });
    const before: string = JSON.stringify(sent);

    expect(validateCustomFieldCreateSettings(sent)).not.toBeNull();
    expect(JSON.stringify(sent)).toBe(before);
  });

  test("an inherited key is not an entry", () => {
    const inherited: Record<string, unknown> = Object.create({
      Impact: "Mandatory",
    }) as Record<string, unknown>;

    expect(validateCustomFieldCreateSettings(inherited)).toBeNull();
  });
});

describe("readCustomFieldCreateSettings: the lenient reader", () => {
  test.each([["null", null], ["undefined", undefined], ...NOT_SETTINGS])(
    "reads %s as no settings",
    (_label: string, value: unknown) => {
      expect(readCustomFieldCreateSettings(value)).toEqual({});
    },
  );

  test("keeps every valid entry, Default included, and drops the rest", () => {
    expect(
      readCustomFieldCreateSettings({
        impact: "Required",
        affected_location: "Optional",
        additional_information: "Hidden",
        customer: "Default",
        Broken_Key: "Required",
        status: "required",
        region: 5,
        owner: null,
      }),
    ).toEqual({
      impact: CustomFieldCreateSetting.Required,
      affected_location: CustomFieldCreateSetting.Optional,
      additional_information: CustomFieldCreateSetting.Hidden,
      customer: CustomFieldCreateSetting.Default,
    });
  });

  test("returns a new object: changing it does not change the stored value", () => {
    const stored: Record<string, unknown> = { impact: "Required" };

    const read: CustomFieldCreateSettings =
      readCustomFieldCreateSettings(stored);

    read["impact"] = CustomFieldCreateSetting.Hidden;

    expect(stored).toEqual({ impact: "Required" });
  });

  test("reads the key constructor as an ordinary entry", () => {
    expect(readCustomFieldCreateSettings({ constructor: "Hidden" })).toEqual({
      constructor: CustomFieldCreateSetting.Hidden,
    });
  });

  test("never throws on a frozen or odd value", () => {
    expect(
      readCustomFieldCreateSettings(deepFreeze({ impact: "Optional" })),
    ).toEqual({ impact: CustomFieldCreateSetting.Optional });
    expect(readCustomFieldCreateSettings(Object.create(null))).toEqual({});
  });
});

describe("getCustomFieldCreateSetting", () => {
  const settings: Record<string, unknown> = {
    impact: "Required",
    affected_location: "Optional",
    additional_information: "Hidden",
    customer: "Default",
    status: "Mandatory",
  };

  test.each([
    ["impact", CustomFieldCreateSetting.Required],
    ["affected_location", CustomFieldCreateSetting.Optional],
    ["additional_information", CustomFieldCreateSetting.Hidden],
    ["customer", CustomFieldCreateSetting.Default],
  ])("%s is %s", (key: string, expected: CustomFieldCreateSetting) => {
    expect(getCustomFieldCreateSetting(settings, key)).toBe(expected);
  });

  test("a field that is not listed is Default", () => {
    expect(getCustomFieldCreateSetting(settings, "region")).toBe(
      CustomFieldCreateSetting.Default,
    );
  });

  test("a listed field with an invalid setting is Default", () => {
    expect(getCustomFieldCreateSetting(settings, "status")).toBe(
      CustomFieldCreateSetting.Default,
    );
  });

  test.each([[undefined], [null], [""]])(
    "a field with no key (%j) is Default, whatever the settings list",
    (key: string | null | undefined) => {
      expect(getCustomFieldCreateSetting({ "": "Required" }, key)).toBe(
        CustomFieldCreateSetting.Default,
      );
    },
  );

  test("an invalid key is Default even when a raw value lists it", () => {
    expect(getCustomFieldCreateSetting({ Impact: "Required" }, "Impact")).toBe(
      CustomFieldCreateSetting.Default,
    );
  });

  test.each([["null", null], ["undefined", undefined], ...NOT_SETTINGS])(
    "with %s as the settings every field is Default",
    (_label: string, value: unknown) => {
      expect(getCustomFieldCreateSetting(value, "impact")).toBe(
        CustomFieldCreateSetting.Default,
      );
    },
  );

  test("regression: a field keyed constructor that is not listed is Default, not Object.prototype.constructor", () => {
    expect(getCustomFieldCreateSetting({}, "constructor")).toBe(
      CustomFieldCreateSetting.Default,
    );
    expect(getCustomFieldCreateSetting({}, "valueof")).toBe(
      CustomFieldCreateSetting.Default,
    );
    expect(
      getCustomFieldCreateSetting({ constructor: "Required" }, "constructor"),
    ).toBe(CustomFieldCreateSetting.Required);
  });

  test("an inherited entry does not count", () => {
    expect(
      getCustomFieldCreateSetting(
        Object.create({ impact: "Required" }) as Record<string, unknown>,
        "impact",
      ),
    ).toBe(CustomFieldCreateSetting.Default);
  });
});

describe("getEffectiveCustomFieldCreateSetting: what the Details step does with a field", () => {
  test.each([
    [true, true, CustomFieldCreateSetting.Required],
    [true, false, CustomFieldCreateSetting.Optional],
    [true, undefined, CustomFieldCreateSetting.Optional],
    [false, false, CustomFieldCreateSetting.Hidden],
    [undefined, undefined, CustomFieldCreateSetting.Hidden],
    [null, null, CustomFieldCreateSetting.Hidden],
    /*
     * Required on Create without Show on Create asks for nothing: the
     * Declare Incident form only puts shown fields on its Details step.
     */
    [false, true, CustomFieldCreateSetting.Hidden],
  ])(
    "with no settings, Show on Create %j and Required on Create %j make the field %s",
    (
      showOnCreate: boolean | null | undefined,
      isRequiredOnCreate: boolean | null | undefined,
      expected: CustomFieldCreateSetting,
    ) => {
      expect(
        getEffectiveCustomFieldCreateSetting(
          definition("Impact", "impact", { showOnCreate, isRequiredOnCreate }),
        ),
      ).toBe(expected);
    },
  );

  test.each([
    [CustomFieldCreateSetting.Required, false, false],
    [CustomFieldCreateSetting.Optional, true, true],
    [CustomFieldCreateSetting.Hidden, true, true],
  ])(
    "a template's %s beats the field's own switches",
    (
      setting: CustomFieldCreateSetting,
      showOnCreate: boolean,
      isRequiredOnCreate: boolean,
    ) => {
      expect(
        getEffectiveCustomFieldCreateSetting(
          definition("Impact", "impact", { showOnCreate, isRequiredOnCreate }),
          { impact: setting },
        ),
      ).toBe(setting);
    },
  );

  test("Default, or an invalid entry, leaves the field's own switches in charge", () => {
    const required: Definition = definition("Impact", "impact", {
      showOnCreate: true,
      isRequiredOnCreate: true,
    });

    expect(
      getEffectiveCustomFieldCreateSetting(required, { impact: "Default" }),
    ).toBe(CustomFieldCreateSetting.Required);
    expect(
      getEffectiveCustomFieldCreateSetting(required, { impact: "hidden" }),
    ).toBe(CustomFieldCreateSetting.Required);
  });

  test("a field with no key cannot be overridden", () => {
    expect(
      getEffectiveCustomFieldCreateSetting(
        definition("Impact", undefined, { showOnCreate: true }),
        { impact: "Hidden" },
      ),
    ).toBe(CustomFieldCreateSetting.Optional);
  });
});

describe("applyTemplateCustomFieldCreateSettings: a template only overrides", () => {
  test("Required, Optional and Hidden set both switches; Default and unlisted fields keep theirs", () => {
    const applied: Array<Definition> = applyTemplateCustomFieldCreateSettings(
      projectFields(),
      {
        impact: "Optional",
        affected_location: "Hidden",
        additional_information: "Required",
        customer: "Default",
      },
    );

    expect(switchesOf(applied)).toEqual([
      { name: "Impact", showOnCreate: true, isRequiredOnCreate: false },
      {
        name: "Affected Location",
        showOnCreate: false,
        isRequiredOnCreate: false,
      },
      {
        name: "Additional Information",
        showOnCreate: true,
        isRequiredOnCreate: true,
      },
      {
        name: "Customer",
        showOnCreate: undefined,
        isRequiredOnCreate: undefined,
      },
    ]);
  });

  test("with no settings every field is left as the project has it", () => {
    for (const settings of [undefined, null, {}, [], "Required"]) {
      expect(
        applyTemplateCustomFieldCreateSettings(projectFields(), settings),
      ).toEqual(projectFields());
    }
  });

  test("an invalid entry leaves its field as the project has it", () => {
    expect(
      switchesOf(
        applyTemplateCustomFieldCreateSettings(projectFields(), {
          impact: "hidden",
          affected_location: 1,
        }),
      ),
    ).toEqual(switchesOf(projectFields()));
  });

  test("a field with no key is never overridden", () => {
    const fields: Array<Definition> = [
      definition("Legacy", undefined, { showOnCreate: true }),
      definition("Legacy Null", null, { showOnCreate: true }),
    ];

    expect(
      applyTemplateCustomFieldCreateSettings(fields, { legacy: "Hidden" }),
    ).toEqual(fields);
  });

  test("keeps the order it was given: ordering is the caller's", () => {
    const fields: Array<Definition> = [
      definition("Third", "third", { sortOrder: 3 }),
      definition("First", "first", { sortOrder: 1 }),
      definition("Unordered", "unordered"),
    ];

    expect(
      names(
        applyTemplateCustomFieldCreateSettings(fields, { first: "Required" }),
      ),
    ).toEqual(["Third", "First", "Unordered"]);
  });

  test("keeps everything else about each field", () => {
    const field: Definition = {
      ...definition("Region", "region", { sortOrder: 4 }),
      customFieldType: CustomFieldType.Dropdown,
      description: "Where it happened",
      dropdownOptions: "EU\nUS",
      mapFromResourceType: "Monitor",
    };

    expect(
      applyTemplateCustomFieldCreateSettings([field], { region: "Required" }),
    ).toEqual([{ ...field, showOnCreate: true, isRequiredOnCreate: true }]);
  });

  test("returns new objects and never touches the definitions it is given", () => {
    const fields: Array<Definition> = deepFreeze(projectFields());
    const settings: Record<string, unknown> = deepFreeze({
      impact: "Hidden",
      customer: "Required",
      affected_location: "Default",
    });

    const applied: Array<Definition> = applyTemplateCustomFieldCreateSettings(
      fields,
      settings,
    );

    expect(applied).not.toBe(fields);

    for (let index: number = 0; index < fields.length; index++) {
      expect(applied[index]).not.toBe(fields[index]);
    }

    expect(fields).toEqual(projectFields());
  });

  test("a model instance comes back as an instance of its own class", () => {
    class FieldRow {
      public name: string = "Impact";
      public variableKey: string = "impact";
      public showOnCreate: boolean = false;
      public isRequiredOnCreate: boolean = false;

      public describe(): string {
        return `${this.name}: ${this.showOnCreate ? "shown" : "not shown"}`;
      }
    }

    const [applied] = applyTemplateCustomFieldCreateSettings([new FieldRow()], {
      impact: "Required",
    });

    expect(applied).toBeInstanceOf(FieldRow);
    expect(applied!.describe()).toBe("Impact: shown");
  });

  test("fed to the Details step's own filter, it asks exactly the fields the template wants", () => {
    // The dashboard's getDetailsStepDefinitions: shown fields, in order.
    const detailsStep: Array<Definition> = sortCustomFieldDefinitions(
      applyTemplateCustomFieldCreateSettings(projectFields(), {
        impact: "Hidden",
        customer: "Optional",
      }).filter((field: Definition): boolean => {
        return field.showOnCreate === true;
      }),
    );

    expect(switchesOf(detailsStep)).toEqual([
      {
        name: "Affected Location",
        showOnCreate: true,
        isRequiredOnCreate: false,
      },
      { name: "Customer", showOnCreate: true, isRequiredOnCreate: false },
    ]);
  });

  test("agrees with getEffectiveCustomFieldCreateSetting for every combination", () => {
    const behaviours: Array<{
      showOnCreate: boolean | undefined;
      isRequiredOnCreate: boolean | undefined;
    }> = [
      { showOnCreate: true, isRequiredOnCreate: true },
      { showOnCreate: true, isRequiredOnCreate: false },
      { showOnCreate: false, isRequiredOnCreate: true },
      { showOnCreate: false, isRequiredOnCreate: false },
      { showOnCreate: undefined, isRequiredOnCreate: undefined },
    ];

    for (const behaviour of behaviours) {
      for (const setting of [...CUSTOM_FIELD_CREATE_SETTINGS, undefined]) {
        const field: Definition = definition("Impact", "impact", behaviour);
        const settings: Record<string, unknown> = setting
          ? { impact: setting }
          : {};

        const [applied] = applyTemplateCustomFieldCreateSettings(
          [field],
          settings,
        );

        // What the applied switches make of the field, with no settings.
        expect({
          behaviour,
          setting,
          effect: getEffectiveCustomFieldCreateSetting(applied!),
        }).toEqual({
          behaviour,
          setting,
          effect: getEffectiveCustomFieldCreateSetting(field, settings),
        });
      }
    }
  });
});

describe("compactCustomFieldCreateSettings: the smallest value that means the same", () => {
  test("drops Default entries and invalid ones, keeps the rest", () => {
    expect(
      compactCustomFieldCreateSettings({
        impact: "Required",
        affected_location: "Optional",
        additional_information: "Hidden",
        customer: "Default",
        Broken: "Required",
        status: "nope",
      }),
    ).toEqual({
      impact: "Required",
      affected_location: "Optional",
      additional_information: "Hidden",
    });
  });

  test.each([["null", null], ["undefined", undefined], ...NOT_SETTINGS])(
    "compacts %s to no settings",
    (_label: string, value: unknown) => {
      expect(compactCustomFieldCreateSettings(value)).toEqual({});
    },
  );

  test("returns a new object and leaves the one it was given alone", () => {
    const settings: Record<string, unknown> = deepFreeze({
      impact: "Required",
      customer: "Default",
    });

    const compacted: CustomFieldCreateSettings =
      compactCustomFieldCreateSettings(settings);

    expect(compacted).not.toBe(settings);
    expect(settings).toEqual({ impact: "Required", customer: "Default" });
  });

  test("a compacted value is one the server accepts, and means exactly the same", () => {
    const settings: Record<string, unknown> = {
      impact: "Hidden",
      affected_location: "Default",
      additional_information: "Required",
      customer: "Optional",
      region: "Default",
    };

    const compacted: CustomFieldCreateSettings =
      compactCustomFieldCreateSettings(settings);

    expect(validateCustomFieldCreateSettings(compacted)).toBeNull();

    expect(
      applyTemplateCustomFieldCreateSettings(projectFields(), compacted),
    ).toEqual(
      applyTemplateCustomFieldCreateSettings(projectFields(), settings),
    );
  });
});

// A relative import: another pure module of Common.
const RELATIVE_IMPORT: RegExp = /^\.\.?\//;

describe("the module stays pure", () => {
  test("imports nothing from React, the database, the server or the UI", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../Types/CustomField/CustomFieldCreateSettings.ts",
      ),
      "utf8",
    );

    const imports: Array<string> = Array.from(
      source.matchAll(/from\s+"([^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(imports.length).toBeGreaterThan(0);

    for (const imported of imports) {
      expect({ imported, pure: RELATIVE_IMPORT.test(imported) }).toEqual({
        imported,
        pure: true,
      });
      expect(imported).not.toMatch(/react|typeorm|Server|UI|Models/i);
    }
  });
});
