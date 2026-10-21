import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "Common/Types/ObjectID";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  keyForVMwareVCenter,
  INVENTORY_ENTITY_IDENTITY_ATTRIBUTE,
} from "Common/Utils/Telemetry/EntityKey";
import {
  OpenIssueRecord,
  attachOpenIssues,
  readSeriesLabel,
  sameName,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyIssues";
import {
  formatTopologyBytes,
  formatTopologyPercent,
  isRecent,
  toFiniteNumber,
  toTopologyDate,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyFormat";
import {
  formatStatusWord,
  healthOfStatusWord,
} from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyStatusWords";
import { ResourceTopologyIssue } from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import * as Links from "../../FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyLinks";

/*
 * What every product's topology shares: reading an incident's labels the
 * way ingest writes them and pinning it to one part, the numbers on the
 * cards, status words read as health, and the links between a resource's
 * topology and the master Topology.
 */

const mockGetList: jest.Mock = jest.fn();
const getList: jest.Mock = mockGetList;
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
      },
    },
  };
});

jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "10000000-0000-4000-8000-000000000001";
          },
        };
      },
    },
  };
});

const NOW: Date = new Date("2026-10-21T12:00:00Z");

function record(
  id: string,
  type: "incident" | "alert",
  createdAt: Date | null,
): OpenIssueRecord {
  return {
    type: type,
    id: id,
    title: id,
    number: id,
    severityName: "High",
    severityColor: null,
    stateName: "Created",
    createdAt: createdAt,
    seriesLabels: null,
    relatedIds: {},
  };
}

afterEach(() => {
  getList.mockReset();
});

describe("reading an incident's labels", () => {
  test("as ingest writes them: as they are, or resource.-prefixed", () => {
    expect(readSeriesLabel({ "k8s.pod.name": "a" }, "k8s.pod.name")).toBe("a");
    expect(
      readSeriesLabel({ "resource.k8s.pod.name": " b " }, "k8s.pod.name"),
    ).toBe("b");
    expect(readSeriesLabel({ vmid: 100 }, "vmid")).toBe("100");
  });

  test("blank, missing or odd values read as missing", () => {
    expect(readSeriesLabel({ name: "  " }, "name")).toBeNull();
    expect(readSeriesLabel({ name: Number.NaN }, "name")).toBeNull();
    expect(readSeriesLabel(null, "name")).toBeNull();
    expect(readSeriesLabel({ name: { nested: true } }, "name")).toBeNull();
  });

  test("names compare as people type them", () => {
    expect(sameName(" Web-01 ", "web-01")).toBe(true);
    expect(sameName("web-01", "web-02")).toBe(false);
    expect(sameName("", "")).toBe(false);
    expect(sameName(null, "x")).toBe(false);
  });
});

describe("pinning incidents and alerts to parts", () => {
  test("each lands once, on the part located, else the resource", () => {
    const placed: Map<string, Array<ResourceTopologyIssue>> = attachOpenIssues({
      records: [
        record("1", "alert", NOW),
        record("1", "alert", NOW),
        record("2", "incident", NOW),
        record("3", "alert", NOW),
      ],
      rootId: "root",
      locate: (item: OpenIssueRecord): string | null => {
        if (item.id === "3") {
          throw new Error("labels it cannot read");
        }

        return item.id === "1" ? "part" : null;
      },
    });

    expect(
      placed.get("part")!.map((item: ResourceTopologyIssue) => {
        return item.id;
      }),
    ).toEqual(["1"]);
    // A record the topology cannot place is still the resource's.
    expect(
      placed.get("root")!.map((item: ResourceTopologyIssue): string => {
        return item.id;
      }),
    ).toEqual(["2", "3"]);
  });

  test("on a part, incidents come first, each newest first", () => {
    const placed: Map<string, Array<ResourceTopologyIssue>> = attachOpenIssues({
      records: [
        record("old-alert", "alert", new Date(NOW.getTime() - 1000)),
        record("new-alert", "alert", NOW),
        record("old-incident", "incident", new Date(NOW.getTime() - 5000)),
        record("undated-incident", "incident", null),
        record("new-incident", "incident", NOW),
      ],
      rootId: "root",
      locate: (): string => {
        return "part";
      },
    });

    expect(
      placed.get("part")!.map((item: ResourceTopologyIssue): string => {
        return item.id;
      }),
    ).toEqual([
      "new-incident",
      "old-incident",
      "undated-incident",
      "new-alert",
      "old-alert",
    ]);
  });
});

describe("numbers on the cards", () => {
  test("inventory columns arrive as numbers or strings", () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber("42.5")).toBe(42.5);
    expect(toFiniteNumber("")).toBeNull();
    expect(toFiniteNumber("n/a")).toBeNull();
    expect(toFiniteNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(toFiniteNumber(null)).toBeNull();
  });

  test("percents are whole on a card and one decimal in a sentence", () => {
    expect(formatTopologyPercent(45.4)).toBe("45%");
    expect(formatTopologyPercent(92.14, 1)).toBe("92.1%");
    expect(formatTopologyPercent(null)).toBe("—");
  });

  test("sizes are in binary units", () => {
    expect(formatTopologyBytes(512)).toBe("512 B");
    expect(formatTopologyBytes(1536)).toBe("1.5 KiB");
    expect(formatTopologyBytes(10 * 1024 ** 3)).toBe("10.0 GiB");
    expect(formatTopologyBytes(200 * 1024 ** 4)).toBe("200 TiB");
    expect(formatTopologyBytes(undefined)).toBe("—");
  });

  test("a date is recent when it is no older than the age given", () => {
    expect(isRecent(new Date(NOW.getTime() - 1000), NOW, 5000)).toBe(true);
    expect(isRecent(new Date(NOW.getTime() - 6000), NOW, 5000)).toBe(false);
    expect(isRecent("2026-10-21T11:59:59Z", NOW, 5000)).toBe(true);
    expect(isRecent(null, NOW, 5000)).toBe(false);
    expect(toTopologyDate("not a date")).toBeNull();
  });
});

describe("status words", () => {
  test("read as the product's resource tables colour them", () => {
    expect(healthOfStatusWord("Running")).toBe("healthy");
    expect(healthOfStatusWord("restarting")).toBe("warning");
    expect(healthOfStatusWord("CrashLoopBackOff")).toBe("critical");
    expect(healthOfStatusWord("exited")).toBe("off");
    expect(healthOfStatusWord("powered off")).toBe("off");
    expect(healthOfStatusWord("something new")).toBeNull();
    expect(healthOfStatusWord("")).toBeNull();
  });

  test("written for a person", () => {
    expect(formatStatusWord("not_installed")).toBe("Not installed");
    expect(formatStatusWord("ok")).toBe("OK");
    expect(formatStatusWord("running")).toBe("Running");
    expect(formatStatusWord(undefined)).toBe("");
  });
});

describe("links between a resource's topology and the master Topology", () => {
  test("the products with a topology of their own", () => {
    for (const type of [
      EntityType.VMwareVCenter,
      EntityType.KubernetesCluster,
      EntityType.Host,
      EntityType.DockerHost,
      EntityType.PodmanHost,
      EntityType.DockerSwarmCluster,
      EntityType.ProxmoxCluster,
      EntityType.CephCluster,
      EntityType.StorageArray,
    ]) {
      expect(Links.hasResourceTopology(type)).toBe(true);
    }

    expect(Links.hasResourceTopology(EntityType.Service)).toBe(false);
    expect(Links.hasResourceTopology(undefined)).toBe(false);
  });

  test("the master Topology opens on the resource, as a map", () => {
    const key: string = keyForVMwareVCenter(PROJECT_ID, "vcenter-prod");
    const route: string = Links.masterTopologyRouteFor(key).toString();

    expect(route).toContain("/topology/overview?");
    expect(route).toContain("tab=Infrastructure");
    expect(route).toContain(`infraFocus=${encodeURIComponent(key)}`);
    expect(route).toContain("infraView=map");
  });

  test("a vCenter on the master map finds its row by the name it was keyed by", async () => {
    getList.mockImplementation(async (): Promise<unknown> => {
      return {
        data: [{ _id: new ObjectID("31000000-0000-4000-8000-000000000001") }],
      };
    });

    const link: Awaited<ReturnType<typeof Links.resolveResourceTopologyLink>> =
      await Links.resolveResourceTopologyLink({
        entityType: EntityType.VMwareVCenter,
        displayName: "ignored",
        identifyingAttributes: { "vmware.vcenter.name": " vcenter-prod " },
      });

    expect(link?.text).toBe("Open vCenter topology");
    expect(link?.route.toString()).toContain(
      "/vmware/31000000-0000-4000-8000-000000000001/topology",
    );
    const request: { query: Record<string, unknown> } = getList.mock
      .calls[0]![0] as { query: Record<string, unknown> };

    expect(request.query["name"]).toBe("vcenter-prod");
    expect(String(request.query["projectId"])).toBe(PROJECT_ID);
  });

  test("a Kubernetes cluster by its identifier column", async () => {
    getList.mockImplementation(async (): Promise<unknown> => {
      return {
        data: [{ _id: new ObjectID("32000000-0000-4000-8000-000000000001") }],
      };
    });

    await Links.resolveResourceTopologyLink({
      entityType: EntityType.KubernetesCluster,
      identifyingAttributes: { "k8s.cluster.name": "prod-eu" },
    });

    const request: { query: Record<string, unknown> } = getList.mock
      .calls[0]![0] as { query: Record<string, unknown> };

    expect(request.query["clusterIdentifier"]).toBe("prod-eu");
  });

  test("a mirrored Docker host is its own row: no lookup", async () => {
    const link: Awaited<ReturnType<typeof Links.resolveResourceTopologyLink>> =
      await Links.resolveResourceTopologyLink({
        entityType: EntityType.DockerHost,
        identifyingAttributes: {
          [INVENTORY_ENTITY_IDENTITY_ATTRIBUTE]:
            "34000000-0000-4000-8000-000000000001",
        },
      });

    expect(getList).not.toHaveBeenCalled();
    expect(link?.route.toString()).toContain(
      "/docker/34000000-0000-4000-8000-000000000001/topology",
    );
  });

  test("no row, no permission, or another kind of entity: no link", async () => {
    getList.mockImplementation(async (): Promise<unknown> => {
      return { data: [] };
    });

    expect(
      await Links.resolveResourceTopologyLink({
        entityType: EntityType.Host,
        identifyingAttributes: { "host.name": "gone" },
      }),
    ).toBeNull();

    getList.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to read this.");
    });

    expect(
      await Links.resolveResourceTopologyLink({
        entityType: EntityType.Host,
        identifyingAttributes: { "host.name": "web-01" },
      }),
    ).toBeNull();
    expect(
      await Links.resolveResourceTopologyLink({
        entityType: EntityType.Service,
        displayName: "checkout",
      }),
    ).toBeNull();
    expect(
      await Links.resolveResourceTopologyLink({
        entityType: EntityType.PodmanHost,
      }),
    ).toBeNull();
  });
});
