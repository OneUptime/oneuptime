import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import { OpenStackResourceBufferEntry } from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { isOpenStackApiClosedToThisCredential } from "../../../../Types/OpenStack/OpenStackOptionalServices";
import {
  OpenStackResourceKind,
  OpenStackServiceType,
} from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  RECORDED_AT,
  RecordedServiceScene,
  factsOfRow,
  namesOfRows,
  scanRecordedOtlp,
} from "../../../Helpers/OpenStackServiceRecording";
import {
  isAnythingFiring,
  readOpenStackTemplateOnRecording,
} from "../../../Types/Monitor/Utils/OpenStackTemplateOnRecording";
import {
  assessOpenStackResource,
  getOpenStackAttentionItems,
} from "../../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import { getOpenStackRowsAsThisCredentialReadsThem } from "../../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackServices";
import { ResourceAttentionSeverity } from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { buildOpenStackTopology } from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/OpenStackTopology";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
} from "../../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";

/*
 * SWIFT, ON WHAT A REAL CLOUD SAID.
 *
 * Tests/Ops/openstack-e2e/services-designate-barbican-swift.sh ran Swift on a real stable/2026.1 DevStack, with a
 * container in each of two projects, stopped its object server and then its proxy, and read the exporter at each
 * step. The exporter lists its credential's own project's containers, with no project label: that's what the
 * scenes here say, each got to on its own. How large a container is heading is judged only on made-up readings,
 * in OpenStackAlertTemplates.test.ts, because no runner holds a week of growth.
 */

const GROUP: string = "services-designate-barbican-swift";

function scene(name: string): RecordedServiceScene {
  return new RecordedServiceScene({ group: GROUP, scene: `swift-${name}` });
}

function apiOf(recorded: RecordedServiceScene): OpenStackResource {
  return recorded.api(OpenStackServiceType.ObjectStore) as OpenStackResource;
}

function containers(recorded: RecordedServiceScene): Array<OpenStackResource> {
  return recorded.ofKind(OpenStackResourceKind.ObjectContainer);
}

function attentionOf(recorded: RecordedServiceScene): Array<string> {
  return getOpenStackAttentionItems({ rows: recorded.rows, now: RECORDED_AT })
    .map((item: { name: string }): string => {
      return item.name;
    })
    .sort();
}

describe("swift-baseline: containers in two projects", () => {
  const recorded: RecordedServiceScene = scene("baseline");

  test("only the credential's own project's container has a row, with no project: Swift said no more", () => {
    expect(namesOfRows(containers(recorded))).toEqual(["ou-container-admin"]);
    expect(containers(recorded)[0]?.openStackProjectId ?? null).toBe(null);
    expect(containers(recorded)[0]?.regionName).toBe("RegionOne");
  });

  test("it reads what the account's own list says of it", () => {
    const answer: JSONArray = recorded.readApi(
      "swift-account",
    ) as unknown as JSONArray;
    const said: JSONObject = answer[0] as JSONObject;
    const row: OpenStackResource = containers(recorded)[0]!;

    expect(row.name).toBe(said["name"]);
    expect(row.diskAllocatedBytes).toBe(said["bytes"]);
    expect(factsOfRow(row)["objectCount"]).toBe(said["count"]);
  });

  test("a container in one region doesn't stand in for one of that name in another", () => {
    expect(containers(recorded)[0]?.externalId).toBe(
      "RegionOne/ou-container-admin",
    );
  });

  test("another project's account was refused, which is why this is never the whole cloud's", () => {
    expect(recorded.readApiStatus("swift-account-ou-payments-as-admin")).toBe(
      403,
    );
  });

  test("its API reads up, and nothing needs anyone", async () => {
    expect(apiOf(recorded).status).toBe("up");
    expect(attentionOf(recorded)).toEqual([]);
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-object-store-api-down",
          series: recorded.series,
        }),
      ),
    ).toBe(false);
  });
});

describe("swift-object-down: its object server stopped, with its proxy still answering", () => {
  const recorded: RecordedServiceScene = scene("object-down");

  test("nothing the exporter says changes: its lists come from the account and container servers", () => {
    expect(apiOf(recorded).status).toBe("up");
    expect(namesOfRows(containers(recorded))).toEqual(["ou-container-admin"]);
    expect(attentionOf(recorded)).toEqual([]);
  });
});

describe("swift-api-down: its proxy stopped", () => {
  const recorded: RecordedServiceScene = scene("api-down");

  test("only `up` is left, and it reads 0: exactly what a credential it refuses reads", () => {
    expect(
      recorded.series.map((one: { name: string }): string => {
        return one.name;
      }),
    ).toEqual(["openstack_object_store_up"]);
    expect(apiOf(recorded).status).toBe("down");
    expect(isOpenStackApiClosedToThisCredential(apiOf(recorded))).toBe(true);
  });

  test("once it has answered, that's Object Storage API Down, with no one telling it to", async () => {
    const answered: OpenStackResource = apiOf(recorded);
    answered.facts = {
      ...factsOfRow(answered),
      vouchedAt: RECORDED_AT.toISOString(),
    };

    expect(isOpenStackApiClosedToThisCredential(answered)).toBe(false);
    expect(
      assessOpenStackResource({ row: answered, now: RECORDED_AT }).severity,
    ).toBe(ResourceAttentionSeverity.Critical);
    expect(
      isAnythingFiring(
        await readOpenStackTemplateOnRecording({
          templateId: "openstack-object-store-api-down",
          series: [
            ...recorded.series,
            { name: "up", labels: {}, value: 1 } as (typeof recorded.series)[0],
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("swift-reseller-admin: a credential allowed into any account", () => {
  const recorded: RecordedServiceScene = scene("reseller-admin");

  test("the exporter still lists only its own project's: reading the rest takes asking for each", () => {
    expect(namesOfRows(containers(recorded))).toEqual(["ou-container-admin"]);
    expect(recorded.readApiStatus("swift-account-ou-payments-as-admin")).toBe(
      200,
    );
  });
});

describe("what each credential got", () => {
  function reader(level: string): RecordedServiceScene {
    return new RecordedServiceScene({
      group: GROUP,
      scene: "access-check/exporter",
      exporterFolder: level,
    });
  }

  test("an admin reads its own project's containers", () => {
    const recorded: RecordedServiceScene = reader("admin");

    expect(apiOf(recorded).status).toBe("up");
    expect(namesOfRows(containers(recorded))).toEqual(["ou-container-admin"]);
  });

  test.each(["reader", "monitoring-role", "role-on-a-project"])(
    "%s is refused, so it reads closed until it has answered once",
    (level: string) => {
      const recorded: RecordedServiceScene = reader(level);
      const api: OpenStackResource = apiOf(recorded);

      expect(api.status).toBe("down");
      expect(isOpenStackApiClosedToThisCredential(api)).toBe(true);

      const [read] = getOpenStackRowsAsThisCredentialReadsThem({
        rows: [api],
        apis: [api],
        workers: [],
      });
      expect(read?.status).toBe("closed");
      expect(
        assessOpenStackResource({
          row: read as OpenStackResource,
          now: RECORDED_AT,
        }).severity,
      ).toBe(null);
    },
  );
});

describe("Topology", () => {
  function nodesOf(
    rows: Array<OpenStackResource>,
  ): Array<ResourceTopologyNode> {
    const graph: ResourceTopologyGraph = buildOpenStackTopology({
      cloud: { id: "cloud-id", name: "devstack", lastSeenAt: RECORDED_AT },
      rows,
      now: RECORDED_AT,
    });
    return Array.from(graph.nodes.values()).filter(
      (node: ResourceTopologyNode): boolean => {
        return node.kind === "openstack.object-container";
      },
    );
  }

  test("draws each container under its region's Storage", () => {
    const [node] = nodesOf(scene("baseline").rows);

    expect(node?.name).toBe("ou-container-admin");
    expect(node?.parentId).toBe("section:RegionOne/storage");
    expect(node?.health).toBe("healthy");
  });

  test("a cloud without Swift has no such node", () => {
    expect(nodesOf([])).toEqual([]);
  });
});

describe("what the agent's real collector sent", () => {
  const scanned: {
    entries: Array<OpenStackResourceBufferEntry>;
    scrapes: Array<{ service: string; up: number; samples: number }>;
  } = scanRecordedOtlp(GROUP);

  test("a container reads the same as it does from the exporter's text", () => {
    const row: OpenStackResourceBufferEntry | undefined = scanned.entries.find(
      (entry: OpenStackResourceBufferEntry): boolean => {
        return entry.kind === OpenStackResourceKind.ObjectContainer;
      },
    );

    expect(row?.regionName).toBe("RegionOne");
    expect(row?.name).toBeTruthy();
    expect(typeof row?.facts["objectCount"]).toBe("number");
  });
});
