/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";

/*
 * A COUNT OF UNHEALTHY PARTS ON A RESOURCE'S OVERVIEW OPENS WHICH AND WHY
 * (#9594).
 *
 * "5/6 OSDs up", a Ceph cluster's "Down + In", Problem PGs, a storage
 * array's Unhealthy Hardware, an OpenStack cloud's "3 workers down" and "2
 * lost" hypervisors, an IoT fleet's "3/5 devices online": each said how
 * many and nothing else. Each now opens exactly the parts it counts, as the
 * product's Needs attention lists them, with why - chosen by the rows the
 * count was made of, so a count and its list never disagree. Cloud's Needs
 * attention tile, the one of four that opened nothing, opens All Resources
 * filtered to it.
 */

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
      getQueryStringByName: (): null => {
        return null;
      },
    },
  };
});

import CephResource from "../../../Models/DatabaseModels/CephResource";
import IoTDeviceModel from "../../../Models/DatabaseModels/IoTDevice";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import StorageArrayResource from "../../../Models/DatabaseModels/StorageArrayResource";
import Route from "../../../Types/API/Route";
import { CloudHealthSeverity } from "../../../Types/Cloud/CloudResourceHealth";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import {
  Translator,
  getGlobalTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import ResourceAttentionPill, {
  ComponentProps as ResourceAttentionPillProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionPill";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import {
  CephOsdQuadrant,
  CephPoolPgStates,
  getCephAttentionItems,
  getCephDownOsdItems,
  getCephOsdQuadrant,
  getCephProblemPgPoolItems,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/Utils/CephHealth";
import {
  OsdMatrix,
  OsdStateCell,
  OsdStateCellView,
  buildOsdStateCells,
  getCephCountPill,
  getOsdStateCellPill,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/View/Index";
import {
  getStorageArrayAttentionItems,
  getStorageArrayHardwareItems,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayHealth";
import { getStorageArrayHardwarePill } from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Index";
import {
  getOpenStackAttentionItems,
  getOpenStackLostHypervisorItems,
  getOpenStackWorkersDownItems,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/Utils/OpenStackHealth";
import {
  OPENSTACK_WORKERS_DOWN_TITLE,
  getOpenStackTilePill,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/View/Index";
import {
  CLOUD_RESOURCES_TABLE_ID,
  getCloudNeedsAttentionListRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudResourceAttention";
import {
  IOT_LOW_BATTERY_PERCENT,
  IoTAtRiskDevice,
  getIoTAtRiskDevices,
  getIoTOfflineDeviceItems,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/Utils/IoTDeviceAttention";
import { getIoTOfflineDevicesPill } from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/Index";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {},
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

const NOW: Date = new Date("2026-11-19T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

function minutesBefore(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

function english(): Translator {
  return getGlobalTranslator();
}

function keysOf(items: Array<ResourceAttentionItem>): Array<string> {
  return items.map((item: ResourceAttentionItem): string => {
    return item.key;
  });
}

/*
 * ---------------------------------------------------------------------------
 * Ceph
 * ---------------------------------------------------------------------------
 */

function cephRow(fields: Partial<CephResource>): CephResource {
  return Object.assign(new CephResource(), {
    hostname: "ceph-a",
    metricsUpdatedAt: minutesBefore(1),
    lastSeenAt: minutesBefore(1),
    ...fields,
  });
}

function osd(
  id: number,
  isUp: boolean | undefined,
  isIn: boolean | undefined,
): CephResource {
  return cephRow({ kind: "Osd", externalId: `osd.${id}`, isUp, isIn });
}

const CEPH_ROWS: Array<CephResource> = [
  osd(1, true, true),
  osd(2, false, true),
  osd(3, false, false),
  osd(4, true, false),
  cephRow({ kind: "Pool", externalId: "1", name: "rbd" }),
  cephRow({ kind: "Pool", externalId: "2", name: "cephfs_data" }),
];

const PG_STATES: Map<string, CephPoolPgStates> = new Map([
  ["1", { total: 128, active: 128, clean: 120, degraded: 6, undersized: 2 }],
  ["2", { total: 64, active: 64, clean: 64, degraded: 0, undersized: 0 }],
]);

function cephItems(): Array<ResourceAttentionItem> {
  return getCephAttentionItems({
    rows: CEPH_ROWS,
    pgStatesByPool: PG_STATES,
    routeFor: (kind: string, externalId: string): Route => {
      return new Route(`/dashboard/ceph/${kind.toLowerCase()}/${externalId}`);
    },
    now: NOW,
  });
}

describe("a Ceph cluster's counts", () => {
  test.each([
    [true, true, "upIn"],
    [true, false, "upOut"],
    [true, undefined, "upOut"],
    [false, true, "downIn"],
    [undefined, true, "downIn"],
    [false, false, "downOut"],
    [undefined, undefined, "downOut"],
  ] as Array<[boolean | undefined, boolean | undefined, CephOsdQuadrant]>)(
    "an OSD up %s and in %s sits in %s, as the OSD States card counts it",
    (
      isUp: boolean | undefined,
      isIn: boolean | undefined,
      quadrant: CephOsdQuadrant,
    ) => {
      expect(getCephOsdQuadrant({ isUp, isIn } as CephResource)).toBe(quadrant);
    },
  );

  test('"5/6 OSDs up" leaves out the OSDs that are down, the one still in first', () => {
    const items: Array<ResourceAttentionItem> = getCephDownOsdItems({
      items: cephItems(),
      rows: CEPH_ROWS,
    });
    expect(keysOf(items)).toEqual(["Osd:osd.2", "Osd:osd.3"]);
    expect(items[0]!.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(items[0]!.reasons).toEqual([{ text: "Down, still in the cluster" }]);
    expect(items[1]!.severity).toBe(ResourceAttentionSeverity.Warning);
    // Each a step from its page.
    expect(items[0]!.route?.toString()).toBe("/dashboard/ceph/osd/osd.2");
  });

  test("Problem PGs opens the pools that hold a degraded or an undersized placement group", () => {
    const items: Array<ResourceAttentionItem> = getCephProblemPgPoolItems({
      items: cephItems(),
      rows: CEPH_ROWS,
      pgStatesByPool: PG_STATES,
    });
    expect(keysOf(items)).toEqual(["Pool:1"]);
    expect(
      items[0]!.reasons.map((reason: { text: string }): string => {
        return reason.text;
      }),
    ).toEqual([
      "{{count}} placement groups degraded",
      "{{count}} placement groups undersized",
    ]);
  });

  test("a Ceph that reports its placement groups only for the whole cluster has no pools to open", () => {
    expect(
      getCephProblemPgPoolItems({
        items: cephItems(),
        rows: CEPH_ROWS,
        pgStatesByPool: null,
      }),
    ).toEqual([]);
  });

  const matrix: OsdMatrix = {
    upIn: 1,
    upOut: 1,
    downIn: 1,
    downOut: 1,
    total: 4,
  };

  function cell(quadrant: CephOsdQuadrant): OsdStateCell {
    return buildOsdStateCells(matrix).find((one: OsdStateCell): boolean => {
      return one.quadrant === quadrant;
    })!;
  }

  test("each state of the OSD States card names which OSDs it counts", () => {
    expect(
      buildOsdStateCells(matrix).map((one: OsdStateCell): string => {
        return `${one.quadrant}:${one.label}`;
      }),
    ).toEqual([
      "upIn:Up + In",
      "upOut:Up + Out",
      "downIn:Down + In",
      "downOut:Down + Out",
    ]);
  });

  test("Up + In is healthy and opens nothing", () => {
    expect(
      getOsdStateCellPill({
        cell: cell("upIn"),
        items: cephItems(),
        rows: CEPH_ROWS,
        translator: english(),
      }),
    ).toBeUndefined();
  });

  test.each([
    ["downIn", "Osd:osd.2", "danger", "1 OSD down, still in the cluster"],
    ["downOut", "Osd:osd.3", "warning", "1 OSD down and out of the cluster"],
    ["upOut", "Osd:osd.4", "warning", "1 OSD up but out of the cluster"],
  ] as Array<[CephOsdQuadrant, string, string, string]>)(
    "%s opens exactly its OSDs, in its tone, under its own title",
    (quadrant: CephOsdQuadrant, key: string, tone: string, title: string) => {
      const pill: ResourceAttentionPillProps | undefined = getOsdStateCellPill({
        cell: cell(quadrant),
        items: cephItems(),
        rows: CEPH_ROWS,
        translator: english(),
      });
      expect(pill).toBeDefined();
      expect(pill!.testId).toBe(`ceph-osd-state-${quadrant}`);
      expect(pill!.label).toBe("Show why");
      expect(pill!.tone).toBe(tone);
      expect(pill!.hint).toBe("Show which OSDs and why");
      expect(pill!.dialog.title).toBe(title);
      // What the state means, the card's own words for it.
      expect(pill!.dialog.description).toBe(cell(quadrant).description);
      expect(keysOf(pill!.dialog.items || [])).toEqual([key]);
    },
  );

  test("a state with nothing to list - an OSD that stopped reporting - opens nothing", () => {
    expect(
      getOsdStateCellPill({
        cell: cell("downIn"),
        items: [],
        rows: CEPH_ROWS,
        translator: english(),
      }),
    ).toBeUndefined();
    expect(
      getCephCountPill({
        testId: "x",
        items: [],
        label: "1 down",
        hint: "Show which OSDs and why",
        title: "1 OSD down",
        emptyMessage: "Every OSD is up now.",
      }),
    ).toBeUndefined();
  });

  test("the cell's pill opens its OSDs with why and View, beside its (i) and never inside it", () => {
    const { container } = render(
      <OsdStateCellView
        cell={cell("downIn")}
        attention={getOsdStateCellPill({
          cell: cell("downIn"),
          items: cephItems(),
          rows: CEPH_ROWS,
          translator: english(),
        })}
      />,
    );

    const pill: HTMLElement = screen.getByTestId("ceph-osd-state-downIn");
    expect(pill.tagName).toBe("BUTTON");
    expect(pill).toHaveTextContent("Show why");
    for (const button of Array.from(container.querySelectorAll("button"))) {
      expect(button.querySelector("button")).toBeNull();
    }

    fireEvent.click(pill);

    expect(
      screen.getByText("1 OSD down, still in the cluster"),
    ).toBeInTheDocument();
    const row: HTMLElement = screen.getByTestId(
      "ceph-osd-state-downIn-dialog-item",
    );
    expect(
      within(row).getByTestId("ceph-osd-state-downIn-dialog-name"),
    ).toHaveTextContent("osd.2");
    expect(
      within(row).getByTestId("ceph-osd-state-downIn-dialog-reason"),
    ).toHaveTextContent("Down, still in the cluster");
    expect(
      within(row).getByTestId("ceph-osd-state-downIn-dialog-view"),
    ).toHaveAttribute("href", "/dashboard/ceph/osd/osd.2");
  });

  test("a state handed no pill is the card it was", () => {
    const { container } = render(<OsdStateCellView cell={cell("downIn")} />);
    expect(screen.queryByTestId("ceph-osd-state-downIn")).toBeNull();
    // Only its (i).
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Storage arrays
 * ---------------------------------------------------------------------------
 */

let partNumber: number = 0;

function part(
  kind: string,
  fields: Partial<StorageArrayResource> = {},
): StorageArrayResource {
  partNumber++;
  return Object.assign(new StorageArrayResource(), {
    kind: kind,
    externalId: fields.externalId || `${kind.toLowerCase()}-${partNumber}`,
    name:
      fields.name || fields.externalId || `${kind.toLowerCase()}-${partNumber}`,
    metricsUpdatedAt: new Date(),
    ...fields,
  });
}

function arrayItems(
  parts: Array<StorageArrayResource>,
): Array<ResourceAttentionItem> {
  return getStorageArrayAttentionItems({
    arrayName: "pure-prod",
    array: {
      storageSystem: StorageSystem.PureStorageFlashArray,
      warningAlertCount: 2,
    },
    parts: parts,
    routeFor: (row: {
      kind?: string | undefined;
      externalId?: string | undefined;
    }): Route => {
      return new Route(`/array/${row.kind}/${row.externalId}`);
    },
  });
}

describe("a storage array's Unhealthy Hardware", () => {
  const parts: Array<StorageArrayResource> = [
    part("Host", { externalId: "esx-07", status: "critical" }),
    part("Drive", { externalId: "CH0.BAY4", status: "failed" }),
    part("Hardware", { externalId: "CH0.PWR1", status: "degraded" }),
    part("Controller", { externalId: "CT0", status: "ready" }),
  ];

  test("opens the components the array says are failed or degraded, never its hosts or its own row", () => {
    expect(keysOf(getStorageArrayHardwareItems(arrayItems(parts)))).toEqual([
      "Drive:CH0.BAY4",
      "Hardware:CH0.PWR1",
    ]);
  });

  test("its pill says Show why under the count, red while one has failed", () => {
    const pill: ResourceAttentionPillProps | undefined =
      getStorageArrayHardwarePill({
        items: arrayItems(parts),
        translator: english(),
      });
    expect(pill).toBeDefined();
    expect(pill!.testId).toBe("storage-array-tile-unhealthy-hardware");
    expect(pill!.label).toBe("Show why");
    expect(pill!.tone).toBe("danger");
    expect(pill!.hint).toBe("Show which components and why");
    expect(pill!.dialog.title).toBe("2 unhealthy hardware components");
    // A drive, a component, a controller: the kind says which.
    expect(pill!.dialog.showKind).toBe(true);
  });

  test("amber while they are only degraded, and nothing to open while every component is healthy", () => {
    const degraded: ResourceAttentionPillProps | undefined =
      getStorageArrayHardwarePill({
        items: arrayItems([
          part("Hardware", { externalId: "CH0.FAN2", status: "degraded" }),
        ]),
        translator: english(),
      });
    expect(degraded!.tone).toBe("warning");
    expect(degraded!.dialog.title).toBe("1 unhealthy hardware component");

    expect(
      getStorageArrayHardwarePill({
        items: arrayItems([part("Controller", { status: "ready" })]),
        translator: english(),
      }),
    ).toBeUndefined();
  });
});

/*
 * ---------------------------------------------------------------------------
 * OpenStack
 * ---------------------------------------------------------------------------
 */

function openStackRow(
  kind: OpenStackResourceKind,
  fields: Partial<OpenStackResource>,
): OpenStackResource {
  return Object.assign(new OpenStackResource(), {
    kind: kind,
    regionName: "RegionOne",
    lastSeenAt: minutesBefore(1),
    ...fields,
  });
}

function worker(
  name: string,
  host: string,
  status: string,
  adminState: string = "enabled",
): OpenStackResource {
  return openStackRow(OpenStackResourceKind.Service, {
    externalId: `RegionOne/compute/${host}/${name}`,
    name: name,
    status: status,
    adminState: adminState,
    facts: { family: "compute", host: host },
  });
}

function hypervisor(name: string, status: string): OpenStackResource {
  return openStackRow(OpenStackResourceKind.Hypervisor, {
    externalId: `RegionOne/${name}`,
    name: name,
    hypervisorName: name,
    status: status,
    adminState: "enabled",
    instanceCount: 12,
  });
}

describe("an OpenStack cloud's Control plane and Hypervisors", () => {
  const workers: Array<OpenStackResource> = [
    worker("nova-compute", "compute-01", "down"),
    worker("nova-compute", "compute-02", "up"),
    // Every scheduler down is one thing that went wrong.
    worker("nova-scheduler", "ctl-1", "down"),
    worker("nova-scheduler", "ctl-2", "down"),
    // Switched off on purpose: not "down".
    worker("nova-conductor", "ctl-3", "down", "disabled"),
  ];
  const hypervisors: Array<OpenStackResource> = [
    hypervisor("compute-01", "down"),
    // Lost, and its nova-compute is not among the rows read.
    hypervisor("compute-09", "down"),
    hypervisor("compute-02", "up"),
  ];
  const rows: Array<OpenStackResource> = [...workers, ...hypervisors];
  const routeFor: (row: OpenStackResource) => Route = (
    row: OpenStackResource,
  ): Route => {
    return new Route(`/dashboard/openstack/${row.kind}/${row.name}`);
  };

  function items(): Array<ResourceAttentionItem> {
    return getOpenStackAttentionItems({
      rows: rows,
      now: NOW,
      routeFor: routeFor,
    });
  }

  test('"3 workers down" opens each worker down, a service none of whose workers is up as its one row, never one switched off', () => {
    const down: Array<ResourceAttentionItem> = getOpenStackWorkersDownItems({
      items: items(),
      workers: workers,
    });
    expect(keysOf(down).sort()).toEqual(
      [
        `${OpenStackResourceKind.Service}/RegionOne/compute/compute-01/nova-compute`,
        "every-RegionOne-nova-scheduler",
      ].sort(),
    );
  });

  test("a lost hypervisor opens as its host: its nova-compute's row where it is read, else the host as the rules say it", () => {
    const listed: Array<ResourceAttentionItem> = items();
    const lost: Array<ResourceAttentionItem> = getOpenStackLostHypervisorItems({
      items: listed,
      rows: rows,
      hypervisors: hypervisors,
      now: NOW,
      routeFor: routeFor,
    });

    expect(lost).toHaveLength(2);
    // compute-01: Needs attention's own row for its nova-compute.
    const compute: ResourceAttentionItem | undefined = lost.find(
      (item: ResourceAttentionItem): boolean => {
        return item.key.endsWith("/compute-01/nova-compute");
      },
    );
    expect(compute).toBe(
      listed.find((item: ResourceAttentionItem): boolean => {
        return item.key.endsWith("/compute-01/nova-compute");
      }),
    );
    // compute-09: the hypervisor itself, down, a step from its page.
    const host: ResourceAttentionItem | undefined = lost.find(
      (item: ResourceAttentionItem): boolean => {
        return (
          item.key ===
          `${OpenStackResourceKind.Hypervisor}/RegionOne/compute-09`
        );
      },
    );
    expect(host).toBeDefined();
    expect(host!.name).toBe("compute-09");
    expect(host!.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(host!.reasons.length).toBeGreaterThan(0);
    expect(host!.route?.toString()).toBe(
      `/dashboard/openstack/${OpenStackResourceKind.Hypervisor}/compute-09`,
    );
    // The hypervisor that is up is in neither.
    expect(keysOf(lost).join(" ")).not.toContain("compute-02");
  });

  test("the tile's pill says Show why, its title the tile's count", () => {
    const down: Array<ResourceAttentionItem> = getOpenStackWorkersDownItems({
      items: items(),
      workers: workers,
    });
    const pill: ResourceAttentionPillProps | undefined = getOpenStackTilePill({
      testId: "openstack-tile-workers-down",
      items: down,
      count: 3,
      isPartial: false,
      hint: "Show which workers and why",
      title: OPENSTACK_WORKERS_DOWN_TITLE,
      description: "The control plane.",
      emptyMessage: "Every worker is up now.",
      translator: english(),
    });
    expect(pill!.label).toBe("Show why");
    expect(pill!.tone).toBe("danger");
    expect(pill!.dialog.title).toBe("3 workers down");
    expect(pill!.dialog.items).toEqual(down);
    expect(pill!.dialog.load).toBeUndefined();
  });

  test("a count past what the read brought lists those it has, and says it shows only the first", async () => {
    const down: Array<ResourceAttentionItem> = getOpenStackWorkersDownItems({
      items: items(),
      workers: workers,
    });
    const pill: ResourceAttentionPillProps | undefined = getOpenStackTilePill({
      testId: "openstack-tile-workers-down",
      items: down,
      count: 40,
      isPartial: true,
      hint: "Show which workers and why",
      title: OPENSTACK_WORKERS_DOWN_TITLE,
      description: "The control plane.",
      emptyMessage: "Every worker is up now.",
      translator: english(),
    });
    expect(pill!.dialog.items).toBeUndefined();
    expect(pill!.dialog.title).toBe("40 workers down");

    render(<ResourceAttentionPill {...pill!} />);
    fireEvent.click(screen.getByTestId("openstack-tile-workers-down"));

    await waitFor(() => {
      expect(
        screen.getAllByTestId("openstack-tile-workers-down-dialog-item"),
      ).toHaveLength(down.length);
    });
    expect(
      screen.getByTestId("openstack-tile-workers-down-dialog-truncated"),
    ).toBeInTheDocument();
  });

  test("nothing to list, no pill", () => {
    expect(
      getOpenStackTilePill({
        testId: "openstack-tile-hypervisors-lost",
        items: [],
        count: 2,
        isPartial: true,
        hint: "Show which hypervisors and why",
        title: OPENSTACK_WORKERS_DOWN_TITLE,
        description: "Hypervisors.",
        emptyMessage: "No hypervisor is lost now.",
        translator: english(),
      }),
    ).toBeUndefined();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Cloud
 * ---------------------------------------------------------------------------
 */

describe("Cloud's Needs attention tile", () => {
  test("opens All Resources with its Health filter on Unhealthy and Degraded", () => {
    const resources: Route = new Route("/dashboard/p1/cloud/resources");
    const route: Route = getCloudNeedsAttentionListRoute(resources);

    const query: string = route.toString().split("?")[1] || "";
    const param: string = `${CLOUD_RESOURCES_TABLE_ID}-filter=`;
    expect(query.startsWith(param)).toBe(true);
    expect(
      JSON.parse(decodeURIComponent(query.substring(param.length))),
    ).toEqual({
      healthSeverity: [
        CloudHealthSeverity.Critical,
        CloudHealthSeverity.Warning,
      ],
    });
    // The list's own link stays as it was.
    expect(resources.toString()).toBe("/dashboard/p1/cloud/resources");
  });
});

/*
 * ---------------------------------------------------------------------------
 * IoT
 * ---------------------------------------------------------------------------
 */

function device(fields: Partial<IoTDeviceModel>): IoTDeviceModel {
  return Object.assign(new IoTDeviceModel(), {
    kind: "Device",
    lastSeenAt: minutesBefore(5),
    ...fields,
  });
}

describe("an IoT fleet's devices online", () => {
  const rows: Array<IoTDeviceModel> = [
    device({ externalId: "sensor-2", name: "Sensor 2", isUp: false }),
    device({
      externalId: "sensor-1",
      name: "Sensor 1",
      isUp: false,
      lastSeenAt: minutesBefore(180),
      latestBatteryPercent: IOT_LOW_BATTERY_PERCENT - 5,
      metricsUpdatedAt: minutesBefore(1),
    }),
    // Low on battery and online: a look soon, not offline.
    device({
      externalId: "gateway",
      isUp: true,
      latestBatteryPercent: 8,
      metricsUpdatedAt: minutesBefore(1),
    }),
    // Its weak signal is hours old: not flagged on old numbers.
    device({
      externalId: "meter",
      isUp: true,
      latestSignalStrengthDbm: -120,
      metricsUpdatedAt: minutesBefore(600),
    }),
    device({ externalId: "pump", isUp: true }),
  ];

  test("the devices needing attention: offline first, then by name, a stale reading flagging none", () => {
    const devices: Array<IoTAtRiskDevice> = getIoTAtRiskDevices({
      rows: rows,
      now: NOW.getTime(),
    });
    expect(
      devices.map((one: IoTAtRiskDevice): [string, boolean] => {
        return [one.name, one.isCritical];
      }),
    ).toEqual([
      ["Sensor 1", true],
      ["Sensor 2", true],
      ["gateway", false],
    ]);
    expect(devices[0]!.reasons).toEqual([
      { template: "Offline" },
      { template: "Battery {{percent}}%", values: { percent: "15" } },
    ]);
    expect(devices[0]!.lastSeenAt).toEqual(minutesBefore(180));
  });

  test("the online count opens the devices offline, with every reason and when each last reported", () => {
    const items: Array<ResourceAttentionItem> = getIoTOfflineDeviceItems({
      devices: getIoTAtRiskDevices({ rows: rows, now: NOW.getTime() }),
      routeFor: (externalId: string): Route => {
        return new Route(`/dashboard/iot/devices/${externalId}`);
      },
    });
    expect(keysOf(items)).toEqual(["Device:sensor-1", "Device:sensor-2"]);
    expect(items[0]!.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(items[0]!.reasons).toEqual([
      { text: "Offline" },
      { text: "Battery {{percent}}%", values: { percent: "15" } },
    ]);
    expect(items[0]!.lastReportAt).toEqual(minutesBefore(180));
    expect(items[0]!.route?.toString()).toBe("/dashboard/iot/devices/sensor-1");
  });

  test("its pill: how many offline, red, under its own title; none while every device is online", () => {
    const items: Array<ResourceAttentionItem> = getIoTOfflineDeviceItems({
      devices: getIoTAtRiskDevices({ rows: rows, now: NOW.getTime() }),
      routeFor: (): undefined => {
        return undefined;
      },
    });
    const pill: ResourceAttentionPillProps | undefined =
      getIoTOfflineDevicesPill({
        testId: "iot-hero-devices-offline",
        items: items,
        translator: english(),
      });
    expect(pill!.label).toBe("2 offline");
    expect(pill!.tone).toBe("danger");
    expect(pill!.hint).toBe("Show which devices and why");
    expect(pill!.dialog.title).toBe("2 devices offline");

    expect(
      getIoTOfflineDevicesPill({
        testId: "iot-hero-devices-offline",
        items: [],
        translator: english(),
      }),
    ).toBeUndefined();
  });

  test("pressed, it lists each offline device with when it last reported", () => {
    const items: Array<ResourceAttentionItem> = getIoTOfflineDeviceItems({
      devices: getIoTAtRiskDevices({ rows: rows, now: NOW.getTime() }),
      routeFor: (externalId: string): Route => {
        return new Route(`/dashboard/iot/devices/${externalId}`);
      },
    });
    render(
      <ResourceAttentionPill
        {...getIoTOfflineDevicesPill({
          testId: "iot-tile-devices-offline",
          items: items,
          translator: english(),
        })!}
      />,
    );

    fireEvent.click(screen.getByTestId("iot-tile-devices-offline"));

    expect(screen.getByText("2 devices offline")).toBeInTheDocument();
    const rowsDrawn: Array<HTMLElement> = screen.getAllByTestId(
      "iot-tile-devices-offline-dialog-item",
    );
    expect(rowsDrawn).toHaveLength(2);
    expect(
      within(rowsDrawn[0]!).getByTestId(
        "iot-tile-devices-offline-dialog-last-report",
      ),
    ).toHaveTextContent("Last reported");
    expect(
      within(rowsDrawn[0]!).getByTestId("iot-tile-devices-offline-dialog-view"),
    ).toHaveAttribute("href", "/dashboard/iot/devices/sensor-1");
  });
});
