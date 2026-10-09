import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { Location } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The device Overview's Name Source row (OneUptime issue #4518).
 *
 * A discovery scan names a device by the best name it finds, and a later
 * scan that finds a better one renames it — while nobody has renamed it. A
 * device that can rename itself has to say so before it does, so the Device
 * Details card shows where the name came from, quietly, for exactly those
 * devices: still called what discovery named it. A device a person renamed,
 * one made by hand, and one imported before #4518 show nothing.
 *
 * Driven through the real page and the real CardModelDetail against a fake
 * getItem; the page's other cards are stubbed, each being a story of its own.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
    },
  };
});

/*
 * jest.mock calls are hoisted above the imports below; the factories return
 * plain null components, so nothing they close over is read early.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusHero",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInterfacesPreview",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInventoryCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceVendorTemplateBanner",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceAttachmentCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/EditInSettingsLink",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorLookupUtil",
  () => {
    return {
      __esModule: true,
      default: {
        getDeviceMonitorContext: () => {
          return Promise.resolve({ monitors: [], isMonitorBacked: false });
        },
      },
    };
  },
);

import NetworkDeviceView from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Route from "../../../Types/API/Route";
import { DeviceNameSource } from "../../../Types/NetworkDevice/DeviceNameSource";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import UserUtil from "../../../UI/Utils/User";

const pageProps: PageComponentProps = {
  pageRoute: new Route("/network-devices"),
  currentProject: null,
  hasPaymentMethod: false,
};

function device(fields: Partial<NetworkDevice>): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice();
  value.id = new ObjectID(DEVICE_ID);
  value.projectId = new ObjectID(PROJECT_ID);
  value.hostname = "10.16.42.54";
  Object.assign(value, fields);
  return value;
}

async function renderOverview(item: NetworkDevice): Promise<void> {
  getItemMock.mockResolvedValue(item as never);

  render(<NetworkDeviceView {...pageProps} />);

  // The address is on the card (twice, for a device named by it).
  await waitFor((): void => {
    expect(screen.getAllByText("10.16.42.54").length).toBeGreaterThan(0);
  });
}

beforeEach((): void => {
  getItemMock.mockReset();
  getListMock.mockReset();
  getCommonHeadersMock.mockReset();
  getListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
  getCommonHeadersMock.mockReturnValue({} as never);

  const path: string = `/dashboard/${PROJECT_ID}/network-devices/${DEVICE_ID}`;

  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);

  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the device Overview says where a discovered name came from (issue #4518)", () => {
  test.each([
    [DeviceNameSource.NetbiosName, "WB0024KDS04", "NetBIOS (Windows) name"],
    [DeviceNameSource.SystemName, "core-sw-01", "SNMP system name"],
    [DeviceNameSource.DnsName, "wb-0024-kds04.wbhq.com", "Reverse-DNS name"],
    [DeviceNameSource.Address, "10.16.42.54", "IP address"],
  ])(
    "a device still called what discovery named it from %s shows the row",
    async (source: DeviceNameSource, name: string, label: string) => {
      await renderOverview(
        device({
          name: name,
          discoveredName: name,
          discoveredNameSource: source,
        }),
      );

      expect(screen.getByText("Name Source")).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
      // What will happen to the name, and how to keep one.
      expect(
        screen.getByText(/A later scan that finds a better name/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Rename it yourself to keep a name of your own/),
      ).toBeInTheDocument();
    },
  );

  test("a device a person renamed shows no row: a scan will never rename it", async () => {
    await renderOverview(
      device({
        name: "Kitchen display 4",
        discoveredName: "WB0024KDS04",
        discoveredNameSource: DeviceNameSource.NetbiosName,
      }),
    );

    expect(screen.getByText("Kitchen display 4")).toBeInTheDocument();
    expect(screen.queryByText("Name Source")).not.toBeInTheDocument();
  });

  test("a device made by hand, or imported before #4518, shows no row", async () => {
    await renderOverview(device({ name: "Register 4" }));

    expect(screen.getByText("Register 4")).toBeInTheDocument();
    expect(screen.queryByText("Name Source")).not.toBeInTheDocument();
  });

  test("the card asks for the discovered name and its source with the rest of the device", async () => {
    await renderOverview(device({ name: "Register 4" }));

    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["discoveredName"]).toBe(true);
    expect(select["discoveredNameSource"]).toBe(true);
    expect(select["name"]).toBe(true);
  });
});
