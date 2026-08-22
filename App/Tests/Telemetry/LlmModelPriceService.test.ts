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
 * loadModelPrices' only Postgres touchpoint is DatabaseService.findBy;
 * stub and count it. The base-class no-ops mirror the other telemetry
 * rule-loader suites: `hardDeleteItemsOlderThanInDays` /
 * `setDoNotAllowDelete` run from the service constructor under
 * IsBillingEnabled (CI sets BILLING_ENABLED=true), so a bare `class {}`
 * would pass locally and die in CI.
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

import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import LlmModelPriceModel from "Common/Models/DatabaseModels/LlmModelPrice";
import ObjectID from "Common/Types/ObjectID";
import { LlmModelPrice } from "Common/Types/Telemetry/LlmCostCatalog";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Referenced from the jest.mock factory above — the `mock` prefix is what
 * lets babel-plugin-jest-hoist allow the out-of-scope capture.
 */
const mockFindBy: (...args: Array<unknown>) => Promise<Array<unknown>> =
  jest.fn((): Promise<Array<unknown>> => {
    return Promise.resolve([]);
  });

/*
 * Minimal structural view of the jest mock — the @jest/globals and
 * @types/jest typings disagree in this repo, so annotate with just the
 * surface these tests use.
 */
type MockLike = {
  mock: { calls: Array<Array<unknown>> };
  mockClear: () => void;
  mockReturnValueOnce: (value: Promise<Array<unknown>>) => unknown;
};

const findByMock: MockLike = mockFindBy as unknown as MockLike;

function findByCallCount(): number {
  return findByMock.mock.calls.length;
}

function priceRow(
  modelPrefix: string | undefined,
  inputPrice: number | undefined,
  outputPrice: number | undefined,
): LlmModelPriceModel {
  const row: LlmModelPriceModel = new LlmModelPriceModel();
  row.modelPrefix = modelPrefix;
  row.inputPricePerMillionTokensInUSD = inputPrice;
  row.outputPricePerMillionTokensInUSD = outputPrice;
  return row;
}

afterEach(() => {
  jest.restoreAllMocks();
  findByMock.mockClear();
});

describe("LlmModelPriceService.loadModelPrices maps enabled rows to catalog entries", () => {
  test("normalizes modelPrefix (trim + lowercase) and copies both prices", async () => {
    const projectId: ObjectID = ObjectID.generate();

    findByMock.mockReturnValueOnce(
      Promise.resolve([priceRow("  GPT-5-Mini  ", 0.25, 2)]),
    );

    const entries: Array<LlmModelPrice> =
      await LlmModelPriceService.loadModelPrices(projectId);

    expect(entries).toEqual([
      {
        modelPrefix: "gpt-5-mini",
        inputPricePerMillionTokensInUSD: 0.25,
        outputPricePerMillionTokensInUSD: 2,
      },
    ]);
  });

  test("a zero price is a valid override, not a skip", async () => {
    const projectId: ObjectID = ObjectID.generate();

    // A self-hosted / free model legitimately costs 0 on both axes.
    findByMock.mockReturnValueOnce(
      Promise.resolve([priceRow("local-llama", 0, 0)]),
    );

    const entries: Array<LlmModelPrice> =
      await LlmModelPriceService.loadModelPrices(projectId);

    expect(entries).toEqual([
      {
        modelPrefix: "local-llama",
        inputPricePerMillionTokensInUSD: 0,
        outputPricePerMillionTokensInUSD: 0,
      },
    ]);
  });

  test("preserves the DB sort order across multiple rows", async () => {
    const projectId: ObjectID = ObjectID.generate();

    findByMock.mockReturnValueOnce(
      Promise.resolve([
        priceRow("claude-opus", 15, 75),
        priceRow("gpt-5", 1.25, 10),
      ]),
    );

    const entries: Array<LlmModelPrice> =
      await LlmModelPriceService.loadModelPrices(projectId);

    expect(
      entries.map((e: LlmModelPrice) => {
        return e.modelPrefix;
      }),
    ).toEqual(["claude-opus", "gpt-5"]);
  });
});

describe("LlmModelPriceService.loadModelPrices refuses to trust unpriceable rows", () => {
  test.each([
    ["an empty prefix", priceRow("", 1, 1)],
    ["a whitespace-only prefix", priceRow("   ", 1, 1)],
    ["a negative input price", priceRow("m", -1, 1)],
    ["a negative output price", priceRow("m", 1, -1)],
    ["a non-finite input price", priceRow("m", Infinity, 1)],
    ["a NaN output price", priceRow("m", 1, NaN)],
    ["a missing input price", priceRow("m", undefined as unknown as number, 1)],
    [
      "a missing output price",
      priceRow("m", 1, undefined as unknown as number),
    ],
  ])("skips a row with %s", async (_label: string, row: LlmModelPriceModel) => {
    const projectId: ObjectID = ObjectID.generate();

    findByMock.mockReturnValueOnce(Promise.resolve([row]));

    const entries: Array<LlmModelPrice> =
      await LlmModelPriceService.loadModelPrices(projectId);

    expect(entries).toEqual([]);
  });

  test("keeps the good rows and drops only the poisoned one", async () => {
    const projectId: ObjectID = ObjectID.generate();

    findByMock.mockReturnValueOnce(
      Promise.resolve([
        priceRow("good-a", 1, 2),
        priceRow("", 3, 4), // dropped: empty prefix
        priceRow("good-b", 5, 6),
      ]),
    );

    const entries: Array<LlmModelPrice> =
      await LlmModelPriceService.loadModelPrices(projectId);

    expect(
      entries.map((e: LlmModelPrice) => {
        return e.modelPrefix;
      }),
    ).toEqual(["good-a", "good-b"]);
  });
});

describe("LlmModelPriceService.loadModelPrices caches per project for the ingest hot path", () => {
  test("a repeat load for the same project does not re-query Postgres", async () => {
    const projectId: ObjectID = ObjectID.generate();

    findByMock.mockReturnValueOnce(
      Promise.resolve([priceRow("gpt-5", 1.25, 10)]),
    );

    const first: Array<LlmModelPrice> =
      await LlmModelPriceService.loadModelPrices(projectId);
    const callsAfterFirst: number = findByCallCount();

    const second: Array<LlmModelPrice> =
      await LlmModelPriceService.loadModelPrices(projectId);

    expect(findByCallCount()).toBe(callsAfterFirst);
    // By-reference caching is what lets the ingest path reuse the array.
    expect(second).toBe(first);
  });

  test("a zero-override project is negatively cached, not re-queried each batch", async () => {
    const projectId: ObjectID = ObjectID.generate();

    // Default mock resolves []: this project has no custom prices.
    const first: Array<LlmModelPrice> =
      await LlmModelPriceService.loadModelPrices(projectId);
    const callsAfterFirst: number = findByCallCount();

    const second: Array<LlmModelPrice> =
      await LlmModelPriceService.loadModelPrices(projectId);

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(findByCallCount()).toBe(callsAfterFirst);
  });

  test("distinct projects are cached independently", async () => {
    const projectA: ObjectID = ObjectID.generate();
    const projectB: ObjectID = ObjectID.generate();

    findByMock.mockReturnValueOnce(
      Promise.resolve([priceRow("model-a", 1, 1)]),
    );
    const a: Array<LlmModelPrice> =
      await LlmModelPriceService.loadModelPrices(projectA);

    findByMock.mockReturnValueOnce(
      Promise.resolve([priceRow("model-b", 2, 2)]),
    );
    const b: Array<LlmModelPrice> =
      await LlmModelPriceService.loadModelPrices(projectB);

    expect(
      a.map((e: LlmModelPrice) => {
        return e.modelPrefix;
      }),
    ).toEqual(["model-a"]);
    expect(
      b.map((e: LlmModelPrice) => {
        return e.modelPrefix;
      }),
    ).toEqual(["model-b"]);
  });
});

describe("LlmModelPriceService.loadModelPrices query shape", () => {
  test("only enabled rows for the project are requested", async () => {
    const projectId: ObjectID = ObjectID.generate();

    await LlmModelPriceService.loadModelPrices(projectId);

    const findByArgs: Record<string, unknown> = findByMock.mock
      .calls[0]![0] as Record<string, unknown>;
    const query: Record<string, unknown> = findByArgs["query"] as Record<
      string,
      unknown
    >;

    expect(query["isEnabled"]).toBe(true);
    expect(query["projectId"]).toBe(projectId);
  });
});
