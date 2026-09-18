import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Continuous profiling (Pyroscope).
 *
 * Optional, best-effort, and off by default -- which is why every interesting
 * path here is one nobody would notice breaking.
 *
 * The module deliberately does NOT import @pyroscope/nodejs at the top level:
 * that package pulls in @datadog/pprof, whose native binding loads at
 * require() time and throws outright when no prebuilt binary exists for the
 * running Node ABI. A top-level import would take the whole server down at
 * boot over a feature that is disabled on most installs, so the require is
 * lazy and wrapped. Both halves of that are asserted here.
 *
 * The other half worth pinning is address derivation. Nothing configures a
 * Pyroscope endpoint directly: it is derived from the OTLP endpoint by
 * stripping /otlp and appending /pyroscope, and the SDK then appends /ingest,
 * which is what nginx routes. Get that wrong and profiles are posted into a
 * 404 forever, silently. The auth token is likewise dug out of the OTLP
 * headers string rather than configured on its own.
 */

const pyroscopeInit: jest.Mock = jest.fn();
const pyroscopeStart: jest.Mock = jest.fn();
const pyroscopeStop: jest.Mock = jest.fn();

jest.mock("@pyroscope/nodejs", () => {
  return {
    __esModule: true,
    init: (...args: Array<unknown>) => {
      return pyroscopeInit(...args);
    },
    start: (...args: Array<unknown>) => {
      return pyroscopeStart(...args);
    },
    stop: (...args: Array<unknown>) => {
      return pyroscopeStop(...args);
    },
  };
});

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...jest.requireActual("../../../Server/EnvironmentConfig"),
    EnableProfiling: true,
  };
});

const registerHandlerMock: jest.Mock = jest.fn();

jest.mock("../../../Server/Utils/GracefulShutdown", () => {
  const actual: { ShutdownPriority: unknown } = jest.requireActual(
    "../../../Server/Utils/GracefulShutdown",
  );

  return {
    __esModule: true,
    ShutdownPriority: actual.ShutdownPriority,
    default: {
      registerHandler: (...args: Array<unknown>) => {
        return registerHandlerMock(...args);
      },
    },
  };
});

const loggerWarnMock: jest.Mock = jest.fn();
const loggerErrorMock: jest.Mock = jest.fn();
const loggerInfoMock: jest.Mock = jest.fn();

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: (...args: Array<unknown>) => {
        return loggerInfoMock(...args);
      },
      warn: (...args: Array<unknown>) => {
        return loggerWarnMock(...args);
      },
      error: (...args: Array<unknown>) => {
        return loggerErrorMock(...args);
      },
    },
  };
});

import Profiling from "../../../Server/Utils/Profiling";
import * as EnvironmentConfig from "../../../Server/EnvironmentConfig";
import { ShutdownPriority } from "../../../Server/Utils/GracefulShutdown";

const OTLP_ENDPOINT: string = "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT";
const OTLP_HEADERS: string = "OPENTELEMETRY_EXPORTER_OTLP_HEADERS";

interface MutableEnvironment {
  EnableProfiling: boolean;
}

interface MutableProfiling {
  pyroscope: unknown;
}

const environment: MutableEnvironment =
  EnvironmentConfig as unknown as MutableEnvironment;

const internals: MutableProfiling = Profiling as unknown as MutableProfiling;

interface PyroscopeConfig {
  appName: string;
  serverAddress: string;
  authToken?: string | undefined;
}

const initConfig: () => PyroscopeConfig = (): PyroscopeConfig => {
  return pyroscopeInit.mock.calls[0]![0] as PyroscopeConfig;
};

describe("Profiling", () => {
  beforeEach(() => {
    pyroscopeInit.mockReset();
    pyroscopeStart.mockReset();
    pyroscopeStop.mockReset();
    registerHandlerMock.mockReset();
    loggerWarnMock.mockReset();
    loggerErrorMock.mockReset();
    loggerInfoMock.mockReset();

    environment.EnableProfiling = true;
    internals.pyroscope = null;

    delete process.env[OTLP_ENDPOINT];
    delete process.env[OTLP_HEADERS];
  });

  describe("when profiling is disabled", () => {
    test("does not even look at the profiler", () => {
      // The default for self-hosted; the native binding must never be loaded.
      environment.EnableProfiling = false;
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/otlp";

      Profiling.init({ serviceName: "app" });

      expect(pyroscopeInit).not.toHaveBeenCalled();
      expect(pyroscopeStart).not.toHaveBeenCalled();
      expect(registerHandlerMock).not.toHaveBeenCalled();
      expect(loggerWarnMock).not.toHaveBeenCalled();
    });
  });

  describe("when enabled but no OTLP endpoint is configured", () => {
    test("warns and carries on without profiling", () => {
      Profiling.init({ serviceName: "app" });

      expect(pyroscopeInit).not.toHaveBeenCalled();
      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
      expect(String(loggerWarnMock.mock.calls[0]![0])).toContain(
        "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
      );
    });

    test("names the service in the warning, so it is clear which one is unprofiled", () => {
      Profiling.init({ serviceName: "worker" });

      expect(loggerWarnMock.mock.calls[0]![1]).toEqual({
        serviceName: "worker",
      });
    });
  });

  describe("server address derivation", () => {
    test("replaces the OTLP endpoint's /otlp suffix with /pyroscope", () => {
      /*
       * The SDK appends /ingest, so the request nginx actually routes is
       * /pyroscope/ingest.
       */
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/otlp";

      Profiling.init({ serviceName: "app" });

      expect(initConfig().serverAddress).toBe(
        "https://collector.example.com/pyroscope",
      );
    });

    test("tolerates a trailing slash on the endpoint", () => {
      /*
       * Regression: the suffix check used to run before the trailing slash was
       * trimmed, so ".../otlp/" kept its /otlp and became /otlp/pyroscope --
       * a path nginx does not route. An endpoint written with a trailing
       * slash is ordinary (the OTLP spec's own examples end that way), and
       * the symptom was profiles posting into a 404 forever, silently.
       */
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/otlp/";

      Profiling.init({ serviceName: "app" });

      expect(initConfig().serverAddress).toBe(
        "https://collector.example.com/pyroscope",
      );
    });

    test("tolerates a trailing slash on an endpoint with no /otlp suffix", () => {
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/";

      Profiling.init({ serviceName: "app" });

      // A doubled slash would not match the nginx location either.
      expect(initConfig().serverAddress).toBe(
        "https://collector.example.com/pyroscope",
      );
    });

    test("appends to an endpoint that has no /otlp suffix", () => {
      process.env[OTLP_ENDPOINT] = "https://collector.example.com";

      Profiling.init({ serviceName: "app" });

      expect(initConfig().serverAddress).toBe(
        "https://collector.example.com/pyroscope",
      );
    });

    test("does not mistake a path merely containing otlp for the suffix", () => {
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/otlp-proxy";

      Profiling.init({ serviceName: "app" });

      expect(initConfig().serverAddress).toBe(
        "https://collector.example.com/otlp-proxy/pyroscope",
      );
    });
  });

  describe("auth token extraction", () => {
    test("pulls the OneUptime token out of the OTLP headers string", () => {
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/otlp";
      process.env[OTLP_HEADERS] = "x-oneuptime-token=secret-token";

      Profiling.init({ serviceName: "app" });

      expect(initConfig().authToken).toBe("secret-token");
    });

    test("finds the token among other headers", () => {
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/otlp";
      process.env[OTLP_HEADERS] =
        "x-other=value;x-oneuptime-token=secret-token;x-more=value";

      Profiling.init({ serviceName: "app" });

      expect(initConfig().authToken).toBe("secret-token");
    });

    test("is undefined when the headers carry no OneUptime token", () => {
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/otlp";
      process.env[OTLP_HEADERS] = "x-other=value";

      Profiling.init({ serviceName: "app" });

      expect(initConfig().authToken).toBeUndefined();
    });

    test("is undefined when the token key is present but empty", () => {
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/otlp";
      process.env[OTLP_HEADERS] = "x-oneuptime-token=";

      Profiling.init({ serviceName: "app" });

      expect(initConfig().authToken).toBeUndefined();
    });

    test("is undefined when no headers are configured at all", () => {
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/otlp";

      Profiling.init({ serviceName: "app" });

      expect(initConfig().authToken).toBeUndefined();
    });
  });

  describe("a successful start", () => {
    beforeEach(() => {
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/otlp";
    });

    test("initialises with the service name and starts the profiler", () => {
      Profiling.init({ serviceName: "worker" });

      expect(initConfig().appName).toBe("worker");
      expect(pyroscopeStart).toHaveBeenCalledTimes(1);
      expect(loggerErrorMock).not.toHaveBeenCalled();
    });

    test("registers a shutdown handler in the telemetry tier", () => {
      /*
       * The profiler is stopped last, alongside the OTEL flush -- stopping it
       * earlier would blind the very teardown most worth profiling.
       */
      Profiling.init({ serviceName: "app" });

      expect(registerHandlerMock).toHaveBeenCalledTimes(1);
      expect(registerHandlerMock.mock.calls[0]![0]).toBe("Profiling");
      expect(registerHandlerMock.mock.calls[0]![1]).toBe(
        ShutdownPriority.Telemetry,
      );
    });

    test("the registered handler stops the profiler", async () => {
      Profiling.init({ serviceName: "app" });

      const handler: () => Promise<void> = registerHandlerMock.mock
        .calls[0]![2] as () => Promise<void>;

      await handler();

      expect(pyroscopeStop).toHaveBeenCalledTimes(1);
    });

    test("a profiler that throws on stop does not fail the shutdown", async () => {
      pyroscopeStop.mockRejectedValue(new Error("profiler already stopped"));

      Profiling.init({ serviceName: "app" });

      const handler: () => Promise<void> = registerHandlerMock.mock
        .calls[0]![2] as () => Promise<void>;

      await expect(handler()).resolves.toBeUndefined();
      expect(loggerErrorMock).toHaveBeenCalled();
    });
  });

  describe("when the profiler itself fails", () => {
    beforeEach(() => {
      process.env[OTLP_ENDPOINT] = "https://collector.example.com/otlp";
    });

    test("an init that throws degrades to no profiling rather than killing the boot", () => {
      pyroscopeInit.mockImplementation(() => {
        throw new Error("pprof binding unavailable for this Node ABI");
      });

      expect(() => {
        return Profiling.init({ serviceName: "app" });
      }).not.toThrow();

      expect(loggerErrorMock).toHaveBeenCalled();
      // No handler registered: there is nothing to stop.
      expect(registerHandlerMock).not.toHaveBeenCalled();
    });

    test("a start that throws is contained the same way", () => {
      pyroscopeStart.mockImplementation(() => {
        throw new Error("could not start the wall profiler");
      });

      expect(() => {
        return Profiling.init({ serviceName: "app" });
      }).not.toThrow();

      expect(registerHandlerMock).not.toHaveBeenCalled();
    });
  });
});
