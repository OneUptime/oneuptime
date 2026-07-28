import attachTelemetryLabels, {
  TELEMETRY_AUTO_LABEL_CACHE_NAMESPACE,
  fingerprintLabelIds,
} from "../../../Server/Utils/Telemetry/TelemetryAutoLabels";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import Host from "../../../Models/DatabaseModels/Host";
import Label from "../../../Models/DatabaseModels/Label";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, beforeEach, jest } from "@jest/globals";

/*
 * Regression suite for "removing labels in bulk doesn't stick".
 *
 * Labels derived from `oneuptime.label.*` OTel resource attributes used to be
 * re-attached on every ingest batch, guarded only by a 60 second cache. A
 * user removing a label - one at a time or through the bulk "Remove Labels"
 * action - saw the operation report success and then watched the labels come
 * back within a minute, because the next batch re-applied every declared
 * label that was not currently on the resource.
 *
 * Ingest now applies a declared label ONCE and records it in
 * `telemetryAppliedLabelIds`. These tests pin that contract.
 */

const LABEL_A: string = "11111111-1111-4111-8111-111111111111";
const LABEL_B: string = "22222222-2222-4222-8222-222222222222";
const LABEL_C: string = "33333333-3333-4333-8333-333333333333";
const HOST_ID: string = "99999999-9999-4999-8999-999999999999";

interface FakeService {
  service: DatabaseService<Host>;
  /** Labels currently attached to the resource (the join table). */
  attachedLabelIds: Array<string>;
  /** Label ids passed to the junction `.add()` call, if any. */
  addedLabelIds: Array<string>;
  addCallCount: number;
  loadManyCallCount: number;
  /** Payloads passed to updateColumnsByIdWithoutHooks. */
  persistedMemos: Array<Array<string> | undefined>;
  /** The stored memo column value. */
  memo: Array<string> | null;
  setAddToThrow: (shouldThrow: boolean) => void;
}

function buildFakeService(options: {
  memo: Array<string> | null;
  attachedLabelIds: Array<string>;
  resourceExists?: boolean | undefined;
}): FakeService {
  const state: {
    memo: Array<string> | null;
    attachedLabelIds: Array<string>;
    addedLabelIds: Array<string>;
    addCallCount: number;
    loadManyCallCount: number;
    persistedMemos: Array<Array<string> | undefined>;
    addThrows: boolean;
  } = {
    memo: options.memo,
    attachedLabelIds: [...options.attachedLabelIds],
    addedLabelIds: [],
    addCallCount: 0,
    loadManyCallCount: 0,
    persistedMemos: [],
    addThrows: false,
  };

  const relationBuilder: {
    relation: () => typeof relationBuilder;
    of: () => typeof relationBuilder;
    loadMany: () => Promise<Array<Label>>;
    add: (ids: Array<string>) => Promise<void>;
  } = {
    relation: () => {
      return relationBuilder;
    },
    of: () => {
      return relationBuilder;
    },
    loadMany: async (): Promise<Array<Label>> => {
      state.loadManyCallCount++;
      return state.attachedLabelIds.map((id: string) => {
        const label: Label = new Label();
        label._id = id;
        return label;
      });
    },
    add: async (ids: Array<string>): Promise<void> => {
      state.addCallCount++;
      if (state.addThrows) {
        throw new Error("junction insert conflict");
      }
      state.addedLabelIds.push(...ids);
      state.attachedLabelIds.push(...ids);
    },
  };

  const service: unknown = {
    getRepository: () => {
      return {
        metadata: { tableName: "Host" },
        createQueryBuilder: () => {
          return relationBuilder;
        },
      };
    },
    findOneById: async (): Promise<Host | null> => {
      if (options.resourceExists === false) {
        return null;
      }
      const host: Host = new Host();
      host._id = HOST_ID;
      if (state.memo !== null) {
        host.telemetryAppliedLabelIds = [...state.memo];
      }
      return host;
    },
    updateColumnsByIdWithoutHooks: async (input: {
      data: { telemetryAppliedLabelIds?: Array<string> };
    }): Promise<void> => {
      state.persistedMemos.push(input.data.telemetryAppliedLabelIds);
      state.memo = input.data.telemetryAppliedLabelIds
        ? [...input.data.telemetryAppliedLabelIds]
        : null;
    },
  };

  return {
    service: service as DatabaseService<Host>,
    get attachedLabelIds(): Array<string> {
      return state.attachedLabelIds;
    },
    get addedLabelIds(): Array<string> {
      return state.addedLabelIds;
    },
    get addCallCount(): number {
      return state.addCallCount;
    },
    get loadManyCallCount(): number {
      return state.loadManyCallCount;
    },
    get persistedMemos(): Array<Array<string> | undefined> {
      return state.persistedMemos;
    },
    get memo(): Array<string> | null {
      return state.memo;
    },
    setAddToThrow: (shouldThrow: boolean): void => {
      state.addThrows = shouldThrow;
    },
  };
}

function attach(fake: FakeService, labelIds: Array<string>): Promise<void> {
  return attachTelemetryLabels<Host>({
    service: fake.service,
    modelType: Host,
    resourceId: new ObjectID(HOST_ID),
    labelIds: labelIds.map((id: string) => {
      return new ObjectID(id);
    }),
  });
}

describe("attachTelemetryLabels", () => {
  let cache: Record<string, string>;

  beforeEach(() => {
    jest.restoreAllMocks();
    cache = {};

    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (namespace: string, key: string) => {
        return cache[`${namespace}:${key}`] ?? null;
      });

    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          cache[`${namespace}:${key}`] = value;
        },
      );
  });

  describe("the bulk-removal regression", () => {
    /*
     * THE bug from the customer recording: 21 hosts, bulk "Remove Labels" of
     * team:SharedServices-Prod, "21 Hosts succeeded", label back on several
     * hosts within a minute. The collector never stopped declaring the label,
     * so the next batch re-applied it.
     */
    test("does not re-attach a label the user removed while telemetry keeps declaring it", async () => {
      const fake: FakeService = buildFakeService({
        // Ingest already applied all three labels...
        memo: [LABEL_A, LABEL_B, LABEL_C],
        // ...and the user has since removed LABEL_C in the UI.
        attachedLabelIds: [LABEL_A, LABEL_B],
      });

      // The collector still declares all three, batch after batch.
      await attach(fake, [LABEL_A, LABEL_B, LABEL_C]);
      await attach(fake, [LABEL_A, LABEL_B, LABEL_C]);
      await attach(fake, [LABEL_A, LABEL_B, LABEL_C]);

      expect(fake.attachedLabelIds).toEqual([LABEL_A, LABEL_B]);
      expect(fake.addCallCount).toBe(0);
    });

    test("removal sticks even when the cache is cold on every batch", async () => {
      const fake: FakeService = buildFakeService({
        memo: [LABEL_A, LABEL_C],
        attachedLabelIds: [LABEL_A],
      });

      // Simulate the cache expiring (or Redis being unavailable) each time.
      jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);

      await attach(fake, [LABEL_A, LABEL_C]);
      await attach(fake, [LABEL_A, LABEL_C]);

      expect(fake.attachedLabelIds).toEqual([LABEL_A]);
      expect(fake.addCallCount).toBe(0);
    });

    test("removal sticks when the cache read throws", async () => {
      const fake: FakeService = buildFakeService({
        memo: [LABEL_A, LABEL_C],
        attachedLabelIds: [LABEL_A],
      });

      jest
        .spyOn(GlobalCache, "getString")
        .mockRejectedValue(new Error("redis down"));

      await attach(fake, [LABEL_A, LABEL_C]);

      expect(fake.addCallCount).toBe(0);
    });
  });

  describe("the customer's recording, replayed", () => {
    /*
     * 21 hosts, each carrying env:production, serverType:application,
     * team:axxos and team:SharedServices-Prod. The user selects all 21 and
     * bulk-removes team:SharedServices-Prod. Every collector keeps declaring
     * all four labels. Before the fix, the removed label reappeared on host
     * after host as each one's 60 second cache entry expired.
     */
    test("a bulk removal across many hosts is not undone by the next batches", async () => {
      const hosts: Array<FakeService> = [];

      for (let index: number = 0; index < 21; index++) {
        hosts.push(
          buildFakeService({
            memo: [LABEL_A, LABEL_B, LABEL_C],
            attachedLabelIds: [LABEL_A, LABEL_B, LABEL_C],
          }),
        );
      }

      // The bulk action removes LABEL_C from every host.
      for (const host of hosts) {
        host.attachedLabelIds.splice(host.attachedLabelIds.indexOf(LABEL_C), 1);
      }

      // Several ingest batches land, each with a cold cache.
      for (let batch: number = 0; batch < 3; batch++) {
        cache = {};
        for (const host of hosts) {
          await attach(host, [LABEL_A, LABEL_B, LABEL_C]);
        }
      }

      for (const host of hosts) {
        expect(host.attachedLabelIds).toEqual([LABEL_A, LABEL_B]);
      }
    });
  });

  describe("first sight of a resource", () => {
    test("attaches every declared label when the memo is empty", async () => {
      const fake: FakeService = buildFakeService({
        memo: null,
        attachedLabelIds: [],
      });

      await attach(fake, [LABEL_A, LABEL_B]);

      expect(fake.addedLabelIds.sort()).toEqual([LABEL_A, LABEL_B].sort());
      expect(fake.memo?.sort()).toEqual([LABEL_A, LABEL_B].sort());
    });

    /*
     * Rows that predate the memo column are NULL. The first batch after the
     * upgrade must not re-apply labels that are already on the resource, and
     * must seed the memo so later removals stick.
     */
    test("seeds the memo without duplicating labels already on the resource", async () => {
      const fake: FakeService = buildFakeService({
        memo: null,
        attachedLabelIds: [LABEL_A, LABEL_B],
      });

      await attach(fake, [LABEL_A, LABEL_B]);

      expect(fake.addCallCount).toBe(0);
      expect(fake.memo?.sort()).toEqual([LABEL_A, LABEL_B].sort());
    });

    test("a removal made after that first batch sticks", async () => {
      const fake: FakeService = buildFakeService({
        memo: null,
        attachedLabelIds: [LABEL_A, LABEL_B],
      });

      await attach(fake, [LABEL_A, LABEL_B]);

      // User removes LABEL_B in the UI.
      fake.attachedLabelIds.splice(fake.attachedLabelIds.indexOf(LABEL_B), 1);
      cache = {};

      await attach(fake, [LABEL_A, LABEL_B]);

      expect(fake.attachedLabelIds).toEqual([LABEL_A]);
      expect(fake.addCallCount).toBe(0);
    });
  });

  describe("telemetry declaration changes", () => {
    test("attaches a label newly added to the collector config", async () => {
      const fake: FakeService = buildFakeService({
        memo: [LABEL_A],
        attachedLabelIds: [LABEL_A],
      });

      await attach(fake, [LABEL_A, LABEL_B]);

      expect(fake.addedLabelIds).toEqual([LABEL_B]);
      expect(fake.memo?.sort()).toEqual([LABEL_A, LABEL_B].sort());
    });

    test("only the newly declared label is attached, not the whole set", async () => {
      const fake: FakeService = buildFakeService({
        memo: [LABEL_A, LABEL_B],
        // The user removed LABEL_B; the collector now also declares LABEL_C.
        attachedLabelIds: [LABEL_A],
      });

      await attach(fake, [LABEL_A, LABEL_B, LABEL_C]);

      expect(fake.addedLabelIds).toEqual([LABEL_C]);
      expect(fake.attachedLabelIds).toEqual([LABEL_A, LABEL_C]);
    });

    test("a label telemetry stops declaring drops out of the memo but stays on the resource", async () => {
      const fake: FakeService = buildFakeService({
        memo: [LABEL_A, LABEL_B],
        attachedLabelIds: [LABEL_A, LABEL_B],
      });

      await attach(fake, [LABEL_A]);

      expect(fake.attachedLabelIds).toEqual([LABEL_A, LABEL_B]);
      expect(fake.memo).toEqual([LABEL_A]);
    });

    test("re-declaring a label telemetry had dropped attaches it again", async () => {
      const fake: FakeService = buildFakeService({
        memo: [LABEL_A, LABEL_B],
        attachedLabelIds: [LABEL_A, LABEL_B],
      });

      // Collector drops LABEL_B...
      await attach(fake, [LABEL_A]);
      // ...the user removes it...
      fake.attachedLabelIds.splice(fake.attachedLabelIds.indexOf(LABEL_B), 1);
      cache = {};
      // ...and then it is put back in the collector config.
      await attach(fake, [LABEL_A, LABEL_B]);

      expect(fake.addedLabelIds).toEqual([LABEL_B]);
    });
  });

  describe("steady state", () => {
    test("does nothing and writes nothing when the declaration is unchanged", async () => {
      const fake: FakeService = buildFakeService({
        memo: [LABEL_A, LABEL_B],
        attachedLabelIds: [LABEL_A, LABEL_B],
      });

      await attach(fake, [LABEL_A, LABEL_B]);

      expect(fake.addCallCount).toBe(0);
      expect(fake.persistedMemos).toEqual([]);
    });

    test("does not rewrite the memo when only the declaration order changes", async () => {
      const fake: FakeService = buildFakeService({
        memo: [LABEL_A, LABEL_B],
        attachedLabelIds: [LABEL_A, LABEL_B],
      });

      await attach(fake, [LABEL_B, LABEL_A]);

      expect(fake.persistedMemos).toEqual([]);
    });

    test("the cache fast path skips the database entirely", async () => {
      const fake: FakeService = buildFakeService({
        memo: [LABEL_A],
        attachedLabelIds: [LABEL_A],
      });

      const cacheKey: string = `${TELEMETRY_AUTO_LABEL_CACHE_NAMESPACE}:Host:${HOST_ID}`;
      cache[cacheKey] = fingerprintLabelIds([new ObjectID(LABEL_A)]);

      await attach(fake, [LABEL_A]);

      expect(fake.loadManyCallCount).toBe(0);
      expect(fake.persistedMemos).toEqual([]);
    });
  });

  describe("input handling", () => {
    test("does nothing when no labels are declared", async () => {
      const fake: FakeService = buildFakeService({
        memo: [LABEL_A],
        attachedLabelIds: [LABEL_A],
      });

      await attach(fake, []);

      expect(fake.loadManyCallCount).toBe(0);
      expect(fake.persistedMemos).toEqual([]);
    });

    test("dedupes repeated label ids in one declaration", async () => {
      const fake: FakeService = buildFakeService({
        memo: null,
        attachedLabelIds: [],
      });

      await attach(fake, [LABEL_A, LABEL_A, LABEL_B]);

      expect(fake.addedLabelIds).toEqual([LABEL_A, LABEL_B]);
      expect(fake.memo).toEqual([LABEL_A, LABEL_B]);
    });

    test("does nothing when the resource no longer exists", async () => {
      const fake: FakeService = buildFakeService({
        memo: null,
        attachedLabelIds: [],
        resourceExists: false,
      });

      await attach(fake, [LABEL_A]);

      expect(fake.addCallCount).toBe(0);
      expect(fake.persistedMemos).toEqual([]);
    });
  });

  describe("failure handling", () => {
    test("a junction insert conflict is swallowed so ingest keeps running", async () => {
      const fake: FakeService = buildFakeService({
        memo: null,
        attachedLabelIds: [],
      });
      fake.setAddToThrow(true);

      await expect(attach(fake, [LABEL_A])).resolves.toBeUndefined();
    });

    test("a failed batch does not record the labels as applied", async () => {
      const fake: FakeService = buildFakeService({
        memo: null,
        attachedLabelIds: [],
      });
      fake.setAddToThrow(true);

      await attach(fake, [LABEL_A]);

      /*
       * The memo must not advance past a failed attach, otherwise the label
       * would be treated as applied and never retried.
       */
      expect(fake.persistedMemos).toEqual([]);
      expect(fake.memo).toBeNull();
    });
  });
});

describe("fingerprintLabelIds", () => {
  test("is order independent", () => {
    expect(
      fingerprintLabelIds([new ObjectID(LABEL_A), new ObjectID(LABEL_B)]),
    ).toBe(fingerprintLabelIds([new ObjectID(LABEL_B), new ObjectID(LABEL_A)]));
  });

  test("differs when the declared set differs", () => {
    expect(fingerprintLabelIds([new ObjectID(LABEL_A)])).not.toBe(
      fingerprintLabelIds([new ObjectID(LABEL_A), new ObjectID(LABEL_B)]),
    );
  });
});
