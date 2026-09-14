import OnlineCheck, {
  ONLINE_CHECK_MAX_SHARING_AGE_IN_MS,
} from "../../Utils/OnlineCheck";
import WebsiteMonitor from "../../Utils/Monitors/MonitorTypes/WebsiteMonitor";
import PingMonitor from "../../Utils/Monitors/MonitorTypes/PingMonitor";
import PortMonitor from "../../Utils/Monitors/MonitorTypes/PortMonitor";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

const mockEnvironment: { billingEnabled: boolean } = { billingEnabled: true };

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    get IsBillingEnabled(): boolean {
      return mockEnvironment.billingEnabled;
    },
  };
});

jest.mock("../../Utils/Monitors/MonitorTypes/WebsiteMonitor", () => {
  return { __esModule: true, default: { ping: jest.fn() } };
});

jest.mock("../../Utils/Monitors/MonitorTypes/PingMonitor", () => {
  return { __esModule: true, default: { ping: jest.fn() } };
});

jest.mock("../../Utils/Monitors/MonitorTypes/PortMonitor", () => {
  return { __esModule: true, default: { ping: jest.fn() } };
});

interface ReferenceResponse {
  isOnline: boolean;
}

type ReferenceResult = ReferenceResponse | null;
type ReferenceMock = jest.Mock<Promise<ReferenceResult>, Array<unknown>>;

interface ProtocolCase {
  name: string;
  run: () => Promise<boolean>;
  probe: ReferenceMock;
  targets: Array<string>;
}

const DOMAINS: Array<string> = [
  "google.com",
  "facebook.com",
  "microsoft.com",
  "youtube.com",
  "apple.com",
];

const protocolCases: Array<ProtocolCase> = [
  {
    name: "website",
    run: () => {
      return OnlineCheck.canProbeMonitorWebsiteMonitors();
    },
    probe: WebsiteMonitor.ping as unknown as ReferenceMock,
    targets: DOMAINS.map((domain: string) => {
      return `https://${domain}/`;
    }),
  },
  {
    name: "ping",
    run: () => {
      return OnlineCheck.canProbeMonitorPingMonitors();
    },
    probe: PingMonitor.ping as unknown as ReferenceMock,
    targets: DOMAINS,
  },
  {
    name: "port",
    run: () => {
      return OnlineCheck.canProbeMonitorPortMonitors();
    },
    probe: PortMonitor.ping as unknown as ReferenceMock,
    targets: DOMAINS,
  },
];

interface DeferredReference {
  promise: Promise<ReferenceResult>;
  resolve: (value: ReferenceResult) => void;
  reject: (error: Error) => void;
}

const deferredReferences: Array<DeferredReference> = [];

function deferReference(): DeferredReference {
  let resolve!: (value: ReferenceResult) => void;
  let reject!: (error: Error) => void;
  const promise: Promise<ReferenceResult> = new Promise(
    (
      resolvePromise: (value: ReferenceResult) => void,
      rejectPromise: (error: Error) => void,
    ) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  const deferred: DeferredReference = { promise, resolve, reject };
  deferredReferences.push(deferred);
  return deferred;
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

function getCalledTargets(probe: ReferenceMock): Array<string> {
  return probe.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
}

beforeEach(() => {
  mockEnvironment.billingEnabled = true;
  for (const protocol of protocolCases) {
    protocol.probe.mockReset();
    protocol.probe.mockResolvedValue({ isOnline: true });
  }
});

afterEach(async () => {
  /*
   * Release reference probes even if an intermediate assertion fails, so a
   * pending shared operation cannot cascade into later test timeouts.
   */
  for (const reference of deferredReferences) {
    reference.resolve({ isOnline: false });
  }
  deferredReferences.length = 0;
  await nextTurn();
  jest.restoreAllMocks();
});

for (const protocol of protocolCases) {
  describe(`OnlineCheck ${protocol.name}`, () => {
    it("bypasses public reference probes on self-hosted installations", async () => {
      mockEnvironment.billingEnabled = false;

      const results: Array<boolean> = await Promise.all(
        Array.from({ length: 1000 }, protocol.run),
      );

      expect(
        results.every((result: boolean) => {
          return result;
        }),
      ).toBe(true);
      expect(protocol.probe).not.toHaveBeenCalled();
    });

    it("stops after the first reachable reference and preserves its options", async () => {
      expect(await protocol.run()).toBe(true);
      expect(getCalledTargets(protocol.probe)).toEqual([protocol.targets[0]]);
      const call: Array<unknown> = protocol.probe.mock.calls[0]!;
      expect(call[call.length - 1]).toEqual({ isOnlineCheckRequest: true });
      if (protocol.name === "port") {
        expect(String(call[1])).toBe("80");
      }
    });

    it("tries references sequentially and stops on fallback success", async () => {
      const fallback: DeferredReference = deferReference();
      protocol.probe
        .mockResolvedValueOnce({ isOnline: false })
        .mockImplementationOnce(() => {
          return fallback.promise;
        });

      const result: Promise<boolean> = protocol.run();
      await nextTurn();

      expect(getCalledTargets(protocol.probe)).toEqual(
        protocol.targets.slice(0, 2),
      );
      fallback.resolve({ isOnline: true });
      expect(await result).toBe(true);
      expect(protocol.probe).toHaveBeenCalledTimes(2);
    });

    it("returns false only after all five references are offline", async () => {
      protocol.probe.mockResolvedValue({ isOnline: false });
      expect(await protocol.run()).toBe(false);
      expect(getCalledTargets(protocol.probe)).toEqual(protocol.targets);
    });

    it("continues through empty reference responses", async () => {
      protocol.probe
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ isOnline: false })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ isOnline: true });

      expect(await protocol.run()).toBe(true);
      expect(getCalledTargets(protocol.probe)).toEqual(
        protocol.targets.slice(0, 4),
      );
    });

    it.each([true, false, null])(
      "shares one reference sequence across 10000 callers with response %s",
      async (online: boolean | null) => {
        const reference: DeferredReference = deferReference();
        protocol.probe.mockImplementation(() => {
          return reference.promise;
        });

        const checks: Array<Promise<boolean>> = Array.from(
          { length: 10000 },
          protocol.run,
        );
        await Promise.resolve();
        expect(protocol.probe).toHaveBeenCalledTimes(1);
        expect(new Set(checks).size).toBe(1);

        reference.resolve(online === null ? null : { isOnline: online });
        const results: Array<boolean> = await Promise.all(checks);

        expect(results).toEqual(Array<boolean>(10000).fill(online === true));
        expect(protocol.probe).toHaveBeenCalledTimes(online ? 1 : 5);
      },
    );

    it("lets callers arriving during a fallback join the same sequence", async () => {
      const fallback: DeferredReference = deferReference();
      protocol.probe
        .mockResolvedValueOnce({ isOnline: false })
        .mockImplementationOnce(() => {
          return fallback.promise;
        });

      const first: Promise<boolean> = protocol.run();
      await nextTurn();
      const late: Promise<boolean> = protocol.run();

      expect(late).toBe(first);
      expect(protocol.probe).toHaveBeenCalledTimes(2);
      fallback.resolve({ isOnline: true });
      expect(await Promise.all([first, late])).toEqual([true, true]);
      expect(protocol.probe).toHaveBeenCalledTimes(2);
    });

    it.each([true, false])(
      "rechecks immediately after a completed %s result",
      async (online: boolean) => {
        protocol.probe.mockResolvedValue({ isOnline: online });
        expect(await protocol.run()).toBe(online);
        const completedCallCount: number = protocol.probe.mock.calls.length;
        protocol.probe.mockResolvedValue({ isOnline: !online });

        expect(await protocol.run()).toBe(!online);
        expect(protocol.probe.mock.calls.length).toBe(
          completedCallCount + (online ? 5 : 1),
        );
      },
    );

    it("releases the shared operation after an asynchronous rejection", async () => {
      const reference: DeferredReference = deferReference();
      const error: Error = new Error("Reference probe failed");
      protocol.probe.mockImplementationOnce(() => {
        return reference.promise;
      });
      const results: Promise<Array<PromiseSettledResult<boolean>>> =
        Promise.allSettled(Array.from({ length: 1000 }, protocol.run));
      await Promise.resolve();
      reference.reject(error);

      expect(await results).toEqual(
        Array<PromiseSettledResult<boolean>>(1000).fill({
          status: "rejected",
          reason: error,
        }),
      );
      expect(protocol.probe).toHaveBeenCalledTimes(1);
      expect(await protocol.run()).toBe(true);
      expect(protocol.probe).toHaveBeenCalledTimes(2);
    });

    it("releases the shared operation after a synchronous probe exception", async () => {
      const error: Error = new Error("Cannot start reference probe");
      protocol.probe.mockImplementationOnce(() => {
        throw error;
      });

      const results: Array<PromiseSettledResult<boolean>> =
        await Promise.allSettled([protocol.run(), protocol.run()]);
      expect(results).toEqual([
        { status: "rejected", reason: error },
        { status: "rejected", reason: error },
      ]);
      expect(protocol.probe).toHaveBeenCalledTimes(1);
      expect(await protocol.run()).toBe(true);
      expect(protocol.probe).toHaveBeenCalledTimes(2);
    });

    it("releases a rejected fallback and starts again at the first reference", async () => {
      const error: Error = new Error("Fallback failed");
      protocol.probe
        .mockResolvedValueOnce({ isOnline: false })
        .mockRejectedValueOnce(error);

      await expect(protocol.run()).rejects.toBe(error);
      expect(await protocol.run()).toBe(true);
      expect(getCalledTargets(protocol.probe)).toEqual([
        ...protocol.targets.slice(0, 2),
        protocol.targets[0],
      ]);
    });

    it.each(["resolve", "reject"])(
      "replaces expired work without letting a late %s clear its replacement",
      async (settlement: string) => {
        let currentTimeInMs: number = 0;
        jest.spyOn(Date, "now").mockImplementation(() => {
          return currentTimeInMs;
        });
        const originalReference: DeferredReference = deferReference();
        const replacementReference: DeferredReference = deferReference();
        protocol.probe
          .mockResolvedValue({ isOnline: false })
          .mockImplementationOnce(() => {
            return originalReference.promise;
          })
          .mockImplementationOnce(() => {
            return replacementReference.promise;
          });

        const original: Promise<boolean> = protocol.run();
        const originalResult: Promise<Array<PromiseSettledResult<boolean>>> =
          Promise.allSettled([original]);
        await nextTurn();
        currentTimeInMs = ONLINE_CHECK_MAX_SHARING_AGE_IN_MS - 1;
        expect(protocol.run()).toBe(original);
        expect(protocol.probe).toHaveBeenCalledTimes(1);

        currentTimeInMs = ONLINE_CHECK_MAX_SHARING_AGE_IN_MS;
        const replacement: Promise<boolean> = protocol.run();
        expect(replacement).not.toBe(original);
        await nextTurn();
        expect(protocol.probe).toHaveBeenCalledTimes(2);

        const error: Error = new Error("Old reference failed late");
        if (settlement === "resolve") {
          originalReference.resolve({ isOnline: true });
        } else {
          originalReference.reject(error);
        }
        expect(await originalResult).toEqual([
          settlement === "resolve"
            ? { status: "fulfilled", value: true }
            : { status: "rejected", reason: error },
        ]);
        expect(protocol.run()).toBe(replacement);
        expect(protocol.probe).toHaveBeenCalledTimes(2);

        replacementReference.resolve({ isOnline: false });
        expect(await replacement).toBe(false);
        protocol.probe.mockResolvedValue({ isOnline: true });
        expect(await protocol.run()).toBe(true);
      },
    );

    it("starts fresh after the wall clock moves backward", async () => {
      let currentTimeInMs: number = 1000;
      jest.spyOn(Date, "now").mockImplementation(() => {
        return currentTimeInMs;
      });
      const reference: DeferredReference = deferReference();
      protocol.probe.mockImplementationOnce(() => {
        return reference.promise;
      });
      const original: Promise<boolean> = protocol.run();
      await nextTurn();

      currentTimeInMs = 999;
      expect(await protocol.run()).toBe(true);
      expect(protocol.probe).toHaveBeenCalledTimes(2);
      reference.resolve({ isOnline: true });
      expect(await original).toBe(true);
    });

    it("handles repeated outage and recovery bursts without retaining verdicts", async () => {
      for (let cycle: number = 0; cycle < 20; cycle++) {
        const online: boolean = cycle % 2 === 0;
        const previousCallCount: number = protocol.probe.mock.calls.length;
        protocol.probe.mockResolvedValue({ isOnline: online });

        const results: Array<boolean> = await Promise.all(
          Array.from({ length: 500 }, protocol.run),
        );

        expect(results).toEqual(Array<boolean>(500).fill(online));
        expect(protocol.probe.mock.calls.length - previousCallCount).toBe(
          online ? 1 : 5,
        );
      }
    });
  });
}

describe("OnlineCheck protocol isolation", () => {
  it("allows HTTP and TCP checks to complete while ICMP remains pending", async () => {
    const reference: DeferredReference = deferReference();
    const ping: ProtocolCase = protocolCases[1]!;
    ping.probe.mockImplementation(() => {
      return reference.promise;
    });
    const pingCheck: Promise<boolean> = ping.run();

    expect(
      await Promise.all([
        OnlineCheck.canProbeMonitorWebsiteMonitors(),
        OnlineCheck.canProbeMonitorPortMonitors(),
      ]),
    ).toEqual([true, true]);
    expect(ping.run()).toBe(pingCheck);
    expect(ping.probe).toHaveBeenCalledTimes(1);
    reference.resolve({ isOnline: false });
    expect(await pingCheck).toBe(false);
  });

  it("keeps concurrent protocol verdicts independent across a large burst", async () => {
    protocolCases[0]!.probe.mockResolvedValue({ isOnline: true });
    protocolCases[1]!.probe.mockResolvedValue({ isOnline: false });
    protocolCases[2]!.probe.mockResolvedValue(null);

    const results: Array<Array<boolean>> = await Promise.all(
      protocolCases.map((protocol: ProtocolCase) => {
        return Promise.all(Array.from({ length: 1000 }, protocol.run));
      }),
    );

    expect(results[0]).toEqual(Array<boolean>(1000).fill(true));
    expect(results[1]).toEqual(Array<boolean>(1000).fill(false));
    expect(results[2]).toEqual(Array<boolean>(1000).fill(false));
    expect(protocolCases[0]!.probe).toHaveBeenCalledTimes(1);
    expect(protocolCases[1]!.probe).toHaveBeenCalledTimes(5);
    expect(protocolCases[2]!.probe).toHaveBeenCalledTimes(5);
  });

  it("isolates a protocol rejection from the other protocols", async () => {
    const error: Error = new Error("HTTP reference check failed");
    protocolCases[0]!.probe.mockRejectedValueOnce(error);

    expect(
      await Promise.allSettled(
        protocolCases.map((protocol: ProtocolCase) => {
          return protocol.run();
        }),
      ),
    ).toEqual([
      { status: "rejected", reason: error },
      { status: "fulfilled", value: true },
      { status: "fulfilled", value: true },
    ]);
    expect(await OnlineCheck.canProbeMonitorWebsiteMonitors()).toBe(true);
  });
});
