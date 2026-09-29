/*
 * Pure data helpers behind the security-event dashboard widgets. No React,
 * no fetches — everything here is a function over plain data so the unit
 * tests in App/Tests/Dashboard/SecurityEventsWidgetData.test.ts can hold the
 * aggregation logic (Sankey flow building, limit clamping, severity colors)
 * without rendering anything.
 */

export interface SecurityEventFlowRecord {
  className?: string | undefined;
  severityName?: string | undefined;
  principalHost?: string | undefined;
  targetHost?: string | undefined;
  vendorName?: string | undefined;
}

export interface SecurityEventsFlowNode {
  name: string;
}

export interface SecurityEventsFlowLink {
  source: number;
  target: number;
  value: number;
}

export interface SecurityEventsFlowData {
  nodes: Array<SecurityEventsFlowNode>;
  links: Array<SecurityEventsFlowLink>;
}

export const UNKNOWN_FLOW_NAME: string = "unknown";
export const OTHER_FLOW_SOURCE_NAME: string = "other";

// The Sankey caps its source layer at the N most frequent sources.
export const MAX_FLOW_SOURCE_NODES: number = 10;

export const DEFAULT_SECURITY_EVENTS_LIST_LIMIT: number = 10;
export const MAX_SECURITY_EVENTS_LIST_LIMIT: number = 50;

export const DEFAULT_SECURITY_EVENTS_FLOW_MAX_EVENTS: number = 500;
export const MAX_SECURITY_EVENTS_FLOW_MAX_EVENTS: number = 1000;

// Map keys join two node names; NUL cannot appear in event field values.
const KEY_SEPARATOR: string = "\u0000";

function normalizeName(value: string | undefined): string {
  const trimmed: string = (value || "").trim();
  return trimmed || UNKNOWN_FLOW_NAME;
}

/**
 * The source (layer 1) node an event flows out of: the vendor that produced
 * it, falling back to the acting host, falling back to "unknown".
 */
export function getFlowSourceName(record: SecurityEventFlowRecord): string {
  const vendorName: string = (record.vendorName || "").trim();
  if (vendorName) {
    return vendorName;
  }

  const principalHost: string = (record.principalHost || "").trim();
  if (principalHost) {
    return principalHost;
  }

  return UNKNOWN_FLOW_NAME;
}

/**
 * Number of rows the list widget shows: the configured limit, defaulting to
 * 10 and clamped to 1..50.
 */
export function resolveSecurityEventsListLimit(
  limit: number | undefined,
): number {
  const requested: number = Math.floor(
    limit || DEFAULT_SECURITY_EVENTS_LIST_LIMIT,
  );

  return Math.min(Math.max(requested, 1), MAX_SECURITY_EVENTS_LIST_LIMIT);
}

/**
 * Number of events the flow widget fetches: the configured maximum,
 * defaulting to 500 and clamped to 1..1000.
 */
export function resolveSecurityEventsFlowMaxEvents(
  maxEvents: number | undefined,
): number {
  const requested: number = Math.floor(
    maxEvents || DEFAULT_SECURITY_EVENTS_FLOW_MAX_EVENTS,
  );

  return Math.min(Math.max(requested, 1), MAX_SECURITY_EVENTS_FLOW_MAX_EVENTS);
}

/**
 * Color for an OCSF severity name. Critical and Fatal are red, High orange,
 * Medium amber, Low blue; everything else (Informational, Unknown, Other,
 * unrecognized) is neutral gray.
 */
export function getSecurityEventSeverityColor(severityName: string): string {
  const normalized: string = (severityName || "").trim().toLowerCase();

  if (normalized === "critical" || normalized === "fatal") {
    return "#dc2626";
  }

  if (normalized === "high") {
    return "#ea580c";
  }

  if (normalized === "medium") {
    return "#d97706";
  }

  if (normalized === "low") {
    return "#2563eb";
  }

  return "#64748b";
}

/**
 * Builds the 3-layer Sankey flow the SecurityEventsFlow widget renders:
 *
 *   layer 1: source (vendorName || principalHost || "unknown")
 *   layer 2: OCSF event class name
 *   layer 3: OCSF severity name
 *
 * Links aggregate event counts (source → class, class → severity). Layer 1
 * keeps only the 10 most frequent sources; the rest are bucketed into a
 * single "other" node so a noisy estate cannot explode the diagram.
 *
 * Nodes are returned layer by layer and links reference them by index —
 * exactly the { nodes: [{name}], links: [{source, target, value}] } shape
 * recharts' Sankey wants.
 */
export function buildSecurityEventsFlow(
  records: Array<SecurityEventFlowRecord>,
): SecurityEventsFlowData {
  if (records.length === 0) {
    return { nodes: [], links: [] };
  }

  // Pass 1: how often does each source appear, to pick the kept set.
  const sourceCounts: Map<string, number> = new Map();

  for (const record of records) {
    const sourceName: string = getFlowSourceName(record);
    sourceCounts.set(sourceName, (sourceCounts.get(sourceName) || 0) + 1);
  }

  const rankedSources: Array<string> = Array.from(sourceCounts.entries())
    .sort((a: [string, number], b: [string, number]): number => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      // Deterministic order for equal counts.
      return a[0].localeCompare(b[0]);
    })
    .map((entry: [string, number]): string => {
      return entry[0];
    });

  const keptSources: Set<string> = new Set(
    rankedSources.slice(0, MAX_FLOW_SOURCE_NODES),
  );
  const hasOtherBucket: boolean = rankedSources.length > keptSources.size;

  // Pass 2: aggregate link counts between adjacent layers.
  const sourceToClassCounts: Map<string, number> = new Map();
  const classToSeverityCounts: Map<string, number> = new Map();
  const classNames: Array<string> = [];
  const severityNames: Array<string> = [];

  for (const record of records) {
    const rawSourceName: string = getFlowSourceName(record);
    const sourceName: string = keptSources.has(rawSourceName)
      ? rawSourceName
      : OTHER_FLOW_SOURCE_NAME;
    const className: string = normalizeName(record.className);
    const severityName: string = normalizeName(record.severityName);

    if (!classNames.includes(className)) {
      classNames.push(className);
    }

    if (!severityNames.includes(severityName)) {
      severityNames.push(severityName);
    }

    const sourceToClassKey: string = `${sourceName}${KEY_SEPARATOR}${className}`;
    sourceToClassCounts.set(
      sourceToClassKey,
      (sourceToClassCounts.get(sourceToClassKey) || 0) + 1,
    );

    const classToSeverityKey: string = `${className}${KEY_SEPARATOR}${severityName}`;
    classToSeverityCounts.set(
      classToSeverityKey,
      (classToSeverityCounts.get(classToSeverityKey) || 0) + 1,
    );
  }

  /*
   * Node order: kept sources by frequency (with "other" last in the layer),
   * then classes and severities in first-seen order. Indices are per the
   * flat node array, which is what the links reference.
   */
  const sourceLayer: Array<string> = rankedSources.slice(
    0,
    MAX_FLOW_SOURCE_NODES,
  );
  if (hasOtherBucket) {
    sourceLayer.push(OTHER_FLOW_SOURCE_NAME);
  }

  const nodes: Array<SecurityEventsFlowNode> = [];
  const sourceIndexByName: Map<string, number> = new Map();
  const classIndexByName: Map<string, number> = new Map();
  const severityIndexByName: Map<string, number> = new Map();

  for (const sourceName of sourceLayer) {
    sourceIndexByName.set(sourceName, nodes.length);
    nodes.push({ name: sourceName });
  }

  for (const className of classNames) {
    classIndexByName.set(className, nodes.length);
    nodes.push({ name: className });
  }

  for (const severityName of severityNames) {
    severityIndexByName.set(severityName, nodes.length);
    nodes.push({ name: severityName });
  }

  const links: Array<SecurityEventsFlowLink> = [];

  for (const [key, value] of sourceToClassCounts.entries()) {
    const [sourceName, className] = key.split(KEY_SEPARATOR) as [
      string,
      string,
    ];
    links.push({
      source: sourceIndexByName.get(sourceName)!,
      target: classIndexByName.get(className)!,
      value: value,
    });
  }

  for (const [key, value] of classToSeverityCounts.entries()) {
    const [className, severityName] = key.split(KEY_SEPARATOR) as [
      string,
      string,
    ];
    links.push({
      source: classIndexByName.get(className)!,
      target: severityIndexByName.get(severityName)!,
      value: value,
    });
  }

  return { nodes, links };
}
