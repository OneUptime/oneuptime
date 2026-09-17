import { describe, expect, test } from "@jest/globals";
import { NetworkTopologyNodeShape } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  TOPOLOGY_SHAPE_LABELS,
  TOPOLOGY_SHAPE_OPTIONS,
  TOPOLOGY_SHAPES_IN_PICKER_ORDER,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyShapeOptions";
import {
  geometryForShape,
  DEVICE_NODE_BASE_RADIUS,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyNodeShape";

/*
 * The shape picker on a device role.
 *
 * A device role stores the silhouette it is drawn with, and this module is
 * the only place a human ever chooses one. The shapes are a closed union in
 * Common — adding one means writing the path that draws it — so the risk here
 * is not an invented shape, it is a real one going missing: the labels are a
 * Record over the union and the compiler makes that exhaustive, but the
 * picker ORDER is a plain array and a subset of it compiles perfectly well.
 * A shape dropped from that array is a shape no operator can ever select,
 * with nothing failing to build and no test noticing.
 */
describe("TopologyShapeOptions", () => {
  /*
   * TOPOLOGY_SHAPE_LABELS is typed Record<NetworkTopologyNodeShape, string>,
   * so its keys ARE the union — the compiler refuses a missing one. That
   * makes it the trustworthy list to check the others against.
   */
  const EVERY_SHAPE: Array<NetworkTopologyNodeShape> = Object.keys(
    TOPOLOGY_SHAPE_LABELS,
  ) as Array<NetworkTopologyNodeShape>;

  describe("the picker offers every shape, exactly once", () => {
    test("no shape in the union is missing from the picker order", () => {
      expect(TOPOLOGY_SHAPES_IN_PICKER_ORDER.slice().sort()).toEqual(
        EVERY_SHAPE.slice().sort(),
      );
    });

    /*
     * A duplicate would render the same silhouette twice in the dropdown,
     * and the second entry would be unreachable by keyboard selection.
     */
    test("no shape appears twice", () => {
      expect(new Set(TOPOLOGY_SHAPES_IN_PICKER_ORDER).size).toBe(
        TOPOLOGY_SHAPES_IN_PICKER_ORDER.length,
      );
    });

    /*
     * The order is documented as "the four an operator reaches for most
     * first", matching the order the built-in roles use them in. Pinned
     * because it is a deliberate choice that a reformat could quietly sort
     * into alphabetical order.
     */
    test("the four most-used silhouettes lead the list", () => {
      expect(TOPOLOGY_SHAPES_IN_PICKER_ORDER.slice(0, 4)).toEqual([
        "circle",
        "rounded-square",
        "diamond",
        "triangle",
      ]);
    });
  });

  describe("the options handed to the dropdown", () => {
    test("there is one option per shape, in the picker's order", () => {
      expect(
        TOPOLOGY_SHAPE_OPTIONS.map((option: DropdownOption): unknown => {
          return option.value;
        }),
      ).toEqual(TOPOLOGY_SHAPES_IN_PICKER_ORDER.slice());
    });

    /*
     * The value is what gets written to NetworkDeviceRole.topologyShape and
     * matched by the renderer. A label leaking into it would store a string
     * no shape lookup resolves.
     */
    test("every option's value is the bare shape, not its label", () => {
      for (const option of TOPOLOGY_SHAPE_OPTIONS) {
        expect(EVERY_SHAPE).toContain(option.value as NetworkTopologyNodeShape);
      }
    });

    test("every option carries the label defined for its shape", () => {
      for (const option of TOPOLOGY_SHAPE_OPTIONS) {
        expect(option.label).toBe(
          TOPOLOGY_SHAPE_LABELS[option.value as NetworkTopologyNodeShape],
        );
      }
    });
  });

  describe("the labels", () => {
    /*
     * "hexagon" on its own tells an operator nothing about when to pick it,
     * so each label names the shape AND what conventionally wears it. An
     * em-dash-less label is one that lost half of that.
     */
    test("each label names the shape and what wears it", () => {
      for (const shape of EVERY_SHAPE) {
        const label: string = TOPOLOGY_SHAPE_LABELS[shape];

        expect(label.trim().length).toBeGreaterThan(0);
        expect(label).toContain("—");
        expect(label.split("—")[1]!.trim().length).toBeGreaterThan(0);
      }
    });

    /*
     * Two shapes reading the same in the dropdown is indistinguishable from
     * a bug to the operator picking between them.
     */
    test("no two shapes read the same", () => {
      const labels: Array<string> = EVERY_SHAPE.map(
        (shape: NetworkTopologyNodeShape): string => {
          return TOPOLOGY_SHAPE_LABELS[shape];
        },
      );

      expect(new Set(labels).size).toBe(labels.length);
    });
  });

  /*
   * The picker and the renderer are separate modules over the same union.
   * Offering a shape the renderer has no geometry for would save a role that
   * draws as nothing — the failure would surface on the map, long after the
   * save, with no error anywhere near the picker.
   */
  describe("every offered shape is one the renderer can actually draw", () => {
    test("each shape has real, positive geometry at the device radius", () => {
      for (const shape of TOPOLOGY_SHAPES_IN_PICKER_ORDER) {
        const geometry: { halfWidth: number; halfHeight: number } =
          geometryForShape(shape, DEVICE_NODE_BASE_RADIUS);

        expect(Number.isFinite(geometry.halfWidth)).toBe(true);
        expect(Number.isFinite(geometry.halfHeight)).toBe(true);
        expect(geometry.halfWidth).toBeGreaterThan(0);
        expect(geometry.halfHeight).toBeGreaterThan(0);
      }
    });
  });
});
