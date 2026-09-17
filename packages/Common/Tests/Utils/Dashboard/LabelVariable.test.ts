import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesAnyOfGroups from "../../../Types/BaseDatabase/IncludesAnyOfGroups";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import JSONFunctions from "../../../Types/JSONFunctions";
import DashboardLabelVariable from "../../../Utils/Dashboard/LabelVariable";

const UNIT_660: string = "06600000-0000-4000-8000-000000000000";
const UNIT_661: string = "06610000-0000-4000-8000-000000000000";
const NETWORK: string = "00000000-0000-4000-8000-000000000001";

function variable(
  overrides: Partial<DashboardVariable> = {},
): DashboardVariable {
  return {
    id: "unit",
    name: "UNIT",
    type: DashboardVariableType.ProjectLabel,
    labelOptions: [
      { label: "0660", value: UNIT_660 },
      { label: "0661", value: UNIT_661 },
    ],
    ...overrides,
  };
}

function filter(
  overrides: Partial<DashboardVariable> = {},
  labelIds?: Array<string>,
): ReturnType<typeof DashboardLabelVariable.getFilter> {
  return DashboardLabelVariable.getFilter({
    labelVariableId: "unit",
    labelIds,
    variables: [variable(overrides)],
  });
}

describe("project label dashboard variable filters", () => {
  test("keeps existing widgets with fixed labels unchanged", () => {
    expect(DashboardLabelVariable.getFilter({ labelIds: [NETWORK] })).toEqual(
      new Includes([NETWORK]),
    );
    expect(DashboardLabelVariable.getFilter({})).toBeUndefined();
  });

  test("a title or an unbound variable does not change the query", () => {
    expect(
      DashboardLabelVariable.getFilter({
        variables: [variable({ selectedValue: UNIT_660 })],
      }),
    ).toBeUndefined();
  });

  test.each([UNIT_660, UNIT_661])(
    "filters by selected label ID %s",
    (id: string) => {
      expect(filter({ selectedValue: id })).toEqual(new Includes([id]));
    },
  );

  test("uses an absent selection's default", () => {
    expect(filter({ defaultValue: UNIT_660 })).toEqual(
      new Includes([UNIT_660]),
    );
  });

  test("All overrides a default and retains the fixed label condition", () => {
    expect(
      filter({ defaultValue: UNIT_660, selectedValue: "" }, [NETWORK]),
    ).toEqual(new Includes([NETWORK]));
    expect(filter({ selectedValue: "" })).toBeUndefined();
  });

  test("multi-select is OR within units and AND with fixed labels", () => {
    expect(
      filter({ isMultiSelect: true, selectedValues: [UNIT_660, UNIT_661] }, [
        NETWORK,
      ]),
    ).toEqual(new IncludesAnyOfGroups([[NETWORK], [UNIT_660, UNIT_661]]));
  });

  test("empty multi-select ignores a stale scalar and default", () => {
    expect(
      filter(
        {
          isMultiSelect: true,
          selectedValues: [],
          selectedValue: UNIT_660,
          defaultValue: UNIT_661,
        },
        [NETWORK],
      ),
    ).toEqual(new Includes([NETWORK]));
  });

  test("does not mutate saved configuration and deduplicates repeated picks", () => {
    const saved: DashboardVariable = variable({
      isMultiSelect: true,
      selectedValues: [UNIT_660, UNIT_660],
    });
    const before: string = JSON.stringify(saved);
    const fixed: Array<string> = [NETWORK, NETWORK];
    expect(
      DashboardLabelVariable.getFilter({
        labelIds: fixed,
        labelVariableId: saved.id,
        variables: [saved],
      }),
    ).toEqual(new IncludesAnyOfGroups([[NETWORK], [UNIT_660]]));
    expect(JSON.stringify(saved)).toBe(before);
    expect(fixed).toEqual([NETWORK, NETWORK]);
  });

  test("binding survives a variable rename and display name changes", () => {
    expect(
      filter({
        name: "BRANCH",
        selectedValue: UNIT_660,
        labelOptions: [{ label: "Renamed unit", value: UNIT_660 }],
      }),
    ).toEqual(new Includes([UNIT_660]));
  });

  test("missing, duplicate, or incompatible variable definitions are errors", () => {
    for (const variables of [
      [],
      [variable(), variable()],
      [variable({ type: DashboardVariableType.CustomList })],
    ]) {
      expect(() => {
        return DashboardLabelVariable.getFilter({
          labelVariableId: "unit",
          variables,
        });
      }).toThrow(/label variable/);
    }
  });

  test.each(["0660", NETWORK])(
    "rejects selections not in the configured options: %s",
    (selectedValue: string) => {
      expect(() => {
        return filter({ selectedValue });
      }).toThrow(/offered by this dashboard/);
    },
  );

  test("an invalid default does not silently fall back to all monitors", () => {
    expect(() => {
      return filter({ defaultValue: NETWORK });
    }).toThrow(/offered by this dashboard/);
  });

  test("validates every multi-selection instead of dropping invalid values", () => {
    expect(() => {
      return filter({
        isMultiSelect: true,
        selectedValues: [UNIT_660, NETWORK],
      });
    }).toThrow(/offered by this dashboard/);
  });

  test("bounds multi-selection size", () => {
    expect(() => {
      return filter({
        isMultiSelect: true,
        selectedValues: Array(101).fill(UNIT_660) as Array<string>,
      });
    }).toThrow(/100 labels/);
  });

  test.each([
    undefined,
    [],
    [{ label: "0660", value: "0660" }],
    [{ label: "", value: UNIT_660 }],
    [{ label: " ", value: UNIT_660 }],
    [{ label: "x".repeat(1025), value: UNIT_660 }],
    [
      { label: "0660", value: UNIT_660 },
      { label: "Duplicate", value: UNIT_660 },
    ],
    Array(1001).fill({ label: "0660", value: UNIT_660 }),
  ])(
    "rejects malformed label choices %#",
    (labelOptions: DashboardVariable["labelOptions"]) => {
      expect(() => {
        return filter({ labelOptions });
      }).toThrow();
    },
  );

  test("filter operators survive the API serialization round trip", () => {
    const original: IncludesAnyOfGroups = filter({ selectedValue: UNIT_660 }, [
      NETWORK,
    ]) as IncludesAnyOfGroups;
    expect(
      JSONFunctions.deserializeValue(JSONFunctions.serializeValue(original)),
    ).toEqual(original);
  });
});

describe("dashboard title display interpolation", () => {
  test.each([
    [{ selectedValue: UNIT_660 }, "0660 NETWORK"],
    [{ defaultValue: UNIT_661 }, "0661 NETWORK"],
    [{ selectedValue: "", defaultValue: UNIT_660 }, "All NETWORK"],
    [
      { isMultiSelect: true, selectedValues: [UNIT_660, UNIT_661] },
      "0660, 0661 NETWORK",
    ],
    [
      { isMultiSelect: true, selectedValues: [], defaultValue: UNIT_660 },
      "All NETWORK",
    ],
    [{ selectedValue: NETWORK }, "Unavailable label NETWORK"],
  ])(
    "renders a label selection using display names %#",
    (overrides: Partial<DashboardVariable>, expected: string) => {
      expect(
        DashboardLabelVariable.interpolateTitle("{{UNIT}} NETWORK", [
          variable(overrides),
        ]),
      ).toBe(expected);
    },
  );

  test("preserves unknown references and ordinary titles", () => {
    expect(
      DashboardLabelVariable.interpolateTitle("{{missing}} NETWORK", [
        variable(),
      ]),
    ).toBe("{{missing}} NETWORK");
    expect(DashboardLabelVariable.interpolateTitle("Monitors", [])).toBe(
      "Monitors",
    );
    expect(
      DashboardLabelVariable.interpolateTitle(undefined, []),
    ).toBeUndefined();
  });

  test("supports multiple references and text values without interpreting markup", () => {
    const text: DashboardVariable = {
      id: "env",
      name: "ENV",
      type: DashboardVariableType.TextInput,
      selectedValue: "<b>prod</b>",
    };
    expect(
      DashboardLabelVariable.interpolateTitle("{{UNIT}} / {{ENV}} / {{UNIT}}", [
        variable({ selectedValue: UNIT_660 }),
        text,
      ]),
    ).toBe("0660 / <b>prod</b> / 0660");
  });
});
