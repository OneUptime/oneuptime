import DashboardViewConfigUtil from "../../../Utils/Dashboard/DashboardViewConfig";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import GridLayoutUtil from "../../../Utils/Dashboard/GridLayout";
import DashboardSize from "../../../Types/Dashboard/DashboardSize";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

function makeComponent(data: {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: ObjectID.generate(),
    componentType: DashboardComponentType.Text,
    leftInDashboardUnits: data.left ?? 0,
    topInDashboardUnits: data.top ?? 0,
    widthInDashboardUnits: data.width ?? 3,
    heightInDashboardUnits: data.height ?? 2,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
  };
}

function makeConfig(
  components: Array<DashboardBaseComponent>,
): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    components,
    heightInDashboardUnits: DashboardSize.heightInDashboardUnits,
  };
}

describe("DashboardViewConfigUtil.createDefaultDashboardViewConfig", () => {
  test("creates an empty config with the default height", () => {
    const config: DashboardViewConfig =
      DashboardViewConfigUtil.createDefaultDashboardViewConfig();
    expect(config.components).toEqual([]);
    expect(config.heightInDashboardUnits).toBe(
      DashboardSize.heightInDashboardUnits,
    );
  });
});

describe("DashboardViewConfigUtil.addComponentToDashboard", () => {
  test("first widget lands at the top-left corner", () => {
    const config: DashboardViewConfig = makeConfig([]);
    const updated: DashboardViewConfig =
      DashboardViewConfigUtil.addComponentToDashboard({
        component: makeComponent({ width: 6, height: 3 }),
        dashboardViewConfig: config,
      });

    expect(updated.components).toHaveLength(1);
    expect(updated.components[0]).toMatchObject({
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
    });
  });

  test("second widget fills the space beside the first, not a new bottom row", () => {
    const config: DashboardViewConfig = makeConfig([
      makeComponent({ left: 0, top: 0, width: 6, height: 3 }),
    ]);

    const updated: DashboardViewConfig =
      DashboardViewConfigUtil.addComponentToDashboard({
        component: makeComponent({ width: 6, height: 3 }),
        dashboardViewConfig: config,
      });

    expect(updated.components[1]).toMatchObject({
      topInDashboardUnits: 0,
      leftInDashboardUnits: 6,
    });
  });

  test("a widget that cannot fit any gap goes below everything", () => {
    const config: DashboardViewConfig = makeConfig([
      makeComponent({ left: 0, top: 0, width: 12, height: 4 }),
    ]);

    const updated: DashboardViewConfig =
      DashboardViewConfigUtil.addComponentToDashboard({
        component: makeComponent({ width: 12, height: 2 }),
        dashboardViewConfig: config,
      });

    expect(updated.components[1]).toMatchObject({
      topInDashboardUnits: 4,
      leftInDashboardUnits: 0,
    });
  });

  test("reuses an inner gap left behind by moved widgets", () => {
    const config: DashboardViewConfig = makeConfig([
      makeComponent({ left: 0, top: 0, width: 12, height: 2 }),
      makeComponent({ left: 0, top: 6, width: 12, height: 2 }),
    ]);

    const updated: DashboardViewConfig =
      DashboardViewConfigUtil.addComponentToDashboard({
        component: makeComponent({ width: 6, height: 2 }),
        dashboardViewConfig: config,
      });

    expect(updated.components[2]).toMatchObject({
      topInDashboardUnits: 2,
      leftInDashboardUnits: 0,
    });
  });

  test("the added widget never overlaps existing widgets", () => {
    let config: DashboardViewConfig = makeConfig([]);

    for (let i: number = 0; i < 15; i++) {
      config = DashboardViewConfigUtil.addComponentToDashboard({
        component: makeComponent({ width: 3 + (i % 5), height: 2 + (i % 3) }),
        dashboardViewConfig: config,
      });
    }

    expect(
      GridLayoutUtil.hasNoOverlaps(
        GridLayoutUtil.fromDashboardComponents(config.components),
      ),
    ).toBe(true);
  });

  test("grows the dashboard height when placing below the fold", () => {
    const config: DashboardViewConfig = {
      ...makeConfig([
        makeComponent({ left: 0, top: 0, width: 12, height: 70 }),
      ]),
      heightInDashboardUnits: 70,
    };

    const updated: DashboardViewConfig =
      DashboardViewConfigUtil.addComponentToDashboard({
        component: makeComponent({ width: 6, height: 4 }),
        dashboardViewConfig: config,
      });

    expect(updated.heightInDashboardUnits).toBeGreaterThanOrEqual(74);
  });

  test("does not mutate the input config, even deeply", () => {
    const original: DashboardViewConfig = makeConfig([
      makeComponent({ left: 0, top: 0, width: 6, height: 3 }),
    ]);
    const newComponent: DashboardBaseComponent = makeComponent({
      width: 6,
      height: 3,
    });

    // Any write to the inputs throws in strict mode.
    Object.freeze(original);
    Object.freeze(original.components);
    original.components.forEach((c: DashboardBaseComponent) => {
      Object.freeze(c);
    });
    Object.freeze(newComponent);

    const updated: DashboardViewConfig =
      DashboardViewConfigUtil.addComponentToDashboard({
        component: newComponent,
        dashboardViewConfig: original,
      });

    expect(updated.components).toHaveLength(2);
    expect(original.components).toHaveLength(1);
  });

  test("a corrupted existing component (missing top) cannot poison placement", () => {
    const broken: DashboardBaseComponent = {
      ...makeComponent({ left: 0, width: 3, height: 2 }),
      topInDashboardUnits: undefined as unknown as number,
    };
    const config: DashboardViewConfig = makeConfig([broken]);

    const updated: DashboardViewConfig =
      DashboardViewConfigUtil.addComponentToDashboard({
        component: makeComponent({ width: 6, height: 3 }),
        dashboardViewConfig: config,
      });

    const added: DashboardBaseComponent = updated.components[1]!;
    expect(Number.isFinite(added.topInDashboardUnits)).toBe(true);
    expect(Number.isFinite(added.leftInDashboardUnits)).toBe(true);
    expect(Number.isFinite(updated.heightInDashboardUnits)).toBe(true);
  });

  test("a component wider than the board is clamped to the board width", () => {
    const config: DashboardViewConfig = makeConfig([]);

    const updated: DashboardViewConfig =
      DashboardViewConfigUtil.addComponentToDashboard({
        component: makeComponent({ width: 40, height: 2 }),
        dashboardViewConfig: config,
      });

    expect(updated.components[0]!.widthInDashboardUnits).toBe(
      GridLayoutUtil.DefaultColumns,
    );
  });
});

describe("DashboardViewConfigUtil.normalizeLayout", () => {
  test("returns the same config object when the layout is already valid", () => {
    const config: DashboardViewConfig = makeConfig([
      makeComponent({ left: 0, top: 0, width: 6, height: 3 }),
      makeComponent({ left: 6, top: 0, width: 6, height: 3 }),
    ]);

    expect(DashboardViewConfigUtil.normalizeLayout(config)).toBe(config);
  });

  test("heals overlapping widgets saved by older builds", () => {
    const config: DashboardViewConfig = makeConfig([
      makeComponent({ left: 0, top: 0, width: 6, height: 3 }),
      makeComponent({ left: 0, top: 0, width: 6, height: 3 }),
    ]);

    const healed: DashboardViewConfig =
      DashboardViewConfigUtil.normalizeLayout(config);

    expect(healed).not.toBe(config);
    expect(
      GridLayoutUtil.hasNoOverlaps(
        GridLayoutUtil.fromDashboardComponents(healed.components),
      ),
    ).toBe(true);

    // Component identity, type and arguments survive healing.
    expect(healed.components[0]!.componentId.toString()).toBe(
      config.components[0]!.componentId.toString(),
    );
    expect(healed.components[1]!.componentId.toString()).toBe(
      config.components[1]!.componentId.toString(),
    );
  });

  test("pulls out-of-bounds widgets back onto the board", () => {
    const config: DashboardViewConfig = makeConfig([
      makeComponent({ left: 20, top: -3, width: 6, height: 3 }),
    ]);

    const healed: DashboardViewConfig =
      DashboardViewConfigUtil.normalizeLayout(config);

    const component: DashboardBaseComponent = healed.components[0]!;
    expect(component.leftInDashboardUnits).toBeGreaterThanOrEqual(0);
    expect(
      component.leftInDashboardUnits + component.widthInDashboardUnits,
    ).toBeLessThanOrEqual(GridLayoutUtil.DefaultColumns);
    expect(component.topInDashboardUnits).toBeGreaterThanOrEqual(0);
  });

  test("heals missing geometry fields to finite values and converges", () => {
    const broken: DashboardBaseComponent = {
      ...makeComponent({ left: 0, width: 3, height: 2 }),
      topInDashboardUnits: undefined as unknown as number,
    };
    const config: DashboardViewConfig = makeConfig([
      broken,
      makeComponent({ left: 0, top: 0, width: 3, height: 2 }),
    ]);

    const healed: DashboardViewConfig =
      DashboardViewConfigUtil.normalizeLayout(config);

    for (const component of healed.components) {
      expect(Number.isFinite(component.topInDashboardUnits)).toBe(true);
      expect(Number.isFinite(component.leftInDashboardUnits)).toBe(true);
    }
    expect(Number.isFinite(healed.heightInDashboardUnits)).toBe(true);

    // Convergence: healing a healed config is the identity.
    expect(DashboardViewConfigUtil.normalizeLayout(healed)).toBe(healed);
  });

  test("heals duplicate component ids as distinct widgets and converges", () => {
    const shared: DashboardBaseComponent = makeComponent({
      left: 0,
      top: 0,
      width: 3,
      height: 2,
    });
    const config: DashboardViewConfig = makeConfig([
      shared,
      { ...shared }, // same componentId, same position — fully corrupt
    ]);

    const healed: DashboardViewConfig =
      DashboardViewConfigUtil.normalizeLayout(config);

    expect(
      GridLayoutUtil.hasNoOverlaps(
        GridLayoutUtil.fromDashboardComponents(healed.components),
      ),
    ).toBe(true);

    // Convergence: no walking-down drift on repeated heals.
    expect(DashboardViewConfigUtil.normalizeLayout(healed)).toBe(healed);
  });

  test("grows the config height when healing pushes widgets below it", () => {
    const overlapping: Array<DashboardBaseComponent> = [];
    for (let i: number = 0; i < 10; i++) {
      overlapping.push(
        makeComponent({ left: 0, top: 0, width: 12, height: 8 }),
      );
    }
    const config: DashboardViewConfig = {
      ...makeConfig(overlapping),
      heightInDashboardUnits: 10,
    };

    const healed: DashboardViewConfig =
      DashboardViewConfigUtil.normalizeLayout(config);

    expect(healed.heightInDashboardUnits).toBeGreaterThanOrEqual(80);
  });
});
