import SecurityLogSource from "../../../../Models/DatabaseModels/SecurityLogSource";
import SecurityTelemetrySource from "../../../../Models/DatabaseModels/SecurityTelemetrySource";
import SecurityLogSourceService from "../../../../Server/Services/SecurityLogSourceService";
import SecurityTelemetrySourceService from "../../../../Server/Services/SecurityTelemetrySourceService";
import SecurityEventsReadTelemetry, {
  SECURITY_EVENTS_READS_CACHE_TTL_MS,
  SECURITY_EVENTS_READS_FAILURE_TTL_MS,
} from "../../../../Server/Utils/SecurityEvent/SecurityEventsReadTelemetry";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityTelemetrySourceKind } from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * WHETHER SECURITY EVENTS READS A PROJECT'S LOGS, OR ITS TRACES (#10395).
 *
 * Ingest asks, once a batch, for a project whose scrub rules hash IP
 * addresses: only a batch Security Events reads keeps its addresses for
 * the address vault. Logs are read by "Your logs"; traces by the Traces
 * source, and by "Your logs" too, which follows each line written inside
 * a traced request into its trace. Each answer is kept a minute, as ingest
 * keeps the scrub rules it runs; a read that fails says "not read" for a
 * few seconds - the private way to be wrong.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10395000-0000-4000-8000-0000000000d1",
);

function source<T>(model: { new (): T }): T {
  return new model();
}

let logSource: ReturnType<typeof jest.spyOn>;
let tracesSource: ReturnType<typeof jest.spyOn>;

function sourcesOn(data: { logs: boolean; traces: boolean }): void {
  logSource = jest
    .spyOn(SecurityLogSourceService, "findOneBy")
    .mockResolvedValue((data.logs ? source(SecurityLogSource) : null) as never);
  tracesSource = jest
    .spyOn(SecurityTelemetrySourceService, "findOneBy")
    .mockResolvedValue(
      (data.traces ? source(SecurityTelemetrySource) : null) as never,
    );
}

beforeEach(() => {
  SecurityEventsReadTelemetry.clearCache();
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  SecurityEventsReadTelemetry.clearCache();
});

describe("logs", () => {
  test("are read when the project's Your logs source is on", async () => {
    sourcesOn({ logs: true, traces: false });

    expect(
      await SecurityEventsReadTelemetry.readsProjectTelemetry({
        projectId: PROJECT_ID,
        signal: "log",
      }),
    ).toBe(true);
    expect(logSource).toHaveBeenCalledWith({
      query: { projectId: PROJECT_ID, isEnabled: true },
      select: { _id: true },
      props: { isRoot: true },
    });
  });

  test("are not read with Your logs off, whatever the Traces source is", async () => {
    sourcesOn({ logs: false, traces: true });

    expect(
      await SecurityEventsReadTelemetry.readsProjectTelemetry({
        projectId: PROJECT_ID,
        signal: "log",
      }),
    ).toBe(false);
    expect(tracesSource).not.toHaveBeenCalled();
  });
});

describe("traces", () => {
  test("are read when the project's Traces source is on", async () => {
    sourcesOn({ logs: false, traces: true });

    expect(
      await SecurityEventsReadTelemetry.readsProjectTelemetry({
        projectId: PROJECT_ID,
        signal: "trace",
      }),
    ).toBe(true);
    expect(tracesSource).toHaveBeenCalledWith({
      query: {
        projectId: PROJECT_ID,
        kind: SecurityTelemetrySourceKind.Traces,
        isEnabled: true,
      },
      select: { _id: true },
      props: { isRoot: true },
    });
  });

  test("are read by Your logs too, which follows its lines into their traces", async () => {
    sourcesOn({ logs: true, traces: false });

    expect(
      await SecurityEventsReadTelemetry.readsProjectTelemetry({
        projectId: PROJECT_ID,
        signal: "trace",
      }),
    ).toBe(true);
  });

  test("are not read with both sources off", async () => {
    sourcesOn({ logs: false, traces: false });

    expect(
      await SecurityEventsReadTelemetry.readsProjectTelemetry({
        projectId: PROJECT_ID,
        signal: "trace",
      }),
    ).toBe(false);
  });
});

describe("the answer is kept, as ingest keeps its scrub rules", () => {
  test("for a minute: a busy project costs one read a minute, not one a batch", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    sourcesOn({ logs: true, traces: false });

    for (let batch: number = 0; batch < 20; batch++) {
      await SecurityEventsReadTelemetry.readsProjectTelemetry({
        projectId: PROJECT_ID,
        signal: "log",
      });
    }

    expect(logSource).toHaveBeenCalledTimes(1);
    expect(SECURITY_EVENTS_READS_CACHE_TTL_MS).toBe(60 * 1000);

    // A source turned off is followed within the minute.
    logSource.mockResolvedValue(null as never);
    jest.setSystemTime(Date.now() + SECURITY_EVENTS_READS_CACHE_TTL_MS + 1);

    expect(
      await SecurityEventsReadTelemetry.readsProjectTelemetry({
        projectId: PROJECT_ID,
        signal: "log",
      }),
    ).toBe(false);
    expect(logSource).toHaveBeenCalledTimes(2);
  });

  test("a project's logs and traces, and each project, are asked about apart", async () => {
    sourcesOn({ logs: true, traces: false });
    const other: ObjectID = new ObjectID(
      "10395000-0000-4000-8000-0000000000d2",
    );

    await SecurityEventsReadTelemetry.readsProjectTelemetry({
      projectId: PROJECT_ID,
      signal: "log",
    });
    await SecurityEventsReadTelemetry.readsProjectTelemetry({
      projectId: other,
      signal: "log",
    });
    await SecurityEventsReadTelemetry.readsProjectTelemetry({
      projectId: PROJECT_ID,
      signal: "trace",
    });

    expect(logSource).toHaveBeenCalledTimes(3);
    expect(tracesSource).toHaveBeenCalledTimes(1);
  });

  test("a read that fails says not read, never throws, and is asked again in a few seconds", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    logSource = jest
      .spyOn(SecurityLogSourceService, "findOneBy")
      .mockRejectedValue(new Error("Database not connected") as never);

    await expect(
      SecurityEventsReadTelemetry.readsProjectTelemetry({
        projectId: PROJECT_ID,
        signal: "log",
      }),
    ).resolves.toBe(false);
    await SecurityEventsReadTelemetry.readsProjectTelemetry({
      projectId: PROJECT_ID,
      signal: "log",
    });

    expect(logSource).toHaveBeenCalledTimes(1);
    expect(SECURITY_EVENTS_READS_FAILURE_TTL_MS).toBeLessThan(
      SECURITY_EVENTS_READS_CACHE_TTL_MS,
    );

    logSource.mockResolvedValue(source(SecurityLogSource) as never);
    jest.setSystemTime(Date.now() + SECURITY_EVENTS_READS_FAILURE_TTL_MS + 1);

    expect(
      await SecurityEventsReadTelemetry.readsProjectTelemetry({
        projectId: PROJECT_ID,
        signal: "log",
      }),
    ).toBe(true);
  });
});
