import VMRunner from "Common/Server/Utils/VM/VMRunner";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import CustomCodeMonitorResponse from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import TotpCodeIssuer from "Common/Utils/Monitor/MonitorSecretTotp";
import {
  TotpAlgorithm,
  TotpParameters,
  TotpSecrets,
} from "Common/Utils/Totp/TotpParameters";
import { generateTotpCode } from "Common/Utils/Totp/TotpSecret";

/*
 * A Custom JavaScript Code monitor whose script uses a one-time code
 * (issue #9703): its {{monitorSecrets.NAME}} is filled in with the code
 * just before the script runs, its oneuptime.getTotpCode is answered from
 * the same check's codes (VMRunnerTotpCodes holds the sandbox side to it),
 * and every code made is masked in the logs, metrics, data and error the
 * check reports. The sandbox is stubbed: it hands back what the test says
 * the script did with the code it was given.
 */

interface CustomCodeMonitorClass {
  execute(options: {
    script: string;
    totpSecrets?: TotpSecrets | undefined;
  }): Promise<CustomCodeMonitorResponse | null>;
}

interface SandboxCall {
  code: string;
  options: { totpCodes?: TotpCodeIssuer | undefined };
}

const LOGIN: TotpParameters = {
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  algorithm: TotpAlgorithm.SHA1,
  digits: 6,
  periodInSeconds: 30,
};

const FILLED_PREFIX: string = "const code = '";

// The code the script was given: what the filled-in script starts with.
function codeIn(script: string): string {
  return script.slice(FILLED_PREFIX.length, FILLED_PREFIX.length + 6);
}

describe("CustomCodeMonitor with a one-time code secret", () => {
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

  test("runs the script with the code filled in, and masks it in everything it reports", async () => {
    runSpy.mockImplementation(async (call: SandboxCall) => {
      const code: string = codeIn(call.code);
      const sandboxResult: ReturnResult = {
        returnValue: { data: { sent: code, count: Number(code) } },
        logMessages: [`Signing in with ${code}`],
        capturedMetrics: [
          { name: `otp.${code}`, value: 1, attributes: { code } },
        ],
        scriptError: new Error(`Login refused ${code}`),
      };
      return sandboxResult;
    });

    const startedAt: number = Date.now();
    const response: CustomCodeMonitorResponse | null =
      await CustomCodeMonitor.execute({
        script: `${FILLED_PREFIX}{{monitorSecrets.LoginCode}}';`,
        totpSecrets: { LoginCode: LOGIN },
      });

    const call: SandboxCall = runSpy.mock.calls[0]![0] as SandboxCall;
    const code: string = codeIn(call.code);

    expect(code).toMatch(/^\d{6}$/);
    expect([
      generateTotpCode(LOGIN, startedAt),
      generateTotpCode(LOGIN, Date.now()),
    ]).toContain(code);
    expect(call.code).toBe(`${FILLED_PREFIX}${code}';`);
    // The same check's codes answer the script's oneuptime.getTotpCode.
    expect(call.options.totpCodes).toBeInstanceOf(TotpCodeIssuer);

    expect(response!.logMessages).toEqual(["Signing in with ******"]);
    expect(response!.capturedMetrics).toEqual([
      { name: "otp.******", value: 1, attributes: { code: "******" } },
    ]);
    expect(response!.scriptError).toBe("Login refused ******");
    expect(JSON.stringify(response)).not.toContain(code);
  });

  test("masks a code the script asked for with oneuptime.getTotpCode", async () => {
    runSpy.mockImplementation(async (call: SandboxCall) => {
      const answer: { code?: string } =
        call.options.totpCodes!.tryGetCode("LoginCode");
      const sandboxResult: ReturnResult = {
        returnValue: { data: answer.code },
        logMessages: [`asked: ${answer.code}`],
        capturedMetrics: [],
      };
      return sandboxResult;
    });

    const response: CustomCodeMonitorResponse | null =
      await CustomCodeMonitor.execute({
        script: 'return { data: await oneuptime.getTotpCode("LoginCode") };',
        totpSecrets: { LoginCode: LOGIN },
      });

    expect(response!.result).toBe("******");
    expect(response!.logMessages).toEqual(["asked: ******"]);
  });

  test("runs a script with no one-time code exactly as written", async () => {
    runSpy.mockResolvedValue({
      returnValue: { data: 123456 },
      logMessages: ["plain 123456"],
      capturedMetrics: [],
    } as ReturnResult);

    const response: CustomCodeMonitorResponse | null =
      await CustomCodeMonitor.execute({
        script: "return { data: 123456 };",
      });

    expect((runSpy.mock.calls[0]![0] as SandboxCall).code).toBe(
      "return { data: 123456 };",
    );
    expect(response!.result).toBe(123456);
    expect(response!.logMessages).toEqual(["plain 123456"]);
  });
});
