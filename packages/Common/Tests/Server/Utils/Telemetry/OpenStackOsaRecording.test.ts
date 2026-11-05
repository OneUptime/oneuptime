import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import { OpenStackResourceBufferEntry } from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import {
  ESTATE_INSTANCES,
  ESTATE_VOLUMES,
  metricsOfPart,
  namesOf,
  rowsOfPart,
  statusByName,
} from "../../../Helpers/OpenStackToolRecordings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the agent really sent from a real OpenStack-Ansible all-in-one, as its guide runs it
 * (Tests/Ops/openstack-e2e/osa-guide.sh, imported by import-guide-recording.py), through the real
 * scan. OpenStack-Ansible runs no exporter of its own, so there is no 1.7.0 to hold it to: what
 * has to agree is each part of the guide with the others, and with the exporter's own answer.
 */

const TOOL: string = "osa-aio";

describe("what the agent sent from a real OpenStack-Ansible", () => {
  const fullView: Array<OpenStackResourceBufferEntry> = rowsOfPart(
    TOOL,
    "full-view",
  );
  const standsOn: Array<OpenStackResourceBufferEntry> = rowsOfPart(
    TOOL,
    "stands-on",
  );

  test.each([
    ["on the first credential", "full-view"],
    ["with what the cloud stands on turned on", "stands-on"],
  ])(
    "%s, names each instance estate.sh made, with its status",
    (_: string, part: string) => {
      const instances: Record<string, string | null> = statusByName(
        rowsOfPart(TOOL, part),
        OpenStackResourceKind.Instance,
      );

      for (const [name, status] of Object.entries(ESTATE_INSTANCES)) {
        expect({ name, status: instances[name] }).toEqual({ name, status });
      }
    },
  );

  test("with the guide's setting for Cinder, the first credential names each volume, with its status", () => {
    const volumes: Record<string, string | null> = statusByName(
      fullView,
      OpenStackResourceKind.Volume,
    );

    for (const [name, status] of Object.entries(ESTATE_VOLUMES)) {
      expect({ name, status: volumes[name] }).toEqual({ name, status });
    }
  });

  test.each([
    ["instances", OpenStackResourceKind.Instance],
    ["networks", OpenStackResourceKind.Network],
    ["routers", OpenStackResourceKind.Router],
    ["hypervisors", OpenStackResourceKind.Hypervisor],
  ])(
    "each part of the guide names the same %s",
    (_: string, kind: OpenStackResourceKind) => {
      const names: Array<string> = namesOf(fullView, kind);

      expect(names.length).toBeGreaterThan(0);
      expect(namesOf(standsOn, kind)).toEqual(names);
    },
  );

  test("nova-compute reads up on its host, and Nova's other workers on their containers", () => {
    const workers: Array<OpenStackResourceBufferEntry> = fullView.filter(
      (row: OpenStackResourceBufferEntry): boolean => {
        return row.kind === OpenStackResourceKind.Service;
      },
    );

    for (const binary of ["nova-compute", "nova-conductor", "nova-scheduler"]) {
      const named: Array<OpenStackResourceBufferEntry> = workers.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.name === binary;
        },
      );

      expect({ binary, found: named.length > 0 }).toEqual({
        binary,
        found: true,
      });
      for (const row of named) {
        expect({ binary, status: row.status }).toEqual({
          binary,
          status: "up",
        });
      }
    }
  });

  test("with its settings applied, the agent reads RabbitMQ and HAProxy too", () => {
    const names: Array<string> = metricsOfPart(TOOL, "stands-on").map(
      (metric: JSONObject): string => {
        return metric["name"] as string;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name.startsWith("rabbitmq_");
      }).length,
    ).toBeGreaterThan(0);
    expect(
      names.filter((name: string): boolean => {
        return name.startsWith("haproxy_");
      }).length,
    ).toBeGreaterThan(0);
  });

  test("the logs profile reads the journal, and says which cloud and unit each line is from", () => {
    const logs: JSONObject = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "../../../Fixtures/OpenStack",
          TOOL,
          "logs/logs.json",
        ),
        "utf8",
      ),
    ) as JSONObject;

    expect(logs["total"] as number).toBeGreaterThan(0);

    const resource: JSONArray = (logs["resource"] as JSONObject)[
      "attributes"
    ] as JSONArray;

    expect(
      resource.map((attribute: unknown): unknown => {
        return (attribute as JSONObject)["key"];
      }),
    ).toContain("openstack.cloud.name");

    for (const record of logs["logRecords"] as JSONArray) {
      const keys: Array<unknown> = (
        (record as JSONObject)["attributes"] as JSONArray
      ).map((attribute: unknown): unknown => {
        return (attribute as JSONObject)["key"];
      });

      expect(keys).toContain("journald.unit");
    }
  });
});
