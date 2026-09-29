import {
  NetworkTopologyDeviceRole,
  NetworkTopologyNode,
  NetworkTopologyNodeShape,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { labelForDeviceRole } from "Common/Utils/Monitor/NetworkDeviceRoleUtil";
import { isEndpointNode } from "./EndpointNodeUtil";
import { TopologyPoint } from "./TopologyGraphUtil";

/*
 * What each kind of box on the network LOOKS like.
 *
 * Every node on the topology map used to be a circle — a core router, an
 * access switch, the firewall at the edge and a ceiling camera were all
 * the same 32px dot, and the only way to tell them apart was to read the
 * label under each one. Reading a map should not require reading it word
 * by word, so a node's role now picks its silhouette, following the
 * conventions network engineers already draw with by hand:
 *
 *   router          circle          the classic router puck
 *   switch          rounded square  the classic switch box
 *   firewall        diamond         a barrier turned on its corner
 *   wireless AP     triangle        a radiation cone
 *   load balancer   hexagon         distinct from both box and puck
 *   server          tower           taller than wide, like a chassis
 *   storage         cylinder        the disk symbol
 *   host / leaf     rect            what endpoints have always been
 *   unknown         circle          neutral, and unchanged from before
 *
 * Pure and react-free on purpose: BOTH the layout (through
 * TopologyFootprint) and the SVG renderer read this module, so a shape
 * can never be drawn at a size the layout did not reserve room for. It
 * also means every silhouette is unit-testable without a DOM.
 */

/*
 * The union itself moved to Common, next to the roles, because a device role
 * is a per-project row that STORES the shape it is drawn with and the model
 * has to name the same eight values. This alias keeps every existing import
 * of TopologyNodeShape resolving to exactly that union.
 */
export type TopologyNodeShape = NetworkTopologyNodeShape;

/*
 * The size a node is drawn at before its shape's aspect ratio is applied.
 * Devices keep the radius the old circles used, so an unclassified graph
 * renders pixel-for-pixel as it did; endpoints keep theirs.
 */
export const DEVICE_NODE_BASE_RADIUS: number = 16;
export const ENDPOINT_NODE_BASE_RADIUS: number = 9;

/*
 * Half-extents as a fraction of the base radius. The infrastructure
 * shapes are scaled so they carry roughly the same visual weight as the
 * circle they replace — a diamond of the same half-width as a circle's
 * radius reads much smaller, hence the 1.15.
 */
interface ShapeRatios {
  width: number;
  height: number;
  /** Corner rounding, also as a fraction of the base radius. */
  corner: number;
}

const SHAPE_RATIOS: Record<TopologyNodeShape, ShapeRatios> = {
  circle: { width: 1, height: 1, corner: 0 },
  "rounded-square": { width: 0.88, height: 0.88, corner: 0.22 },
  diamond: { width: 1.15, height: 1.15, corner: 0 },
  triangle: { width: 1.2, height: 1, corner: 0 },
  // sin(60°) — a hexagon of circumradius 1 is that tall at its half-height.
  hexagon: { width: 1, height: 0.8660254037844386, corner: 0 },
  tower: { width: 0.62, height: 1, corner: 0.15 },
  cylinder: { width: 0.72, height: 0.92, corner: 0 },
  // 7/9 reproduces the endpoint rect's historical 9 × 7 exactly.
  rect: { width: 1, height: 7 / 9, corner: 1 / 3 },
};

/*
 * Role → silhouette. The leaf roles (printer, camera, phone, host) share
 * the endpoint rect deliberately: they are all "something plugged into a
 * port", the distinction between them is not structural, and inventing
 * four more silhouettes for it would cost more legibility than it buys.
 * Their labels and the legend still name them individually.
 */
const SHAPE_BY_ROLE: Record<NetworkTopologyDeviceRole, TopologyNodeShape> = {
  router: "circle",
  switch: "rounded-square",
  firewall: "diamond",
  wirelessAccessPoint: "triangle",
  loadBalancer: "hexagon",
  server: "tower",
  storage: "cylinder",
  printer: "rect",
  camera: "rect",
  phone: "rect",
  host: "rect",
  // Never looked up — see shapeForNode, which falls back on the kind.
  unknown: "circle",
};

/**
 * The node's role, with the fallback older payloads need.
 *
 * A payload from before roles existed carries none. An endpoint without
 * one is a host — that is what being on the far side of an access port
 * means — and anything else is honestly unknown.
 */
export function roleOfNode(
  node: NetworkTopologyNode,
): NetworkTopologyDeviceRole {
  if (node.role) {
    return node.role;
  }
  return isEndpointNode(node) ? "host" : "unknown";
}

/**
 * The silhouette a node is drawn with.
 *
 * "unknown" is not a shape of its own: an unclassified endpoint stays the
 * rect it has always been, and an unclassified device stays a circle.
 */
export function shapeForNode(node: NetworkTopologyNode): TopologyNodeShape {
  /*
   * The project's own answer first. Roles are configurable rows now, so the
   * shape a role is drawn with is a per-project setting the server stamps onto
   * the node - and it is the only source that can describe a CUSTOM role,
   * which by definition has no entry in the built-in map below.
   */
  if (node.roleShape) {
    return node.roleShape;
  }

  const role: NetworkTopologyDeviceRole = roleOfNode(node);
  if (role === "unknown") {
    return isEndpointNode(node) ? "rect" : "circle";
  }
  return SHAPE_BY_ROLE[role];
}

/**
 * The node's role KEY - the project's configured key when it has one,
 * otherwise the built-in role.
 *
 * Different from {@link roleOfNode}, which can only ever return one of the
 * twelve built-in values. This is what the legend groups by and what search
 * matches, so a project's own role is a group of its own instead of being
 * folded into whatever the classifier happened to guess.
 */
export function roleKeyOfNode(node: NetworkTopologyNode): string {
  return node.roleKey || roleOfNode(node);
}

/**
 * The name to show for a node's role: the project's configured label when
 * there is one, otherwise the built-in label for the classified role.
 */
export function roleDisplayLabelForNode(node: NetworkTopologyNode): string {
  return node.roleLabel || labelForDeviceRole(roleOfNode(node));
}

/**
 * True when a node's role says nothing - no configured role and no
 * classification. Readers must treat this the same as an absent role.
 */
export function isUnclassifiedNode(node: NetworkTopologyNode): boolean {
  if (node.roleKey) {
    return false;
  }
  return roleOfNode(node) === "unknown";
}

/** The size class a node is drawn at, before shape ratios. */
export function baseRadiusForNode(node: NetworkTopologyNode): number {
  return isEndpointNode(node)
    ? ENDPOINT_NODE_BASE_RADIUS
    : DEVICE_NODE_BASE_RADIUS;
}

export interface TopologyShapeGeometry {
  shape: TopologyNodeShape;
  /** Half the silhouette's width, in viewBox units. Always positive. */
  halfWidth: number;
  /** Half the silhouette's height, in viewBox units. Always positive. */
  halfHeight: number;
  /**
   * Vertices for the polygon shapes, centred on the origin and in draw
   * order. Empty for the shapes drawn as a circle, a rect or a path.
   */
  points: Array<TopologyPoint>;
  /** Corner rounding for the rect-family shapes; zero for the rest. */
  cornerRadius: number;
  /**
   * Where the interface-count badge sits relative to the centre. Every
   * shape but one is widest across its middle; a triangle is widest at
   * its base, so its badge drops toward the centroid instead of hanging
   * off the apex.
   */
  badgeBaselineOffset: number;
}

// Two decimal places is well under a rendered pixel and keeps paths short.
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/*
 * Baseline for a 9px badge on a shape centred at y — half the cap height,
 * which is what puts the digits' optical centre on the centre line.
 */
const DEFAULT_BADGE_OFFSET: number = 3;

/** The geometry of one silhouette at one base radius. */
export function geometryForShape(
  shape: TopologyNodeShape,
  baseRadius: number,
): TopologyShapeGeometry {
  const ratios: ShapeRatios = SHAPE_RATIOS[shape];
  const halfWidth: number = round(baseRadius * ratios.width);
  const halfHeight: number = round(baseRadius * ratios.height);

  const points: Array<TopologyPoint> = [];
  if (shape === "diamond") {
    points.push(
      { x: 0, y: -halfHeight },
      { x: halfWidth, y: 0 },
      { x: 0, y: halfHeight },
      { x: -halfWidth, y: 0 },
    );
  } else if (shape === "triangle") {
    points.push(
      { x: 0, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    );
  } else if (shape === "hexagon") {
    points.push(
      { x: halfWidth, y: 0 },
      { x: round(halfWidth / 2), y: halfHeight },
      { x: round(-halfWidth / 2), y: halfHeight },
      { x: -halfWidth, y: 0 },
      { x: round(-halfWidth / 2), y: -halfHeight },
      { x: round(halfWidth / 2), y: -halfHeight },
    );
  }

  return {
    shape: shape,
    halfWidth: halfWidth,
    halfHeight: halfHeight,
    points: points,
    cornerRadius: round(baseRadius * ratios.corner),
    // 3 is the optical centre of a 9px badge on a shape centred at y.
    badgeBaselineOffset:
      shape === "triangle" ? round(halfHeight * 0.5) : DEFAULT_BADGE_OFFSET,
  };
}

/** The geometry one node is drawn with — shape and size class together. */
export function shapeGeometryForNode(
  node: NetworkTopologyNode,
): TopologyShapeGeometry {
  return geometryForShape(shapeForNode(node), baseRadiusForNode(node));
}

/** `points="..."` for a polygon shape, translated to a centre. */
export function polygonPointsAt(
  geometry: TopologyShapeGeometry,
  cx: number,
  cy: number,
): string {
  return geometry.points
    .map((point: TopologyPoint): string => {
      return `${round(cx + point.x)},${round(cy + point.y)}`;
    })
    .join(" ");
}

/** How tall the elliptical cap of a cylinder is. */
function cylinderCapHalfHeight(halfHeight: number): number {
  return round(Math.min(halfHeight * 0.32, halfHeight));
}

/**
 * The outline of a storage cylinder: an elliptical cap at each end joined
 * by straight sides, drawn clockwise from the left of the top cap.
 */
export function cylinderBodyPathAt(
  geometry: TopologyShapeGeometry,
  cx: number,
  cy: number,
): string {
  const w: number = geometry.halfWidth;
  const h: number = geometry.halfHeight;
  const ry: number = cylinderCapHalfHeight(h);
  const top: number = round(cy - h + ry);
  const bottom: number = round(cy + h - ry);
  const left: number = round(cx - w);
  const right: number = round(cx + w);
  return [
    `M ${left} ${top}`,
    `A ${w} ${ry} 0 0 1 ${right} ${top}`,
    `L ${right} ${bottom}`,
    `A ${w} ${ry} 0 0 1 ${left} ${bottom}`,
    "Z",
  ].join(" ");
}

/**
 * The front rim of the cylinder's top cap — the line that makes the
 * silhouette read as a drum rather than as a lozenge.
 */
export function cylinderCapPathAt(
  geometry: TopologyShapeGeometry,
  cx: number,
  cy: number,
): string {
  const w: number = geometry.halfWidth;
  const h: number = geometry.halfHeight;
  const ry: number = cylinderCapHalfHeight(h);
  const top: number = round(cy - h + ry);
  return `M ${round(cx + w)} ${top} A ${w} ${ry} 0 0 1 ${round(cx - w)} ${top}`;
}

/**
 * Display name of a node's role, e.g. "Switch".
 *
 * The project's configured label wins, so a role renamed in Network >
 * Settings > Device Roles is renamed on the map too, and a custom role reads
 * as itself rather than as whatever the classifier guessed underneath it.
 */
export function roleLabelForNode(node: NetworkTopologyNode): string {
  return roleDisplayLabelForNode(node);
}
