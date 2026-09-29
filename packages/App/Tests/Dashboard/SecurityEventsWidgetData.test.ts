import { describe, expect, test } from "@jest/globals";
import {
  MAX_FLOW_SOURCE_NODES,
  OTHER_FLOW_SOURCE_NAME,
  SecurityEventFlowRecord,
  SecurityEventsFlowData,
  SecurityEventsFlowLink,
  SecurityEventsFlowNode,
  UNKNOWN_FLOW_NAME,
  buildSecurityEventsFlow,
  getFlowSourceName,
  getSecurityEventSeverityColor,
  resolveSecurityEventsFlowMaxEvents,
  resolveSecurityEventsListLimit,
} from "../../FeatureSet/Dashboard/src/Components/Dashboard/Components/SecurityEventsWidgetData";

function makeRecord(
  overrides: Partial<SecurityEventFlowRecord> = {},
): SecurityEventFlowRecord {
  return {
    vendorName: "Google SecOps",
    className: "Authentication",
    severityName: "High",
    principalHost: "host-1",
    targetHost: "host-2",
    ...overrides,
  };
}

function nodeNames(flow: SecurityEventsFlowData): Array<string> {
  return flow.nodes.map((node: SecurityEventsFlowNode): string => {
    return node.name;
  });
}

function findLink(
  flow: SecurityEventsFlowData,
  sourceName: string,
  targetName: string,
): SecurityEventsFlowLink | undefined {
  const names: Array<string> = nodeNames(flow);
  return flow.links.find((link: SecurityEventsFlowLink): boolean => {
    return (
      names[link.source] === sourceName && names[link.target] === targetName
    );
  });
}

describe("SecurityEventsWidgetData.buildSecurityEventsFlow", () => {
  test("returns empty flow for empty input", () => {
    const flow: SecurityEventsFlowData = buildSecurityEventsFlow([]);

    expect(flow).toEqual({ nodes: [], links: [] });
  });

  test("aggregates identical events into single links with counts", () => {
    const flow: SecurityEventsFlowData = buildSecurityEventsFlow([
      makeRecord(),
      makeRecord(),
      makeRecord({ severityName: "Critical" }),
    ]);

    // One source, one class, two severities.
    expect(nodeNames(flow)).toEqual([
      "Google SecOps",
      "Authentication",
      "High",
      "Critical",
    ]);

    // source -> class carries all three events.
    expect(findLink(flow, "Google SecOps", "Authentication")?.value).toBe(3);

    // class -> severity splits by severity.
    expect(findLink(flow, "Authentication", "High")?.value).toBe(2);
    expect(findLink(flow, "Authentication", "Critical")?.value).toBe(1);

    expect(flow.links).toHaveLength(3);
  });

  test("links reference nodes by index into the flat node array", () => {
    const flow: SecurityEventsFlowData = buildSecurityEventsFlow([
      makeRecord({ vendorName: "Vendor A" }),
      makeRecord({ vendorName: "Vendor B", className: "DNS Activity" }),
    ]);

    for (const link of flow.links) {
      expect(link.source).toBeGreaterThanOrEqual(0);
      expect(link.source).toBeLessThan(flow.nodes.length);
      expect(link.target).toBeGreaterThanOrEqual(0);
      expect(link.target).toBeLessThan(flow.nodes.length);
      // Sankey layers only flow forward.
      expect(link.source).toBeLessThan(link.target);
    }

    expect(findLink(flow, "Vendor A", "Authentication")?.value).toBe(1);
    expect(findLink(flow, "Vendor B", "DNS Activity")?.value).toBe(1);
    expect(findLink(flow, "Authentication", "High")?.value).toBe(1);
    expect(findLink(flow, "DNS Activity", "High")?.value).toBe(1);
  });

  test("source falls back from vendorName to principalHost to unknown", () => {
    expect(getFlowSourceName(makeRecord())).toBe("Google SecOps");
    expect(getFlowSourceName(makeRecord({ vendorName: "" }))).toBe("host-1");
    expect(
      getFlowSourceName(makeRecord({ vendorName: "  ", principalHost: "" })),
    ).toBe(UNKNOWN_FLOW_NAME);
  });

  test("missing class and severity names are normalized to unknown", () => {
    const flow: SecurityEventsFlowData = buildSecurityEventsFlow([
      makeRecord({ className: "", severityName: undefined }),
    ]);

    expect(nodeNames(flow)).toEqual([
      "Google SecOps",
      UNKNOWN_FLOW_NAME,
      UNKNOWN_FLOW_NAME,
    ]);
    expect(flow.links).toHaveLength(2);
  });

  test("buckets sources beyond the 10 most frequent into other", () => {
    const records: Array<SecurityEventFlowRecord> = [];

    // 12 distinct sources: source-1 appears 13 times, source-2 12 times, ...
    for (let sourceIndex: number = 1; sourceIndex <= 12; sourceIndex++) {
      const occurrences: number = 14 - sourceIndex;
      for (let occurrence: number = 0; occurrence < occurrences; occurrence++) {
        records.push(makeRecord({ vendorName: `source-${sourceIndex}` }));
      }
    }

    const flow: SecurityEventsFlowData = buildSecurityEventsFlow(records);
    const names: Array<string> = nodeNames(flow);

    // 10 kept sources + "other" + 1 class + 1 severity.
    expect(flow.nodes).toHaveLength(MAX_FLOW_SOURCE_NODES + 1 + 1 + 1);

    for (let sourceIndex: number = 1; sourceIndex <= 10; sourceIndex++) {
      expect(names).toContain(`source-${sourceIndex}`);
    }
    expect(names).not.toContain("source-11");
    expect(names).not.toContain("source-12");
    expect(names).toContain(OTHER_FLOW_SOURCE_NAME);

    // "other" aggregates the two dropped sources (3 + 2 events).
    expect(
      findLink(flow, OTHER_FLOW_SOURCE_NAME, "Authentication")?.value,
    ).toBe(5);

    // Kept sources keep their own counts.
    expect(findLink(flow, "source-1", "Authentication")?.value).toBe(13);
  });

  test("keeps exactly 10 sources without an other bucket when 10 exist", () => {
    const records: Array<SecurityEventFlowRecord> = [];

    for (let sourceIndex: number = 1; sourceIndex <= 10; sourceIndex++) {
      records.push(makeRecord({ vendorName: `source-${sourceIndex}` }));
    }

    const flow: SecurityEventsFlowData = buildSecurityEventsFlow(records);

    expect(nodeNames(flow)).not.toContain(OTHER_FLOW_SOURCE_NAME);
    // 10 sources + 1 class + 1 severity.
    expect(flow.nodes).toHaveLength(12);
  });
});

describe("SecurityEventsWidgetData.resolveSecurityEventsListLimit", () => {
  test("defaults to 10 and caps at 50", () => {
    expect(resolveSecurityEventsListLimit(undefined)).toBe(10);
    expect(resolveSecurityEventsListLimit(0)).toBe(10);
    expect(resolveSecurityEventsListLimit(25)).toBe(25);
    expect(resolveSecurityEventsListLimit(500)).toBe(50);
    expect(resolveSecurityEventsListLimit(-5)).toBe(1);
  });
});

describe("SecurityEventsWidgetData.resolveSecurityEventsFlowMaxEvents", () => {
  test("defaults to 500 and caps at 1000", () => {
    expect(resolveSecurityEventsFlowMaxEvents(undefined)).toBe(500);
    expect(resolveSecurityEventsFlowMaxEvents(0)).toBe(500);
    expect(resolveSecurityEventsFlowMaxEvents(750)).toBe(750);
    expect(resolveSecurityEventsFlowMaxEvents(5000)).toBe(1000);
    expect(resolveSecurityEventsFlowMaxEvents(-1)).toBe(1);
  });
});

describe("SecurityEventsWidgetData.getSecurityEventSeverityColor", () => {
  test("maps severities to their colors, defaulting to gray", () => {
    expect(getSecurityEventSeverityColor("Critical")).toBe("#dc2626");
    expect(getSecurityEventSeverityColor("Fatal")).toBe("#dc2626");
    expect(getSecurityEventSeverityColor("High")).toBe("#ea580c");
    expect(getSecurityEventSeverityColor("Medium")).toBe("#d97706");
    expect(getSecurityEventSeverityColor("Low")).toBe("#2563eb");
    expect(getSecurityEventSeverityColor("Informational")).toBe("#64748b");
    expect(getSecurityEventSeverityColor("Unknown")).toBe("#64748b");
    expect(getSecurityEventSeverityColor("")).toBe("#64748b");
  });
});
