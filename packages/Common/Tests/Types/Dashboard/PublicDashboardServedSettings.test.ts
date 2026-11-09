import { describe, expect, test } from "@jest/globals";
import DashboardComponentType, {
  DataSourceComponentTypes,
  isDashboardComponentType,
} from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import { DASHBOARD_WIDGET_SORT_ARGUMENT } from "../../../Types/Dashboard/DashboardWidgetSort";
import {
  PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES,
  PUBLIC_DASHBOARD_UNKNOWN_VARIABLE_TYPE_FIELDS,
  PUBLIC_DASHBOARD_VARIABLE_FIELDS,
  PUBLIC_DASHBOARD_VARIABLE_TYPE_FIELDS,
  PUBLIC_DASHBOARD_WIDGET_SETTINGS,
  PUBLIC_DASHBOARD_WITHHELD_VARIABLE_FIELDS,
  PublicDashboardServedWidgetType,
  PublicDashboardWidgetSettings,
  getPublicDashboardVariable,
  getPublicDashboardVariableFields,
  getPublicDashboardWidgetSettings,
  getPublicDashboardWidgetSettingsDecision,
  isPublicDashboardUndrawnWidgetType,
} from "../../../Types/Dashboard/PublicDashboardServedSettings";
import {
  declaredVariableFields,
  declaredWidgetSettings,
  editorWidgetSettings,
  isSortableWidgetType,
  widgetSettingsOf,
} from "../../Helpers/DashboardWidgetSettingsDeclared";

/*
 * Issue #6338: a public dashboard served its anonymous visitors the whole
 * settings of the widgets its page cannot draw - a log chart's search
 * text and attribute filters, a trace table's span names and grouping, a
 * security events list's message search - and every variable whole, a
 * legacy Query variable's ClickHouse query included. Now each widget is
 * served only the settings its type is served, and each variable only the
 * fields its type is served (PublicDashboardServedSettings).
 *
 * These tests hold that table to the widget types and the variables as
 * they are declared, so that nothing is served, or left out, by accident:
 *
 * - every widget type has its decision, and every setting it has - each
 *   one its type declares (Types/Dashboard/DashboardComponents), its
 *   editor writes (getComponentSettingsArguments) or its list sorts by -
 *   is either served or withheld, so a widget type, or a setting, added
 *   later is decided the day it is added;
 * - every field a variable declares is decided, for every type of it;
 * - the functions that apply it serve exactly what it says.
 *
 * Whether the page draws every widget as before from what is served, and
 * the public routes answer as before, is held by the sanitizer's, the
 * routes' and the public page's own suites.
 */

// The types a public dashboard serves: every type but the Data Source ones.
const SERVED_TYPES: Array<PublicDashboardServedWidgetType> = Object.values(
  DashboardComponentType,
).filter((componentType: DashboardComponentType): boolean => {
  return !DataSourceComponentTypes.includes(componentType);
}) as Array<PublicDashboardServedWidgetType>;

// Every setting a widget type has, as its declaration, its editor and its sort say.
const settingsOf: (componentType: DashboardComponentType) => Array<string> =
  widgetSettingsOf;

const declaredSettings: (componentType: string) => Array<string> =
  declaredWidgetSettings;

const editorSettings: (componentType: DashboardComponentType) => Array<string> =
  editorWidgetSettings;

const isSortable: (componentType: DashboardComponentType) => boolean =
  isSortableWidgetType;

// Every setting a decision names, in all three of its lists.
function decidedSettings(
  decision: PublicDashboardWidgetSettings,
): Array<string> {
  return [
    ...decision.served,
    ...Object.keys(decision.servedWhileOn || {}),
    ...decision.withheld,
  ];
}

describe("every widget type's settings are decided: served or withheld", () => {
  test("the declarations are read: the settings the issue names are among them", () => {
    expect(declaredSettings(DashboardComponentType.LogChart)).toEqual([
      "title",
      "chartType",
      "severityFilters",
      "bodyContains",
      "attributeFilters",
      "attributeFilterQuery",
    ]);
    expect(declaredSettings(DashboardComponentType.TraceTable)).toEqual(
      expect.arrayContaining([
        "spanNameContains",
        "attributeFilters",
        "groupByAttribute",
      ]),
    );
    expect(declaredSettings(DashboardComponentType.SecurityEventsList)).toEqual(
      expect.arrayContaining([
        "messageContains",
        "classNameFilters",
        "severityFilters",
      ]),
    );

    // Not vacuous: every type declares settings, its editor writes some.
    for (const componentType of SERVED_TYPES) {
      expect([
        componentType,
        declaredSettings(componentType).length > 0,
      ]).toEqual([componentType, true]);
      expect([componentType, editorSettings(componentType).length > 0]).toEqual(
        [componentType, true],
      );
    }
  });

  test("every type a public dashboard serves has a decision, and the Data Source types, which it leaves out whole, none", () => {
    expect(Object.keys(PUBLIC_DASHBOARD_WIDGET_SETTINGS).sort()).toEqual(
      [...SERVED_TYPES].sort(),
    );

    for (const componentType of DataSourceComponentTypes) {
      expect([
        componentType,
        getPublicDashboardWidgetSettingsDecision(componentType),
      ]).toEqual([componentType, null]);
    }
  });

  test.each(SERVED_TYPES)(
    "%s: every setting it has is decided, once, and nothing it does not have",
    (componentType: PublicDashboardServedWidgetType) => {
      const decision: PublicDashboardWidgetSettings =
        PUBLIC_DASHBOARD_WIDGET_SETTINGS[componentType];
      const decided: Array<string> = decidedSettings(decision);

      // Once: in one list, and once in it.
      expect([componentType, decided.length]).toEqual([
        componentType,
        new Set(decided).size,
      ]);

      expect([componentType, [...decided].sort()]).toEqual([
        componentType,
        settingsOf(componentType),
      ]);
    },
  );

  test.each(SERVED_TYPES)(
    "%s: a setting served while another is on waits on one it is served",
    (componentType: PublicDashboardServedWidgetType) => {
      const decision: PublicDashboardWidgetSettings =
        PUBLIC_DASHBOARD_WIDGET_SETTINGS[componentType];

      for (const condition of Object.values(decision.servedWhileOn || {})) {
        expect([componentType, decision.served.includes(condition)]).toEqual([
          componentType,
          true,
        ]);
      }
    },
  );

  test("a widget the page cannot draw is served its title, which it draws above its note, and nothing else", () => {
    for (const componentType of PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES) {
      const decision: PublicDashboardWidgetSettings =
        PUBLIC_DASHBOARD_WIDGET_SETTINGS[
          componentType as PublicDashboardServedWidgetType
        ];

      expect([componentType, decision.served, decision.servedWhileOn]).toEqual([
        componentType,
        ["title"],
        undefined,
      ]);
      // It has a title, in its declaration and its editor.
      expect([componentType, declaredSettings(componentType)]).toEqual([
        componentType,
        expect.arrayContaining(["title"]),
      ]);
      expect([componentType, editorSettings(componentType)]).toEqual([
        componentType,
        expect.arrayContaining(["title"]),
      ]);
    }
  });

  /*
   * A widget the page draws is served every setting it has: each shapes
   * what the page draws, or what a public route reads the widget's data
   * with. Withholding one is a decision made here, in this test, with the
   * public page's suite showing the widget still draws as before.
   */
  test("a widget the page draws withholds none of its settings; the HTML widget serves its script only while scripts may run", () => {
    for (const componentType of SERVED_TYPES) {
      if (isPublicDashboardUndrawnWidgetType(componentType)) {
        continue;
      }

      const decision: PublicDashboardWidgetSettings =
        PUBLIC_DASHBOARD_WIDGET_SETTINGS[componentType];

      expect([componentType, decision.withheld]).toEqual([componentType, []]);
      expect([componentType, decision.servedWhileOn]).toEqual([
        componentType,
        componentType === DashboardComponentType.Html
          ? { javascript: "allowScripts" }
          : undefined,
      ]);
    }
  });

  test("a list's sort is served where the page draws the list, and withheld where it cannot", () => {
    for (const componentType of SERVED_TYPES) {
      const decision: PublicDashboardWidgetSettings =
        PUBLIC_DASHBOARD_WIDGET_SETTINGS[componentType];

      expect([
        componentType,
        decision.served.includes(DASHBOARD_WIDGET_SORT_ARGUMENT),
      ]).toEqual([
        componentType,
        isSortable(componentType) &&
          !isPublicDashboardUndrawnWidgetType(componentType),
      ]);
    }

    // Not vacuous: two of the widgets the page cannot draw keep a sort.
    expect(isSortable(DashboardComponentType.TraceTable)).toBe(true);
    expect(isSortable(DashboardComponentType.SecurityEventsList)).toBe(true);
  });
});

describe("the widgets a public dashboard cannot draw", () => {
  test("are the log, trace, profile and security event widgets, each a type this version draws, and no Data Source widget", () => {
    expect([...PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES].sort()).toEqual(
      [
        DashboardComponentType.LogChart,
        DashboardComponentType.ProfileFlameGraph,
        DashboardComponentType.ProfileTopFunctions,
        DashboardComponentType.SecurityEventsFlow,
        DashboardComponentType.SecurityEventsList,
        DashboardComponentType.TraceChart,
        DashboardComponentType.TraceTable,
      ].sort(),
    );

    expect(new Set(PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES).size).toBe(
      PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES.length,
    );

    for (const componentType of PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES) {
      expect([componentType, isDashboardComponentType(componentType)]).toEqual([
        componentType,
        true,
      ]);
      expect([
        componentType,
        DataSourceComponentTypes.includes(componentType),
      ]).toEqual([componentType, false]);
    }
  });

  test("are matched exactly", () => {
    for (const componentType of Object.values(DashboardComponentType)) {
      expect([
        componentType,
        isPublicDashboardUndrawnWidgetType(componentType),
      ]).toEqual([
        componentType,
        PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES.includes(componentType),
      ]);
    }

    for (const notAType of [
      " LogChart ",
      "logchart",
      "LOGCHART",
      "LogChart\n",
      "",
      undefined,
      null,
      7,
      ["LogChart"],
      { componentType: "LogChart" },
    ]) {
      expect([notAType, isPublicDashboardUndrawnWidgetType(notAType)]).toEqual([
        notAType,
        false,
      ]);
    }
  });
});

describe("getPublicDashboardWidgetSettings", () => {
  test.each(SERVED_TYPES)(
    "%s: serves the settings its type is served, each as stored, and no other key",
    (componentType: PublicDashboardServedWidgetType) => {
      const decision: PublicDashboardWidgetSettings =
        PUBLIC_DASHBOARD_WIDGET_SETTINGS[componentType];
      const stored: Record<string, unknown> = {};

      for (const setting of settingsOf(componentType)) {
        // An object, so the test sees whether the very value is served.
        stored[setting] = { setting: setting, of: componentType };
      }

      // Scripts on, so the HTML widget's script is served too.
      stored["allowScripts"] = true;
      stored["notes"] = "for the owner only";
      stored["queryConfigs"] = [{ query: "SELECT secret" }];

      const served: Record<string, unknown> = getPublicDashboardWidgetSettings(
        componentType,
        stored,
      );

      const expectedKeys: Array<string> = [
        ...decision.served,
        ...Object.keys(decision.servedWhileOn || {}),
      ].sort();

      expect([componentType, Object.keys(served).sort()]).toEqual([
        componentType,
        expectedKeys,
      ]);

      for (const key of expectedKeys) {
        expect([componentType, key, served[key] === stored[key]]).toEqual([
          componentType,
          key,
          true,
        ]);
      }

      // A new object: the stored settings are not changed.
      expect(served).not.toBe(stored);
      expect(Object.keys(stored)).toContain("notes");
    },
  );

  test("a widget the page cannot draw is served its title alone, whatever else it holds", () => {
    const stored: Record<string, unknown> = {
      title: "Checkout errors",
      bodyContains: "password reset for alice@example.com",
      severityFilters: ["Error"],
      attributeFilters: { "url.host": "internal.example.com" },
      attributeFilterQuery: "k8s.namespace.name = payments-internal",
      spanNameContains: "/internal/billing",
      groupByAttribute: "enduser.id",
      messageContains: "root login from 10.0.0.7",
      classNameFilters: ["Authentication"],
      sort: "time:desc",
    };

    for (const componentType of PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES) {
      expect([
        componentType,
        getPublicDashboardWidgetSettings(componentType, stored),
      ]).toEqual([componentType, { title: "Checkout errors" }]);
    }
  });

  test("serves a title of any kind as stored, and none when there is none", () => {
    for (const title of ["", "  ", 5, true, null, ["a"], { text: "a" }]) {
      expect(
        getPublicDashboardWidgetSettings(DashboardComponentType.LogChart, {
          title: title,
          bodyContains: "secret",
        }),
      ).toEqual({ title: title });
    }

    expect(
      getPublicDashboardWidgetSettings(DashboardComponentType.LogChart, {
        bodyContains: "secret",
      }),
    ).toEqual({});
    expect(
      getPublicDashboardWidgetSettings(DashboardComponentType.LogChart, {
        title: undefined,
      }),
    ).toEqual({});
  });

  test("serves only own keys: nothing inherited, and no __proto__", () => {
    const inherited: Record<string, unknown> = Object.create({
      title: "inherited",
      text: "inherited",
    }) as Record<string, unknown>;

    expect(
      getPublicDashboardWidgetSettings(
        DashboardComponentType.LogChart,
        inherited,
      ),
    ).toEqual({});
    expect(
      getPublicDashboardWidgetSettings(DashboardComponentType.Text, inherited),
    ).toEqual({});

    const parsed: Record<string, unknown> = JSON.parse(
      '{"__proto__": {"title": "x"}, "constructor": "y", "text": "Hello"}',
    ) as Record<string, unknown>;

    const served: Record<string, unknown> = getPublicDashboardWidgetSettings(
      DashboardComponentType.Text,
      parsed,
    );

    expect(Object.keys(served)).toEqual(["text"]);
    expect(Object.getPrototypeOf(served)).toBe(Object.prototype);
  });

  test("serves nothing of a type it serves nothing of: a Data Source widget, a type no board draws, no type", () => {
    const stored: Record<string, unknown> = {
      title: "x",
      text: "y",
      queries: [{ query: "SELECT secret" }],
      query: { query: "SELECT secret" },
    };

    for (const componentType of [
      ...DataSourceComponentTypes,
      "HostMetricChart",
      " Text ",
      "text",
      "",
      "constructor",
      "__proto__",
      "toString",
      undefined,
      null,
      7,
      ["Text"],
    ]) {
      expect([
        componentType,
        getPublicDashboardWidgetSettings(componentType, stored),
      ]).toEqual([componentType, {}]);
      expect([
        componentType,
        getPublicDashboardWidgetSettingsDecision(componentType),
      ]).toEqual([componentType, null]);
    }
  });

  describe("an HTML widget's script, which the page builds into the widget only while scripts may run", () => {
    const HTML: Record<string, unknown> = {
      html: "<p>{{cluster}}</p>",
      css: "p { color: red; }",
      javascript: "fetch('https://internal.example.com/secret-token')",
      allowForms: false,
      allowPopups: true,
    };

    test.each([true, "yes", 1, "false", {}, []])(
      "is served while Run JavaScript reads as on (%p)",
      (allowScripts: unknown) => {
        expect(
          getPublicDashboardWidgetSettings(DashboardComponentType.Html, {
            ...HTML,
            allowScripts: allowScripts,
          }),
        ).toEqual({ ...HTML, allowScripts: allowScripts });
      },
    );

    test.each([false, "", 0, null])(
      "is not served while it reads as off (%p)",
      (allowScripts: unknown) => {
        const served: Record<string, unknown> =
          getPublicDashboardWidgetSettings(DashboardComponentType.Html, {
            ...HTML,
            allowScripts: allowScripts,
          });

        expect(served).toEqual({
          html: HTML["html"],
          css: HTML["css"],
          allowForms: false,
          allowPopups: true,
          allowScripts: allowScripts,
        });
        expect(JSON.stringify(served)).not.toContain("secret-token");
      },
    );

    test("is not served when the widget does not say", () => {
      const served: Record<string, unknown> = getPublicDashboardWidgetSettings(
        DashboardComponentType.Html,
        HTML,
      );

      expect(Object.keys(served).sort()).toEqual([
        "allowForms",
        "allowPopups",
        "css",
        "html",
      ]);
    });
  });
});

describe("every field of a variable is decided, for every type of it", () => {
  test("the declaration is read: the query the issue names is among its fields", () => {
    expect(declaredVariableFields()).toEqual(
      expect.arrayContaining([
        "id",
        "name",
        "type",
        "query",
        "customListValues",
        "attributeKey",
        "labelOptions",
      ]),
    );
  });

  test("every type has the fields it adds, and every field is served to some type or withheld from all", () => {
    expect(Object.keys(PUBLIC_DASHBOARD_VARIABLE_TYPE_FIELDS).sort()).toEqual(
      Object.values(DashboardVariableType).sort(),
    );

    const decided: Array<string> = [
      ...PUBLIC_DASHBOARD_VARIABLE_FIELDS,
      ...Object.values(PUBLIC_DASHBOARD_VARIABLE_TYPE_FIELDS).flat(),
      ...PUBLIC_DASHBOARD_UNKNOWN_VARIABLE_TYPE_FIELDS,
      ...PUBLIC_DASHBOARD_WITHHELD_VARIABLE_FIELDS,
    ];

    expect([...new Set(decided)].sort()).toEqual(
      [...declaredVariableFields()].sort(),
    );
  });

  test("a field is served to every variable, or added by a type, or withheld - never two of these", () => {
    const common: Set<string> = new Set(PUBLIC_DASHBOARD_VARIABLE_FIELDS);
    const withheld: Set<string> = new Set(
      PUBLIC_DASHBOARD_WITHHELD_VARIABLE_FIELDS,
    );

    for (const fields of [
      ...Object.values(PUBLIC_DASHBOARD_VARIABLE_TYPE_FIELDS),
      PUBLIC_DASHBOARD_UNKNOWN_VARIABLE_TYPE_FIELDS,
    ]) {
      for (const field of fields) {
        expect([field, common.has(field), withheld.has(field)]).toEqual([
          field,
          false,
          false,
        ]);
      }
    }

    for (const field of withheld) {
      expect([field, common.has(field)]).toEqual([field, false]);
    }
  });

  test("a Query variable's query is served to no type of variable", () => {
    expect(PUBLIC_DASHBOARD_WITHHELD_VARIABLE_FIELDS).toEqual(["query"]);

    for (const type of [
      ...Object.values(DashboardVariableType),
      "Some type from the future",
      undefined,
    ]) {
      expect([type, getPublicDashboardVariableFields(type)]).toEqual([
        type,
        expect.not.arrayContaining(["query"]),
      ]);
    }
  });

  test.each([
    [DashboardVariableType.CustomList, ["customListValues"]],
    [DashboardVariableType.TextInput, ["customListValues"]],
    [DashboardVariableType.Query, ["customListValues"]],
    [DashboardVariableType.TelemetryAttribute, ["attributeKey"]],
    [DashboardVariableType.ProjectLabel, ["labelOptions"]],
    ["Some type from the future", ["customListValues"]],
    [" Custom List ", ["customListValues"]],
    [undefined, ["customListValues"]],
    [7, ["customListValues"]],
  ])(
    "a variable of type %p is served every variable's fields and %p",
    (type: unknown, typeFields: Array<string>) => {
      expect(getPublicDashboardVariableFields(type)).toEqual([
        "id",
        "name",
        "label",
        "type",
        "selectedValue",
        "selectedValues",
        "isMultiSelect",
        "defaultValue",
        ...typeFields,
      ]);
    },
  );
});

describe("getPublicDashboardVariable", () => {
  // A variable holding every field, and two no variable has.
  const everyField: (type: unknown) => DashboardVariable = (
    type: unknown,
  ): DashboardVariable => {
    return {
      id: "cluster-id",
      name: "cluster",
      label: "Cluster",
      type: type,
      customListValues: "prod,staging",
      labelOptions: [
        { label: "Production", value: "0f8fad5b-d9cb-469f-a165-70867728950e" },
      ],
      query: "SELECT DISTINCT cluster FROM internal_billing.accounts",
      attributeKey: "k8s.cluster.name",
      selectedValue: "prod",
      selectedValues: ["prod"],
      isMultiSelect: false,
      defaultValue: "staging",
      notes: "for the owner only",
      internalQuery: "SELECT secret",
    } as unknown as DashboardVariable;
  };

  test.each([
    ...Object.values(DashboardVariableType),
    "Some type from the future",
    undefined,
  ])(
    "a variable of type %p: its type's fields, each as handed in, and nothing else",
    (type: unknown) => {
      const variable: DashboardVariable = everyField(type);
      const served: DashboardVariable = getPublicDashboardVariable(variable);
      const fields: ReadonlyArray<string> =
        getPublicDashboardVariableFields(type);

      expect(Object.keys(served).sort()).toEqual(
        fields
          .filter((field: string): boolean => {
            return (
              (variable as unknown as Record<string, unknown>)[field] !==
              undefined
            );
          })
          .sort(),
      );

      for (const field of Object.keys(served)) {
        expect([
          field,
          (served as unknown as Record<string, unknown>)[field],
        ]).toEqual([
          field,
          (variable as unknown as Record<string, unknown>)[field],
        ]);
      }

      const json: string = JSON.stringify(served);

      expect(json).not.toContain("internal_billing");
      expect(json).not.toContain("SELECT");
      expect(json).not.toContain("for the owner only");

      // A new object: the variable handed in is not changed.
      expect(served).not.toBe(variable);
      expect(variable.query).toBe(
        "SELECT DISTINCT cluster FROM internal_billing.accounts",
      );
    },
  );

  test("a Query variable is served its picker, and never its query", () => {
    expect(
      getPublicDashboardVariable({
        id: "region",
        name: "region",
        type: DashboardVariableType.Query,
        query:
          "SELECT region FROM internal.customers WHERE plan = 'enterprise'",
        defaultValue: "eu",
      }),
    ).toEqual({
      id: "region",
      name: "region",
      type: DashboardVariableType.Query,
      defaultValue: "eu",
    });
  });

  test("a field left out is not served as one", () => {
    expect(
      getPublicDashboardVariable({
        id: "a",
        name: "a",
        type: DashboardVariableType.TextInput,
        label: undefined,
      }),
    ).toEqual({ id: "a", name: "a", type: DashboardVariableType.TextInput });
  });
});
