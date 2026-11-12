import { describe, expect, test } from "@jest/globals";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import { JSONValue, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import {
  getDashboardViewConfigSignature,
  isSameDashboardViewConfig,
} from "../../../Utils/Dashboard/DashboardViewConfigSignature";

/*
 * The dashboard asks before a board with unsaved changes is left, and only
 * then (issue #7173): it compares the board with the one editing started
 * from. The same board must read the same however its objects were built,
 * and any change Save Changes would write must read as a change.
 */

const WIDGET_ID: string = "c0000000-0000-4000-8000-000000000001";

const textWidget: (
  overrides?: Partial<DashboardBaseComponent>,
) => DashboardBaseComponent = (
  overrides?: Partial<DashboardBaseComponent>,
): DashboardBaseComponent => {
  return {
    _type: ObjectType.DashboardComponent,
    componentType: DashboardComponentType.Text,
    componentId: new ObjectID(WIDGET_ID),
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 1,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    minHeightInDashboardUnits: 1,
    minWidthInDashboardUnits: 3,
    arguments: { text: "Hello, World!", isBold: false },
    ...overrides,
  } as DashboardBaseComponent;
};

const clusterVariable: DashboardVariable = {
  id: "v1",
  name: "cluster",
  type: DashboardVariableType.CustomList,
  customListValues: "prod, staging",
};

const board: (
  components: Array<DashboardBaseComponent>,
  extra?: Partial<DashboardViewConfig>,
) => DashboardViewConfig = (
  components: Array<DashboardBaseComponent>,
  extra?: Partial<DashboardViewConfig>,
): DashboardViewConfig => {
  return {
    _type: ObjectType.DashboardViewConfig,
    components: components,
    heightInDashboardUnits: 60,
    ...extra,
  };
};

describe("getDashboardViewConfigSignature", () => {
  test("reads the same board the same, however its objects were built", () => {
    const built: DashboardViewConfig = board([textWidget()]);

    // Every key in another order, as a copy built by hand writes them.
    const reordered: DashboardViewConfig = {
      heightInDashboardUnits: 60,
      components: [
        {
          arguments: { isBold: false, text: "Hello, World!" },
          minWidthInDashboardUnits: 3,
          minHeightInDashboardUnits: 1,
          leftInDashboardUnits: 0,
          topInDashboardUnits: 0,
          heightInDashboardUnits: 1,
          widthInDashboardUnits: 6,
          componentId: new ObjectID(WIDGET_ID),
          componentType: DashboardComponentType.Text,
          _type: ObjectType.DashboardComponent,
        } as DashboardBaseComponent,
      ],
      _type: ObjectType.DashboardViewConfig,
    };

    // As the server hands it back: the id as JSON, read into a class again.
    const roundTripped: DashboardViewConfig = JSONFunctions.deserializeValue(
      JSON.parse(
        JSON.stringify(
          JSONFunctions.serializeValue(built as unknown as JSONValue),
        ),
      ),
    ) as unknown as DashboardViewConfig;

    expect(getDashboardViewConfigSignature(reordered)).toBe(
      getDashboardViewConfigSignature(built),
    );
    expect(isSameDashboardViewConfig(roundTripped, built)).toBe(true);
  });

  test("a key left undefined is no change: Save writes nothing for it", () => {
    expect(
      isSameDashboardViewConfig(
        board([textWidget()], { timeRange: undefined, variables: undefined }),
        board([textWidget()]),
      ),
    ).toBe(true);
  });

  test("no variables and an empty list of them are one board: the Variables dialog saved with none", () => {
    expect(
      isSameDashboardViewConfig(
        board([textWidget()], { variables: [] }),
        board([textWidget()]),
      ),
    ).toBe(true);
  });

  test("the last variable removed reads as a change", () => {
    expect(
      isSameDashboardViewConfig(
        board([textWidget()], { variables: [] }),
        board([textWidget()], { variables: [clusterVariable] }),
      ),
    ).toBe(false);
  });

  test.each<[string, DashboardViewConfig]>([
    [
      "a widget added",
      board([
        textWidget(),
        textWidget({
          componentId: new ObjectID("c0000000-0000-4000-8000-000000000002"),
        }),
      ]),
    ],
    ["a widget removed", board([])],
    ["a widget moved", board([textWidget({ topInDashboardUnits: 3 })])],
    ["a widget resized", board([textWidget({ widthInDashboardUnits: 8 })])],
    [
      "a widget set up differently",
      board([
        textWidget({
          arguments: { text: "Hello, World!", isBold: true },
        } as Partial<DashboardBaseComponent>),
      ]),
    ],
    [
      "the default auto-refresh",
      board([textWidget()], {
        refreshInterval: AutoRefreshInterval.ONE_MINUTE,
      }),
    ],
    [
      "a variable",
      board([textWidget()], {
        variables: [clusterVariable],
      }),
    ],
    [
      "the board's height",
      board([textWidget()], { heightInDashboardUnits: 61 }),
    ],
  ])(
    "%s reads as a change",
    (_change: string, changed: DashboardViewConfig) => {
      expect(isSameDashboardViewConfig(changed, board([textWidget()]))).toBe(
        false,
      );
    },
  );
});
