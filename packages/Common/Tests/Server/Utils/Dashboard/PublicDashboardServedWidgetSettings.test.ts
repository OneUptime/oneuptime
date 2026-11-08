import { describe, expect, test } from "@jest/globals";
import PublicDashboardViewConfig from "../../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import DashboardComponentType, {
  DataSourceComponentTypes,
  isDashboardComponentType,
} from "../../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../../Types/Dashboard/DashboardViewConfig";
import {
  PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES,
  PUBLIC_DASHBOARD_WIDGET_SETTINGS,
  PublicDashboardServedWidgetType,
  PublicDashboardWidgetSettings,
  getPublicDashboardVariableFields,
  isPublicDashboardUndrawnWidgetType,
} from "../../../../Types/Dashboard/PublicDashboardServedSettings";
import { JSONObject } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import StoredDashboardViewConfig from "../../../../Utils/Dashboard/StoredDashboardViewConfig";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * Issue #6338: /view-config and /overview served anonymous visitors the
 * whole settings of the widgets a public dashboard cannot draw - the Log
 * Chart, Trace Chart, Trace Table, Security Events and Security Events
 * Flow widgets, each drawn as its title and a note that it is not
 * available on public dashboards - and every variable whole:
 *
 * - a log chart's `bodyContains` search text, its severity filters, its
 *   `attributeFilters` and legacy `attributeFilterQuery`;
 * - a trace chart's or table's `spanNameContains`, its `attributeFilters`
 *   (`{"url.host": "internal.example.com"}`) and its `groupByAttribute`;
 * - a security events widget's `messageContains` and its class and
 *   severity filters;
 * - a legacy Query variable's ClickHouse `query`, which no toolbar runs.
 *
 * The docs promise "Each widget publishes only what it draws". Now every
 * widget is served only the settings its type is served, and every
 * variable only the fields its type is served
 * (Types/Dashboard/PublicDashboardServedSettings), as stored. These tests
 * read that table, so a type, a setting or a field added later is covered
 * the day it is added.
 */

const VISIBLE_TITLE: string = "Checkout errors";

type ServedWidget = Record<string, unknown>;

function decisionOf(componentType: string): PublicDashboardWidgetSettings {
  return PUBLIC_DASHBOARD_WIDGET_SETTINGS[
    componentType as PublicDashboardServedWidgetType
  ];
}

// The settings a type is served: as stored, or while another is on.
function servedKeysOf(componentType: string): Array<string> {
  const decision: PublicDashboardWidgetSettings = decisionOf(componentType);

  return [...decision.served, ...Object.keys(decision.servedWhileOn || {})];
}

// Every setting a type has: served, or withheld.
function settingsOf(componentType: string): Array<string> {
  return [...servedKeysOf(componentType), ...decisionOf(componentType).withheld];
}

function widgetOf(
  componentType: string,
  settings: unknown,
  componentId: string = ObjectID.generate().toString(),
): JSONObject {
  return {
    _type: "DashboardComponent",
    componentId: componentId,
    componentType: componentType,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: settings as JSONObject,
  };
}

function configOf(
  components: Array<unknown>,
  variables?: Array<unknown> | string | undefined,
): DashboardViewConfig {
  return {
    _type: "DashboardViewConfig",
    heightInDashboardUnits: 24,
    components: components,
    ...(variables === undefined ? {} : { variables: variables }),
  } as unknown as DashboardViewConfig;
}

// Everything /view-config sends, as text: what anyone with the link can read.
function servedJSON(stored: unknown): string {
  const served: DashboardViewConfig | null = PublicDashboardViewConfig.sanitize(
    stored as DashboardViewConfig,
  );

  return JSON.stringify(
    served ? JSONFunctions.serialize(served as unknown as JSONObject) : null,
  );
}

// What /view-config sends, parsed back.
function servedConfig(stored: unknown): JSONObject {
  return JSON.parse(servedJSON(stored)) as JSONObject;
}

function servedWidgets(stored: unknown): Array<ServedWidget> {
  return (servedConfig(stored)["components"] ||
    []) as unknown as Array<ServedWidget>;
}

// What the public page draws: the served config, sent as JSON, read.
function pageDraws(stored: unknown): DashboardViewConfig {
  return StoredDashboardViewConfig.read(JSON.parse(servedJSON(stored)));
}

// The settings a drawn widget was read with, as their JSON.
function settingsJSON(component: DashboardBaseComponent): unknown {
  return JSON.parse(
    JSON.stringify(
      JSONFunctions.serializeValue(component.arguments as JSONObject),
    ),
  );
}

type Layer = "envelope" | "envelope with text" | "text";

// A widget inside these layers, the first the outermost.
function wrapped(widget: JSONObject, layers: Array<Layer>): unknown {
  let current: unknown = widget;

  for (let index: number = layers.length - 1; index >= 0; index--) {
    const layer: Layer = layers[index]!;

    current =
      layer === "text"
        ? JSON.stringify(current)
        : {
            _type: "DashboardComponent",
            value:
              layer === "envelope with text"
                ? JSON.stringify(current)
                : current,
          };
  }

  return current;
}

/*
 * The shapes the API, Terraform, a workflow or a script can store a widget
 * in, every one of which every board reads as the widget itself: its
 * settings as an object or as JSON text, the widget as JSON text, in the
 * DashboardComponent envelope, the envelope's value as text, and as deep
 * as a board reads (five layers).
 */
interface StoredShape {
  name: string;
  store: (widget: JSONObject) => unknown;
}

const STORED_SHAPES: Array<StoredShape> = [
  {
    name: "as the editor saves it",
    store: (widget: JSONObject): unknown => {
      return widget;
    },
  },
  {
    name: "with its settings as JSON text",
    store: (widget: JSONObject): unknown => {
      return { ...widget, arguments: JSON.stringify(widget["arguments"]) };
    },
  },
  {
    name: "as JSON text",
    store: (widget: JSONObject): unknown => {
      return wrapped(widget, ["text"]);
    },
  },
  {
    name: "in the DashboardComponent envelope",
    store: (widget: JSONObject): unknown => {
      return wrapped(widget, ["envelope"]);
    },
  },
  {
    name: "in the envelope, its value as JSON text",
    store: (widget: JSONObject): unknown => {
      return wrapped(widget, ["envelope with text"]);
    },
  },
  {
    name: "five layers deep, as deep as a board reads",
    store: (widget: JSONObject): unknown => {
      return wrapped(
        { ...widget, arguments: JSON.stringify(widget["arguments"]) },
        ["text", "envelope", "envelope", "envelope with text", "envelope"],
      );
    },
  },
];

describe("issue #6338: a widget a public dashboard cannot draw is served its title, and nothing else", () => {
  test("the issue's own widgets: none of their search text, filters or grouping reaches a visitor", () => {
    const secrets: Array<string> = [
      "password reset for alice@example.com",
      "Error",
      "k8s.namespace.name",
      "payments-internal",
      "/internal/billing/charge",
      "internal.example.com",
      "enduser.id",
      "root login from 10.0.0.7",
      "Authentication",
      "Critical",
    ];

    const stored: DashboardViewConfig = configOf([
      widgetOf(DashboardComponentType.LogChart, {
        title: "Failures over time",
        bodyContains: "password reset for alice@example.com",
        severityFilters: ["Error"],
        attributeFilters: { "k8s.namespace.name": "payments-internal" },
        attributeFilterQuery: "k8s.namespace.name = payments-internal",
        chartType: "line",
      }),
      widgetOf(DashboardComponentType.TraceChart, {
        title: "Checkout latency",
        metric: "p99Duration",
        spanNameContains: "/internal/billing/charge",
        attributeFilters: { "url.host": "internal.example.com" },
        groupByAttribute: "enduser.id",
        colorsByGroup: { "enduser.id=alice": "#ff0000" },
      }),
      widgetOf(DashboardComponentType.TraceTable, {
        title: "Slowest endpoints",
        spanNameContains: "/internal/billing/charge",
        attributeFilters: "url.host=internal.example.com",
        groupByAttribute: "enduser.id",
        sort: "p99:desc",
      }),
      widgetOf(DashboardComponentType.SecurityEventsList, {
        title: "Logins",
        messageContains: "root login from 10.0.0.7",
        classNameFilters: ["Authentication"],
        severityFilters: ["Critical"],
        limit: 25,
      }),
      widgetOf(DashboardComponentType.SecurityEventsFlow, {
        title: "Event flow",
        severityFilters: ["Critical"],
        maxEvents: 900,
      }),
    ]);

    const json: string = servedJSON(stored);

    for (const secret of secrets) {
      expect([secret, json.includes(secret)]).toEqual([secret, false]);
    }

    expect(
      servedWidgets(stored).map((widget: ServedWidget): unknown => {
        return widget["arguments"];
      }),
    ).toEqual([
      { title: "Failures over time" },
      { title: "Checkout latency" },
      { title: "Slowest endpoints" },
      { title: "Logins" },
      { title: "Event flow" },
    ]);

    // The page draws each from its title, and the routes read the same.
    const drawn: DashboardViewConfig = pageDraws(stored);

    expect(
      drawn.components.map((component: DashboardBaseComponent): unknown => {
        return [component.componentType, component.arguments];
      }),
    ).toEqual([
      [DashboardComponentType.LogChart, { title: "Failures over time" }],
      [DashboardComponentType.TraceChart, { title: "Checkout latency" }],
      [DashboardComponentType.TraceTable, { title: "Slowest endpoints" }],
      [DashboardComponentType.SecurityEventsList, { title: "Logins" }],
      [DashboardComponentType.SecurityEventsFlow, { title: "Event flow" }],
    ]);
    expect(PublicDashboardViewConfig.getDrawnConfig(stored)).toEqual(drawn);
  });

  describe.each([...PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES])("%s", (componentType: DashboardComponentType) => {
    // Every setting its type has, each holding a secret but its title.
    const everySetting: () => JSONObject = (): JSONObject => {
      const settings: JSONObject = {};

      for (const setting of settingsOf(componentType)) {
        settings[setting] =
          setting === "title"
            ? VISIBLE_TITLE
            : {
                kept: `${componentType}-${setting}-secret`,
                list: [`${componentType}-${setting}-secret-in-a-list`],
              };
      }

      // And settings its type does not have, which a script left there.
      settings["notes"] = `${componentType}-notes-secret`;
      settings["queryConfigs"] = [{ query: `${componentType}-query-secret` }];

      return settings;
    };

    test("has settings besides its title, every one of them stays on the server", () => {
      expect(settingsOf(componentType).length).toBeGreaterThan(1);
      expect(settingsOf(componentType)).toContain("title");
    });

    test.each(STORED_SHAPES)(
      "stored $name: served its title alone, and the page and the routes read it with nothing more",
      (shape: StoredShape) => {
        const stored: DashboardViewConfig = configOf([
          shape.store(widgetOf(componentType, everySetting())),
        ]);

        const json: string = servedJSON(stored);

        expect(json).not.toContain("secret");
        expect(json).toContain(VISIBLE_TITLE);

        const [served] = servedWidgets(stored);

        expect(served!["componentType"]).toBe(componentType);
        expect(served!["arguments"]).toEqual({ title: VISIBLE_TITLE });

        const drawn: DashboardViewConfig = pageDraws(stored);

        expect(drawn.components).toHaveLength(1);
        expect(drawn.components[0]!.componentType).toBe(componentType);
        expect(drawn.components[0]!.arguments).toEqual({
          title: VISIBLE_TITLE,
        });
        expect(PublicDashboardViewConfig.getDrawnConfig(stored)).toEqual(drawn);

        // A signed-in board still reads every setting it holds, as stored.
        const signedIn: DashboardViewConfig =
          StoredDashboardViewConfig.read(stored);

        expect(
          Object.keys(signedIn.components[0]!.arguments as JSONObject).sort(),
        ).toEqual(Object.keys(everySetting()).sort());
      },
    );

    test("a title of any kind is served as stored, and no title as none", () => {
      for (const title of ["", "  ", 42, true, ["a"], { text: "a" }]) {
        const [served] = servedWidgets(
          configOf([
            widgetOf(componentType, { ...everySetting(), title: title }),
          ]),
        );

        expect([title, served!["arguments"]]).toEqual([title, { title }]);
      }

      const { title: _title, ...untitled } = everySetting();

      expect(_title).toBe(VISIBLE_TITLE);

      const [served] = servedWidgets(
        configOf([widgetOf(componentType, untitled)]),
      );

      expect(served!["arguments"]).toEqual({});
      expect(servedJSON(configOf([widgetOf(componentType, untitled)]))).not.toContain(
        "secret",
      );
    });

    test("deeper than a board reads, it is a widget of no type, served no settings at all", () => {
      const stored: DashboardViewConfig = configOf([
        wrapped(widgetOf(componentType, everySetting()), [
          "envelope",
          "envelope",
          "envelope",
          "envelope",
          "envelope",
          "envelope",
        ]),
      ]);

      const [served] = servedWidgets(stored);

      expect(served!["componentType"]).toBe("");
      expect(Object.keys(served!)).not.toContain("arguments");
      expect(servedJSON(stored)).not.toContain(VISIBLE_TITLE);
    });
  });
});

describe("issue #6338: a widget the page draws is served the settings its type has, as stored, and nothing else", () => {
  const DRAWN_TYPES: Array<string> = Object.keys(
    PUBLIC_DASHBOARD_WIDGET_SETTINGS,
  ).filter((componentType: string): boolean => {
    return !isPublicDashboardUndrawnWidgetType(componentType);
  });

  test("covers every type the page draws: all but the Data Source widgets and the widgets it cannot draw", () => {
    expect(DRAWN_TYPES.sort()).toEqual(
      Object.values(DashboardComponentType)
        .filter((componentType: DashboardComponentType): boolean => {
          return (
            !DataSourceComponentTypes.includes(componentType) &&
            !PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES.includes(componentType)
          );
        })
        .sort(),
    );
  });

  test.each(DRAWN_TYPES)(
    "%s: every setting it has is served, as stored, in every shape it is stored in - and a key its type does not have never is",
    (componentType: string) => {
      const settings: JSONObject = {};

      for (const setting of servedKeysOf(componentType)) {
        settings[setting] = `${componentType}-${setting}-drawn`;
      }

      // Scripts on, so the HTML widget's script is drawn and served.
      if (componentType === DashboardComponentType.Html) {
        settings["allowScripts"] = true;
      }

      const drawnSettings: JSONObject = { ...settings };

      settings["notes"] = "for the owner only: secret";
      settings["queryConfigs"] = [{ query: "SELECT secret" }];
      settings["Title"] = "a misspelt setting: secret";

      for (const shape of STORED_SHAPES) {
        const stored: DashboardViewConfig = configOf([
          shape.store(widgetOf(componentType, settings)),
        ]);

        const json: string = servedJSON(stored);

        expect([shape.name, json.includes("secret")]).toEqual([
          shape.name,
          false,
        ]);

        const [served] = servedWidgets(stored);

        expect([shape.name, served!["arguments"]]).toEqual([
          shape.name,
          drawnSettings,
        ]);
        expect([
          shape.name,
          settingsJSON(pageDraws(stored).components[0]!),
        ]).toEqual([shape.name, drawnSettings]);
      }
    },
  );

  test("an HTML widget's script is left out while scripts may not run - the page leaves it out of the widget then - and served while they may", () => {
    const html: JSONObject = {
      html: "<h1>{{cluster}}</h1>",
      css: "h1 { color: teal; }",
      javascript: "fetch('https://internal.example.com/?token=s3cr3t')",
      allowForms: false,
      allowPopups: true,
    };

    for (const allowScripts of [false, undefined, null, 0, ""]) {
      const settings: JSONObject = {
        ...html,
        ...(allowScripts === undefined ? {} : { allowScripts: allowScripts }),
      };
      const stored: DashboardViewConfig = configOf([
        widgetOf(DashboardComponentType.Html, settings),
      ]);

      expect([allowScripts, servedJSON(stored).includes("s3cr3t")]).toEqual([
        allowScripts,
        false,
      ]);

      const { javascript: _javascript, ...withoutScript } = settings;

      expect(_javascript).toBe(html["javascript"]);
      expect([allowScripts, servedWidgets(stored)[0]!["arguments"]]).toEqual([
        allowScripts,
        withoutScript,
      ]);
    }

    for (const allowScripts of [true, "true", 1]) {
      const stored: DashboardViewConfig = configOf([
        widgetOf(DashboardComponentType.Html, {
          ...html,
          allowScripts: allowScripts,
        }),
      ]);

      expect([allowScripts, servedWidgets(stored)[0]!["arguments"]]).toEqual([
        allowScripts,
        { ...html, allowScripts: allowScripts },
      ]);
    }
  });

  test("a type no board draws, no type and a Data Source widget are served no settings at all, as before", () => {
    const stored: DashboardViewConfig = configOf([
      widgetOf("HostMetricChart", { title: "secret", text: "secret" }),
      widgetOf(" Text ", { text: "secret" }),
      widgetOf("", { text: "secret" }),
      widgetOf(DashboardComponentType.DataSourceTable, {
        query: { query: "SELECT secret" },
      }),
    ]);

    expect(servedJSON(stored)).not.toContain("secret");
    expect(
      servedWidgets(stored).map((widget: ServedWidget): unknown => {
        return [widget["componentType"], Object.keys(widget).includes("arguments")];
      }),
    ).toEqual([
      ["HostMetricChart", false],
      [" Text ", false],
      ["", false],
    ]);
  });
});

describe("issue #6338: a variable is served what its picker is drawn with, and never a Query variable's query", () => {
  const QUERY_SECRET: string =
    "SELECT DISTINCT region FROM internal_billing.accounts WHERE plan = 'enterprise'";

  test("a legacy Query variable: its picker is served, its query never - as a list or as JSON text", () => {
    const variables: Array<JSONObject> = [
      {
        id: "region",
        name: "region",
        label: "Region",
        type: DashboardVariableType.Query,
        query: QUERY_SECRET,
        defaultValue: "eu",
      },
    ];

    for (const stored of [variables, JSON.stringify(variables)]) {
      const config: DashboardViewConfig = configOf([], stored);

      expect(servedJSON(config)).not.toContain("internal_billing");
      expect(servedConfig(config)["variables"]).toEqual([
        {
          id: "region",
          name: "region",
          label: "Region",
          type: DashboardVariableType.Query,
          defaultValue: "eu",
        },
      ]);

      // A signed-in board still reads it, so the editor keeps it at a save.
      expect(StoredDashboardViewConfig.read(config).variables![0]!.query).toBe(
        QUERY_SECRET,
      );
    }
  });

  // A variable holding every field, and keys no variable has.
  const everyField: (type: unknown) => JSONObject = (
    type: unknown,
  ): JSONObject => {
    return {
      id: "cluster",
      name: "cluster",
      label: "Cluster",
      ...(type === undefined ? {} : { type: type as string }),
      customListValues: "prod,staging",
      labelOptions: [
        { label: "Production", value: "0f8fad5b-d9cb-469f-a165-70867728950e" },
      ],
      query: QUERY_SECRET,
      attributeKey: "k8s.cluster.name",
      selectedValue: "prod",
      selectedValues: ["prod"],
      isMultiSelect: false,
      defaultValue: "staging",
      internalNote: "internal_billing note for the owner",
    };
  };

  test.each([
    ...Object.values(DashboardVariableType),
    "Some type from the future",
    undefined,
  ])(
    "a variable of type %p is served its type's fields, as the toolbar reads them, and nothing else",
    (type: unknown) => {
      const stored: DashboardViewConfig = configOf([], [everyField(type)]);

      const read: DashboardVariable = StoredDashboardViewConfig.read(stored)
        .variables![0]!;
      const [served] = servedConfig(stored)["variables"] as Array<JSONObject>;

      const expected: JSONObject = {};

      for (const field of getPublicDashboardVariableFields(type)) {
        const value: unknown = (read as unknown as JSONObject)[field];

        if (value !== undefined) {
          expected[field] = value as JSONObject;
        }
      }

      expect(served).toEqual(expected);
      expect(JSON.stringify(served)).not.toContain("internal_billing");
    },
  );

  test("the ids a variable list stored without them is drawn under are served, so the page and the routes know each variable by the same id", () => {
    const stored: DashboardViewConfig = configOf(
      [],
      [
        { name: "a", type: DashboardVariableType.TextInput },
        { id: "b", name: "b", type: DashboardVariableType.TextInput },
        { id: "b", name: "c", type: DashboardVariableType.CustomList },
      ],
    );

    const served: Array<JSONObject> = servedConfig(stored)[
      "variables"
    ] as Array<JSONObject>;

    expect(
      served.map((variable: JSONObject): unknown => {
        return variable["id"];
      }),
    ).toEqual(
      StoredDashboardViewConfig.read(stored).variables!.map(
        (variable: DashboardVariable): string => {
          return variable.id;
        },
      ),
    );
    expect(new Set(served.map((v: JSONObject) => v["id"])).size).toBe(3);
  });
});

/*
 * PROPERTY: A SEEDED DASHBOARD SERVES NOTHING BUT WHAT EACH WIDGET TYPE AND
 * EACH TYPE OF VARIABLE IS SERVED - AND THE PAGE AND THE ROUTES READ IT AS
 * IT IS.
 *
 * Seeded dashboards of widgets of every type - the Data Source ones, those
 * the public page cannot draw, those it draws, and types no board draws -
 * each holding every setting its type has and settings it does not have,
 * stored as an object or as JSON text; and variables of every type, each
 * holding every field a variable has, a Query variable's query among them,
 * and keys no variable has, stored as a list or as JSON text. A value the
 * page draws carries a marker, every other one a secret of its own.
 *
 * What is served holds every marker and no secret, each widget only the
 * settings its type is served, each variable only the fields its type is
 * served; read again it is what the page draws, and what the public routes
 * read (getDrawnConfig) - the variables included, which read as they were
 * served (StoredDashboardViewConfig.readBoardSettings is idempotent).
 */
describe("property: a seeded dashboard serves nothing but what each widget and each variable is served", () => {
  const ALL_TYPES: Array<string> = [
    ...Object.values(DashboardComponentType),
    "HostMetricChart",
    "SomeWidgetTypeFromTheFuture",
  ];

  const VARIABLE_TYPES: Array<string | undefined> = [
    ...Object.values(DashboardVariableType),
    "Some type from the future",
    undefined,
  ];

  const VARIABLE_FIELDS: Array<string> = [
    "label",
    "customListValues",
    "labelOptions",
    "query",
    "attributeKey",
    "selectedValue",
    "defaultValue",
  ];

  interface Generated {
    stored: DashboardViewConfig;
    markers: Array<string>;
    secrets: Array<string>;
  }

  const generate: (random: SeededRandom, name: string) => Generated = (
    random: SeededRandom,
    name: string,
  ): Generated => {
    const markers: Array<string> = [];
    const secrets: Array<string> = [];
    const components: Array<unknown> = [];

    const count: number = 1 + random(8);

    for (let index: number = 0; index < count; index++) {
      const componentType: string = ALL_TYPES[random(ALL_TYPES.length)]!;
      const isServed: boolean =
        isDashboardComponentType(componentType) &&
        !DataSourceComponentTypes.includes(componentType);
      const settings: JSONObject = {};

      const keys: Array<string> = isServed
        ? settingsOf(componentType)
        : ["title", "text", "query", "queries"];

      for (const key of keys) {
        const isDrawn: boolean =
          isServed && decisionOf(componentType).served.includes(key);
        const value: string = `${isDrawn ? "marker" : "secret"}${name}w${index}${key}`;

        (isDrawn ? markers : secrets).push(value);
        settings[key] =
          random(3) === 0 ? { nested: [value] } : (value as unknown as JSONObject);
      }

      // The HTML widget's script is drawn while scripts may run.
      if (componentType === DashboardComponentType.Html) {
        const scriptsOn: boolean = random(2) === 0;
        const script: string = `${scriptsOn ? "marker" : "secret"}${name}w${index}script`;

        settings["allowScripts"] = scriptsOn;
        settings["javascript"] = script;
        (scriptsOn ? markers : secrets).push(script);
        // allowScripts held a marker above: it is a boolean now.
        markers.splice(markers.indexOf(`marker${name}w${index}allowScripts`), 1);
      }

      // Settings no widget type has.
      if (random(2) === 0) {
        const junk: string = `secret${name}w${index}junk`;

        settings[random(2) === 0 ? "notes" : "queryConfigs"] =
          random(2) === 0 ? junk : ({ metricName: junk } as JSONObject);
        secrets.push(junk);
      }

      components.push(
        widgetOf(
          componentType,
          random(4) === 0 ? JSON.stringify(settings) : settings,
        ),
      );
    }

    const variables: Array<JSONObject> = [];
    const variableCount: number = random(5);

    for (let index: number = 0; index < variableCount; index++) {
      const type: string | undefined =
        VARIABLE_TYPES[random(VARIABLE_TYPES.length)];
      const servedFields: ReadonlyArray<string> =
        getPublicDashboardVariableFields(type);
      const variable: JSONObject = {
        id: `variable-${name}-${index}`,
        name: `marker${name}v${index}name`,
        ...(type === undefined ? {} : { type: type }),
      };

      markers.push(`marker${name}v${index}name`);

      for (const field of VARIABLE_FIELDS) {
        if (random(3) === 0) {
          continue;
        }

        const isDrawn: boolean = servedFields.includes(
          field as keyof DashboardVariable,
        );
        const value: string = `${isDrawn ? "marker" : "secret"}${name}v${index}${field}`;

        (isDrawn ? markers : secrets).push(value);
        variable[field] =
          field === "labelOptions"
            ? [{ label: value, value: value }]
            : (value as unknown as JSONObject);
      }

      if (random(2) === 0) {
        const junk: string = `secret${name}v${index}junk`;

        variable["internalNote"] = junk;
        secrets.push(junk);
      }

      variables.push(variable);
    }

    return {
      stored: configOf(
        components,
        variableCount === 0
          ? undefined
          : random(3) === 0
            ? JSON.stringify(variables)
            : variables,
      ),
      markers: markers,
      secrets: secrets,
    };
  };

  const SEEDS: Array<number> = [6338, 1, 2, 3, 42, 99, 1234, 2718];

  const RUNS_PER_SEED: number = 40;

  test("reaches every kind of widget and variable many times", () => {
    const seenTypes: Map<string, number> = new Map<string, number>();
    let secrets: number = 0;

    for (const seed of SEEDS) {
      const random: SeededRandom = seededRandom(seed);

      for (let run: number = 0; run < RUNS_PER_SEED; run++) {
        const generated: Generated = generate(random, `${seed}r${run}`);

        secrets += generated.secrets.length;

        for (const component of generated.stored.components) {
          const componentType: string = String(
            (component as unknown as JSONObject)["componentType"],
          );

          seenTypes.set(componentType, (seenTypes.get(componentType) || 0) + 1);
        }
      }
    }

    for (const componentType of ALL_TYPES) {
      expect([componentType, (seenTypes.get(componentType) || 0) >= 5]).toEqual(
        [componentType, true],
      );
    }

    expect(secrets).toBeGreaterThan(1000);
  });

  test.each(SEEDS)("seed %i", (seed: number) => {
    const random: SeededRandom = seededRandom(seed);

    for (let run: number = 0; run < RUNS_PER_SEED; run++) {
      const generated: Generated = generate(random, `${seed}r${run}`);
      const label: string = `seed ${seed}, dashboard ${run}`;
      const json: string = servedJSON(generated.stored);

      for (const secret of generated.secrets) {
        expect([label, secret, json.includes(secret)]).toEqual([
          label,
          secret,
          false,
        ]);
      }

      for (const marker of generated.markers) {
        expect([label, marker, json.includes(marker)]).toEqual([
          label,
          marker,
          true,
        ]);
      }

      const served: JSONObject = JSON.parse(json) as JSONObject;

      for (const widget of served["components"] as Array<JSONObject>) {
        const settings: JSONObject | undefined = widget["arguments"] as
          | JSONObject
          | undefined;

        if (settings) {
          for (const key of Object.keys(settings)) {
            expect([
              label,
              widget["componentType"],
              key,
              servedKeysOf(String(widget["componentType"])).includes(key),
            ]).toEqual([label, widget["componentType"], key, true]);
          }
        }
      }

      for (const variable of (served["variables"] || []) as Array<JSONObject>) {
        for (const key of Object.keys(variable)) {
          expect([
            label,
            variable["type"],
            key,
            getPublicDashboardVariableFields(variable["type"]).includes(
              key as keyof DashboardVariable,
            ),
          ]).toEqual([label, variable["type"], key, true]);
        }
      }

      // The page draws what is served, and the routes read the same.
      const drawn: DashboardViewConfig = pageDraws(generated.stored);

      expect([
        label,
        PublicDashboardViewConfig.getDrawnConfig(generated.stored),
      ]).toEqual([label, drawn]);

      // Read again, the variables are what was served: the read is idempotent.
      expect([
        label,
        JSON.parse(
          JSON.stringify(
            JSONFunctions.serializeValue(
              (drawn.variables || []) as unknown as JSONObject,
            ),
          ),
        ),
      ]).toEqual([label, served["variables"] || []]);
    }
  });
});
