import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import { OpenStackResourceBufferEntry } from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import {
  ESTATE_INSTANCES,
  ESTATE_VOLUMES,
  namesOf,
  rowsOfPart,
  statusByName,
} from "../../../Helpers/OpenStackToolRecordings";
import { describe, expect, test } from "@jest/globals";

/*
 * What the agent really sent from a real Kolla-Ansible all-in-one, each way the guide runs it,
 * through the real scan (Tests/Ops/openstack-e2e/kolla-guide.sh, imported by
 * import-guide-recording.py). The bar the issue sets for bringing your own exporter is the same
 * pages on the version the agent pins and on Kolla-Ansible's 1.7.0: this is that, on the tool
 * itself, and what the two do not agree on is written down here as what 1.7.0 goes without.
 *
 * Each part stopped as soon as the agent had reported, so each holds what its first scrapes said,
 * which is why a part is only held to the kinds its own scrapes reach.
 */

function kollaRows(part: string): Array<OpenStackResourceBufferEntry> {
  return rowsOfPart("kolla-aio", part);
}

const INSTANCES: Record<string, string> = ESTATE_INSTANCES;
const VOLUMES: Record<string, string> = ESTATE_VOLUMES;

describe("what the agent sent from a real Kolla-Ansible", () => {
  const pinned: Array<OpenStackResourceBufferEntry> = kollaRows("own-exporter");
  const stable: Array<OpenStackResourceBufferEntry> =
    kollaRows("own-exporter-170");
  const kollas: Array<OpenStackResourceBufferEntry> =
    kollaRows("kolla-exporter");
  const fullView: Array<OpenStackResourceBufferEntry> = kollaRows("full-view");
  const withoutDocker: Array<OpenStackResourceBufferEntry> =
    kollaRows("without-docker");

  test.each([
    ["the agent's own exporter, on the first credential", "full-view"],
    ["your own exporter, at the pinned version", "own-exporter"],
    ["your own exporter, at 1.7.0", "own-exporter-170"],
    ["Kolla-Ansible's own exporter", "kolla-exporter"],
    ["the agent without Docker, on Kolla-Ansible's exporter", "without-docker"],
  ])(
    "%s names each instance estate.sh made, with its status",
    (_: string, part: string) => {
      const instances: Record<string, string | null> = statusByName(
        kollaRows(part),
        OpenStackResourceKind.Instance,
      );

      for (const [name, status] of Object.entries(INSTANCES)) {
        expect({ name, status: instances[name] }).toEqual({ name, status });
      }
    },
  );

  test("the version the agent pins names each volume, with its status, on the first credential too", () => {
    for (const rows of [pinned, fullView]) {
      const volumes: Record<string, string | null> = statusByName(
        rows,
        OpenStackResourceKind.Volume,
      );

      for (const [name, status] of Object.entries(VOLUMES)) {
        expect({ name, status: volumes[name] }).toEqual({ name, status });
      }
    }
  });

  test("1.7.0, and so Kolla-Ansible's exporter, reads no Cinder at all", () => {
    expect(namesOf(stable, OpenStackResourceKind.Volume)).toEqual([]);
    expect(namesOf(kollas, OpenStackResourceKind.Volume)).toEqual([]);
    expect(namesOf(withoutDocker, OpenStackResourceKind.Volume)).toEqual([]);
  });

  test.each([
    ["instances", OpenStackResourceKind.Instance],
    ["networks", OpenStackResourceKind.Network],
    ["routers", OpenStackResourceKind.Router],
    ["projects", OpenStackResourceKind.Project],
    ["hypervisors", OpenStackResourceKind.Hypervisor],
  ])(
    "the pinned version, 1.7.0 and Kolla-Ansible's exporter name the same %s",
    (_: string, kind: OpenStackResourceKind) => {
      const names: Array<string> = namesOf(pinned, kind);

      expect(names.length).toBeGreaterThan(0);
      expect(namesOf(stable, kind)).toEqual(names);
      expect(namesOf(kollas, kind)).toEqual(names);
    },
  );

  test("every way of running it finds nova-compute up on the same host", () => {
    for (const rows of [pinned, stable, kollas, fullView, withoutDocker]) {
      const computes: Array<OpenStackResourceBufferEntry> = rows.filter(
        (row: OpenStackResourceBufferEntry): boolean => {
          return (
            row.kind === OpenStackResourceKind.Service &&
            row.name === "nova-compute"
          );
        },
      );

      expect(
        computes.map((row: OpenStackResourceBufferEntry): unknown => {
          return { host: row.hypervisorName, status: row.status };
        }),
      ).toEqual([{ host: "compute-01.example.internal", status: "up" }]);
    }
  });

  test("a stock cinder-backup reads down, as the cloud itself says it is", () => {
    // Kolla-Ansible turns it on by default, with no backend to back up to.
    const backup: Array<OpenStackResourceBufferEntry> = pinned.filter(
      (row: OpenStackResourceBufferEntry): boolean => {
        return (
          row.kind === OpenStackResourceKind.Service &&
          row.name === "cinder-backup"
        );
      },
    );

    expect(
      backup.map((row: OpenStackResourceBufferEntry): string | null => {
        return row.status;
      }),
    ).toEqual(["down"]);
  });
});
