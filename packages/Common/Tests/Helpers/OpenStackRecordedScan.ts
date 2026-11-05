import fs from "fs";
import path from "path";
import {
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../Types/JSON";
import {
  OPENSTACK_USAGE_IMAGE_STATUS_HOLDING,
  OPENSTACK_USAGE_INSTANCE_STATUSES_HOLDING_NOTHING,
  OPENSTACK_USAGE_STORAGE_STATUSES_HOLDING_NOTHING,
  OpenStackUsageRows,
  readOpenStackUsageFlavorId,
} from "../../Types/OpenStack/OpenStackProjectUsage";
import { OpenStackResourceKind } from "../../Types/OpenStack/OpenStackResourceKind";

/*
 * What the agent's exporter really answered, through the real snapshot scan, as the usage and waste
 * tests replay it.
 */

export const OPENSTACK_FIXTURES: string = path.join(
  __dirname,
  "../Fixtures/OpenStack",
);

function datapointsOf(
  text: string,
  observedAtMs: number,
): Array<{
  metricName: string;
  datapoint: JSONObject;
}> {
  const points: Array<{ metricName: string; datapoint: JSONObject }> = [];

  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) {
      continue;
    }
    const brace: number = line.indexOf("{");
    const space: number = line.lastIndexOf(" ");
    const attributes: JSONArray = [];

    if (brace >= 0) {
      const body: string = line.substring(brace + 1, line.lastIndexOf("}"));
      let at: number = 0;
      while (at < body.length) {
        const equals: number = body.indexOf("=", at);
        const key: string = body.substring(at, equals);
        let end: number = equals + 2;
        while (body[end] !== '"') {
          end += body[end] === "\\" ? 2 : 1;
        }
        const value: string = body.substring(equals + 2, end);
        // What the collector does: an empty label is no label.
        if (value) {
          attributes.push({ key, value: { stringValue: value } });
        }
        at = end + 2;
      }
    }

    attributes.push({
      key: "openstack.region.name",
      value: { stringValue: "RegionOne" },
    });

    points.push({
      metricName: line.substring(0, brace >= 0 ? brace : space),
      datapoint: {
        attributes,
        asDouble: Number(line.substring(space + 1)),
        timeUnixNano: `${observedAtMs}000000`,
      },
    });
  }

  return points;
}

export function scanExporterTexts(
  texts: ReadonlyArray<string>,
  observedAtMs: number,
): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

  for (const text of texts) {
    for (const point of datapointsOf(text, observedAtMs)) {
      if (isOpenStackSnapshotDatapoint(point)) {
        bufferOpenStackSnapshotMetric({ ...point, buffer });
      }
    }
  }

  return finishOpenStackBatch(buffer.values());
}

/*
 * The rig's usage run: six readings of a real cloud, around a real resize and a real deletion. See
 * OpenStackUsageOnARealCloud.test.ts, which writes out what they should come to.
 */
export const OPENSTACK_USAGE_RECORDING: string = path.join(
  OPENSTACK_FIXTURES,
  "hibiscus-ovn",
  "usage",
);

export const OPENSTACK_USAGE_SCENES: ReadonlyArray<string> = [
  "usage-start",
  "usage-before-resize",
  "usage-after-resize",
  "usage-before-delete",
  "usage-after-delete",
  "usage-end",
];

const USAGE_SCENE_SERVICES: ReadonlyArray<string> = [
  "identity",
  "compute",
  "placement",
  "network",
  "volume",
  "image",
];

export function recordedAtOfUsageScene(scene: string): Date {
  return new Date(
    fs
      .readFileSync(
        path.join(OPENSTACK_USAGE_RECORDING, scene, "recorded-at.txt"),
        "utf8",
      )
      .trim(),
  );
}

export function scanUsageScene(
  scene: string,
): Array<OpenStackResourceBufferEntry> {
  return scanExporterTexts(
    USAGE_SCENE_SERVICES.map((service: string): string => {
      return fs.readFileSync(
        path.join(
          OPENSTACK_USAGE_RECORDING,
          scene,
          "exporter",
          `${service}.prom`,
        ),
        "utf8",
      );
    }),
    recordedAtOfUsageScene(scene).getTime(),
  );
}

// What OpenStackProjectUsageService.getUsageRows does in SQL, over the scan's own rows.
export function usageRowsOf(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
): OpenStackUsageRows {
  const ofKind: (
    kind: OpenStackResourceKind,
  ) => Array<OpenStackResourceBufferEntry> = (
    kind: OpenStackResourceKind,
  ): Array<OpenStackResourceBufferEntry> => {
    return rows.filter((row: OpenStackResourceBufferEntry): boolean => {
      return row.kind === kind && Boolean(row.openStackProjectId);
    });
  };
  const holdsSpace: (row: OpenStackResourceBufferEntry) => boolean = (
    row: OpenStackResourceBufferEntry,
  ): boolean => {
    return !OPENSTACK_USAGE_STORAGE_STATUSES_HOLDING_NOTHING.includes(
      row.status || "",
    );
  };

  return {
    instances: ofKind(OpenStackResourceKind.Instance)
      .filter((row: OpenStackResourceBufferEntry): boolean => {
        return (
          Boolean(row.hypervisorName) &&
          !OPENSTACK_USAGE_INSTANCE_STATUSES_HOLDING_NOTHING.includes(
            row.status || "",
          )
        );
      })
      .map((row: OpenStackResourceBufferEntry) => {
        return {
          openStackProjectId: row.openStackProjectId,
          regionName: row.regionName,
          flavorId: (row.facts["flavorId"] as string) || null,
          status: row.status,
          count: 1,
        };
      }),
    flavors: rows
      .filter((row: OpenStackResourceBufferEntry): boolean => {
        return row.kind === OpenStackResourceKind.Flavor;
      })
      .map((row: OpenStackResourceBufferEntry) => {
        return {
          regionName: row.regionName,
          flavorId: readOpenStackUsageFlavorId({
            externalId: row.externalId,
            regionName: row.regionName,
          }),
          name: row.name,
          vcpus: row.vcpuCapacity,
          memoryBytes: row.memoryCapacityBytes,
        };
      }),
    volumes: ofKind(OpenStackResourceKind.Volume)
      .filter(holdsSpace)
      .map((row: OpenStackResourceBufferEntry) => {
        return {
          openStackProjectId: row.openStackProjectId,
          type: (row.facts["volumeType"] as string) || null,
          bytes: row.diskCapacityBytes || 0,
        };
      }),
    floatingIps: ofKind(OpenStackResourceKind.FloatingIp).map(
      (row: OpenStackResourceBufferEntry) => {
        return { openStackProjectId: row.openStackProjectId, count: 1 };
      },
    ),
    images: ofKind(OpenStackResourceKind.Image)
      .filter((row: OpenStackResourceBufferEntry): boolean => {
        return row.status === OPENSTACK_USAGE_IMAGE_STATUS_HOLDING;
      })
      .map((row: OpenStackResourceBufferEntry) => {
        return {
          openStackProjectId: row.openStackProjectId,
          bytes: row.diskCapacityBytes || 0,
        };
      }),
    snapshots: ofKind(OpenStackResourceKind.Snapshot)
      .filter(holdsSpace)
      .map((row: OpenStackResourceBufferEntry) => {
        return {
          openStackProjectId: row.openStackProjectId,
          bytes: row.diskCapacityBytes || 0,
        };
      }),
  };
}

export function idOfProject(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
  name: string,
): string {
  return rows.find((row: OpenStackResourceBufferEntry): boolean => {
    return row.kind === OpenStackResourceKind.Project && row.name === name;
  })!.externalId;
}

export function idOfFlavor(
  rows: ReadonlyArray<OpenStackResourceBufferEntry>,
  name: string,
): string {
  const row: OpenStackResourceBufferEntry = rows.find(
    (entry: OpenStackResourceBufferEntry): boolean => {
      return entry.kind === OpenStackResourceKind.Flavor && entry.name === name;
    },
  )!;

  return readOpenStackUsageFlavorId({
    externalId: row.externalId,
    regionName: row.regionName,
  });
}
