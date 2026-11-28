import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import VMwareLegacySwapMonitorNotice, {
  VMWARE_LEGACY_SWAP_CONFIRM_BUTTON,
  VMWARE_LEGACY_SWAP_CONFIRM_TEXT,
  VMWARE_LEGACY_SWAP_CONFIRM_TITLE,
  VMWARE_LEGACY_SWAP_NOTICE_TEST_ID,
  VMWARE_LEGACY_SWAP_NOTICE_TEXT,
  VMWARE_LEGACY_SWAP_NOTICE_TITLE,
  VMWARE_LEGACY_SWAP_UPDATED,
  VMWARE_LEGACY_SWAP_UPDATE_BUTTON_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/VMwareLegacySwapMonitorNotice";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  VMwareAlertTemplateArgs,
  getVMwareAlertTemplateById,
} from "../../../Types/Monitor/VMwareAlertTemplates";
import { hasVMwareLegacySwapMonitorSteps } from "../../../Types/Monitor/VMwareLegacySwapMonitors";
import ObjectID from "../../../Types/ObjectID";
import { VMwareSwapRateMetric } from "../../../Types/VMware/VMwareSwapRates";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import Toast from "../../../UI/Utils/Toast";

/*
 * A monitor made from VM Memory Swapping before #11468 fires on any memory
 * in the host's swap file. Its Overview and Criteria say so and offer the
 * update - asked first, never done behind its owner's back - which reads
 * the swap-out rate instead and keeps everything else. Only the network
 * and the permission snapshot are stood in for.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Components/Icon/Icon", () => {
  return {
    __esModule: true,
    default: () => {
      return null;
    },
  };
});

const MONITOR_ID: ObjectID = new ObjectID(
  "40000000-0000-4000-8000-000000000001",
);

const ARGS: VMwareAlertTemplateArgs = {
  vcenterIdentifier: "vcsa-prod",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Prod",
};

function stepsOf(step: MonitorStep): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ObjectID.generate(),
  };
  return steps;
}

function legacySteps(): MonitorSteps {
  return stepsOf(
    getVMwareAlertTemplateById("vmware-vm-memory-swapping")!
      .getEquivalentMonitorSteps!(ARGS)[0]!,
  );
}

function currentSteps(): MonitorSteps {
  return stepsOf(
    getVMwareAlertTemplateById("vmware-vm-memory-swapping")!.getMonitorStep(
      ARGS,
    ),
  );
}

// A monitor as the API answers it: its steps as JSON.
function monitor(
  steps: MonitorSteps,
  monitorType: MonitorType = MonitorType.VMware,
): Monitor {
  const row: Monitor = new Monitor();
  row.monitorType = monitorType;
  row.monitorSteps = steps.toJSON() as unknown as MonitorSteps;
  return row;
}

let getItemSpy: jest.SpiedFunction<typeof ModelAPI.getItem>;
let updateSpy: jest.SpiedFunction<typeof ModelAPI.updateById>;
let toastSpy: jest.SpiedFunction<typeof Toast.success>;

beforeEach(() => {
  getItemSpy = jest
    .spyOn(ModelAPI, "getItem")
    .mockResolvedValue(monitor(legacySteps()) as never);
  updateSpy = jest.spyOn(ModelAPI, "updateById").mockResolvedValue({} as never);
  toastSpy = jest.spyOn(Toast, "success").mockImplementation(() => {
    return undefined as never;
  });
  jest
    .spyOn(PermissionGate, "checkColumnUpdate")
    .mockReturnValue({ isAllowed: true } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a monitor made from the version before #11468", () => {
  test("says what it fires on, and offers the update", async () => {
    render(<VMwareLegacySwapMonitorNotice monitorId={MONITOR_ID} />);

    const notice: HTMLElement = await screen.findByTestId(
      VMWARE_LEGACY_SWAP_NOTICE_TEST_ID,
    );
    expect(notice).toHaveTextContent(VMWARE_LEGACY_SWAP_NOTICE_TITLE);
    expect(notice).toHaveTextContent(VMWARE_LEGACY_SWAP_NOTICE_TEXT);
    expect(
      screen.getByTestId(VMWARE_LEGACY_SWAP_UPDATE_BUTTON_TEST_ID),
    ).toBeEnabled();
    // Read once, for what it is and what it reads.
    expect(getItemSpy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        modelType: Monitor,
        id: MONITOR_ID,
        select: { monitorType: true, monitorSteps: true },
      }),
    );
  });

  test("the update is asked first, and changes only what it reads", async () => {
    const onUpdated: jest.Mock = jest.fn();
    render(
      <VMwareLegacySwapMonitorNotice
        monitorId={MONITOR_ID}
        onUpdated={onUpdated as unknown as () => void}
      />,
    );
    fireEvent.click(
      await screen.findByTestId(VMWARE_LEGACY_SWAP_UPDATE_BUTTON_TEST_ID),
    );

    expect(screen.getByText(VMWARE_LEGACY_SWAP_CONFIRM_TITLE)).toBeVisible();
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      VMWARE_LEGACY_SWAP_CONFIRM_TEXT,
    );
    expect(updateSpy).not.toHaveBeenCalled();

    // The next read finds it updated.
    getItemSpy.mockResolvedValue(monitor(currentSteps()) as never);
    fireEvent.click(
      screen.getByRole("button", { name: VMWARE_LEGACY_SWAP_CONFIRM_BUTTON }),
    );

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });
    const call: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateSpy.mock.calls[0]![0] as unknown as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };
    expect(call.modelType).toBe(Monitor);
    expect(call.id).toBe(MONITOR_ID);
    expect(Object.keys(call.data)).toEqual(["monitorSteps"]);
    const sent: MonitorSteps = call.data["monitorSteps"] as MonitorSteps;
    expect(hasVMwareLegacySwapMonitorSteps(sent)).toBe(false);
    expect(
      sent.data!.monitorStepsInstanceArray[0]!.data!.vmwareMonitor!
        .metricViewConfig.queryConfigs[0]!.metricQueryData.filterData
        .metricName,
    ).toBe(VMwareSwapRateMetric.VirtualMachineSwapOut);

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(VMWARE_LEGACY_SWAP_UPDATED);
    });
    expect(onUpdated).toHaveBeenCalledTimes(1);
    // Read again, and no longer one to update.
    await waitFor(() => {
      expect(
        screen.queryByTestId(VMWARE_LEGACY_SWAP_NOTICE_TEST_ID),
      ).toBeNull();
    });
  });

  test("closing the question changes nothing", async () => {
    render(<VMwareLegacySwapMonitorNotice monitorId={MONITOR_ID} />);
    fireEvent.click(
      await screen.findByTestId(VMWARE_LEGACY_SWAP_UPDATE_BUTTON_TEST_ID),
    );
    fireEvent.click(screen.getByTestId("modal-footer-close-button"));
    expect(updateSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(VMWARE_LEGACY_SWAP_CONFIRM_TITLE)).toBeNull();
    expect(screen.getByTestId(VMWARE_LEGACY_SWAP_NOTICE_TEST_ID)).toBeVisible();
  });

  test("an update the server refuses says why, and the monitor is left as it was", async () => {
    updateSpy.mockRejectedValue(new Error("You may not edit this monitor."));
    render(<VMwareLegacySwapMonitorNotice monitorId={MONITOR_ID} />);
    fireEvent.click(
      await screen.findByTestId(VMWARE_LEGACY_SWAP_UPDATE_BUTTON_TEST_ID),
    );
    fireEvent.click(
      screen.getByRole("button", { name: VMWARE_LEGACY_SWAP_CONFIRM_BUTTON }),
    );
    expect(
      await screen.findByText("You may not edit this monitor."),
    ).toBeVisible();
    expect(toastSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId(VMWARE_LEGACY_SWAP_NOTICE_TEST_ID)).toBeVisible();
  });

  test("someone who may not edit it sees the button locked, with why", async () => {
    jest.spyOn(PermissionGate, "checkColumnUpdate").mockReturnValue({
      isAllowed: false,
      disabledReason: "You need permission to edit monitors.",
    } as never);
    render(<VMwareLegacySwapMonitorNotice monitorId={MONITOR_ID} />);
    expect(
      await screen.findByTestId(VMWARE_LEGACY_SWAP_UPDATE_BUTTON_TEST_ID),
    ).toBeDisabled();
  });

  test("while who may edit it is not known yet, there is no button to press", async () => {
    jest
      .spyOn(PermissionGate, "checkColumnUpdate")
      .mockReturnValue({ isAllowed: false } as never);
    render(<VMwareLegacySwapMonitorNotice monitorId={MONITOR_ID} />);
    await screen.findByTestId(VMWARE_LEGACY_SWAP_NOTICE_TEST_ID);
    expect(
      screen.queryByTestId(VMWARE_LEGACY_SWAP_UPDATE_BUTTON_TEST_ID),
    ).toBeNull();
  });
});

describe("every other monitor", () => {
  test.each([
    [
      "made from the template since #11468",
      () => {
        return monitor(currentSteps());
      },
    ],
    [
      "of another kind, holding the same steps",
      () => {
        return monitor(legacySteps(), MonitorType.Metrics);
      },
    ],
    [
      "that cannot be read",
      () => {
        return null;
      },
    ],
  ])(
    "draws nothing: one %s",
    async (_name: string, answer: () => Monitor | null) => {
      getItemSpy.mockResolvedValue(answer() as never);
      const { container } = render(
        <VMwareLegacySwapMonitorNotice monitorId={MONITOR_ID} />,
      );
      await waitFor(() => {
        expect(getItemSpy).toHaveBeenCalled();
      });
      expect(
        screen.queryByTestId(VMWARE_LEGACY_SWAP_NOTICE_TEST_ID),
      ).toBeNull();
      expect(container).toBeEmptyDOMElement();
    },
  );

  test("a read that fails draws nothing", async () => {
    getItemSpy.mockRejectedValue(new Error("offline"));
    render(<VMwareLegacySwapMonitorNotice monitorId={MONITOR_ID} />);
    await waitFor(() => {
      expect(getItemSpy).toHaveBeenCalled();
    });
    expect(screen.queryByTestId(VMWARE_LEGACY_SWAP_NOTICE_TEST_ID)).toBeNull();
  });
});
