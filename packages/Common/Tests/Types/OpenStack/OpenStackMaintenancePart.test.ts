import { describe, expect, test } from "@jest/globals";
import {
  OpenStackMaintainedPart,
  OpenStackMaintenancePartKind,
  getOpenStackMachineOfHost,
  isOpenStackSeriesOnMaintainedPart,
  readOpenStackMaintenanceParts,
} from "../../../Types/OpenStack/OpenStackMaintenancePart";

/*
 * WHAT A MAINTENANCE EVENT ON A HOST QUIETS.
 *
 * Quieting too much hides an outage, so a series that can't be placed on the host is never quieted, and
 * real clouds name one machine several ways (recorded: a nova-compute says compute-01, its hypervisor
 * compute-01.example.internal, and a cinder-volume compute-01@lvmdriver-1).
 */
const REGION: string = "openstack.region.name";

function parts(
  hostNames: Array<string>,
  regionName: string | null = "RegionOne",
): Array<OpenStackMaintainedPart> {
  return [{ regionName, hostNames }];
}

describe("which series are on a part under maintenance", () => {
  test.each<[string, Record<string, string>, boolean]>([
    [
      "a nova-compute on it, by its short name",
      {
        hostname: "compute-01",
        service: "nova-compute",
        [REGION]: "RegionOne",
      },
      true,
    ],
    [
      "its hypervisor, by its full name",
      { hostname: "compute-01.example.internal", [REGION]: "RegionOne" },
      true,
    ],
    [
      "an instance series naming it",
      {
        hypervisor_hostname: "compute-01.example.internal",
        [REGION]: "RegionOne",
      },
      true,
    ],
    [
      "a cinder-volume on it, as host@backend",
      {
        hostname: "compute-01@lvmdriver-1",
        service: "cinder-volume",
        [REGION]: "RegionOne",
      },
      true,
    ],
    [
      "a cinder-volume's pool on it, as host@backend#pool",
      { hostname: "compute-01@lvm#pool", [REGION]: "RegionOne" },
      true,
    ],
    [
      "as ingest spells a resource attribute",
      {
        "resource.hostname": "compute-01",
        "resource.openstack.region.name": "RegionOne",
      },
      true,
    ],
    [
      "another host",
      {
        hostname: "compute-02",
        service: "nova-compute",
        [REGION]: "RegionOne",
      },
      false,
    ],
    [
      "a host whose name begins with this one's",
      { hostname: "compute-011", [REGION]: "RegionOne" },
      false,
    ],
    [
      "the same host name in another region",
      { hostname: "compute-01", [REGION]: "RegionTwo" },
      false,
    ],
    ["a series that says no region", { hostname: "compute-01" }, false],
    [
      "a series about a whole region, naming no machine",
      { [REGION]: "RegionOne", openstack_service: "compute" },
      false,
    ],
    ["a series with no labels at all", {}, false],
  ])(
    "%s",
    (_name: string, labels: Record<string, string>, expected: boolean) => {
      expect(
        isOpenStackSeriesOnMaintainedPart({
          labels,
          parts: parts(["compute-01.example.internal"]),
        }),
      ).toBe(expected);
    },
  );

  test("nothing under maintenance quiets nothing", () => {
    expect(
      isOpenStackSeriesOnMaintainedPart({
        labels: { hostname: "compute-01", [REGION]: "RegionOne" },
        parts: [],
      }),
    ).toBe(false);
  });

  test("a zone with no hosts in it quiets nothing", () => {
    expect(
      isOpenStackSeriesOnMaintainedPart({
        labels: { hostname: "compute-01", [REGION]: "RegionOne" },
        parts: parts([]),
      }),
    ).toBe(false);
  });

  test("a part that says no region takes only a series that says none", () => {
    expect(
      isOpenStackSeriesOnMaintainedPart({
        labels: { hostname: "compute-01" },
        parts: parts(["compute-01"], null),
      }),
    ).toBe(true);
    expect(
      isOpenStackSeriesOnMaintainedPart({
        labels: { hostname: "compute-01", [REGION]: "RegionOne" },
        parts: parts(["compute-01"], null),
      }),
    ).toBe(false);
  });

  test("an address is its own machine, not a name to shorten", () => {
    expect(getOpenStackMachineOfHost("10.0.0.5")).toBe("10.0.0.5");
    expect(
      isOpenStackSeriesOnMaintainedPart({
        labels: { hostname: "10.0.0.6", [REGION]: "RegionOne" },
        parts: parts(["10.0.0.5"]),
      }),
    ).toBe(false);
  });
});

describe("reading what an event says it is on", () => {
  const CLOUD: string = "11111111-1111-4111-8111-111111111111";

  test("keeps what is a part, normalized", () => {
    expect(
      readOpenStackMaintenanceParts([
        {
          openStackCloudId: CLOUD.toUpperCase(),
          kind: OpenStackMaintenancePartKind.Hypervisor,
          name: " compute-01 ",
          regionName: " RegionOne ",
        },
        {
          openStackCloudId: CLOUD,
          kind: OpenStackMaintenancePartKind.AvailabilityZone,
          name: "az-east",
        },
      ]),
    ).toEqual([
      {
        openStackCloudId: CLOUD,
        kind: OpenStackMaintenancePartKind.Hypervisor,
        name: "compute-01",
        regionName: "RegionOne",
      },
      {
        openStackCloudId: CLOUD,
        kind: OpenStackMaintenancePartKind.AvailabilityZone,
        name: "az-east",
        regionName: null,
      },
    ]);
  });

  test.each<[string, unknown]>([
    ["nothing", undefined],
    ["null", null],
    ["a string", "compute-01"],
    ["an object", { name: "compute-01" }],
    ["an array of nothing", [null, 1, "x", []]],
    ["no cloud", [{ kind: "Hypervisor", name: "compute-01" }]],
    ["no name", [{ openStackCloudId: CLOUD, kind: "Hypervisor" }]],
    [
      "an empty name",
      [{ openStackCloudId: CLOUD, kind: "Hypervisor", name: "  " }],
    ],
    [
      "a kind nothing reads",
      [{ openStackCloudId: CLOUD, kind: "Router", name: "r1" }],
    ],
  ])("%s is no part", (_name: string, value: unknown) => {
    expect(readOpenStackMaintenanceParts(value)).toEqual([]);
  });
});
