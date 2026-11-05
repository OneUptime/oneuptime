import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE } from "../../../Types/Monitor/MonitorStepOpenStackMonitor";
import {
  RecordedScene,
  StoredMetricRow,
  getClusterSceneNames,
  getCollectorIncreases,
  readClusterScene,
  rowsOfReading,
} from "./Utils/OpenStackControlPlaneScenes";

/*
 * THE SCENES ARE WHAT THE COLLECTOR REALLY SENDS.
 *
 * The scenes are exporters' answers, turned into what reaches OneUptime by
 * OpenStackControlPlaneScenes the way otel-collector-config.yaml does it. The rig ran the agent's
 * real collector through the same scenes, writing what it sent to a file (run 41957567444), and
 * this holds the two together: every series a scene says the collector sends, it did send, with
 * exactly those attributes. Without this the replay would prove something about series nobody
 * sends.
 */

interface CollectorSent {
  resource: Array<string>;
  metrics: Record<string, Array<string>>;
}

const SENT: CollectorSent = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../Fixtures/OpenStack/control-plane/collector-sent.json",
    ),
    "utf8",
  ),
) as CollectorSent;

function rowsOfScene(name: string): Array<StoredMetricRow> {
  const scene: RecordedScene = readClusterScene(name);

  return rowsOfReading({
    scene,
    reading: scene.readings[1]!,
    time: new Date("2026-11-04T12:00:00.000Z"),
  });
}

describe("what a scene says the collector sends", () => {
  const rows: Array<StoredMetricRow> =
    getClusterSceneNames().flatMap(rowsOfScene);

  test("the cloud is on the batch, as the worker's reads ask for it", () => {
    expect(SENT.resource).toContain(
      OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE.replace("resource.", ""),
    );
  });

  test("every series it holds, the collector really sent", () => {
    const names: Array<string> = Array.from(
      new Set(
        rows.map((row: StoredMetricRow): string => {
          return row.name;
        }),
      ),
    ).sort();

    expect(
      names.filter((name: string): boolean => {
        return !SENT.metrics[name];
      }),
    ).toEqual([]);
  });

  test("with the attributes it really sent, and none of its own", () => {
    const made: Map<string, Set<string>> = new Map();

    for (const row of rows) {
      const keys: Set<string> = made.get(row.name) || new Set<string>();

      for (const key of Object.keys(row.attributes)) {
        if (key !== OPENSTACK_CLOUD_RESOURCE_ATTRIBUTE) {
          keys.add(key);
        }
      }

      made.set(row.name, keys);
    }

    for (const [name, keys] of made.entries()) {
      for (const key of keys) {
        expect({ name, key, sent: SENT.metrics[name]?.includes(key) }).toEqual({
          name,
          key,
          sent: true,
        });
      }

      // Every series the agent stamps says its dependency, its machine and its region.
      for (const key of [
        "openstack_dependency",
        "openstack_exporter_host",
        "openstack.region.name",
      ]) {
        expect(keys.has(key)).toBe(true);
        expect(SENT.metrics[name]).toContain(key);
      }
    }
  });

  test("each counter also went out as how much it grew, under the name the config gives it", () => {
    for (const [counter, increase] of getCollectorIncreases().entries()) {
      // Open vSwitch's interfaces are read beside a real cloud, and no cluster has them.
      if (counter !== "ovs_interface_tx_errors") {
        expect({ counter, sent: Boolean(SENT.metrics[increase]) }).toEqual({
          counter,
          sent: true,
        });
      }
    }
  });
});
