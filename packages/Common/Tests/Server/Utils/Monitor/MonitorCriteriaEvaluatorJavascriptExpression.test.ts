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

  test("runs the expression with the response written in, and says it as written", async () => {
    const sandboxResult: ReturnResult = {
      returnValue: true,
      logMessages: [],
      capturedMetrics: [],
    };
    const sandbox: jest.SpiedFunction<typeof VMUtil.runCodeInSandbox> = jest
      .spyOn(VMUtil, "runCodeInSandbox")
      .mockResolvedValue(sandboxResult);

    const input: Parameters<
      EvaluatorPrivate["isMonitorInstanceCriteriaFilterMet"]
    >[0] = makeInput();
    input.monitor.monitorType = MonitorType.API;
    input.dataToProcess = {
      responseBody: JSON.stringify({
        status: "down",
        owner: "ops@example.com",
        token: "tok_live_123",
      }),
      responseHeaders: { "set-cookie": "session=abc" },
      responseCode: 503,
      isOnline: true,
    };
    input.criteriaFilter = {
      checkOn: CheckOn.JavaScriptExpression,
      value:
        "'{{responseBody.status}}' === 'down' && '{{responseHeaders.set-cookie}}' !== ''",
    } as CriteriaFilter;

    const result: string | null =
      await Evaluator.isMonitorInstanceCriteriaFilterMet(input);

    // The sandbox ran the expression with the values written in.
    expect(sandbox.mock.calls[0]![0].code).toBe(
      "return Boolean('down' === 'down' && 'session=abc' !== '');",
    );

    /*
     * The root cause - shown in email and chat - says the expression as it
     * was written, and what its references held, the cookie masked.
     */
    expect(result).toBe(
      "JavaScript Expression - '{{responseBody.status}}' === 'down' && '{{responseHeaders.set-cookie}}' !== '' - evaluated to true. Values: responseBody.status = \"down\", responseHeaders.set-cookie = [REDACTED].",
    );
    expect(result).not.toContain("session=abc");
  });

  test("a whole body named in the expression never reaches the root cause", async () => {
    jest.spyOn(VMUtil, "runCodeInSandbox").mockResolvedValue({
      returnValue: true,
      logMessages: [],
      capturedMetrics: [],
    });

    const input: Parameters<
      EvaluatorPrivate["isMonitorInstanceCriteriaFilterMet"]
    >[0] = makeInput();
    input.monitor.monitorType = MonitorType.API;
    input.dataToProcess = {
      responseBody: JSON.stringify({
        items: Array.from({ length: 300 }, (_value: unknown, index: number) => {
          return { id: index, owner: `user${index}@example.com` };
        }),
      }),
      isOnline: true,
    };
    input.criteriaFilter = {
      checkOn: CheckOn.JavaScriptExpression,
      value: "{{responseBody}}.items.length > 0",
    } as CriteriaFilter;

    const result: string = (await Evaluator.isMonitorInstanceCriteriaFilterMet(
      input,
    ))!;

    expect(result.length).toBeLessThan(400);
    expect(result).not.toContain("@example.com");
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
