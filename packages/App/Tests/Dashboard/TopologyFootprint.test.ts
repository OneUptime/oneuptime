import { describe, expect, test } from "@jest/globals";
import {
  NetworkTopologyDeviceRole,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import {
  DEFAULT_FOOTPRINT,
  DEVICE_LABEL_BASELINE_OFFSET,
  DEVICE_LABEL_FONT_SIZE,
  DEVICE_LABEL_LINE_HEIGHT,
  DEVICE_LABEL_MAX_CHARS,
  DEVICE_LABEL_MAX_LINES,
  DEVICE_NODE_RADIUS,
  ENDPOINT_LABEL_BASELINE_OFFSET,
  ENDPOINT_LABEL_FONT_SIZE,
  ENDPOINT_LABEL_LINE_HEIGHT,
  ENDPOINT_LABEL_MAX_CHARS,
  ENDPOINT_LABEL_MAX_LINES,
  ENDPOINT_NODE_HALF_HEIGHT,
  ENDPOINT_NODE_HALF_WIDTH,
  LABEL_MAX_HALF_WIDTH,
  NODE_COLLISION_PADDING,
  TopologyNodeFootprint,
  buildFootprints,
  footprintForNode,
  footprintOrDefault,
  labelLinesForNode,
  wrapNodeLabel,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/TopologyFootprint";

type MakeNodeFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
) => NetworkTopologyNode;

const makeDevice: MakeNodeFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    isManaged: true,
    status: "up",
    kind: "device",
    ...overrides,
  };
};

const makeUnmanaged: MakeNodeFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    isManaged: false,
    status: "unknown",
    kind: "unmanaged",
    ...overrides,
  };
};

const makeEndpoint: MakeNodeFunction = (
  id: string,
  overrides?: Partial<NetworkTopologyNode>,
): NetworkTopologyNode => {
  return {
    id: id,
    name: id,
    isManaged: false,
    status: "unknown",
    kind: "endpoint",
    ...overrides,
  };
};

/*
 * Deterministic pseudo-random source. The suite must never depend on
 * Math.random: a hostile-name property test that only fails one run in
 * fifty is worse than no test at all.
 */
type NextRandomFunction = () => number;
type MakeSeededRandomFunction = (seed: number) => NextRandomFunction;

const makeSeededRandom: MakeSeededRandomFunction = (
  seed: number,
): NextRandomFunction => {
  let state: number = seed | 0 || 1;
  return (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.abs(state % 100000) / 100000;
  };
};

/* Names built from real hostname characters plus spaces and hyphens. */
const NAME_ALPHABET: string = "abcdefghijklmnopqrstuvwxyz0123456789-. ";

type MakeHostileNamesFunction = (count: number, seed: number) => Array<string>;

const makeHostileNames: MakeHostileNamesFunction = (
  count: number,
  seed: number,
): Array<string> => {
  const next: NextRandomFunction = makeSeededRandom(seed);
  const names: Array<string> = [];
  for (let i: number = 0; i < count; i++) {
    const length: number = 1 + Math.floor(next() * 60);
    let name: string = "";
    for (let c: number = 0; c < length; c++) {
      name += NAME_ALPHABET.charAt(
        Math.floor(next() * NAME_ALPHABET.length) % NAME_ALPHABET.length,
      );
    }
    names.push(name);
  }
  return names;
};

const HOSTILE_NAMES: Array<string> = makeHostileNames(60, 987654321);

/* A 200 character single-word hostname — the worst realistic label. */
const LONG_HOSTNAME: string = "h".repeat(200);

describe("hostile name fixture", () => {
  /*
   * The property tests below are only worth anything if the generated
   * corpus is actually varied. A silently degenerate xorshift (every name
   * "aaa") would make six tests pass while asserting nothing.
   */
  test("the seeded corpus is varied and long enough to exercise wrapping", () => {
    expect(HOSTILE_NAMES.length).toBe(60);
    expect(new Set<string>(HOSTILE_NAMES).size).toBe(HOSTILE_NAMES.length);
    const overDeviceBudget: Array<string> = HOSTILE_NAMES.filter(
      (name: string): boolean => {
        return name.trim().length > DEVICE_LABEL_MAX_CHARS;
      },
    );
    expect(overDeviceBudget.length).toBeGreaterThan(10);
    const withSpaces: Array<string> = HOSTILE_NAMES.filter(
      (name: string): boolean => {
        return name.trim().includes(" ");
      },
    );
    expect(withSpaces.length).toBeGreaterThan(5);
  });

  test("the seeded corpus is reproducible from its seed", () => {
    expect(makeHostileNames(60, 987654321)).toEqual(HOSTILE_NAMES);
    expect(makeHostileNames(60, 13579)).not.toEqual(HOSTILE_NAMES);
  });
});

describe("wrapNodeLabel — the line budget is never exceeded", () => {
  test("a name that fits stays on a single line, unchanged", () => {
    expect(wrapNodeLabel("POS 1")).toEqual(["POS 1"]);
    expect(wrapNodeLabel("pos-1")).toEqual(["pos-1"]);
    /* Exactly the endpoint budget: eleven characters still fit. */
    expect(wrapNodeLabel("kitchen-pos")).toEqual(["kitchen-pos"]);
  });

  test("a long name breaks at a word boundary, not mid-word", () => {
    expect(wrapNodeLabel("Menu Board 2")).toEqual(["Menu Board", "2"]);
    expect(wrapNodeLabel("Receipt Printer")).toEqual(["Receipt", "Printer"]);
    expect(wrapNodeLabel("Kitchen Display")).toEqual(["Kitchen", "Display"]);
  });

  test("a single over-long word is hard split across the lines", () => {
    /* 21 characters fill two 11 character lines exactly — nothing lost. */
    expect(wrapNodeLabel("WORKSTATION0123456789")).toEqual([
      "WORKSTATION",
      "0123456789",
    ]);
  });

  test("a word too long even for the whole budget ends in an ellipsis", () => {
    const lines: Array<string> = wrapNodeLabel("WORKSTATION0123456789ABCDEFG");
    expect(lines).toEqual(["WORKSTATION", "0123456789…"]);
    expect(lines[1]!.length).toBe(ENDPOINT_LABEL_MAX_CHARS);
  });

  test("words that do not fit are folded into an ellipsis on the last line", () => {
    const lines: Array<string> = wrapNodeLabel("Front Counter Printer 2");
    expect(lines.length).toBe(ENDPOINT_LABEL_MAX_LINES);
    expect(lines[1]!.endsWith("…")).toBe(true);
    /* The visible prefix is preserved verbatim. */
    expect(lines[0]).toBe("Front");
  });

  test("the ellipsis never leaves a dangling space before it", () => {
    /*
     * Truncating "ab cdefgh i" to the budget cuts immediately after a
     * space; rendering "ab cdefgh …" would read as a lost word rather
     * than a truncation, so the trailing space is stripped first.
     */
    expect(wrapNodeLabel("ab cdefgh i jk", 11, 1)).toEqual(["ab cdefgh…"]);
  });

  test("no line ever exceeds the character budget it was given", () => {
    const budgets: Array<number> = [2, 5, 11, 17, 24];
    for (const name of HOSTILE_NAMES) {
      for (const budget of budgets) {
        for (const maxLines of [1, 2, 3]) {
          const lines: Array<string> = wrapNodeLabel(name, budget, maxLines);
          expect(lines.length).toBeLessThanOrEqual(maxLines);
          for (const line of lines) {
            expect(line.length).toBeLessThanOrEqual(budget);
          }
        }
      }
    }
  });

  test("no produced line is empty or padded with whitespace", () => {
    for (const name of HOSTILE_NAMES) {
      for (const line of wrapNodeLabel(name, 11, 2)) {
        expect(line.length).toBeGreaterThan(0);
        expect(line).toBe(line.trim());
      }
    }
  });

  test("runs of whitespace collapse to a single separator", () => {
    expect(wrapNodeLabel("  Menu   Board  ")).toEqual(["Menu Board"]);
    expect(wrapNodeLabel("Menu\tBoard")).toEqual(["Menu Board"]);
    expect(wrapNodeLabel("Menu\nBoard")).toEqual(["Menu Board"]);
  });

  test("empty, blank and whitespace-only names produce no lines at all", () => {
    expect(wrapNodeLabel("")).toEqual([]);
    expect(wrapNodeLabel("   ")).toEqual([]);
    expect(wrapNodeLabel("\t\n ")).toEqual([]);
    expect(wrapNodeLabel(null as unknown as string)).toEqual([]);
    expect(wrapNodeLabel(undefined as unknown as string)).toEqual([]);
  });

  test("omitted budgets default to the endpoint budget", () => {
    const name: string = "Beer Tap Controller";
    expect(wrapNodeLabel(name)).toEqual(
      wrapNodeLabel(name, ENDPOINT_LABEL_MAX_CHARS, ENDPOINT_LABEL_MAX_LINES),
    );
  });

  test("a wider budget keeps a name on one line that a narrow one splits", () => {
    expect(
      wrapNodeLabel("Kitchen Display", ENDPOINT_LABEL_MAX_CHARS, 2),
    ).toEqual(["Kitchen", "Display"]);
    expect(wrapNodeLabel("Kitchen Display", DEVICE_LABEL_MAX_CHARS, 2)).toEqual(
      ["Kitchen Display"],
    );
  });

  test("a one-line budget truncates instead of dropping the tail silently", () => {
    expect(wrapNodeLabel("Menu Board 2", 11, 1)).toEqual(["Menu Board…"]);
  });

  test("non-integer and non-positive budgets degrade to at least one char and one line", () => {
    expect(wrapNodeLabel("abcdefgh", 3.9, 2)).toEqual(["abc", "de…"]);
    expect(wrapNodeLabel("Menu Board 2", 11, 0)).toEqual(["Menu Board…"]);
    expect(wrapNodeLabel("Menu Board 2", 11, -4)).toEqual(["Menu Board…"]);
    expect(wrapNodeLabel("ab", 0, 2)).toEqual(["a", "b"]);
    expect(wrapNodeLabel("ab", -3, 2)).toEqual(["a", "b"]);
  });

  test("a one-character budget cannot hold both a character and an ellipsis", () => {
    /*
     * The single budget the "no line exceeds it" invariant does not hold
     * for: truncation keeps at least one character and then appends the
     * ellipsis, so the line is two characters wide. Unreachable from the
     * module's own constants (11 and 17 are the only budgets in use), and
     * asserted here so a future change to the truncation branch is a
     * visible decision rather than a silent one.
     */
    expect(wrapNodeLabel("abc", 1, 1)).toEqual(["a…"]);
  });

  test("wrapping is pure — repeated calls agree and inputs are untouched", () => {
    const name: string = "Menu Board 3";
    const first: Array<string> = wrapNodeLabel(name);
    const second: Array<string> = wrapNodeLabel(name);
    expect(second).toEqual(first);
    /* A fresh array each call: a caller may mutate its own copy. */
    expect(second).not.toBe(first);
    expect(name).toBe("Menu Board 3");
  });
});

describe("labelLinesForNode — each node kind gets its own budget", () => {
  test("an endpoint wraps at the endpoint budget", () => {
    const endpoint: NetworkTopologyNode = makeEndpoint("endpoint:kd-1", {
      name: "Kitchen Display",
    });
    expect(labelLinesForNode(endpoint)).toEqual(["Kitchen", "Display"]);
    for (const line of labelLinesForNode(endpoint)) {
      expect(line.length).toBeLessThanOrEqual(ENDPOINT_LABEL_MAX_CHARS);
    }
  });

  test("a device gets the wider device budget for the same name", () => {
    const device: NetworkTopologyNode = makeDevice("switch-a", {
      name: "Kitchen Display",
    });
    expect(labelLinesForNode(device)).toEqual(["Kitchen Display"]);
  });

  /*
   * Regression: device labels used to run off the glyph because only
   * endpoints were ever wrapped. Anything past the device budget must now
   * break onto a second line instead of painting over its neighbours.
   */
  test("a device name past the device budget wraps instead of running off", () => {
    const device: NetworkTopologyNode = makeDevice("switch-dist-12", {
      name: "Distribution Switch 12",
    });
    const lines: Array<string> = labelLinesForNode(device);
    expect(lines).toEqual(["Distribution", "Switch 12"]);
    expect(lines.length).toBe(2);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(DEVICE_LABEL_MAX_CHARS);
    }
  });

  test("a device name of exactly the budget still fits on one line", () => {
    /* 17 characters — the boundary the wrap must not trip over. */
    const name: string = "core-switch-01.la";
    expect(name.length).toBe(DEVICE_LABEL_MAX_CHARS);
    expect(labelLinesForNode(makeDevice("core-1", { name: name }))).toEqual([
      name,
    ]);
  });

  test("a device label never exceeds its budget or line count, whatever the name", () => {
    for (const name of [...HOSTILE_NAMES, LONG_HOSTNAME]) {
      const lines: Array<string> = labelLinesForNode(
        makeDevice("device", { name: name }),
      );
      expect(lines.length).toBeLessThanOrEqual(DEVICE_LABEL_MAX_LINES);
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(DEVICE_LABEL_MAX_CHARS);
      }
    }
  });

  test("an unmanaged peer is labelled like a device, not like an endpoint", () => {
    const peer: NetworkTopologyNode = makeUnmanaged("unmanaged:ap-1", {
      name: "Kitchen Display",
    });
    expect(labelLinesForNode(peer)).toEqual(["Kitchen Display"]);
  });

  test("a legacy node with no kind is labelled like a device", () => {
    const legacy: NetworkTopologyNode = {
      id: "legacy-1",
      name: "Kitchen Display",
      isManaged: true,
      status: "up",
    };
    expect(labelLinesForNode(legacy)).toEqual(["Kitchen Display"]);
  });

  test("an empty or absent name yields no label lines", () => {
    expect(labelLinesForNode(makeDevice("d", { name: "" }))).toEqual([]);
    expect(
      labelLinesForNode(makeEndpoint("endpoint:e", { name: "  " })),
    ).toEqual([]);
    const nameless: NetworkTopologyNode = {
      id: "nameless",
      isManaged: true,
      status: "up",
      kind: "device",
    } as unknown as NetworkTopologyNode;
    expect(labelLinesForNode(nameless)).toEqual([]);
  });
});

describe("footprintForNode — glyph geometry per kind", () => {
  test("a managed device is a padded circle with a two-line label allowance", () => {
    const footprint: TopologyNodeFootprint = footprintForNode(
      makeDevice("router-1"),
    );
    expect(footprint.halfWidth).toBe(DEVICE_NODE_RADIUS);
    expect(footprint.halfHeight).toBe(DEVICE_NODE_RADIUS);
    expect(footprint.collisionRadius).toBe(
      DEVICE_NODE_RADIUS + NODE_COLLISION_PADDING,
    );
    expect(footprint.labelBottom).toBe(DEVICE_LABEL_BASELINE_OFFSET);
    /* 8 chars x 12px x 0.58 / 2 */
    expect(footprint.labelHalfWidth).toBeCloseTo(27.84, 6);
    expect(footprint.inkHalfWidth).toBeCloseTo(27.84, 6);
  });

  test("an unmanaged peer shares the device geometry exactly", () => {
    expect(
      footprintForNode(makeUnmanaged("unmanaged:ap", { name: "ap" })),
    ).toEqual(footprintForNode(makeDevice("ap-device", { name: "ap" })));
  });

  test("an endpoint is a smaller rounded rect with a smaller label", () => {
    const footprint: TopologyNodeFootprint = footprintForNode(
      makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
    );
    expect(footprint.halfWidth).toBe(ENDPOINT_NODE_HALF_WIDTH);
    expect(footprint.halfHeight).toBe(ENDPOINT_NODE_HALF_HEIGHT);
    expect(footprint.collisionRadius).toBe(
      ENDPOINT_NODE_HALF_WIDTH + NODE_COLLISION_PADDING,
    );
    expect(footprint.labelBottom).toBe(ENDPOINT_LABEL_BASELINE_OFFSET);
    /* 5 chars x 10px x 0.58 / 2 */
    expect(footprint.labelHalfWidth).toBeCloseTo(14.5, 6);
    expect(footprint.inkHalfWidth).toBeCloseTo(14.5, 6);
  });

  test("an endpoint reserves strictly less separation than a device", () => {
    const endpoint: TopologyNodeFootprint = footprintForNode(
      makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
    );
    const device: TopologyNodeFootprint = footprintForNode(makeDevice("sw-1"));
    expect(endpoint.collisionRadius).toBeLessThan(device.collisionRadius);
    expect(endpoint.halfWidth).toBeLessThan(device.halfWidth);
    expect(endpoint.halfHeight).toBeLessThan(device.halfHeight);
  });

  test("an endpoint's label is narrower than a device's for the same name", () => {
    const name: string = "pos-1";
    expect(ENDPOINT_LABEL_FONT_SIZE).toBeLessThan(DEVICE_LABEL_FONT_SIZE);
    expect(
      footprintForNode(makeEndpoint("endpoint:x", { name: name }))
        .labelHalfWidth,
    ).toBeLessThan(
      footprintForNode(makeDevice("x", { name: name })).labelHalfWidth,
    );
  });

  test("every field is finite and non-negative for every node kind", () => {
    const nameless: NetworkTopologyNode = {
      id: "nameless",
      isManaged: true,
      status: "up",
      kind: "device",
    } as unknown as NetworkTopologyNode;
    const nodes: Array<NetworkTopologyNode> = [
      makeDevice("router-1"),
      makeUnmanaged("unmanaged:ap-1", { name: "AP 1" }),
      makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
      makeDevice("blank", { name: "" }),
      makeEndpoint("endpoint:blank", { name: "" }),
      nameless,
      makeDevice("long", { name: LONG_HOSTNAME }),
    ];
    for (const node of nodes) {
      const footprint: TopologyNodeFootprint = footprintForNode(node);
      const values: Array<number> = [
        footprint.halfWidth,
        footprint.halfHeight,
        footprint.labelHalfWidth,
        footprint.labelBottom,
        footprint.collisionRadius,
        footprint.inkHalfWidth,
      ];
      for (const value of values) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
      }
      /* Only labelHalfWidth may be zero — an unlabelled node claims no text width. */
      expect(footprint.halfWidth).toBeGreaterThan(0);
      expect(footprint.halfHeight).toBeGreaterThan(0);
      expect(footprint.labelBottom).toBeGreaterThan(0);
      expect(footprint.collisionRadius).toBeGreaterThan(0);
      expect(footprint.inkHalfWidth).toBeGreaterThan(0);
    }
  });

  test("a node with no name still reserves the first baseline", () => {
    const blank: TopologyNodeFootprint = footprintForNode(
      makeDevice("blank", { name: "" }),
    );
    const named: TopologyNodeFootprint = footprintForNode(
      makeDevice("named", { name: "sw" }),
    );
    expect(blank.labelHalfWidth).toBe(0);
    /* Renaming a blank node must not need a re-layout to fit one line. */
    expect(blank.labelBottom).toBe(named.labelBottom);
    expect(blank.inkHalfWidth).toBe(DEVICE_NODE_RADIUS);
  });

  test("a node whose name property is missing behaves as if it were empty", () => {
    const nameless: NetworkTopologyNode = {
      id: "nameless",
      isManaged: true,
      status: "up",
      kind: "device",
    } as unknown as NetworkTopologyNode;
    expect(footprintForNode(nameless)).toEqual(
      footprintForNode(makeDevice("blank", { name: "" })),
    );
  });
});

describe("footprintForNode — label width and height budgets", () => {
  test("labelHalfWidth never exceeds the hard cap, even for a 200-char hostname", () => {
    const device: TopologyNodeFootprint = footprintForNode(
      makeDevice("long", { name: LONG_HOSTNAME }),
    );
    const endpoint: TopologyNodeFootprint = footprintForNode(
      makeEndpoint("endpoint:long", { name: LONG_HOSTNAME }),
    );
    expect(device.labelHalfWidth).toBeLessThanOrEqual(LABEL_MAX_HALF_WIDTH);
    expect(endpoint.labelHalfWidth).toBeLessThanOrEqual(LABEL_MAX_HALF_WIDTH);
    /*
     * The wrap budget binds before the cap does: a device line is at most
     * 17 chars (17 x 12 x 0.58 / 2 = 59.16) and an endpoint line 11
     * (11 x 10 x 0.58 / 2 = 31.9). The cap is the backstop, not the
     * mechanism — if wrapping ever regresses, this pins what changed.
     */
    expect(device.labelHalfWidth).toBeCloseTo(59.16, 6);
    expect(endpoint.labelHalfWidth).toBeCloseTo(31.9, 6);
  });

  test("no name of any shape can push a label past the cap", () => {
    for (const name of HOSTILE_NAMES) {
      for (const node of [
        makeDevice("d", { name: name }),
        makeEndpoint("endpoint:e", { name: name }),
      ]) {
        expect(footprintForNode(node).labelHalfWidth).toBeLessThanOrEqual(
          LABEL_MAX_HALF_WIDTH,
        );
      }
    }
  });

  test("inkHalfWidth is always the wider of the glyph and the label", () => {
    for (const name of [...HOSTILE_NAMES, "", "sw", LONG_HOSTNAME]) {
      for (const node of [
        makeDevice("d", { name: name }),
        makeEndpoint("endpoint:e", { name: name }),
      ]) {
        const footprint: TopologyNodeFootprint = footprintForNode(node);
        expect(footprint.inkHalfWidth).toBe(
          Math.max(footprint.halfWidth, footprint.labelHalfWidth),
        );
        expect(footprint.inkHalfWidth).toBeGreaterThanOrEqual(
          footprint.halfWidth,
        );
      }
    }
  });

  test("a short label leaves the glyph as the widest ink", () => {
    /* One character at 12px is 3.48 half-width — narrower than the circle. */
    const footprint: TopologyNodeFootprint = footprintForNode(
      makeDevice("d", { name: "a" }),
    );
    expect(footprint.labelHalfWidth).toBeCloseTo(3.48, 6);
    expect(footprint.inkHalfWidth).toBe(DEVICE_NODE_RADIUS);
  });

  test("labelHalfWidth tracks the longest line, not the whole name", () => {
    /* "Distribution" (12) is longer than "Switch 12" (9). */
    const wrapped: TopologyNodeFootprint = footprintForNode(
      makeDevice("d", { name: "Distribution Switch 12" }),
    );
    expect(wrapped.labelHalfWidth).toBeCloseTo(41.76, 6);
    const oneLine: TopologyNodeFootprint = footprintForNode(
      makeDevice("d", { name: "Distribution" }),
    );
    expect(wrapped.labelHalfWidth).toBeCloseTo(oneLine.labelHalfWidth, 6);
  });

  test("a device's labelBottom grows by exactly one line height per extra line", () => {
    const oneLine: TopologyNodeFootprint = footprintForNode(
      makeDevice("d", { name: "Distribution" }),
    );
    const twoLines: TopologyNodeFootprint = footprintForNode(
      makeDevice("d", { name: "Distribution Switch 12" }),
    );
    expect(oneLine.labelBottom).toBe(DEVICE_LABEL_BASELINE_OFFSET);
    expect(twoLines.labelBottom - oneLine.labelBottom).toBe(
      DEVICE_LABEL_LINE_HEIGHT,
    );
  });

  test("an endpoint's labelBottom grows by exactly one endpoint line height", () => {
    const oneLine: TopologyNodeFootprint = footprintForNode(
      makeEndpoint("endpoint:e", { name: "pos-1" }),
    );
    const twoLines: TopologyNodeFootprint = footprintForNode(
      makeEndpoint("endpoint:e", { name: "Kitchen Display" }),
    );
    expect(oneLine.labelBottom).toBe(ENDPOINT_LABEL_BASELINE_OFFSET);
    expect(twoLines.labelBottom - oneLine.labelBottom).toBe(
      ENDPOINT_LABEL_LINE_HEIGHT,
    );
    expect(twoLines.labelBottom).toBe(30);
  });

  test("labelBottom is bounded by the maximum line allowance", () => {
    const deviceMax: number =
      DEVICE_LABEL_BASELINE_OFFSET +
      (DEVICE_LABEL_MAX_LINES - 1) * DEVICE_LABEL_LINE_HEIGHT;
    const endpointMax: number =
      ENDPOINT_LABEL_BASELINE_OFFSET +
      (ENDPOINT_LABEL_MAX_LINES - 1) * ENDPOINT_LABEL_LINE_HEIGHT;
    for (const name of [...HOSTILE_NAMES, LONG_HOSTNAME, ""]) {
      expect(
        footprintForNode(makeDevice("d", { name: name })).labelBottom,
      ).toBeLessThanOrEqual(deviceMax);
      expect(
        footprintForNode(makeEndpoint("endpoint:e", { name: name }))
          .labelBottom,
      ).toBeLessThanOrEqual(endpointMax);
    }
  });

  test("the footprint is pure — same node in, equal but distinct object out", () => {
    const node: NetworkTopologyNode = makeDevice("router-1", {
      name: "Distribution Switch 12",
    });
    const before: string = JSON.stringify(node);
    const first: TopologyNodeFootprint = footprintForNode(node);
    const second: TopologyNodeFootprint = footprintForNode(node);
    expect(second).toEqual(first);
    /* Distinct objects, so one caller's mutation cannot poison another's. */
    expect(second).not.toBe(first);
    expect(JSON.stringify(node)).toBe(before);
  });

  test("only the name and the kind change a footprint", () => {
    const base: TopologyNodeFootprint = footprintForNode(
      makeDevice("router-1", { name: "sw" }),
    );
    const decorated: TopologyNodeFootprint = footprintForNode(
      makeDevice("totally-different-id", {
        name: "sw",
        status: "down",
        vendor: "Cisco",
        macAddress: "aa:bb:cc:dd:ee:ff",
        vlanId: 12,
      }),
    );
    expect(decorated).toEqual(base);
  });
});

describe("buildFootprints — one entry per node id", () => {
  const nodes: Array<NetworkTopologyNode> = [
    makeDevice("router-1"),
    makeUnmanaged("unmanaged:ap-1", { name: "AP 1" }),
    makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
  ];

  test("every node is keyed by its id with its own footprint", () => {
    const footprints: Map<string, TopologyNodeFootprint> =
      buildFootprints(nodes);
    expect(footprints.size).toBe(3);
    for (const node of nodes) {
      expect(footprints.get(node.id)).toEqual(footprintForNode(node));
    }
  });

  test("a duplicated id collapses to the first node seen", () => {
    const first: NetworkTopologyNode = makeDevice("switch-a", { name: "sw" });
    const second: NetworkTopologyNode = makeEndpoint("switch-a", {
      name: "Distribution Switch 12",
    });
    const footprints: Map<string, TopologyNodeFootprint> = buildFootprints([
      first,
      second,
    ]);
    expect(footprints.size).toBe(1);
    expect(footprints.get("switch-a")).toEqual(footprintForNode(first));
    expect(footprints.get("switch-a")).not.toEqual(footprintForNode(second));
  });

  test("malformed nodes are skipped rather than keyed under a junk id", () => {
    const footprints: Map<string, TopologyNodeFootprint> = buildFootprints([
      null as unknown as NetworkTopologyNode,
      undefined as unknown as NetworkTopologyNode,
      {
        name: "no id",
        isManaged: true,
        status: "up",
      } as unknown as NetworkTopologyNode,
      makeDevice("", { name: "empty id" }),
      {
        id: 42,
        name: "numeric id",
        isManaged: true,
        status: "up",
      } as unknown as NetworkTopologyNode,
      makeDevice("router-1"),
    ]);
    expect(footprints.size).toBe(1);
    expect(footprints.has("router-1")).toBe(true);
    expect(footprints.has("")).toBe(false);
  });

  test("an empty or absent node list yields an empty map", () => {
    expect(buildFootprints([]).size).toBe(0);
    expect(
      buildFootprints(null as unknown as Array<NetworkTopologyNode>).size,
    ).toBe(0);
    expect(
      buildFootprints(undefined as unknown as Array<NetworkTopologyNode>).size,
    ).toBe(0);
  });

  test("a large graph of hostile names stays finite and within budget", () => {
    const many: Array<NetworkTopologyNode> = HOSTILE_NAMES.map(
      (name: string, index: number): NetworkTopologyNode => {
        const id: string = `node-${String(index).padStart(3, "0")}`;
        return index % 2 === 0
          ? makeDevice(id, { name: name })
          : makeEndpoint(`endpoint:${id}`, { name: name });
      },
    );
    const footprints: Map<string, TopologyNodeFootprint> =
      buildFootprints(many);
    expect(footprints.size).toBe(many.length);
    for (const footprint of footprints.values()) {
      expect(Number.isFinite(footprint.collisionRadius)).toBe(true);
      expect(footprint.collisionRadius).toBeGreaterThan(0);
      expect(footprint.inkHalfWidth).toBeLessThanOrEqual(LABEL_MAX_HALF_WIDTH);
    }
  });

  test("building is pure — repeated builds agree and the input is untouched", () => {
    const before: string = JSON.stringify(nodes);
    expect(buildFootprints(nodes)).toEqual(buildFootprints(nodes));
    expect(JSON.stringify(nodes)).toBe(before);
  });
});

describe("footprintOrDefault — never returns undefined", () => {
  const footprints: Map<string, TopologyNodeFootprint> = buildFootprints([
    makeDevice("router-1"),
    makeEndpoint("endpoint:pos-1", { name: "pos-1" }),
  ]);

  test("a known id returns that node's own footprint", () => {
    expect(footprintOrDefault(footprints, "router-1")).toBe(
      footprints.get("router-1"),
    );
    expect(footprintOrDefault(footprints, "endpoint:pos-1").halfWidth).toBe(
      ENDPOINT_NODE_HALF_WIDTH,
    );
  });

  test("an id with no footprint falls back to the default", () => {
    /* A pinned position for a node that has since left the graph. */
    expect(footprintOrDefault(footprints, "gone-away")).toBe(DEFAULT_FOOTPRINT);
    expect(
      footprintOrDefault(new Map<string, TopologyNodeFootprint>(), "router-1"),
    ).toBe(DEFAULT_FOOTPRINT);
  });

  test("hostile and prototype-shaped ids still resolve to a real footprint", () => {
    const ids: Array<string> = [
      "",
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "0",
    ];
    for (const id of ids) {
      const footprint: TopologyNodeFootprint = footprintOrDefault(
        footprints,
        id,
      );
      expect(footprint).toBe(DEFAULT_FOOTPRINT);
      expect(Number.isFinite(footprint.collisionRadius)).toBe(true);
    }
  });

  test("the default is sized as a device, so it never under-reserves space", () => {
    expect(DEFAULT_FOOTPRINT).toEqual(
      footprintForNode(makeDevice("blank", { name: "" })),
    );
    expect(DEFAULT_FOOTPRINT.collisionRadius).toBe(
      DEVICE_NODE_RADIUS + NODE_COLLISION_PADDING,
    );
    expect(DEFAULT_FOOTPRINT.collisionRadius).toBeGreaterThanOrEqual(
      footprintForNode(makeEndpoint("endpoint:e", { name: "pos-1" }))
        .collisionRadius,
    );
    expect(DEFAULT_FOOTPRINT.labelBottom).toBe(DEVICE_LABEL_BASELINE_OFFSET);
    expect(DEFAULT_FOOTPRINT.inkHalfWidth).toBe(DEVICE_NODE_RADIUS);
  });
});

/*
 * The footprint is the contract between the layout and the renderer: the
 * layout reserves space with it, the renderer draws inside it. Roles
 * changed what gets drawn, so these tests exist to make sure the space
 * reserved moved with it — and that a graph with no roles at all still
 * reserves exactly what it always did.
 */
describe("footprintForNode — role-driven silhouettes", () => {
  test("the glyph extents come from the role's shape", () => {
    const firewall: TopologyNodeFootprint = footprintForNode(
      makeDevice("fw-1", { role: "firewall" }),
    );
    const server: TopologyNodeFootprint = footprintForNode(
      makeDevice("srv-1", { role: "server" }),
    );

    // A diamond is wider and taller than the circle it replaces...
    expect(firewall.halfWidth).toBeGreaterThan(DEVICE_NODE_RADIUS);
    expect(firewall.halfHeight).toBeGreaterThan(DEVICE_NODE_RADIUS);
    // ...and a server tower is narrower than it is tall.
    expect(server.halfWidth).toBeLessThan(server.halfHeight);
  });

  test("the footprint carries the geometry the renderer will draw", () => {
    const switchFootprint: TopologyNodeFootprint = footprintForNode(
      makeDevice("sw-1", { role: "switch" }),
    );
    expect(switchFootprint.shape.shape).toBe("rounded-square");
    expect(switchFootprint.shape.halfWidth).toBe(switchFootprint.halfWidth);
    expect(switchFootprint.shape.halfHeight).toBe(switchFootprint.halfHeight);
  });

  test("collision radius grows with the shape, so a diamond cannot overlap", () => {
    const circle: TopologyNodeFootprint = footprintForNode(
      makeDevice("rtr-1", { role: "router" }),
    );
    const diamond: TopologyNodeFootprint = footprintForNode(
      makeDevice("fw-1", { role: "firewall" }),
    );
    expect(diamond.collisionRadius).toBeGreaterThan(circle.collisionRadius);
    expect(diamond.collisionRadius).toBe(
      Math.max(diamond.halfWidth, diamond.halfHeight) + NODE_COLLISION_PADDING,
    );
  });

  test("a taller silhouette pushes its label down instead of touching it", () => {
    const circle: TopologyNodeFootprint = footprintForNode(
      makeDevice("rtr-1", { role: "router" }),
    );
    const diamond: TopologyNodeFootprint = footprintForNode(
      makeDevice("fw-1", { role: "firewall" }),
    );
    expect(circle.labelBaselineOffset).toBe(DEVICE_LABEL_BASELINE_OFFSET);
    expect(diamond.labelBaselineOffset).toBeGreaterThan(
      DEVICE_LABEL_BASELINE_OFFSET,
    );
    // The clearance below the glyph is the same in both cases.
    expect(diamond.labelBaselineOffset - diamond.halfHeight).toBeCloseTo(
      circle.labelBaselineOffset - circle.halfHeight,
      5,
    );
  });

  test("the label baseline is where the label block starts", () => {
    const single: TopologyNodeFootprint = footprintForNode(
      makeDevice("sw-1", { role: "switch", name: "sw" }),
    );
    expect(single.labelBottom).toBe(single.labelBaselineOffset);

    const wrapped: TopologyNodeFootprint = footprintForNode(
      makeDevice("sw-2", { role: "switch", name: "distribution switch two" }),
    );
    expect(wrapped.labelBottom).toBe(
      wrapped.labelBaselineOffset + DEVICE_LABEL_LINE_HEIGHT,
    );
  });

  test("every role produces a finite, positive, self-consistent footprint", () => {
    const roles: Array<NetworkTopologyDeviceRole> = [
      "router",
      "switch",
      "firewall",
      "wirelessAccessPoint",
      "loadBalancer",
      "server",
      "storage",
      "printer",
      "camera",
      "phone",
      "host",
      "unknown",
    ];
    for (const role of roles) {
      for (const node of [
        makeDevice(`d-${role}`, { role: role }),
        makeEndpoint(`endpoint:${role}`, { role: role }),
      ]) {
        const footprint: TopologyNodeFootprint = footprintForNode(node);
        expect(footprint.halfWidth).toBeGreaterThan(0);
        expect(footprint.halfHeight).toBeGreaterThan(0);
        expect(Number.isFinite(footprint.collisionRadius)).toBe(true);
        expect(footprint.collisionRadius).toBeGreaterThan(footprint.halfWidth);
        expect(footprint.inkHalfWidth).toBeGreaterThanOrEqual(
          footprint.halfWidth,
        );
        expect(footprint.labelBottom).toBeGreaterThanOrEqual(
          footprint.labelBaselineOffset,
        );
      }
    }
  });

  test("an endpoint is drawn at leaf size whatever its role says", () => {
    const camera: TopologyNodeFootprint = footprintForNode(
      makeEndpoint("endpoint:cam", { role: "camera" }),
    );
    expect(camera.halfWidth).toBe(ENDPOINT_NODE_HALF_WIDTH);
    expect(camera.halfHeight).toBe(ENDPOINT_NODE_HALF_HEIGHT);
  });

  test("an unclassified graph is laid out exactly as it was before roles existed", () => {
    /*
     * The regression that matters most here: every existing saved
     * arrangement, and every layout test in this suite, was written
     * against these numbers.
     */
    const device: TopologyNodeFootprint = footprintForNode(
      makeDevice("d1", { name: "core-1" }),
    );
    expect(device.halfWidth).toBe(DEVICE_NODE_RADIUS);
    expect(device.halfHeight).toBe(DEVICE_NODE_RADIUS);
    expect(device.collisionRadius).toBe(
      DEVICE_NODE_RADIUS + NODE_COLLISION_PADDING,
    );
    expect(device.labelBaselineOffset).toBe(DEVICE_LABEL_BASELINE_OFFSET);

    const endpoint: TopologyNodeFootprint = footprintForNode(
      makeEndpoint("endpoint:e1", { name: "pos-1" }),
    );
    expect(endpoint.halfWidth).toBe(ENDPOINT_NODE_HALF_WIDTH);
    expect(endpoint.halfHeight).toBe(ENDPOINT_NODE_HALF_HEIGHT);
    expect(endpoint.labelBaselineOffset).toBe(ENDPOINT_LABEL_BASELINE_OFFSET);
  });
});
