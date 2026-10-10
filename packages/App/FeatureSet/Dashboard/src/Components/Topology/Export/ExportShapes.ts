import { TopologyPoint } from "../../NetworkDevice/TopologyGraphUtil";
import {
  TopologyShapeGeometry,
  cylinderCapHalfHeight,
} from "../../NetworkDevice/TopologyNodeShape";
import { ExportItem, ExportPathCommand, ExportStroke } from "./ExportItems";

/*
 * Node silhouettes on paper — circle, box, polygon or drum.
 *
 * The geometry comes from TopologyNodeShape, the module the layout reserves
 * room with and the live map draws with, so the PDF draws exactly the shapes
 * the canvas does and nothing is ever painted larger than the room the
 * layout made for it.
 */

// The handle length that makes four cubic Béziers a near-perfect ellipse.
export const ELLIPSE_KAPPA: number = 0.5522847498;

export interface ShapePaint {
  fill: string | undefined;
  stroke: ExportStroke | undefined;
}

/**
 * One silhouette centred at (cx, cy), drawn `scale` times its geometry's
 * size. A storage drum is two items: its outline, then the front rim of its
 * top cap (tagged "<tag>:rim"), which is what makes it read as a drum.
 */
export function shapeItems(
  tag: string,
  geometry: TopologyShapeGeometry,
  cx: number,
  cy: number,
  scale: number,
  paint: ShapePaint,
): Array<ExportItem> {
  const halfWidth: number = geometry.halfWidth * scale;
  const halfHeight: number = geometry.halfHeight * scale;

  if (geometry.points.length > 0) {
    return [
      {
        type: "path",
        tag: tag,
        commands: geometry.points.map(
          (point: TopologyPoint, index: number): ExportPathCommand => {
            return {
              op: index === 0 ? "m" : "l",
              points: [cx + point.x * scale, cy + point.y * scale],
            };
          },
        ),
        closed: true,
        fill: paint.fill,
        stroke: paint.stroke,
      },
    ];
  }

  if (geometry.shape === "cylinder") {
    /*
     * The live map draws the drum with SVG elliptical arcs. A PDF path has
     * no arcs, so each half-ellipse is two quarter Béziers.
     */
    const ry: number = cylinderCapHalfHeight(geometry.halfHeight) * scale;
    const top: number = cy - halfHeight + ry;
    const bottom: number = cy + halfHeight - ry;
    const left: number = cx - halfWidth;
    const right: number = cx + halfWidth;
    const kx: number = halfWidth * ELLIPSE_KAPPA;
    const ky: number = ry * ELLIPSE_KAPPA;
    return [
      {
        type: "path",
        tag: tag,
        commands: [
          { op: "m", points: [left, top] },
          {
            op: "c",
            points: [left, top - ky, cx - kx, top - ry, cx, top - ry],
          },
          {
            op: "c",
            points: [cx + kx, top - ry, right, top - ky, right, top],
          },
          { op: "l", points: [right, bottom] },
          {
            op: "c",
            points: [right, bottom + ky, cx + kx, bottom + ry, cx, bottom + ry],
          },
          {
            op: "c",
            points: [cx - kx, bottom + ry, left, bottom + ky, left, bottom],
          },
        ],
        closed: true,
        fill: paint.fill,
        stroke: paint.stroke,
      },
      {
        type: "path",
        tag: `${tag}:rim`,
        commands: [
          { op: "m", points: [right, top] },
          {
            op: "c",
            points: [right, top + ky, cx + kx, top + ry, cx, top + ry],
          },
          {
            op: "c",
            points: [cx - kx, top + ry, left, top + ky, left, top],
          },
        ],
        closed: false,
        fill: undefined,
        stroke: paint.stroke,
      },
    ];
  }

  if (geometry.shape === "circle") {
    return [
      {
        type: "circle",
        tag: tag,
        cx: cx,
        cy: cy,
        r: halfWidth,
        fill: paint.fill,
        stroke: paint.stroke,
      },
    ];
  }

  // The rect family: the switch box, the server tower, the endpoint leaf.
  return [
    {
      type: "rect",
      tag: tag,
      x: cx - halfWidth,
      y: cy - halfHeight,
      width: halfWidth * 2,
      height: halfHeight * 2,
      radius: geometry.cornerRadius * scale,
      fill: paint.fill,
      stroke: paint.stroke,
    },
  ];
}
