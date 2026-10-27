import { describe, expect, test } from "@jest/globals";
import { getClickhouseDatabaseName } from "../../../../../Server/Utils/AnalyticsDatabase/ClusterConfig";
import { Statement } from "../../../../../Server/Utils/AnalyticsDatabase/Statement";
import {
  TELEMETRY_SCAN_QUERY_TIME_LIMIT_IN_SECONDS,
  TelemetryScanWindow,
  buildAuditRecordsStatement,
  buildFlowAddressesStatement,
  buildFlowsOfAddressesStatement,
  buildLargeTransferStatement,
  buildMassDeleteStatement,
  buildNetworkSweepStatement,
  buildPortScanStatement,
  buildRumUserCountriesStatement,
  buildTraceCandidatesStatement,
} from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/TelemetryScanStatements";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../../../../Types/Date";
import ObjectID from "../../../../../Types/ObjectID";
import { AUDIT_SECURITY_RESOURCE_TYPES } from "../../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";
import {
  EPHEMERAL_PORT_START,
  SWEEP_IGNORED_PORTS,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/FlowSignals";
import {
  PROMPT_INJECTION_PHRASES,
  getTraceScanUrlMarkers,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";

/*
 * The reads of "Your OneUptime data": each one project's, bounded twice in
 * time (by arrival, the window, and by when the data happened, which the
 * table prunes on) and bounded in rows - with every value bound as a
 * parameter, never written into the SQL.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-00000000p201",
);

const WINDOW: TelemetryScanWindow = {
  projectId: PROJECT_ID,
  arrivedAfter: new Date("2026-10-27T10:00:00.000Z"),
  arrivedUntil: new Date("2026-10-27T10:05:00.000Z"),
  happenedAfter: new Date("2026-10-27T09:00:00.000Z"),
};

function bound(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

function boundIncludes(statement: Statement): Array<Array<unknown>> {
  return bound(statement)
    .filter((value: unknown): boolean => {
      return value instanceof Includes || Array.isArray(value);
    })
    .map((value: unknown): Array<unknown> => {
      return value instanceof Includes
        ? (value.values as Array<unknown>)
        : (value as Array<unknown>);
    });
}

function expectProjectFirst(statement: Statement): void {
  const where: string = statement.query.slice(
    statement.query.indexOf(" WHERE "),
  );

  expect(where.startsWith(" WHERE projectId = {p")).toBe(true);
  expect(bound(statement)).toContain(PROJECT_ID.toString());
}

function expectTimeLimited(statement: Statement): void {
  expect(statement.query).toContain(
    `max_execution_time = ${TELEMETRY_SCAN_QUERY_TIME_LIMIT_IN_SECONDS}`,
  );
  expect(statement.query).toContain("timeout_overflow_mode = 'throw'");
}

function asBound(date: Date): string {
  return OneUptimeDate.toClickhouseDateTime(date);
}

describe("the trace read", () => {
  const statement: Statement = buildTraceCandidatesStatement({
    ...WINDOW,
    limit: 1000,
    offset: 2000,
  });

  test("reads one project's spans that arrived in the window, pruned by when they started", () => {
    expect(statement.query).toContain(
      `FROM ${getClickhouseDatabaseName()}.SpanItemV3`,
    );
    expectProjectFirst(statement);
    expect(statement.query).toContain("AND startTime >= {");
    expect(statement.query).toContain("AND createdAt > {");
    expect(statement.query).toContain("AND createdAt <= {");
    expect(statement.query).toContain("AND retentionDate >= now()");
    expect(bound(statement)).toContain(asBound(WINDOW.happenedAfter));
    expect(bound(statement)).toContain(asBound(WINDOW.arrivedAfter));
    expect(bound(statement)).toContain(asBound(WINDOW.arrivedUntil));
    expectTimeLimited(statement);
  });

  test("only server spans with an attack in their URL, and LLM spans with an injection, leave the database", () => {
    expect(statement.query).toContain("multiSearchAnyCaseInsensitive(concat(");
    expect(statement.query).toContain(
      "isLlmSpan = 1 AND multiSearchAnyCaseInsensitive(llmUserMessagePreview,",
    );
    expect(bound(statement)).toContain("SPAN_KIND_SERVER");
    expect(boundIncludes(statement)).toContainEqual(getTraceScanUrlMarkers());
    expect(boundIncludes(statement)).toContainEqual([
      ...PROMPT_INJECTION_PHRASES,
    ]);
  });

  test("pages in a fixed order", () => {
    expect(statement.query).toContain(
      "ORDER BY createdAt ASC, traceId ASC, spanId ASC LIMIT {",
    );
    expect(bound(statement)).toContain(1000);
    expect(bound(statement)).toContain(2000);
  });

  test("returns only the attributes it reads, not a span's dozens", () => {
    expect(statement.query).toContain(
      "mapFilter((key, value) -> has({",
    );
    expect(statement.query).toContain("attributes) AS attributes");
  });

  test("no marker is written into the SQL", () => {
    for (const marker of getTraceScanUrlMarkers()) {
      expect(statement.query.toLowerCase()).not.toContain(marker);
    }
  });
});

describe("the flow reads", () => {
  test("a port scan counts only service ports, per pair, at least the threshold", () => {
    const statement: Statement = buildPortScanStatement({
      ...WINDOW,
      minPorts: 25,
      limit: 50,
    });

    expect(statement.query).toContain(
      `FROM ${getClickhouseDatabaseName()}.NetworkFlowV1`,
    );
    expectProjectFirst(statement);
    expect(statement.query).toContain(
      `uniqExactIf(dstPort, dstPort > 0 AND dstPort < ${EPHEMERAL_PORT_START}) AS ports`,
    );
    expect(statement.query).toContain("GROUP BY srcIp, dstIp HAVING ports >= {");
    expect(statement.query).toContain("AND ingestedAt > {");
    expect(statement.query).toContain("AND flowStartAt >= {");
    expect(bound(statement)).toContain(25);
    expect(bound(statement)).toContain(50);
    expectTimeLimited(statement);
  });

  test("a sweep leaves out the ports clients reach many hosts on", () => {
    const statement: Statement = buildNetworkSweepStatement({
      ...WINDOW,
      minHosts: 30,
      limit: 50,
    });

    expectProjectFirst(statement);
    expect(statement.query).toContain(
      `AND dstPort NOT IN (${SWEEP_IGNORED_PORTS.join(", ")})`,
    );
    expect(statement.query).toContain(
      "GROUP BY srcIp, dstPort HAVING hosts >= {",
    );
  });

  test("a large transfer binds its byte threshold as a 64-bit number", () => {
    const statement: Statement = buildLargeTransferStatement({
      ...WINDOW,
      minBytes: 5 * 1024 * 1024 * 1024,
      limit: 50,
    });

    expectProjectFirst(statement);
    expect(statement.query).toContain("HAVING bytes >= {");
    expect(statement.query).toMatch(/HAVING bytes >= \{p\d+:Int64\}/);
    expect(bound(statement)).toContain(5 * 1024 * 1024 * 1024);
    expect(statement.query).toContain("argMax(dstPort, octets) AS topPort");
  });

  test("the threat-intel reads ask for the busiest addresses, then the traffic of the known ones", () => {
    const addresses: Statement = buildFlowAddressesStatement({
      ...WINDOW,
      limit: 5000,
    });
    const traffic: Statement = buildFlowsOfAddressesStatement({
      ...WINDOW,
      addresses: ["203.0.113.50", "198.51.100.9"],
      limit: 50,
    });

    expect(addresses.query).toContain("arrayJoin([srcIp, dstIp]) AS address");
    expect(addresses.query).toContain("ORDER BY flows DESC");
    expect(traffic.query).toContain("AND (srcIp IN ({");
    expect(traffic.query).toContain("OR dstIp IN ({");
    expect(boundIncludes(traffic)).toContainEqual([
      "203.0.113.50",
      "198.51.100.9",
    ]);
    expect(traffic.query).not.toContain("203.0.113.50");
  });
});

describe("the audit log reads", () => {
  test("a page of the records about what security cares for, in a fixed order", () => {
    const statement: Statement = buildAuditRecordsStatement({
      projectId: PROJECT_ID,
      arrivedAfter: WINDOW.arrivedAfter,
      arrivedUntil: WINDOW.arrivedUntil,
      limit: 1000,
      offset: 0,
    });

    expect(statement.query).toContain(
      `FROM ${getClickhouseDatabaseName()}.AuditLogV2`,
    );
    expectProjectFirst(statement);
    expect(statement.query).toContain("AND resourceType IN ({");
    expect(boundIncludes(statement)).toContainEqual([
      ...AUDIT_SECURITY_RESOURCE_TYPES,
    ]);
    expect(statement.query).toContain("ORDER BY createdAt ASC, _id ASC");
    expect(statement.query).not.toContain("API Key");
  });

  test("a mass delete sums one actor's deletes, with aliases that never shadow a column", () => {
    const statement: Statement = buildMassDeleteStatement({
      projectId: PROJECT_ID,
      arrivedAfter: WINDOW.arrivedAfter,
      arrivedUntil: WINDOW.arrivedUntil,
      minDeletes: 25,
      limit: 20,
    });

    expectProjectFirst(statement);
    expect(statement.query).toContain("AND action = {");
    expect(bound(statement)).toContain("Delete");
    expect(statement.query).toContain("GROUP BY userId, apiKeyId HAVING deletes >= {");
    expect(statement.query).toContain("toString(userId) AS actorUserId");
    expect(statement.query).not.toMatch(/ AS userId\b/);
  });
});

describe("the session replay read", () => {
  const statement: Statement = buildRumUserCountriesStatement({
    projectId: PROJECT_ID,
    arrivedAfter: WINDOW.arrivedAfter,
    arrivedUntil: WINDOW.arrivedUntil,
    startedAfter: new Date("2026-10-27T08:05:00.000Z"),
    sessionsPerUser: 20,
    limit: 50,
  });

  test("reads the newest version of each session, then groups them by user", () => {
    expect(statement.query).toContain(
      `FROM ${getClickhouseDatabaseName()}.RumSessionV1`,
    );
    expectProjectFirst(statement);
    expect(statement.query).toContain(
      "argMax(identifiedUserKey, version) AS userKey",
    );
    expect(statement.query).toContain("GROUP BY rumApplicationId, sessionId");
    expect(statement.query).toContain(
      "HAVING uniqExact(country) >= 2 AND max(arrivedAt) > {",
    );
  });

  test("the sessions a user returns is a literal of the aggregate, not a parameter", () => {
    expect(statement.query).toContain("groupArray(20)(tuple(");
  });

  test("no alias reuses a column the inner query filters on", () => {
    expect(statement.query).toContain("min(startTime) AS sessionStart");
    expect(statement.query).not.toMatch(/ AS startTime\b/);
    expect(statement.query).not.toMatch(/ AS countryCode\b/);
  });
});
