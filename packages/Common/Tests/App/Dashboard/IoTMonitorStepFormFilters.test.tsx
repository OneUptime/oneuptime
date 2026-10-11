import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import MonitorStepIoTMonitor, {
  IoTResourceScope,
  MonitorStepIoTMonitorUtil,
} from "../../../Types/Monitor/MonitorStepIoTMonitor";

/*
 * The IoT Device monitor form's resource filters, and what it says about
 * them. The worker turns every filter that is set into its own equality on
 * the datapoints, next to the fleet (MonitorTelemetryMonitorIoTFilters.test.ts
 * in App), so a datapoint must match all of them.
 *
 * The Device ID description said "Wins over the other filters when set", a
 * sentence copied from the Proxmox form, whose worker does let the guest ID
 * win. Read on the IoT form it promised a monitor watching one device, where
 * the monitor watches that device only while its type and scope match too.
 */

const DEVICE_ID_DESCRIPTION: string =
  "Filter by the device id — the raw `device.id` datapoint label (optional). Every filter you set must match.";

const FORM_SOURCE_PATH: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/IoTMonitor/IoTMonitorStepForm.tsx",
);

const getListMock: jest.Mock = jest.fn();

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

// The query builder and its charts: not what this suite is about.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "metric-view" });
      },
    };
  },
);

import IoTMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/IoTMonitor/IoTMonitorStepForm";

function config(
  resourceFilters: MonitorStepIoTMonitor["resourceFilters"],
): MonitorStepIoTMonitor {
  return {
    ...MonitorStepIoTMonitorUtil.getDefault(),
    fleetIdentifier: "warehouse-sensors",
    resourceFilters,
  };
}

function openAdvanced(
  resourceFilters: MonitorStepIoTMonitor["resourceFilters"],
  onChange: (value: MonitorStepIoTMonitor) => void = (): void => {},
): void {
  render(
    <IoTMonitorStepForm
      monitorStepIoTMonitor={config(resourceFilters)}
      onChange={onChange}
    />,
  );

  fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  });
});

afterEach(() => {
  cleanup();
});

describe("IoT Device monitor form - resource filters", () => {
  test("Device ID says every filter you set must match", () => {
    openAdvanced({});

    expect(screen.getByText("Device ID")).toBeInTheDocument();
    expect(screen.getByText(DEVICE_ID_DESCRIPTION)).toBeInTheDocument();
  });

  test("no filter claims to win over the others", () => {
    openAdvanced({});

    expect(document.body.textContent).not.toMatch(/wins? over/i);
    expect(document.body.textContent).not.toMatch(/takes? precedence/i);
  });

  test("the three filters stay side by side, Device ID among them", () => {
    openAdvanced({});

    for (const title of ["Resource Scope", "Device ID", "Device Type"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  test("setting a Device ID keeps the Device Type and Resource Scope already set", () => {
    const onChange: jest.Mock<(value: MonitorStepIoTMonitor) => void> =
      jest.fn<(value: MonitorStepIoTMonitor) => void>();

    openAdvanced(
      { deviceType: "sensor", scope: IoTResourceScope.Device },
      onChange,
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. sensor-001"), {
      target: { value: "sensor-001" },
    });

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)![0].resourceFilters).toEqual({
      deviceType: "sensor",
      scope: IoTResourceScope.Device,
      deviceId: "sensor-001",
    });
  });

  test("clearing the Device ID leaves the other filters set", () => {
    const onChange: jest.Mock<(value: MonitorStepIoTMonitor) => void> =
      jest.fn<(value: MonitorStepIoTMonitor) => void>();

    openAdvanced({ deviceId: "sensor-001", deviceType: "sensor" }, onChange);

    fireEvent.change(screen.getByPlaceholderText("e.g. sensor-001"), {
      target: { value: "" },
    });

    expect(onChange.mock.calls.at(-1)![0].resourceFilters).toEqual({
      deviceId: undefined,
      deviceType: "sensor",
    });
  });
});

describe("IoT Device monitor form - what its source says about the filters", () => {
  const source: string = fs.readFileSync(FORM_SOURCE_PATH, "utf8");

  test("the comment above the filters says the worker matches every filter set", () => {
    const filters: number = source.indexOf(
      "const renderResourceFilters: () => ReactElement",
    );
    const comment: string = source.slice(
      source.lastIndexOf("/*", filters),
      filters,
    );

    expect(filters).toBeGreaterThan(-1);
    expect(comment).toContain("MonitorTelemetryMonitor");
    expect(comment.replace(/\s*\*\s*/g, " ")).toContain(
      "a datapoint must match every filter set",
    );
    expect(comment).not.toMatch(/wins over/i);
  });

  test("the Device ID field is given the description the form shows", () => {
    expect(source.replace(/\s+/g, " ")).toContain(
      `description={ "${DEVICE_ID_DESCRIPTION}" }`,
    );
    expect(source).not.toMatch(/wins over the other filters/i);
  });
});
