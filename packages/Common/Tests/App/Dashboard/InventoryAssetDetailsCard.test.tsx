import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { BrowserRouter } from "react-router-dom";

/*
 * The item page's shared pieces are stories of their own: the typed-row
 * cross-link resolves against other tables, and the custom fields card
 * fetches its own definitions. Stubbed so this suite is about the asset
 * details alone.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/ResolveTypedRowLink",
  () => {
    return {
      __esModule: true,
      resolveTypedRowLink: () => {
        return Promise.resolve(null);
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/OverviewCustomFields",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="custom-fields-stub" />;
      },
    };
  },
);

import InventoryAssetDetailsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetDetailsCard";
import {
  INVENTORY_ASSET_COLUMN_ID_PREFIX,
  getInventoryAssetColumns,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryTable";
import { INVENTORY_ASSET_FIELD_LABELS } from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetLabels";
import DeviceInventoryCard from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInventoryCard";
import InventoryItemOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import Columns from "../../../UI/Components/ModelTable/Columns";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import UserUtil from "../../../UI/Utils/User";
import {
  INVENTORY_ASSET_FIELDS,
  InventoryAssetField,
} from "../../../Utils/Inventory/InventoryAssetDetails";

/*
 * Issue #4569 in the Dashboard: an Inventory host and network device show
 * the same asset facts, in the same order, with "Unknown" where nothing has
 * reported a fact, and one line on how the unknown ones get filled. The
 * list offers the same facts as columns (and CSV columns), and the device's
 * own page agrees with its Inventory item about what the box is.
 */

const ITEM_ID: string = "40000000-0000-4000-8000-000000000001";
const DEVICE_ID: string = "50000000-0000-4000-8000-000000000001";

function item(fields: Partial<InventoryItem>): InventoryItem {
  const model: InventoryItem = new InventoryItem();
  model._id = ITEM_ID;
  Object.assign(model, fields);
  return model;
}

const MERAKI: InventoryItem = item({
  entityType: EntityType.NetworkDevice,
  source: EntitySource.Inventory,
  displayName: "UN0362WANRTR01",
  entityKey: "6a1f0c2e9b7d4a13",
  identifyingAttributes: {
    "oneuptime.resource.id": "f795b9a6-e25d-45bb-9816-f50336a0b12e",
  },
  descriptiveAttributes: {
    "net.device.hostname": "10.241.124.1",
    "host.name": "UN0362WANRTR01",
    "host.ip": "10.241.124.1",
    "device.manufacturer": "Cisco Meraki",
    "device.model.name": "MX85",
    "os.description": "Meraki MX85",
    "device.type": "Firewall",
    "oneuptime.site.name": "Store 0362",
  },
});

const WINDOWS_HOST: InventoryItem = item({
  entityType: EntityType.Host,
  source: EntitySource.Discovered,
  displayName: "wbqajdebsv001",
  entityKey: "c39ab1f24e7d9a02",
  identifyingAttributes: { "host.name": "wbqajdebsv001" },
  descriptiveAttributes: {
    "host.arch": "amd64",
    "host.id": "f39f917e-b361-4d81-9951-e9aae850f939",
    "host.ip": "10.210.72.109",
    "os.description": "Windows Server 2022 10.0",
    "os.type": "windows",
  },
});

const FULL_SWITCH: InventoryItem = item({
  entityType: EntityType.NetworkDevice,
  source: EntitySource.Inventory,
  displayName: "core-sw-01",
  descriptiveAttributes: {
    "net.device.hostname": "10.20.0.1",
    "net.device.dns_name": "core-sw-01.corp.example.com",
    "host.name": "core-sw-01",
    "host.ip": "10.20.0.1",
    "host.mac": "00-1B-54-C2-7A-01",
    "device.manufacturer": "Cisco",
    "device.model.name": "WS-C3850-48P",
    "host.serial_number": "FOC1840X0AB",
    "device.firmware.version": "16.12.4",
    "os.name": "Cisco IOS XE",
    "os.version": "16.12.04",
    "os.description": "Cisco IOS Software [Gibraltar], Version 16.12.4",
    "device.type": "Switch",
    "device.location": "Hall 2, Rack 14",
    "oneuptime.site.name": "London DC1",
  },
});

const POD: InventoryItem = item({
  entityType: EntityType.KubernetesPod,
  source: EntitySource.Discovered,
  displayName: "checkout-7d9f",
  entityKey: "210dac24142f1baa",
  identifyingAttributes: { "k8s.pod.name": "checkout-7d9f" },
  descriptiveAttributes: { "k8s.pod.uid": "a1b2c3" },
});

function row(field: InventoryAssetField): HTMLElement {
  return screen.getByTestId(`inventory-asset-${field}`);
}

function expectValue(field: InventoryAssetField, value: string): void {
  const cell: HTMLElement = row(field);
  expect(
    within(cell).getByText(INVENTORY_ASSET_FIELD_LABELS[field]),
  ).toBeInTheDocument();
  expect(within(cell).getByText(value)).toBeInTheDocument();
  expect(within(cell).queryByText("Unknown")).not.toBeInTheDocument();
}

function expectUnknown(field: InventoryAssetField): void {
  const cell: HTMLElement = row(field);
  expect(within(cell).getByText("Unknown")).toBeInTheDocument();
  // An unknown fact offers nothing to copy.
  expect(within(cell).queryByRole("button")).not.toBeInTheDocument();
}

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Asset Details card (issue #4569)", () => {
  test("the issue's Meraki MX: name, address, maker, model, type and site, every gap named", () => {
    render(<InventoryAssetDetailsCard item={MERAKI} />);

    expect(screen.getByText("Asset Details")).toBeInTheDocument();
    expectValue(InventoryAssetField.Hostname, "UN0362WANRTR01");
    expectValue(InventoryAssetField.IpAddress, "10.241.124.1");
    expectValue(InventoryAssetField.Manufacturer, "Cisco Meraki");
    expectValue(InventoryAssetField.Model, "MX85");
    expectValue(InventoryAssetField.DeviceType, "Firewall");
    expectValue(InventoryAssetField.Location, "Store 0362");
    expectValue(InventoryAssetField.SystemDescription, "Meraki MX85");

    for (const field of [
      InventoryAssetField.MacAddress,
      InventoryAssetField.SerialNumber,
      InventoryAssetField.FirmwareVersion,
      InventoryAssetField.OperatingSystem,
      InventoryAssetField.OsVersion,
    ]) {
      expectUnknown(field);
    }

    const note: HTMLElement = screen.getByTestId(
      "inventory-asset-details-unknown",
    );
    expect(note).toHaveTextContent(
      "5 details are unknown: this device has not reported them over SNMP.",
    );
    const link: HTMLElement = within(note).getByRole("link", {
      name: "Where each detail comes from",
    });
    expect(link).toHaveAttribute(
      "href",
      "/docs/inventory/cmdb-sync#network-device-asset-attributes",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  test("the issue's Windows host: what the collector reports, and how to get the rest", () => {
    render(<InventoryAssetDetailsCard item={WINDOWS_HOST} />);

    expectValue(InventoryAssetField.Hostname, "wbqajdebsv001");
    expectValue(InventoryAssetField.IpAddress, "10.210.72.109");
    expectValue(
      InventoryAssetField.OperatingSystem,
      "Windows Server 2022 10.0",
    );
    expectValue(InventoryAssetField.DeviceType, "Server");
    expectValue(InventoryAssetField.Architecture, "amd64");
    expectUnknown(InventoryAssetField.SerialNumber);
    expectUnknown(InventoryAssetField.Manufacturer);
    expectUnknown(InventoryAssetField.Model);

    const note: HTMLElement = screen.getByTestId(
      "inventory-asset-details-unknown",
    );
    expect(note).toHaveTextContent(
      "7 details are unknown: this host's collector has not reported them.",
    );
    expect(
      within(note).getByRole("link", { name: "How to collect them" }),
    ).toHaveAttribute(
      "href",
      "/docs/telemetry/host-otel-collector#inventory-attributes-ip-mac-serial-number-make-model-firmware",
    );
  });

  test("a host and a network device list the same facts, in the same order", () => {
    const orderOf: (target: InventoryItem) => Array<string> = (
      target: InventoryItem,
    ): Array<string> => {
      const { unmount } = render(<InventoryAssetDetailsCard item={target} />);
      const ids: Array<string> = Array.from(
        screen
          .getByTestId("inventory-asset-details")
          .querySelectorAll("[data-testid^='inventory-asset-']"),
      )
        .map((element: Element): string => {
          return element.getAttribute("data-testid") || "";
        })
        .filter((id: string): boolean => {
          return INVENTORY_ASSET_FIELDS.includes(
            id.replace("inventory-asset-", "") as InventoryAssetField,
          );
        });
      unmount();
      return ids;
    };

    const expected: Array<string> = INVENTORY_ASSET_FIELDS.map(
      (field: InventoryAssetField): string => {
        return `inventory-asset-${field}`;
      },
    );

    expect(orderOf(WINDOWS_HOST)).toEqual(expected);
    expect(orderOf(MERAKI)).toEqual(expected);
    expect(orderOf(FULL_SWITCH)).toEqual(expected);
  });

  test("a machine that reports everything has no unknown note", () => {
    render(<InventoryAssetDetailsCard item={FULL_SWITCH} />);

    expect(screen.queryByText("Unknown")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("inventory-asset-details-unknown"),
    ).not.toBeInTheDocument();
    expectValue(
      InventoryAssetField.Location,
      "London DC1 · Hall 2, Rack 14",
    );
    expectValue(InventoryAssetField.DnsName, "core-sw-01.corp.example.com");
  });

  test("one unknown fact is spoken of in the singular", () => {
    const almost: InventoryItem = item({
      ...FULL_SWITCH,
      descriptiveAttributes: {
        ...(FULL_SWITCH.descriptiveAttributes as Record<string, string>),
        "host.serial_number": "",
      },
    });
    render(<InventoryAssetDetailsCard item={almost} />);

    expect(
      screen.getByTestId("inventory-asset-details-unknown"),
    ).toHaveTextContent(
      "1 detail is unknown: this device has not reported it over SNMP.",
    );
  });

  test("every known fact can be copied, under its own label", () => {
    render(<InventoryAssetDetailsCard item={MERAKI} />);

    expect(
      within(row(InventoryAssetField.Hostname)).getByTitle("Copy Hostname"),
    ).toBeInTheDocument();
    expect(
      within(row(InventoryAssetField.Model)).getByTitle("Copy Model"),
    ).toBeInTheDocument();
  });

  test("the long system description gets the whole row", () => {
    render(<InventoryAssetDetailsCard item={FULL_SWITCH} />);

    expect(row(InventoryAssetField.SystemDescription).className).toContain(
      "lg:col-span-3",
    );
    expect(row(InventoryAssetField.Model).className).not.toContain(
      "col-span",
    );
  });

  /*
   * What the customer's record looked like before the mirror changed: the
   * polled address under net.device.hostname and nothing else. The card
   * never presents it as the hostname.
   */
  test("an old record's polled address is not shown as its hostname", () => {
    render(
      <InventoryAssetDetailsCard
        item={item({
          entityType: EntityType.NetworkDevice,
          descriptiveAttributes: {
            "net.device.hostname": "10.241.124.1",
            "os.description": "Meraki MX85",
          },
        })}
      />,
    );

    expectUnknown(InventoryAssetField.Hostname);
    expect(screen.queryByText("10.241.124.1")).not.toBeInTheDocument();
  });

  test("a type that is not a machine has no Asset Details card", () => {
    const { container } = render(<InventoryAssetDetailsCard item={POD} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the Inventory item page", () => {
  const pageProps: PageComponentProps = {
    pageRoute: new Route("/inventory"),
    currentProject: null,
    hasPaymentMethod: false,
  };

  beforeEach((): void => {
    jest
      .spyOn(Navigation, "getLastParamAsObjectID")
      .mockReturnValue(new ObjectID(ITEM_ID));
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ProjectAdmin]);
  });

  function serve(target: InventoryItem): void {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<never> => {
        return target as never;
      });
  }

  test("shows the asset details between the item's summary and its raw attributes", async () => {
    serve(MERAKI);
    render(
      <BrowserRouter>
        <InventoryItemOverview {...pageProps} />
      </BrowserRouter>,
    );

    await waitFor((): void => {
      expect(screen.getByText("Asset Details")).toBeInTheDocument();
    });

    const headings: Array<string> = screen
      .getAllByRole("heading")
      .map((heading: HTMLElement): string => {
        return heading.textContent || "";
      });
    const summary: number = headings.indexOf("UN0362WANRTR01");
    const assets: number = headings.indexOf("Asset Details");
    const attributes: number = headings.indexOf("Attributes");

    expect(summary).toBeGreaterThan(-1);
    expect(assets).toBeGreaterThan(summary);
    expect(attributes).toBeGreaterThan(assets);
  });

  test("asks for both attribute bags and the type with the item", async () => {
    serve(WINDOWS_HOST);
    const spy: ReturnType<typeof jest.spyOn> = jest.spyOn(ModelAPI, "getItem");

    render(
      <BrowserRouter>
        <InventoryItemOverview {...pageProps} />
      </BrowserRouter>,
    );

    await waitFor((): void => {
      expect(screen.getByText("Asset Details")).toBeInTheDocument();
    });

    const select: Record<string, unknown> = (
      spy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["entityType"]).toBe(true);
    expect(select["identifyingAttributes"]).toBe(true);
    expect(select["descriptiveAttributes"]).toBe(true);
  });

  test("a pod's page has no Asset Details card", async () => {
    serve(POD);
    render(
      <BrowserRouter>
        <InventoryItemOverview {...pageProps} />
      </BrowserRouter>,
    );

    await waitFor((): void => {
      expect(screen.getByText("Attributes")).toBeInTheDocument();
    });
    expect(screen.queryByText("Asset Details")).not.toBeInTheDocument();
  });
});

describe("the Inventory list's asset columns", () => {
  const columns: Columns<InventoryItem> = getInventoryAssetColumns();

  test("one column per asset fact, in order, each labelled as the card labels it", () => {
    expect(
      columns.map((column: Columns<InventoryItem>[number]): string => {
        return column.id || "";
      }),
    ).toEqual(
      INVENTORY_ASSET_FIELDS.map((field: InventoryAssetField): string => {
        return `${INVENTORY_ASSET_COLUMN_ID_PREFIX}${field}`;
      }),
    );
    expect(
      columns.map((column: Columns<InventoryItem>[number]): string => {
        return column.title;
      }),
    ).toEqual(
      INVENTORY_ASSET_FIELDS.map((field: InventoryAssetField): string => {
        return INVENTORY_ASSET_FIELD_LABELS[field];
      }),
    );
  });

  test("start hidden, cannot be sorted, and read both attribute bags", () => {
    for (const column of columns) {
      expect(column.isHiddenByDefault).toBe(true);
      expect(column.disableSort).toBe(true);
      expect(column.field).toEqual({
        entityType: true,
        identifyingAttributes: true,
        descriptiveAttributes: true,
      });
    }
  });

  test("export the same value for a host and a switch, and nothing for a pod", () => {
    const exportOf: (
      field: InventoryAssetField,
      target: InventoryItem,
    ) => string = (field: InventoryAssetField, target: InventoryItem): string => {
      const column: Columns<InventoryItem>[number] | undefined = columns.find(
        (candidate: Columns<InventoryItem>[number]): boolean => {
          return candidate.id === `${INVENTORY_ASSET_COLUMN_ID_PREFIX}${field}`;
        },
      );
      return column!.getExportValue!(target);
    };

    expect(exportOf(InventoryAssetField.Hostname, WINDOWS_HOST)).toBe(
      "wbqajdebsv001",
    );
    expect(exportOf(InventoryAssetField.Hostname, MERAKI)).toBe(
      "UN0362WANRTR01",
    );
    expect(exportOf(InventoryAssetField.IpAddress, MERAKI)).toBe(
      "10.241.124.1",
    );
    expect(exportOf(InventoryAssetField.Model, MERAKI)).toBe("MX85");
    expect(exportOf(InventoryAssetField.SerialNumber, FULL_SWITCH)).toBe(
      "FOC1840X0AB",
    );
    // Unknown and not-a-machine both export as an empty cell.
    expect(exportOf(InventoryAssetField.SerialNumber, MERAKI)).toBe("");
    expect(exportOf(InventoryAssetField.Hostname, POD)).toBe("");
  });

  test("a cell shows the value, or a muted dash", () => {
    const cellOf: (field: InventoryAssetField, target: InventoryItem) => void = (
      field: InventoryAssetField,
      target: InventoryItem,
    ): void => {
      const column: Columns<InventoryItem>[number] | undefined = columns.find(
        (candidate: Columns<InventoryItem>[number]): boolean => {
          return candidate.id === `${INVENTORY_ASSET_COLUMN_ID_PREFIX}${field}`;
        },
      );
      render(column!.getElement!(target));
    };

    cellOf(InventoryAssetField.Manufacturer, MERAKI);
    expect(screen.getByText("Cisco Meraki")).toBeInTheDocument();
    cleanup();

    cellOf(InventoryAssetField.SerialNumber, MERAKI);
    expect(screen.getByText("-")).toHaveClass("text-gray-400");
  });
});

describe("the device's own Inventory card agrees with its Inventory item", () => {
  function meraki(fields: Partial<NetworkDevice> = {}): NetworkDevice {
    const device: NetworkDevice = new NetworkDevice();
    device.id = new ObjectID(DEVICE_ID);
    Object.assign(device, {
      name: "UN0362WANRTR01",
      hostname: "10.241.124.1",
      sysName: "UN0362WANRTR01",
      sysDescr: "Meraki MX85",
      sysObjectId: "1.3.6.1.4.1.29671.2.110",
      vendor: "Cisco Meraki",
      ...fields,
    });
    return device;
  }

  beforeEach((): void => {
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.ProjectAdmin]);
  });

  test("a Meraki MX shows the model its sysDescr names", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<never> => {
        return meraki() as never;
      });

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(screen.getByText("MX85")).toBeInTheDocument();
    });
    expect(screen.getByText("Cisco Meraki")).toBeInTheDocument();
  });

  test("a switch shows ENTITY-MIB's values, and the OS its sysDescr names", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<never> => {
        return meraki({
          name: "core-sw-01",
          vendor: "Cisco",
          deviceModel: "WS-C3850-48P",
          softwareVersion: "16.12.04",
          sysObjectId: "1.3.6.1.4.1.9.1.1745",
          sysDescr:
            "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software, Version 16.12.4, RELEASE SOFTWARE (fc5)",
        }) as never;
      });

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(screen.getByText("WS-C3850-48P")).toBeInTheDocument();
    });
    expect(screen.getByText("Cisco IOS XE")).toBeInTheDocument();
    expect(screen.getByText("16.12.04")).toBeInTheDocument();
    expect(screen.queryByText("16.12.4")).not.toBeInTheDocument();
  });

  test("the card asks for what the asset facts read", async () => {
    const spy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<never> => {
        return meraki() as never;
      });

    render(<DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />);

    await waitFor((): void => {
      expect(screen.getByText("MX85")).toBeInTheDocument();
    });

    const select: Record<string, unknown> = (
      spy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    for (const column of [
      "vendor",
      "deviceModel",
      "firmwareVersion",
      "softwareVersion",
      "sysDescr",
      "sysObjectId",
    ]) {
      expect({ column, selected: select[column] }).toEqual({
        column,
        selected: true,
      });
    }
  });
});
