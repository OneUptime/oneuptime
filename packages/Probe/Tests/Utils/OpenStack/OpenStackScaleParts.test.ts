import { describe, expect, test } from "@jest/globals";
import { seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { OpenStackCollectionReport } from "Common/Types/OpenStack/OpenStackProbeCollection";
import OpenStackCollectorMemory from "../../../Utils/OpenStack/OpenStackCollectorMemory";
import OpenStackReadTurns, {
  takeReadTurn,
} from "../../../Utils/OpenStack/OpenStackReadTurns";
import {
  splitOpenStackReport,
  splitOpenStackResourceMetrics,
} from "../../../Utils/OpenStack/OpenStackReportParts";
import OpenStackRollingSend, {
  OpenStackRollingState,
  createOpenStackRollingState,
  getsToVouchForRows,
  startOpenStackRollingCycle,
  stopOpenStackRollingCycle,
} from "../../../Utils/OpenStack/OpenStackRollingSend";
import OpenStackOtlpBuilder from "../../../Utils/OpenStack/OpenStackOtlpBuilder";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";

/*
 * The parts a large cloud's collection is made of, each on its own: reads in turns, what goes in
 * an upload, and an upload that fits.
 */

describe("reads in turns", () => {
  test("up to the limit, every one of them, every time", () => {
    expect(takeReadTurn({ items: [1, 2, 3], limit: 3, cursor: 2 })).toEqual({
      turn: [1, 2, 3],
      nextCursor: 0,
    });
  });

  test("past it, the next few, going round", () => {
    const items: Array<number> = [0, 1, 2, 3, 4];

    expect(takeReadTurn({ items, limit: 2, cursor: 0 })).toEqual({
      turn: [0, 1],
      nextCursor: 2,
    });
    expect(takeReadTurn({ items, limit: 2, cursor: 4 })).toEqual({
      turn: [4, 0],
      nextCursor: 1,
    });
  });

  test("a cloud that shrank does not stop the turn", () => {
    expect(takeReadTurn({ items: [0, 1, 2], limit: 2, cursor: 7 })).toEqual({
      turn: [1, 2],
      nextCursor: 0,
    });
  });

  function readTurns(): OpenStackReadTurns<string> {
    return new OpenStackReadTurns<string>({
      memory: memory,
      memoryKey: "turns",
      now: 1000,
    });
  }

  const memory: OpenStackCollectorMemory = new OpenStackCollectorMemory();
  const idOf: (item: string) => string = (item: string): string => {
    return item;
  };

  test("what was not read this time stands as it was read, so no series has a gap", async () => {
    const items: Array<string> = ["a", "b", "c"];
    const asked: Array<string> = [];
    const read: (item: string) => Promise<string> = async (
      item: string,
    ): Promise<string> => {
      asked.push(item);
      return `${item}-${asked.length}`;
    };

    const first: OpenStackReadTurns<string> = readTurns();
    await first.read({ items, limit: 2, idOf, read });
    expect(asked).toEqual(["a", "b"]);
    expect(first.getRecords({ items, idOf })).toEqual(["a-1", "b-2"]);

    const second: OpenStackReadTurns<string> = readTurns();
    await second.read({ items, limit: 2, idOf, read });
    expect(asked).toEqual(["a", "b", "c", "a"]);
    expect(second.getRecords({ items, idOf })).toEqual(["a-4", "b-2", "c-3"]);
  });

  test("a part that has gone is forgotten, and one that failed halfway keeps what came before", async () => {
    const own: OpenStackCollectorMemory = new OpenStackCollectorMemory();
    const turns: OpenStackReadTurns<string> = new OpenStackReadTurns<string>({
      memory: own,
      memoryKey: "turns",
      now: 1000,
    });

    await expect(
      turns.read({
        items: ["a", "b", "c"],
        limit: 3,
        idOf,
        read: async (item: string): Promise<string> => {
          if (item === "b") {
            throw new Error("refused");
          }
          return item;
        },
      }),
    ).rejects.toThrow("refused");

    expect(turns.getRecords({ items: ["a", "b", "c"], idOf })).toEqual(["a"]);
    // Asked about without it, "a" is forgotten and no longer held in memory.
    expect(turns.getRecords({ items: ["c"], idOf })).toEqual([]);
    expect(turns.getRecords({ items: ["a"], idOf })).toEqual([]);
  });
});

describe("what goes in an upload, past the summary size", () => {
  const INTERVAL_IN_MS: number = 2 * 60_000;
  const STARTED_AT: number = Date.parse("2026-11-04T00:00:00.000Z");

  // A collection every two minutes, on a state of its own.
  interface Collections {
    state: OpenStackRollingState;
    now: () => number;
    // The next collection's gate, a whole cycle's worth of turns of them.
    next: (turns?: number) => OpenStackRollingSend;
    // The time moved on with nothing read: a collection that failed or was never made.
    miss: (collections?: number) => void;
  }

  function collections(
    defaultTurns: number = 4,
    keptProjectIds: Array<string> = [],
  ): Collections {
    const state: OpenStackRollingState = createOpenStackRollingState();
    let at: number = STARTED_AT - INTERVAL_IN_MS;

    return {
      state: state,
      now: (): number => {
        return at;
      },
      next: (turns: number = defaultTurns): OpenStackRollingSend => {
        at += INTERVAL_IN_MS;
        startOpenStackRollingCycle({
          state: state,
          now: at,
          turns: turns,
          collectionIntervalInMs: INTERVAL_IN_MS,
        });

        return new OpenStackRollingSend({
          state: state,
          now: at,
          keptProjectIds: keptProjectIds,
        });
      },
      miss: (missed: number = 1): void => {
        at += missed * INTERVAL_IN_MS;
      },
    };
  }

  const IDS: Array<string> = Array.from(
    { length: 2000 },
    (_v: unknown, i: number) => {
      return `s-${i}`;
    },
  );
  const SUBNET: string = "openstack_neutron_subnet";

  function sentBy(
    send: OpenStackRollingSend,
    ids: ReadonlyArray<string> = IDS,
    metric: string = SUBNET,
  ): Array<string> {
    return ids.filter((id: string): boolean => {
      return send.shouldSend(metric, { id }, 1);
    });
  }

  test("a series that is no part's goes every time", () => {
    const send: OpenStackRollingSend = collections().next();

    expect(send.shouldSend("openstack_nova_agent_state", {}, 1)).toBe(true);
    expect(send.shouldSend("openstack_nova_up", {}, 1)).toBe(true);
    expect(send.shouldSend("openstack_placement_resource_usage", {}, 1)).toBe(
      true,
    );
    expect(
      send.shouldSend(
        "openstack_neutron_network_ip_availabilities_used",
        {},
        1,
      ),
    ).toBe(true);
  });

  test("the first cycle sends each part once, at its own moment, a share each time", () => {
    const cloud: Collections = collections(7);
    const seen: Map<string, number> = new Map();
    let largest: number = 0;

    for (let collection: number = 0; collection < 7; collection++) {
      const sent: Array<string> = sentBy(cloud.next());

      largest = Math.max(largest, sent.length);

      for (const id of sent) {
        seen.set(id, (seen.get(id) || 0) + 1);
      }
    }

    expect(seen.size).toBe(IDS.length);
    expect(Array.from(seen.values()).every((times: number) => times === 1)).toBe(
      true,
    );
    // About a seventh each, the first collection included.
    expect(largest).toBeLessThan((IDS.length / 7) * 1.5);
  });

  test("a part that only appears after the first cycle goes at once, and then in its turn", () => {
    const cloud: Collections = collections(4);

    for (let collection: number = 0; collection < 4; collection++) {
      sentBy(cloud.next(), ["s-1"]);
    }

    expect(sentBy(cloud.next(), ["brand-new"])).toEqual(["brand-new"]);

    let again: number = 0;

    for (let collection: number = 0; collection < 4; collection++) {
      again += sentBy(cloud.next(), ["brand-new"]).length;
    }

    expect(again).toBe(1);
  });

  test("a part that changes goes at once, whoever's turn it is", () => {
    const cloud: Collections = collections(30);
    const metric: string = "openstack_cinder_snapshot_gb";
    const snapshot: (size: number) => boolean = (size: number): boolean => {
      return cloud
        .next()
        .shouldSend(metric, { id: "s-1", status: "available" }, size);
    };

    // Past its moment in the first cycle, whichever that is, and settled.
    for (let collection: number = 0; collection < 31; collection++) {
      snapshot(10);
    }

    expect(snapshot(10)).toBe(false);
    expect(snapshot(20)).toBe(true);
    expect(snapshot(20)).toBe(false);
  });

  test("a part in a state something watches goes every time", () => {
    const cloud: Collections = collections(4);

    for (let turn: number = 0; turn < 8; turn++) {
      const send: OpenStackRollingSend = cloud.next();

      expect(
        send.shouldSend(
          "openstack_cinder_snapshot_gb",
          { id: "s-1", status: "error" },
          1,
        ),
      ).toBe(true);
      expect(
        send.shouldSend(
          "openstack_nova_server_status",
          { id: "i-1", status: "ERROR", tenant_id: "p" },
          4,
        ),
      ).toBe(true);
      expect(
        send.shouldSend(
          "openstack_cinder_volume_gb",
          { id: "v-1", status: "attaching", tenant_id: "p" },
          4,
        ),
      ).toBe(true);
      // What the address pool alert divides by.
      expect(
        send.shouldSend(
          "openstack_neutron_network",
          { id: "n-1", status: "ACTIVE", is_external: "true" },
          0,
        ),
      ).toBe(true);
    }
  });

  test("an instance in a project someone chose goes every time, and others in turns", () => {
    const cloud: Collections = collections(4, ["p-kept"]);
    let others: number = 0;

    for (let turn: number = 0; turn < 8; turn++) {
      const send: OpenStackRollingSend = cloud.next();

      expect(
        send.shouldSend(
          "openstack_nova_server_status",
          { id: "i-kept", status: "ACTIVE", tenant_id: "p-kept" },
          0,
        ),
      ).toBe(true);

      if (
        send.shouldSend(
          "openstack_nova_server_status",
          { id: "i-other", status: "ACTIVE", tenant_id: "p-other" },
          0,
        )
      ) {
        others++;
      }
    }

    // Twice round in eight, whichever moment is its own.
    expect(others).toBe(2);
  });

  test("every part comes round within the cycle, and nothing piles up on one collection", () => {
    const cloud: Collections = collections(7);

    // The first cycle.
    for (let collection: number = 0; collection < 7; collection++) {
      sentBy(cloud.next());
    }

    for (let round: number = 0; round < 3; round++) {
      const seen: Set<string> = new Set();
      let largest: number = 0;

      for (let collection: number = 0; collection < 7; collection++) {
        const sent: Array<string> = sentBy(cloud.next());

        largest = Math.max(largest, sent.length);

        for (const id of sent) {
          expect(seen.has(id)).toBe(false);
          seen.add(id);
        }
      }

      expect(seen.size).toBe(IDS.length);
      expect(largest).toBeLessThan((IDS.length / 7) * 1.5);
    }
  });

  /*
   * What the turns it replaced got wrong. Identity and images are read every second collection, so
   * with an even number of turns half of their parts would never have come round again.
   */
  test.each([2, 3, 4, 7, 8, 22, 30])(
    "what is read every second collection comes round too, in %d turns",
    (turns: number) => {
      const cloud: Collections = collections(turns);
      const lastSentAt: Map<string, number> = new Map();

      for (let collection: number = 0; collection < turns * 4; collection++) {
        const send: OpenStackRollingSend = cloud.next();

        if (collection % 2 !== 0) {
          continue;
        }

        for (const id of sentBy(send)) {
          const before: number | undefined = lastSentAt.get(id);

          if (before !== undefined) {
            // A cycle, and one read's wait.
            expect(collection - before).toBeLessThanOrEqual(turns + 2);
          }

          lastSentAt.set(id, collection);
        }
      }

      expect(lastSentAt.size).toBe(IDS.length);

      for (const id of IDS) {
        expect(lastSentAt.get(id) as number).toBeGreaterThanOrEqual(
          turns * 4 - turns - 2,
        );
      }
    },
  );

  test("a read that fails at a part's moment leaves it due at the next read, not a cycle later", () => {
    const cloud: Collections = collections(10);

    // The first cycle, and nearly all of the second.
    for (let collection: number = 0; collection < 10; collection++) {
      sentBy(cloud.next());
    }

    const held: Array<string> = [];

    for (let collection: number = 0; collection < 3; collection++) {
      held.push(...sentBy(cloud.next()));
    }

    // Three collections go by with nothing read, and what fell due in them all goes on the next.
    cloud.miss(3);

    const overdue: Array<string> = sentBy(cloud.next());

    expect(overdue.length).toBeGreaterThan((IDS.length / 10) * 3);
    expect(overdue.length).toBeLessThan((IDS.length / 10) * 6);

    for (const id of overdue) {
      expect(held).not.toContain(id);
    }

    // Each keeps its own moment, so what was overdue is spread out again afterwards.
    const seen: Set<string> = new Set(overdue);

    for (let collection: number = 0; collection < 6; collection++) {
      for (const id of sentBy(cloud.next())) {
        seen.add(id);
      }
    }

    expect(seen.size).toBeGreaterThan(IDS.length * 0.9);
  });

  test("a part nothing has read for a long time is forgotten, and memory does not grow for ever", () => {
    const cloud: Collections = collections(4);

    for (let collection: number = 0; collection < 4; collection++) {
      sentBy(cloud.next(), ["stays", "goes"]);
    }

    expect(cloud.state.entries.size).toBe(2);

    // Two hours and more of reads that no longer say anything about it.
    for (let collection: number = 0; collection < 130; collection++) {
      sentBy(cloud.next(), ["stays"]);
    }

    expect(Array.from(cloud.state.entries.keys())).toEqual([`${SUBNET}/stays`]);
  });

  describe("what the stale-row rule can be told", () => {
    test("nothing until every row has come round, then every read", () => {
      const cloud: Collections = collections(5);

      for (let collection: number = 0; collection < 5; collection++) {
        cloud.next();
        expect(getsToVouchForRows(cloud.state, cloud.now())).toBe(false);
      }

      cloud.next();
      expect(getsToVouchForRows(cloud.state, cloud.now())).toBe(true);
      cloud.next();
      expect(getsToVouchForRows(cloud.state, cloud.now())).toBe(true);
    });

    test("a cycle that grows goes on vouching, and one that shrinks waits for the old one to come round", () => {
      const cloud: Collections = collections(5);

      for (let collection: number = 0; collection < 5; collection++) {
        cloud.next(5);
      }

      cloud.next(6);
      expect(getsToVouchForRows(cloud.state, cloud.now())).toBe(true);

      cloud.next(2);
      expect(getsToVouchForRows(cloud.state, cloud.now())).toBe(false);

      for (let collection: number = 1; collection < 6; collection++) {
        cloud.next(2);
        expect(getsToVouchForRows(cloud.state, cloud.now())).toBe(false);
      }

      cloud.next(2);
      expect(getsToVouchForRows(cloud.state, cloud.now())).toBe(true);
    });

    test("a cloud that left summary mode sends everything once, and vouches from the next read", () => {
      const cloud: Collections = collections(4);

      for (let collection: number = 0; collection < 5; collection++) {
        cloud.next();
      }

      expect(getsToVouchForRows(cloud.state, cloud.now())).toBe(true);

      cloud.miss();
      stopOpenStackRollingCycle({
        state: cloud.state,
        now: cloud.now(),
        collectionIntervalInMs: INTERVAL_IN_MS,
      });
      expect(getsToVouchForRows(cloud.state, cloud.now())).toBe(false);
      expect(
        getsToVouchForRows(cloud.state, cloud.now() + INTERVAL_IN_MS),
      ).toBe(true);
    });

    test("a probe that never sent in turns has nothing to wait for", () => {
      expect(getsToVouchForRows(undefined, STARTED_AT)).toBe(true);
    });

    /*
     * The rule itself, over everything that can happen to a cloud at random: reads that fail, turns
     * that change, a probe that restarts and forgets everything, each at any moment, at the smallest
     * window the setting allows. The rule measures from the read before the latest, gives a row the
     * window and the last cycle the read named, and every part here is alive throughout.
     */
    const WINDOW_IN_MS: number = 5 * 60_000;

    test.each([1, 2, 3, 4, 5, 6, 7, 8])(
      "a live part is never older than the rule allows, whatever happens: seed %d",
      (seed: number) => {
        const random: ReturnType<typeof seededRandom> = seededRandom(seed);
        const ids: Array<string> = IDS.slice(0, 200);
        const lastSeenAt: Map<string, number> = new Map();

        // What the server holds about the service, each read's time and the cycle it named.
        let latest: { at: number; cycleInMs: number } | null = null;
        let previous: { at: number; cycleInMs: number } | null = null;

        let state: OpenStackRollingState = createOpenStackRollingState();
        let turns: number = 2 + random(10);
        let now: number = STARTED_AT;

        // Everything was seen once by whoever collected it before.
        for (const id of ids) {
          lastSeenAt.set(id, now - random(60) * 60_000);
        }

        for (let step: number = 0; step < 600; step++) {
          now += INTERVAL_IN_MS;

          const roll: number = random(100);

          if (roll < 2) {
            state = createOpenStackRollingState();
          }

          if (roll >= 2 && roll < 6) {
            turns = 1 + random(30);
          }

          startOpenStackRollingCycle({
            state: state,
            now: now,
            turns: turns,
            collectionIntervalInMs: INTERVAL_IN_MS,
          });

          const send: OpenStackRollingSend = new OpenStackRollingSend({
            state: state,
            now: now,
            keptProjectIds: [],
          });

          // A read that failed sends nothing and says down, as isApiUp has it.
          if (random(100) < 15) {
            continue;
          }

          /*
           * The worst order: the read's `up` lands and the sweep runs before its rows do. Only a
           * read that can speak for what it held back moves what the rule measures from.
           */
          if (getsToVouchForRows(state, now)) {
            previous = latest;
            latest = { at: now, cycleInMs: state.cycleInMs };
          }

          if (previous) {
            const cutoff: number =
              previous.at - WINDOW_IN_MS - previous.cycleInMs;

            for (const id of ids) {
              expect(lastSeenAt.get(id) as number).toBeGreaterThanOrEqual(
                cutoff,
              );
            }
          }

          for (const id of sentBy(send, ids)) {
            lastSeenAt.set(id, now);
          }
        }
      },
    );
  });

  test("what is held back still counts as a sample of the scrape, and is not in the upload", () => {
    const cloud: Collections = collections(4);
    const reading: Parameters<typeof OpenStackOtlpBuilder.build>[0][number] = {
      service: OpenStackServiceType.Image,
      regionName: "RegionOne",
      inventory: {
        images: Array.from({ length: 100 }, (_v: unknown, i: number) => {
          return {
            id: `image-${i}`,
            name: `image-${i}`,
            owner: "p",
            imageType: null,
            updatedAt: null,
            createdAt: null,
            visibility: "public",
            isHidden: false,
            status: "active",
            sizeBytes: 1,
          };
        }),
      } as never,
      apiUp: true,
      answered: true,
      observedAt: 1000,
      durationInMs: 1,
      refreshCycleInMinutes: 8,
      doesNotVouchForRows: true,
    };

    const first: ReturnType<typeof OpenStackOtlpBuilder.build> =
      OpenStackOtlpBuilder.build([reading], "test", cloud.next());

    const metrics: Array<JSONObject> = (
      (first.resourceMetrics[0] as JSONObject)[
        "scopeMetrics"
      ] as Array<JSONObject>
    )[0]!["metrics"] as Array<JSONObject>;
    const named: (name: string) => JSONObject | undefined = (
      name: string,
    ): JSONObject | undefined => {
      return metrics.find((metric: JSONObject): boolean => {
        return metric["name"] === name;
      });
    };
    const bytes: JSONObject | undefined = named("openstack_glance_image_bytes");
    const sent: number = bytes
      ? ((bytes["gauge"] as JSONObject)["dataPoints"] as JSONArray).length
      : 0;

    expect(sent).toBeLessThan(100);
    expect(
      (
        (named("scrape_samples_scraped")?.["gauge"] as JSONObject)[
          "dataPoints"
        ] as Array<JSONObject>
      )[0]?.["asDouble"],
    ).toBe(100 + 1 + 1);

    // The stale-row rule is told how long a row can go, and that this read cannot speak for them.
    const up: JSONObject = (
      (named("openstack_glance_up")?.["gauge"] as JSONObject)[
        "dataPoints"
      ] as Array<JSONObject>
    )[0] as JSONObject;

    expect(up["attributes"]).toEqual(
      expect.arrayContaining([
        { key: "refresh_cycle_minutes", value: { stringValue: "8" } },
        { key: "vouches_for_rows", value: { stringValue: "false" } },
      ]),
    );
  });
});

describe("an upload that fits", () => {
  function metric(name: string, points: number): JSONObject {
    return {
      name: name,
      gauge: {
        dataPoints: Array.from({ length: points }, (_v: unknown, i: number) => {
          return {
            attributes: [{ key: "id", value: { stringValue: `id-${i}` } }],
            asDouble: 1,
          };
        }),
      },
    };
  }

  function resource(metrics: Array<JSONObject>): JSONObject {
    return {
      resource: { attributes: [] },
      scopeMetrics: [{ scope: { name: "s" }, metrics: metrics }],
    };
  }

  function countOf(resources: JSONArray, name: string): number {
    let count: number = 0;

    for (const entry of resources as Array<JSONObject>) {
      for (const scope of entry["scopeMetrics"] as Array<JSONObject>) {
        for (const item of scope["metrics"] as Array<JSONObject>) {
          if (item["name"] === name) {
            count += ((item["gauge"] as JSONObject)["dataPoints"] as JSONArray)
              .length;
          }
        }
      }
    }

    return count;
  }

  const REPORT: OpenStackCollectionReport = {
    openStackCloudId: "cloud",
    settingsVersion: 1,
    collectedAt: "2026-11-04T00:00:00.000Z",
    status: "Succeeded",
    durationInMs: 1,
    summary: { services: [] } as never,
    resourceLogs: [{ logs: true }] as never,
    resourceMetrics: [resource([metric("small", 3), metric("large", 5000)])],
  };

  test("a collection that fits one upload stays one report, untouched", () => {
    const parts: Array<OpenStackCollectionReport> = splitOpenStackReport(
      REPORT,
      10 * 1024 * 1024,
    );

    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(REPORT);
  });

  test("a larger one is cut under the ceiling, and loses nothing", () => {
    const ceiling: number = 40 * 1024;
    const parts: Array<OpenStackCollectionReport> = splitOpenStackReport(
      REPORT,
      ceiling,
    );

    expect(parts.length).toBeGreaterThan(1);

    let large: number = 0;
    let small: number = 0;

    for (const part of parts) {
      expect(
        Buffer.byteLength(JSON.stringify(part.resourceMetrics)),
      ).toBeLessThanOrEqual(ceiling * 1.05);
      large += countOf(part.resourceMetrics as JSONArray, "large");
      small += countOf(part.resourceMetrics as JSONArray, "small");
    }

    expect(large).toBe(5000);
    expect(small).toBe(3);
  });

  test("only the first says what was found, and each says how it went", () => {
    const parts: Array<OpenStackCollectionReport> = splitOpenStackReport(
      REPORT,
      40 * 1024,
    );

    expect(parts[0]?.summary).toBeDefined();
    expect(parts[0]?.resourceLogs).toBeDefined();

    for (const part of parts.slice(1)) {
      expect(part.summary).toBeUndefined();
      expect(part.resourceLogs).toBeUndefined();
      expect(part.status).toBe("Succeeded");
      expect(part.openStackCloudId).toBe("cloud");
    }
  });

  test("whole metrics stay together while they fit, so a host's series stay with its worker's", () => {
    const resources: JSONArray = [
      resource([metric("workers", 10), metric("hosts", 10)]),
      resource([metric("instances", 4000)]),
    ];
    const parts: Array<JSONArray> = splitOpenStackResourceMetrics(
      resources,
      32 * 1024,
    );

    expect(countOf(parts[0] as JSONArray, "workers")).toBe(10);
    expect(countOf(parts[0] as JSONArray, "hosts")).toBe(10);
  });

  test("each part names the resource its metrics came from", () => {
    const resources: JSONArray = [
      {
        resource: { attributes: [{ key: "a", value: { stringValue: "1" } }] },
        scopeMetrics: [
          { scope: { name: "s", version: "v" }, metrics: [metric("m", 4000)] },
        ],
      },
    ];

    for (const part of splitOpenStackResourceMetrics(resources, 24 * 1024)) {
      const entry: JSONObject = part[0] as JSONObject;

      expect((entry["resource"] as JSONObject)["attributes"]).toEqual([
        { key: "a", value: { stringValue: "1" } },
      ]);
      expect(
        (entry["scopeMetrics"] as Array<JSONObject>)[0]?.["scope"],
      ).toEqual({ name: "s", version: "v" });
    }
  });
});
