import LlmModelPrice from "../../../Models/DatabaseModels/LlmModelPrice";
import LlmModelPriceService from "../../../Server/Services/LlmModelPriceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The create/update hooks are protected; reach them the way the
 * DatabaseService pipeline does, through the singleton instance. Price and
 * prefix validation is pure, so the only calls that need stubbing are the
 * duplicate-prefix lookups (findOneBy / findBy), which are stubbed per test.
 */
type HookAccess = {
  onBeforeCreate: (
    createBy: CreateBy<LlmModelPrice>,
  ) => Promise<{ createBy: CreateBy<LlmModelPrice> }>;
  onBeforeUpdate: (
    updateBy: UpdateBy<LlmModelPrice>,
  ) => Promise<{ updateBy: UpdateBy<LlmModelPrice> }>;
};

const service: HookAccess = LlmModelPriceService as unknown as HookAccess;

function makeCreateBy(data: Partial<LlmModelPrice>): CreateBy<LlmModelPrice> {
  const price: LlmModelPrice = new LlmModelPrice();
  Object.assign(price, data);

  return {
    data: price,
    props: { isRoot: true },
  } as CreateBy<LlmModelPrice>;
}

function makeUpdateBy(data: Record<string, unknown>): UpdateBy<LlmModelPrice> {
  return {
    query: {},
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<LlmModelPrice>;
}

// A create payload that carries no projectId never reaches a duplicate lookup.
function validCreate(
  overrides: Partial<LlmModelPrice> = {},
): CreateBy<LlmModelPrice> {
  return makeCreateBy({
    modelPrefix: "gpt-4o",
    inputPricePerMillionTokensInUSD: 5,
    outputPricePerMillionTokensInUSD: 15,
    ...overrides,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LlmModelPriceService.onBeforeCreate — modelPrefix", () => {
  test("keeps a well-formed prefix", async () => {
    const result: { createBy: CreateBy<LlmModelPrice> } =
      await service.onBeforeCreate(validCreate());

    expect(result.createBy.data.modelPrefix).toBe("gpt-4o");
  });

  /*
   * Prefixes are matched lowercase against normalized model names at ingest
   * time, so an entry saved with any other casing would never price anything.
   */
  test("lowercases the prefix so ingest-time matching can find it", async () => {
    const result: { createBy: CreateBy<LlmModelPrice> } =
      await service.onBeforeCreate(validCreate({ modelPrefix: "GPT-4o" }));

    expect(result.createBy.data.modelPrefix).toBe("gpt-4o");
  });

  test("trims surrounding whitespace before lowercasing", async () => {
    const result: { createBy: CreateBy<LlmModelPrice> } =
      await service.onBeforeCreate(
        validCreate({ modelPrefix: "  Claude-Opus  " }),
      );

    expect(result.createBy.data.modelPrefix).toBe("claude-opus");
  });

  test.each([
    ["missing", undefined],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["a number", 42],
    ["null", null],
  ])("rejects a prefix that is %s", async (_label: string, value: unknown) => {
    await expect(
      service.onBeforeCreate(
        validCreate({ modelPrefix: value as string | undefined }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("LlmModelPriceService.onBeforeCreate — prices", () => {
  test("accepts zero, which is how a free model is priced", async () => {
    const result: { createBy: CreateBy<LlmModelPrice> } =
      await service.onBeforeCreate(
        validCreate({
          inputPricePerMillionTokensInUSD: 0,
          outputPricePerMillionTokensInUSD: 0,
        }),
      );

    expect(result.createBy.data.inputPricePerMillionTokensInUSD).toBe(0);
    expect(result.createBy.data.outputPricePerMillionTokensInUSD).toBe(0);
  });

  test("accepts fractional prices", async () => {
    const result: { createBy: CreateBy<LlmModelPrice> } =
      await service.onBeforeCreate(
        validCreate({
          inputPricePerMillionTokensInUSD: 0.15,
          outputPricePerMillionTokensInUSD: 0.075,
        }),
      );

    expect(result.createBy.data.inputPricePerMillionTokensInUSD).toBe(0.15);
    expect(result.createBy.data.outputPricePerMillionTokensInUSD).toBe(0.075);
  });

  /*
   * The dashboard's number fields hand Formik `e.target.value`, so numeric
   * columns can arrive as strings. They must be written back as numbers so
   * Postgres never sees a string either.
   */
  test("coerces numeric strings back onto the payload as numbers", async () => {
    const result: { createBy: CreateBy<LlmModelPrice> } =
      await service.onBeforeCreate(
        validCreate({
          inputPricePerMillionTokensInUSD: "2.50" as unknown as number,
          outputPricePerMillionTokensInUSD: "10" as unknown as number,
        }),
      );

    expect(result.createBy.data.inputPricePerMillionTokensInUSD).toBe(2.5);
    expect(typeof result.createBy.data.inputPricePerMillionTokensInUSD).toBe(
      "number",
    );
    expect(result.createBy.data.outputPricePerMillionTokensInUSD).toBe(10);
    expect(typeof result.createBy.data.outputPricePerMillionTokensInUSD).toBe(
      "number",
    );
  });

  test.each([
    ["negative", -1],
    ["NaN string", "not-a-number"],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["missing", undefined],
    ["null", null],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])(
    "rejects an input price that is %s",
    async (_label: string, value: unknown) => {
      await expect(
        service.onBeforeCreate(
          validCreate({
            inputPricePerMillionTokensInUSD: value as number | undefined,
          }),
        ),
      ).rejects.toThrow(BadDataException);
    },
  );

  test("rejects a negative output price", async () => {
    await expect(
      service.onBeforeCreate(
        validCreate({ outputPricePerMillionTokensInUSD: -0.01 }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("names the offending field in the error message", async () => {
    await expect(
      service.onBeforeCreate(
        validCreate({ outputPricePerMillionTokensInUSD: -1 }),
      ),
    ).rejects.toThrow(/Output price/);

    await expect(
      service.onBeforeCreate(
        validCreate({ inputPricePerMillionTokensInUSD: -1 }),
      ),
    ).rejects.toThrow(/Input price/);
  });
});

describe("LlmModelPriceService.onBeforeCreate — duplicate prefixes", () => {
  /*
   * Two entries with the same prefix make the ingest-time price lookup
   * ambiguous (first-loaded wins), so the duplicate is refused at write time.
   */
  test("rejects a prefix the project already prices", async () => {
    const existing: LlmModelPrice = new LlmModelPrice();
    existing._id = new ObjectID(
      "11111111-1111-4111-8111-111111111111",
    ).toString();

    const findOneBy: jest.SpiedFunction<typeof LlmModelPriceService.findOneBy> =
      jest
        .spyOn(LlmModelPriceService, "findOneBy")
        .mockResolvedValue(existing as never);

    await expect(
      service.onBeforeCreate(
        validCreate({
          projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
        }),
      ),
    ).rejects.toThrow(BadDataException);

    expect(findOneBy).toHaveBeenCalled();
  });

  test("looks the duplicate up by the NORMALIZED prefix, not the raw input", async () => {
    const findOneBy: jest.SpiedFunction<typeof LlmModelPriceService.findOneBy> =
      jest
        .spyOn(LlmModelPriceService, "findOneBy")
        .mockResolvedValue(null as never);

    await service.onBeforeCreate(
      validCreate({
        modelPrefix: "  GPT-4O  ",
        projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      }),
    );

    const query: { modelPrefix?: string } = (
      findOneBy.mock.calls[0]![0] as unknown as {
        query: { modelPrefix?: string };
      }
    ).query;

    expect(query.modelPrefix).toBe("gpt-4o");
  });

  test("allows the prefix when the project has no entry for it", async () => {
    jest
      .spyOn(LlmModelPriceService, "findOneBy")
      .mockResolvedValue(null as never);

    const result: { createBy: CreateBy<LlmModelPrice> } =
      await service.onBeforeCreate(
        validCreate({
          projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
        }),
      );

    expect(result.createBy.data.modelPrefix).toBe("gpt-4o");
  });
});

describe("LlmModelPriceService.onBeforeUpdate", () => {
  test("coerces and validates updated prices", async () => {
    const result: { updateBy: UpdateBy<LlmModelPrice> } =
      await service.onBeforeUpdate(
        makeUpdateBy({
          inputPricePerMillionTokensInUSD: "3.25",
          outputPricePerMillionTokensInUSD: "9",
        }),
      );

    expect(result.updateBy.data.inputPricePerMillionTokensInUSD).toBe(3.25);
    expect(result.updateBy.data.outputPricePerMillionTokensInUSD).toBe(9);
  });

  test("rejects a negative updated price", async () => {
    await expect(
      service.onBeforeUpdate(
        makeUpdateBy({ inputPricePerMillionTokensInUSD: -4 }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * A partial update that does not mention a field must leave it alone rather
   * than validating `undefined` and failing the whole write.
   */
  test("leaves untouched fields alone", async () => {
    const result: { updateBy: UpdateBy<LlmModelPrice> } =
      await service.onBeforeUpdate(
        makeUpdateBy({ inputPricePerMillionTokensInUSD: 1 }),
      );

    expect(result.updateBy.data.inputPricePerMillionTokensInUSD).toBe(1);
    expect(
      result.updateBy.data.outputPricePerMillionTokensInUSD,
    ).toBeUndefined();
  });

  test("accepts an update that changes nothing at all", async () => {
    const result: { updateBy: UpdateBy<LlmModelPrice> } =
      await service.onBeforeUpdate(makeUpdateBy({}));

    expect(result.updateBy.data).toEqual({});
  });

  test("normalizes a renamed prefix", async () => {
    jest.spyOn(LlmModelPriceService, "findBy").mockResolvedValue([] as never);

    const result: { updateBy: UpdateBy<LlmModelPrice> } =
      await service.onBeforeUpdate(
        makeUpdateBy({ modelPrefix: "  Claude-SONNET " }),
      );

    expect(result.updateBy.data.modelPrefix).toBe("claude-sonnet");
  });

  test("rejects renaming a prefix onto one a sibling row already uses", async () => {
    const rowBeingUpdated: LlmModelPrice = new LlmModelPrice();
    rowBeingUpdated._id = new ObjectID(
      "33333333-3333-4333-8333-333333333333",
    ).toString();
    rowBeingUpdated.projectId = new ObjectID(
      "22222222-2222-4222-8222-222222222222",
    );

    const sibling: LlmModelPrice = new LlmModelPrice();
    sibling._id = new ObjectID(
      "44444444-4444-4444-8444-444444444444",
    ).toString();

    jest
      .spyOn(LlmModelPriceService, "findBy")
      .mockResolvedValue([rowBeingUpdated] as never);
    jest
      .spyOn(LlmModelPriceService, "findOneBy")
      .mockResolvedValue(sibling as never);

    await expect(
      service.onBeforeUpdate(makeUpdateBy({ modelPrefix: "gpt-4o" })),
    ).rejects.toThrow(BadDataException);
  });

  /*
   * Re-saving a row without changing its prefix finds itself. That is not a
   * duplicate, and refusing it would make the edit form unusable.
   */
  test("allows a row to keep its own prefix", async () => {
    const rowBeingUpdated: LlmModelPrice = new LlmModelPrice();
    rowBeingUpdated._id = new ObjectID(
      "33333333-3333-4333-8333-333333333333",
    ).toString();
    rowBeingUpdated.projectId = new ObjectID(
      "22222222-2222-4222-8222-222222222222",
    );

    jest
      .spyOn(LlmModelPriceService, "findBy")
      .mockResolvedValue([rowBeingUpdated] as never);
    jest
      .spyOn(LlmModelPriceService, "findOneBy")
      .mockResolvedValue(rowBeingUpdated as never);

    const result: { updateBy: UpdateBy<LlmModelPrice> } =
      await service.onBeforeUpdate(makeUpdateBy({ modelPrefix: "gpt-4o" }));

    expect(result.updateBy.data.modelPrefix).toBe("gpt-4o");
  });

  test("rejects an empty renamed prefix without touching the database", async () => {
    const findBy: jest.SpiedFunction<typeof LlmModelPriceService.findBy> = jest
      .spyOn(LlmModelPriceService, "findBy")
      .mockResolvedValue([] as never);

    await expect(
      service.onBeforeUpdate(makeUpdateBy({ modelPrefix: "   " })),
    ).rejects.toThrow(BadDataException);

    expect(findBy).not.toHaveBeenCalled();
  });
});
