import { describe, expect, test } from "@jest/globals";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { JSONObject } from "../../../Types/JSON";
import { OPENSTACK_REGION_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import {
  OPENSTACK_CONTROL_PLANE_FACTS,
  OPENSTACK_DEPENDENCIES,
  OpenStackDependency,
  isOpenStackDependencyDown,
} from "../../../Types/OpenStack/OpenStackControlPlane";
import {
  OpenStackDependencyState,
  OpenStackDependencySummary,
  getOpenStackControlPlaneAttentionItems,
  getOpenStackDependencySummaries,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackControlPlaneHealth";
import {
  ResourceAttentionItem,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import {
  RecordedDrill,
  RecordedScene,
  RecordedReading,
  SCENE_REGION,
  StoredMetricRow,
  foldIntoInventory,
  getClusterSceneNames,
  readCloudDrill,
  readClusterScene,
  rowsOfReading,
} from "../../Types/Monitor/Utils/OpenStackControlPlaneScenes";

/*
 * WHAT THE CARD AND NEEDS ATTENTION SAY OF EACH THING THAT REALLY BROKE.
 *
 * Each scene is what real clusters said (OpenStackControlPlaneScenes), through the real scan
 * (OpenStackControlPlaneScan), into the rows the pages read, and through the real rules. So this
 * holds the fold, the rules and the alert templates' lines to one recording: a scene an alert
 * fires on also reads as trouble here, and one it stays quiet on reads as fine.
 */

const NOW: Date = new Date("2026-11-04T12:00:00.000Z");

// A scene as the rows the pages read: each of its readings folded in turn, as batches are.
function rowsOf(
  scene: RecordedScene,
  region: string = SCENE_REGION,
): Array<OpenStackResource> {
  return foldIntoInventory(
    scene.readings.flatMap(
      (reading: RecordedReading, index: number): Array<StoredMetricRow> => {
        return rowsOfReading({
          scene,
          reading,
          time: new Date(
            NOW.getTime() - (scene.readings.length - index) * 60000,
          ),
          region,
        });
      },
    ),
  );
}

function summaryOf(
  sceneName: string,
  dependency: OpenStackDependency,
): OpenStackDependencySummary {
  return getOpenStackDependencySummaries({
    rows: rowsOf(readClusterScene(sceneName)),
    now: NOW,
  }).find((summary: OpenStackDependencySummary): boolean => {
    return summary.dependency === dependency;
  })!;
}

function wordsOf(summary: OpenStackDependencySummary): Array<string> {
  return summary.reasons.map((reason: ResourceAttentionText): string => {
    let words: string = reason.text;
    for (const [key, value] of Object.entries(reason.values || {})) {
      words = words.replace(`{{${key}}}`, value as string);
    }
    return words;
  });
}

/*
 * What each scene reads as, for the one dependency it is about. Every scene there is has a row,
 * so a new one has to say what it reads as.
 */
const EXPECTED: ReadonlyArray<{
  scene: string;
  dependency: OpenStackDependency;
  state: OpenStackDependencyState;
  says: Array<string>;
}> = [
  {
    scene: "haproxy-api-401",
    dependency: OpenStackDependency.HaProxy,
    state: "NeedsALook",
    says: ["100% of nova_api_back's responses are 4xx"],
  },
  {
    scene: "haproxy-api-5xx",
    dependency: OpenStackDependency.HaProxy,
    state: "Broken",
    says: ["100% of nova_api_back's responses are 5xx"],
  },
  {
    scene: "haproxy-backend-down",
    dependency: OpenStackDependency.HaProxy,
    state: "Broken",
    says: ["Backend nova_api_back has no server left"],
  },
  {
    scene: "haproxy-down",
    dependency: OpenStackDependency.HaProxy,
    state: "Broken",
    says: ["Every node is down"],
  },
  {
    scene: "haproxy-recovered-from-down",
    dependency: OpenStackDependency.HaProxy,
    state: "Fine",
    says: [],
  },
  {
    scene: "haproxy-healthy",
    dependency: OpenStackDependency.HaProxy,
    state: "Fine",
    says: [],
  },
  {
    scene: "haproxy-recovered",
    dependency: OpenStackDependency.HaProxy,
    state: "Fine",
    says: [],
  },
  {
    scene: "haproxy-recovered-from-errors",
    dependency: OpenStackDependency.HaProxy,
    state: "Fine",
    says: [],
  },
  {
    scene: "haproxy-server-down",
    dependency: OpenStackDependency.HaProxy,
    state: "NeedsALook",
    says: ["Server nova_api_back/controller-2 is down"],
  },
  {
    scene: "mariadb-cluster-down",
    dependency: OpenStackDependency.MariaDb,
    state: "Broken",
    says: ["Every node is down"],
  },
  {
    scene: "mariadb-healthy",
    dependency: OpenStackDependency.MariaDb,
    state: "Fine",
    says: [],
  },
  {
    scene: "mariadb-node-cut-off",
    dependency: OpenStackDependency.MariaDb,
    state: "Broken",
    says: ["Not in the Primary component", "Not ready for queries"],
  },
  {
    scene: "mariadb-node-desynced",
    dependency: OpenStackDependency.MariaDb,
    state: "Fine",
    says: [],
  },
  {
    scene: "mariadb-node-down",
    dependency: OpenStackDependency.MariaDb,
    state: "NeedsALook",
    says: ["Galera has 2 of the 3 nodes read", "Not answering"],
  },
  {
    scene: "mariadb-node-out-of-sync",
    dependency: OpenStackDependency.MariaDb,
    state: "NeedsALook",
    says: ["Out of sync with the cluster"],
  },
  {
    scene: "mariadb-quorum-lost",
    dependency: OpenStackDependency.MariaDb,
    state: "Broken",
    says: ["No node is in the Primary component, so none takes writes"],
  },
  {
    scene: "mariadb-recovered",
    dependency: OpenStackDependency.MariaDb,
    state: "Fine",
    says: [],
  },
  {
    scene: "mariadb-recovered-from-cluster-down",
    dependency: OpenStackDependency.MariaDb,
    state: "Fine",
    says: [],
  },
  {
    scene: "mariadb-slow-queries",
    dependency: OpenStackDependency.MariaDb,
    state: "NeedsALook",
    says: ["212 slow queries in the last minute"],
  },
  {
    scene: "mariadb-too-many-connections",
    dependency: OpenStackDependency.MariaDb,
    state: "NeedsALook",
    says: ["90% of connections in use"],
  },
  {
    scene: "mariadb-without-galera-down",
    dependency: OpenStackDependency.MariaDb,
    state: "Broken",
    says: ["Every node is down"],
  },
  {
    scene: "mariadb-without-galera-healthy",
    dependency: OpenStackDependency.MariaDb,
    state: "Fine",
    says: [],
  },
  {
    scene: "mariadb-without-galera-recovered",
    dependency: OpenStackDependency.MariaDb,
    state: "Fine",
    says: [],
  },
  {
    scene: "memcached-cluster-down",
    dependency: OpenStackDependency.Memcached,
    state: "NeedsALook",
    says: ["Every node is down"],
  },
  {
    scene: "memcached-evictions-high",
    dependency: OpenStackDependency.Memcached,
    state: "NeedsALook",
    says: ["600 items evicted in the last minute"],
  },
  {
    scene: "memcached-no-clients",
    dependency: OpenStackDependency.Memcached,
    state: "NeedsALook",
    says: ["Nothing connects to it or asks it anything"],
  },
  {
    scene: "memcached-one-down",
    dependency: OpenStackDependency.Memcached,
    state: "NeedsALook",
    says: ["Not answering"],
  },
  {
    scene: "memcached-recovered",
    dependency: OpenStackDependency.Memcached,
    state: "Fine",
    says: [],
  },
  {
    scene: "memcached-with-clients",
    dependency: OpenStackDependency.Memcached,
    state: "Fine",
    says: [],
  },
  {
    scene: "ovn-every-member-down",
    dependency: OpenStackDependency.Network,
    state: "Broken",
    says: [
      "No ovn-northd is active, so changes to the network do not reach the machines",
    ],
  },
  {
    scene: "ovn-healthy",
    dependency: OpenStackDependency.Network,
    state: "Fine",
    says: [],
  },
  {
    scene: "ovn-member-down",
    dependency: OpenStackDependency.Network,
    state: "Fine",
    says: [],
  },
  {
    scene: "ovn-no-leader",
    dependency: OpenStackDependency.Network,
    state: "Broken",
    says: [
      "The OVN_Southbound database has no leader",
      "No ovn-northd is active, so changes to the network do not reach the machines",
    ],
  },
  {
    scene: "ovn-northd-down",
    dependency: OpenStackDependency.Network,
    state: "Fine",
    says: [],
  },
  {
    scene: "ovn-recovered",
    dependency: OpenStackDependency.Network,
    state: "Fine",
    says: [],
  },
  {
    scene: "ovn-recovered-from-every-member-down",
    dependency: OpenStackDependency.Network,
    state: "Fine",
    says: [],
  },
  {
    scene: "rabbitmq-cluster-down",
    dependency: OpenStackDependency.RabbitMq,
    state: "Broken",
    says: ["Every node is down"],
  },
  {
    scene: "rabbitmq-disk-alarm",
    dependency: OpenStackDependency.RabbitMq,
    state: "Broken",
    says: ["Disk alarm: it has stopped taking messages"],
  },
  {
    scene: "rabbitmq-empty",
    dependency: OpenStackDependency.RabbitMq,
    state: "Fine",
    says: [],
  },
  {
    scene: "rabbitmq-file-descriptors-high",
    dependency: OpenStackDependency.RabbitMq,
    state: "NeedsALook",
    says: ["97% of file descriptors in use"],
  },
  {
    scene: "rabbitmq-healthy",
    dependency: OpenStackDependency.RabbitMq,
    state: "Fine",
    says: [],
  },
  {
    scene: "rabbitmq-memory-alarm",
    dependency: OpenStackDependency.RabbitMq,
    state: "Broken",
    says: ["Memory alarm: it has stopped taking messages"],
  },
  {
    scene: "rabbitmq-messages-unacknowledged",
    dependency: OpenStackDependency.RabbitMq,
    state: "NeedsALook",
    says: ["2000 messages unacknowledged"],
  },
  {
    scene: "rabbitmq-node-down",
    dependency: OpenStackDependency.RabbitMq,
    state: "NeedsALook",
    says: ["Not answering"],
  },
  {
    scene: "rabbitmq-partition",
    dependency: OpenStackDependency.RabbitMq,
    state: "Broken",
    says: ["The cluster has split: rabbit@rabbit1 can't reach rabbit@rabbit3"],
  },
  {
    scene: "rabbitmq-queue-without-consumers",
    dependency: OpenStackDependency.RabbitMq,
    state: "Fine",
    says: [],
  },
  {
    scene: "rabbitmq-recovered",
    dependency: OpenStackDependency.RabbitMq,
    state: "Fine",
    says: [],
  },
  {
    scene: "rabbitmq-recovered-from-alarms",
    dependency: OpenStackDependency.RabbitMq,
    state: "Fine",
    says: [],
  },
  {
    scene: "rabbitmq-recovered-from-cluster-down",
    dependency: OpenStackDependency.RabbitMq,
    state: "Fine",
    says: [],
  },
  {
    scene: "rabbitmq-recovered-from-file-descriptors",
    dependency: OpenStackDependency.RabbitMq,
    state: "Fine",
    says: [],
  },
  {
    scene: "rabbitmq-recovered-from-queue-without-consumers",
    dependency: OpenStackDependency.RabbitMq,
    state: "Fine",
    says: [],
  },
];

describe("what a recording of each thing breaking reads as", () => {
  test("every scene there is has a row, so a new one has to say what it reads as", () => {
    expect(
      EXPECTED.map((row: { scene: string }): string => {
        return row.scene;
      }).sort(),
    ).toEqual(getClusterSceneNames());
  });

  /*
   * A queue with messages and nobody reading is on an alert of its own and in the Queues product.
   * Every node of it is fine, which is what this card says of a RabbitMQ: it reads no queue.
   */
  test.each(EXPECTED)(
    "$scene reads as $state",
    (row: {
      scene: string;
      dependency: OpenStackDependency;
      state: OpenStackDependencyState;
      says: Array<string>;
    }) => {
      const summary: OpenStackDependencySummary = summaryOf(
        row.scene,
        row.dependency,
      );

      expect({ state: summary.state, says: wordsOf(summary) }).toEqual({
        state: row.state,
        says: row.says,
      });
    },
  );
});

describe("what nobody reads", () => {
  test("no rows at all is Not Watched on every line, and never Fine", () => {
    const summaries: Array<OpenStackDependencySummary> =
      getOpenStackDependencySummaries({ rows: [], now: NOW });

    expect(
      summaries.map((summary: OpenStackDependencySummary): string => {
        return summary.state;
      }),
    ).toEqual(
      OPENSTACK_DEPENDENCIES.map((): string => {
        return "NotWatched";
      }),
    );
  });

  test("one dependency named says nothing of the others", () => {
    const summaries: Array<OpenStackDependencySummary> =
      getOpenStackDependencySummaries({
        rows: rowsOf(readClusterScene("rabbitmq-healthy")),
        now: NOW,
      });

    for (const summary of summaries) {
      expect(summary.state).toBe(
        summary.dependency === OpenStackDependency.RabbitMq
          ? "Fine"
          : "NotWatched",
      );
    }
  });

  test("a row nobody has read for a while says No Reading, and what it last said goes unsaid", () => {
    const rows: Array<OpenStackResource> = rowsOf(
      readClusterScene("rabbitmq-memory-alarm"),
    );

    const summary: OpenStackDependencySummary = getOpenStackDependencySummaries(
      { rows, now: new Date(NOW.getTime() + 60 * 60000) },
    ).find((one: OpenStackDependencySummary): boolean => {
      return one.dependency === OpenStackDependency.RabbitMq;
    })!;

    expect(summary.state).toBe("NoReading");
    expect(summary.reasons).toEqual([]);
  });
});

describe("Needs attention", () => {
  test("a cluster that is gone is one line, and not one per node", () => {
    const items: Array<ResourceAttentionItem> =
      getOpenStackControlPlaneAttentionItems({
        rows: rowsOf(readClusterScene("rabbitmq-cluster-down")),
        now: NOW,
      });

    expect(items).toHaveLength(1);
    expect(items[0]!.name).toBe("RabbitMQ");
    expect(items[0]!.severity).toBe("critical");
  });

  test("each machine's own trouble is its own line", () => {
    const items: Array<ResourceAttentionItem> =
      getOpenStackControlPlaneAttentionItems({
        rows: rowsOf(readClusterScene("rabbitmq-memory-alarm")),
        now: NOW,
      });

    expect(
      items.map((item: ResourceAttentionItem): string => {
        return `${item.name} ${item.detail}`;
      }),
    ).toEqual([`RabbitMQ 127.0.1.2 · ${SCENE_REGION}`]);
  });

  test("a healthy recording has nothing to say", () => {
    for (const scene of [
      "rabbitmq-healthy",
      "mariadb-healthy",
      "haproxy-healthy",
      "ovn-healthy",
    ]) {
      expect(
        getOpenStackControlPlaneAttentionItems({
          rows: rowsOf(readClusterScene(scene)),
          now: NOW,
        }),
      ).toEqual([]);
    }
  });
});

describe("a region says nothing of another", () => {
  test("a RabbitMQ gone in one region is not a RabbitMQ gone in another", () => {
    const here: Array<OpenStackResource> = rowsOf(
      readClusterScene("rabbitmq-cluster-down"),
      "RegionOne",
    );
    const there: Array<OpenStackResource> = rowsOf(
      readClusterScene("rabbitmq-healthy"),
      "RegionTwo",
    );

    expect(
      isOpenStackDependencyDown({
        dependency: OpenStackDependency.RabbitMq,
        rows: here,
      }),
    ).toBe(true);
    expect(
      isOpenStackDependencyDown({
        dependency: OpenStackDependency.RabbitMq,
        rows: there,
      }),
    ).toBe(false);

    const items: Array<ResourceAttentionItem> =
      getOpenStackControlPlaneAttentionItems({
        rows: [...here, ...there],
        now: NOW,
      });

    expect(
      items.map((item: ResourceAttentionItem): unknown => {
        return item.detail;
      }),
    ).toEqual(["RegionOne"]);
  });
});

/*
 * What goes away with what it reports, on a real DevStack. A row keeps when each was last seen, so
 * these fold what came before the drill, then what came after it, ten minutes on.
 */
describe("what a machine's network says, on a real cloud with something stopped on it", () => {
  function networkWords(
    release: string,
    name: string,
    readingOf: (drill: RecordedDrill) => RecordedReading,
  ): Array<string> {
    const drill: RecordedDrill = readCloudDrill(release, name);
    const scene: RecordedScene = { name, readings: [drill.before] };

    return wordsOf(
      getOpenStackDependencySummaries({
        rows: foldIntoInventory([
          ...rowsOfReading({
            scene,
            reading: drill.before,
            time: new Date(NOW.getTime() - 11 * 60000),
          }),
          ...rowsOfReading({
            scene,
            reading: readingOf(drill),
            time: new Date(NOW.getTime() - 60000),
          }),
        ]),
        now: NOW,
      }).find((summary: OpenStackDependencySummary): boolean => {
        return summary.dependency === OpenStackDependency.Network;
      })!,
    );
  }

  function lastMinute(drill: RecordedDrill): RecordedReading {
    return drill.minutes[drill.minutes.length - 1]!;
  }

  function recovered(drill: RecordedDrill): RecordedReading {
    return drill.recovered;
  }

  test("a stopped ovn-controller reads as that", () => {
    expect(
      networkWords("gazpacho-ovn", "ovn-controller-down", lastMinute),
    ).toEqual(["ovn-controller isn't answering"]);
  });

  test("started again, it reads as nothing", () => {
    expect(
      networkWords("gazpacho-ovn", "ovn-controller-down", recovered),
    ).toEqual([]);
  });

  test.each(["gazpacho-ovn", "gazpacho-ovs"])(
    "a stopped Open vSwitch on %s reads as that, and not as a stopped ovn-controller as well",
    (release: string) => {
      expect(networkWords(release, "ovs-down", lastMinute)).toEqual([
        "Open vSwitch isn't answering",
      ]);
    },
  );

  test.each(["gazpacho-ovn", "gazpacho-ovs"])(
    "started again on %s, the exporter does not read its database until it restarts, and it says so",
    (release: string) => {
      expect(networkWords(release, "ovs-down", recovered)).toEqual([
        "The exporter lost Open vSwitch's database: restart it to read this machine's interfaces and ovn-controller",
      ]);
    },
  );

  test("a host of only OVN's databases has lost nothing, because it never had any of it", () => {
    expect(
      wordsOf(summaryOf("ovn-healthy", OpenStackDependency.Network)),
    ).toEqual([]);
  });
});

// Keep the labels a row's region comes from pinned to what the agent stamps.
test("the region a row is filed under is the one the agent stamps", () => {
  const rows: Array<OpenStackResource> = rowsOf(
    readClusterScene("rabbitmq-healthy"),
  );

  expect(OPENSTACK_REGION_ATTRIBUTE).toBe("openstack.region.name");
  for (const row of rows) {
    expect(row.regionName).toBe(SCENE_REGION);
    expect(
      (row.facts as JSONObject)[OPENSTACK_CONTROL_PLANE_FACTS.Dependency],
    ).toBe(OpenStackDependency.RabbitMq);
  }
});
