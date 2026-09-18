import { NetworkTopologyNodeShape } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * The silhouettes a device role can be drawn with, as picker options.
 *
 * The shapes themselves are geometry, not taxonomy: adding one means writing
 * the path that draws it, so the list stays a closed union in
 * Common/Types/Monitor/SnmpMonitor/NetworkTopology and this file just names
 * them for a human. It is ordered the way the built-in roles use them, so the
 * first four options are the four an operator reaches for most.
 *
 * The labels say what the shape IS and what conventionally wears it, because
 * "hexagon" on its own tells an operator nothing about whether to pick it.
 */
export const TOPOLOGY_SHAPE_LABELS: Record<NetworkTopologyNodeShape, string> = {
  circle: "Circle — router",
  "rounded-square": "Rounded square — switch",
  diamond: "Diamond — firewall",
  triangle: "Triangle — wireless access point",
  hexagon: "Hexagon — load balancer",
  tower: "Tower — server",
  cylinder: "Cylinder — storage",
  rect: "Rectangle — endpoint or leaf device",
};

export const TOPOLOGY_SHAPES_IN_PICKER_ORDER: ReadonlyArray<NetworkTopologyNodeShape> =
  [
    "circle",
    "rounded-square",
    "diamond",
    "triangle",
    "hexagon",
    "tower",
    "cylinder",
    "rect",
  ];

export const TOPOLOGY_SHAPE_OPTIONS: Array<DropdownOption> =
  TOPOLOGY_SHAPES_IN_PICKER_ORDER.map((shape: NetworkTopologyNodeShape) => {
    return {
      value: shape,
      label: TOPOLOGY_SHAPE_LABELS[shape],
    };
  });
