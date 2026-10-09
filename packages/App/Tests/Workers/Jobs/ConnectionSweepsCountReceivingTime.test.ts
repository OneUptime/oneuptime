import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #2825: a probe or an AI agent is marked Disconnected after three
 * minutes of silence - measured in time OneUptime was receiving. While
 * OneUptime itself was down, upgrading, or behind on its ingest queue, nothing
 * could check in, so that time does not count. (The probe job also keeps its
 * own grace after a gap in its ticks; this covers OneUptime's ingress being
 * down while the workers kept ticking.)
 *
 * Both jobs register through RunCron at import; the handler is captured and
 * one tick is driven with the datastores replaced.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

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

jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/AIAgentService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), updateOneById: jest.fn() },
  };
});

jest.mock("../../../FeatureSet/Workers/Utils/ProbeConnectionDowntimeGrace", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => {
      return {
        canMarkProbesDisconnected: (): Promise<boolean> => {
          return Promise.resolve(true);
        },
      };
    }),
  };
});

jest.mock("Common/Server/Utils/Telemetry/ReceivingCoverage", () => {
  return {
    __esModule: true,
    default: { getSilenceCutoff: jest.fn() },
  };
});

import ProbeService from "Common/Server/Services/ProbeService";
import AIAgentService from "Common/Server/Services/AIAgentService";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import "../../../FeatureSet/Workers/Jobs/Probe/UpdateConnectionStatus";
import "../../../FeatureSet/Workers/Jobs/AIAgent/UpdateConnectionStatus";

const SENTINEL_CUTOFF: Date = new Date("2026-10-09T11:21:00.000Z");

const getSilenceCutoff: jest.Mock =
  ReceivingCoverage.getSilenceCutoff as unknown as jest.Mock;

// The value a QueryHelper predicate (a TypeORM Raw operator) was built with.
function predicateValue(operator: unknown): unknown {
  const parameters: Record<string, unknown> =
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};
  return Object.values(parameters)[0];
}

function lastAliveValues(findBy: jest.Mock): Array<unknown> {
  return findBy.mock.calls.map((call: Array<unknown>) => {
    return predicateValue(
      (call[0] as { query: { lastAlive: unknown } }).query.lastAlive,
    );
  });
}

beforeEach(() => {
  getSilenceCutoff.mockReset().mockResolvedValue(SENTINEL_CUTOFF);
  (ProbeService.findBy as unknown as jest.Mock)
    .mockReset()
    .mockResolvedValue([]);
  (AIAgentService.findBy as unknown as jest.Mock)
    .mockReset()
    .mockResolvedValue([]);
});

describe("Connection sweeps measure silence in receiving time", () => {
  test("probes: both the Disconnected and the Connected query use the receiving-time cutoff", async () => {
    await mockCapturedJobs["Probe:UpdateConnectionStatus"]!();

    expect(getSilenceCutoff).toHaveBeenCalledWith({ silenceInMinutes: 3 });
    const values: Array<unknown> = lastAliveValues(
      ProbeService.findBy as unknown as jest.Mock,
    );
    expect(values).toHaveLength(2);
    for (const value of values) {
      expect(value).toEqual(SENTINEL_CUTOFF);
    }
  });

  test("AI agents: both the Disconnected and the Connected query use the receiving-time cutoff", async () => {
    await mockCapturedJobs["AIAgent:UpdateConnectionStatus"]!();

    expect(getSilenceCutoff).toHaveBeenCalledWith({ silenceInMinutes: 3 });
    const values: Array<unknown> = lastAliveValues(
      AIAgentService.findBy as unknown as jest.Mock,
    );
    expect(values).toHaveLength(2);
    for (const value of values) {
      expect(value).toEqual(SENTINEL_CUTOFF);
    }
  });
});
