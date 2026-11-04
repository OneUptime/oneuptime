import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  configure,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import OpenStackCloudImageDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/ImageDetail";
import OpenStackCloudImages from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Images";
import OpenStackCloudSnapshots from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Snapshots";
import OpenStackCloudStoragePoolDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/StoragePoolDetail";
import OpenStackCloudStoragePools from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/StoragePools";
import OpenStackCloudVolumeDetail from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/VolumeDetail";
import OpenStackCloudVolumes from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Volumes";
import { OpenStackRecording } from "../../Helpers/OpenStackRecordings";
import {
  CLOUD_PATH,
  Row,
  attentionRowsOf,
  partPath,
  renderPage,
  resetServer,
  server,
  settle,
  tableRow,
  tile,
} from "./OpenStackPartHarness";

/*
 * The storage pages, rendered for real over the real tables and part cards, with only the
 * network replaced: volumes, pools, snapshots, backups and images. A volume in error and
 * one stuck reach Needs attention by name, a pool past its line says so at the templates'
 * numbers, and the page says which of what it shows comes from where: the agent's exporter
 * only counts snapshots, and doesn't say which pool a volume is on.
 */

configure({ asyncUtilTimeout: 30000 });

jest.setTimeout(300000);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "80000000-0000-4000-8000-000000000001";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceMetricsTab",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="resource-metrics-tab" />;
      },
    };
  },
);

const GIB: number = 1024 * 1024 * 1024;
const VOLUME_ID: string = "aaaaaaaa-2222-4222-8222-000000000001";
const INSTANCE_ID: string = "bbbbbbbb-2222-4222-8222-000000000001";
const IMAGE_ID: string = "cccccccc-2222-4222-8222-000000000001";
const POOL_NAME: string = "compute-01@lvmdriver-1#lvmdriver-1";
const POOL_ID: string = `RegionOne/${POOL_NAME}`;
const PROJECT_A: string = "ffffffff-0000-4000-8000-00000000000a";

let nextId: number = 1;

function id(): string {
  return `6c1b2a3d-4e5f-4a6b-8c7d-${String(nextId++).padStart(12, "0")}`;
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

function volumeRow(fields: Row = {}): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.Volume,
    name: "data",
    externalId: VOLUME_ID,
    regionName: "RegionOne",
    availabilityZone: "nova",
    openStackProjectId: PROJECT_A,
    status: "in-use",
    stateChangedAt: minutesAgo(5),
    diskCapacityBytes: 10 * GIB,
    facts: { volumeType: "ceph", attachedToInstance: INSTANCE_ID },
    lastSeenAt: new Date(),
    ...fields,
  };
}

function instanceRow(): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.Instance,
    name: "web-01",
    externalId: INSTANCE_ID,
    regionName: "RegionOne",
    status: "ACTIVE",
    lastSeenAt: new Date(),
  };
}

function poolRow(fields: Row = {}): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.StoragePool,
    name: POOL_NAME,
    externalId: POOL_ID,
    regionName: "RegionOne",
    diskCapacityBytes: 100 * GIB,
    diskAllocatedBytes: 50 * GIB,
    facts: {
      backend: "lvmdriver-1",
      vendor: "Open Source",
      freeBytes: 50 * GIB,
    },
    lastSeenAt: new Date(),
    ...fields,
  };
}

function poolAt(percent: number): Row {
  return poolRow({
    diskAllocatedBytes: percent * GIB,
    facts: {
      backend: "lvmdriver-1",
      vendor: "Open Source",
      freeBytes: (100 - percent) * GIB,
    },
  });
}

function imageRow(fields: Row = {}): Row {
  return {
    _id: id(),
    kind: OpenStackResourceKind.Image,
    name: "cirros",
    externalId: IMAGE_ID,
    regionName: "RegionOne",
    openStackProjectId: PROJECT_A,
    status: "active",
    stateChangedAt: minutesAgo(5),
    diskCapacityBytes: 21692416,
    facts: {
      visibility: "public",
      isHidden: false,
      createdAtSeconds: 1793789784,
    },
    lastSeenAt: new Date(),
    ...fields,
  };
}

beforeEach(() => {
  resetServer();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Volumes list", () => {
  test("its status in Cinder's word, type, size, whose it is, and a step to what holds it", async () => {
    server.rows = [volumeRow(), instanceRow()];

    await renderPage(OpenStackCloudVolumes, "/volumes");

    const row: HTMLElement = (await screen.findByText("data")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("in-use")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    expect(within(row).getByText("10 GiB")).toBeInTheDocument();
    expect(within(row).getByText("ceph")).toBeInTheDocument();
    expect(within(row).getByText("5m")).toBeInTheDocument();
    expect(
      (await within(row).findByText("web-01")).closest("a"),
    ).toHaveAttribute("href", `${CLOUD_PATH}/instances/${INSTANCE_ID}`);
  });

  test("a stuck one reads Stuck, and for how long", async () => {
    server.rows = [
      volumeRow({
        status: "attaching",
        stateChangedAt: minutesAgo(45),
        facts: {},
      }),
    ];

    await renderPage(OpenStackCloudVolumes, "/volumes");

    const row: HTMLElement = (await screen.findByText("data")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("Stuck")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(within(row).getByText("attaching for 45m")).toBeInTheDocument();
  });

  test("one under the line reads as what it is", async () => {
    server.rows = [
      volumeRow({
        status: "attaching",
        stateChangedAt: minutesAgo(5),
        facts: {},
      }),
    ];

    await renderPage(OpenStackCloudVolumes, "/volumes");

    const row: HTMLElement = (await screen.findByText("data")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("attaching")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
  });

  test.each(["error", "error_deleting", "error_restoring"])(
    "%s reads as failed, in red, and says it once",
    async (status: string) => {
      server.rows = [volumeRow({ status, facts: {} })];

      await renderPage(OpenStackCloudVolumes, "/volumes");

      const row: HTMLElement = (await screen.findByText("data")).closest(
        "tr",
      ) as HTMLElement;
      expect(within(row).getByText(status)).toHaveAttribute(
        "data-tone",
        "danger",
      );
      expect(within(row).queryByText(`In ${status}`)).not.toBeInTheDocument();
    },
  );

  test("which types are in use, how many of each and what they add up to, counted on the server", async () => {
    server.rows = [
      volumeRow(),
      volumeRow({
        externalId: "aaaaaaaa-2222-4222-8222-000000000002",
        name: "more",
        diskCapacityBytes: 20 * GIB,
      }),
      volumeRow({
        externalId: "aaaaaaaa-2222-4222-8222-000000000003",
        name: "fast",
        facts: { volumeType: "ssd" },
      }),
    ];

    await renderPage(OpenStackCloudVolumes, "/volumes");

    const types: Array<string> = (
      await screen.findAllByTestId("openstack-volume-type")
    ).map((type: HTMLElement) => {
      return type.textContent || "";
    });
    expect(types).toEqual(
      expect.arrayContaining(["ceph2 volumes30 GiB", "ssd1 volume10 GiB"]),
    );
  });

  test("two regions' volumes of one type add up, and a region chosen reads only itself", async () => {
    server.rows = [
      volumeRow({ _id: id(), externalId: "v-1", diskCapacityBytes: 10 * GIB }),
      volumeRow({
        _id: id(),
        externalId: "v-2",
        regionName: "RegionTwo",
        diskCapacityBytes: 20 * GIB,
      }),
    ];

    await renderPage(OpenStackCloudVolumes, "/volumes");
    expect(
      (await screen.findAllByTestId("openstack-volume-type")).map(
        (type: HTMLElement) => {
          return type.textContent;
        },
      ),
    ).toEqual([expect.stringContaining("2 volumes")]);
    cleanup();

    await renderPage(OpenStackCloudVolumes, "/volumes?region=RegionTwo");
    expect(
      (await screen.findAllByTestId("openstack-volume-type")).map(
        (type: HTMLElement) => {
          return type.textContent;
        },
      ),
    ).toEqual([expect.stringMatching(/1 volume.*20 GiB/)]);
  });

  test("no volumes and a read of the types that failed leave the card out", async () => {
    server.failPosts.add("counts");

    await renderPage(OpenStackCloudVolumes, "/volumes");

    expect(
      await screen.findByText("No volumes reported yet"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-volume-types")).toBeNull();
  });
});

describe("a volume's page", () => {
  const PATH: string = partPath("volumes", VOLUME_ID);

  test("one forced into error reaches Needs attention by name, and says why", async () => {
    server.rows = [volumeRow({ status: "error", facts: {} })];

    await renderPage(OpenStackCloudVolumeDetail, PATH);

    expect(
      await screen.findByTestId("openstack-volume-explanation"),
    ).toHaveTextContent(/Cinder says this volume failed/);
    expect(attentionRowsOf("openstack-volume-attention")).toEqual([
      "This volume: In error",
    ]);
    expect(
      screen.getByTestId("openstack-volume-hero-status"),
    ).toHaveTextContent("error");
  });

  test("one left stuck reaches it too, and says for how long", async () => {
    server.rows = [
      volumeRow({ status: "deleting", stateChangedAt: minutesAgo(90) }),
    ];

    await renderPage(OpenStackCloudVolumeDetail, PATH);

    expect(
      await screen.findByTestId("openstack-volume-explanation"),
    ).toHaveTextContent(/longer than it should take/);
    expect(attentionRowsOf("openstack-volume-attention")).toEqual([
      "This volume: deleting for 90m",
    ]);
  });

  test("a fine one has nothing to say, and links to what holds it by name", async () => {
    server.rows = [volumeRow(), instanceRow()];

    await renderPage(OpenStackCloudVolumeDetail, PATH);

    await screen.findByTestId("openstack-volume-overview");
    expect(screen.queryByTestId("openstack-volume-explanation")).toBeNull();
    expect(screen.queryByTestId("openstack-volume-attention")).toBeNull();
    expect(tile("openstack-volume-tiles", "Size")).toHaveTextContent("10 GiB");
    const attached: HTMLElement = screen.getByTestId(
      "openstack-volume-details-attached-to",
    );
    expect(
      (await within(attached).findByText("web-01")).closest("a"),
    ).toHaveAttribute("href", `${CLOUD_PATH}/instances/${INSTANCE_ID}`);
  });

  test("a spare one is attached to nothing", async () => {
    server.rows = [
      volumeRow({ status: "available", facts: { attachedToInstance: null } }),
    ];

    await renderPage(OpenStackCloudVolumeDetail, PATH);

    expect(
      await screen.findByTestId("openstack-volume-details-attached-to"),
    ).toHaveTextContent("Nothing");
  });

  test("which pool it is on isn't collected, and it says so rather than leaving it out", async () => {
    server.rows = [volumeRow()];

    await renderPage(OpenStackCloudVolumeDetail, PATH);

    expect(
      await screen.findByTestId("openstack-volume-details-pool"),
    ).toHaveTextContent(/Not collected/);
  });

  test("its alerts are the volume templates", async () => {
    server.rows = [volumeRow()];

    await renderPage(OpenStackCloudVolumeDetail, PATH);

    expect(
      within(await screen.findByTestId("openstack-volume-alerts"))
        .getAllByTestId("openstack-volume-alerts-item")
        .map((item: HTMLElement) => {
          return item.querySelector("div.font-medium")?.textContent;
        }),
    ).toEqual(["Volumes in Error", "Volume Stuck"]);
  });

  test("a read that failed says so", async () => {
    server.failKinds.add(OpenStackResourceKind.Volume);

    await renderPage(OpenStackCloudVolumeDetail, PATH);

    expect(
      await screen.findByTestId("openstack-part-read-error"),
    ).toHaveTextContent("Couldn't load this volume");
  });
});

describe("the Storage Pools list", () => {
  test.each([
    [50, "Has room", "positive"],
    [85, "Has room", "positive"],
    [86, "Filling up", "warning"],
    [95, "Filling up", "warning"],
    [96, "Nearly full", "danger"],
  ])(
    "at %i%% it reads %s, at the templates' numbers",
    async (percent: number, word: string, tone: string) => {
      server.rows = [poolAt(percent)];

      await renderPage(OpenStackCloudStoragePools, "/storage-pools");

      const row: HTMLElement = (await screen.findByText(POOL_NAME)).closest(
        "tr",
      ) as HTMLElement;
      expect(within(row).getByText(word)).toHaveAttribute("data-tone", tone);
      expect(
        within(row).getByText(`${percent} GiB of 100 GiB`),
      ).toBeInTheDocument();
    },
  );

  test("with Cinder answering and none listed, it says this credential can't list them", async () => {
    server.rows = [
      {
        kind: OpenStackResourceKind.Api,
        name: "volume",
        externalId: "RegionOne/volume",
        status: "up",
      },
    ];

    await renderPage(OpenStackCloudStoragePools, "/storage-pools");

    expect(
      await screen.findByText("This credential can't list storage pools"),
    ).toBeInTheDocument();
  });
});

describe("a storage pool's page", () => {
  const PATH: string = partPath("storage-pools", POOL_ID);

  test("Used, Free and Growth Forecast tiles, on the shared pieces", async () => {
    const hour: number = 60 * 60 * 1000;
    const start: number = Date.now() - 23 * hour;
    server.rows = [poolAt(50)];
    server.history["openstack_cinder_pool_capacity_free_gb"] = Array.from(
      { length: 24 },
      (_: unknown, index: number) => {
        // Half a GiB an hour, so 100 hours from 50 free.
        return { time: start + index * hour, value: 61.5 - index * 0.5 };
      },
    );

    await renderPage(OpenStackCloudStoragePoolDetail, PATH);

    await screen.findByTestId("openstack-storage-pool-tiles");
    expect(tile("openstack-storage-pool-tiles", "Used")).toHaveTextContent(
      "50%50 GiB of 100 GiB",
    );
    expect(tile("openstack-storage-pool-tiles", "Free")).toHaveTextContent(
      "50 GiBof 100 GiB",
    );
    expect(
      await within(
        tile("openstack-storage-pool-tiles", "Growth Forecast"),
      ).findByText("~4 days"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-storage-pool-attention")).toBeNull();
  });

  test("with no history its forecast says so", async () => {
    server.rows = [poolAt(50)];

    await renderPage(OpenStackCloudStoragePoolDetail, PATH);

    await screen.findByTestId("openstack-storage-pool-tiles");
    expect(
      tile("openstack-storage-pool-tiles", "Growth Forecast"),
    ).toHaveTextContent("Not enough history");
  });

  test.each([
    [86, "warning", /filling up/],
    [96, "critical", /nearly full/],
  ])(
    "at %i%% it is %s, and says why",
    async (percent: number, severity: string, words: RegExp) => {
      server.rows = [poolAt(percent)];

      await renderPage(OpenStackCloudStoragePoolDetail, PATH);

      expect(
        await screen.findByTestId("openstack-storage-pool-explanation"),
      ).toHaveTextContent(words);
      expect(attentionRowsOf("openstack-storage-pool-attention")).toEqual([
        `This storage pool: ${percent}% full`,
      ]);
      expect(
        screen.getByTestId("openstack-storage-pool-attention-item"),
      ).toHaveAttribute("data-severity", severity);
    },
  );

  test("it can't list its volumes from what the agent collects, and says so, never '0 volumes'", async () => {
    server.rows = [poolAt(50)];

    await renderPage(OpenStackCloudStoragePoolDetail, PATH);

    const blast: HTMLElement = await screen.findByTestId(
      "openstack-storage-pool-blast",
    );
    expect(blast).toHaveAttribute("data-known", "false");
    expect(blast).toHaveTextContent(/Nothing collected says which pool/);
    expect(blast).not.toHaveTextContent(/0 volumes/);
  });

  test("its alerts are the two storage pool templates, and its details are what it reports", async () => {
    server.rows = [poolAt(50)];

    await renderPage(OpenStackCloudStoragePoolDetail, PATH);

    expect(
      within(await screen.findByTestId("openstack-storage-pool-alerts"))
        .getAllByTestId("openstack-storage-pool-alerts-item")
        .map((item: HTMLElement) => {
          return item.querySelector("div.font-medium")?.textContent;
        }),
    ).toEqual(["Storage Pool Warning", "Storage Pool Critical"]);
    expect(
      screen.getByTestId("openstack-storage-pool-details-backend"),
    ).toHaveTextContent("lvmdriver-1");
    expect(
      screen.getByTestId("openstack-storage-pool-details-vendor"),
    ).toHaveTextContent("Open Source");
  });

  test("its Metrics tab is there", async () => {
    server.rows = [poolAt(50)];

    await renderPage(OpenStackCloudStoragePoolDetail, PATH);
    fireEvent.click(await screen.findByRole("tab", { name: "Metrics" }));
    await settle();

    expect(screen.getByTestId("resource-metrics-tab")).toBeInTheDocument();
  });
});

describe("snapshots and backups", () => {
  test("through the agent: a count per region, no rows, and it says which is which", async () => {
    server.metrics["openstack_cinder_snapshots"] = [
      { group: "RegionOne", value: 3 },
      { group: "RegionTwo", value: 4 },
    ];

    await renderPage(OpenStackCloudSnapshots, "/snapshots");

    expect(
      await screen.findByTestId("openstack-snapshots-source"),
    ).toHaveTextContent(
      /counts snapshots per region and has nothing on backups/,
    );
    expect(tile("openstack-snapshots-tiles", "Snapshots")).toHaveTextContent(
      "7counted by the agent's exporter",
    );
    expect(tile("openstack-snapshots-tiles", "Backups")).toHaveTextContent(
      "Only a probe reports backups",
    );
    expect(
      await screen.findByText("No snapshots listed one by one"),
    ).toBeInTheDocument();
    expect(screen.getByText("No backups listed")).toBeInTheDocument();
    expect(screen.queryByTestId("openstack-snapshots-by-project")).toBeNull();
  });

  test("with a region chosen, its count, its rows and its totals are that region's alone", async () => {
    const snapshot: (
      externalId: string,
      regionName: string,
      diskCapacityBytes: number,
    ) => Row = (
      externalId: string,
      regionName: string,
      diskCapacityBytes: number,
    ): Row => {
      return {
        _id: id(),
        kind: OpenStackResourceKind.Snapshot,
        name: externalId,
        externalId,
        status: "available",
        regionName,
        openStackProjectId: PROJECT_A,
        diskCapacityBytes,
        stateChangedAt: minutesAgo(10),
        facts: {},
      };
    };
    server.rows = [
      snapshot("one-a", "RegionOne", 2 * GIB),
      snapshot("one-b", "RegionOne", 2 * GIB),
      snapshot("two-a", "RegionTwo", 3 * GIB),
    ];
    server.metrics["openstack_cinder_snapshots"] = [
      { group: "RegionOne", value: 2 },
      { group: "RegionTwo", value: 1 },
    ];

    await renderPage(OpenStackCloudSnapshots, "/snapshots?region=RegionTwo");

    expect(await screen.findByText("two-a")).toBeInTheDocument();
    expect(screen.queryByText("one-a")).not.toBeInTheDocument();
    expect(
      await screen.findByTestId("openstack-snapshots-by-project-row"),
    ).toHaveTextContent("1 item, 3.0 GiB");
    expect(tile("openstack-snapshots-tiles", "Snapshots")).toHaveTextContent(
      "1counted by the agent's exporter",
    );
    cleanup();

    // The whole cloud: one project in two regions is one line, added up.
    await renderPage(OpenStackCloudSnapshots, "/snapshots");
    expect(
      await screen.findByTestId("openstack-snapshots-by-project-row"),
    ).toHaveTextContent("3 items, 7.0 GiB");
    expect(tile("openstack-snapshots-tiles", "Snapshots")).toHaveTextContent(
      "3counted by the agent's exporter",
    );
  });

  test("through a probe: each one's status and age, a link to its volume, and totals per project", async () => {
    server.rows = [
      volumeRow(),
      {
        _id: id(),
        kind: OpenStackResourceKind.Project,
        name: "payments",
        externalId: PROJECT_A,
      },
      {
        _id: id(),
        kind: OpenStackResourceKind.Snapshot,
        name: "nightly-snap",
        externalId: "s1",
        status: "error",
        regionName: "RegionOne",
        openStackProjectId: PROJECT_A,
        diskCapacityBytes: 2 * GIB,
        stateChangedAt: minutesAgo(10),
        facts: { volumeId: VOLUME_ID },
      },
      {
        _id: id(),
        kind: OpenStackResourceKind.Backup,
        name: "nightly-backup",
        externalId: "b1",
        status: "available",
        regionName: "RegionOne",
        openStackProjectId: PROJECT_A,
        diskCapacityBytes: 4 * GIB,
        stateChangedAt: minutesAgo(10),
        facts: { volumeId: VOLUME_ID, isIncremental: true },
      },
    ];

    await renderPage(OpenStackCloudSnapshots, "/snapshots");

    const snapshot: HTMLElement = (
      await screen.findByText("nightly-snap")
    ).closest("tr") as HTMLElement;
    expect(within(snapshot).getByText("error")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(within(snapshot).getByText("10m")).toBeInTheDocument();
    expect(
      (await within(snapshot).findByText("data")).closest("a"),
    ).toHaveAttribute("href", `${CLOUD_PATH}/volumes/${VOLUME_ID}`);

    const backup: HTMLElement = tableRow("nightly-backup");
    expect(within(backup).getByText("Yes")).toBeInTheDocument();

    expect(
      await screen.findByTestId("openstack-snapshots-by-project-row"),
    ).toHaveTextContent("1 item, 2.0 GiB");
    expect(
      await screen.findByTestId("openstack-backups-by-project-row"),
    ).toHaveTextContent("1 item, 4.0 GiB");
    expect(tile("openstack-snapshots-tiles", "Backups")).toHaveTextContent(
      "4.0 GiB, listed by a probe",
    );
  });
});

describe("images", () => {
  test("the list: each one's status, size and visibility", async () => {
    server.rows = [imageRow()];

    await renderPage(OpenStackCloudImages, "/images");

    const row: HTMLElement = (await screen.findByText("cirros")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("active")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    expect(within(row).getByText("public")).toBeInTheDocument();
    expect(within(row).getByText("21 MiB")).toBeInTheDocument();
    // Only a probe sends this: no column of dashes through the agent.
    expect(screen.queryByText("Type")).not.toBeInTheDocument();
  });

  test("a stuck one is called out", async () => {
    server.rows = [
      imageRow({ status: "queued", stateChangedAt: minutesAgo(600) }),
    ];

    await renderPage(OpenStackCloudImages, "/images");

    const row: HTMLElement = (await screen.findByText("cirros")).closest(
      "tr",
    ) as HTMLElement;
    expect(within(row).getByText("Stuck")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(within(row).getByText("queued for 10h")).toBeInTheDocument();
  });

  test("one on its way isn't yet", async () => {
    server.rows = [
      imageRow({ status: "saving", stateChangedAt: minutesAgo(5) }),
    ];

    await renderPage(OpenStackCloudImages, "/images");

    expect(
      within(
        (await screen.findByText("cirros")).closest("tr") as HTMLElement,
      ).getByText("saving"),
    ).toHaveAttribute("data-tone", "neutral");
  });

  test("a page: its size and who can use it, and a stuck one says why", async () => {
    server.rows = [
      imageRow({ status: "queued", stateChangedAt: minutesAgo(600) }),
    ];

    await renderPage(OpenStackCloudImageDetail, partPath("images", IMAGE_ID));

    expect(
      await screen.findByTestId("openstack-image-explanation"),
    ).toHaveTextContent(/failed upload/);
    expect(attentionRowsOf("openstack-image-attention")).toEqual([
      "This image: queued for 10h",
    ]);
    expect(
      screen.getByTestId("openstack-image-details-visibility"),
    ).toHaveTextContent("public");
    expect(
      screen.getByTestId("openstack-image-details-hidden"),
    ).toHaveTextContent("No");
    expect(tile("openstack-image-tiles", "Size")).toHaveTextContent("21 MiB");
  });
});

describe("on what real clouds said", () => {
  const recording: OpenStackRecording = new OpenStackRecording(
    "gazpacho-ovs",
    "healthy",
  );

  function load(): void {
    server.rows = recording.rows.map(
      (row: OpenStackResource, index: number) => {
        return {
          ...row,
          _id: `6c1b2a3d-4e5f-4a6b-8c7d-${String(index).padStart(12, "0")}`,
        } as Row;
      },
    );
  }

  test("the estate's volumes read as it left them, and the failed one is by name", async () => {
    load();

    await renderPage(OpenStackCloudVolumes, "/volumes");

    expect(
      within(
        (await screen.findByText("ou-vol-bad")).closest("tr") as HTMLElement,
      ).getByText("error"),
    ).toHaveAttribute("data-tone", "danger");
    const used: HTMLElement = tableRow("ou-vol-used");
    expect(within(used).getByText("in-use")).toBeInTheDocument();
    expect(await within(used).findByText("ou-running")).toBeInTheDocument();
    expect(
      within(tableRow("ou-vol-free")).getByText("available"),
    ).toBeInTheDocument();
  });

  test("a real pool has room, and says it can't list its volumes", async () => {
    load();
    const pool: OpenStackResourceRow = recording.ofKind(
      OpenStackResourceKind.StoragePool,
    )[0]!;

    await renderPage(
      OpenStackCloudStoragePoolDetail,
      partPath("storage-pools", pool.externalId as string),
    );

    expect(
      await screen.findByTestId("openstack-storage-pool-hero-status"),
    ).toHaveTextContent("Has room");
    expect(
      await screen.findByTestId("openstack-storage-pool-blast"),
    ).toHaveAttribute("data-known", "false");
  });

  test("snapshots come through as none listed, with the count said to be the exporter's", async () => {
    load();
    server.metrics["openstack_cinder_snapshots"] = [
      { group: "RegionOne", value: 1 },
    ];

    await renderPage(OpenStackCloudSnapshots, "/snapshots");

    await screen.findByTestId("openstack-snapshots-tiles");
    expect(tile("openstack-snapshots-tiles", "Snapshots")).toHaveTextContent(
      "1counted by the agent's exporter",
    );
    expect(
      await screen.findByText("No snapshots listed one by one"),
    ).toBeInTheDocument();
  });
});

type OpenStackResourceRow = ReturnType<OpenStackRecording["ofKind"]>[number];
