import VMRunner from "../../../../Server/Utils/VM/VMRunner";
import ReturnResult from "../../../../Types/IsolatedVM/ReturnResult";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, jest, test } from "@jest/globals";
import axios from "axios";

jest.setTimeout(60000);

async function runInSandbox(data: {
  code: string;
  args?: JSONObject | undefined;
  timeout?: number | undefined;
}): Promise<ReturnResult> {
  return VMRunner.runCodeInSandbox({
    code: data.code,
    options: {
      args: data.args,
      timeout: data.timeout || 5000,
    },
  });
}

describe("VMRunner isolated-vm boundary", () => {
  test("does not expose the legacy Node vm runner", () => {
    const runnerApi: Record<string, unknown> = VMRunner as unknown as Record<
      string,
      unknown
    >;

    expect(runnerApi["runCodeInNodeVM"]).toBeUndefined();
  });

  test("does not expose Reference methods or temporary host globals", async () => {
    const result: ReturnResult = await runInSandbox({
      code: `
        const privateNames = [
          '_log',
          '_captureMetric',
          '_args',
          '_axiosRef',
          '_cryptoRef',
          '_sleepRef',
          '__oneuptimeHostLogCallback',
          '__oneuptimeHostMetricCallback',
          '__oneuptimeCopiedArgs',
          '__oneuptimeHostAxiosCallback',
          '__oneuptimeHostAxiosStartCallback',
          '__oneuptimeHostAxiosPollCallback',
          '__oneuptimeHostCryptoCallback',
          '__oneuptimeHostSleepCallback',
          '__oneuptimeHostSleepStartCallback',
          '__oneuptimeHostSleepPollCallback',
        ];
        const referenceMethods = [
          'applySync',
          'applySyncPromise',
          'copy',
          'copySync',
          'deref',
          'derefInto',
          'getSync',
          'release',
          'setSync',
        ];
        const publicValues = [
          console,
          console.log,
          oneuptime,
          oneuptime.captureMetric,
          args,
          axios,
          axios.get,
          crypto,
          crypto.randomUUID,
          setTimeout,
          sleep,
        ];

        return {
          privateNamesPresent: privateNames.filter(name => name in globalThis),
          valuesWithReferenceMethods: publicValues.map((value, index) => ({
            index,
            methods: referenceMethods.filter(method => {
              try { return typeof value[method] !== 'undefined'; }
              catch (_) { return true; }
            }),
          })).filter(entry => entry.methods.length > 0),
        };
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toEqual({
      privateNamesPresent: [],
      valuesWithReferenceMethods: [],
    });
  });

  test("keeps every public function constructor in the isolate realm", async () => {
    const result: ReturnResult = await runInSandbox({
      code: `
        const functions = [
          console.log,
          oneuptime.captureMetric,
          axios,
          axios.get,
          crypto.randomUUID,
          setTimeout,
          sleep,
          http.Agent,
          https.Agent,
        ];

        return {
          directFunction: Function('return typeof process')(),
          constructors: functions.map(fn =>
            fn.constructor.constructor('return typeof process')()
          ),
        };
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toEqual({
      directFunction: "undefined",
      constructors: Array(9).fill("undefined"),
    });
  });

  test("keeps promises returned by async shims in the isolate realm", async () => {
    const result: ReturnResult = await runInSandbox({
      code: `
        const sleepPromise = sleep(0);
        const axiosPromise = axios.get('http://127.0.0.1:8080/');
        const promiseRealms = [sleepPromise, axiosPromise].map(promise =>
          promise.constructor.constructor('return typeof process')()
        );

        await sleepPromise;
        try { await axiosPromise; } catch (_) {}
        return promiseRealms;
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toEqual(["undefined", "undefined"]);
  });

  test("deep-copies args into the isolate realm", async () => {
    const args: JSONObject = {
      nested: {
        value: "host value",
      },
      items: [1, 2, 3],
    };

    const result: ReturnResult = await runInSandbox({
      args,
      code: `
        args.nested.value = 'isolate value';
        args.items.push(4);

        return {
          nestedValue: args.nested.value,
          itemCount: args.items.length,
          objectPrototypeIsLocal: Object.getPrototypeOf(args) === Object.prototype,
          constructorRealm: args.constructor.constructor('return typeof process')(),
        };
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toEqual({
      nestedValue: "isolate value",
      itemCount: 4,
      objectPrototypeIsLocal: true,
      constructorRealm: "undefined",
    });
    expect(args).toEqual({
      nested: {
        value: "host value",
      },
      items: [1, 2, 3],
    });
  });

  test("retains logs and metrics when user code throws", async () => {
    const result: ReturnResult = await runInSandbox({
      code: `
        console.log('before throw', { safe: true });
        oneuptime.captureMetric('sandbox_metric', 42, { region: 'test' });
        const error = new Error('expected isolate failure');
        error.untrustedProperty = 'must not cross';
        throw error;
      `,
    });

    expect(result.returnValue).toBeUndefined();
    expect(result.logMessages).toEqual(['before throw {"safe":true}']);
    expect(result.capturedMetrics).toEqual([
      {
        name: "sandbox_metric",
        value: 42,
        attributes: { region: "test" },
      },
    ]);
    expect(result.scriptError).toBeInstanceOf(Error);
    expect(result.scriptError?.message).toBe("expected isolate failure");
    expect(
      (result.scriptError as Error & { untrustedProperty?: string })
        .untrustedProperty,
    ).toBeUndefined();
    expect(result.scriptError?.stack).not.toContain("untrustedProperty");
  });

  test("retains logs and metrics when user code times out", async () => {
    const result: ReturnResult = await runInSandbox({
      timeout: 50,
      code: `
        console.log('before timeout');
        oneuptime.captureMetric('timeout_metric', 7);
        while (true) {}
      `,
    });

    expect(result.returnValue).toBeUndefined();
    expect(result.logMessages).toEqual(["before timeout"]);
    expect(result.capturedMetrics).toEqual([
      {
        name: "timeout_metric",
        value: 7,
      },
    ]);
    expect(result.scriptError?.message).toMatch(/timed out/i);
  });

  test("bounds log count and aggregate UTF-8 bytes", async () => {
    const countResult: ReturnResult = await runInSandbox({
      code: `
        for (let index = 0; index < 1100; index++) {
          console.log('entry-' + index);
        }
        return 'done';
      `,
    });

    expect(countResult.scriptError).toBeUndefined();
    expect(countResult.returnValue).toBe("done");
    expect(countResult.logMessages).toHaveLength(1000);

    const byteResult: ReturnResult = await runInSandbox({
      code: `
        const message = '\u00e9'.repeat(70000);
        for (let index = 0; index < 10; index++) {
          console.log(message);
        }
        return 'done';
      `,
    });
    const totalBytes: number = byteResult.logMessages.reduce(
      (bytes: number, message: string): number => {
        return bytes + Buffer.byteLength(message, "utf8");
      },
      0,
    );

    expect(byteResult.scriptError).toBeUndefined();
    expect(totalBytes).toBeLessThanOrEqual(1_000_000);
    expect(byteResult.logMessages).toHaveLength(7);
  });

  test("preserves timer behavior and clears pending host timers", async () => {
    jest.spyOn(global, "clearTimeout");

    try {
      const result: ReturnResult = await runInSandbox({
        timeout: 250,
        code: `
          let cancelledTimerFired = false;
          const cancelledTimer = setTimeout(() => {
            cancelledTimerFired = true;
          }, 5);
          clearTimeout(cancelledTimer);

          const startedAt = Date.now();
          await new Promise(resolve => setTimeout(resolve, 10));
          const elapsed = Date.now() - startedAt;

          setTimeout(() => console.log('late timer'), 60000);
          await sleep(5);

          return {
            cancelledTimerFired,
            elapsed,
          };
        `,
      });

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue.cancelledTimerFired).toBe(false);
      expect(result.returnValue.elapsed).toBeGreaterThanOrEqual(5);
      expect(result.logMessages).not.toContain("late timer");
      expect(
        jest.mocked(global.clearTimeout).mock.calls.length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      jest.restoreAllMocks();
    }
  });

  test("copies a fulfilled axios response back into the isolate", async () => {
    jest.spyOn(axios, "get").mockResolvedValue({
      status: 200,
      headers: { "x-test": "copied" },
      data: { ok: true },
    } as never);

    try {
      const result: ReturnResult = await runInSandbox({
        code: `
          const response = await axios.get('https://8.8.8.8/health');
          return {
            status: response.status,
            header: response.headers['x-test'],
            data: response.data,
            promiseRealm: axios.get('https://8.8.8.8/second')
              .constructor.constructor('return typeof process')(),
          };
        `,
      });

      expect(result.scriptError).toBeUndefined();
      expect(result.returnValue).toEqual({
        status: 200,
        header: "copied",
        data: { ok: true },
        promiseRealm: "undefined",
      });
      expect(axios.get).toHaveBeenCalledWith(
        "https://8.8.8.8/health",
        expect.objectContaining({
          maxRedirects: 0,
          signal: expect.any(AbortSignal),
        }),
      );
    } finally {
      jest.restoreAllMocks();
    }
  });

  test("keeps the documented crypto and Agent shims compatible", async () => {
    const result: ReturnResult = await runInSandbox({
      code: `
        const httpAgent = new http.Agent({ keepAlive: true });
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });

        return {
          hash: crypto.createHash('sha256').update('oneuptime').digest('hex'),
          uuidLooksValid: /^[0-9a-f-]{36}$/.test(crypto.randomUUID()),
          randomIntInRange: (() => {
            const value = crypto.randomInt(2, 5);
            return value >= 2 && value < 5;
          })(),
          httpAgent,
          httpsAgent,
        };
      `,
    });

    expect(result.scriptError).toBeUndefined();
    expect(result.returnValue).toEqual({
      hash: "35a18a92a1ae8387b173763364c1497950fa0bfe2589e545c0bf1f4d0f01f94e",
      uuidLooksValid: true,
      randomIntInRange: true,
      httpAgent: {
        __agentType: "__http_agent__",
        options: { keepAlive: true },
      },
      httpsAgent: {
        __agentType: "__https_agent__",
        options: { rejectUnauthorized: false },
      },
    });
  });
});
