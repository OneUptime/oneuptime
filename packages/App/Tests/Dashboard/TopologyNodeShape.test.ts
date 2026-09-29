import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyDeviceRole,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { DEVICE_ROLES_IN_LEGEND_ORDER } from "Common/Utils/Monitor/NetworkDeviceRoleUtil";
import {
  DEVICE_NODE_BASE_RADIUS,
  ENDPOINT_NODE_BASE_RADIUS,
  TopologyNodeShape,
  TopologyShapeGeometry,
  baseRadiusForNode,
  cylinderBodyPathAt,
  cylinderCapPathAt,
  geometryForShape,
  polygonPointsAt,
  roleLabelForNode,
  roleOfNode,
  shapeForNode,
  shapeGeometryForNode,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyNodeShape";
import { TopologyPoint } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyGraphUtil";

/*
 * The silhouettes are the whole point of the feature — a map on which a
 * router, a switch and a firewall are three different shapes is readable
 * at a glance, and one on which they are three identical circles is not.
 * These tests pin the shape each role gets, the geometry every shape
 * produces, and — most importantly — that an UNCLASSIFIED graph still
 * renders exactly as it did before roles existed.
 */

type MakeNodeFunction = (
  overrides?: Partial<NetworkTopologyNode>,
) => NetworkTopologyNode;

const makeDevice: MakeNodeFunction = (
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: "device-1",
    name: "core-1",
    isManaged: true,
    status: "up",
    kind: "device",
    ...overrides,
  };
};

const makeEndpoint: MakeNodeFunction = (
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: "endpoint:1",
    name: "pos-1",
    isManaged: false,
    status: "unknown",
    kind: "endpoint",
    ...overrides,
  };
};

const ALL_SHAPES: Array<TopologyNodeShape> = [
  "circle",
  "rounded-square",
  "diamond",
  "triangle",
  "hexagon",
  "tower",
  "cylinder",
  "rect",
];

describe("roleOfNode", () => {
  test("uses the role the payload carries", () => {
    expect(roleOfNode(makeDevice({ role: "switch" }))).toBe("switch");
    expect(roleOfNode(makeEndpoint({ role: "camera" }))).toBe("camera");
  });

  test("a payload from before roles existed: devices unknown, endpoints hosts", () => {
    expect(roleOfNode(makeDevice())).toBe("unknown");
    expect(
      roleOfNode({ id: "x", name: "x", isManaged: false, status: "unknown" }),
    ).toBe("unknown");
    // Being on the far side of an access port IS being a host.
    expect(roleOfNode(makeEndpoint())).toBe("host");
  });

  test("an explicit 'unknown' is honoured, not re-derived", () => {
    expect(roleOfNode(makeEndpoint({ role: "unknown" }))).toBe("unknown");
  });
});

describe("shapeForNode", () => {
  test("each infrastructure role gets its own silhouette", () => {
    const expectations: Array<[NetworkTopologyDeviceRole, TopologyNodeShape]> =
      [
        ["router", "circle"],
        ["switch", "rounded-square"],
        ["firewall", "diamond"],
        ["wirelessAccessPoint", "triangle"],
        ["loadBalancer", "hexagon"],
        ["server", "tower"],
        ["storage", "cylinder"],
      ];
    for (const [role, shape] of expectations) {
      expect(shapeForNode(makeDevice({ role: role }))).toBe(shape);
    }
  });

  test("the infrastructure silhouettes are all distinct from one another", () => {
    const shapes: Array<TopologyNodeShape> = [
      "router",
      "switch",
      "firewall",
      "wirelessAccessPoint",
      "loadBalancer",
      "server",
      "storage",
    ].map((role: string): TopologyNodeShape => {
      return shapeForNode(
        makeDevice({ role: role as NetworkTopologyDeviceRole }),
      );
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  test("the leaf roles share the endpoint rect", () => {
    for (const role of ["printer", "camera", "phone", "host"]) {
      expect(
        shapeForNode(makeEndpoint({ role: role as NetworkTopologyDeviceRole })),
      ).toBe("rect");
    }
  });

  test("unclassified nodes keep the shapes they have always had", () => {
    expect(shapeForNode(makeDevice())).toBe("circle");
    expect(shapeForNode(makeDevice({ role: "unknown" }))).toBe("circle");
    expect(shapeForNode(makeEndpoint())).toBe("rect");
    expect(shapeForNode(makeEndpoint({ role: "unknown" }))).toBe("rect");
  });

  test("every role in the legend order maps to a real shape", () => {
    for (const role of DEVICE_ROLES_IN_LEGEND_ORDER) {
      const shape: TopologyNodeShape = shapeForNode(makeDevice({ role: role }));
      expect(ALL_SHAPES).toContain(shape);
    }
  });
});

describe("baseRadiusForNode", () => {
  test("endpoints are drawn smaller than devices", () => {
    expect(baseRadiusForNode(makeDevice())).toBe(DEVICE_NODE_BASE_RADIUS);
    expect(baseRadiusForNode(makeEndpoint())).toBe(ENDPOINT_NODE_BASE_RADIUS);
    expect(ENDPOINT_NODE_BASE_RADIUS).toBeLessThan(DEVICE_NODE_BASE_RADIUS);
  });

  test("the size class comes from the kind, not the role", () => {
    // A switch discovered as an endpoint is still drawn at leaf size.
    expect(baseRadiusForNode(makeEndpoint({ role: "switch" }))).toBe(
      ENDPOINT_NODE_BASE_RADIUS,
    );
  });
});

describe("geometryForShape", () => {
  test("every shape has finite, strictly positive half-extents", () => {
    for (const shape of ALL_SHAPES) {
      const geometry: TopologyShapeGeometry = geometryForShape(shape, 16);
      expect(Number.isFinite(geometry.halfWidth)).toBe(true);
      expect(Number.isFinite(geometry.halfHeight)).toBe(true);
      expect(geometry.halfWidth).toBeGreaterThan(0);
      expect(geometry.halfHeight).toBeGreaterThan(0);
      expect(geometry.cornerRadius).toBeGreaterThanOrEqual(0);
      expect(geometry.shape).toBe(shape);
    }
  });

  test("half-extents scale linearly with the base radius", () => {
    for (const shape of ALL_SHAPES) {
      const small: TopologyShapeGeometry = geometryForShape(shape, 10);
      const large: TopologyShapeGeometry = geometryForShape(shape, 20);
      expect(large.halfWidth).toBeCloseTo(small.halfWidth * 2, 1);
      expect(large.halfHeight).toBeCloseTo(small.halfHeight * 2, 1);
    }
  });

  test("a circle's half-extents are the base radius, unchanged from before", () => {
    const circle: TopologyShapeGeometry = geometryForShape(
      "circle",
      DEVICE_NODE_BASE_RADIUS,
    );
    expect(circle.halfWidth).toBe(DEVICE_NODE_BASE_RADIUS);
    expect(circle.halfHeight).toBe(DEVICE_NODE_BASE_RADIUS);
    expect(circle.points).toHaveLength(0);
  });

  test("the endpoint rect is still exactly 9 x 7", () => {
    const rect: TopologyShapeGeometry = geometryForShape(
      "rect",
      ENDPOINT_NODE_BASE_RADIUS,
    );
    expect(rect.halfWidth).toBe(9);
    expect(rect.halfHeight).toBe(7);
    // The rounding the endpoint has always been drawn with.
    expect(rect.cornerRadius).toBe(3);
  });

  test("only the polygon shapes carry vertices", () => {
    const withPoints: Array<TopologyNodeShape> = [
      "diamond",
      "triangle",
      "hexagon",
    ];
    for (const shape of ALL_SHAPES) {
      const geometry: TopologyShapeGeometry = geometryForShape(shape, 16);
      if (withPoints.includes(shape)) {
        expect(geometry.points.length).toBeGreaterThanOrEqual(3);
      } else {
        expect(geometry.points).toHaveLength(0);
      }
    }
  });

  test("vertices stay inside the half-extents the layout reserved", () => {
    for (const shape of [
      "diamond",
      "triangle",
      "hexagon",
    ] as Array<TopologyNodeShape>) {
      const geometry: TopologyShapeGeometry = geometryForShape(shape, 16);
      for (const point of geometry.points) {
        expect(Math.abs(point.x)).toBeLessThanOrEqual(geometry.halfWidth);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(geometry.halfHeight);
      }
    }
  });

  test("polygons are centred on the origin", () => {
    for (const shape of [
      "diamond",
      "triangle",
      "hexagon",
    ] as Array<TopologyNodeShape>) {
      const geometry: TopologyShapeGeometry = geometryForShape(shape, 16);
      const sumX: number = geometry.points.reduce(
        (total: number, point: TopologyPoint): number => {
          return total + point.x;
        },
        0,
      );
      expect(sumX).toBeCloseTo(0, 5);
    }
  });

  test("the polygons each touch their own bounding box", () => {
    // A shape narrower than its reserved extent would leave a visible gap.
    for (const shape of [
      "diamond",
      "triangle",
      "hexagon",
    ] as Array<TopologyNodeShape>) {
      const geometry: TopologyShapeGeometry = geometryForShape(shape, 16);
      const maxX: number = Math.max(
        ...geometry.points.map((point: TopologyPoint): number => {
          return Math.abs(point.x);
        }),
      );
      const maxY: number = Math.max(
        ...geometry.points.map((point: TopologyPoint): number => {
          return Math.abs(point.y);
        }),
      );
      expect(maxX).toBeCloseTo(geometry.halfWidth, 5);
      expect(maxY).toBeCloseTo(geometry.halfHeight, 5);
    }
  });

  test("the triangle points up and the diamond stands on a corner", () => {
    const triangle: TopologyShapeGeometry = geometryForShape("triangle", 16);
    expect(triangle.points).toHaveLength(3);
    expect(triangle.points[0]).toEqual({ x: 0, y: -triangle.halfHeight });

    const diamond: TopologyShapeGeometry = geometryForShape("diamond", 16);
    expect(diamond.points).toHaveLength(4);
    expect(diamond.points[0]).toEqual({ x: 0, y: -diamond.halfHeight });
    expect(diamond.points[1]).toEqual({ x: diamond.halfWidth, y: 0 });
  });

  test("the hexagon has six vertices", () => {
    expect(geometryForShape("hexagon", 16).points).toHaveLength(6);
  });

  test("the server tower is taller than it is wide, the leaf rect wider than tall", () => {
    const tower: TopologyShapeGeometry = geometryForShape("tower", 16);
    expect(tower.halfHeight).toBeGreaterThan(tower.halfWidth);
    const rect: TopologyShapeGeometry = geometryForShape("rect", 16);
    expect(rect.halfWidth).toBeGreaterThan(rect.halfHeight);
  });

  test("the badge sits on the centre line, except on a triangle", () => {
    /*
     * A triangle is widest at its base, so a badge on the centre line
     * hangs off the apex where there is no room for it.
     */
    for (const shape of ALL_SHAPES) {
      const geometry: TopologyShapeGeometry = geometryForShape(shape, 16);
      if (shape === "triangle") {
        expect(geometry.badgeBaselineOffset).toBeGreaterThan(3);
        expect(geometry.badgeBaselineOffset).toBeLessThan(geometry.halfHeight);
      } else {
        expect(geometry.badgeBaselineOffset).toBe(3);
      }
    }
  });

  test("only the rect-family shapes are rounded", () => {
    expect(geometryForShape("rounded-square", 16).cornerRadius).toBeGreaterThan(
      0,
    );
    expect(geometryForShape("tower", 16).cornerRadius).toBeGreaterThan(0);
    expect(geometryForShape("rect", 16).cornerRadius).toBeGreaterThan(0);
    expect(geometryForShape("circle", 16).cornerRadius).toBe(0);
    expect(geometryForShape("diamond", 16).cornerRadius).toBe(0);
  });
});

describe("shapeGeometryForNode", () => {
  test("combines the role's shape with the kind's size class", () => {
    const firewall: TopologyShapeGeometry = shapeGeometryForNode(
      makeDevice({ role: "firewall" }),
    );
    expect(firewall.shape).toBe("diamond");
    expect(firewall).toEqual(
      geometryForShape("diamond", DEVICE_NODE_BASE_RADIUS),
    );

    const camera: TopologyShapeGeometry = shapeGeometryForNode(
      makeEndpoint({ role: "camera" }),
    );
    expect(camera.shape).toBe("rect");
    expect(camera.halfWidth).toBe(9);
  });

  test("an unclassified endpoint is byte-for-byte the old 9 x 7 rect", () => {
    expect(shapeGeometryForNode(makeEndpoint())).toEqual(
      geometryForShape("rect", ENDPOINT_NODE_BASE_RADIUS),
    );
  });
});

describe("polygonPointsAt", () => {
  test("translates the vertices to the node's centre", () => {
    const geometry: TopologyShapeGeometry = geometryForShape("diamond", 10);
    const points: string = polygonPointsAt(geometry, 100, 50);
    const pairs: Array<string> = points.split(" ");
    expect(pairs).toHaveLength(4);
    expect(pairs[0]).toBe(`100,${50 - geometry.halfHeight}`);
    expect(pairs[1]).toBe(`${100 + geometry.halfWidth},50`);
  });

  test("every coordinate is a finite number", () => {
    const geometry: TopologyShapeGeometry = geometryForShape("hexagon", 16);
    for (const pair of polygonPointsAt(geometry, -12.5, 7.25).split(" ")) {
      const [x, y] = pair.split(",");
      expect(Number.isFinite(Number(x))).toBe(true);
      expect(Number.isFinite(Number(y))).toBe(true);
    }
  });

  test("a shape with no vertices produces an empty string", () => {
    expect(polygonPointsAt(geometryForShape("circle", 16), 0, 0)).toBe("");
  });
});

describe("the storage cylinder paths", () => {
  const geometry: TopologyShapeGeometry = geometryForShape("cylinder", 16);

  test("the body is a closed path of arcs and lines", () => {
    const path: string = cylinderBodyPathAt(geometry, 40, 60);
    expect(path.startsWith("M ")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect((path.match(/A /g) || []).length).toBe(2);
    expect(path).toContain("L ");
  });

  test("the cap is a single open arc across the top", () => {
    const path: string = cylinderCapPathAt(geometry, 40, 60);
    expect(path.startsWith("M ")).toBe(true);
    expect(path.endsWith("Z")).toBe(false);
    expect((path.match(/A /g) || []).length).toBe(1);
  });

  test("every coordinate in both paths is finite", () => {
    const paths: string =
      cylinderBodyPathAt(geometry, 40, 60) +
      cylinderCapPathAt(geometry, 40, 60);
    for (const token of paths.match(/-?\d+(\.\d+)?/g) || []) {
      expect(Number.isFinite(Number(token))).toBe(true);
    }
  });

  test("the drawing stays within the half-extents the layout reserved", () => {
    /*
     * Only the x coordinates are checked positionally — the arc radii in
     * the path share the same number space, so an out-of-bounds x is the
     * failure that would actually overlap a neighbour.
     */
    const path: string = cylinderBodyPathAt(geometry, 100, 100);
    const xs: Array<number> = [
      100 - geometry.halfWidth,
      100 + geometry.halfWidth,
    ];
    for (const x of xs) {
      expect(path).toContain(String(x));
    }
  });

  test("the cap sits at the top of the cylinder, not at its centre", () => {
    const cap: string = cylinderCapPathAt(geometry, 100, 100);
    const firstY: number = Number(cap.split(" ")[2]);
    expect(firstY).toBeLessThan(100);
    expect(firstY).toBeGreaterThan(100 - geometry.halfHeight);
  });
});

describe("roleLabelForNode", () => {
  test("names the role a human would use", () => {
    expect(roleLabelForNode(makeDevice({ role: "switch" }))).toBe("Switch");
    expect(roleLabelForNode(makeDevice({ role: "wirelessAccessPoint" }))).toBe(
      "Wireless AP",
    );
    expect(roleLabelForNode(makeDevice({ role: "loadBalancer" }))).toBe(
      "Load balancer",
    );
  });

  test("an unclassified device says so rather than inventing a role", () => {
    expect(roleLabelForNode(makeDevice())).toBe("Unknown type");
  });

  test("an unclassified endpoint is a host", () => {
    expect(roleLabelForNode(makeEndpoint())).toBe("Host");
  });
});
