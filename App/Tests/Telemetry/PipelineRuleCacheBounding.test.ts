/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it. Nothing here touches password hashing; stub the
 * module before the service import graph drags it into compilation.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

/*
 * These tests exercise the rule loaders' 60s per-project caches, so the
 * one Postgres touchpoint — DatabaseService.findBy — is stubbed and
 * counted. The base-class no-ops mirror MetricPipelineRegexCompile.test.ts:
 * `hardDeleteItemsOlderThanInDays` runs from ~100 service constructors
 * `if (IsBillingEnabled)`, which CI turns ON (Common/test-setup.sh writes
 * BILLING_ENABLED=true), so a bare `class {}` passes locally and dies in CI.
 */
jest.mock("Common/Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class DatabaseServiceStub {
      public hardDeleteItemsOlderThanInDays(): void {
        // no-op: retention config, nothing for a pure unit test to do.
      }

      public setDoNotAllowDelete(): void {
        // no-op: delete-permission config, same.
      }

      public findBy(...args: Array<unknown>): Promise<Array<unknown>> {
        return mockFindBy(...args);
      }
    },
  };
});

import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LogDropFilterService, {
  LoadedLogDropFilter,
} from "../../FeatureSet/Telemetry/Services/LogDropFilterService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import LogScrubRuleService from "../../FeatureSet/Telemetry/Services/LogScrubRuleService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import MetricPipelineRuleService, {
  MetricRulesForProject,
} from "../../FeatureSet/Telemetry/Services/MetricPipelineRuleService";
import LogPipeline from "Common/Models/DatabaseModels/LogPipeline";
import ObjectID from "Common/Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Contract under test — every telemetry rule loader (log/trace pipelines,
 * drop filters, scrub rules, metric rules) caches its per-project rows for
 * 60s in a bounded InMemoryTTLCache. These tests pin the cache semantics
 * the ingest hot path relies on:
 *
 * - a cache hit returns the SAME array/object reference without touching
 *   the database again (by-reference storage is what lets the trace/log
 *   category processors lazily memoize compiled filters onto cached
 *   config objects);
 * - an EMPTY result is cached too — a project with zero rules must not
 *   re-query Postgres for every record batch (empty arrays are truthy;
 *   a `if (cached)` guard regression to falsy-checking contents would
 *   break this);
 * - the entry expires after 60s and the next load re-queries;
 * - MetricPipelineRuleService.clearCache() still empties the rule cache.
 *
 * Capacity eviction (the 10k bound) lives entirely in the shared
 * InMemoryTTLCache and is covered by its own unit test in
 * Common/Tests/Server/Infrastructure/InMemoryTTLCache.test.ts.
 */

/*
 * Referenced from the jest.mock factory above — the `mock` prefix is what
 * lets babel-plugin-jest-hoist allow the out-of-scope capture.
 */
const mockFindBy: (...args: Array<unknown>) => Promise<Array<unknown>> =
  jest.fn((): Promise<Array<unknown>> => {
    return Promise.resolve([]);
  });

/*
 * Minimal structural views of jest mocks/spies — the @jest/globals and
 * @types/jest typings disagree in this repo, so annotate with just the
 * surface these tests use.
 */
type MockLike = {
  mock: { calls: Array<Array<unknown>> };
  mockClear: () => void;
  mockReturnValueOnce: (value: Promise<Array<unknown>>) => unknown;
};

type NowSpyLike = {
  mockReturnValue: (value: number) => unknown;
  mockRestore: () => void;
};

const findByMock: MockLike = mockFindBy as unknown as MockLike;

function findByCallCount(): number {
  return findByMock.mock.calls.length;
}

afterEach(() => {
  jest.restoreAllMocks();
  MetricPipelineRuleService.clearCache();
  findByMock.mockClear();
});

describe("per-project rule caches serve repeat loads without re-querying", () => {
  test("LogPipelineService.loadPipelines caches a non-empty result by reference", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const pipeline: LogPipeline = new LogPipeline();
    pipeline.id = ObjectID.generate();
    /*
     * First findBy returns one pipeline; the follow-up processor query
     * (and everything after) falls through to the default empty result.
     */
    findByMock.mockReturnValueOnce(Promise.resolve([pipeline]));

    const first: Array<LoadedPipeline> =
      await LogPipelineService.loadPipelines(projectId);
    expect(first).toHaveLength(1);

    const callsAfterFirstLoad: number = findByCallCount();
    expect(callsAfterFirstLoad).toBeGreaterThan(0);

    const second: Array<LoadedPipeline> =
      await LogPipelineService.loadPipelines(projectId);

    expect(findByCallCount()).toBe(callsAfterFirstLoad);
    expect(second).toBe(first);
  });

  test("an empty result is negatively cached (zero-rule project does not re-query)", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const first: Array<LoadedPipeline> =
      await LogPipelineService.loadPipelines(projectId);
    expect(first).toEqual([]);
    expect(findByCallCount()).toBe(1);

    const second: Array<LoadedPipeline> =
      await LogPipelineService.loadPipelines(projectId);

    expect(findByCallCount()).toBe(1);
    expect(second).toBe(first);
  });

  test("TracePipelineService.loadPipelines caches per project", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const first: unknown = await TracePipelineService.loadPipelines(projectId);
    expect(findByCallCount()).toBe(1);

    const second: unknown = await TracePipelineService.loadPipelines(projectId);
    expect(findByCallCount()).toBe(1);
    expect(second).toBe(first);
  });

  test("LogDropFilterService.loadDropFilters caches per project", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const first: Array<LoadedLogDropFilter> =
      await LogDropFilterService.loadDropFilters(projectId);
    expect(findByCallCount()).toBe(1);

    const second: Array<LoadedLogDropFilter> =
      await LogDropFilterService.loadDropFilters(projectId);
    expect(findByCallCount()).toBe(1);
    expect(second).toBe(first);
  });

  test("TraceDropFilterService.loadDropFilters caches per project", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const first: unknown =
      await TraceDropFilterService.loadDropFilters(projectId);
    expect(findByCallCount()).toBe(1);

    const second: unknown =
      await TraceDropFilterService.loadDropFilters(projectId);
    expect(findByCallCount()).toBe(1);
    expect(second).toBe(first);
  });

  test("LogScrubRuleService.loadScrubRules caches per project", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const first: unknown = await LogScrubRuleService.loadScrubRules(projectId);
    expect(findByCallCount()).toBe(1);

    const second: unknown = await LogScrubRuleService.loadScrubRules(projectId);
    expect(findByCallCount()).toBe(1);
    expect(second).toBe(first);
  });

  test("TraceScrubRuleService.loadScrubRules caches per project", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const first: unknown =
      await TraceScrubRuleService.loadScrubRules(projectId);
    expect(findByCallCount()).toBe(1);

    const second: unknown =
      await TraceScrubRuleService.loadScrubRules(projectId);
    expect(findByCallCount()).toBe(1);
    expect(second).toBe(first);
  });

  test("MetricPipelineRuleService.loadRules caches per project", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const first: MetricRulesForProject =
      await MetricPipelineRuleService.loadRules(projectId);
    expect(findByCallCount()).toBe(1);

    const second: MetricRulesForProject =
      await MetricPipelineRuleService.loadRules(projectId);
    expect(findByCallCount()).toBe(1);
    expect(second).toBe(first);
  });

  test("distinct projects do not share cache entries", async () => {
    const projectA: ObjectID = ObjectID.generate();
    const projectB: ObjectID = ObjectID.generate();

    await LogPipelineService.loadPipelines(projectA);
    await LogPipelineService.loadPipelines(projectB);

    expect(findByCallCount()).toBe(2);
  });
});

describe("cache entries expire after the 60s TTL", () => {
  test("LogPipelineService re-queries once the TTL has elapsed", async () => {
    // Generate before mocking Date.now so ID creation sees the real clock.
    const projectId: ObjectID = ObjectID.generate();

    const t0: number = 1_700_000_000_000;
    const nowSpy: NowSpyLike = jest.spyOn(Date, "now") as unknown as NowSpyLike;
    nowSpy.mockReturnValue(t0);

    await LogPipelineService.loadPipelines(projectId);
    expect(findByCallCount()).toBe(1);

    // Within the TTL: still served from cache.
    nowSpy.mockReturnValue(t0 + 59_999);
    await LogPipelineService.loadPipelines(projectId);
    expect(findByCallCount()).toBe(1);

    // Past the TTL: reloaded from the database.
    nowSpy.mockReturnValue(t0 + 60_001);
    await LogPipelineService.loadPipelines(projectId);
    expect(findByCallCount()).toBe(2);
  });

  test("MetricPipelineRuleService re-queries once the TTL has elapsed", async () => {
    const projectId: ObjectID = ObjectID.generate();

    const t0: number = 1_700_000_000_000;
    const nowSpy: NowSpyLike = jest.spyOn(Date, "now") as unknown as NowSpyLike;
    nowSpy.mockReturnValue(t0);

    await MetricPipelineRuleService.loadRules(projectId);
    expect(findByCallCount()).toBe(1);

    nowSpy.mockReturnValue(t0 + 60_001);
    await MetricPipelineRuleService.loadRules(projectId);
    expect(findByCallCount()).toBe(2);
  });
});

describe("clearCache contract", () => {
  test("MetricPipelineRuleService.clearCache() empties the rule cache", async () => {
    const projectId: ObjectID = ObjectID.generate();

    await MetricPipelineRuleService.loadRules(projectId);
    expect(findByCallCount()).toBe(1);

    MetricPipelineRuleService.clearCache();

    await MetricPipelineRuleService.loadRules(projectId);
    expect(findByCallCount()).toBe(2);
  });
});
