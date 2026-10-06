import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import "../../TestingUtils/Init";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import JSONFunctions from "../../../../Types/JSONFunctions";
import { JSONObject } from "../../../../Types/JSON";
import {
  PROCESS_CPU_UTILIZATION_METRIC_NAME,
  processCpuWaitExclusion,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/Processes";
import { describe, expect, test } from "@jest/globals";

/*
 * The Host Processes list asks ClickHouse for a process's CPU readings
 * without the wait ones (OneUptime issue #4477). The filter is built in the
 * browser, serialized over the API, deserialized by the server and only then
 * compiled to SQL - and both the API and the compiler have several ways to
 * mangle an operator nested inside a map column. These tests walk the whole
 * way with the real Metric model, so the list's filter is checked as
 * ClickHouse will see it rather than as the page happened to build it.
 */

// What AnalyticsModelAPI.getList sends and BaseAnalyticsAPI reads back.
function overTheWire(query: JSONObject): JSONObject {
  return JSONFunctions.deserialize(
    JSON.parse(JSON.stringify(JSONFunctions.serialize(query))) as JSONObject,
  );
}

// The statement with its bound parameters written in, for reading.
function inline(statement: Statement): string {
  const params: Record<string, unknown> = statement.query_params;

  return statement.query.replace(
    /\{(p\d+):([^}]+)\}/g,
    (_match: string, name: string, type: string): string => {
      const value: unknown = params[name];
      return type === "Identifier" ? String(value) : `'${String(value)}'`;
    },
  );
}

function cpuQueryWhere(): string {
  const generator: StatementGenerator<Metric> = new StatementGenerator<Metric>({
    modelType: Metric,
    database: ClickhouseAppInstance,
  });

  const query: JSONObject = overTheWire({
    name: PROCESS_CPU_UTILIZATION_METRIC_NAME,
    attributes: {
      "resource.host.name": "web-01",
      ...processCpuWaitExclusion(),
    },
  } as unknown as JSONObject);

  return inline(generator.toWhereStatement(query as any));
}

describe("the Processes list's CPU filter, page to SQL", () => {
  test("survives the API round trip as NotEqual wrappers", () => {
    const query: JSONObject = overTheWire({
      attributes: processCpuWaitExclusion(),
    } as unknown as JSONObject);
    const attributes: Record<string, unknown> = query["attributes"] as Record<
      string,
      unknown
    >;

    expect(attributes["state"]).toBeInstanceOf(NotEqual);
    expect((attributes["state"] as NotEqual<string>).value).toBe("wait");
    expect(attributes["cpu.mode"]).toBeInstanceOf(NotEqual);
    expect((attributes["cpu.mode"] as NotEqual<string>).value).toBe("iowait");
  });

  test("drops the wait readings under both attribute spellings", () => {
    const where: string = cpuQueryWhere();

    expect(where).toContain("attributes['state'] != 'wait'");
    expect(where).toContain("attributes['cpu.mode'] != 'iowait'");
  });

  test("never requires a reading to carry either attribute", () => {
    /*
     * A reading carries `state`, `cpu.mode` or both, depending on the
     * collector's feature gates. A missing key reads as '' and passes `!=`;
     * any presence check, or an equality, would drop every reading that
     * only has the other spelling - and that collector's CPU column would
     * go blank.
     */
    const where: string = cpuQueryWhere();

    expect(where).not.toMatch(/mapContains\([^)]*'state'\)/);
    expect(where).not.toMatch(/mapContains\([^)]*'cpu\.mode'\)/);
    expect(where).not.toContain("attributes['state'] = ");
    expect(where).not.toContain("attributes['cpu.mode'] = ");
  });

  test("still scopes to the metric and the host", () => {
    const where: string = cpuQueryWhere();

    expect(where).toContain("'process.cpu.utilization'");
    expect(where).toContain("'web-01'");
  });
});
