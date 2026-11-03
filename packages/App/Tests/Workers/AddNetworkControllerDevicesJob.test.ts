import { escapeRegExp } from "Common/Utils/RegExpEscape";
import fs from "fs";
import path from "path";
/*
 * `jest` deliberately NOT imported from @jest/globals (the
 * PollSecurityEventConnectionsJob pattern): the `jest.Mock` annotations
 * must resolve to the same global namespace as jest.fn()/jest.mock().
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Add devices on a Meraki connection runs as a job of the worker: the
 * add-devices route records the ask on the connection and queues the job,
 * whose only data is the connection's id - never its key, never the person
 * or what they asked, which the job reads from the connection itself, where
 * only OneUptime writes it. The REAL JobDictionary runs here; the runner
 * under it is replaced so what the job hands it is visible.
 */

const mockRun: jest.Mock = jest.fn();

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
    default: { addJob: jest.fn() },
  };
});

jest.mock(
  "Common/Server/Utils/NetworkController/NetworkControllerDeviceAddRunner",
  () => {
    return {
      __esModule: true,
      NETWORK_CONTROLLER_DEVICE_ADD_JOB:
        "NetworkControllerConnection:AddDevices",
      NETWORK_CONTROLLER_DEVICE_ADD_JOB_TIMEOUT_MS: 60 * 60 * 1000,
      default: { run: mockRun },
    };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
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

import ObjectID from "Common/Types/ObjectID";
import { QueueJob } from "Common/Server/Infrastructure/Queue";
import JobDictionary from "../../FeatureSet/Workers/Utils/JobDictionary";
import { runNetworkControllerDeviceAdd } from "../../FeatureSet/Workers/Jobs/Network/AddNetworkControllerDevices";

const ADD_JOB: string = "NetworkControllerConnection:AddDevices";
const CONNECTION: string = "33333333-3333-4333-8333-333333333333";

const WORKERS_DIR: string = path.resolve(__dirname, "../../FeatureSet/Workers");

function job(data: Record<string, unknown>): QueueJob {
  return { data } as unknown as QueueJob;
}

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockResolvedValue({ status: "done" } as never);
});

describe("Add devices - wired into the worker", () => {
  test("Workers/Index.ts imports the job module as a top-level side effect", () => {
    const indexSource: string = fs.readFileSync(
      path.join(WORKERS_DIR, "Index.ts"),
      "utf-8",
    );

    expect(indexSource).toMatch(
      new RegExp(
        `^\\s*import\\s+["']${escapeRegExp("./Jobs/Network/AddNetworkControllerDevices")}["']\\s*;?\\s*$`,
        "m",
      ),
    );
  });

  test("the job is registered with its own timeout: a few thousand devices take minutes", () => {
    expect(JobDictionary.has(ADD_JOB)).toBe(true);
    expect(JobDictionary.getTimeoutInMs(ADD_JOB)).toBe(60 * 60 * 1000);
  });
});

describe("Add devices - one ask", () => {
  test("answers the ask of the connection the job names", async () => {
    await JobDictionary.getJobFunction(ADD_JOB)(
      job({ connectionId: CONNECTION }),
    );

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0]![0]).toEqual(new ObjectID(CONNECTION));
    // Nothing else is handed over: the ask is the connection's.
    expect(mockRun.mock.calls[0]).toHaveLength(1);
  });

  test.each([
    [{}],
    [{ connectionId: "" }],
    [{ connectionId: "../etc" }],
    [{ connectionId: 42 }],
    [{ userId: "33333333-3333-4333-8333-333333333333" }],
  ])(
    "a job without a valid connection id (%j) is refused",
    async (data: Record<string, unknown>) => {
      await expect(runNetworkControllerDeviceAdd(job(data))).rejects.toThrow(
        "A valid network controller connection ID is required.",
      );
      expect(mockRun).not.toHaveBeenCalled();
    },
  );

  test("an ask the runner cannot answer at all fails the job", async () => {
    mockRun.mockRejectedValue(new Error("database is down") as never);

    await expect(
      runNetworkControllerDeviceAdd(job({ connectionId: CONNECTION })),
    ).rejects.toThrow("database is down");
  });
});
