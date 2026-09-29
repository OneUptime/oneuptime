import VMRunner from "Common/Server/Utils/VM/VMRunner";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import CustomCodeMonitorResponse from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";

interface CustomCodeMonitorClass {
  execute(options: {
    script: string;
  }): Promise<CustomCodeMonitorResponse | null>;
}

describe("CustomCodeMonitor script error propagation", () => {
  const originalOneUptimeUrl: string | undefined = process.env["ONEUPTIME_URL"];
  const originalProbeKey: string | undefined = process.env["PROBE_KEY"];
  let CustomCodeMonitor: CustomCodeMonitorClass;
  let runSpy: jest.SpyInstance;

  beforeAll(() => {
    process.env["ONEUPTIME_URL"] = "http://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
    runSpy = jest.spyOn(VMRunner, "runCodeInSandbox");
    CustomCodeMonitor = jest.requireActual<{
      default: CustomCodeMonitorClass;
    }>("../../../../Utils/Monitors/MonitorTypes/CustomCodeMonitor").default;
  });

  beforeEach(() => {
    runSpy.mockReset();
  });

  afterAll(() => {
    jest.restoreAllMocks();
    if (originalOneUptimeUrl === undefined) {
      delete process.env["ONEUPTIME_URL"];
    } else {
      process.env["ONEUPTIME_URL"] = originalOneUptimeUrl;
    }
    if (originalProbeKey === undefined) {
      delete process.env["PROBE_KEY"];
    } else {
      process.env["PROBE_KEY"] = originalProbeKey;
    }
  });

  test("populates scriptError when the sandbox resolves with a script throw", async () => {
    const sandboxResult: ReturnResult = {
      returnValue: undefined,
      logMessages: ["before failure"],
      capturedMetrics: [],
      scriptError: new Error("API returned 500"),
    };
    runSpy.mockResolvedValue(sandboxResult);

    const response: CustomCodeMonitorResponse | null =
      await CustomCodeMonitor.execute({
        script: "throw new Error('API returned 500');",
      });

    expect(response?.scriptError).toBe("API returned 500");
    expect(response?.result).toBeUndefined();
    expect(response?.logMessages).toEqual(["before failure"]);
  });

  test("populates scriptError when the sandbox resolves with a timeout", async () => {
    const sandboxResult: ReturnResult = {
      returnValue: undefined,
      logMessages: [],
      capturedMetrics: [],
      scriptError: new Error("Script execution timed out after 60000ms."),
    };
    runSpy.mockResolvedValue(sandboxResult);

    const response: CustomCodeMonitorResponse | null =
      await CustomCodeMonitor.execute({
        script: "while (true) {}",
      });

    expect(response?.scriptError).toContain("timed out");
  });

  test("leaves scriptError undefined and maps result on success", async () => {
    const sandboxResult: ReturnResult = {
      returnValue: { data: { status: "healthy" } },
      logMessages: ["checked"],
      capturedMetrics: [{ name: "latency", value: 12 }],
    };
    runSpy.mockResolvedValue(sandboxResult);

    const response: CustomCodeMonitorResponse | null =
      await CustomCodeMonitor.execute({
        script: "return { data: { status: 'healthy' } };",
      });

    expect(response?.scriptError).toBeUndefined();
    expect(response?.result).toEqual({ status: "healthy" });
    expect(response?.logMessages).toEqual(["checked"]);
    expect(response?.capturedMetrics).toEqual([{ name: "latency", value: 12 }]);
  });

  test("still populates scriptError when the sandbox rejects", async () => {
    runSpy.mockRejectedValue(new Error("isolate crashed"));

    const response: CustomCodeMonitorResponse | null =
      await CustomCodeMonitor.execute({
        script: "return true;",
      });

    expect(response?.scriptError).toBe("isolate crashed");
  });
});
