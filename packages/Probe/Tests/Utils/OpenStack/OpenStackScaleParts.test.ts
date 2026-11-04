import { describe, expect, test } from "@jest/globals";
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
  const OTHER_LABELS: Record<string, string> = { name: "a" };

  function gate(
    state: OpenStackRollingState,
    turns: number = 4,
    keptProjectIds: Array<string> = [],
  ): OpenStackRollingSend {
    return new OpenStackRollingSend({ state, turns, keptProjectIds });
  }

  test("a series that is no part's goes every time", () => {
    const send: OpenStackRollingSend = gate(createOpenStackRollingState());

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

  test("the first time a part is seen it goes, and then only on its turn", () => {
    const state: OpenStackRollingState = createOpenStackRollingState();
    const labels: Record<string, string> = {
      id: "v-1",
      status: "in-use",
      ...OTHER_LABELS,
    };
    const metric: string = "openstack_cinder_snapshot_gb";

    // A snapshot in a settled state, whose turn this may or may not be.
    expect(
      gate(state).shouldSend(metric, { ...labels, status: "available" }, 10),
    ).toBe(true);

    let sentAgain: number = 0;

    for (let turn: number = 0; turn < 4; turn++) {
      if (
        gate(state).shouldSend(metric, { ...labels, status: "available" }, 10)
      ) {
        sentAgain++;
      }
    }

    expect(sentAgain).toBe(1);
  });

  test("a part that changes goes at once, whoever's turn it is", () => {
    const state: OpenStackRollingState = createOpenStackRollingState();
    const metric: string = "openstack_cinder_snapshot_gb";
    const snapshot: (size: number) => boolean = (size: number): boolean => {
      return gate(state).shouldSend(
        metric,
        { id: "s-1", status: "available" },
        size,
      );
    };

    expect(snapshot(10)).toBe(true);
    expect(snapshot(20)).toBe(true);
  });

  test("a part in a state something watches goes every time", () => {
    const state: OpenStackRollingState = createOpenStackRollingState();

    for (let turn: number = 0; turn < 4; turn++) {
      const send: OpenStackRollingSend = gate(state);

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
    const state: OpenStackRollingState = createOpenStackRollingState();
    const kept: Array<string> = ["p-kept"];
    let others: number = 0;

    for (let turn: number = 0; turn < 8; turn++) {
      const send: OpenStackRollingSend = gate(state, 4, kept);

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

    // The first time, and on its turn twice round.
    expect(others).toBeGreaterThanOrEqual(2);
    expect(others).toBeLessThanOrEqual(3);
  });

  test("every part comes round within the turns, whatever its id", () => {
    const state: OpenStackRollingState = createOpenStackRollingState();
    const ids: Array<string> = Array.from(
      { length: 2000 },
      (_v: unknown, i: number) => {
        return `s-${i}`;
      },
    );
    const metric: string = "openstack_neutron_subnet";

    // The first collection sends them all.
    const first: OpenStackRollingSend = gate(state, 7);

    for (const id of ids) {
      expect(first.shouldSend(metric, { id }, 1)).toBe(true);
    }

    const seen: Set<string> = new Set();
    let largest: number = 0;

    for (let turn: number = 0; turn < 7; turn++) {
      const send: OpenStackRollingSend = gate(state, 7);
      let sent: number = 0;

      for (const id of ids) {
        if (send.shouldSend(metric, { id }, 1)) {
          seen.add(id);
          sent++;
        }
      }

      largest = Math.max(largest, sent);
    }

    expect(seen.size).toBe(ids.length);
    // About a seventh each: nothing piles up on one turn.
    expect(largest).toBeLessThan((ids.length / 7) * 1.5);
  });

  test("what is held back still counts as a sample of the scrape, and is not in the upload", () => {
    const state: OpenStackRollingState = createOpenStackRollingState();
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
    };

    OpenStackOtlpBuilder.build([reading], "test", gate(state));

    const second: ReturnType<typeof OpenStackOtlpBuilder.build> =
      OpenStackOtlpBuilder.build([reading], "test", gate(state));

    const metrics: Array<JSONObject> = (
      (second.resourceMetrics[0] as JSONObject)[
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

    // The stale-row rule is told how long a row can go.
    const up: JSONObject = (
      (named("openstack_glance_up")?.["gauge"] as JSONObject)[
        "dataPoints"
      ] as Array<JSONObject>
    )[0] as JSONObject;

    expect(up["attributes"]).toEqual(
      expect.arrayContaining([
        { key: "refresh_cycle_minutes", value: { stringValue: "8" } },
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
