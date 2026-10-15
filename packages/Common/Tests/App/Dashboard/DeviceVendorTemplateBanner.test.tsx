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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A device's offer of its vendor's health template, on its Overview
 * (Components/NetworkDevice/DeviceVendorTemplateBanner.tsx), rendered.
 *
 * It used to show on every visit to every device whose vendor has a template
 * - also on devices that already collected all of it - and had no button: it
 * said the template "is recommended when creating monitors". Now it shows
 * only while the template adds something, to someone who may edit the
 * device, and one click adds it.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
let mockCanEditDevice: boolean = true;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    default: {
      check: (): { isAllowed: boolean } => {
        return { isAllowed: mockCanEditDevice };
      },
    },
    ModelAction: {
      Create: "create",
      Read: "read",
      Update: "update",
      Delete: "delete",
    },
  };
});

import DeviceVendorTemplateBanner from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceVendorTemplateBanner";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import ObjectID from "../../../Types/ObjectID";

const DEVICE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const CAMBIUM_CNMATRIX_OID: string = "1.3.6.1.4.1.17713.24.1.2";

function cnMatrix(): SnmpVendorTemplate {
  return SnmpVendorTemplateUtil.getById("cambium-cnmatrix")!;
}

function deviceRow(overrides: Partial<NetworkDevice>): NetworkDevice {
  const row: NetworkDevice = new NetworkDevice();
  row.monitoringMethod = "Probe" as never;
  Object.assign(row, overrides);
  return row;
}

async function renderBanner(): Promise<void> {
  render(<DeviceVendorTemplateBanner modelId={DEVICE_ID} />);

  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockCanEditDevice = true;
  getItemMock.mockReset();
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue({} as never);
});

afterEach(() => {
  cleanup();
});

describe("the vendor template offer on a device's Overview", () => {
  test("a walked Cambium switch collecting nothing is offered its template by vendor", async () => {
    getItemMock.mockResolvedValue(
      deviceRow({
        sysObjectId: CAMBIUM_CNMATRIX_OID,
        snmpOids: [],
        snmpTables: [],
      }) as never,
    );

    await renderBanner();

    const banner: HTMLElement = await screen.findByTestId(
      "device-vendor-template-banner",
    );

    expect(banner).toHaveTextContent(/health checks are available/);
    expect(banner).toHaveTextContent(
      `Add the ${cnMatrix().label} template and every poll also reads this device's health`,
    );
    expect(banner).toHaveTextContent("Nothing it already collects changes.");
    expect(
      screen.getByTestId("device-vendor-template-apply"),
    ).toHaveTextContent("Add health checks");
  });

  test("reads only what the decision needs", async () => {
    getItemMock.mockResolvedValue(null as never);

    await renderBanner();

    const request: { id: ObjectID; select: Record<string, unknown> } =
      getItemMock.mock.calls[0]![0] as {
        id: ObjectID;
        select: Record<string, unknown>;
      };

    expect(request.id.toString()).toBe(DEVICE_ID.toString());
    expect(Object.keys(request.select).sort()).toEqual([
      "monitoringMethod",
      "oidTemplateId",
      "snmpOids",
      "snmpTables",
      "sysDescr",
      "sysObjectId",
    ]);
  });

  test("one click adds the template's lists, and says where its values appear", async () => {
    getItemMock.mockResolvedValue(
      deviceRow({
        sysObjectId: CAMBIUM_CNMATRIX_OID,
        snmpOids: [],
        snmpTables: [],
      }) as never,
    );

    await renderBanner();
    await act(async () => {
      fireEvent.click(
        await screen.findByTestId("device-vendor-template-apply"),
      );
    });

    const request: {
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateByIdMock.mock.calls[0]![0] as {
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(request.id.toString()).toBe(DEVICE_ID.toString());
    expect(request.data["snmpOids"]).toEqual(cnMatrix().oids);
    expect(request.data["snmpTables"]).toEqual(cnMatrix().tables);

    const applied: HTMLElement = await screen.findByTestId(
      "device-vendor-template-applied",
    );
    expect(applied).toHaveTextContent(
      `The ${cnMatrix().label} template is added. Its health values are read from the next poll and charted on Metrics.`,
    );
    expect(screen.queryByTestId("device-vendor-template-banner")).toBeNull();
  });

  test("a device that already collects the whole template is offered nothing", async () => {
    getItemMock.mockResolvedValue(
      deviceRow({
        sysObjectId: CAMBIUM_CNMATRIX_OID,
        snmpOids: cnMatrix().oids,
        snmpTables: cnMatrix().tables,
      }) as never,
    );

    await renderBanner();
    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("device-vendor-template-banner")).toBeNull();
  });

  test("a device not identified yet is offered nothing", async () => {
    getItemMock.mockResolvedValue(deviceRow({ snmpOids: [] }) as never);

    await renderBanner();

    expect(screen.queryByTestId("device-vendor-template-banner")).toBeNull();
  });

  test("someone who may not edit the device is offered nothing", async () => {
    mockCanEditDevice = false;
    getItemMock.mockResolvedValue(
      deviceRow({ sysObjectId: CAMBIUM_CNMATRIX_OID, snmpOids: [] }) as never,
    );

    await renderBanner();

    expect(screen.queryByTestId("device-vendor-template-banner")).toBeNull();
  });

  test("a failed write says why, and the offer stays", async () => {
    getItemMock.mockResolvedValue(
      deviceRow({ sysObjectId: CAMBIUM_CNMATRIX_OID, snmpOids: [] }) as never,
    );
    updateByIdMock.mockRejectedValue(new Error("Permission denied") as never);

    await renderBanner();
    await act(async () => {
      fireEvent.click(
        await screen.findByTestId("device-vendor-template-apply"),
      );
    });

    expect(
      await screen.findByTestId("device-vendor-template-error"),
    ).toHaveTextContent("Permission denied");
    expect(
      screen.getByTestId("device-vendor-template-banner"),
    ).toBeInTheDocument();
  });

  test("a failed read shows nothing, not an error: the banner is an offer", async () => {
    getItemMock.mockRejectedValue(new Error("network down") as never);

    await renderBanner();

    expect(screen.queryByTestId("device-vendor-template-banner")).toBeNull();
    expect(screen.queryByText("network down")).toBeNull();
  });
});
