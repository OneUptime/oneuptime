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
  RecordedScene,
  RecordedReading,
  SCENE_REGION,
  StoredMetricRow,
  foldIntoInventory,
  getClusterSceneNames,
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
    scene: "rabbitmq-empty",
    dependency: OpenStackDependency.RabbitMq,
    state: "Fine",
    says: [],
  },
  {
    scene: "rabbitmq-healthy",
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
];

describe("what a recording of each thing breaking reads as", () => {
  test("prints the table", () => {
    const lines: Array<string> = [];
    for (const name of getClusterSceneNames()) {
      const scene: RecordedScene = readClusterScene(name);
      const summaries: Array<OpenStackDependencySummary> =
        getOpenStackDependencySummaries({ rows: rowsOf(scene), now: NOW });
      for (const summary of summaries) {
        if (summary.state !== "NotWatched") {
          lines.push(
            `${name} ${summary.dependency} ${summary.state} ${summary.nodesUp}/${summary.nodesCurrent} ${JSON.stringify(wordsOf(summary))}`,
          );
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(lines.join("\n"));
    expect(lines.length).toBeGreaterThan(0);
  });

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
    ).toEqual(OPENSTACK_DEPENDENCIES.map((): string => {
      return "NotWatched";
    }));
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
