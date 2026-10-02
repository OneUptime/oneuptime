import { describe, expect, test } from "@jest/globals";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import {
  RULE_CRITERIA_MAX_FILTERS,
  RULE_CRITERIA_MAX_RELATION_VALUES,
  RULE_CRITERIA_MAX_STRING_LENGTH,
} from "../../../../Utils/Rules/RuleCriteriaMatcher";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import {
  changeRuleCriteriaFilterField,
  changeRuleCriteriaFilterOperator,
  convertLegacyValuesToRuleCriteria,
  createRuleCriteriaFilter,
  englishRuleCriteriaMessage,
  findRuleCriteriaField,
  formatRuleCriteriaMessage,
  getAvailableRuleCriteriaFields,
  getDefaultRuleCriteriaOperator,
  getEmptyRuleCriteriaValue,
  getLegacyRuleCriteriaOperator,
  getNextRuleCriteriaField,
  getRuleCriteriaFieldName,
  getRuleCriteriaFieldTitle,
  getRuleCriteriaFilterProblem,
  getRuleCriteriaFormProblem,
  getRuleCriteriaOperatorLabel,
  getRuleCriteriaOperatorsForField,
  getRuleCriteriaValuePlaceholder,
  isRuleCriteriaAddressRangeField,
  isRuleCriteriaArrayOperator,
  isRuleCriteriaPatternOperator,
  normalizeRuleCriteriaValue,
  RULE_CRITERIA_OPERATOR_LABELS,
  RuleCriteriaCopy,
  RuleCriteriaMessage,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaFields";

/*
 * What the conditions builder decides about a rule page's match fields:
 * which operators a field offers and what they are called, what a new
 * condition starts as, what survives a change of field or operator, and what
 * a person is told when a condition cannot be saved. The component, the rule
 * table's summary and the form's validation all read these answers.
 */

type Entity = Record<string, unknown>;

const MONITORS: Field<Entity> = {
  field: { monitors: true },
  title: "Monitors",
  fieldType: FormFieldSchemaType.MultiSelectDropdown,
  dropdownModal: { type: Monitor, labelField: "name", valueField: "_id" },
  placeholder: "Select Monitors (optional)",
};

const INCIDENT_LABELS: Field<Entity> = {
  field: { incidentLabels: true },
  title: "Incident Labels",
  fieldType: FormFieldSchemaType.MultiSelectDropdown,
  dropdownModal: { type: Label, labelField: "name", valueField: "_id" },
  placeholder: "Select Incident Labels (optional)",
};

const MONITOR_LABELS: Field<Entity> = {
  field: { monitorLabels: true },
  title: "Monitor Labels",
  fieldType: FormFieldSchemaType.MultiSelectDropdown,
  dropdownModal: { type: Label, labelField: "name", valueField: "_id" },
  placeholder: "Select Monitor Labels (optional)",
};

const INCIDENT_TITLE: Field<Entity> = {
  field: { incidentTitlePattern: true },
  title: "Incident Title",
  fieldType: FormFieldSchemaType.Text,
  placeholder: "CPU.*high",
};

const INCIDENT_DESCRIPTION: Field<Entity> = {
  field: { incidentDescriptionPattern: true },
  title: "Incident Description",
  fieldType: FormFieldSchemaType.Text,
  placeholder: "timeout|connection refused",
};

const MONITOR_TYPE: Field<Entity> = {
  field: { monitorType: true },
  title: "Monitor Type",
  fieldType: FormFieldSchemaType.Dropdown,
  dropdownOptions: [
    { label: "API", value: "API" },
    { label: "Website", value: "Website" },
  ],
  placeholder: "Select Monitor Type",
};

const IP_ADDRESS: Field<Entity> = {
  field: { ipMatchTarget: true },
  title: "IP Address",
  fieldType: FormFieldSchemaType.Text,
  placeholder: "192.168.1.0/24 or 10.16-22.0-255.51-66",
};

const SUBNET: Field<Entity> = {
  field: { subnetCidr: true },
  title: "IP Address",
  fieldType: FormFieldSchemaType.Text,
  placeholder: "10.42.7.0/24",
};

const SYSTEM_OBJECT_ID: Field<Entity> = {
  field: { sysObjectIdPattern: true },
  title: "System Object ID",
  fieldType: FormFieldSchemaType.Text,
  placeholder: "1.3.6.1.4.1.9.*",
};

const PORT: Field<Entity> = {
  field: { port: true },
  title: "Port",
  fieldType: FormFieldSchemaType.Port,
};

const ENABLED: Field<Entity> = {
  field: { isEnabled: true },
  title: "Enabled",
  fieldType: FormFieldSchemaType.Toggle,
};

const INCIDENT_FIELDS: Array<Field<Entity>> = [
  MONITORS,
  INCIDENT_LABELS,
  MONITOR_LABELS,
  INCIDENT_TITLE,
  INCIDENT_DESCRIPTION,
];

function filter(
  field: string,
  operator: RuleCriteriaOperator,
  value: RuleCriteriaFilter["value"],
): RuleCriteriaFilter {
  return { field, operator, value };
}

function criteria(
  filters: Array<RuleCriteriaFilter>,
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition,
    filters,
  };
}

describe("criteria names", () => {
  test("a field goes by its column, or the key a form overrides it with", () => {
    expect(getRuleCriteriaFieldName(INCIDENT_TITLE)).toBe(
      "incidentTitlePattern",
    );
    expect(
      getRuleCriteriaFieldName({
        overrideFieldKey: "customKey",
        field: { incidentTitlePattern: true },
      }),
    ).toBe("customKey");
    expect(getRuleCriteriaFieldName({ title: "No column" })).toBeNull();
  });

  test("a criterion is named by its field's title", () => {
    expect(
      getRuleCriteriaFieldTitle(INCIDENT_TITLE, "incidentTitlePattern"),
    ).toBe("Incident Title");
  });

  test.each([
    ["incidentTitlePattern", "Incident Title"],
    ["monitorDescriptionPattern", "Monitor Description"],
    ["nameRegexPattern", "Name"],
    ["descriptionRegexPattern", "Description"],
    ["messageQueueSystemPattern", "Message Queue System"],
    ["monitorLabels", "Monitor Labels"],
    ["hostname_pattern", "Hostname"],
  ])(
    "a field written without a title reads %s as %s, never with Pattern",
    (fieldName: string, expected: string) => {
      expect(getRuleCriteriaFieldTitle(undefined, fieldName)).toBe(expected);
      expect(
        getRuleCriteriaFieldTitle({ field: { [fieldName]: true } }, fieldName),
      ).toBe(expected);
    },
  );

  test("a column named only Pattern keeps its one word", () => {
    expect(getRuleCriteriaFieldTitle(undefined, "pattern")).toBe("Pattern");
  });
});

describe("operators", () => {
  test("a list field offers Has any of / all of / none of", () => {
    expect(getRuleCriteriaOperatorsForField(MONITORS)).toEqual([
      RuleCriteriaOperator.HasAnyOf,
      RuleCriteriaOperator.HasAllOf,
      RuleCriteriaOperator.HasNoneOf,
    ]);
  });

  test("a text field offers Contains first, then the rest of text matching", () => {
    expect(getRuleCriteriaOperatorsForField(INCIDENT_TITLE)).toEqual([
      RuleCriteriaOperator.Contains,
      RuleCriteriaOperator.DoesNotContain,
      RuleCriteriaOperator.Equals,
      RuleCriteriaOperator.NotEquals,
      RuleCriteriaOperator.StartsWith,
      RuleCriteriaOperator.EndsWith,
      RuleCriteriaOperator.MatchesPattern,
      RuleCriteriaOperator.DoesNotMatchPattern,
    ]);
  });

  test("a single choice offers Equals and Does not equal", () => {
    expect(getRuleCriteriaOperatorsForField(MONITOR_TYPE)).toEqual([
      RuleCriteriaOperator.Equals,
      RuleCriteriaOperator.NotEquals,
    ]);
    expect(getRuleCriteriaOperatorsForField(ENABLED)).toEqual([
      RuleCriteriaOperator.Equals,
      RuleCriteriaOperator.NotEquals,
    ]);
  });

  test.each([IP_ADDRESS, SUBNET, SYSTEM_OBJECT_ID])(
    "a field with a syntax of its own only takes patterns",
    (field: Field<Entity>) => {
      expect(getRuleCriteriaOperatorsForField(field)).toEqual([
        RuleCriteriaOperator.MatchesPattern,
        RuleCriteriaOperator.DoesNotMatchPattern,
      ]);
    },
  );

  test("every operator has a plain label", () => {
    for (const operator of Object.values(RuleCriteriaOperator)) {
      expect(RULE_CRITERIA_OPERATOR_LABELS[operator]).toMatch(/^[A-Z][a-z ]+$/);
      expect(getRuleCriteriaOperatorLabel(INCIDENT_TITLE, operator)).toBe(
        RULE_CRITERIA_OPERATOR_LABELS[operator],
      );
    }
  });

  test("an address range is in or not in, rather than matching a pattern", () => {
    for (const field of [IP_ADDRESS, SUBNET]) {
      expect(isRuleCriteriaAddressRangeField(field)).toBe(true);
      expect(
        getRuleCriteriaOperatorLabel(field, RuleCriteriaOperator.MatchesPattern),
      ).toBe("Is in");
      expect(
        getRuleCriteriaOperatorLabel(
          field,
          RuleCriteriaOperator.DoesNotMatchPattern,
        ),
      ).toBe("Is not in");
    }

    // An OID is a pattern of its own, but not an address range.
    expect(isRuleCriteriaAddressRangeField(SYSTEM_OBJECT_ID)).toBe(false);
    expect(
      getRuleCriteriaOperatorLabel(
        SYSTEM_OBJECT_ID,
        RuleCriteriaOperator.MatchesPattern,
      ),
    ).toBe("Matches pattern");
    expect(isRuleCriteriaAddressRangeField(undefined)).toBe(false);
    expect(
      getRuleCriteriaOperatorLabel(undefined, RuleCriteriaOperator.HasAnyOf),
    ).toBe("Has any of");
  });

  test("tells list and pattern operators apart", () => {
    expect(isRuleCriteriaArrayOperator(RuleCriteriaOperator.HasNoneOf)).toBe(
      true,
    );
    expect(isRuleCriteriaArrayOperator(RuleCriteriaOperator.Contains)).toBe(
      false,
    );
    expect(
      isRuleCriteriaPatternOperator(RuleCriteriaOperator.DoesNotMatchPattern),
    ).toBe(true);
    expect(isRuleCriteriaPatternOperator(RuleCriteriaOperator.Equals)).toBe(
      false,
    );
  });
});

describe("what a new condition starts as", () => {
  test("text starts on Contains, not on a regex", () => {
    expect(getDefaultRuleCriteriaOperator(INCIDENT_TITLE)).toBe(
      RuleCriteriaOperator.Contains,
    );
    expect(createRuleCriteriaFilter(INCIDENT_TITLE)).toEqual(
      filter("incidentTitlePattern", RuleCriteriaOperator.Contains, ""),
    );
  });

  test("a list starts on Has any of with nothing picked", () => {
    expect(createRuleCriteriaFilter(MONITORS)).toEqual(
      filter("monitors", RuleCriteriaOperator.HasAnyOf, []),
    );
  });

  test("a choice starts on Equals, a switch on true, a number on 0", () => {
    expect(createRuleCriteriaFilter(MONITOR_TYPE)).toEqual(
      filter("monitorType", RuleCriteriaOperator.Equals, ""),
    );
    expect(createRuleCriteriaFilter(ENABLED)).toEqual(
      filter("isEnabled", RuleCriteriaOperator.Equals, true),
    );
    expect(createRuleCriteriaFilter(PORT)).toEqual(
      filter("port", RuleCriteriaOperator.Equals, 0),
    );
  });

  test("an address range starts on Is in", () => {
    expect(createRuleCriteriaFilter(IP_ADDRESS)).toEqual(
      filter("ipMatchTarget", RuleCriteriaOperator.MatchesPattern, ""),
    );
  });

  test("a field with no column cannot start a condition", () => {
    expect(createRuleCriteriaFilter({ title: "Nothing" })).toBeNull();
  });

  test("Add condition starts on the first field no condition uses yet", () => {
    expect(getNextRuleCriteriaField(INCIDENT_FIELDS, [])).toBe(MONITORS);
    expect(
      getNextRuleCriteriaField(INCIDENT_FIELDS, [
        filter("monitors", RuleCriteriaOperator.HasAnyOf, ["m"]),
      ]),
    ).toBe(INCIDENT_LABELS);
    expect(
      getNextRuleCriteriaField(INCIDENT_FIELDS, [
        filter("monitors", RuleCriteriaOperator.HasAnyOf, ["m"]),
        filter("incidentLabels", RuleCriteriaOperator.HasAnyOf, ["l"]),
        filter("incidentTitlePattern", RuleCriteriaOperator.Contains, "db"),
      ]),
    ).toBe(MONITOR_LABELS);
  });

  test("once every field is used, Add condition starts on the first again", () => {
    const filters: Array<RuleCriteriaFilter> = INCIDENT_FIELDS.map(
      (field: Field<Entity>): RuleCriteriaFilter => {
        return createRuleCriteriaFilter(field)!;
      },
    );

    expect(getNextRuleCriteriaField(INCIDENT_FIELDS, filters)).toBe(MONITORS);
    expect(getNextRuleCriteriaField([], [])).toBeUndefined();
  });

  test("empty values match the operator's shape", () => {
    expect(
      getEmptyRuleCriteriaValue(INCIDENT_TITLE, RuleCriteriaOperator.HasAnyOf),
    ).toEqual([]);
    expect(
      getEmptyRuleCriteriaValue(INCIDENT_TITLE, RuleCriteriaOperator.Equals),
    ).toBe("");
    expect(getEmptyRuleCriteriaValue(PORT, RuleCriteriaOperator.Equals)).toBe(0);
    expect(
      getEmptyRuleCriteriaValue(ENABLED, RuleCriteriaOperator.NotEquals),
    ).toBe(true);
  });
});

describe("rules saved before conditions existed", () => {
  test("keep their meaning: a Pattern column is a regex, a relation any-of", () => {
    expect(getLegacyRuleCriteriaOperator(INCIDENT_TITLE)).toBe(
      RuleCriteriaOperator.MatchesPattern,
    );
    expect(getLegacyRuleCriteriaOperator(MONITORS)).toBe(
      RuleCriteriaOperator.HasAnyOf,
    );
    expect(getLegacyRuleCriteriaOperator(MONITOR_TYPE)).toBe(
      RuleCriteriaOperator.Equals,
    );
    expect(getLegacyRuleCriteriaOperator(IP_ADDRESS)).toBe(
      RuleCriteriaOperator.MatchesPattern,
    );
    expect(
      getLegacyRuleCriteriaOperator({
        field: { hostname: true },
        fieldType: FormFieldSchemaType.Text,
      }),
    ).toBe(RuleCriteriaOperator.Equals);
  });

  test("convert into one match-all condition per filled column", () => {
    expect(
      convertLegacyValuesToRuleCriteria({
        fields: INCIDENT_FIELDS,
        values: {
          monitors: [{ _id: "m-1" }, { value: "m-2" }],
          incidentLabels: [],
          incidentTitlePattern: "^db-",
          incidentDescriptionPattern: "   ",
        },
      }),
    ).toEqual(
      criteria([
        filter("monitors", RuleCriteriaOperator.HasAnyOf, ["m-1", "m-2"]),
        filter("incidentTitlePattern", RuleCriteriaOperator.MatchesPattern, "^db-"),
      ]),
    );
  });

  test("with no filled column convert into no conditions", () => {
    expect(
      convertLegacyValuesToRuleCriteria({ fields: INCIDENT_FIELDS }),
    ).toEqual(criteria([]));
  });

  test("values normalise to ids for lists and to scalars otherwise", () => {
    expect(
      normalizeRuleCriteriaValue(
        [{ _id: { toString: (): string => "a" } }, "b", { id: 3 }, null],
        RuleCriteriaOperator.HasAllOf,
      ),
    ).toEqual(["a", "b", "3"]);
    expect(
      normalizeRuleCriteriaValue({ value: "x" }, RuleCriteriaOperator.Equals),
    ).toBe("x");
    expect(
      normalizeRuleCriteriaValue(null, RuleCriteriaOperator.Equals),
    ).toBe("");
    expect(normalizeRuleCriteriaValue(7, RuleCriteriaOperator.Equals)).toBe(7);
  });
});

describe("the fields a condition can be about", () => {
  test("are those with a column whose showIf allows them", () => {
    const hidden: Field<Entity> = {
      ...INCIDENT_DESCRIPTION,
      showIf: (values: Entity): boolean => {
        return values["showDescription"] === true;
      },
    };
    const fields: Array<Field<Entity>> = [
      INCIDENT_TITLE,
      hidden,
      { title: "No column" },
    ];

    expect(getAvailableRuleCriteriaFields(fields, {})).toEqual([
      INCIDENT_TITLE,
    ]);
    expect(
      getAvailableRuleCriteriaFields(fields, { showDescription: true }),
    ).toEqual([INCIDENT_TITLE, hidden]);
    expect(findRuleCriteriaField(fields, "incidentDescriptionPattern")).toBe(
      hidden,
    );
    expect(findRuleCriteriaField(fields, "nope")).toBeUndefined();
  });
});

describe("value placeholders", () => {
  test("the old (optional) prompts give way to plain ones", () => {
    expect(
      getRuleCriteriaValuePlaceholder(MONITORS, RuleCriteriaOperator.HasAnyOf),
    ).toBe(RuleCriteriaCopy.selectOneOrMore);
    expect(
      getRuleCriteriaValuePlaceholder(
        { ...MONITOR_TYPE, placeholder: "Select Monitor Type (optional)" },
        RuleCriteriaOperator.Equals,
      ),
    ).toBe(RuleCriteriaCopy.selectAValue);
  });

  test("a page's own prompt is kept where it still fits", () => {
    expect(
      getRuleCriteriaValuePlaceholder(MONITOR_TYPE, RuleCriteriaOperator.Equals),
    ).toBe("Select Monitor Type");
    expect(
      getRuleCriteriaValuePlaceholder(ENABLED, RuleCriteriaOperator.Equals),
    ).toBe(RuleCriteriaCopy.selectAValue);
  });

  test("a regex example only shows for a pattern operator", () => {
    expect(
      getRuleCriteriaValuePlaceholder(
        INCIDENT_TITLE,
        RuleCriteriaOperator.MatchesPattern,
      ),
    ).toBe("CPU.*high");
    for (const operator of [
      RuleCriteriaOperator.Contains,
      RuleCriteriaOperator.Equals,
      RuleCriteriaOperator.StartsWith,
    ]) {
      expect(getRuleCriteriaValuePlaceholder(INCIDENT_TITLE, operator)).toBe(
        RuleCriteriaCopy.enterText,
      );
    }
    expect(
      getRuleCriteriaValuePlaceholder(
        { field: { anyPattern: true }, fieldType: FormFieldSchemaType.Text },
        RuleCriteriaOperator.DoesNotMatchPattern,
      ),
    ).toBe(RuleCriteriaCopy.enterAPattern);
    expect(
      getRuleCriteriaValuePlaceholder(IP_ADDRESS, RuleCriteriaOperator.MatchesPattern),
    ).toBe("192.168.1.0/24 or 10.16-22.0-255.51-66");
  });

  test("a number asks for a number", () => {
    expect(
      getRuleCriteriaValuePlaceholder(PORT, RuleCriteriaOperator.Equals),
    ).toBe(RuleCriteriaCopy.enterANumber);
  });
});

describe("changing a condition's field", () => {
  test("keeps the operator and the text when the new field takes them", () => {
    expect(
      changeRuleCriteriaFilterField({
        filter: filter("incidentTitlePattern", RuleCriteriaOperator.StartsWith, "db"),
        fromField: INCIDENT_TITLE,
        toField: INCIDENT_DESCRIPTION,
      }),
    ).toEqual(
      filter("incidentDescriptionPattern", RuleCriteriaOperator.StartsWith, "db"),
    );
  });

  test("keeps picked labels between two label fields", () => {
    expect(
      changeRuleCriteriaFilterField({
        filter: filter("incidentLabels", RuleCriteriaOperator.HasNoneOf, ["l-1"]),
        fromField: INCIDENT_LABELS,
        toField: MONITOR_LABELS,
      }),
    ).toEqual(filter("monitorLabels", RuleCriteriaOperator.HasNoneOf, ["l-1"]));
  });

  test("drops monitor ids when moving to labels, keeping the operator", () => {
    expect(
      changeRuleCriteriaFilterField({
        filter: filter("monitors", RuleCriteriaOperator.HasAllOf, ["m-1"]),
        fromField: MONITORS,
        toField: MONITOR_LABELS,
      }),
    ).toEqual(filter("monitorLabels", RuleCriteriaOperator.HasAllOf, []));
  });

  test("starts over on the new field's default when the operator does not fit", () => {
    expect(
      changeRuleCriteriaFilterField({
        filter: filter("monitors", RuleCriteriaOperator.HasAnyOf, ["m-1"]),
        fromField: MONITORS,
        toField: INCIDENT_TITLE,
      }),
    ).toEqual(filter("incidentTitlePattern", RuleCriteriaOperator.Contains, ""));
    expect(
      changeRuleCriteriaFilterField({
        filter: filter("incidentTitlePattern", RuleCriteriaOperator.Contains, "db"),
        fromField: INCIDENT_TITLE,
        toField: MONITORS,
      }),
    ).toEqual(filter("monitors", RuleCriteriaOperator.HasAnyOf, []));
  });

  test("does not carry text into a choice, or a name into an address range", () => {
    expect(
      changeRuleCriteriaFilterField({
        filter: filter("incidentTitlePattern", RuleCriteriaOperator.Equals, "API"),
        fromField: INCIDENT_TITLE,
        toField: MONITOR_TYPE,
      }),
    ).toEqual(filter("monitorType", RuleCriteriaOperator.Equals, ""));
    expect(
      changeRuleCriteriaFilterField({
        filter: filter(
          "sysNamePattern",
          RuleCriteriaOperator.MatchesPattern,
          "core-.*",
        ),
        fromField: {
          field: { sysNamePattern: true },
          fieldType: FormFieldSchemaType.Text,
        },
        toField: IP_ADDRESS,
      }),
    ).toEqual(filter("ipMatchTarget", RuleCriteriaOperator.MatchesPattern, ""));
  });

  test("a condition whose field is gone starts over on the one picked", () => {
    expect(
      changeRuleCriteriaFilterField({
        filter: filter("removedField", RuleCriteriaOperator.Contains, "x"),
        fromField: undefined,
        toField: INCIDENT_TITLE,
      }),
    ).toEqual(filter("incidentTitlePattern", RuleCriteriaOperator.Contains, ""));
  });
});

describe("changing a condition's operator", () => {
  test("keeps the text between text operators", () => {
    expect(
      changeRuleCriteriaFilterOperator({
        filter: filter("incidentTitlePattern", RuleCriteriaOperator.Contains, "db"),
        field: INCIDENT_TITLE,
        operator: RuleCriteriaOperator.MatchesPattern,
      }),
    ).toEqual(
      filter("incidentTitlePattern", RuleCriteriaOperator.MatchesPattern, "db"),
    );
  });

  test("keeps the picked values between list operators", () => {
    expect(
      changeRuleCriteriaFilterOperator({
        filter: filter("monitors", RuleCriteriaOperator.HasAnyOf, ["a", "b"]),
        field: MONITORS,
        operator: RuleCriteriaOperator.HasNoneOf,
      }),
    ).toEqual(filter("monitors", RuleCriteriaOperator.HasNoneOf, ["a", "b"]));
  });

  test("starts the value over between one value and a list", () => {
    expect(
      changeRuleCriteriaFilterOperator({
        filter: filter("incidentTitlePattern", RuleCriteriaOperator.Contains, "db"),
        field: INCIDENT_TITLE,
        operator: RuleCriteriaOperator.HasAnyOf,
      }),
    ).toEqual(filter("incidentTitlePattern", RuleCriteriaOperator.HasAnyOf, []));
  });
});

describe("what a person is told about a condition", () => {
  function problem(
    value: RuleCriteriaFilter["value"],
    field: Field<Entity> | undefined,
    operator: RuleCriteriaOperator = RuleCriteriaOperator.Contains,
  ): string | null {
    const message: RuleCriteriaMessage | null = getRuleCriteriaFilterProblem(
      filter("x", operator, value),
      field,
    );

    return message ? formatRuleCriteriaMessage(message) : null;
  }

  test("a blank value asks for one, in the words of the control", () => {
    expect(problem("", INCIDENT_TITLE)).toBe("Enter a value.");
    expect(problem("   ", INCIDENT_TITLE)).toBe("Enter a value.");
    expect(problem("", MONITOR_TYPE, RuleCriteriaOperator.Equals)).toBe(
      "Choose a value.",
    );
    expect(problem([], MONITORS, RuleCriteriaOperator.HasAnyOf)).toBe(
      "Choose at least one value.",
    );
  });

  test("a value the API would refuse says what to change", () => {
    expect(
      problem("a".repeat(RULE_CRITERIA_MAX_STRING_LENGTH + 1), INCIDENT_TITLE),
    ).toBe(`Use ${RULE_CRITERIA_MAX_STRING_LENGTH} characters or fewer.`);
    expect(
      problem(
        Array.from(
          { length: RULE_CRITERIA_MAX_RELATION_VALUES + 1 },
          (_value: unknown, index: number): string => {
            return `id-${index}`;
          },
        ),
        MONITORS,
        RuleCriteriaOperator.HasAnyOf,
      ),
    ).toBe(`Choose ${RULE_CRITERIA_MAX_RELATION_VALUES} values or fewer.`);
    expect(problem(Number.NaN, PORT, RuleCriteriaOperator.Equals)).toBe(
      "Enter a number.",
    );
  });

  test("a pattern that compiles to nothing is pointed out", () => {
    expect(
      problem("api-(01", INCIDENT_TITLE, RuleCriteriaOperator.MatchesPattern),
    ).toBe(RuleCriteriaCopy.invalidPatternProblem);
    expect(
      problem("api-(01", IP_ADDRESS, RuleCriteriaOperator.MatchesPattern),
    ).toBe(RuleCriteriaCopy.invalidAddressRangeProblem);
    // Text operators take any text: brackets are literal there.
    expect(problem("api-(01", INCIDENT_TITLE)).toBeNull();
    // A wildcard is a pattern even when it is not a regex.
    expect(
      problem("*(db*", INCIDENT_TITLE, RuleCriteriaOperator.MatchesPattern),
    ).toBeNull();
  });

  test("a condition on a field the page no longer offers says so", () => {
    expect(problem("db", undefined)).toBe(RuleCriteriaCopy.fieldUnavailable);
  });

  test("a good condition has nothing to say", () => {
    expect(problem("db", INCIDENT_TITLE)).toBeNull();
    expect(problem(["m-1"], MONITORS, RuleCriteriaOperator.HasAnyOf)).toBeNull();
    expect(problem(true, ENABLED, RuleCriteriaOperator.Equals)).toBeNull();
    expect(problem(8080, PORT, RuleCriteriaOperator.Equals)).toBeNull();
  });
});

describe("what the form says about all the conditions", () => {
  function formProblem(
    value: unknown,
    requiresCondition?: boolean,
  ): string | null {
    const message: RuleCriteriaMessage | null = getRuleCriteriaFormProblem({
      criteria: value,
      fields: INCIDENT_FIELDS,
      requiresCondition,
    });

    return message ? formatRuleCriteriaMessage(message) : null;
  }

  test("no conditions are fine for a rule that matches everything without them", () => {
    expect(formProblem(criteria([]))).toBeNull();
  });

  test("a rule that needs a condition asks for one", () => {
    expect(formProblem(criteria([]), true)).toBe("Add at least one condition.");
    expect(
      formProblem(
        criteria([
          filter("incidentTitlePattern", RuleCriteriaOperator.Contains, "db"),
        ]),
        true,
      ),
    ).toBeNull();
  });

  test("names the first condition that cannot be saved, by its number", () => {
    expect(
      formProblem(
        criteria([
          filter("incidentTitlePattern", RuleCriteriaOperator.Contains, "db"),
          filter("monitors", RuleCriteriaOperator.HasAnyOf, []),
          filter("incidentDescriptionPattern", RuleCriteriaOperator.Contains, ""),
        ]),
      ),
    ).toBe("Condition 2: Choose at least one value.");
  });

  test("too many conditions are pointed out before any one of them", () => {
    const filters: Array<RuleCriteriaFilter> = Array.from(
      { length: RULE_CRITERIA_MAX_FILTERS + 1 },
      (): RuleCriteriaFilter => {
        return filter("incidentTitlePattern", RuleCriteriaOperator.Contains, "");
      },
    );

    expect(formProblem(criteria(filters))).toBe(
      `Use ${RULE_CRITERIA_MAX_FILTERS} conditions or fewer.`,
    );
  });

  test("a payload no builder makes falls back to the API's own message", () => {
    expect(formProblem({ broken: true })).toBe(
      "Rule criteria schemaVersion must be 1.",
    );
    expect(
      formProblem({
        ...criteria([]),
        filterCondition: "Sometimes",
      }),
    ).toBe("Rule criteria filterCondition must be All or Any.");
    expect(formProblem("not an object")).toBe("Rule criteria must be an object.");
    expect(
      formProblem(
        criteria([
          {
            field: "incidentTitlePattern",
            operator: RuleCriteriaOperator.Contains,
            value: "db",
            extra: true,
          } as unknown as RuleCriteriaFilter,
        ]),
      ),
    ).toContain("may only contain field, operator, and value");
  });
});

describe("message formatting", () => {
  test("fills placeholders in English when no translator is given", () => {
    expect(
      englishRuleCriteriaMessage("Use {{max}} of {{ thing }}", {
        max: 3,
        thing: "these",
      }),
    ).toBe("Use 3 of these");
    expect(englishRuleCriteriaMessage("Keep {{unknown}}", {})).toBe(
      "Keep {{unknown}}",
    );
  });

  test("translates the inner message on its own before placing it", () => {
    const seen: Array<string> = [];
    const translated: string = formatRuleCriteriaMessage(
      {
        text: RuleCriteriaCopy.conditionProblem,
        values: { number: 3 },
        inner: { text: RuleCriteriaCopy.enterAValueProblem },
      },
      (template: string, values: Record<string, string | number>): string => {
        seen.push(template);
        return `[${englishRuleCriteriaMessage(template, values)}]`;
      },
    );

    expect(seen).toEqual([
      RuleCriteriaCopy.enterAValueProblem,
      RuleCriteriaCopy.conditionProblem,
    ]);
    expect(translated).toBe("[Condition 3: [Enter a value.]]");
  });
});
