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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The device list's bulk "Set / Clear SNMP Credential Profile" actions.
 *
 * A profile only earns its keep once an existing fleet can be moved onto
 * it, and these two actions are that path. What has to hold, and what a
 * refactor drops silently:
 *
 *   - both actions are withheld from an all-monitor-backed selection (a
 *     profile on a device nothing polls opens nothing) and gated on the
 *     device-update permission;
 *   - the profile list is fetched when the modal opens, not on mount - the
 *     Devices page is mounted by other tests with no profile mock in place;
 *   - "Set" writes exactly `snmpCredentialProfileId` on every device, and
 *     nothing else - the device's own credentials are left alone;
 *   - "Clear" writes `snmpCredentialProfileId: null`, without reading first;
 *   - a project with no profiles gets a modal that links to the settings
 *     page instead of an empty dropdown, and a profile list that could not be
 *     LOADED gets a third modal saying so - neither is the form, whose
 *     required dropdown would have no options either way;
 *   - a failed update is reported against its device, and the action ends
 *     exactly once.
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

const getListMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();
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
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

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

import useBulkSnmpCredentialProfileActions, {
  BulkSnmpCredentialProfileActionsResult,
  CLEAR_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
  SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkSnmpCredentialProfileActions";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ModelAction } from "../../../UI/Utils/PermissionGate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSnmpCredentialProfile from "../../../Models/DatabaseModels/NetworkSnmpCredentialProfile";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";

/*
 * These tests drive a real Formik + react-select tree behind a modal, so the
 * testing-library default of 1s flakes on a loaded box.
 */
const WAIT_TIMEOUT: number = 20000;

const DEVICE_ONE_ID: string = "22222222-2222-4222-8222-222222222221";
const DEVICE_TWO_ID: string = "22222222-2222-4222-8222-222222222222";
const DEVICE_THREE_ID: string = "22222222-2222-4222-8222-222222222223";
const PROFILE_A_ID: string = "44444444-4444-4444-8444-444444444441";
const PROFILE_B_ID: string = "44444444-4444-4444-8444-444444444442";

const DEVICE_UPDATE_REASON: string =
  "You need the Edit Network Device permission to do this.";

interface DeviceFixture {
  id: string;
  name: string;
  method: NetworkDeviceMonitoringMethod;
}

type MakeDeviceFunction = (fixture: DeviceFixture) => NetworkDevice;

const makeDevice: MakeDeviceFunction = (
  fixture: DeviceFixture,
): NetworkDevice => {
  const device: NetworkDevice = new NetworkDevice();
  device._id = fixture.id;
  device.name = fixture.name;
  device.monitoringMethod = fixture.method;
  return device;
};

const PROBE_DEVICE: DeviceFixture = {
  id: DEVICE_ONE_ID,
  name: "core-switch-01",
  method: NetworkDeviceMonitoringMethod.Probe,
};

const SECOND_PROBE_DEVICE: DeviceFixture = {
  id: DEVICE_TWO_ID,
  name: "access-switch-02",
  method: NetworkDeviceMonitoringMethod.Probe,
};

const MONITOR_BACKED_DEVICE: DeviceFixture = {
  id: DEVICE_THREE_ID,
  name: "lobby-ap",
  method: NetworkDeviceMonitoringMethod.Monitor,
};

type MakeProfileFunction = (
  id: string,
  name: string,
  version: string,
) => NetworkSnmpCredentialProfile;

const makeProfile: MakeProfileFunction = (
  id: string,
  name: string,
  version: string,
): NetworkSnmpCredentialProfile => {
  const profile: NetworkSnmpCredentialProfile =
    new NetworkSnmpCredentialProfile();
  profile._id = id;
  profile.name = name;
  profile.snmpVersion = version;
  return profile;
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
 * per action - the same harness UseBulkCreatePingMonitors.test.tsx uses.
 */
const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const { bulkActions, modals }: BulkSnmpCredentialProfileActionsResult =
    useBulkSnmpCredentialProfileActions();

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

type RenderHarnessFunction = (items: Array<NetworkDevice>) => void;

/*
 * Inside a router, always. The "no profiles yet" modal offers an AppLink to
 * the settings page, and react-router's Link throws outright when it renders
 * with no router context - so a harness without one turns that modal into a
 * blank screen and every assertion about it into a timeout.
 */
const renderHarness: RenderHarnessFunction = (
  items: Array<NetworkDevice>,
): void => {
  render(
    <MemoryRouter>
      <Harness items={items} />
    </MemoryRouter>,
  );
};

type FindActionFunction = (
  title: string,
) => BulkActionButtonSchema<NetworkDevice>;

const findAction: FindActionFunction = (
  title: string,
): BulkActionButtonSchema<NetworkDevice> => {
  const action: BulkActionButtonSchema<NetworkDevice> | undefined =
    capturedActions.find((candidate: BulkActionButtonSchema<NetworkDevice>) => {
      return candidate.title === title;
    });

  if (!action) {
    throw new Error(`No "${title}" action was returned.`);
  }

  return action;
};

type OpenSetModalFunction = (items: Array<NetworkDevice>) => Promise<void>;

/*
 * Renders the harness, opens the "Set" modal and waits for its form to be on
 * screen - the profile fetch has settled by the time the combobox exists.
 */
const openSetModal: OpenSetModalFunction = async (
  items: Array<NetworkDevice>,
): Promise<void> => {
  renderHarness(items);

  fireEvent.click(
    screen.getByText(`Trigger ${SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE}`),
  );

  await waitFor(
    () => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
      );
    },
    { timeout: WAIT_TIMEOUT },
  );

  await screen.findByRole("combobox", undefined, { timeout: WAIT_TIMEOUT });
};

type SelectProfileFunction = (label: string) => Promise<void>;

/*
 * react-select renders its menu lazily; ArrowDown on the combobox is the only
 * interaction that mounts the option list.
 */
const selectProfile: SelectProfileFunction = async (
  label: string,
): Promise<void> => {
  const combobox: HTMLElement = await screen.findByRole("combobox", undefined, {
    timeout: WAIT_TIMEOUT,
  });
  fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.click(
    await screen.findByText(label, undefined, { timeout: WAIT_TIMEOUT }),
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

describe("useBulkSnmpCredentialProfileActions", () => {
  beforeEach(() => {
    progressSnapshots = [];
    capturedActions = [];
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

    getListMock.mockImplementation(
      (): Promise<{ data: Array<NetworkSnmpCredentialProfile> }> => {
        return Promise.resolve({
          data: [
            makeProfile(PROFILE_A_ID, "Branch offices", "V2c"),
            makeProfile(PROFILE_B_ID, "Datacenter", "V3"),
          ],
        });
      },
    );

    updateByIdMock.mockImplementation((): Promise<void> => {
      return Promise.resolve();
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  describe("where the actions are offered", () => {
    test("both are withheld from an all-monitor-backed selection and offered to a mixed one", () => {
      renderHarness([]);

      for (const title of [
        SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
        CLEAR_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
      ]) {
        const action: BulkActionButtonSchema<NetworkDevice> = findAction(title);

        expect(action.isVisible!([makeDevice(MONITOR_BACKED_DEVICE)])).toBe(
          false,
        );
        expect(
          action.isVisible!([
            makeDevice(MONITOR_BACKED_DEVICE),
            makeDevice(PROBE_DEVICE),
          ]),
        ).toBe(true);
        expect(action.isVisible!([makeDevice(PROBE_DEVICE)])).toBe(true);
        // The convention every bulk hook here follows - the bar is not drawn for one anyway.
        expect(action.isVisible!([])).toBe(true);
      }
    });

    test("both are disabled with the device-update reason when it is missing", () => {
      gateResults = {
        [`Network Device:${ModelAction.Update}`]: {
          isAllowed: false,
          disabledReason: DEVICE_UPDATE_REASON,
        },
      };

      renderHarness([]);

      for (const title of [
        SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
        CLEAR_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
      ]) {
        expect(findAction(title).disabled).toBe(true);
        expect(findAction(title).tooltip).toBe(DEVICE_UPDATE_REASON);
      }
    });

    test("both are offered plainly when the permission is held", () => {
      renderHarness([]);

      for (const title of [
        SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
        CLEAR_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
      ]) {
        expect(findAction(title).disabled).toBeUndefined();
        expect(findAction(title).tooltip).toBeUndefined();
      }
    });
  });

  describe("the profile list", () => {
    /*
     * The Devices page is mounted by other tests with ModelTable mocked and
     * no profile mock for this hook; a mount-time fetch would throw there.
     */
    test("is not fetched until the Set modal opens", async () => {
      renderHarness([makeDevice(PROBE_DEVICE)]);

      expect(getListMock).not.toHaveBeenCalled();

      fireEvent.click(
        screen.getByText(`Trigger ${SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE}`),
      );

      await waitFor(() => {
        expect(getListMock).toHaveBeenCalledTimes(1);
      });

      const request: any = (getListMock.mock.calls[0] as Array<any>)[0];
      expect(request.modelType).toBe(NetworkSnmpCredentialProfile);
      expect(request.select).toEqual({
        _id: true,
        name: true,
        snmpVersion: true,
      });
    });

    test("with no profiles, points at the settings page instead of an empty dropdown", async () => {
      getListMock.mockImplementation(
        (): Promise<{ data: Array<NetworkSnmpCredentialProfile> }> => {
          return Promise.resolve({ data: [] });
        },
      );

      renderHarness([makeDevice(PROBE_DEVICE)]);

      fireEvent.click(
        screen.getByText(`Trigger ${SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE}`),
      );

      await waitFor(
        () => {
          expect(screen.getByTestId("modal-title")).toHaveTextContent(
            "No SNMP Credential Profiles Yet",
          );
        },
        { timeout: WAIT_TIMEOUT },
      );

      const link: HTMLElement = screen.getByText(
        "Create an SNMP Credential Profile",
      );
      expect(link.closest("a")?.getAttribute("href")).toContain(
        "/settings/snmp-credential-profiles",
      );
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(updateByIdMock).not.toHaveBeenCalled();
    });

    /*
     * A failed fetch is NOT "this project has no profiles", and it is not the
     * form either: the dropdown is required and would have no options, so the
     * operator would be looking at a modal they cannot submit and cannot read
     * a reason off. It gets its own modal, which says the list could not be
     * loaded and that nothing was written.
     */
    test("when the list cannot be loaded, says so instead of offering an unusable form", async () => {
      getListMock.mockImplementation((): Promise<never> => {
        return Promise.reject(new Error("profiles unavailable"));
      });

      renderHarness([makeDevice(PROBE_DEVICE)]);

      fireEvent.click(
        screen.getByText(`Trigger ${SET_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE}`),
      );

      await waitFor(
        () => {
          expect(screen.getByTestId("modal-title")).toHaveTextContent(
            "SNMP Credential Profiles Could Not Be Loaded",
          );
        },
        { timeout: WAIT_TIMEOUT },
      );

      expect(
        screen.getByTestId("modal-description").textContent || "",
      ).toContain("could not be loaded just now");

      // No half-usable form behind the message, and no device touched.
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(updateByIdMock).not.toHaveBeenCalled();
    });
  });

  describe("Set SNMP Credential Profile", () => {
    test("writes the chosen profile id, and nothing else, on every selected device", async () => {
      await openSetModal([
        makeDevice(PROBE_DEVICE),
        makeDevice(SECOND_PROBE_DEVICE),
      ]);

      await selectProfile("Branch offices (V2c)");

      await submitAndWaitForEnd();

      expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
      expect(updateByIdMock).toHaveBeenCalledTimes(2);

      const requests: Array<any> = updateByIdMock.mock.calls.map(
        (call: Array<any>) => {
          return call[0];
        },
      );

      expect(
        requests.map((request: any): string => {
          return request.id.toString();
        }),
      ).toEqual([DEVICE_ONE_ID, DEVICE_TWO_ID]);

      for (const request of requests) {
        expect(request.modelType).toBe(NetworkDevice);
        expect(Object.keys(request.data)).toEqual(["snmpCredentialProfileId"]);
        expect(request.data.snmpCredentialProfileId.toString()).toBe(
          PROFILE_A_ID,
        );
      }

      const snapshot: ProgressSnapshot = lastSnapshot();
      expect(snapshot.successIds).toEqual([DEVICE_ONE_ID, DEVICE_TWO_ID]);
      expect(snapshot.failedIds).toEqual([]);
      expect(snapshot.inProgressIds).toEqual([]);
    });

    test("reports a failed update against its device and still ends once", async () => {
      updateByIdMock.mockImplementation(
        (request: { id: { toString: () => string } }): Promise<void> => {
          if (request.id.toString() === DEVICE_TWO_ID) {
            return Promise.reject(new Error("device is read-only"));
          }

          return Promise.resolve();
        },
      );

      await openSetModal([
        makeDevice(PROBE_DEVICE),
        makeDevice(SECOND_PROBE_DEVICE),
      ]);

      await selectProfile("Datacenter (V3)");

      await submitAndWaitForEnd();

      expect(progressSnapshots).toHaveLength(2);

      const snapshot: ProgressSnapshot = lastSnapshot();
      expect(snapshot.successIds).toEqual([DEVICE_ONE_ID]);
      expect(snapshot.failedIds).toEqual([DEVICE_TWO_ID]);
      expect(snapshot.failedMessages[0]).toContain("device is read-only");
      expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
    });

    /*
     * The device's own credentials win over the profile at poll time, and
     * a monitor-backed device is never polled; the modal has to say both
     * so the operator is not surprised by a device that does not change.
     */
    test("the modal says which devices a profile does not change", async () => {
      await openSetModal([makeDevice(PROBE_DEVICE)]);

      const description: string =
        screen.getByTestId("modal-description").textContent || "";

      expect(description).toContain("its own SNMP credentials");
      expect(description).toContain("monitor-backed");
    });
  });

  describe("Clear SNMP Credential Profile", () => {
    test("writes null on every selected device without reading first, straight from its confirm", async () => {
      renderHarness([]);

      const action: BulkActionButtonSchema<NetworkDevice> = findAction(
        CLEAR_SNMP_CREDENTIAL_PROFILE_ACTION_TITLE,
      );

      const items: Array<NetworkDevice> = [
        makeDevice(PROBE_DEVICE),
        makeDevice(SECOND_PROBE_DEVICE),
      ];

      expect(action.confirmTitle!(items)).toContain("2 devices");
      expect(action.confirmMessage!(items)).toContain("pinged only");

      await action.onClick(makeActionProps(items));

      expect(getListMock).not.toHaveBeenCalled();
      expect(updateByIdMock).toHaveBeenCalledTimes(2);

      for (const call of updateByIdMock.mock.calls as Array<Array<any>>) {
        expect(call[0].modelType).toBe(NetworkDevice);
        expect(call[0].data).toEqual({ snmpCredentialProfileId: null });
      }

      expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
      expect(lastSnapshot().successIds).toEqual([DEVICE_ONE_ID, DEVICE_TWO_ID]);
    });
  });
});
