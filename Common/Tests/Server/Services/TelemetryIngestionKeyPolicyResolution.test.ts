import { describe, expect, test, beforeEach } from "@jest/globals";
import { createHash } from "crypto";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyPolicy from "../../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";

/*
 * Every TelemetryIngestionKey in every installation that exists today was
 * written before this feature's seven columns did, so it reads back with all
 * of them NULL. getPolicyFromSecretKey is the ONE place that turns such a row
 * into the total TelemetryIngestionKeyPolicy the ingest guards are written
 * against, which makes it the hinge the whole change swings on: if a NULL
 * keyType resolved to anything but Server, or a NULL isEnabled to anything
 * but true, every existing customer's telemetry would start being refused the
 * moment this ships - and silently, because a refused ingest request is never
 * replayed and the spans are simply gone.
 *
 * So this suite pins that resolution column by column, and then pins the
 * three properties of the cache sitting in front of it that are easy to break
 * without noticing:
 *
 *   1. the cache is keyed on a HASH of the token, never the token itself - an
 *      in-process Map is exactly what ends up in a heap snapshot or a core
 *      file, and a live ingestion secret must not be lying in one;
 *   2. a cache HIT rehydrates real ObjectIDs and a real Date out of the
 *      primitive snapshot it stores. A hit that handed back expiresAt as a
 *      string would type-check everywhere and then blow up on the
 *      middleware's expiresAt.getTime() only after the first minute of
 *      traffic on that pod;
 *   3. a caller that mutates the policy it was handed cannot poison what
 *      every other request on the pod sees for the rest of the TTL.
 *
 * It also pins two deliberate NON-behaviours, both of which a well-meaning
 * change would break quietly: getProjectIdFromSecretKey stays a LOOKUP and
 * resolves disabled and expired keys (its four callers refuse those
 * themselves, each naming its own surface, and folding the check in here
 * would make "unknown key" and "switched-off key" indistinguishable in all
 * four), and markUsed stays throttled, hook-free and cache-preserving - a
 * passive liveness stamp that invalidated the policy cache would send the
 * hottest path in the product back to Postgres every five minutes for a
 * column nobody reads more than once a quarter.
 *
 * Nothing here touches Postgres: the base DatabaseService is replaced by a
 * fake whose accessors are jest mocks, while the real service module - cache,
 * TTLs, hashing, normalisation - runs on top of it. That is the technique
 * App/Tests/Telemetry/GrpcServerAuthCache.test.ts uses.
 */

/*
 * The base class is replaced rather than stubbed per-method because its
 * import closure reaches PasswordHash, which does not compile under ts-jest
 * locally, and because the only things this suite needs from it are the four
 * data accessors below.
 */
jest.mock("../../../Server/Services/DatabaseService", () => {
  class FakeDatabaseService {
    public modelType: unknown;

    public constructor(modelType: unknown) {
      this.modelType = modelType;
    }

    // Base-class configuration helpers a subclass constructor may call.
    public hardDeleteItemsOlderThanInDays(): void {
      // no-op
    }

    public setDoNotAllowDelete(): void {
      // no-op
    }

    public async findOneBy(): Promise<unknown> {
      throw new Error(
        "findOneBy stub was not replaced - the test must install its own implementation.",
      );
    }

    public async updateColumnsByIdWithoutHooks(): Promise<unknown> {
      throw new Error(
        "updateColumnsByIdWithoutHooks stub was not replaced - the test must install its own implementation.",
      );
    }

    public async updateOneById(): Promise<unknown> {
      throw new Error("A hooked write path must not be used on markUsed.");
    }

    public async updateBy(): Promise<unknown> {
      throw new Error("A hooked write path must not be used on markUsed.");
    }
  }

  return {
    __esModule: true,
    default: FakeDatabaseService,
  };
});

/*
 * CaptureSpan wraps decorated methods in OpenTelemetry spans; a pass-through
 * decorator keeps the suite from standing up tracing infrastructure.
 */
jest.mock("../../../Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});

// markUsed logs on a swallowed failure; keep the suite output clean.
jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    },
  };
});

type MockFn = jest.Mock;

/*
 * A row exactly as Postgres hands it back - deliberately untyped, because
 * half the point of this suite is what happens when a column holds something
 * the model type says it cannot (a NULL keyType, a string allowedOrigins).
 */
type FakeRow = Record<string, unknown>;

/*
 * The private surfaces this suite reaches into: the service's own accessors
 * (which the fake base class defines and each test replaces) and the policy
 * cache, whose KEYS are an assertion target - a raw secret must never be one.
 */
type ServiceInternals = {
  findOneBy: MockFn;
  updateColumnsByIdWithoutHooks: MockFn;
  updateOneById: MockFn;
  updateBy: MockFn;
  policyCache: { store: Map<string, unknown> };
};

const internals: () => ServiceInternals = (): ServiceInternals => {
  return TelemetryIngestionKeyService as unknown as ServiceInternals;
};

/*
 * Install a counting findOneBy that resolves the given tokens to the given
 * rows; every other token resolves to "no row", as the real accessor does.
 */
const installRows: (rows: Record<string, FakeRow>) => MockFn = (
  rows: Record<string, FakeRow>,
): MockFn => {
  const findOneByMock: MockFn = jest
    .fn()
    .mockImplementation((findOneBy: unknown): Promise<unknown> => {
      const query: Record<string, unknown> = (
        findOneBy as { query: Record<string, unknown> }
      ).query;

      const queriedKey: string | undefined = (
        query["secretKey"] as ObjectID | undefined
      )?.toString();

      const row: FakeRow | undefined = queriedKey
        ? rows[queriedKey]
        : undefined;

      return Promise.resolve(row ?? null);
    });

  internals().findOneBy = findOneByMock;

  return findOneByMock;
};

/*
 * Resolve one row through the real service. Each call mints a fresh token so
 * that the module-level policy cache (a singleton shared by every test in
 * this file) can never serve one case's answer to another.
 */
const resolveRow: (
  row: FakeRow,
) => Promise<TelemetryIngestionKeyPolicy> = async (
  row: FakeRow,
): Promise<TelemetryIngestionKeyPolicy> => {
  const token: string = ObjectID.generate().toString();
  installRows({ [token]: row });

  const policy: TelemetryIngestionKeyPolicy | null =
    await TelemetryIngestionKeyService.getPolicyFromSecretKey(token);

  expect(policy).not.toBeNull();

  return policy as TelemetryIngestionKeyPolicy;
};

const policyCacheKeys: () => Array<string> = (): Array<string> => {
  return Array.from(internals().policyCache.store.keys());
};

const hashOf: (token: string) => string = (token: string): string => {
  return createHash("sha256").update(token).digest("hex");
};

describe("TelemetryIngestionKeyService policy resolution", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("backwards compatibility with rows written before the feature", () => {
    test("a NULL keyType is a Server key", async () => {
      const nullKeyType: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        keyType: null,
      });

      expect(nullKeyType.keyType).toBe(TelemetryIngestionKeyType.Server);
    });

    test("an absent keyType column is a Server key", async () => {
      const absentKeyType: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ObjectID.generate(),
        projectId: ObjectID.generate(),
      });

      expect(absentKeyType.keyType).toBe(TelemetryIngestionKeyType.Server);
    });

    test("a keyType the code does not recognise is a Server key, never a Browser key", async () => {
      /*
       * A typo, a truncated column, a half-applied migration or a hand-edited
       * row must all fail towards "behaves as it always did". The one value
       * that grants the restrictive treatment is the exact string "Browser";
       * everything else - including its lowercase form - is Server.
       */
      const unrecognisedValues: Array<unknown> = [
        "browser",
        "BROWSER",
        "Public",
        "Serverr",
        "",
        0,
        1,
        true,
        {},
        [],
      ];

      for (const unrecognisedValue of unrecognisedValues) {
        const policy: TelemetryIngestionKeyPolicy = await resolveRow({
          _id: ObjectID.generate(),
          projectId: ObjectID.generate(),
          keyType: unrecognisedValue,
        });

        expect(policy.keyType).toBe(TelemetryIngestionKeyType.Server);
      }
    });

    test("the exact string Browser is the only value that produces a Browser key", async () => {
      const browserKey: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        keyType: TelemetryIngestionKeyType.Browser,
        allowedOrigins: ["https://app.example.com"],
      });

      expect(browserKey.keyType).toBe(TelemetryIngestionKeyType.Browser);
    });

    test("a NULL or absent isEnabled leaves the key enabled", async () => {
      const nullIsEnabled: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        isEnabled: null,
      });

      const absentIsEnabled: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ObjectID.generate(),
        projectId: ObjectID.generate(),
      });

      expect(nullIsEnabled.isEnabled).toBe(true);
      expect(absentIsEnabled.isEnabled).toBe(true);
    });

    test("only an explicit false switches a key off", async () => {
      const disabled: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        isEnabled: false,
      });

      expect(disabled.isEnabled).toBe(false);
    });

    test("allowedOrigins that is missing, NULL or not a list resolves to an empty list", async () => {
      const notLists: Array<unknown> = [
        null,
        undefined,
        "https://app.example.com",
        { "0": "https://app.example.com" },
        7,
        true,
      ];

      for (const notList of notLists) {
        const policy: TelemetryIngestionKeyPolicy = await resolveRow({
          _id: ObjectID.generate(),
          projectId: ObjectID.generate(),
          allowedOrigins: notList,
        });

        expect(Array.isArray(policy.allowedOrigins)).toBe(true);
        expect(policy.allowedOrigins).toEqual([]);
      }
    });

    test("blank and non-string entries are dropped from allowedOrigins so a non-empty list always has a pattern that can match", async () => {
      /*
       * The Browser guard reads "the list is non-empty" as "this key is
       * configured". A list of [""] would satisfy that while matching
       * nothing, which is a key that silently accepts nobody.
       */
      const policy: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        allowedOrigins: [
          "https://app.example.com",
          "",
          "   ",
          null,
          42,
          "https://admin.example.com",
        ],
      });

      expect(policy.allowedOrigins).toEqual([
        "https://app.example.com",
        "https://admin.example.com",
      ]);
    });

    test("a blank pinnedServiceName resolves to null and a padded one is trimmed", async () => {
      const empty: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        pinnedServiceName: "",
      });

      const whitespace: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        pinnedServiceName: "   ",
      });

      const padded: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        pinnedServiceName: "  checkout-web  ",
      });

      expect(empty.pinnedServiceName).toBeNull();
      expect(whitespace.pinnedServiceName).toBeNull();
      expect(padded.pinnedServiceName).toBe("checkout-web");
    });

    test("a NULL expiresAt means the key never expires", async () => {
      const policy: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ObjectID.generate(),
        projectId: ObjectID.generate(),
        expiresAt: null,
      });

      expect(policy.expiresAt).toBeNull();
    });

    test("a NULL, zero or negative requestsPerMinuteLimit means no explicit limit, never a total block", async () => {
      const noLimitValues: Array<unknown> = [null, undefined, 0, -1, NaN, "50"];

      for (const noLimitValue of noLimitValues) {
        const policy: TelemetryIngestionKeyPolicy = await resolveRow({
          _id: ObjectID.generate(),
          projectId: ObjectID.generate(),
          requestsPerMinuteLimit: noLimitValue,
        });

        expect(policy.requestsPerMinuteLimit).toBeNull();
      }
    });

    test("a row carrying only _id and projectId - exactly a pre-migration row - is a fully populated, unrestricted Server key", async () => {
      const ingestionKeyId: ObjectID = ObjectID.generate();
      const projectId: ObjectID = ObjectID.generate();

      const policy: TelemetryIngestionKeyPolicy = await resolveRow({
        _id: ingestionKeyId,
        projectId: projectId,
      });

      expect(policy).toEqual({
        ingestionKeyId: expect.any(ObjectID),
        projectId: expect.any(ObjectID),
        keyType: TelemetryIngestionKeyType.Server,
        allowedOrigins: [],
        pinnedServiceName: null,
        isEnabled: true,
        expiresAt: null,
        requestsPerMinuteLimit: null,
      });

      expect(policy.ingestionKeyId.toString()).toBe(ingestionKeyId.toString());
      expect(policy.projectId.toString()).toBe(projectId.toString());
    });
  });

  describe("resolution and caching", () => {
    test("a known token resolves to a policy carrying its project and key id", async () => {
      const token: string = ObjectID.generate().toString();
      const ingestionKeyId: ObjectID = ObjectID.generate();
      const projectId: ObjectID = ObjectID.generate();

      installRows({
        [token]: {
          _id: ingestionKeyId,
          projectId: projectId,
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: ["https://app.example.com"],
          pinnedServiceName: "checkout-web",
          isEnabled: true,
          requestsPerMinuteLimit: 120,
        },
      });

      const policy: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(token);

      expect(policy).not.toBeNull();
      expect(policy!.ingestionKeyId.toString()).toBe(ingestionKeyId.toString());
      expect(policy!.projectId.toString()).toBe(projectId.toString());
      expect(policy!.keyType).toBe(TelemetryIngestionKeyType.Browser);
      expect(policy!.allowedOrigins).toEqual(["https://app.example.com"]);
      expect(policy!.pinnedServiceName).toBe("checkout-web");
      expect(policy!.requestsPerMinuteLimit).toBe(120);
    });

    test("a token that is not a UUID is refused without ever reaching the database, and the refusal is cached", async () => {
      const malformedToken: string = "not-a-uuid-just-junk-from-the-internet";
      const findOneByMock: MockFn = installRows({});

      const first: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(
          malformedToken,
        );
      const second: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(
          malformedToken,
        );

      expect(first).toBeNull();
      expect(second).toBeNull();

      /*
       * Junk tokens arrive in volume - this endpoint is public - and must not
       * turn into a Postgres query each.
       */
      expect(findOneByMock).not.toHaveBeenCalled();
      expect(policyCacheKeys()).toContain(hashOf(malformedToken));
    });

    test("a well-formed token with no matching row is negative cached, so a flood of dead keys queries once each", async () => {
      const unknownToken: string = ObjectID.generate().toString();
      const findOneByMock: MockFn = installRows({});

      const first: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(unknownToken);
      const second: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(unknownToken);

      expect(first).toBeNull();
      expect(second).toBeNull();
      expect(findOneByMock).toHaveBeenCalledTimes(1);
    });

    test("a resolved key is cached: repeated ingest requests query the database once", async () => {
      const token: string = ObjectID.generate().toString();
      const findOneByMock: MockFn = installRows({
        [token]: {
          _id: ObjectID.generate(),
          projectId: ObjectID.generate(),
        },
      });

      for (let attempt: number = 0; attempt < 5; attempt++) {
        const policy: TelemetryIngestionKeyPolicy | null =
          await TelemetryIngestionKeyService.getPolicyFromSecretKey(token);
        expect(policy).not.toBeNull();
      }

      expect(findOneByMock).toHaveBeenCalledTimes(1);
    });

    test("the cache is keyed on a hash of the token, so no live secret is left sitting in a map key", async () => {
      const token: string = ObjectID.generate().toString();
      installRows({
        [token]: {
          _id: ObjectID.generate(),
          projectId: ObjectID.generate(),
        },
      });

      await TelemetryIngestionKeyService.getPolicyFromSecretKey(token);

      const keys: Array<string> = policyCacheKeys();

      expect(keys).toContain(hashOf(token));

      const keyLeakingTheToken: string | undefined = keys.find(
        (key: string): boolean => {
          return key.includes(token);
        },
      );

      expect(keyLeakingTheToken).toBeUndefined();
    });

    test("two different tokens get two different policies and do not collide in the cache", async () => {
      const firstToken: string = ObjectID.generate().toString();
      const secondToken: string = ObjectID.generate().toString();
      const firstProjectId: ObjectID = ObjectID.generate();
      const secondProjectId: ObjectID = ObjectID.generate();

      const findOneByMock: MockFn = installRows({
        [firstToken]: {
          _id: ObjectID.generate(),
          projectId: firstProjectId,
        },
        [secondToken]: {
          _id: ObjectID.generate(),
          projectId: secondProjectId,
        },
      });

      const firstPolicy: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(firstToken);
      const secondPolicy: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(secondToken);
      const firstPolicyAgain: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(firstToken);

      expect(firstPolicy!.projectId.toString()).toBe(firstProjectId.toString());
      expect(secondPolicy!.projectId.toString()).toBe(
        secondProjectId.toString(),
      );
      expect(firstPolicyAgain!.projectId.toString()).toBe(
        firstProjectId.toString(),
      );

      // One query per distinct token; the repeat of the first is a cache hit.
      expect(findOneByMock).toHaveBeenCalledTimes(2);
    });

    test("a cache HIT returns live ObjectIDs and a real Date, not the strings the snapshot stores", async () => {
      /*
       * The cache holds primitives so it cannot be mutated through, which
       * means every hit has to rehydrate. If it ever stopped, the middleware's
       * policy.expiresAt.getTime() would throw - but only after the first
       * request on a pod, which is the worst possible time to find out.
       */
      const token: string = ObjectID.generate().toString();
      const expiresAt: Date = new Date(Date.now() + 60 * 60 * 1000);
      const findOneByMock: MockFn = installRows({
        [token]: {
          _id: ObjectID.generate(),
          projectId: ObjectID.generate(),
          expiresAt: expiresAt,
        },
      });

      await TelemetryIngestionKeyService.getPolicyFromSecretKey(token);

      const cachedPolicy: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(token);

      expect(findOneByMock).toHaveBeenCalledTimes(1);
      expect(cachedPolicy).not.toBeNull();
      expect(cachedPolicy!.ingestionKeyId).toBeInstanceOf(ObjectID);
      expect(cachedPolicy!.projectId).toBeInstanceOf(ObjectID);
      expect(cachedPolicy!.expiresAt).toBeInstanceOf(Date);
      expect(cachedPolicy!.expiresAt!.getTime()).toBe(expiresAt.getTime());
    });

    test("mutating a returned policy cannot poison the policy the next caller gets", async () => {
      const token: string = ObjectID.generate().toString();
      installRows({
        [token]: {
          _id: ObjectID.generate(),
          projectId: ObjectID.generate(),
          keyType: TelemetryIngestionKeyType.Browser,
          allowedOrigins: ["https://app.example.com"],
        },
      });

      const firstPolicy: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(token);

      // An attacker-shaped mutation: widen the allowlist on the shared entry.
      firstPolicy!.allowedOrigins.push("https://evil.example.com");
      firstPolicy!.allowedOrigins[0] = "https://evil.example.com";

      const secondPolicy: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(token);

      expect(secondPolicy!.allowedOrigins).toEqual(["https://app.example.com"]);
      expect(secondPolicy!.allowedOrigins).not.toBe(
        firstPolicy!.allowedOrigins,
      );
    });

    test("getProjectIdFromSecretKey answers for a DISABLED key - it is a lookup, not a decision", async () => {
      const token: string = ObjectID.generate().toString();
      const projectId: ObjectID = ObjectID.generate();

      installRows({
        [token]: {
          _id: ObjectID.generate(),
          projectId: projectId,
          isEnabled: false,
        },
      });

      const resolvedProjectId: ObjectID | null =
        await TelemetryIngestionKeyService.getProjectIdFromSecretKey(token);

      expect(resolvedProjectId).not.toBeNull();
      expect(resolvedProjectId!.toString()).toBe(projectId.toString());
    });

    test("getProjectIdFromSecretKey answers for an EXPIRED key - the four callers refuse it themselves, by surface", async () => {
      const token: string = ObjectID.generate().toString();
      const projectId: ObjectID = ObjectID.generate();

      installRows({
        [token]: {
          _id: ObjectID.generate(),
          projectId: projectId,
          expiresAt: new Date(Date.now() - 60 * 60 * 1000),
        },
      });

      const resolvedProjectId: ObjectID | null =
        await TelemetryIngestionKeyService.getProjectIdFromSecretKey(token);

      expect(resolvedProjectId).not.toBeNull();
      expect(resolvedProjectId!.toString()).toBe(projectId.toString());
    });

    test("getProjectIdFromSecretKey still returns null for an unknown token", async () => {
      const unknownToken: string = ObjectID.generate().toString();
      installRows({});

      const resolvedProjectId: ObjectID | null =
        await TelemetryIngestionKeyService.getProjectIdFromSecretKey(
          unknownToken,
        );

      expect(resolvedProjectId).toBeNull();
    });
  });

  describe("markUsed", () => {
    const installWriteMocks: () => {
      write: MockFn;
      hookedUpdateOneById: MockFn;
      hookedUpdateBy: MockFn;
    } = (): {
      write: MockFn;
      hookedUpdateOneById: MockFn;
      hookedUpdateBy: MockFn;
    } => {
      const write: MockFn = jest.fn().mockResolvedValue(undefined);
      const hookedUpdateOneById: MockFn = jest
        .fn()
        .mockResolvedValue(undefined);
      const hookedUpdateBy: MockFn = jest.fn().mockResolvedValue(undefined);

      internals().updateColumnsByIdWithoutHooks = write;
      internals().updateOneById = hookedUpdateOneById;
      internals().updateBy = hookedUpdateBy;

      return {
        write: write,
        hookedUpdateOneById: hookedUpdateOneById,
        hookedUpdateBy: hookedUpdateBy,
      };
    };

    test("the first use stamps lastUsedAt without hooks and without touching updatedAt", async () => {
      const ingestionKeyId: ObjectID = ObjectID.generate();
      const { write } = installWriteMocks();

      await TelemetryIngestionKeyService.markUsed(ingestionKeyId);

      expect(write).toHaveBeenCalledTimes(1);

      const writeArgument: {
        id: ObjectID;
        data: { lastUsedAt: Date };
        skipUpdateDateColumn: boolean;
      } = write.mock.calls[0]![0] as {
        id: ObjectID;
        data: { lastUsedAt: Date };
        skipUpdateDateColumn: boolean;
      };

      expect(writeArgument.id.toString()).toBe(ingestionKeyId.toString());
      expect(writeArgument.data.lastUsedAt).toBeInstanceOf(Date);
      expect(writeArgument.skipUpdateDateColumn).toBe(true);
    });

    test("a second use of the same key inside the window issues no write at all", async () => {
      const ingestionKeyId: ObjectID = ObjectID.generate();
      const { write } = installWriteMocks();

      await TelemetryIngestionKeyService.markUsed(ingestionKeyId);
      await TelemetryIngestionKeyService.markUsed(ingestionKeyId);
      await TelemetryIngestionKeyService.markUsed(ingestionKeyId);

      /*
       * Ingest runs this thousands of times a second per key. One UPDATE per
       * key per five minutes is the whole point; a per-request UPDATE on the
       * same row is a lock convoy.
       */
      expect(write).toHaveBeenCalledTimes(1);
    });

    test("two different keys each get their own stamp", async () => {
      const firstKeyId: ObjectID = ObjectID.generate();
      const secondKeyId: ObjectID = ObjectID.generate();
      const { write } = installWriteMocks();

      await TelemetryIngestionKeyService.markUsed(firstKeyId);
      await TelemetryIngestionKeyService.markUsed(secondKeyId);

      expect(write).toHaveBeenCalledTimes(2);

      const stampedIds: Array<string> = write.mock.calls.map(
        (call: Array<unknown>): string => {
          return (call[0] as { id: ObjectID }).id.toString();
        },
      );

      expect(stampedIds).toEqual([
        firstKeyId.toString(),
        secondKeyId.toString(),
      ]);
    });

    test("a failed stamp is swallowed - a bookkeeping write must never reject accepted telemetry", async () => {
      const ingestionKeyId: ObjectID = ObjectID.generate();
      const { write } = installWriteMocks();
      write.mockRejectedValue(new Error("connection terminated unexpectedly"));

      await expect(
        TelemetryIngestionKeyService.markUsed(ingestionKeyId),
      ).resolves.toBeUndefined();
    });

    test("stamping a key does not invalidate its cached policy", async () => {
      const token: string = ObjectID.generate().toString();
      const ingestionKeyId: ObjectID = ObjectID.generate();
      const findOneByMock: MockFn = installRows({
        [token]: {
          _id: ingestionKeyId,
          projectId: ObjectID.generate(),
        },
      });
      const { write, hookedUpdateOneById, hookedUpdateBy } =
        installWriteMocks();

      await TelemetryIngestionKeyService.getPolicyFromSecretKey(token);
      await TelemetryIngestionKeyService.markUsed(ingestionKeyId);

      const policyAfterStamp: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(token);

      expect(policyAfterStamp).not.toBeNull();
      expect(write).toHaveBeenCalledTimes(1);

      /*
       * A hooked write would run onBeforeUpdate, which clears the whole
       * policy cache - so every key on the pod would go back to Postgres
       * every five minutes because of a column nobody reads.
       */
      expect(hookedUpdateOneById).not.toHaveBeenCalled();
      expect(hookedUpdateBy).not.toHaveBeenCalled();
      expect(findOneByMock).toHaveBeenCalledTimes(1);
    });
  });
});
