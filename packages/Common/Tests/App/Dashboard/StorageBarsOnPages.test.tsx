import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import ProxmoxResource from "../../../Models/DatabaseModels/ProxmoxResource";
import StorageArrayResource from "../../../Models/DatabaseModels/StorageArrayResource";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import Column from "../../../UI/Components/ModelTable/Column";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import {
  StorageUsageLevel,
  getStorageUsage,
} from "../../../Utils/Storage/StorageUsage";
import ResourceTable, {
  InfrastructureResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable";
import {
  PROXMOX_GUEST_DISK_COLUMNS,
  PROXMOX_STORAGE_USAGE_COLUMNS,
  toProxmoxListResource,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Proxmox/ProxmoxResourceColumns";
import {
  VMWARE_VM_STORAGE_COLUMNS,
  withVMwareVmStorage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareResourceTables";
import VMwareStorageCapacityCard from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/VMwareStorageCapacityCard";
import ResourceStorageCard from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceStorageCard";
import { getCephOsdWidgetUsage } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardCephOsdListComponent";
import {
  getCephPoolWidgetLegend,
  getCephPoolWidgetUsage,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardCephPoolListComponent";
import { HoneycombLegendItem } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceHoneycomb";
import StorageArrayResourceColumns from "../../../../App/FeatureSet/Dashboard/src/Components/StorageArray/StorageArrayResourceColumns";
import {
  getStorageArrayBucketNoUsageText,
  getStorageArrayBucketUsage,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayHealth";
import {
  OpenStackListColumn,
  getOpenStackStorageUsageColumn,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/OpenStackResourceList";
import { getOpenStackStoragePoolUsage } from "../../../Types/OpenStack/OpenStackHealthRules";
import { JSONObject } from "../../../Types/JSON";
import {
  DOCKER_SWARM_VOLUME_DISK_COLUMNS,
  getDockerSwarmVolumeSizeColumn,
  withDockerSwarmVolumeStorage,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/Utils/DockerSwarmVolumeStorage";

/*
 * HOW FULL A STORE IS, DRAWN THE ONE WAY ON EVERY PAGE (#9646, #9647, #9648).
 *
 * The shared bar (StorageUsageBar) in each list and page these issues
 * named: a node's, a guest's and a VM's disk beside CPU and Memory, a
 * vCenter's total, the Ceph widgets, a part page's Storage card, a storage
 * array's bucket, an OpenStack pool and a Swarm's volumes - each from its
 * product's reading,
 * at its product's lines, and saying why in words where there is none.
 */

const GIB: number = 1024 * 1024 * 1024;

afterEach(() => {
  cleanup();
});

function headers(): Array<string> {
  return Array.from(document.querySelectorAll("thead th"))
    .map((cell: Element): string => {
      return (cell.textContent || "").trim();
    })
    .filter((text: string): boolean => {
      return text !== "";
    });
}

function rowOf(name: string): HTMLElement {
  return screen.getByText(name).closest("tr") as HTMLElement;
}

function guest(fields: Partial<ProxmoxResource>): ProxmoxResource {
  return Object.assign(new ProxmoxResource(), {
    kind: "Guest",
    isUp: true,
    ...fields,
  });
}

describe("a list of nodes, guests or VMs: Disk beside CPU and Memory", () => {
  const container: InfrastructureResource = toProxmoxListResource(
    guest({
      externalId: "lxc/101",
      name: "web",
      guestType: "lxc",
      latestDiskBytes: 2 * GIB,
      maxDiskBytes: 8 * GIB,
    }),
  );
  const vm: InfrastructureResource = toProxmoxListResource(
    guest({
      externalId: "qemu/100",
      name: "db",
      guestType: "qemu",
      latestDiskBytes: 0,
      maxDiskBytes: 32 * GIB,
    }),
  );

  test("the Disk and Free columns follow CPU and Memory, not Status", () => {
    render(
      <ResourceTable
        resources={[container, vm]}
        title="Guests"
        description="Guests."
        showGroupColumn={false}
        storageUsageColumns={PROXMOX_GUEST_DISK_COLUMNS}
      />,
    );

    expect(headers()).toEqual([
      "Name",
      "Status",
      "CPU",
      "Memory",
      "Disk",
      "Free",
      "Age",
    ]);
  });

  test("a container's root disk is the shared bar; a VM's says Not reported, never 0%", () => {
    render(
      <ResourceTable
        resources={[container, vm]}
        title="Guests"
        description="Guests."
        showGroupColumn={false}
        storageUsageColumns={PROXMOX_GUEST_DISK_COLUMNS}
      />,
    );

    expect(within(rowOf("web")).getByTestId("storage-usage")).toHaveTextContent(
      "25%2 GiB",
    );
    expect(
      within(rowOf("db")).getByTestId("storage-usage-none"),
    ).toHaveTextContent("Not reported");
    expect(within(rowOf("db")).queryByText(/0%/)).toBeNull();
  });

  test("a list where no row reports its disk draws no column of dashes for Free", () => {
    render(
      <ResourceTable
        resources={[vm]}
        title="Guests"
        description="Guests."
        showGroupColumn={false}
        storageUsageColumns={PROXMOX_GUEST_DISK_COLUMNS}
      />,
    );

    expect(headers()).toEqual([
      "Name",
      "Status",
      "CPU",
      "Memory",
      "Disk",
      "Age",
    ]);
  });

  test("a list of stores still reads Used and Free right after Status", () => {
    const storage: InfrastructureResource = toProxmoxListResource(
      Object.assign(new ProxmoxResource(), {
        kind: "Storage",
        externalId: "storage/pve1/local",
        name: "local",
        isUp: true,
        latestDiskBytes: 96 * GIB,
        maxDiskBytes: 100 * GIB,
      }),
    );
    render(
      <ResourceTable
        resources={[storage]}
        title="Storage"
        description="Storage."
        showGroupColumn={false}
        showResourceMetrics={false}
        showAge={false}
        storageUsageColumns={PROXMOX_STORAGE_USAGE_COLUMNS}
      />,
    );

    expect(headers()).toEqual(["Name", "Status", "Used", "Free"]);
    // 96% is past Proxmox's 95%: red.
    expect(screen.getByTestId("storage-usage-fill")).toHaveAttribute(
      "data-level",
      StorageUsageLevel.Critical,
    );
  });

  test("a VM's storage is titled Storage and stays calm, full or not", () => {
    const thick: InfrastructureResource = withVMwareVmStorage({
      name: "erp",
      namespace: "",
      cpuUtilization: null,
      memoryUsageBytes: null,
      memoryLimitBytes: null,
      status: "Powered On",
      age: "",
      additionalAttributes: {
        diskBytes: String(200 * GIB),
        maxDiskBytes: String(200 * GIB),
      },
    });
    render(
      <ResourceTable
        resources={[thick]}
        title="Virtual Machines"
        description="VMs."
        showGroupColumn={false}
        showAge={false}
        storageUsageColumns={VMWARE_VM_STORAGE_COLUMNS}
      />,
    );

    expect(headers()).toEqual([
      "Name",
      "Status",
      "CPU",
      "Memory",
      "Storage",
      "Free",
    ]);
    expect(screen.getByTestId("storage-usage")).toHaveTextContent("100%");
    expect(screen.getByTestId("storage-usage-fill")).toHaveAttribute(
      "data-level",
      StorageUsageLevel.Normal,
    );
  });
});

describe("a vCenter's Storage Capacity", () => {
  test("draws used, free and capacity across its datastores, at the datastores' levels", () => {
    render(
      <VMwareStorageCapacityCard
        vcenter={{
          datastoreCapacityBytes: 100 * GIB,
          datastoreUsedBytes: 91 * GIB,
          datastoreCount: 3,
        }}
      />,
    );

    expect(screen.getByText("Storage Capacity")).toBeInTheDocument();
    const usage: HTMLElement = screen.getByTestId(
      "vmware-storage-capacity-usage",
    );
    expect(usage).toHaveTextContent("91%");
    expect(
      screen.getByTestId("vmware-storage-capacity-usage-free"),
    ).toHaveTextContent("9 GiB");
    expect(
      screen.getByTestId("vmware-storage-capacity-usage-capacity"),
    ).toHaveTextContent("100 GiB");
    // Past the datastores' 90%: almost out of space.
    expect(
      screen.getByTestId("vmware-storage-capacity-usage-level"),
    ).toHaveTextContent("Almost out of space");
  });

  test("says so in words while its datastores have not reported their capacity", () => {
    render(
      <VMwareStorageCapacityCard
        vcenter={{
          datastoreCount: 2,
        }}
      />,
    );

    expect(
      screen.getByTestId("vmware-storage-capacity-usage-none"),
    ).toHaveTextContent("No usage reported.");
  });

  test("draws nothing for a vCenter with no datastore", () => {
    const { container } = render(
      <VMwareStorageCapacityCard
        vcenter={{
          datastoreCount: 0,
        }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe("a part's Storage card", () => {
  test("draws the shared bar's detail when what is used is known", () => {
    render(
      <ResourceStorageCard
        description="How much of its allocated storage the database uses, from its latest reading."
        usage={getStorageUsage({ capacity: 100 * GIB, available: 8 * GIB })}
        capacityBytes={100 * GIB}
        testId="cloud-resource-storage"
      />,
    );

    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByTestId("cloud-resource-storage-free")).toHaveTextContent(
      "8 GiB",
    );
    expect(
      screen.getByTestId("cloud-resource-storage-level"),
    ).toHaveTextContent("Almost out of space");
  });

  test("says a disk's size, and why what it holds is not known, never an empty bar", () => {
    render(
      <ResourceStorageCard
        description="The disk's size, as its cloud reports it."
        usage={null}
        capacityBytes={100 * GIB}
        noUsageText="How much of it is used is known only inside the machine it is attached to."
        testId="cloud-resource-storage"
      />,
    );

    expect(
      screen.getByTestId("cloud-resource-storage-capacity"),
    ).toHaveTextContent("100 GiB");
    expect(screen.getByTestId("cloud-resource-storage-none")).toHaveTextContent(
      "known only inside the machine",
    );
    expect(screen.queryByRole("meter")).toBeNull();
  });
});

describe("the Ceph dashboard widgets", () => {
  test("an OSD's and a pool's bar read Ceph's lines, not 70% and 85%", () => {
    expect(
      getCephOsdWidgetUsage({ statBytes: 100, statBytesUsed: 80 })?.level,
    ).toBe(StorageUsageLevel.Normal);
    expect(
      getCephOsdWidgetUsage({ statBytes: 100, statBytesUsed: 90 })?.level,
    ).toBe(StorageUsageLevel.Warning);
    expect(
      getCephOsdWidgetUsage({ statBytes: 100, statBytesUsed: 96 })?.level,
    ).toBe(StorageUsageLevel.Critical);
    expect(
      getCephPoolWidgetUsage({ storedBytes: 86, maxAvailBytes: 14 })?.level,
    ).toBe(StorageUsageLevel.Warning);
    expect(getCephPoolWidgetUsage({ maxAvailBytes: 14 })).toBe(null);
  });

  test("the pool wall's legend names Ceph's lines in the reader's words", () => {
    const legend: Array<HoneycombLegendItem> = getCephPoolWidgetLegend(
      getGlobalTranslator(),
    );

    expect(
      legend.map((item: HoneycombLegendItem): [string, string] => {
        return [item.label, item.color];
      }),
    ).toEqual([
      ["Up to 85% used", "#10b981"],
      ["Past 85% used", "#f59e0b"],
      ["Past 95% used", "#ef4444"],
      ["Unknown", "#d1d5db"],
    ]);
    expect(legend[0]!.isLabelUserContent).toBe(true);
  });
});

describe("a storage array's bucket against its quota", () => {
  const column: Column<StorageArrayResource> =
    StorageArrayResourceColumns.getUsageColumn({
      title: "Used",
      description: "What it stores against its quota.",
      getUsage: getStorageArrayBucketUsage,
      getNoUsageText: getStorageArrayBucketNoUsageText,
    });

  test("draws what it stores of its quota as the shared bar", () => {
    render(
      column.getElement!(
        Object.assign(new StorageArrayResource(), {
          kind: "Bucket",
          capacityBytes: 100 * GIB,
          details: { virtualBytes: 40 * GIB },
        }),
      ),
    );

    expect(screen.getByTestId("storage-usage")).toHaveTextContent("40%");
  });

  test("says No quota for a bucket that can grow until the array is full", () => {
    render(
      column.getElement!(
        Object.assign(new StorageArrayResource(), {
          kind: "Bucket",
          capacityBytes: 0,
          details: { virtualBytes: 40 * GIB },
        }),
      ),
    );

    expect(screen.getByTestId("storage-usage-none")).toHaveTextContent(
      "No quota",
    );
  });
});

describe("an OpenStack storage pool", () => {
  const column: OpenStackListColumn = getOpenStackStorageUsageColumn({
    id: "used",
    title: "Used",
    field: "diskAllocatedBytes",
    getUsage: (row: OpenStackResource) => {
      return getOpenStackStoragePoolUsage({
        allocatedBytes: row.diskAllocatedBytes,
        capacityBytes: row.diskCapacityBytes,
      });
    },
  });

  const pool: OpenStackResource = Object.assign(new OpenStackResource(), {
    diskAllocatedBytes: 960 * GIB,
    diskCapacityBytes: 1000 * GIB,
  });

  test("draws how full it is, red past 95%, and exports its percent", () => {
    render(column.getElement!(pool));

    expect(screen.getByTestId("storage-usage-fill")).toHaveAttribute(
      "data-level",
      StorageUsageLevel.Critical,
    );
    expect(column.getExportValue!(pool)).toBe("96%");
    expect(column.hasValue!(pool)).toBe(true);
  });

  test("a pool with no capacity has no value, so its column can step aside", () => {
    expect(column.hasValue!(new OpenStackResource())).toBe(false);
  });
});

describe("a Swarm's Volumes list: each volume's size, then the disk it lives on", () => {
  function volume(
    name: string,
    attributes: JSONObject,
  ): InfrastructureResource {
    const resource: InfrastructureResource = {
      name: name,
      namespace: "mgr-1",
      cpuUtilization: null,
      memoryUsageBytes: null,
      memoryLimitBytes: null,
      status: "",
      age: "",
      additionalAttributes: {},
    };
    withDockerSwarmVolumeStorage(resource, attributes);
    return resource;
  }

  function renderVolumes(resources: Array<InfrastructureResource>): void {
    render(
      <ResourceTable
        resources={resources}
        title="Volumes"
        description="Volumes."
        showGroupColumn={true}
        groupColumnTitle="Node"
        showStatus={false}
        showResourceMetrics={false}
        storageUsageColumns={DOCKER_SWARM_VOLUME_DISK_COLUMNS}
        columns={[getDockerSwarmVolumeSizeColumn()]}
      />,
    );
  }

  test("a local volume says its size, and the shared disk's bar turns red at 90%", () => {
    renderVolumes([
      volume("shop_data", {
        sizeBytes: 10 * GIB,
        diskTotalBytes: 100 * GIB,
        diskAvailableBytes: 10 * GIB,
      }),
      volume("shop_media", {}),
    ]);

    expect(headers()).toEqual(["Name", "Node", "Size", "Disk", "Free"]);
    expect(rowOf("shop_data")).toHaveTextContent(/10\sGiB/);
    expect(
      within(rowOf("shop_data")).getByTestId("storage-usage-fill"),
    ).toHaveAttribute("data-level", StorageUsageLevel.Critical);
    expect(
      within(rowOf("shop_media")).getByTestId("storage-usage-none"),
    ).toHaveTextContent("Not reported");
  });

  test("an agent older than 0.161.4: every volume says Not reported, with no column of dashes for Free", () => {
    renderVolumes([volume("shop_data", {})]);

    expect(headers()).toEqual(["Name", "Node", "Size", "Disk"]);
    expect(
      within(rowOf("shop_data")).getByTestId("storage-usage-none"),
    ).toHaveTextContent("Not reported");
  });
});
