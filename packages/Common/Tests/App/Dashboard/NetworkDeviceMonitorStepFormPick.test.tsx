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
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A Network Device monitor's device is required: the monitor alerts on that
 * device and nothing else. Its picker showed a Clear button beside the
 * device, and Backspace or Delete on it emptied the field too - only for the
 * criteria step to say a device must be picked. It is a required pick now
 * (EntityDropdown's isClearable={false}): another device is picked from the
 * list in its place.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import NetworkDeviceMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/NetworkDeviceMonitor/NetworkDeviceMonitorStepForm";
import MonitorStepNetworkDeviceMonitor from "../../../Types/Monitor/MonitorStepNetworkDeviceMonitor";

const CORE_SWITCH_ID: string = "85000000-0000-4000-8000-000000000001";
const EDGE_ROUTER_ID: string = "85000000-0000-4000-8000-000000000002";

const DEVICES: Array<{ _id: string; name: string }> = [
  { _id: CORE_SWITCH_ID, name: "sw-core-01" },
  { _id: EDGE_ROUTER_ID, name: "rt-edge-01" },
];

let onChange: MockFunction;

const renderForm: (networkDeviceId?: string) => void = (
  networkDeviceId?: string,
): void => {
  const value: MonitorStepNetworkDeviceMonitor = {
    ...(networkDeviceId ? { networkDeviceId: networkDeviceId } : {}),
  } as MonitorStepNetworkDeviceMonitor;

  render(
    <NetworkDeviceMonitorStepForm
      monitorStepNetworkDeviceMonitor={value}
      onChange={(next: MonitorStepNetworkDeviceMonitor) => {
        onChange(next);
      }}
    />,
  );
};

beforeEach(() => {
  onChange = getJestMockFunction();
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: DEVICES, count: DEVICES.length });
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a Network Device monitor's device", () => {
  test("picked, it shows the device and no Clear", async () => {
    renderForm(CORE_SWITCH_ID);

    expect(await screen.findByText("sw-core-01")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear selection" }),
    ).toBeNull();
    expect(screen.queryByTestId("entity-dropdown-clear-place")).toBeNull();
  });

  test("Delete and Backspace on it leave it picked", async () => {
    renderForm(CORE_SWITCH_ID);

    const value: HTMLElement = (await screen.findByText("sw-core-01")).closest(
      "button",
    ) as HTMLElement;

    fireEvent.keyDown(value, { key: "Delete" });
    fireEvent.keyDown(value, { key: "Backspace" });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("sw-core-01")).toBeInTheDocument();
  });

  test("another device is picked in its place", async () => {
    renderForm(CORE_SWITCH_ID);

    fireEvent.click(
      (await screen.findByText("sw-core-01")).closest("button") as HTMLElement,
    );
    fireEvent.click(await screen.findByRole("option", { name: "rt-edge-01" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ networkDeviceId: EDGE_ROUTER_ID }),
      );
    });
  });

  test("with none picked yet, it asks for one", () => {
    renderForm();

    expect(
      screen.getByPlaceholderText("Select a network device"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear selection" }),
    ).toBeNull();
  });
});
