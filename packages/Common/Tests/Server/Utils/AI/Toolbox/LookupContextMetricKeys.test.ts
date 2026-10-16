import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import TelemetryAttributeService from "../../../../../Server/Services/TelemetryAttributeService";
import { LookupContextTool } from "../../../../../Server/Utils/AI/Toolbox/ContextTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import TelemetryReadAccess from "../../../../../Server/Utils/Telemetry/TelemetryReadAccess";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import TelemetryType from "../../../../../Types/Telemetry/TelemetryType";

/*
 * lookup_context: ONE METRIC'S ATTRIBUTE KEYS (issue #4784).
 *
 * query_metrics can filter and group a metric by attribute; to know which
 * keys a metric has (state and cpu for system.cpu.utilization), the model
 * asks lookup_context for the attribute keys of that one metric.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CTX: ToolContext = {
  projectId: PROJECT_ID,
  props: { isRoot: true, tenantId: PROJECT_ID },
};

let fetchAttributes: SpyInstance<
  typeof TelemetryAttributeService.fetchAttributes
>;

beforeEach(() => {
  fetchAttributes = jest
    .spyOn(TelemetryAttributeService, "fetchAttributes")
    .mockResolvedValue(["cpu", "state", "resource.host.name"]);
  jest.spyOn(TelemetryReadAccess, "getServiceFilter").mockResolvedValue({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("lookup_context attributeKeys", () => {
  test("with a metricName, lists that metric's keys", async () => {
    const result: ToolExecutionResult = await LookupContextTool.execute(
      {
        type: "attributeKeys",
        telemetryType: "Metric",
        metricName: "system.cpu.utilization",
      },
      CTX,
    );

    expect(fetchAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        telemetryType: TelemetryType.Metric,
        metricName: "system.cpu.utilization",
      }),
    );
    expect(result.dataForLlm).toContain("state");
    expect(result.citationLabel).toBe(
      "system.cpu.utilization Metric attribute keys (3 found)",
    );
  });

  test("a metricName on another signal is ignored: logs have no metric names", async () => {
    await LookupContextTool.execute(
      {
        type: "attributeKeys",
        telemetryType: "Log",
        metricName: "system.cpu.utilization",
      },
      CTX,
    );

    expect(
      (fetchAttributes.mock.calls[0]![0] as unknown as JSONObject)[
        "metricName"
      ],
    ).toBeUndefined();
  });

  test("without a metricName, every metric's keys, as before", async () => {
    const result: ToolExecutionResult = await LookupContextTool.execute(
      { type: "attributeKeys", telemetryType: "Metric" },
      CTX,
    );

    expect(
      (fetchAttributes.mock.calls[0]![0] as unknown as JSONObject)[
        "metricName"
      ],
    ).toBeUndefined();
    expect(result.citationLabel).toBe("Metric attribute keys (3 found)");
  });

  test("the schema and the description offer it", () => {
    expect(
      Object.keys(LookupContextTool.inputSchema["properties"] as JSONObject),
    ).toContain("metricName");
    expect(LookupContextTool.description).toContain(
      "to know what query_metrics can filter or group it by",
    );
  });
});
