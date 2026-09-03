import { Service as TelemetryIngestionKeyServiceType } from "../../../Server/Services/TelemetryIngestionKeyService";
import Model from "../../../Models/DatabaseModels/TelemetryIngestionKey";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import Query from "../../../Server/Types/Database/Query";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * The one rule that makes a Browser ingestion key safe to publish at all: it
 * cannot be created, and cannot be left, without an origin allowlist.
 *
 * A Browser key is pasted into public page source. "Secret" is a fiction for
 * it - anyone who views source has the bearer token - so the ONLY thing
 * standing between a scraped key and forged telemetry written into a
 * customer's project is the list of origins the key is bound to. There is no
 * safe permissive default for that list, which is why an empty one is refused
 * at the write path rather than defaulted to "any origin": a Browser key with
 * no origins is precisely the credential this whole feature exists to stop
 * shipping.
 *
 * Postgres cannot express "non-empty only when keyType is Browser", so the
 * service layer is the only place the rule lives on the write side. These
 * tests therefore go through the real onBeforeCreate / onBeforeUpdate hooks.
 *
 * Three further things are pinned here because each of them fails silently:
 *
 *   1. keyType is IMMUTABLE. Browser -> Server strips the origin binding off
 *      a key that is still sitting in a public page; Server -> Browser breaks
 *      a collector that has shipped traces for a year the moment it sends
 *      from no Origin. The column declares `update: []`, but that is an
 *      API-layer control - an internal caller reaching for updateOneById
 *      bypasses it, so the service refuses the patch too.
 *   2. THE BACKWARDS-COMPATIBILITY CONTRACT. A create with no keyType is a
 *      Server key, needs no allowlist, and behaves exactly as every key that
 *      existed before this shipped. Rows that predate the column read back
 *      with keyType NULL and must not be mistaken for Browser keys by the
 *      "you may not empty this list" guard.
 *   3. COST. The guard that refuses an empty allowlist has to read the rows
 *      the update matches. That read must happen ONLY when the patch actually
 *      empties the list - the common update (rename, toggle isEnabled, set an
 *      expiry) must not start paying a query for a rule it cannot break.
 *
 * Nothing here touches Postgres or Redis: the hooks are invoked directly on a
 * fresh service instance whose findBy/findOneBy are stubbed.
 */

const KEY_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const SECOND_KEY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const HOUR_MS: number = 60 * 60 * 1000;

type ServiceInternals = {
  onBeforeCreate: (createBy: CreateBy<Model>) => Promise<OnCreate<Model>>;
  onBeforeUpdate: (updateBy: UpdateBy<Model>) => Promise<OnUpdate<Model>>;
  onBeforeDelete: (deleteBy: DeleteBy<Model>) => Promise<OnDelete<Model>>;
  policyCache: {
    set: (key: string, value: null, ttlMs: number) => void;
    size: () => number;
  };
};

/*
 * Typed loosely on purpose: jest.spyOn's SpiedFunction and this repo's
 * @types/jest disagree about the optionality of mock.lastCall, and nothing
 * below needs more than mockResolvedValue and the recorded calls.
 */
type FindSpy = {
  mockResolvedValue: (value: never) => unknown;
  mock: { calls: Array<Array<unknown>> };
};

interface Harness {
  internals: ServiceInternals;
  findBy: FindSpy;
  findOneBy: FindSpy;
}

beforeEach(() => {
  jest.restoreAllMocks();
});

function buildService(): Harness {
  const service: TelemetryIngestionKeyServiceType =
    new TelemetryIngestionKeyServiceType();

  const findBy: FindSpy = jest.spyOn(service, "findBy") as unknown as FindSpy;
  findBy.mockResolvedValue([] as never);

  const findOneBy: FindSpy = jest.spyOn(
    service,
    "findOneBy",
  ) as unknown as FindSpy;
  findOneBy.mockResolvedValue(null as never);

  return {
    internals: service as unknown as ServiceInternals,
    findBy: findBy,
    findOneBy: findOneBy,
  };
}

/*
 * The realistic create payload: a model instance, which is what the API layer
 * hands the service. Every declared column is an OWN property on it (each is
 * initialised to `undefined` in the class body), so this shape - not a
 * hand-built bag - is what the hook's hasOwnProperty guards actually meet.
 */
function createByModel(payload: Record<string, unknown>): CreateBy<Model> {
  return {
    data: Object.assign(new Model(), payload) as Model,
    props: { isRoot: true },
  };
}

/*
 * A payload with no own property for the columns it does not mention, which
 * is what an internal caller building a literal produces.
 */
function createByBag(payload: Record<string, unknown>): CreateBy<Model> {
  return {
    data: payload as unknown as Model,
    props: { isRoot: true },
  };
}

function updateByBag(
  payload: Record<string, unknown>,
  query: Query<Model> = { _id: KEY_ID.toString() },
  props: DatabaseCommonInteractionProps = { isRoot: true },
): UpdateBy<Model> {
  return {
    query: query,
    data: payload,
    props: props,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
  } as unknown as UpdateBy<Model>;
}

/*
 * A row as the pre-read sees it. `keyTypeValue` is deliberately `unknown` so a
 * legacy row - written before the column existed, and therefore NULL - can be
 * modelled exactly.
 */
function affectedRow(id: ObjectID, keyTypeValue: unknown): Model {
  const row: Model = new Model(id);
  (row as unknown as Record<string, unknown>)["keyType"] = keyTypeValue;
  return row;
}

function writtenValues(createBy: CreateBy<Model>): Record<string, unknown> {
  return createBy.data as unknown as Record<string, unknown>;
}

describe("TelemetryIngestionKeyService.onBeforeCreate - a Browser key cannot be created without an origin allowlist", () => {
  /*
   * Every shape a "no origins" allowlist arrives in. [""] and ["   "] matter
   * as much as [] does: a blank entry is dropped by the matcher, so a list of
   * blanks is non-empty in the database and matches nothing at ingest time -
   * a published key that appears configured and is bound to nothing.
   */
  const emptyAllowLists: Array<[string, Record<string, unknown>]> = [
    ["absent from the payload", {}],
    ["explicitly null", { allowedOrigins: null }],
    ["an empty array", { allowedOrigins: [] }],
    ["an array holding one empty string", { allowedOrigins: [""] }],
    ["an array holding one blank string", { allowedOrigins: ["   "] }],
    [
      "an array of nothing but blanks",
      { allowedOrigins: ["", "   ", "\t", "\n"] },
    ],
  ];

  test.each(emptyAllowLists)(
    "refuses a Browser key whose allowed origins are %s",
    async (_label: string, payload: Record<string, unknown>): Promise<void> => {
      const { internals }: Harness = buildService();

      const createBy: CreateBy<Model> = createByModel({
        keyType: TelemetryIngestionKeyType.Browser,
        ...payload,
      });

      await expect(internals.onBeforeCreate(createBy)).rejects.toThrow(
        BadDataException,
      );
      await expect(internals.onBeforeCreate(createBy)).rejects.toThrow(
        "must list at least one allowed origin",
      );
    },
  );

  test("refuses a Browser key when allowedOrigins is not an own property of the payload at all", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeCreate(
        createByBag({ keyType: TelemetryIngestionKeyType.Browser }),
      ),
    ).rejects.toThrow("must list at least one allowed origin");
  });
});

describe("TelemetryIngestionKeyService.onBeforeCreate - allowlist entries are validated, and the refusal names the entry", () => {
  /*
   * Each of these is something a customer plainly meant but that `matches`
   * will never accept, so storing it hands them an allowlist entry that
   * silently matches nothing. The message has to name the offending entry:
   * "one of your origins is wrong" is unfixable advice on a list of ten.
   */
  const invalidOrigins: Array<string> = [
    "app.example.com",
    "https://app.example.com/some/path",
    "https://*",
    "https://a.*.example.com",
    "https://*example.com",
    "ftp://example.com",
    "https://user@example.com",
    "https://example.com:70000",
  ];

  test.each(invalidOrigins)(
    "refuses %s and says so by name",
    async (badOrigin: string): Promise<void> => {
      const { internals }: Harness = buildService();

      const createBy: CreateBy<Model> = createByModel({
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: [badOrigin],
      });

      await expect(internals.onBeforeCreate(createBy)).rejects.toThrow(
        BadDataException,
      );
      await expect(internals.onBeforeCreate(createBy)).rejects.toThrow(
        badOrigin,
      );
    },
  );

  test("names the offending entry rather than the first entry when a good origin precedes a bad one", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({
      keyType: TelemetryIngestionKeyType.Browser,
      allowedOrigins: ["https://good.example.com", "https://*"],
    });

    await expect(internals.onBeforeCreate(createBy)).rejects.toThrow(
      "https://*",
    );

    let message: string = "";
    try {
      await internals.onBeforeCreate(createBy);
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toContain("https://*");
    expect(message).not.toContain("good.example.com");
  });

  test("refuses an allowedOrigins that is not a list at all", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeCreate(
        createByModel({
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: "https://app.example.com",
        }),
      ),
    ).rejects.toThrow("must be a list of origins");
  });

  test("refuses an allowlist entry that is not text", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeCreate(
        createByModel({
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: [{ origin: "https://app.example.com" }],
        }),
      ),
    ).rejects.toThrow("must be text");
  });

  /*
   * Validated on a Server key too, even though a Server key never enforces
   * them. A list typed in "for later" that is quietly full of entries which
   * can never match is a trap that only springs the day the customer decides
   * to rely on it.
   */
  test("validates the allowlist on a Server key as well, even though it is not required there", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeCreate(
        createByModel({
          keyType: TelemetryIngestionKeyType.Server,
          allowedOrigins: ["https://a.*.example.com"],
        }),
      ),
    ).rejects.toThrow("https://a.*.example.com");
  });
});

describe("TelemetryIngestionKeyService.onBeforeCreate - the other constrained columns", () => {
  test("refuses a pinned service name longer than the column can hold", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeCreate(
        createByModel({
          pinnedServiceName: "a".repeat(ColumnLength.ShortText + 1),
        }),
      ),
    ).rejects.toThrow(
      `cannot be longer than ${ColumnLength.ShortText} characters`,
    );
  });

  test("refuses a pinned service name that is not text", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeCreate(createByModel({ pinnedServiceName: 42 })),
    ).rejects.toThrow("must be text");
  });

  /*
   * DELIBERATELY NOT A REFUSAL. A blank pinned service name means "not
   * pinned", and is normalised to null rather than rejected, because "" and
   * "   " are exactly what an emptied form field posts - refusing them would
   * leave a customer who once pinned a service name unable to ever unpin it.
   * A Browser key does not require a pin (TelemetryIngestionKeyGuard never
   * consults one), so accepting blank as "no pin" gives up nothing.
   */
  test("treats a blank pinned service name as no pin rather than refusing it", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({
      pinnedServiceName: "   ",
    });

    await expect(internals.onBeforeCreate(createBy)).resolves.toBeDefined();
    expect(writtenValues(createBy)["pinnedServiceName"]).toBeNull();
  });

  const invalidLimits: Array<[string, unknown]> = [
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    ["NaN", Number.NaN],
    ["text", "not-a-number"],
    ["an object", {}],
  ];

  test.each(invalidLimits)(
    "refuses a requests-per-minute limit that is %s",
    async (_label: string, limit: unknown): Promise<void> => {
      const { internals }: Harness = buildService();

      await expect(
        internals.onBeforeCreate(
          createByModel({ requestsPerMinuteLimit: limit }),
        ),
      ).rejects.toThrow("whole number greater than 0");
    },
  );

  /*
   * Refused rather than accepted-and-immediately-dead. Saving a past expiry
   * bricks the key on save, and the symptom - telemetry stops, key still
   * looks fine in the list - costs an afternoon to diagnose.
   */
  test("refuses an expiry that is already in the past", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeCreate(
        createByModel({ expiresAt: new Date(Date.now() - HOUR_MS) }),
      ),
    ).rejects.toThrow("must be in the future");
  });
});

describe("TelemetryIngestionKeyService.onBeforeCreate - what must keep working", () => {
  /*
   * THE BACKWARDS-COMPATIBILITY STORY, at the write path. A create with no
   * key type is a Server key, and a Server key needs no allowlist. If this
   * ever starts defaulting to Browser - or starts demanding origins - every
   * existing integration that creates keys breaks at once.
   */
  test("a create with no key type is written as a Server key", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({});

    await expect(internals.onBeforeCreate(createBy)).resolves.toBeDefined();
    expect(writtenValues(createBy)["keyType"]).toBe(
      TelemetryIngestionKeyType.Server,
    );
  });

  test("an empty-string key type is written as a Server key rather than refused", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({ keyType: "" });

    await expect(internals.onBeforeCreate(createBy)).resolves.toBeDefined();
    expect(writtenValues(createBy)["keyType"]).toBe(
      TelemetryIngestionKeyType.Server,
    );
  });

  /*
   * An unrecognised type is refused rather than coerced: "I asked for a
   * Browser key and got a Server key" is a security surprise, not a typo to
   * paper over.
   */
  test("an unrecognised key type is refused, not silently coerced to Server", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeCreate(createByModel({ keyType: "browser" })),
    ).rejects.toThrow("is not a valid ingestion key type");
  });

  test("a Server key with no allowed origins is created - the overwhelmingly common case", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({
      keyType: TelemetryIngestionKeyType.Server,
    });

    await expect(internals.onBeforeCreate(createBy)).resolves.toBeDefined();
    expect(writtenValues(createBy)["keyType"]).toBe(
      TelemetryIngestionKeyType.Server,
    );
  });

  test("a Server key may still carry a valid allowlist", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({
      keyType: TelemetryIngestionKeyType.Server,
      allowedOrigins: ["https://app.example.com"],
    });

    await expect(internals.onBeforeCreate(createBy)).resolves.toBeDefined();
    expect(writtenValues(createBy)["allowedOrigins"]).toEqual([
      "https://app.example.com",
    ]);
  });

  test("a Browser key with a single valid origin is created", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({
      keyType: TelemetryIngestionKeyType.Browser,
      allowedOrigins: ["https://app.example.com"],
    });

    await expect(internals.onBeforeCreate(createBy)).resolves.toBeDefined();
    expect(writtenValues(createBy)["keyType"]).toBe(
      TelemetryIngestionKeyType.Browser,
    );
    expect(writtenValues(createBy)["allowedOrigins"]).toEqual([
      "https://app.example.com",
    ]);
  });

  test("a Browser key with several valid origins keeps all of them", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({
      keyType: TelemetryIngestionKeyType.Browser,
      allowedOrigins: [
        "https://app.example.com",
        "https://*.example.com",
        "http://localhost:3000",
      ],
    });

    await expect(internals.onBeforeCreate(createBy)).resolves.toBeDefined();
    expect(writtenValues(createBy)["allowedOrigins"]).toEqual([
      "https://app.example.com",
      "https://*.example.com",
      "http://localhost:3000",
    ]);
  });

  /*
   * Stored in the form the matcher compares against, so what the dashboard
   * lists is exactly what will be matched at ingest time. A pasted
   * "https://App.Example.com/" that silently never matches is a total ingest
   * failure whose only symptom is a trailing character.
   */
  test("origins are stored canonicalised and de-duplicated", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({
      keyType: TelemetryIngestionKeyType.Browser,
      allowedOrigins: [
        "  HTTPS://App.Example.com/  ",
        "https://app.example.com",
        "",
      ],
    });

    await expect(internals.onBeforeCreate(createBy)).resolves.toBeDefined();
    expect(writtenValues(createBy)["allowedOrigins"]).toEqual([
      "https://app.example.com",
    ]);
  });

  test("a valid pinned service name is trimmed before it is written", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({
      pinnedServiceName: "  checkout-web  ",
    });

    await expect(internals.onBeforeCreate(createBy)).resolves.toBeDefined();
    expect(writtenValues(createBy)["pinnedServiceName"]).toBe("checkout-web");
  });

  test("a valid requests-per-minute limit passes through unchanged", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({
      requestsPerMinuteLimit: 1200,
    });

    await expect(internals.onBeforeCreate(createBy)).resolves.toBeDefined();
    expect(writtenValues(createBy)["requestsPerMinuteLimit"]).toBe(1200);
  });

  test("a future expiry passes through unchanged", async () => {
    const { internals }: Harness = buildService();

    const expiresAt: Date = new Date(Date.now() + HOUR_MS);
    const createBy: CreateBy<Model> = createByModel({ expiresAt: expiresAt });

    await expect(internals.onBeforeCreate(createBy)).resolves.toBeDefined();
    expect((writtenValues(createBy)["expiresAt"] as Date).getTime()).toBe(
      expiresAt.getTime(),
    );
  });

  /*
   * Pre-existing behaviour that the new validation must not have displaced:
   * the secret is generated server-side when the caller does not supply one.
   * A key created without one would be unusable, and - worse - a caller could
   * not tell that from a key created with one.
   */
  test("the secret key is still generated when the payload does not carry one", async () => {
    const { internals }: Harness = buildService();

    const createBy: CreateBy<Model> = createByModel({
      keyType: TelemetryIngestionKeyType.Browser,
      allowedOrigins: ["https://app.example.com"],
    });

    await internals.onBeforeCreate(createBy);

    const secretKey: unknown = writtenValues(createBy)["secretKey"];
    expect(secretKey).toBeInstanceOf(ObjectID);
    expect((secretKey as ObjectID).toString().length).toBeGreaterThan(0);
  });

  test("a supplied secret key is left alone", async () => {
    const { internals }: Harness = buildService();

    const supplied: ObjectID = ObjectID.generate();
    const createBy: CreateBy<Model> = createByModel({ secretKey: supplied });

    await internals.onBeforeCreate(createBy);

    expect((writtenValues(createBy)["secretKey"] as ObjectID).toString()).toBe(
      supplied.toString(),
    );
  });
});

describe("TelemetryIngestionKeyService.onBeforeUpdate - the key type is immutable", () => {
  const keyTypePatches: Array<[string, TelemetryIngestionKeyType]> = [
    ["Server -> Browser", TelemetryIngestionKeyType.Browser],
    ["Browser -> Server", TelemetryIngestionKeyType.Server],
  ];

  test.each(keyTypePatches)(
    "refuses a patch that changes the key type (%s) and tells the customer to create a new key",
    async (
      _label: string,
      keyType: TelemetryIngestionKeyType,
    ): Promise<void> => {
      const { internals }: Harness = buildService();

      await expect(
        internals.onBeforeUpdate(updateByBag({ keyType: keyType })),
      ).rejects.toThrow(BadDataException);
      await expect(
        internals.onBeforeUpdate(updateByBag({ keyType: keyType })),
      ).rejects.toThrow("Create a new ingestion key instead");
    },
  );

  test("refuses the patch even when the key type is bundled with an otherwise harmless edit", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeUpdate(
        updateByBag({
          name: "renamed",
          keyType: TelemetryIngestionKeyType.Server,
        }),
      ),
    ).rejects.toThrow("Create a new ingestion key instead");
  });

  /*
   * A patch built from a model instance carries every column as an own
   * property with the value `undefined`. That is an absence, not a change,
   * and treating it as one would refuse every ordinary edit posted from a
   * hydrated entity.
   */
  test("an undefined key type on a model-shaped patch is an absence, not a change", async () => {
    const { internals }: Harness = buildService();

    const patch: Record<string, unknown> = Object.assign(
      new Model(),
      {},
    ) as unknown as Record<string, unknown>;
    patch["name"] = "renamed";

    await expect(
      internals.onBeforeUpdate(updateByBag(patch)),
    ).resolves.toBeDefined();
  });
});

describe("TelemetryIngestionKeyService.onBeforeUpdate - the allowlist cannot be emptied on a Browser key", () => {
  const emptyingPatches: Array<[string, unknown]> = [
    ["an empty array", []],
    ["null", null],
    ["a list of blanks", ["", "   "]],
  ];

  test.each(emptyingPatches)(
    "refuses to clear the allowlist with %s when an affected row is a Browser key",
    async (_label: string, allowedOrigins: unknown): Promise<void> => {
      const { internals, findBy }: Harness = buildService();

      findBy.mockResolvedValue([
        affectedRow(KEY_ID, TelemetryIngestionKeyType.Browser),
      ] as never);

      await expect(
        internals.onBeforeUpdate(
          updateByBag({ allowedOrigins: allowedOrigins }),
        ),
      ).rejects.toThrow(BadDataException);
      await expect(
        internals.onBeforeUpdate(
          updateByBag({ allowedOrigins: allowedOrigins }),
        ),
      ).rejects.toThrow("must keep at least one allowed origin");
    },
  );

  test("the refusal names the key that blocked it, so a bulk update can be fixed", async () => {
    const { internals, findBy }: Harness = buildService();

    findBy.mockResolvedValue([
      affectedRow(SECOND_KEY_ID, TelemetryIngestionKeyType.Server),
      affectedRow(KEY_ID, TelemetryIngestionKeyType.Browser),
    ] as never);

    await expect(
      internals.onBeforeUpdate(updateByBag({ allowedOrigins: [] })),
    ).rejects.toThrow(KEY_ID.toString());
  });

  test("allows the allowlist to be cleared when every affected row is a Server key", async () => {
    const { internals, findBy }: Harness = buildService();

    findBy.mockResolvedValue([
      affectedRow(KEY_ID, TelemetryIngestionKeyType.Server),
      affectedRow(SECOND_KEY_ID, TelemetryIngestionKeyType.Server),
    ] as never);

    const updateBy: UpdateBy<Model> = updateByBag({ allowedOrigins: [] });

    await expect(internals.onBeforeUpdate(updateBy)).resolves.toBeDefined();
    expect(
      (updateBy.data as unknown as Record<string, unknown>)["allowedOrigins"],
    ).toEqual([]);
  });

  /*
   * THE BACKWARDS-COMPATIBILITY CONTRACT, on the guard itself. Every key that
   * existed before this shipped reads back with keyType NULL. Those are
   * Server keys, and clearing an allowlist they never had must not be refused
   * because the guard could not recognise them.
   */
  test("a legacy row with a NULL key type is treated as a Server key by the guard", async () => {
    const { internals, findBy }: Harness = buildService();

    findBy.mockResolvedValue([
      affectedRow(KEY_ID, null),
      affectedRow(SECOND_KEY_ID, undefined),
    ] as never);

    await expect(
      internals.onBeforeUpdate(updateByBag({ allowedOrigins: [] })),
    ).resolves.toBeDefined();
  });

  test("accepts a valid non-empty allowlist on a Browser key", async () => {
    const { internals, findBy }: Harness = buildService();

    const updateBy: UpdateBy<Model> = updateByBag({
      allowedOrigins: ["  HTTPS://App.Example.com/ ", "https://*.example.com"],
    });

    await expect(internals.onBeforeUpdate(updateBy)).resolves.toBeDefined();
    expect(
      (updateBy.data as unknown as Record<string, unknown>)["allowedOrigins"],
    ).toEqual(["https://app.example.com", "https://*.example.com"]);

    /*
     * A non-empty list is legal on both key types, so it must not pay for the
     * pre-read either.
     */
    expect(findBy.mock.calls).toHaveLength(0);
  });

  /*
   * The pre-read is a policy check, so it runs as root - it has to see every
   * row the update will touch, including ones the caller could not read. That
   * makes tenant scoping load-bearing: without it a broad query would be
   * checked against another project's Browser keys.
   */
  test("the pre-read is scoped to the caller's tenant when the query does not name a project", async () => {
    const { internals, findBy }: Harness = buildService();

    await internals.onBeforeUpdate(
      updateByBag({ allowedOrigins: [] }, { _id: KEY_ID.toString() }, {
        tenantId: PROJECT_ID,
      } as DatabaseCommonInteractionProps),
    );

    expect(findBy.mock.calls).toHaveLength(1);
    const call: {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    } = findBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    };
    expect((call.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(call.props.isRoot).toBe(true);
  });

  test("a project named by the query itself is not overwritten by the caller's tenant", async () => {
    const { internals, findBy }: Harness = buildService();

    await internals.onBeforeUpdate(
      updateByBag({ allowedOrigins: [] }, { projectId: OTHER_PROJECT_ID }, {
        tenantId: PROJECT_ID,
      } as DatabaseCommonInteractionProps),
    );

    const call: { query: Record<string, unknown> } = findBy.mock
      .calls[0]![0] as { query: Record<string, unknown> };
    expect((call.query["projectId"] as ObjectID).toString()).toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });
});

describe("TelemetryIngestionKeyService.onBeforeUpdate - the other constrained columns", () => {
  test("refuses an invalid origin pattern and names it", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeUpdate(
        updateByBag({ allowedOrigins: ["https://exa_mple.com"] }),
      ),
    ).rejects.toThrow("https://exa_mple.com");
  });

  test("refuses a pinned service name longer than the column can hold", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeUpdate(
        updateByBag({
          pinnedServiceName: "a".repeat(ColumnLength.ShortText + 1),
        }),
      ),
    ).rejects.toThrow(
      `cannot be longer than ${ColumnLength.ShortText} characters`,
    );
  });

  /*
   * The other half of "blank means unpin": on update it is the ONLY way a
   * customer can remove a pin they no longer want.
   */
  test("a blank pinned service name clears the pin instead of being refused", async () => {
    const { internals }: Harness = buildService();

    const updateBy: UpdateBy<Model> = updateByBag({ pinnedServiceName: "  " });

    await expect(internals.onBeforeUpdate(updateBy)).resolves.toBeDefined();
    expect(
      (updateBy.data as unknown as Record<string, unknown>)[
        "pinnedServiceName"
      ],
    ).toBeNull();
  });

  test("refuses a requests-per-minute limit that is not a whole number above zero", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeUpdate(updateByBag({ requestsPerMinuteLimit: 0 })),
    ).rejects.toThrow("whole number greater than 0");
    await expect(
      internals.onBeforeUpdate(updateByBag({ requestsPerMinuteLimit: -5 })),
    ).rejects.toThrow("whole number greater than 0");
    await expect(
      internals.onBeforeUpdate(updateByBag({ requestsPerMinuteLimit: 2.5 })),
    ).rejects.toThrow("whole number greater than 0");
  });

  test("refuses an expiry that is already in the past", async () => {
    const { internals }: Harness = buildService();

    await expect(
      internals.onBeforeUpdate(
        updateByBag({ expiresAt: new Date(Date.now() - HOUR_MS) }),
      ),
    ).rejects.toThrow("must be in the future");
  });

  test("accepts a future expiry and a positive limit together", async () => {
    const { internals }: Harness = buildService();

    const expiresAt: Date = new Date(Date.now() + HOUR_MS);
    const updateBy: UpdateBy<Model> = updateByBag({
      expiresAt: expiresAt,
      requestsPerMinuteLimit: 6000,
    });

    await expect(internals.onBeforeUpdate(updateBy)).resolves.toBeDefined();

    const written: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;
    expect((written["expiresAt"] as Date).getTime()).toBe(expiresAt.getTime());
    expect(written["requestsPerMinuteLimit"]).toBe(6000);
  });
});

describe("TelemetryIngestionKeyService.onBeforeUpdate - the common update path pays nothing extra", () => {
  /*
   * The pre-read exists for exactly one rule: "you may not empty a Browser
   * key's allowlist". Every other edit - rename, toggle isEnabled, set an
   * expiry, set a limit - cannot break that rule and must not issue a query
   * to prove it. This path runs on every dashboard save; a stray SELECT here
   * is a permanent tax paid for a case that is not in play.
   */
  const cheapPatches: Array<[string, Record<string, unknown>]> = [
    ["a rename", { name: "renamed" }],
    ["the kill switch", { isEnabled: false }],
    ["an expiry", { expiresAt: new Date(Date.now() + HOUR_MS) }],
    ["a rate limit", { requestsPerMinuteLimit: 6000 }],
    ["a pinned service name", { pinnedServiceName: "checkout-web" }],
  ];

  test.each(cheapPatches)(
    "issues no pre-read query for a patch that only sets %s",
    async (_label: string, payload: Record<string, unknown>): Promise<void> => {
      const { internals, findBy, findOneBy }: Harness = buildService();

      await expect(
        internals.onBeforeUpdate(updateByBag(payload)),
      ).resolves.toBeDefined();

      expect(findBy.mock.calls).toHaveLength(0);
      expect(findOneBy.mock.calls).toHaveLength(0);
    },
  );

  test("issues no pre-read query for a model-shaped patch whose allowedOrigins is merely undefined", async () => {
    const { internals, findBy, findOneBy }: Harness = buildService();

    const patch: Record<string, unknown> = Object.assign(
      new Model(),
      {},
    ) as unknown as Record<string, unknown>;
    patch["isEnabled"] = false;

    await expect(
      internals.onBeforeUpdate(updateByBag(patch)),
    ).resolves.toBeDefined();

    expect(findBy.mock.calls).toHaveLength(0);
    expect(findOneBy.mock.calls).toHaveLength(0);
  });
});

describe("TelemetryIngestionKeyService - the policy cache is invalidated on write", () => {
  /*
   * Pre-existing behaviour that must survive the new validation. The cached
   * policy now carries the kill switch, the expiry, the allowlist and the
   * rate limit, so almost any edit invalidates it - and a revoked or
   * disabled key that keeps working for a minute longer than the operator
   * believes is the failure this cache is allowed to have only because it is
   * cleared here.
   */
  function seedCache(internals: ServiceInternals): void {
    internals.policyCache.set("seeded-entry", null, 60 * 1000);
    expect(internals.policyCache.size()).toBe(1);
  }

  test("an accepted update clears the cache", async () => {
    const { internals }: Harness = buildService();
    seedCache(internals);

    await internals.onBeforeUpdate(updateByBag({ isEnabled: false }));

    expect(internals.policyCache.size()).toBe(0);
  });

  test("a delete clears the cache", async () => {
    const { internals }: Harness = buildService();
    seedCache(internals);

    await internals.onBeforeDelete({
      query: { _id: KEY_ID.toString() },
      props: { isRoot: true },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    } as unknown as DeleteBy<Model>);

    expect(internals.policyCache.size()).toBe(0);
  });

  /*
   * A rejected update must NOT churn the cache: throwing away every cached
   * policy in the process sends the whole ingest fleet back to Postgres, and
   * a caller retrying a bad patch could do that repeatedly.
   */
  test("a rejected update leaves the cache alone", async () => {
    const { internals }: Harness = buildService();
    seedCache(internals);

    await expect(
      internals.onBeforeUpdate(
        updateByBag({ keyType: TelemetryIngestionKeyType.Browser }),
      ),
    ).rejects.toThrow(BadDataException);

    expect(internals.policyCache.size()).toBe(1);
  });
});
