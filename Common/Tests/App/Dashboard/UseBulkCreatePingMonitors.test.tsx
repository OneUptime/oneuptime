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
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The device list's bulk "Create Ping Monitors" action.
 *
 * A monitor-backed NetworkDevice with nothing bound reads "Pending / No
 * monitor" forever - nothing polls it, and only a bound monitor can say
 * whether it is up. Discovery import creates these by the dozen with the
 * "create Ping monitors" opt-in off, so this action is the fleet-wide fix.
 * What has to hold, and what a refactor drops silently:
 *
 *   - the action is withheld from an all-SNMP selection and gated on BOTH
 *     permissions it needs (it creates a Monitor and updates a device);
 *   - probes are fetched when the modal opens, not on mount - the Devices
 *     page is mounted by other tests with no probe mock in place;
 *   - every device is re-read before anything is created, and SNMP or
 *     already-bound devices are reported as skipped, never provisioned;
 *   - an eligible device gets one Monitor create (with the chosen probes,
 *     or no `probes` key at all when none were chosen) and one bind;
 *   - a bind that fails deletes the monitor again;
 *   - the seed ids are resolved once per run, not once per device;
 *   - nothing in the copy claims the device was verified reachable.
 *
 * The provisioning sequence itself is PingMonitorProvisioning's; it is driven
 * for real here, against a mocked ModelAPI, so the calls asserted are the
 * ones the server would see.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const getItemMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();
const getAllProbesMock: MockFunction = getJestMockFunction();
const resolveSeedIdsMock: MockFunction = getJestMockFunction();
const permissionCheckMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the compiled
 * requires, so naming the mocks directly would capture them before their
 * initializers have run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (...args: Array<any>) => {
        return getAllProbesMock(...args);
      },
    },
  };
});

/*
 * Keeps the real PingMonitorSeedIdsUnavailableError so the "project is
 * missing a status" path throws the same class the hook sees in production.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/PingMonitorSeedIds",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/PingMonitorSeedIds",
    ) as Record<string, unknown>;

    return {
      ...actual,
      __esModule: true,
      default: {
        resolve: (...args: Array<any>) => {
          return resolveSeedIdsMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../UI/Utils/PermissionGate", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Utils/PermissionGate",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      check: (...args: Array<any>) => {
        return permissionCheckMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDClass: any = (
          jest.requireActual("../../../Types/ObjectID") as { default: any }
        ).default;
        return new ObjectIDClass("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

import useBulkCreatePingMonitors, {
  BulkCreatePingMonitorsResult,
  SKIPPED_ALREADY_BOUND_MESSAGE,
  SKIPPED_SNMP_DEVICE_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkCreatePingMonitors";
import { pingMonitorProvisionedMessage } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/PingMonitorProvisioning";
import { PingMonitorSeedIdsUnavailableError } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/PingMonitorSeedIds";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ModelAction } from "../../../UI/Utils/PermissionGate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Probe from "../../../Models/DatabaseModels/Probe";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "../../../Types/ObjectID";

/*
 * These tests drive a real Formik + react-select tree behind a modal, so the
 * testing-library default of 1s flakes on a loaded box.
 */
const WAIT_TIMEOUT: number = 20000;

const ACTION_TITLE: string = "Create Ping Monitors";

const DEVICE_ONE_ID: string = "22222222-2222-4222-8222-222222222221";
const DEVICE_TWO_ID: string = "22222222-2222-4222-8222-222222222222";
const DEVICE_THREE_ID: string = "22222222-2222-4222-8222-222222222223";
const EXISTING_MONITOR_ID: string = "33333333-3333-4333-8333-333333333331";
const CREATED_MONITOR_ID: string = "33333333-3333-4333-8333-333333333332";
const PROBE_A_ID: string = "44444444-4444-4444-8444-444444444441";
const PROBE_B_ID: string = "44444444-4444-4444-8444-444444444442";

const ONLINE_STATUS_ID: string = "55555555-5555-4555-8555-555555555551";
const OFFLINE_STATUS_ID: string = "55555555-5555-4555-8555-555555555552";
const INCIDENT_SEVERITY_ID: string = "55555555-5555-4555-8555-555555555553";
const ALERT_SEVERITY_ID: string = "55555555-5555-4555-8555-555555555554";

const DEVICE_UPDATE_REASON: string =
  "You need the Edit Network Device permission to do this.";
const MONITOR_CREATE_REASON: string =
  "You need the Create Monitor permission to do this.";

interface DeviceFixture {
  id: string;
  name: string;
  hostname: string;
  method: NetworkDeviceMonitoringMethod;
  monitorId?: string | undefined;
}

type MakeDeviceFunction = (fixture: DeviceFixture) => NetworkDevice;

const makeDevice: MakeDeviceFunction = (
  fixture: DeviceFixture,
): NetworkDevice => {
  const device: NetworkDevice = new NetworkDevice();
  device._id = fixture.id;
  device.name = fixture.name;
  device.hostname = fixture.hostname;
  device.monitoringMethod = fixture.method;

  if (fixture.monitorId) {
    device.monitorId = new ObjectID(fixture.monitorId);
  }

  return device;
};

/*
 * What the list row carries is only what DEVICE_STATUS_SELECT selects; the
 * fresh read the hook makes is what carries the columns it decides on. The
 * two are kept as separate fixtures so a test can make them disagree.
 */
const SNMP_DEVICE: DeviceFixture = {
  id: DEVICE_ONE_ID,
  name: "core-switch-01",
  hostname: "10.0.0.1",
  method: NetworkDeviceMonitoringMethod.Probe,
};

const BOUND_DEVICE: DeviceFixture = {
  id: DEVICE_TWO_ID,
  name: "lobby-ap",
  hostname: "10.0.0.2",
  method: NetworkDeviceMonitoringMethod.Monitor,
  monitorId: EXISTING_MONITOR_ID,
};

const UNBOUND_DEVICE: DeviceFixture = {
  id: DEVICE_THREE_ID,
  name: "rack-pdu",
  hostname: "10.0.0.3",
  method: NetworkDeviceMonitoringMethod.Monitor,
};

type MakeProbeFunction = (id: string, name: string) => Probe;

const makeProbe: MakeProbeFunction = (id: string, name: string): Probe => {
  const probe: Probe = new Probe();
  probe._id = id;
  probe.name = name;
  return probe;
};

interface ProgressSnapshot {
  inProgressIds: Array<string>;
  successIds: Array<string>;
  failedIds: Array<string>;
  failedMessages: Array<string>;
}

type IdsOfFunction = (items: Array<NetworkDevice>) => Array<string>;

const idsOf: IdsOfFunction = (items: Array<NetworkDevice>): Array<string> => {
  return items.map((item: NetworkDevice) => {
    return item._id || "";
  });
};

/*
 * The hook hands the same four arrays to every onProgressInfo call, so
 * anything held by reference mutates retroactively into the final state.
 * Copy out of them on arrival.
 */
type SnapshotProgressFunction = (
  progressInfo: ProgressInfo<NetworkDevice>,
) => ProgressSnapshot;

const snapshotProgress: SnapshotProgressFunction = (
  progressInfo: ProgressInfo<NetworkDevice>,
): ProgressSnapshot => {
  return {
    inProgressIds: idsOf(progressInfo.inProgressItems),
    successIds: idsOf(progressInfo.successItems),
    failedIds: idsOf(
      progressInfo.failed.map((failure: BulkActionFailed<NetworkDevice>) => {
        return failure.item;
      }),
    ),
    failedMessages: progressInfo.failed.map(
      (failure: BulkActionFailed<NetworkDevice>) => {
        return String(failure.failedMessage);
      },
    ),
  };
};

const onProgressInfoMock: MockFunction = getJestMockFunction();
const onBulkActionStartMock: MockFunction = getJestMockFunction();
const onBulkActionEndMock: MockFunction = getJestMockFunction();

let progressSnapshots: Array<ProgressSnapshot> = [];
let capturedActions: Array<BulkActionButtonSchema<NetworkDevice>> = [];

/*
 * What the fresh read answers for each device id. A test that wants the row
 * and the server to disagree sets these independently of the items it
 * hands the action.
 */
let devicesOnServer: Record<string, NetworkDevice | null> = {};

/*
 * What PermissionGate.check answers, keyed on the model's singular name and
 * the action. Anything not listed is allowed.
 */
let gateResults: Record<
  string,
  { isAllowed: boolean; disabledReason?: string | undefined }
> = {};

type MakeActionPropsFunction = (
  items: Array<NetworkDevice>,
) => BulkActionOnClickProps<NetworkDevice>;

const makeActionProps: MakeActionPropsFunction = (
  items: Array<NetworkDevice>,
): BulkActionOnClickProps<NetworkDevice> => {
  return {
    items: items,
    onProgressInfo:
      onProgressInfoMock as unknown as BulkActionOnClickProps<NetworkDevice>["onProgressInfo"],
    onBulkActionStart: onBulkActionStartMock as unknown as () => void,
    onBulkActionEnd: onBulkActionEndMock as unknown as () => void,
  };
};

interface HarnessProps {
  items: Array<NetworkDevice>;
}

/*
 * `modals` has to be mounted for the modal to exist, which renderHook cannot
 * do, so the hook is driven through a component that renders a plain trigger
 * per action - the same harness BulkLabelActions.test.tsx uses.
 */
const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const { bulkActions, modals }: BulkCreatePingMonitorsResult =
    useBulkCreatePingMonitors();

  capturedActions = bulkActions;

  return (
    <div>
      {bulkActions.map((action: BulkActionButtonSchema<NetworkDevice>) => {
        return (
          <button
            key={action.title}
            type="button"
            onClick={() => {
              void action.onClick(makeActionProps(props.items));
            }}
          >
            {`Trigger ${action.title}`}
          </button>
        );
      })}
      {modals}
    </div>
  );
};

type FindActionFunction = () => BulkActionButtonSchema<NetworkDevice>;

const findAction: FindActionFunction =
  (): BulkActionButtonSchema<NetworkDevice> => {
    const action: BulkActionButtonSchema<NetworkDevice> | undefined =
      capturedActions.find(
        (candidate: BulkActionButtonSchema<NetworkDevice>) => {
          return candidate.title === ACTION_TITLE;
        },
      );

    if (!action) {
      throw new Error(`No "${ACTION_TITLE}" action was returned.`);
    }

    return action;
  };

type OpenModalFunction = (items: Array<NetworkDevice>) => Promise<void>;

/*
 * Renders the harness, opens the modal and waits for its form to be on
 * screen - the probe fetch has settled by the time the combobox exists.
 */
const openModal: OpenModalFunction = async (
  items: Array<NetworkDevice>,
): Promise<void> => {
  render(<Harness items={items} />);

  fireEvent.click(screen.getByText(`Trigger ${ACTION_TITLE}`));

  await waitFor(
    () => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(ACTION_TITLE);
    },
    { timeout: WAIT_TIMEOUT },
  );

  await screen.findByRole("combobox", undefined, { timeout: WAIT_TIMEOUT });
};

type SelectProbeFunction = (name: string) => Promise<void>;

/*
 * react-select renders its menu lazily; ArrowDown on the combobox is the only
 * interaction that mounts the option list.
 */
const selectProbe: SelectProbeFunction = async (
  name: string,
): Promise<void> => {
  const combobox: HTMLElement = await screen.findByRole("combobox", undefined, {
    timeout: WAIT_TIMEOUT,
  });
  fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.click(
    await screen.findByText(name, undefined, { timeout: WAIT_TIMEOUT }),
  );
};

type SubmitAndWaitFunction = () => Promise<void>;

const submitAndWaitForEnd: SubmitAndWaitFunction = async (): Promise<void> => {
  fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

  await waitFor(
    () => {
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
    },
    { timeout: WAIT_TIMEOUT },
  );
};

type LastSnapshotFunction = () => ProgressSnapshot;

const lastSnapshot: LastSnapshotFunction = (): ProgressSnapshot => {
  const snapshot: ProgressSnapshot | undefined =
    progressSnapshots[progressSnapshots.length - 1];

  if (!snapshot) {
    throw new Error("No progress was reported.");
  }

  return snapshot;
};

describe("useBulkCreatePingMonitors", () => {
  beforeEach(() => {
    progressSnapshots = [];
    capturedActions = [];
    devicesOnServer = {
      [DEVICE_ONE_ID]: makeDevice(SNMP_DEVICE),
      [DEVICE_TWO_ID]: makeDevice(BOUND_DEVICE),
      [DEVICE_THREE_ID]: makeDevice(UNBOUND_DEVICE),
    };
    gateResults = {};

    onProgressInfoMock.mockImplementation(
      (progressInfo: ProgressInfo<NetworkDevice>): void => {
        progressSnapshots.push(snapshotProgress(progressInfo));
      },
    );

    permissionCheckMock.mockImplementation(
      (
        model: { singularName: string | null },
        action: ModelAction,
      ): { isAllowed: boolean; disabledReason?: string | undefined } => {
        return (
          gateResults[`${model.singularName}:${action}`] || {
            isAllowed: true,
          }
        );
      },
    );

    getItemMock.mockImplementation(
      (request: { id: ObjectID }): Promise<NetworkDevice | null> => {
        return Promise.resolve(devicesOnServer[request.id.toString()] ?? null);
      },
    );

    getAllProbesMock.mockImplementation((): Promise<Array<Probe>> => {
      return Promise.resolve([
        makeProbe(PROBE_A_ID, "Branch probe"),
        makeProbe(PROBE_B_ID, "Datacenter probe"),
      ]);
    });

    resolveSeedIdsMock.mockImplementation(() => {
      return Promise.resolve({
        onlineMonitorStatusId: new ObjectID(ONLINE_STATUS_ID),
        offlineMonitorStatusId: new ObjectID(OFFLINE_STATUS_ID),
        defaultIncidentSeverityId: new ObjectID(INCIDENT_SEVERITY_ID),
        defaultAlertSeverityId: new ObjectID(ALERT_SEVERITY_ID),
      });
    });

    createMock.mockImplementation((): Promise<{ data: Monitor }> => {
      const created: Monitor = new Monitor();
      created._id = CREATED_MONITOR_ID;
      return Promise.resolve({ data: created });
    });

    updateByIdMock.mockImplementation((): Promise<void> => {
      return Promise.resolve();
    });

    deleteItemMock.mockImplementation((): Promise<void> => {
      return Promise.resolve();
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  describe("where the action is offered", () => {
    test("is withheld from an all-SNMP selection and offered to a mixed one", () => {
      render(<Harness items={[]} />);

      const action: BulkActionButtonSchema<NetworkDevice> = findAction();

      expect(action.isVisible!([makeDevice(SNMP_DEVICE)])).toBe(false);
      expect(
        action.isVisible!([
          makeDevice(SNMP_DEVICE),
          makeDevice(UNBOUND_DEVICE),
        ]),
      ).toBe(true);
      // The convention every bulk hook here follows - the bar is not drawn for one anyway.
      expect(action.isVisible!([])).toBe(true);
    });

    test("is disabled with the device-update reason before the monitor-create reason", () => {
      gateResults = {
        [`Network Device:${ModelAction.Update}`]: {
          isAllowed: false,
          disabledReason: DEVICE_UPDATE_REASON,
        },
        [`Monitor:${ModelAction.Create}`]: {
          isAllowed: false,
          disabledReason: MONITOR_CREATE_REASON,
        },
      };

      render(<Harness items={[]} />);

      expect(findAction().disabled).toBe(true);
      expect(findAction().tooltip).toBe(DEVICE_UPDATE_REASON);
    });

    test("is disabled with the monitor-create reason when only that one is missing", () => {
      gateResults = {
        [`Monitor:${ModelAction.Create}`]: {
          isAllowed: false,
          disabledReason: MONITOR_CREATE_REASON,
        },
      };

      render(<Harness items={[]} />);

      expect(findAction().disabled).toBe(true);
      expect(findAction().tooltip).toBe(MONITOR_CREATE_REASON);
    });

    test("is offered plainly when both permissions are held", () => {
      render(<Harness items={[]} />);

      expect(findAction().disabled).toBeUndefined();
      expect(findAction().tooltip).toBeUndefined();
    });
  });

  describe("the probe list", () => {
    /*
     * The Devices page is mounted by other tests with ModelTable mocked and
     * no probe mock for this hook; a mount-time fetch would throw there.
     */
    test("is not fetched until the modal opens", async () => {
      render(<Harness items={[makeDevice(UNBOUND_DEVICE)]} />);

      expect(getAllProbesMock).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText(`Trigger ${ACTION_TITLE}`));

      await waitFor(() => {
        expect(getAllProbesMock).toHaveBeenCalledTimes(1);
      });
    });

    test("still opens the modal, without options, when it cannot be loaded", async () => {
      getAllProbesMock.mockImplementation((): Promise<Array<Probe>> => {
        return Promise.reject(new Error("probe list unavailable"));
      });

      await openModal([makeDevice(UNBOUND_DEVICE)]);

      // The field says so, rather than offering an empty dropdown in silence.
      expect(
        screen.getByText(/could not be loaded just now/),
      ).toBeInTheDocument();

      await submitAndWaitForEnd();

      expect(createMock).toHaveBeenCalledTimes(1);
      expect((createMock.mock.calls[0] as Array<any>)[0].miscDataProps).toEqual(
        {},
      );
    });
  });

  describe("what is provisioned", () => {
    test("skips SNMP and already-bound devices without creating anything", async () => {
      await openModal([makeDevice(SNMP_DEVICE), makeDevice(BOUND_DEVICE)]);

      await submitAndWaitForEnd();

      expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
      expect(createMock).not.toHaveBeenCalled();
      expect(updateByIdMock).not.toHaveBeenCalled();

      const snapshot: ProgressSnapshot = lastSnapshot();
      expect(snapshot.successIds).toEqual([]);
      expect(snapshot.failedIds).toEqual([DEVICE_ONE_ID, DEVICE_TWO_ID]);
      expect(snapshot.failedMessages).toEqual([
        SKIPPED_SNMP_DEVICE_MESSAGE,
        SKIPPED_ALREADY_BOUND_MESSAGE,
      ]);
      expect(SKIPPED_SNMP_DEVICE_MESSAGE.startsWith("Skipped:")).toBe(true);
      expect(SKIPPED_ALREADY_BOUND_MESSAGE.startsWith("Skipped:")).toBe(true);
    });

    /*
     * The row is what the list selected when the page loaded; the decision
     * has to be made on what the server says now, or a device bound in
     * another tab since gets a second, billable monitor.
     */
    test("decides on a fresh read of the device, not on the row", async () => {
      const staleRow: NetworkDevice = makeDevice({
        ...UNBOUND_DEVICE,
        monitorId: undefined,
      });
      devicesOnServer[DEVICE_THREE_ID] = makeDevice({
        ...UNBOUND_DEVICE,
        monitorId: EXISTING_MONITOR_ID,
      });

      await openModal([staleRow]);

      await submitAndWaitForEnd();

      expect(getItemMock).toHaveBeenCalledTimes(1);
      expect((getItemMock.mock.calls[0] as Array<any>)[0].select).toEqual({
        _id: true,
        name: true,
        hostname: true,
        monitoringMethod: true,
        monitorId: true,
      });
      expect(createMock).not.toHaveBeenCalled();
      expect(lastSnapshot().failedMessages).toEqual([
        SKIPPED_ALREADY_BOUND_MESSAGE,
      ]);
    });

    test("creates a Ping monitor on the device's hostname and binds it, on the project's default probes when none were picked", async () => {
      await openModal([makeDevice(UNBOUND_DEVICE)]);

      await submitAndWaitForEnd();

      expect(createMock).toHaveBeenCalledTimes(1);

      const createRequest: any = (createMock.mock.calls[0] as Array<any>)[0];
      expect(createRequest.modelType).toBe(Monitor);
      /*
       * No `probes` key at all: the server treats an explicit empty
       * selection as "attach nothing", which would create a monitor nothing
       * ever evaluates.
       */
      expect(createRequest.miscDataProps).toEqual({});

      const monitor: Monitor = createRequest.model as Monitor;
      expect(monitor.name).toBe("Ping rack-pdu");
      expect(monitor.monitorType).toBe(MonitorType.Ping);
      expect(monitor.description).toContain("10.0.0.3");
      expect(monitor.description).toContain("Create Ping Monitors");

      expect(updateByIdMock).toHaveBeenCalledTimes(1);
      const bindRequest: any = (updateByIdMock.mock.calls[0] as Array<any>)[0];
      expect(bindRequest.modelType).toBe(NetworkDevice);
      expect(bindRequest.id.toString()).toBe(DEVICE_THREE_ID);
      expect(bindRequest.data).toEqual({ monitorId: CREATED_MONITOR_ID });

      expect(deleteItemMock).not.toHaveBeenCalled();

      const snapshot: ProgressSnapshot = lastSnapshot();
      expect(snapshot.successIds).toEqual([DEVICE_THREE_ID]);
      expect(snapshot.failedIds).toEqual([]);
      expect(snapshot.inProgressIds).toEqual([]);
      expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
    });

    test("attaches the probes the operator picked", async () => {
      await openModal([makeDevice(UNBOUND_DEVICE)]);

      await selectProbe("Branch probe");

      await submitAndWaitForEnd();

      expect(createMock).toHaveBeenCalledTimes(1);
      expect((createMock.mock.calls[0] as Array<any>)[0].miscDataProps).toEqual(
        {
          probes: [PROBE_A_ID],
        },
      );
    });

    /*
     * A monitor is billable and plan-limited; one that reports on nothing is
     * exactly the orphan an operator cannot see the reason for.
     */
    test("deletes the monitor again when the bind fails, and reports the device as failed", async () => {
      updateByIdMock.mockImplementation((): Promise<void> => {
        return Promise.reject(new Error("device is read-only"));
      });

      await openModal([makeDevice(UNBOUND_DEVICE)]);

      await submitAndWaitForEnd();

      expect(createMock).toHaveBeenCalledTimes(1);
      expect(deleteItemMock).toHaveBeenCalledTimes(1);

      const deleteRequest: any = (
        deleteItemMock.mock.calls[0] as Array<any>
      )[0];
      expect(deleteRequest.modelType).toBe(Monitor);
      expect(deleteRequest.id.toString()).toBe(CREATED_MONITOR_ID);

      const snapshot: ProgressSnapshot = lastSnapshot();
      expect(snapshot.successIds).toEqual([]);
      expect(snapshot.failedIds).toEqual([DEVICE_THREE_ID]);
      expect(snapshot.failedMessages[0]).toContain("could not be bound");
      expect(snapshot.failedMessages[0]).toContain("device is read-only");
    });

    test("reports progress after every device, and ends the action once", async () => {
      await openModal([
        makeDevice(SNMP_DEVICE),
        makeDevice(BOUND_DEVICE),
        makeDevice(UNBOUND_DEVICE),
      ]);

      await submitAndWaitForEnd();

      expect(progressSnapshots).toHaveLength(3);
      expect(progressSnapshots[0]!.inProgressIds).toEqual([
        DEVICE_TWO_ID,
        DEVICE_THREE_ID,
      ]);
      expect(progressSnapshots[1]!.inProgressIds).toEqual([DEVICE_THREE_ID]);
      expect(progressSnapshots[2]!.inProgressIds).toEqual([]);
      expect(progressSnapshots[2]!.successIds).toEqual([DEVICE_THREE_ID]);
      expect(progressSnapshots[2]!.failedIds).toEqual([
        DEVICE_ONE_ID,
        DEVICE_TWO_ID,
      ]);
      expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("the seed ids", () => {
    /*
     * They describe the project, not any one device: a 200-device selection
     * must not make 200 copies of the same three list requests.
     */
    test("are resolved once for the whole selection", async () => {
      devicesOnServer = {
        [DEVICE_ONE_ID]: makeDevice({ ...UNBOUND_DEVICE, id: DEVICE_ONE_ID }),
        [DEVICE_TWO_ID]: makeDevice({ ...UNBOUND_DEVICE, id: DEVICE_TWO_ID }),
        [DEVICE_THREE_ID]: makeDevice(UNBOUND_DEVICE),
      };

      await openModal([
        makeDevice({ ...UNBOUND_DEVICE, id: DEVICE_ONE_ID }),
        makeDevice({ ...UNBOUND_DEVICE, id: DEVICE_TWO_ID }),
        makeDevice(UNBOUND_DEVICE),
      ]);

      await submitAndWaitForEnd();

      expect(resolveSeedIdsMock).toHaveBeenCalledTimes(1);
      expect(createMock).toHaveBeenCalledTimes(3);
      expect(lastSnapshot().successIds).toEqual([
        DEVICE_ONE_ID,
        DEVICE_TWO_ID,
        DEVICE_THREE_ID,
      ]);
    });

    /*
     * A project with no offline status cannot get ANY monitor, and the
     * reason is not about a device - so it is said once, in its own modal,
     * and the action never starts. Starting it and filing every device
     * under "failed" with the same sentence would bury the fix under the
     * list.
     */
    test("report a project-level failure once, without starting the action", async () => {
      const reason: string =
        "This project needs both an operational and an offline monitor status before Ping monitors can be created.";

      resolveSeedIdsMock.mockImplementation(() => {
        return Promise.reject(new PingMonitorSeedIdsUnavailableError(reason));
      });

      await openModal([makeDevice(UNBOUND_DEVICE), makeDevice(BOUND_DEVICE)]);

      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      await waitFor(
        () => {
          expect(screen.getByTestId("modal-title")).toHaveTextContent(
            "Ping Monitors Could Not Be Created",
          );
        },
        { timeout: WAIT_TIMEOUT },
      );

      expect(screen.getByText(reason)).toBeInTheDocument();
      expect(onBulkActionStartMock).not.toHaveBeenCalled();
      expect(onBulkActionEndMock).not.toHaveBeenCalled();
      expect(getItemMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  describe("the copy", () => {
    /*
     * A fresh monitor is stamped with the project's operational status
     * before any probe has checked the address, so the device reads Up the
     * moment it is bound. Nothing here may dress that up as a verdict.
     */
    test("never claims the device was verified reachable", async () => {
      await openModal([makeDevice(UNBOUND_DEVICE)]);

      const modalText: string = (
        screen.getByTestId("modal").textContent || ""
      ).toLowerCase();

      expect(modalText).toContain("bound");
      expect(modalText).not.toContain("verified");
      expect(modalText).not.toMatch(/\breachable\b/);

      const provisionedMessage: string =
        pingMonitorProvisionedMessage("Ping rack-pdu").toLowerCase();

      expect(provisionedMessage).not.toContain("verified");
      expect(provisionedMessage).not.toMatch(/\breachable\b/);
    });

    test("says what is skipped and that monitors count towards the plan", async () => {
      await openModal([makeDevice(UNBOUND_DEVICE)]);

      const description: string =
        screen.getByTestId("modal-description").textContent || "";

      expect(description).toContain("already have a monitor bound");
      // Probe-polled devices are pinged by their probe already, so they are skipped.
      expect(description).toContain("probe-polled devices");
      expect(description).toContain("plan");
      expect(description).toContain("Incidents are off");
    });
  });
});
