import { TelemetryAttributeService } from "../../../Server/Services/TelemetryAttributeService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Security events are the fourth signal to grow an attribute picker, and the
 * one where it matters most: the OCSF schema only has typed columns for the
 * common fields, so everything else a SIEM sent - device.hostname,
 * finding_info.title, metadata.product.name - lives in the `attributes` map.
 * The security events table offers those as columns, and this is the query
 * that tells it which ones exist.
 *
 * TelemetryType.SecurityEvent was in the enum long before there was a source
 * for it, and getTelemetrySource returns null for anything it does not
 * recognise - which makes a missing case a silently empty picker rather than
 * an error. That is what the first test here exists to catch.
 */

type SourceShape = {
  tableName: string;
  attributesColumn: string;
  attributeKeysColumn?: string | undefined;
  timeColumn: string;
  isMutableMetricSource?: boolean | undefined;
};

type GetSourceFunction = (telemetryType: TelemetryType) => SourceShape | null;

const getSource: GetSourceFunction = (
  telemetryType: TelemetryType,
): SourceShape | null => {
  return (
    new TelemetryAttributeService() as unknown as {
      getTelemetrySource: (type: TelemetryType) => SourceShape | null;
    }
  ).getTelemetrySource(telemetryType);
};

describe("TelemetryAttributeService - security event source", () => {
  test("security events resolve to a source at all", () => {
    expect(getSource(TelemetryType.SecurityEvent)).not.toBeNull();
  });

  test("points at the security event table", () => {
    const source: SourceShape = getSource(
      TelemetryType.SecurityEvent,
    ) as SourceShape;

    expect(source.tableName).toBe(AnalyticsTableName.SecurityEvent);
    expect(source.tableName).toBe(new SecurityEvent().tableName);
  });

  /*
   * The names are bound into the statement as identifiers, so a typo here is
   * not a type error anywhere - it is a query that fails at runtime against a
   * table that does exist.
   */
  test("names columns that are actually on the model", () => {
    const source: SourceShape = getSource(
      TelemetryType.SecurityEvent,
    ) as SourceShape;

    const model: SecurityEvent = new SecurityEvent();

    expect(model.hasColumn(source.attributesColumn)).toBe(true);
    expect(model.hasColumn(source.attributeKeysColumn as string)).toBe(true);
    expect(model.hasColumn(source.timeColumn)).toBe(true);
  });

  /*
   * The sidecar array column is what keeps this cheap: without it the SQL
   * falls back to mapKeys(attributes), which reads the whole map off every
   * row instead of an already-denormalized array.
   */
  test("uses the attributeKeys sidecar rather than expanding the map", () => {
    const source: SourceShape = getSource(
      TelemetryType.SecurityEvent,
    ) as SourceShape;

    expect(source.attributeKeysColumn).toBe("attributeKeys");
    expect(source.attributesColumn).toBe("attributes");
    expect(source.timeColumn).toBe("time");
  });

  test("is not treated as a mutable metric source", () => {
    const source: SourceShape = getSource(
      TelemetryType.SecurityEvent,
    ) as SourceShape;

    expect(source.isMutableMetricSource).toBeFalsy();
  });

  // A signal with no source still degrades to "no attributes", not an error.
  test("a telemetry type with no source is still null", () => {
    expect(getSource(TelemetryType.Profile)).toBeNull();
  });
});

describe("TelemetryAttributeService - security event attribute keys query", () => {
  type BuildAttributesInput = {
    projectId: ObjectID;
    tableName: string;
    attributesColumn: string;
    attributeKeysColumn?: string | undefined;
    timeColumn: string;
    metricName?: string | undefined;
    isMutableMetricSource?: boolean | undefined;
  };

  type BuildStatementFunction = () => Statement;

  const buildStatement: BuildStatementFunction = (): Statement => {
    const source: SourceShape = getSource(
      TelemetryType.SecurityEvent,
    ) as SourceShape;

    return (
      TelemetryAttributeService as unknown as {
        buildAttributesStatement: (data: BuildAttributesInput) => Statement;
      }
    ).buildAttributesStatement({
      projectId: ObjectID.generate(),
      tableName: source.tableName,
      attributesColumn: source.attributesColumn,
      attributeKeysColumn: source.attributeKeysColumn,
      timeColumn: source.timeColumn,
    });
  };

  /*
   * Table and column names ride in as {pN:Identifier} bindings rather than as
   * SQL text, so everything below asserts against the bound parameters. That
   * is the point of the check as much as a quirk of it: nothing
   * caller-influenced is ever concatenated into these statements.
   */
  test("aggregates the sidecar array over the security event table", () => {
    const statement: Statement = buildStatement();

    expect(Object.values(statement.query_params)).toContain(
      AnalyticsTableName.SecurityEvent,
    );
    expect(statement.query).toContain("groupUniqArrayArray(");
    expect(Object.values(statement.query_params)).toContain("attributeKeys");

    /*
     * The mapKeys() branch is the fallback for tables with no sidecar column;
     * taking it here would read the whole map off every row.
     */
    expect(statement.query).not.toContain("mapKeys(");
  });

  test("scopes to one project, as a bound parameter", () => {
    const statement: Statement = buildStatement();

    expect(statement.query).toContain("projectId = ");
    /*
     * A tenant id interpolated into SQL would be both an injection surface
     * and a cache-buster; every value in these statements is parameterized.
     */
    expect(statement.query).toMatch(/projectId = \{p\d+:String\}/);
  });

  test("bounds the scan by time and by execution budget", () => {
    const statement: Statement = buildStatement();

    expect(Object.values(statement.query_params)).toContain("time");
    expect(statement.query).toMatch(/>= \{p\d+:DateTime\}/);
    expect(statement.query).toContain("max_execution_time = 45");
    expect(statement.query).toContain("timeout_overflow_mode = 'break'");
  });

  test("skips rows with no attributes at all", () => {
    const statement: Statement = buildStatement();

    expect(statement.query).toMatch(/NOT empty\(\{p\d+:Identifier\}\)/);
  });

  // metricName is a Metric-only filter; nothing here should mention `name`.
  test("does not filter by metric name", () => {
    const statement: Statement = buildStatement();

    expect(statement.query).not.toContain("AND name = ");
  });
});

describe("TelemetryAttributeService - security event attribute values query", () => {
  type BuildValuesInput = {
    projectId: ObjectID;
    source: SourceShape;
    metricName?: string | undefined;
    attributeKey: string;
    searchText?: string | undefined;
  };

  type BuildValuesFunction = (searchText?: string | undefined) => Statement;

  const buildValues: BuildValuesFunction = (
    searchText?: string | undefined,
  ): Statement => {
    return (
      TelemetryAttributeService as unknown as {
        buildAttributeValuesStatement: (data: BuildValuesInput) => Statement;
      }
    ).buildAttributeValuesStatement({
      projectId: ObjectID.generate(),
      source: getSource(TelemetryType.SecurityEvent) as SourceShape,
      attributeKey: "device.hostname",
      ...(searchText === undefined ? {} : { searchText }),
    });
  };

  test("reads the requested key out of the map on the security event table", () => {
    const statement: Statement = buildValues();

    const params: Array<unknown> = Object.values(statement.query_params);

    expect(params).toContain(AnalyticsTableName.SecurityEvent);
    expect(params).toContain("attributes");
    expect(params).toContain("device.hostname");
    expect(statement.query).toContain("mapContains(");
  });

  /*
   * The key is caller-supplied, so it must never reach the SQL text - an
   * attribute key can contain quotes, brackets, anything a payload had.
   */
  test("never inlines the attribute key into the SQL text", () => {
    const statement: Statement = buildValues();

    expect(statement.query).not.toContain("device.hostname");
  });

  test("narrows server-side when the picker sends search text", () => {
    const statement: Statement = buildValues("web");

    expect(statement.query).toContain("ILIKE");
    expect(Object.values(statement.query_params)).toContain("%web%");
  });

  test("whitespace-only search text is not a filter", () => {
    const statement: Statement = buildValues("   ");

    expect(statement.query).not.toContain("ILIKE");
  });

  test("caps the number of values returned", () => {
    const statement: Statement = buildValues();

    expect(statement.query).toContain("ORDER BY attributeValue ASC");
    expect(statement.query).toContain("LIMIT ");
  });
});
