import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { Location } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Refresh on a device's Inventory card reads the device again (#5392); once
 * the reading is answered, the device's Overview reads the rest of the
 * device again too - its Device Details card and its status hero - so the
 * whole page shows the new reading, not the Inventory card alone (the
 * follow-up "After Refresh on the Inventory card, the Device Details card
 * reads the device again too").
 *
 * Driven through the real page and the real Device Details card against a
 * fake getItem; the Inventory card and the hero are stand-ins that hand the
 * test what the page gives them.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

// What the page handed the stand-ins, render by render.
const inventoryCardProps: Array<{ onRead?: (() => void) | undefined }> = [];
const heroProps: Array<{ refreshKey?: number | undefined }> = [];

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceStatusHero",
  () => {
    return {
      __esModule: true,
      default: (props: { refreshKey?: number | undefined }) => {
        heroProps.push(props);
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
      default: (props: { onRead?: (() => void) | undefined }) => {
        inventoryCardProps.push(props);
        return null;
      },
    };
  },
);

const stub: () => { __esModule: true; default: () => null } = () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInterfacesPreview",
  () => {
    return stub();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorsCard",
  () => {
    return stub();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceVendorTemplateBanner",
  () => {
    return stub();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceAttachmentCard",
  () => {
    return stub();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsCard",
  () => {
    return stub();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/EditInSettingsLink",
  () => {
    return stub();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return stub();
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/ResourceSecurityCard",
  () => {
    return stub();
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

function device(macAddress: string): NetworkDevice {
  const value: NetworkDevice = new NetworkDevice();
  value.id = new ObjectID(DEVICE_ID);
  value.projectId = new ObjectID(PROJECT_ID);
  value.name = "Store 0660 core";
  value.hostname = "10.66.0.2";
  value.macAddress = macAddress;
  return value;
}

// The Device Details card's reads of the device.
function detailsReads(): number {
  return getItemMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (
      (call[0] as { modelType?: { name?: string } }).modelType?.name ===
      "NetworkDevice"
    );
  }).length;
}

beforeEach((): void => {
  inventoryCardProps.length = 0;
  heroProps.length = 0;
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

describe("a refresh answered on the Inventory card reads the rest of the page again", () => {
  test("the Device Details card reads the device again, and shows what the reading changed", async () => {
    getItemMock.mockResolvedValue(device("88:15:44:aa:00:01") as never);

    render(<NetworkDeviceView {...pageProps} />);

    await waitFor((): void => {
      expect(screen.getByText("88:15:44:aa:00:01")).toBeInTheDocument();
    });
    const readsBefore: number = detailsReads();
    expect(readsBefore).toBeGreaterThan(0);

    // The refresh is answered: the box is a new one, at the same address.
    getItemMock.mockResolvedValue(device("88:15:44:aa:00:99") as never);
    const onRead: (() => void) | undefined =
      inventoryCardProps[inventoryCardProps.length - 1]!.onRead;
    expect(onRead).toBeDefined();

    await act(async (): Promise<void> => {
      onRead!();
    });

    await waitFor((): void => {
      expect(screen.getByText("88:15:44:aa:00:99")).toBeInTheDocument();
    });
    expect(detailsReads()).toBe(readsBefore + 1);
  });

  test("the status hero is asked to read the device again, once per answered refresh", async () => {
    getItemMock.mockResolvedValue(device("88:15:44:aa:00:01") as never);

    render(<NetworkDeviceView {...pageProps} />);

    await waitFor((): void => {
      expect(screen.getByText("88:15:44:aa:00:01")).toBeInTheDocument();
    });
    expect(heroProps[heroProps.length - 1]!.refreshKey).toBe(0);

    await act(async (): Promise<void> => {
      inventoryCardProps[inventoryCardProps.length - 1]!.onRead!();
    });
    expect(heroProps[heroProps.length - 1]!.refreshKey).toBe(1);

    await act(async (): Promise<void> => {
      inventoryCardProps[inventoryCardProps.length - 1]!.onRead!();
    });
    expect(heroProps[heroProps.length - 1]!.refreshKey).toBe(2);
  });

  test("before any refresh, the page reads the device once", async () => {
    getItemMock.mockResolvedValue(device("88:15:44:aa:00:01") as never);

    render(<NetworkDeviceView {...pageProps} />);

    await waitFor((): void => {
      expect(screen.getByText("88:15:44:aa:00:01")).toBeInTheDocument();
    });

    expect(detailsReads()).toBe(1);
  });
});
