import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import OpenStackResourceService from "../../../../Server/Services/OpenStackResourceService";
import OpenStackMachinesSeen, {
  getMachinesSeenWith,
  keepSeriesOfMachines,
} from "../../../../Server/Utils/OpenStack/OpenStackMachinesSeen";
import MetricSeriesResult from "../../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import ObjectID from "../../../../Types/ObjectID";
import { OPENSTACK_NETWORK_FACTS } from "../../../../Types/OpenStack/OpenStackControlPlane";

const SEEN: string = OPENSTACK_NETWORK_FACTS.OvsSeenAt;
const AT: string = "2026-11-04T12:00:00.000Z";

function row(
  regionName: string,
  name: string,
  facts: Record<string, unknown>,
): OpenStackResource {
  return Object.assign(new OpenStackResource(), { regionName, name, facts });
}

function series(region: string, host: string): MetricSeriesResult {
  return {
    fingerprint: `${region}/${host}`,
    labels: { "openstack.region.name": region, openstack_exporter_host: host },
    aggregatedResults: [],
  };
}

function hosts(kept: Array<MetricSeriesResult>): Array<string> {
  return kept.map((one: MetricSeriesResult): string => {
    return one.fingerprint;
  });
}

describe("which machines can lose something", () => {
  test("only those whose row says it was seen there", () => {
    expect(
      Array.from(
        getMachinesSeenWith({
          fact: SEEN,
          rows: [
            row("RegionOne", "10.0.0.21", { [SEEN]: AT }),
            // A host of only OVN's databases: never had it.
            row("RegionOne", "10.0.0.11", {
              [OPENSTACK_NETWORK_FACTS.OvsDatabaseSeenAt]: AT,
            }),
            row("RegionOne", "10.0.0.12", {}),
            row("RegionTwo", "10.0.0.21", { [SEEN]: AT }),
          ],
        }),
      ).sort(),
    ).toEqual(["RegionOne/10.0.0.21", "RegionTwo/10.0.0.21"]);
  });

  test.each([
    ["had it", "RegionOne", "10.0.0.21", true],
    ["never had it", "RegionOne", "10.0.0.11", false],
    [
      "the same address in another region, which is another machine",
      "RegionTwo",
      "10.0.0.21",
      false,
    ],
  ])(
    "a machine that %s",
    (_what: string, region: string, host: string, kept: boolean) => {
      expect(
        hosts(
          keepSeriesOfMachines({
            series: [series(region, host)],
            machines: new Set<string>(["RegionOne/10.0.0.21"]),
          }),
        ),
      ).toEqual(kept ? [`${region}/${host}`] : []);
    },
  );

  test("a series that names no machine is about no machine that had it", () => {
    expect(
      keepSeriesOfMachines({
        series: [
          {
            fingerprint: "region",
            labels: { "openstack.region.name": "RegionOne" },
            aggregatedResults: [],
          },
        ],
        machines: new Set<string>(["RegionOne/10.0.0.21"]),
      }),
    ).toEqual([]);
  });
});

describe("reading the cloud's inventory", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads that cloud's own control plane rows", async () => {
    const cloudId: ObjectID = ObjectID.generate();
    const projectId: ObjectID = ObjectID.generate();

    jest.spyOn(OpenStackCloudService, "findOneBy").mockResolvedValue({
      id: cloudId,
    } as never);

    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackResourceService, "findBy")
      .mockResolvedValue([
        row("RegionOne", "10.0.0.21", { [SEEN]: AT }),
      ] as never);

    expect(
      hosts(
        await OpenStackMachinesSeen.keepMachinesSeenWith({
          projectId,
          cloudIdentifier: "production",
          fact: SEEN,
          series: [
            series("RegionOne", "10.0.0.21"),
            series("RegionOne", "10.0.0.11"),
          ],
        }),
      ),
    ).toEqual(["RegionOne/10.0.0.21"]);

    expect(
      (findBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({
      projectId,
      openStackCloudId: cloudId,
      kind: "ControlPlane",
    });
  });

  test("a cloud it cannot find has no machine that had anything", async () => {
    jest
      .spyOn(OpenStackCloudService, "findOneBy")
      .mockResolvedValue(null as never);

    expect(
      await OpenStackMachinesSeen.keepMachinesSeenWith({
        projectId: ObjectID.generate(),
        cloudIdentifier: "gone",
        fact: SEEN,
        series: [series("RegionOne", "10.0.0.21")],
      }),
    ).toEqual([]);
  });

  test("a read that fails stops the evaluation, and judges nobody", async () => {
    jest
      .spyOn(OpenStackCloudService, "findOneBy")
      .mockRejectedValue(new Error("Postgres went away") as never);

    await expect(
      OpenStackMachinesSeen.keepMachinesSeenWith({
        projectId: ObjectID.generate(),
        cloudIdentifier: "production",
        fact: SEEN,
        series: [series("RegionOne", "10.0.0.21")],
      }),
    ).rejects.toThrow("Postgres went away");
  });
});
