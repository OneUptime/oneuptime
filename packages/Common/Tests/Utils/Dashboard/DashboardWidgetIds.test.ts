import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import DashboardWidgetIds, {
  DASHBOARD_WIDGET_ID_LIST_SETTINGS,
  DASHBOARD_WIDGET_ID_SETTINGS,
} from "../../../Utils/Dashboard/DashboardWidgetIds";
import StoredDashboardViewConfig from "../../../Utils/Dashboard/StoredDashboardViewConfig";
import DashboardComponentType, {
  isDashboardComponentType,
} from "../../../Types/Dashboard/DashboardComponentType";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * Issue #6328: a dashboard widget's id settings - the states, severities,
 * monitors, labels, clusters and hosts a list filters by, the SLO an SLO
 * widget shows, the variable a widget follows - can be stored as an
 * ObjectID's JSON (`{"_type": "ObjectID", "value": "<id>"}`) by the API,
 * Terraform, a workflow or a script (#4571). Every board revived that into
 * an ObjectID, which the widgets read as text: the SLO widget trimmed it and
 * fell into its error boundary, and an incident or alert list's state filter
 * compared it with text and dropped every state. DashboardWidgetIds reads
 * each id as the id it names, and StoredDashboardViewConfig.read hands every
 * board the ids as text.
 */

const FIRST_ID: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const SECOND_ID: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("DashboardWidgetIds", () => {
  describe("readId", () => {
    test.each([
      ["text, as it is", FIRST_ID, FIRST_ID],
      ["text with spaces, untrimmed", ` ${FIRST_ID} `, ` ${FIRST_ID} `],
      ["empty text", "", ""],
      ["a revived ObjectID", new ObjectID(FIRST_ID), FIRST_ID],
      ["an ObjectID's JSON", { _type: "ObjectID", value: FIRST_ID }, FIRST_ID],
      [
        "an ObjectID's JSON from toJSON",
        new ObjectID(FIRST_ID).toJSON(),
        FIRST_ID,
      ],
    ])("reads %s", (_name: string, value: unknown, expected: string) => {
      expect(DashboardWidgetIds.readId(value)).toBe(expected);
    });

    test.each([
      ["nothing", undefined],
      ["null", null],
      ["a number", 42],
      ["a boolean", true],
      ["a list", [FIRST_ID]],
      ["an object", { id: FIRST_ID }],
      ["an id with no type", { value: FIRST_ID }],
      ["another type's JSON", { _type: "Name", value: FIRST_ID }],
      ["an ObjectID's JSON without text", { _type: "ObjectID", value: 5 }],
      ["a date", new Date()],
      ["a query operator", new Includes([FIRST_ID])],
      ["another typed value", new Name("Checkout")],
    ])("reads %s as no id", (_name: string, value: unknown) => {
      expect(DashboardWidgetIds.readId(value)).toBeNull();
    });
  });

  describe("isAbsent", () => {
    test.each([
      ["nothing", undefined, true],
      ["null", null, true],
      ["empty text", "", true],
      ["spaces", "   ", true],
      [
        "an ObjectID's JSON with spaces",
        { _type: "ObjectID", value: " " },
        true,
      ],
      ["an id", FIRST_ID, false],
      ["a revived ObjectID", new ObjectID(FIRST_ID), false],
      ["an ObjectID's JSON", { _type: "ObjectID", value: FIRST_ID }, false],
      // There, but no id: a reader decides what it means.
      ["a number", 42, false],
      ["zero", 0, false],
      ["false", false, false],
      ["a list", [], false],
      ["an object", {}, false],
    ])("%s", (_name: string, value: unknown, expected: boolean) => {
      expect(DashboardWidgetIds.isAbsent(value)).toBe(expected);
    });
  });

  describe("readIdList", () => {
    test("reads each id of a list as text, and keeps whatever names no id as it is", () => {
      const junk: JSONObject = { id: FIRST_ID };

      expect(
        DashboardWidgetIds.readIdList([
          FIRST_ID,
          new ObjectID(SECOND_ID),
          { _type: "ObjectID", value: FIRST_ID },
          42,
          junk,
          null,
        ]),
      ).toEqual([FIRST_ID, SECOND_ID, FIRST_ID, 42, junk, null]);
    });

    test.each([
      ["nothing", undefined],
      ["null", null],
      ["text", FIRST_ID],
      ["an ObjectID", new ObjectID(FIRST_ID)],
      ["an object", { ids: [FIRST_ID] }],
    ])(
      "keeps %s, which is no list, as it is",
      (_name: string, value: unknown) => {
        expect(DashboardWidgetIds.readIdList(value)).toBe(value);
      },
    );
  });

  describe("withIdsRead", () => {
    test("reads every id setting as text, and leaves every other setting as it is", () => {
      const settings: JSONObject = { title: "Incidents", maxRows: 7 };

      for (const key of DASHBOARD_WIDGET_ID_LIST_SETTINGS) {
        settings[key] = [
          new ObjectID(FIRST_ID),
          { _type: "ObjectID", value: SECOND_ID },
        ] as unknown as JSONObject;
      }

      for (const key of DASHBOARD_WIDGET_ID_SETTINGS) {
        settings[key] = { _type: "ObjectID", value: FIRST_ID };
      }

      const read: JSONObject = DashboardWidgetIds.withIdsRead(settings);

      for (const key of DASHBOARD_WIDGET_ID_LIST_SETTINGS) {
        expect([key, read[key]]).toEqual([key, [FIRST_ID, SECOND_ID]]);
      }

      for (const key of DASHBOARD_WIDGET_ID_SETTINGS) {
        expect([key, read[key]]).toEqual([key, FIRST_ID]);
      }

      expect(read["title"]).toBe("Incidents");
      expect(read["maxRows"]).toBe(7);

      // A copy: the settings it was handed are left as they were.
      expect(read).not.toBe(settings);
      expect(settings["stateIds"]).toEqual([
        new ObjectID(FIRST_ID),
        { _type: "ObjectID", value: SECOND_ID },
      ]);
    });

    test("hands back the same settings when every id is text already, or names no id", () => {
      for (const settings of [
        {},
        { title: "Hosts" },
        { stateIds: [FIRST_ID, SECOND_ID], labelVariableId: "unit" },
        { stateIds: [42, null], serviceLevelObjectiveId: 7 },
        { stateIds: FIRST_ID, labelIds: { ids: [] } },
        // Keys no id setting has are never read.
        { title: { _type: "ObjectID", value: FIRST_ID } },
      ]) {
        expect(DashboardWidgetIds.withIdsRead(settings as JSONObject)).toBe(
          settings,
        );
      }
    });

    test("keeps what names no id, beside the ids it reads", () => {
      expect(
        DashboardWidgetIds.withIdsRead({
          stateIds: [{ _type: "ObjectID", value: FIRST_ID }, 42],
          serviceLevelObjectiveId: [FIRST_ID],
          labelVariableId: new ObjectID(SECOND_ID) as unknown as JSONObject,
        }),
      ).toEqual({
        stateIds: [FIRST_ID, 42],
        serviceLevelObjectiveId: [FIRST_ID],
        labelVariableId: SECOND_ID,
      });
    });
  });
});

/*
 * The id settings are listed in DashboardWidgetIds by name. So that a widget
 * type adding one cannot leave it out - and be read as text by no board -
 * this reads every widget type's settings (`arguments`) as declared, and
 * holds the lists to them: every optional setting whose name ends in `Id`
 * holds one id, every one ending in `Ids` a list, and each list names only
 * settings some widget type has.
 */
describe("every widget type's id settings are read as ids", () => {
  const TYPES_DIRECTORY: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Types",
    "Dashboard",
    "DashboardComponents",
  );

  const ID_SETTING: RegExp = /^\s*([A-Za-z]+(?:Id|Ids))\?:/;

  interface DeclaredSetting {
    componentType: string;
    key: string;
  }

  const declaredSettings: () => Array<DeclaredSetting> =
    (): Array<DeclaredSetting> => {
      const settings: Array<DeclaredSetting> = [];

      for (const file of fs.readdirSync(TYPES_DIRECTORY).sort()) {
        if (!file.startsWith("Dashboard") || !file.endsWith("Component.ts")) {
          continue;
        }

        const componentType: string = file
          .slice("Dashboard".length)
          .slice(0, -"Component.ts".length);

        for (const line of fs
          .readFileSync(path.join(TYPES_DIRECTORY, file), "utf8")
          .split("\n")) {
          const match: RegExpExecArray | null = ID_SETTING.exec(line);

          if (match) {
            settings.push({ componentType, key: match[1]! });
          }
        }
      }

      return settings;
    };

  test("reads widget types that are drawn, and finds their id settings", () => {
    const settings: Array<DeclaredSetting> = declaredSettings();

    // Not vacuous: the types the issue names are among them.
    expect(settings).toEqual(
      expect.arrayContaining([
        { componentType: "IncidentList", key: "stateIds" },
        { componentType: "AlertList", key: "stateIds" },
        { componentType: "Slo", key: "serviceLevelObjectiveId" },
        { componentType: "MonitorList", key: "labelVariableId" },
      ]),
    );

    for (const setting of settings) {
      expect([
        setting,
        isDashboardComponentType(setting.componentType),
      ]).toEqual([setting, true]);
    }
  });

  test("every id setting a widget type declares is listed, as one id or a list of them", () => {
    const declared: Array<DeclaredSetting> = declaredSettings();

    const lists: Array<string> = [
      ...new Set(
        declared
          .filter((setting: DeclaredSetting): boolean => {
            return setting.key.endsWith("Ids");
          })
          .map((setting: DeclaredSetting): string => {
            return setting.key;
          }),
      ),
    ].sort();
    const singles: Array<string> = [
      ...new Set(
        declared
          .filter((setting: DeclaredSetting): boolean => {
            return !setting.key.endsWith("Ids");
          })
          .map((setting: DeclaredSetting): string => {
            return setting.key;
          }),
      ),
    ].sort();

    expect([...DASHBOARD_WIDGET_ID_LIST_SETTINGS].sort()).toEqual(lists);
    expect([...DASHBOARD_WIDGET_ID_SETTINGS].sort()).toEqual(singles);
  });
});

/*
 * PROPERTY: EVERY BOARD READS EVERY ID SETTING AS TEXT, IN EVERY SHAPE.
 *
 * Seeded widgets of every type that has id settings, each id stored as
 * text, as an ObjectID's JSON, or as a revived ObjectID, and each widget
 * stored in a shape of its own: as an object, as JSON text, in the
 * DashboardComponent envelope, with its arguments written as JSON text, or
 * beside a value the board cannot revive (so it draws the widget from its
 * stored JSON). StoredDashboardViewConfig.read gives each the same settings
 * as the widget stored with every id as text.
 */
describe("property: every board reads every id setting as text, in every shape", () => {
  type Encoding = "text" | "ObjectID JSON" | "revived ObjectID";

  const ENCODINGS: Array<Encoding> = [
    "text",
    "ObjectID JSON",
    "revived ObjectID",
  ];

  const encode: (id: string, encoding: Encoding) => unknown = (
    id: string,
    encoding: Encoding,
  ): unknown => {
    if (encoding === "ObjectID JSON") {
      return { _type: "ObjectID", value: id };
    }

    if (encoding === "revived ObjectID") {
      return new ObjectID(id);
    }

    return id;
  };

  type Shape = (widget: JSONObject) => unknown;

  const SHAPES: Array<[string, Shape]> = [
    [
      "an object",
      (widget: JSONObject): unknown => {
        return widget;
      },
    ],
    [
      "JSON text",
      (widget: JSONObject): unknown => {
        return JSON.stringify(widget);
      },
    ],
    [
      "the DashboardComponent envelope",
      (widget: JSONObject): unknown => {
        return { _type: "DashboardComponent", value: widget };
      },
    ],
    [
      "its arguments as JSON text",
      (widget: JSONObject): unknown => {
        return { ...widget, arguments: JSON.stringify(widget["arguments"]) };
      },
    ],
    [
      "beside a value no board can revive",
      (widget: JSONObject): unknown => {
        return {
          ...widget,
          arguments: {
            ...(widget["arguments"] as JSONObject),
            // Includes.fromJSON cannot iterate a number.
            unrelated: { _type: "Includes", value: 5 },
          },
        };
      },
    ],
  ];

  const TYPES_WITH_IDS: Array<[DashboardComponentType, Array<string>]> = [
    [
      DashboardComponentType.IncidentList,
      ["severityIds", "stateIds", "monitorIds", "labelIds"],
    ],
    [
      DashboardComponentType.AlertList,
      ["severityIds", "stateIds", "monitorIds", "labelIds"],
    ],
    [
      DashboardComponentType.MonitorList,
      ["monitorStatusIds", "labelIds", "labelVariableId"],
    ],
    [DashboardComponentType.SloList, ["labelIds", "labelVariableId"]],
    [
      DashboardComponentType.Slo,
      ["serviceLevelObjectiveId", "serviceLevelObjectiveVariableId"],
    ],
    [DashboardComponentType.NetworkMap, ["networkSiteTypeIds"]],
    [DashboardComponentType.KubernetesPodList, ["kubernetesClusterIds"]],
    [DashboardComponentType.DockerContainerList, ["dockerHostIds"]],
    [DashboardComponentType.DockerSwarmNodeList, ["dockerSwarmClusterIds"]],
    [DashboardComponentType.PodmanVolumeList, ["podmanHostIds"]],
    [DashboardComponentType.ProxmoxGuestList, ["proxmoxClusterIds"]],
    [DashboardComponentType.VMwareHostList, ["vmwareVCenterIds"]],
    [DashboardComponentType.CephPoolList, ["cephClusterIds"]],
    [DashboardComponentType.StorageArrayVolumeList, ["storageArrayIds"]],
    [DashboardComponentType.ProfileFlameGraph, ["serviceId"]],
    [DashboardComponentType.ProfileTopFunctions, ["serviceId"]],
  ];

  test("the sweep covers every id setting there is", () => {
    const swept: Set<string> = new Set<string>();

    for (const [, keys] of TYPES_WITH_IDS) {
      for (const key of keys) {
        swept.add(key);
      }
    }

    expect([...swept].sort()).toEqual(
      [
        ...DASHBOARD_WIDGET_ID_LIST_SETTINGS,
        ...DASHBOARD_WIDGET_ID_SETTINGS,
      ].sort(),
    );
  });

  test.each([6328, 1, 2, 42, 2718, 31415])("seed %i", (seed: number) => {
    const random: SeededRandom = seededRandom(seed);

    for (let run: number = 0; run < 150; run++) {
      const [componentType, keys] =
        TYPES_WITH_IDS[random(TYPES_WITH_IDS.length)]!;
      const [shapeName, shape] = SHAPES[random(SHAPES.length)]!;

      const asText: JSONObject = { title: `Widget ${run}` };
      const stored: JSONObject = { title: `Widget ${run}` };
      const encodings: Array<string> = [];

      for (const key of keys) {
        if (random(5) === 0) {
          continue;
        }

        if (key.endsWith("Ids")) {
          const ids: Array<string> = [];
          const storedIds: Array<unknown> = [];
          const count: number = random(4);

          for (let index: number = 0; index < count; index++) {
            const id: string = ObjectID.generate().toString();
            const encoding: Encoding = ENCODINGS[random(ENCODINGS.length)]!;

            ids.push(id);
            storedIds.push(encode(id, encoding));
            encodings.push(encoding);
          }

          asText[key] = ids;
          stored[key] = storedIds as Array<JSONObject>;
        } else {
          const id: string = ObjectID.generate().toString();
          const encoding: Encoding = ENCODINGS[random(ENCODINGS.length)]!;

          asText[key] = id;
          stored[key] = encode(id, encoding) as JSONObject;
          encodings.push(encoding);
        }
      }

      const widgetOf: (settings: JSONObject) => JSONObject = (
        settings: JSONObject,
      ): JSONObject => {
        return {
          componentId: ObjectID.generate().toString(),
          componentType: componentType,
          arguments: settings,
        };
      };

      const readSettings: (entry: unknown) => JSONObject = (
        entry: unknown,
      ): JSONObject => {
        const [component] = StoredDashboardViewConfig.read({
          components: [entry],
        }).components;

        const settings: JSONObject = {
          ...(component!.arguments as JSONObject),
        };

        delete settings["unrelated"];

        return settings;
      };

      const label: string = `seed ${seed}, run ${run}: a ${componentType} as ${shapeName}, ${encodings.join(", ")}`;

      expect([label, readSettings(shape(widgetOf(stored)))]).toEqual([
        label,
        readSettings(widgetOf(asText)),
      ]);
      expect([label, readSettings(widgetOf(asText))]).toEqual([label, asText]);
    }
  });
});
