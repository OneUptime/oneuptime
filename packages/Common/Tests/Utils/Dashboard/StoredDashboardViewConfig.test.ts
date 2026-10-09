import { describe, expect, test } from "@jest/globals";
import StoredDashboardViewConfig, {
  FALLBACK_WIDGET_HEIGHT_IN_DASHBOARD_UNITS,
  FALLBACK_WIDGET_WIDTH_IN_DASHBOARD_UNITS,
} from "../../../Utils/Dashboard/StoredDashboardViewConfig";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType, {
  isDashboardComponentType,
} from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import {
  DashboardTemplate,
  DashboardTemplates,
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import DashboardVariableUrlState from "../../../Utils/Dashboard/VariableUrlState";
import GridLayoutUtil from "../../../Utils/Dashboard/GridLayout";
import DashboardViewConfigUtil from "../../../Utils/Dashboard/DashboardViewConfig";

/*
 * Issue #4571: a dashboard did not open - "Cannot read properties of
 * undefined (reading 'length')" in DashboardCanvas - because its stored
 * config had no `components` at the top. The config is a JSON column anyone
 * can write (the API, Terraform, workflows, scripts), and the API reference
 * itself documented it wrapped in `{"_type": "DashboardViewConfig", "value":
 * {...}}`, which the server stores as sent. StoredDashboardViewConfig is the
 * one reader of a stored config: these tests hand it every shape found in
 * the code, the reference, older versions and the issue, and pin what the
 * dashboard then draws.
 */

const TEXT_WIDGET_ID: string = "550e8400-e29b-41d4-a716-446655440000";
const SECOND_WIDGET_ID: string = "550e8400-e29b-41d4-a716-446655440001";

// The widget the API reference's example held, as an API user writes it.
function apiTextWidget(id: string = TEXT_WIDGET_ID): JSONObject {
  return {
    componentId: id,
    componentType: "Text",
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    arguments: { text: "Hello from the envelope" },
  };
}

// The config as the dashboard editor saves it.
function canonicalWidget(
  id: string,
  componentType: string = DashboardComponentType.Text,
): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: new ObjectID(id),
    componentType: componentType as DashboardComponentType,
    topInDashboardUnits: 1,
    leftInDashboardUnits: 2,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 3,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 1,
    arguments: { text: "Checkout service", isBold: true },
  };
}

function canonicalConfig(
  components: Array<DashboardBaseComponent>,
): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    components: components,
    heightInDashboardUnits: 60,
  };
}

function idsOf(config: DashboardViewConfig): Array<string> {
  return config.components.map((component: DashboardBaseComponent) => {
    return component.componentId.toString();
  });
}

function typesOf(config: DashboardViewConfig): Array<string> {
  return config.components.map((component: DashboardBaseComponent) => {
    return String(component.componentType);
  });
}

// The serialized JSON of a config, for comparing what would be saved.
function savedForm(config: unknown): unknown {
  return JSON.parse(
    JSON.stringify(JSONFunctions.serializeValue(config as any)),
  );
}

const UUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * What the canvas, the grid layout and every widget read off a config
 * without checking. A config that passes this can be drawn.
 */
function expectDrawable(config: DashboardViewConfig): void {
  expect(config._type).toBe(ObjectType.DashboardViewConfig);
  expect(Array.isArray(config.components)).toBe(true);
  expect(Number.isFinite(config.heightInDashboardUnits)).toBe(true);

  const ids: Set<string> = new Set<string>();

  for (const component of config.components) {
    expect(component._type).toBe(ObjectType.DashboardComponent);
    expect(component.componentId).toBeInstanceOf(ObjectID);
    expect(component.componentId.toString()).not.toBe("");
    ids.add(component.componentId.toString());
    expect(typeof component.componentType).toBe("string");

    for (const value of [
      component.topInDashboardUnits,
      component.leftInDashboardUnits,
      component.widthInDashboardUnits,
      component.heightInDashboardUnits,
      component.minWidthInDashboardUnits,
      component.minHeightInDashboardUnits,
    ]) {
      expect(typeof value).toBe("number");
      expect(Number.isFinite(value)).toBe(true);
    }

    expect(component.arguments).toBeDefined();
    expect(typeof component.arguments).toBe("object");
    expect(Array.isArray(component.arguments)).toBe(false);
  }

  // Unique ids: the canvas keys, selects and deletes widgets by them.
  expect(ids.size).toBe(config.components.length);

  // And the grid layout engine takes it as it is.
  expect(() => {
    GridLayoutUtil.normalize(
      GridLayoutUtil.fromDashboardComponents(config.components),
    );
  }).not.toThrow();
}

describe("issue #4571: the configs that kept a dashboard from opening", () => {
  test("the API reference's envelope opens with its widget", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      _type: "DashboardViewConfig",
      value: { components: [apiTextWidget()] },
    });

    expectDrawable(config);
    expect(typesOf(config)).toEqual([DashboardComponentType.Text]);
    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID]);
    expect(config.components[0]!.arguments).toEqual({
      text: "Hello from the envelope",
    });
    expect(config.components[0]!.widthInDashboardUnits).toBe(6);
    expect(config.components[0]!.heightInDashboardUnits).toBe(4);
  });

  test("a config with no widget list opens empty", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({});

    expectDrawable(config);
    expect(config.components).toEqual([]);
    expect(config.heightInDashboardUnits).toBe(
      DefaultDashboardSize.heightInDashboardUnits,
    );
  });

  test("a config stored as JSON text opens with its widgets", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read(
      JSON.stringify({ components: [apiTextWidget()] }),
    );

    expectDrawable(config);
    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID]);
  });

  test("a widget saved without arguments gets an empty set to read from", () => {
    const widget: JSONObject = apiTextWidget();
    delete widget["arguments"];

    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: [widget],
    });

    expectDrawable(config);
    expect(config.components[0]!.arguments).toEqual({});
  });
});

describe("read never throws, and always gives a board the canvas can draw", () => {
  const ANYTHING: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["empty text", ""],
    ["blank text", "   "],
    ["text that is not JSON", "not json"],
    ["JSON text of a number", "42"],
    ["JSON text of null", "null"],
    ["JSON text of a list of numbers", "[1, 2, 3]"],
    ["a number", 42],
    ["zero", 0],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["true", true],
    ["false", false],
    ["an empty list", []],
    ["a list of junk", [null, 1, "x", [], true]],
    ["an empty object", {}],
    ["components null", { components: null }],
    ["components text", { components: "x" }],
    ["components a number", { components: 7 }],
    ["components an empty object", { components: {} }],
    ["components true", { components: true }],
    ["a Date", new Date(0)],
    ["an ObjectID", ObjectID.generate()],
    ["an envelope of nothing", { _type: "DashboardViewConfig", value: null }],
    ["an envelope of text", { _type: "DashboardViewConfig", value: "x" }],
    [
      "an envelope of an envelope",
      {
        _type: "DashboardViewConfig",
        value: { _type: "DashboardViewConfig", value: { components: [] } },
      },
    ],
    [
      "widgets that are all junk",
      { components: [null, undefined, 1, "x", true, [], [[]]] },
    ],
    [
      "widgets with every field wrong",
      {
        components: [
          {
            componentId: { nested: true },
            componentType: 42,
            topInDashboardUnits: "top",
            leftInDashboardUnits: null,
            widthInDashboardUnits: NaN,
            heightInDashboardUnits: Infinity,
            minWidthInDashboardUnits: {},
            minHeightInDashboardUnits: [],
            arguments: "args",
          },
        ],
        heightInDashboardUnits: "tall",
        refreshInterval: 99,
        variables: "vars",
      },
    ],
  ];

  test.each(ANYTHING)("%s", (_name: string, value: unknown) => {
    let config: DashboardViewConfig | null = null;

    expect(() => {
      config = StoredDashboardViewConfig.read(value);
    }).not.toThrow();

    expectDrawable(config!);
  });

  test.each(ANYTHING)(
    "%s reads the same a second time (read is idempotent)",
    (_name: string, value: unknown) => {
      const once: DashboardViewConfig = StoredDashboardViewConfig.read(value);
      const twice: DashboardViewConfig = StoredDashboardViewConfig.read(once);

      expect(savedForm(twice)).toEqual(savedForm(once));
    },
  );
});

describe("where the widgets are", () => {
  test("the envelope without its _type", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      value: { components: [apiTextWidget()] },
    });

    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID]);
  });

  test("the envelope stored as JSON text", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read(
      JSON.stringify({
        _type: "DashboardViewConfig",
        value: { components: [apiTextWidget()] },
      }),
    );

    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID]);
  });

  test("an envelope whose value is JSON text", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      _type: "DashboardViewConfig",
      value: JSON.stringify({ components: [apiTextWidget()] }),
    });

    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID]);
  });

  test("a config encoded twice", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read(
      JSON.stringify(JSON.stringify({ components: [apiTextWidget()] })),
    );

    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID]);
  });

  test("gives up on a value wrapped deeper than any real config, without looping", () => {
    let value: unknown = { components: [apiTextWidget()] };

    for (let layer: number = 0; layer < 12; layer++) {
      value = JSON.stringify(value);
    }

    const config: DashboardViewConfig = StoredDashboardViewConfig.read(value);

    expectDrawable(config);
    expect(config.components).toEqual([]);
  });

  test("a bare list is the widget list", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read([
      apiTextWidget(),
      apiTextWidget(SECOND_WIDGET_ID),
    ]);

    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID, SECOND_WIDGET_ID]);
  });

  test("a widget list stored as JSON text", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: JSON.stringify([apiTextWidget()]),
    });

    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID]);
  });

  test("a widget list keyed 0, 1, 2 ... is read in numeric order", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: {
        "10": apiTextWidget("00000000-0000-4000-a000-000000000010"),
        "2": apiTextWidget("00000000-0000-4000-a000-000000000002"),
        "0": apiTextWidget("00000000-0000-4000-a000-000000000000"),
        "1": apiTextWidget("00000000-0000-4000-a000-000000000001"),
      },
    });

    expect(idsOf(config)).toEqual([
      "00000000-0000-4000-a000-000000000000",
      "00000000-0000-4000-a000-000000000001",
      "00000000-0000-4000-a000-000000000002",
      "00000000-0000-4000-a000-000000000010",
    ]);
  });

  test("a single widget where the list should be", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: apiTextWidget(),
    });

    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID]);
  });

  test("an object that is neither a list nor a widget holds no widgets", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: { layout: "grid", a: apiTextWidget() },
    });

    expect(config.components).toEqual([]);
  });

  test("a real config that also has a `value` key is not taken for an envelope", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      _type: "DashboardViewConfig",
      components: [apiTextWidget()],
      value: { components: [apiTextWidget(SECOND_WIDGET_ID)] },
    });

    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID]);
  });

  test("another type's envelope is not opened", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      _type: "MonitorSteps",
      value: { components: [apiTextWidget()] },
    });

    expect(config.components).toEqual([]);
  });

  test("a widget stored as JSON text is read as the widget", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: [JSON.stringify(apiTextWidget())],
    });

    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID]);
    expect(config.components[0]!.arguments).toEqual({
      text: "Hello from the envelope",
    });
  });

  test("a widget in the reference's DashboardComponent envelope is read as the widget inside", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: [
        { _type: "DashboardComponent", value: apiTextWidget() },
        { value: apiTextWidget(SECOND_WIDGET_ID) },
      ],
    });

    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID, SECOND_WIDGET_ID]);
    expect(typesOf(config)).toEqual([
      DashboardComponentType.Text,
      DashboardComponentType.Text,
    ]);
  });

  test("a widget with its own type is never taken for an envelope", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: [
        {
          ...apiTextWidget(),
          value: { componentType: DashboardComponentType.DataSourceChart },
        },
      ],
    });

    expect(typesOf(config)).toEqual([DashboardComponentType.Text]);
  });
});

describe("unwrap: the object the widgets are on", () => {
  test("hands back the same object when the config is already one", () => {
    const stored: JSONObject = { components: [], layout: "grid" };

    expect(StoredDashboardViewConfig.unwrap(stored)).toBe(stored);
  });

  test("hands back the envelope's own value object", () => {
    const inner: JSONObject = { components: [] };

    expect(
      StoredDashboardViewConfig.unwrap({
        _type: "DashboardViewConfig",
        value: inner,
      }),
    ).toBe(inner);
  });

  test.each([undefined, null, 42, true, "nope", ObjectID.generate()])(
    "reads %p as an empty object",
    (value: unknown) => {
      expect(StoredDashboardViewConfig.unwrap(value)).toEqual({});
    },
  );
});

describe("widgets", () => {
  test("entries that are not widgets are left out, the widgets around them kept in order", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: [
        null,
        apiTextWidget(),
        42,
        "x",
        undefined,
        [],
        true,
        apiTextWidget(SECOND_WIDGET_ID),
      ],
    });

    expect(idsOf(config)).toEqual([TEXT_WIDGET_ID, SECOND_WIDGET_ID]);
  });

  test("a type this version does not draw is kept as stored, to be shown as such and to survive a save", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: [
        { ...apiTextWidget(), componentType: "HostMetricChart" },
        {
          ...apiTextWidget(SECOND_WIDGET_ID),
          componentType: "SomeWidgetFromANewerVersion",
        },
      ],
    });

    expect(typesOf(config)).toEqual([
      "HostMetricChart",
      "SomeWidgetFromANewerVersion",
    ]);
    expect(isDashboardComponentType(config.components[0]!.componentType)).toBe(
      false,
    );
  });

  test("a type is matched exactly: whitespace and case are kept, not corrected", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: [
        { ...apiTextWidget(), componentType: " Chart " },
        { ...apiTextWidget(SECOND_WIDGET_ID), componentType: "chart" },
      ],
    });

    expect(typesOf(config)).toEqual([" Chart ", "chart"]);
  });

  test.each([undefined, null, 42, true, {}, []])(
    "a type stored as %p reads as no type",
    (componentType: unknown) => {
      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [{ ...apiTextWidget(), componentType }],
      });

      expect(typesOf(config)).toEqual([""]);
    },
  );

  test("keys this version does not know are kept on the widget", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: [{ ...apiTextWidget(), addedByANewerVersion: { a: 1 } }],
    });

    expect(
      (config.components[0] as unknown as JSONObject)["addedByANewerVersion"],
    ).toEqual({ a: 1 });
  });

  describe("ids", () => {
    test.each([
      ["an ObjectID", new ObjectID(TEXT_WIDGET_ID)],
      ["a string", TEXT_WIDGET_ID],
      ["a padded string", `  ${TEXT_WIDGET_ID}  `],
      [
        "the stored ObjectID JSON",
        { _type: "ObjectID", value: TEXT_WIDGET_ID },
      ],
      ["a value object without _type", { value: TEXT_WIDGET_ID }],
    ])("an id stored as %s is kept", (_name: string, componentId: unknown) => {
      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [{ ...apiTextWidget(), componentId }],
      });

      expect(idsOf(config)).toEqual([TEXT_WIDGET_ID]);
      expect(config.components[0]!.componentId).toBeInstanceOf(ObjectID);
    });

    test("a numeric id is kept as text", () => {
      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [{ ...apiTextWidget(), componentId: 7 }],
      });

      expect(idsOf(config)).toEqual(["7"]);
    });

    test.each([
      ["missing", undefined],
      ["null", null],
      ["empty", ""],
      ["blank", "   "],
      ["an object", { nested: true }],
      ["another type's JSON", { _type: "Email", value: TEXT_WIDGET_ID }],
      ["NaN", NaN],
    ])(
      "a widget whose id is %s gets a derived UUID",
      (_name: string, componentId: unknown) => {
        const config: DashboardViewConfig = StoredDashboardViewConfig.read({
          components: [{ ...apiTextWidget(), componentId }],
        });

        expect(idsOf(config)).toEqual(["00000000-0000-4000-8000-000000000001"]);
        expect(UUID.test(idsOf(config)[0]!)).toBe(true);
      },
    );

    test("the second widget with an id the first already has gets a derived one", () => {
      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [
          apiTextWidget(),
          apiTextWidget(),
          apiTextWidget(SECOND_WIDGET_ID),
          apiTextWidget(),
        ],
      });

      expect(idsOf(config)).toEqual([
        TEXT_WIDGET_ID,
        "00000000-0000-4000-8000-000000000001",
        SECOND_WIDGET_ID,
        "00000000-0000-4000-8000-000000000002",
      ]);
    });

    test("a derived id never takes an id a later widget really has", () => {
      const takenByALaterWidget: string =
        "00000000-0000-4000-8000-000000000001";

      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [
          { ...apiTextWidget(), componentId: undefined },
          apiTextWidget(takenByALaterWidget),
        ],
      });

      expect(idsOf(config)).toEqual([
        "00000000-0000-4000-8000-000000000002",
        takenByALaterWidget,
      ]);
    });

    test("derived ids are the same on every read of the same config", () => {
      const stored: JSONObject = {
        components: [
          { ...apiTextWidget(), componentId: undefined },
          { ...apiTextWidget(), componentId: undefined },
          apiTextWidget(),
          apiTextWidget(),
        ],
      };

      expect(idsOf(StoredDashboardViewConfig.read(stored))).toEqual(
        idsOf(StoredDashboardViewConfig.read(stored)),
      );
    });

    test("ids are derived over the widgets only: junk between them does not shift them", () => {
      const withJunk: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [
          null,
          { ...apiTextWidget(), componentId: undefined },
          7,
          { ...apiTextWidget(), componentId: undefined },
        ],
      });
      const withoutJunk: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [
          { ...apiTextWidget(), componentId: undefined },
          { ...apiTextWidget(), componentId: undefined },
        ],
      });

      expect(idsOf(withJunk)).toEqual(idsOf(withoutJunk));
    });
  });

  describe("position and size", () => {
    test("numbers written as text are read as numbers", () => {
      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [
          {
            ...apiTextWidget(),
            topInDashboardUnits: "2",
            leftInDashboardUnits: " 3 ",
            widthInDashboardUnits: "4",
            heightInDashboardUnits: "5.5",
            minWidthInDashboardUnits: "2",
            minHeightInDashboardUnits: "1",
          },
        ],
      });

      expect(config.components[0]).toMatchObject({
        topInDashboardUnits: 2,
        leftInDashboardUnits: 3,
        widthInDashboardUnits: 4,
        heightInDashboardUnits: 5.5,
        minWidthInDashboardUnits: 2,
        minHeightInDashboardUnits: 1,
      });
    });

    test.each([
      ["missing", undefined],
      ["null", null],
      ["NaN", NaN],
      ["Infinity", Infinity],
      ["text that is no number", "wide"],
      ["blank text", " "],
      ["an object", {}],
    ])(
      "a size or position that is %s falls back to a readable default",
      (_name: string, value: unknown) => {
        const config: DashboardViewConfig = StoredDashboardViewConfig.read({
          components: [
            {
              ...apiTextWidget(),
              topInDashboardUnits: value,
              leftInDashboardUnits: value,
              widthInDashboardUnits: value,
              heightInDashboardUnits: value,
              minWidthInDashboardUnits: value,
              minHeightInDashboardUnits: value,
            },
          ],
        });

        expect(config.components[0]).toMatchObject({
          topInDashboardUnits: 0,
          leftInDashboardUnits: 0,
          widthInDashboardUnits: FALLBACK_WIDGET_WIDTH_IN_DASHBOARD_UNITS,
          heightInDashboardUnits: FALLBACK_WIDGET_HEIGHT_IN_DASHBOARD_UNITS,
          minWidthInDashboardUnits: 1,
          minHeightInDashboardUnits: 1,
        });
      },
    );

    test("the fallback size is the size most widgets are added at", () => {
      expect(FALLBACK_WIDGET_WIDTH_IN_DASHBOARD_UNITS).toBe(6);
      expect(FALLBACK_WIDGET_HEIGHT_IN_DASHBOARD_UNITS).toBe(4);
    });

    test("numbers out of range are left to the layout engine, which clamps them when the board is edited", () => {
      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [
          {
            ...apiTextWidget(),
            leftInDashboardUnits: -3,
            widthInDashboardUnits: 40,
          },
        ],
      });

      expect(config.components[0]!.leftInDashboardUnits).toBe(-3);
      expect(config.components[0]!.widthInDashboardUnits).toBe(40);

      const healed: DashboardViewConfig =
        DashboardViewConfigUtil.normalizeLayout(config);

      expect(healed.components[0]!.leftInDashboardUnits).toBe(0);
      expect(healed.components[0]!.widthInDashboardUnits).toBe(12);
    });
  });

  describe("arguments", () => {
    test.each([
      ["missing", undefined],
      ["null", null],
      ["a list", [1, 2]],
      ["text that is not JSON", "isBold"],
      ["a number", 5],
      ["true", true],
    ])(
      "arguments that are %s read as none",
      (_name: string, value: unknown) => {
        const config: DashboardViewConfig = StoredDashboardViewConfig.read({
          components: [{ ...apiTextWidget(), arguments: value }],
        });

        expect(config.components[0]!.arguments).toEqual({});
      },
    );

    test("arguments stored as JSON text are read", () => {
      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [
          {
            ...apiTextWidget(),
            arguments: JSON.stringify({ text: "From text", isItalic: true }),
          },
        ],
      });

      expect(config.components[0]!.arguments).toEqual({
        text: "From text",
        isItalic: true,
      });
    });

    test("stored ObjectIDs and dates inside a widget are read as the objects they were", () => {
      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [
          {
            ...apiTextWidget(),
            componentId: { _type: "ObjectID", value: TEXT_WIDGET_ID },
            arguments: {
              monitorId: { _type: "ObjectID", value: SECOND_WIDGET_ID },
              since: { _type: "DateTime", value: "2026-01-01T00:00:00.000Z" },
            },
          },
        ],
      });

      const widgetArguments: JSONObject = config.components[0]!
        .arguments as JSONObject;

      expect(widgetArguments["monitorId"]).toBeInstanceOf(ObjectID);
      expect(String(widgetArguments["monitorId"])).toBe(SECOND_WIDGET_ID);
      expect(widgetArguments["since"]).toBeInstanceOf(Date);
    });

    test("a widget whose stored JSON cannot be read back keeps its JSON, and the others are read", () => {
      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [
          {
            ...apiTextWidget(),
            arguments: {
              owner: { _type: "Email", value: "not an email" },
            },
          },
          {
            ...apiTextWidget(SECOND_WIDGET_ID),
            arguments: {
              monitorId: { _type: "ObjectID", value: TEXT_WIDGET_ID },
            },
          },
        ],
      });

      expectDrawable(config);
      expect(idsOf(config)).toEqual([TEXT_WIDGET_ID, SECOND_WIDGET_ID]);
      expect((config.components[0]!.arguments as JSONObject)["owner"]).toEqual({
        _type: "Email",
        value: "not an email",
      });
      expect(
        (config.components[1]!.arguments as JSONObject)["monitorId"],
      ).toBeInstanceOf(ObjectID);
    });
  });
});

describe("the board", () => {
  test.each([
    ["a number", 42, 42],
    ["text", "30", 30],
    ["missing", undefined, DefaultDashboardSize.heightInDashboardUnits],
    ["zero", 0, DefaultDashboardSize.heightInDashboardUnits],
    ["negative", -5, DefaultDashboardSize.heightInDashboardUnits],
    ["NaN", NaN, DefaultDashboardSize.heightInDashboardUnits],
    [
      "text that is no number",
      "tall",
      DefaultDashboardSize.heightInDashboardUnits,
    ],
  ])(
    "a board height that is %s reads as %p",
    (_name: string, value: unknown, expected: number) => {
      expect(
        StoredDashboardViewConfig.read({
          components: [],
          heightInDashboardUnits: value,
        }).heightInDashboardUnits,
      ).toBe(expected);
    },
  );

  test.each(Object.values(AutoRefreshInterval))(
    "the auto-refresh interval %s is kept",
    (interval: AutoRefreshInterval) => {
      expect(
        StoredDashboardViewConfig.read({
          components: [],
          refreshInterval: interval,
        }).refreshInterval,
      ).toBe(interval);
    },
  );

  test.each([["2m"], [42], [null], [{}], ["OFF"]])(
    "an auto-refresh interval of %p is dropped, so the board does not refresh itself",
    (refreshInterval: unknown) => {
      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [],
        refreshInterval,
      });

      expect(config.refreshInterval).toBeUndefined();
      expect(
        Object.prototype.hasOwnProperty.call(config, "refreshInterval"),
      ).toBe(false);
    },
  );

  test("keys this version does not know are kept on the board", () => {
    const config: DashboardViewConfig = StoredDashboardViewConfig.read({
      components: [],
      layout: "grid",
    });

    expect((config as unknown as JSONObject)["layout"]).toBe("grid");
  });

  test("the stored value is never changed", () => {
    const stored: JSONObject = {
      _type: "DashboardViewConfig",
      value: {
        components: [
          { ...apiTextWidget(), componentId: undefined, arguments: null },
          apiTextWidget(),
          apiTextWidget(),
          null,
        ],
        variables: [{ name: 5 }],
        refreshInterval: "never",
      },
    };
    const before: string = JSON.stringify(stored);

    StoredDashboardViewConfig.read(stored);

    expect(JSON.stringify(stored)).toBe(before);
  });
});

describe("variables", () => {
  function readVariables(variables: unknown): Array<DashboardVariable> {
    return (
      StoredDashboardViewConfig.read({ components: [], variables }).variables ||
      []
    );
  }

  test.each([[undefined], [null], ["vars"], [{}], [7]])(
    "variables stored as %p read as none",
    (variables: unknown) => {
      const config: DashboardViewConfig = StoredDashboardViewConfig.read({
        components: [],
        variables,
      });

      expect(config.variables).toBeUndefined();
    },
  );

  test("variables stored as JSON text are read", () => {
    expect(
      readVariables(
        JSON.stringify([{ id: "a", name: "cluster", type: "Text Input" }]),
      ),
    ).toEqual([{ id: "a", name: "cluster", type: "Text Input" }]);
  });

  test("a variable as the editor saves it reads back unchanged", () => {
    const variable: DashboardVariable = {
      id: ObjectID.generate().toString(),
      name: "cluster",
      label: "Cluster",
      type: DashboardVariableType.CustomList,
      customListValues: "prod,staging",
      selectedValue: "prod",
      defaultValue: "prod",
      isMultiSelect: false,
    };

    expect(readVariables([variable])).toEqual([variable]);
  });

  test("entries that are not variables are left out", () => {
    expect(
      readVariables([null, 1, "x", [], { id: "a", name: "env" }]).map(
        (variable: DashboardVariable) => {
          return variable.id;
        },
      ),
    ).toEqual(["a"]);
  });

  test("ids: kept, numbers as text, missing and repeated ones derived and unique", () => {
    const ids: Array<string> = readVariables([
      { id: "a", name: "one" },
      { id: 7, name: "two" },
      { name: "three" },
      { id: "a", name: "four" },
    ]).map((variable: DashboardVariable) => {
      return variable.id;
    });

    expect(ids).toEqual([
      "a",
      "7",
      "00000000-0000-4000-9000-000000000001",
      "00000000-0000-4000-9000-000000000002",
    ]);
  });

  test("the fields the toolbar splits, maps and prints have the types it reads them as", () => {
    const [variable] = readVariables([
      {
        id: "a",
        name: 5,
        label: { text: "x" },
        type: 9,
        customListValues: ["prod", 2, null, "staging"],
        labelOptions: [
          { label: "Prod", value: "p" },
          { value: "s" },
          { label: "no value" },
          null,
        ],
        selectedValue: 3,
        selectedValues: ["a", 1, null, { x: 1 }],
        defaultValue: null,
        query: true,
        attributeKey: [],
        isMultiSelect: "true",
      },
    ]);

    expect(variable).toEqual({
      id: "a",
      name: "5",
      customListValues: "prod,2,staging",
      labelOptions: [
        { label: "Prod", value: "p" },
        { label: "s", value: "s" },
      ],
      selectedValue: "3",
      selectedValues: ["a", "1"],
      query: "true",
      isMultiSelect: true,
    });
  });

  test.each([
    [true, true],
    [false, false],
    ["false", false],
    ["yes", undefined],
    [1, undefined],
  ])(
    "isMultiSelect stored as %p reads as %p",
    (stored: unknown, expected: boolean | undefined) => {
      expect(
        readVariables([{ id: "a", name: "x", isMultiSelect: stored }])[0]!
          .isMultiSelect,
      ).toBe(expected);
    },
  );

  test("the board's URL state takes malformed variables without throwing", () => {
    const variables: Array<DashboardVariable> = readVariables([
      { name: "cluster", isMultiSelect: "true", selectedValues: "prod" },
      { id: 5 },
      { id: "b", name: "env", customListValues: 12 },
    ]);

    expect(() => {
      DashboardVariableUrlState.applyUrlToVariables(
        variables,
        DashboardVariableUrlState.parseFromSearch("?var-cluster=a,b&var-env=x"),
      );
    }).not.toThrow();
  });
});

describe("canonical configs read back exactly as they are", () => {
  const TEMPLATES_WITH_WIDGETS: Array<DashboardTemplate> =
    DashboardTemplates.filter((template: DashboardTemplate) => {
      return template.type !== DashboardTemplateType.Blank;
    });

  test("there are templates to check", () => {
    expect(TEMPLATES_WITH_WIDGETS.length).toBeGreaterThan(5);
  });

  test.each(
    TEMPLATES_WITH_WIDGETS.map((template: DashboardTemplate) => {
      return [template.name, template.type];
    }),
  )("the %s template", (_name: string, templateType: DashboardTemplateType) => {
    const template: DashboardViewConfig | null =
      getTemplateConfig(templateType);

    expect(template).not.toBeNull();

    const read: DashboardViewConfig = StoredDashboardViewConfig.read(template);

    expectDrawable(read);
    expect(savedForm(read)).toEqual(savedForm(template));

    // And as it comes back from the database: the saved JSON.
    expect(
      savedForm(StoredDashboardViewConfig.read(savedForm(template))),
    ).toEqual(savedForm(template));
  });

  test("a board the editor built: widgets added one by one", () => {
    let config: DashboardViewConfig =
      DashboardViewConfigUtil.createDefaultDashboardViewConfig();

    for (const id of [TEXT_WIDGET_ID, SECOND_WIDGET_ID]) {
      config = DashboardViewConfigUtil.addComponentToDashboard({
        component: canonicalWidget(id),
        dashboardViewConfig: config,
      });
    }

    config = {
      ...config,
      refreshInterval: AutoRefreshInterval.FIVE_MINUTES,
      variables: [
        {
          id: "v1",
          name: "cluster",
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: "k8s.cluster.name",
        },
      ],
    };

    expect(savedForm(StoredDashboardViewConfig.read(config))).toEqual(
      savedForm(config),
    );
    expect(
      savedForm(StoredDashboardViewConfig.read(savedForm(config))),
    ).toEqual(savedForm(config));
  });

  test("the default empty board", () => {
    const empty: DashboardViewConfig =
      DashboardViewConfigUtil.createDefaultDashboardViewConfig();

    expect(savedForm(StoredDashboardViewConfig.read(empty))).toEqual(
      savedForm(empty),
    );
  });

  test("a widget of an unknown type survives a save unchanged", () => {
    const stored: DashboardViewConfig = canonicalConfig([
      canonicalWidget(TEXT_WIDGET_ID, "SomeWidgetFromANewerVersion"),
    ]);

    expect(savedForm(StoredDashboardViewConfig.read(stored))).toEqual(
      savedForm(stored),
    );
  });
});

describe("the ids every reader agrees on", () => {
  const MESSY: Array<unknown> = [
    null,
    { ...apiTextWidget(), componentId: undefined },
    apiTextWidget(),
    "junk",
    apiTextWidget(),
    { ...apiTextWidget(SECOND_WIDGET_ID) },
    { ...apiTextWidget(), componentId: "" },
  ];

  test("withComponentIds gives each widget the id read draws it under", () => {
    const fromEntries: Array<string> =
      StoredDashboardViewConfig.withComponentIds(MESSY)
        .filter((entry: unknown) => {
          return StoredDashboardViewConfig.isWidgetEntry(entry);
        })
        .map((entry: unknown) => {
          return StoredDashboardViewConfig.getComponentIdString(
            (entry as JSONObject)["componentId"],
          )!;
        });

    expect(fromEntries).toEqual(
      idsOf(StoredDashboardViewConfig.read({ components: MESSY })),
    );
  });

  test("a widget that already holds its id comes back as the same object; junk comes back as it is", () => {
    const entries: Array<unknown> =
      StoredDashboardViewConfig.withComponentIds(MESSY);

    expect(entries[0]).toBe(MESSY[0]);
    expect(entries[2]).toBe(MESSY[2]);
    expect(entries[3]).toBe(MESSY[3]);
    expect(entries[5]).toBe(MESSY[5]);

    // A copy for the ones given an id, never a change to the stored one.
    expect(entries[1]).not.toBe(MESSY[1]);
    expect((MESSY[1] as JSONObject)["componentId"]).toBeUndefined();
    expect(entries[4]).not.toBe(MESSY[4]);
  });

  test("getComponentIds names junk entries null and every widget uniquely", () => {
    const ids: Array<string | null> =
      StoredDashboardViewConfig.getComponentIds(MESSY);

    expect(ids[0]).toBeNull();
    expect(ids[3]).toBeNull();

    const widgetIds: Array<string> = ids.filter(
      (id: string | null): id is string => {
        return id !== null;
      },
    );

    expect(new Set(widgetIds).size).toBe(widgetIds.length);
    expect(widgetIds).toHaveLength(5);
  });
});

describe("isDashboardComponentType", () => {
  test.each(Object.values(DashboardComponentType))(
    "%s is a type this version draws",
    (componentType: DashboardComponentType) => {
      expect(isDashboardComponentType(componentType)).toBe(true);
    },
  );

  test.each([
    ["a removed type", "HostMetricChart"],
    ["a newer type", "SomeWidgetFromANewerVersion"],
    ["a padded type", " Chart "],
    ["the wrong case", "chart"],
    ["empty", ""],
    ["an Object.prototype key", "constructor"],
    ["__proto__", "__proto__"],
    ["toString", "toString"],
    ["a number", 1],
    ["null", null],
    ["undefined", undefined],
    ["an object", { componentType: "Chart" }],
  ])("%s is not", (_name: string, value: unknown) => {
    expect(isDashboardComponentType(value)).toBe(false);
  });
});
