import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import VMUtil from "../../../../Server/Utils/VM/VMAPI";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import {
  CheckOn,
  CriteriaFilter,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ReturnResult from "../../../../Types/IsolatedVM/ReturnResult";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

type EvaluatorPrivate = {
  isMonitorInstanceCriteriaFilterMet: (input: {
    dataToProcess: unknown;
    monitorStep: MonitorStep;
    monitor: Monitor;
    probeApiIngestResponse: unknown;
    criteriaInstance: unknown;
    criteriaFilter: CriteriaFilter;
  }) => Promise<string | null>;
};

const Evaluator: EvaluatorPrivate =
  MonitorCriteriaEvaluator as unknown as EvaluatorPrivate;

function makeInput(): Parameters<
  EvaluatorPrivate["isMonitorInstanceCriteriaFilterMet"]
>[0] {
  const monitor: Monitor = new Monitor();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = MonitorType.Ping;

  return {
    dataToProcess: { isOnline: true },
    monitorStep: new MonitorStep(),
    monitor,
    probeApiIngestResponse: {},
    criteriaInstance: {},
    criteriaFilter: {
      checkOn: CheckOn.JavaScriptExpression,
      value: "1 === 1",
    } as CriteriaFilter,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("MonitorCriteriaEvaluator JavaScript expression criteria", () => {
  test("treats a sandbox scriptError as criteria not met", async () => {
    const sandboxResult: ReturnResult = {
      returnValue: undefined,
      logMessages: [],
      capturedMetrics: [],
      scriptError: new Error("expression exploded"),
    };
    jest.spyOn(VMUtil, "runCodeInSandbox").mockResolvedValue(sandboxResult);

    const result: string | null =
      await Evaluator.isMonitorInstanceCriteriaFilterMet(makeInput());

    expect(result).toBeNull();
  });

  test("reports the criteria as met when the expression evaluates truthy", async () => {
    const sandboxResult: ReturnResult = {
      returnValue: true,
      logMessages: [],
      capturedMetrics: [],
    };
    jest.spyOn(VMUtil, "runCodeInSandbox").mockResolvedValue(sandboxResult);

    const result: string | null =
      await Evaluator.isMonitorInstanceCriteriaFilterMet(makeInput());

    expect(result).toContain("evaluated to true");
  });

  test("treats a sandbox rejection as criteria not met", async () => {
    jest
      .spyOn(VMUtil, "runCodeInSandbox")
      .mockRejectedValue(new Error("isolate crashed"));

    const result: string | null =
      await Evaluator.isMonitorInstanceCriteriaFilterMet(makeInput());

    expect(result).toBeNull();
  });
});
