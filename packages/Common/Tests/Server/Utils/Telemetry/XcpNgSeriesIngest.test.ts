import XcpNgSeriesIngest from "../../../../Server/Utils/Telemetry/XcpNgSeriesIngest";
import XcpNgResourceService from "../../../../Server/Services/XcpNgResourceService";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import { XcpNgDerivedSeries } from "../../../../Types/XcpNg/XcpNgTelemetry";
import { XcpNgNormalizeResult } from "../../../../Server/Utils/Telemetry/XcpNgSeriesNormalizer";
import {
  PRODUCTION_POOL_ID,
  SCRAPE_2_NOW_SECONDS,
  getAttributeOf,
  getDatapoints,
  getResourceOfPool,
  parseOpenMetrics,
  readRecordedScrape,
  toAgentResourceMetrics,
} from "./XcpNgScrapeFixture";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * XcpNgSeriesIngest: what the normalizer needs from outside a batch (which
 * stopped VMs ran in the last day), looked up for the stopped VMs only, and
 * never in the way of a batch.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const POOL: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const VM_WEB01: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";

function scrape2Envelope(): JSONObject {
  return getResourceOfPool(
    toAgentResourceMetrics(parseOpenMetrics(readRecordedScrape(2)), {
      scrapeSeconds: SCRAPE_2_NOW_SECONDS,
    }),
    PRODUCTION_POOL_ID,
  );
}

function stoppedAfterRunning(envelope: JSONObject, uuid: string): unknown {
  return getDatapoints(envelope).find(
    (entry: { metricName: string; datapoint: JSONObject }) => {
      return (
        entry.metricName === XcpNgDerivedSeries.VmStoppedAfterRunning &&
        getAttributeOf(entry.datapoint, "uuid") === uuid
      );
    },
  )?.datapoint["asDouble"];
}

beforeEach(() => {
  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("XcpNgSeriesIngest.normalizeEnvelope", () => {
  test("looks up the stopped VMs only, and a VM that ran in the last day reads stopped after running", async () => {
    const lookup: jest.SpiedFunction<
      typeof XcpNgResourceService.findVmsThatRanRecently
    > = jest
      .spyOn(XcpNgResourceService, "findVmsThatRanRecently")
      .mockResolvedValue(new Set([VM_WEB01]));
    const envelope: JSONObject = scrape2Envelope();

    const result: XcpNgNormalizeResult | null =
      await XcpNgSeriesIngest.normalizeEnvelope({
        projectId: PROJECT,
        xcpNgPoolId: POOL,
        poolIdentifier: PRODUCTION_POOL_ID,
        envelope,
      });

    expect(result?.derivedDatapoints).toBeGreaterThan(0);
    expect(lookup).toHaveBeenCalledTimes(1);
    const asked: { vmExternalIds: Array<string> } = lookup.mock.calls[0]![0];
    // web-01 halted and win-03 suspended; db-01 and app-02 run.
    expect([...asked.vmExternalIds].sort()).toEqual(
      [VM_WEB01, "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a"].sort(),
    );
    expect(stoppedAfterRunning(envelope, VM_WEB01)).toBe(1);
  });

  test("a block with every VM running asks nothing", async () => {
    const lookup: jest.SpiedFunction<
      typeof XcpNgResourceService.findVmsThatRanRecently
    > = jest.spyOn(XcpNgResourceService, "findVmsThatRanRecently");
    await XcpNgSeriesIngest.normalizeEnvelope({
      projectId: PROJECT,
      xcpNgPoolId: POOL,
      poolIdentifier: PRODUCTION_POOL_ID,
      envelope: { scopeMetrics: [] },
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  test("a failed lookup still normalizes the block, with no VM stopped after running", async () => {
    jest
      .spyOn(XcpNgResourceService, "findVmsThatRanRecently")
      .mockRejectedValue(new Error("database is down"));
    const envelope: JSONObject = scrape2Envelope();
    const result: XcpNgNormalizeResult | null =
      await XcpNgSeriesIngest.normalizeEnvelope({
        projectId: PROJECT,
        xcpNgPoolId: POOL,
        poolIdentifier: PRODUCTION_POOL_ID,
        envelope,
      });
    expect(result).not.toBe(null);
    expect(stoppedAfterRunning(envelope, VM_WEB01)).toBe(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("a block that cannot be normalized goes through as it came", async () => {
    const envelope: JSONObject = { scopeMetrics: "not a list" as never };
    expect(
      await XcpNgSeriesIngest.normalizeEnvelope({
        projectId: PROJECT,
        xcpNgPoolId: POOL,
        poolIdentifier: PRODUCTION_POOL_ID,
        envelope,
      }),
    ).toEqual({ convertedRateSums: 0, derivedDatapoints: 0 });

    const throwing: JSONObject = {};
    Object.defineProperty(throwing, "scopeMetrics", {
      get(): never {
        throw new Error("unreadable");
      },
    });
    expect(
      await XcpNgSeriesIngest.normalizeEnvelope({
        projectId: PROJECT,
        xcpNgPoolId: POOL,
        poolIdentifier: PRODUCTION_POOL_ID,
        envelope: throwing,
      }),
    ).toBe(null);
  });
});
