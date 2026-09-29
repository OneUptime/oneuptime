import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import fs from "fs";
import path from "path";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The device list's bulk "Shorten Names to Hostname" action (issue #3678).
 *
 * The scan setting names what discovery imports from now on by its short
 * hostname; this action is how the devices ALREADY imported under their full
 * DNS names get the same treatment. The decision rules themselves are the
 * planner's, and tested there. What has to hold here — and what a refactor of
 * the hook drops silently — is everything around them:
 *
 *   - the action is gated on the device-update permission, and withheld from
 *     a selection with nothing it could rename;
 *   - the confirmation says how many devices change, shows a few "old → new"
 *     examples, and warns about every side effect a rename has that is not
 *     obvious from "the name changes";
 *   - each device is decided on a FRESH read, and skipped when its name
 *     changed since it was selected;
 *   - the short name is checked against the rest of the project with a
 *     case-insensitive exact match, excluding the device itself, and a device
 *     whose short name is taken is skipped with the holder named;
 *   - two selected devices that would share a short name are both skipped;
 *   - the write is exactly `{ name }` or `{ name, dnsName }`;
 *   - a failure is reported against its device, the loop carries on, progress
 *     is reported after every device, and the action ends exactly once.
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
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
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

import useBulkShortenDeviceNames, {
  BulkShortenDeviceNamesResult,
  buildNameTakenMessage,
  buildShortenDeviceNamesConfirmMessage,
  DEVICE_NOT_FOUND_MESSAGE,
  MAX_CONFIRM_EXAMPLES,
  SHORTEN_DEVICE_NAMES_ACTION_TITLE,
  SKIPPED_NAME_CHANGED_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkShortenDeviceNames";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { ModelAction } from "../../../UI/Utils/PermissionGate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ObjectID from "../../../Types/ObjectID";
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import {
  SKIPPED_NO_NAME_MESSAGE,
  SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE,
} from "../../../Utils/NetworkDiscovery/ShortDeviceNamePlanner";

const CURRENT_PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const DEVICE_PROJECT_ID: string = "33333333-3333-4333-8333-333333333333";

const DEVICE_ONE_ID: string = "22222222-2222-4222-8222-222222222221";
const DEVICE_TWO_ID: string = "22222222-2222-4222-8222-222222222222";
const DEVICE_THREE_ID: string = "22222222-2222-4222-8222-222222222223";
const DEVICE_FOUR_ID: string = "22222222-2222-4222-8222-222222222224";
const OTHER_DEVICE_ID: string = "22222222-2222-4222-8222-222222222299";

const DEVICE_UPDATE_REASON: string =
  "You need the Edit Network Device permission to do this.";

interface DeviceFixture {
  id: string;
  name?: string | undefined;
  hostname?: string | undefined;
  sysName?: string | undefined;
  dnsName?: string | undefined;
  projectId?: string | undefined;
}

type MakeDeviceFunction = (fixture: DeviceFixture) => NetworkDevice;

const makeDevice: MakeDeviceFunction = (
  fixture: DeviceFixture,
): NetworkDevice => {
  const device: NetworkDevice = new NetworkDevice();
  device._id = fixture.id;

  if (fixture.name !== undefined) {
    device.name = fixture.name;
  }

  if (fixture.hostname !== undefined) {
    device.hostname = fixture.hostname;
  }

  if (fixture.sysName !== undefined) {
    device.sysName = fixture.sysName;
  }

  if (fixture.dnsName !== undefined) {
    device.dnsName = fixture.dnsName;
  }

  device.projectId = new ObjectID(fixture.projectId || DEVICE_PROJECT_ID);

  return device;
};

// The issue's own example: an FQDN from reverse DNS, nothing else known.
const KDS_ONE: DeviceFixture = {
  id: DEVICE_ONE_ID,
  name: "wb-0660-kds01.wbhq.com",
  hostname: "10.18.167.31",
};

const KDS_TWO: DeviceFixture = {
  id: DEVICE_TWO_ID,
  name: "wb-0660-kds02.wbhq.com",
  hostname: "10.18.167.32",
};

// An operator's name. There is no domain to drop.
const CORE_SWITCH: DeviceFixture = {
  id: DEVICE_THREE_ID,
  name: "Core Switch",
  hostname: "10.0.0.1",
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
let capturedResult: BulkShortenDeviceNamesResult | null = null;

/*
 * What the server holds, keyed by device id. getItem answers from here, so a
 * test can make the fresh read disagree with the row.
 */
let serverDevices: Record<string, NetworkDevice> = {};

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

/*
 * The hook is called inside a component, as the Devices page calls it, so the
 * permission gate is evaluated the way it is in the app.
 */
const Harness: FunctionComponent = (): ReactElement => {
  capturedResult = useBulkShortenDeviceNames();
  return <div />;
};

type GetActionFunction = () => BulkActionButtonSchema<NetworkDevice>;

const getAction: GetActionFunction =
  (): BulkActionButtonSchema<NetworkDevice> => {
    render(<Harness />);

    const action: BulkActionButtonSchema<NetworkDevice> | undefined =
      capturedResult?.bulkActions.find(
        (candidate: BulkActionButtonSchema<NetworkDevice>) => {
          return candidate.title === SHORTEN_DEVICE_NAMES_ACTION_TITLE;
        },
      );

    if (!action) {
      throw new Error(
        `No "${SHORTEN_DEVICE_NAMES_ACTION_TITLE}" action was returned.`,
      );
    }

    return action;
  };

type SeedServerFunction = (fixtures: Array<DeviceFixture>) => void;

const seedServer: SeedServerFunction = (
  fixtures: Array<DeviceFixture>,
): void => {
  for (const fixture of fixtures) {
    serverDevices[fixture.id] = makeDevice(fixture);
  }
};

type RunActionFunction = (
  rows: Array<DeviceFixture>,
  server?: Array<DeviceFixture> | undefined,
) => Promise<void>;

/*
 * Runs the action over `rows` as the table holds them. Unless told otherwise
 * the server holds exactly the same devices, so the fresh read agrees with
 * the row.
 */
const runAction: RunActionFunction = async (
  rows: Array<DeviceFixture>,
  server?: Array<DeviceFixture> | undefined,
): Promise<void> => {
  seedServer(server || rows);

  const action: BulkActionButtonSchema<NetworkDevice> = getAction();

  await action.onClick(makeActionProps(rows.map(makeDevice)));
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

type UpdateCallsFunction = () => Array<{ id: string; data: any }>;

const updateCalls: UpdateCallsFunction = (): Array<{
  id: string;
  data: any;
}> => {
  return (updateByIdMock.mock.calls as Array<Array<any>>).map(
    (call: Array<any>) => {
      return { id: call[0].id.toString(), data: call[0].data };
    },
  );
};

type ListRequestsFunction = () => Array<any>;

const listRequests: ListRequestsFunction = (): Array<any> => {
  return (getListMock.mock.calls as Array<Array<any>>).map(
    (call: Array<any>) => {
      return call[0];
    },
  );
};

type FailedMessageForFunction = (id: string) => string | undefined;

const failedMessageFor: FailedMessageForFunction = (
  id: string,
): string | undefined => {
  const snapshot: ProgressSnapshot = lastSnapshot();
  const index: number = snapshot.failedIds.indexOf(id);
  return index === -1 ? undefined : snapshot.failedMessages[index];
};

describe("useBulkShortenDeviceNames", () => {
  beforeEach(() => {
    progressSnapshots = [];
    capturedResult = null;
    serverDevices = {};
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
        return Promise.resolve(serverDevices[request.id.toString()] || null);
      },
    );

    getListMock.mockImplementation(
      (): Promise<{ data: Array<NetworkDevice>; count: number }> => {
        return Promise.resolve({ data: [], count: 0 });
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

  describe("the action itself", () => {
    test("is one confirm-only action with no modal to mount", () => {
      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      expect(Object.keys(capturedResult!)).toEqual(["bulkActions"]);
      expect(capturedResult!.bulkActions).toHaveLength(1);
      expect(action.title).toBe("Shorten Names to Hostname");
      expect(action.buttonStyleType).toBe(ButtonStyleType.NORMAL);
      expect(typeof action.confirmMessage).toBe("function");
      expect(typeof action.confirmTitle).toBe("function");
    });

    test("touches nothing on the server just by being mounted or confirmed", () => {
      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      action.confirmTitle!([makeDevice(KDS_ONE)]);
      action.confirmMessage!([makeDevice(KDS_ONE)]);

      expect(getItemMock).not.toHaveBeenCalled();
      expect(getListMock).not.toHaveBeenCalled();
      expect(updateByIdMock).not.toHaveBeenCalled();
    });
  });

  describe("the permission gate", () => {
    test("checks the device-update permission", () => {
      getAction();

      expect(permissionCheckMock).toHaveBeenCalled();

      const call: Array<unknown> = permissionCheckMock.mock
        .calls[0] as Array<unknown>;

      expect(call[0]).toBeInstanceOf(NetworkDevice);
      expect(call[1]).toBe(ModelAction.Update);
    });

    test("is disabled with the device-update reason when the permission is missing", () => {
      gateResults = {
        [`Network Device:${ModelAction.Update}`]: {
          isAllowed: false,
          disabledReason: DEVICE_UPDATE_REASON,
        },
      };

      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      expect(action.disabled).toBe(true);
      expect(action.tooltip).toBe(DEVICE_UPDATE_REASON);
    });

    test("is offered plainly when the permission is held", () => {
      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      expect(action.disabled).toBeUndefined();
      expect(action.tooltip).toBeUndefined();
    });

    /*
     * The permission snapshot can still be loading, in which case the gate
     * says "not allowed" with nothing to say why. Locking the action then
     * would accuse the user of lacking a permission they may well hold.
     */
    test("is left alone when the gate has no reason to give", () => {
      gateResults = {
        [`Network Device:${ModelAction.Update}`]: {
          isAllowed: false,
        },
      };

      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      expect(action.disabled).toBeUndefined();
      expect(action.tooltip).toBeUndefined();
    });
  });

  describe("where the action is offered", () => {
    test("is withheld from a selection with no name it could shorten", () => {
      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      expect(
        action.isVisible!([
          makeDevice(CORE_SWITCH),
          makeDevice({ id: DEVICE_FOUR_ID, name: "10.0.0.9" }),
        ]),
      ).toBe(false);
    });

    test("is offered to a mixed selection and to an empty one", () => {
      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      expect(
        action.isVisible!([makeDevice(CORE_SWITCH), makeDevice(KDS_ONE)]),
      ).toBe(true);
      // The convention every bulk hook here follows - the bar is not drawn for one anyway.
      expect(action.isVisible!([])).toBe(true);
    });

    /*
     * Two devices that would share a short name are both skipped - but that
     * is an outcome the operator should be told about, not a button that
     * vanishes without saying why.
     */
    test("stays offered when the only shortenable devices collide with each other", () => {
      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      expect(
        action.isVisible!([
          makeDevice({ id: DEVICE_ONE_ID, name: "kds01.store-1.example.com" }),
          makeDevice({ id: DEVICE_TWO_ID, name: "kds01.store-2.example.com" }),
        ]),
      ).toBe(true);
    });
  });

  describe("the confirmation", () => {
    test("the title counts one device in the singular", () => {
      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      expect(action.confirmTitle!([makeDevice(KDS_ONE)])).toBe(
        "Shorten the name of 1 device to the hostname?",
      );
    });

    test("the title counts several devices in the plural", () => {
      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      expect(
        action.confirmTitle!([
          makeDevice(KDS_ONE),
          makeDevice(KDS_TWO),
          makeDevice(CORE_SWITCH),
        ]),
      ).toBe("Shorten the names of 3 devices to the hostname?");
    });

    test("a single device is shown with its old and new name", () => {
      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      const message: string = action.confirmMessage!([makeDevice(KDS_ONE)]);

      expect(message).toContain("This device will be renamed");
      expect(message).toContain("wb-0660-kds01.wbhq.com → wb-0660-kds01");
      expect(message).not.toContain("selected devices");
    });

    test("several devices are counted against the selection, with each rename shown", () => {
      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      const message: string = action.confirmMessage!([
        makeDevice(KDS_ONE),
        makeDevice(KDS_TWO),
        makeDevice(CORE_SWITCH),
      ]);

      expect(message).toContain(
        "2 of the 3 selected devices will be renamed to their hostname",
      );
      expect(message).toContain("wb-0660-kds01.wbhq.com → wb-0660-kds01");
      expect(message).toContain("wb-0660-kds02.wbhq.com → wb-0660-kds02");
      // The device that is left alone is counted, not listed as a rename.
      expect(message).toContain("1 device is left as it is");
      expect(message).not.toContain("Core Switch →");
    });

    test(`lists at most ${MAX_CONFIRM_EXAMPLES} examples and counts the rest`, () => {
      const action: BulkActionButtonSchema<NetworkDevice> = getAction();

      const items: Array<NetworkDevice> = [];

      for (let index: number = 1; index <= 8; index++) {
        items.push(
          makeDevice({
            id: `22222222-2222-4222-8222-00000000000${index}`,
            name: `kds0${index}.wbhq.com`,
          }),
        );
      }

      const message: string = action.confirmMessage!(items);

      expect(message.split("→")).toHaveLength(MAX_CONFIRM_EXAMPLES + 1);
      expect(message).toContain("kds01.wbhq.com → kds01");
      expect(message).toContain("kds05.wbhq.com → kds05");
      expect(message).not.toContain("kds06.wbhq.com → kds06");
      expect(message).toContain("…and 3 more.");
      expect(message).toContain("8 of the 8 selected devices");
    });

    test("an address-suffixed name is previewed keeping its suffix", () => {
      const message: string = buildShortenDeviceNamesConfirmMessage([
        makeDevice({
          id: DEVICE_ONE_ID,
          name: "kds01.store-1.example.com (10.0.0.5)",
          hostname: "10.0.0.5",
        }),
      ]);

      expect(message).toContain(
        "kds01.store-1.example.com (10.0.0.5) → kds01 (10.0.0.5)",
      );
    });

    test("devices that would share a short name are not previewed as renames", () => {
      const message: string = buildShortenDeviceNamesConfirmMessage([
        makeDevice({ id: DEVICE_ONE_ID, name: "kds01.store-1.example.com" }),
        makeDevice({ id: DEVICE_TWO_ID, name: "kds01.store-2.example.com" }),
        makeDevice(KDS_TWO),
      ]);

      expect(message).toContain("1 of the 3 selected devices will be renamed");
      expect(message).not.toContain("→ kds01");
      expect(message).toContain("2 devices are left as they are");
      expect(message).toContain("sharing a short name");
    });

    test("says so plainly when nothing in the selection can be renamed", () => {
      expect(
        buildShortenDeviceNamesConfirmMessage([makeDevice(CORE_SWITCH)]),
      ).toContain("will be left as it is");

      const plural: string = buildShortenDeviceNamesConfirmMessage([
        makeDevice(CORE_SWITCH),
        makeDevice({ id: DEVICE_FOUR_ID, name: "10.0.0.9" }),
      ]);

      expect(plural).toContain("none will be renamed");
      expect(plural).not.toContain("→");
    });

    /*
     * Each of these is a side effect of a rename that is invisible from "the
     * name changes", and each is the kind of thing an operator finds out about
     * a week later on a fleet of 900 devices.
     */
    test("warns about every side effect a rename has", () => {
      const message: string = buildShortenDeviceNamesConfirmMessage([
        makeDevice(KDS_ONE),
        makeDevice(KDS_TWO),
      ]);

      /*
       * The FQDN is not thrown away - and the two cases where the planner
       * deliberately does NOT copy it are named, so the operator is not told
       * a sysName-named switch will be findable by a DNS Name it never gets.
       */
      expect(message).toContain("its full name is kept as its DNS Name");
      expect(message).toContain("SNMP System Name (which keeps it already)");
      expect(message).toContain("80 characters or longer");
      // Names are a site-rule identity column.
      expect(message).toContain("Site-assignment rules run again");
      // Label and owner rules run only on create.
      expect(message).toContain("Label and owner rules are not applied again");
      expect(message).toContain("Run Now");
      // Monitor names were copied from the device name at creation.
      expect(message).toContain("Ping monitors keep their current names");
      // Metrics carry the device name as an attribute.
      expect(message).toContain("start a new series");
      // Uniqueness is checked as it goes.
      expect(message).toContain("another device already has its short name");
    });

    test("the warnings are shown even when nothing can be renamed", () => {
      const message: string = buildShortenDeviceNamesConfirmMessage([
        makeDevice(CORE_SWITCH),
      ]);

      expect(message).toContain("Site-assignment rules run again");
    });
  });

  describe("deciding on a fresh read", () => {
    test("re-reads each device with the fields the plan needs", async () => {
      await runAction([KDS_ONE]);

      expect(getItemMock).toHaveBeenCalledTimes(1);

      const request: any = (getItemMock.mock.calls[0] as Array<any>)[0];

      expect(request.modelType).toBe(NetworkDevice);
      expect(request.id.toString()).toBe(DEVICE_ONE_ID);
      expect(request.select).toEqual({
        _id: true,
        name: true,
        hostname: true,
        sysName: true,
        dnsName: true,
        projectId: true,
      });
    });

    test("skips a device whose name changed since it was selected, without writing", async () => {
      await runAction(
        [KDS_ONE, KDS_TWO],
        [KDS_ONE, { ...KDS_TWO, name: "front-counter-kds" }],
      );

      expect(failedMessageFor(DEVICE_TWO_ID)).toBe(
        SKIPPED_NAME_CHANGED_MESSAGE,
      );
      expect(SKIPPED_NAME_CHANGED_MESSAGE).toBe(
        "Skipped: the name changed since it was selected.",
      );
      expect(
        updateCalls().map((call: { id: string }) => {
          return call.id;
        }),
      ).toEqual([DEVICE_ONE_ID]);

      // No collision query is spent on a device that will not be renamed.
      expect(listRequests()).toHaveLength(1);
      expect(lastSnapshot().successIds).toEqual([DEVICE_ONE_ID]);
    });

    /*
     * Even a rename only in case is somebody's decision; the operator
     * confirmed the name they saw, not this one.
     */
    test("a name changed only in case counts as changed", async () => {
      await runAction(
        [KDS_ONE],
        [{ ...KDS_ONE, name: "WB-0660-KDS01.wbhq.com" }],
      );

      expect(failedMessageFor(DEVICE_ONE_ID)).toBe(
        SKIPPED_NAME_CHANGED_MESSAGE,
      );
      expect(updateByIdMock).not.toHaveBeenCalled();
    });

    test("keeps no DNS name when the device was given one since the row was loaded", async () => {
      await runAction(
        [KDS_ONE],
        [{ ...KDS_ONE, dnsName: "wb-0660-kds01.store-0660.wbhq.com" }],
      );

      expect(updateCalls()).toEqual([
        { id: DEVICE_ONE_ID, data: { name: "wb-0660-kds01" } },
      ]);
    });

    test("keeps the DNS name when the row showed one but the device no longer has it", async () => {
      await runAction([{ ...KDS_ONE, dnsName: "stale.wbhq.com" }], [KDS_ONE]);

      expect(updateCalls()).toEqual([
        {
          id: DEVICE_ONE_ID,
          data: {
            name: "wb-0660-kds01",
            dnsName: "wb-0660-kds01.wbhq.com",
          },
        },
      ]);
    });

    test("a device that can no longer be read is reported and the rest carry on", async () => {
      await runAction([KDS_ONE, KDS_TWO], [KDS_TWO]);

      expect(failedMessageFor(DEVICE_ONE_ID)).toBe(DEVICE_NOT_FOUND_MESSAGE);
      expect(lastSnapshot().successIds).toEqual([DEVICE_TWO_ID]);
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
    });

    test("a device without an id is reported, not sent", async () => {
      seedServer([KDS_ONE]);

      const action: BulkActionButtonSchema<NetworkDevice> = getAction();
      const idless: NetworkDevice = new NetworkDevice();
      idless.name = "kds09.wbhq.com";

      await action.onClick(makeActionProps([idless, makeDevice(KDS_ONE)]));

      const snapshot: ProgressSnapshot = lastSnapshot();
      expect(snapshot.failedMessages[0]).toContain("Item ID not found");
      expect(snapshot.successIds).toEqual([DEVICE_ONE_ID]);
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("the collision check against the rest of the project", () => {
    test("asks for at most two devices with the short name, in the device's project", async () => {
      await runAction([KDS_ONE]);

      expect(getListMock).toHaveBeenCalledTimes(1);

      const request: any = listRequests()[0];

      expect(request.modelType).toBe(NetworkDevice);
      expect(request.limit).toBe(2);
      expect(request.skip).toBe(0);
      expect(request.select).toEqual({ _id: true, name: true });
      expect(Object.keys(request.query).sort()).toEqual(["name", "projectId"]);
      expect(request.query.projectId.toString()).toBe(DEVICE_PROJECT_ID);
      expect(request.query.name).toBeInstanceOf(Wildcard);
      expect((request.query.name as Wildcard<string>).values).toEqual([
        "wb-0660-kds01",
      ]);
    });

    /*
     * Uniqueness is case-insensitive at create time (LOWER(name) = ...). A
     * plain string would be case-sensitive equality and `Search` a substring
     * match; `Wildcard` compiles to ILIKE over an escaped pattern, which is
     * the same comparison - provided nothing in the name is read as a pattern.
     */
    test("is an exact match: nothing in the short name is read as a pattern", async () => {
      await runAction([
        { id: DEVICE_ONE_ID, name: "kds_01.wbhq.com", hostname: "10.0.0.8" },
      ]);

      const wildcard: Wildcard<string> = listRequests()[0].query.name;

      // `_` is a single-character wildcard to LIKE; here it must be literal.
      expect(wildcard.toPatterns()).toEqual(["kds\\_01"]);
      expect(wildcard.toPatterns()[0]).not.toContain("%");
    });

    /*
     * The suffix is the device's hostname as somebody typed it, so it is the
     * one part of a new name that can carry a glob character. `?` must stay a
     * question mark, not become LIKE's any-single-character `_`.
     */
    test("a glob character in the suffix is matched literally", async () => {
      await runAction([
        {
          id: DEVICE_ONE_ID,
          name: "kds01.store-1.example.com (edge?1*)",
          hostname: "edge?1*",
        },
      ]);

      const wildcard: Wildcard<string> = listRequests()[0].query.name;

      expect(wildcard.toPatterns()).toEqual(["kds01 (edge?1*)"]);
      expect(updateCalls()).toEqual([
        {
          id: DEVICE_ONE_ID,
          data: {
            name: "kds01 (edge?1*)",
            dnsName: "kds01.store-1.example.com",
          },
        },
      ]);
    });

    test("a suffixed name is checked as the whole new name, suffix included", async () => {
      await runAction([
        {
          id: DEVICE_ONE_ID,
          name: "kds01.store-1.example.com (10.0.0.5)",
          hostname: "10.0.0.5",
        },
      ]);

      const wildcard: Wildcard<string> = listRequests()[0].query.name;

      expect(wildcard.values).toEqual(["kds01 (10.0.0.5)"]);
      expect(wildcard.toPatterns()).toEqual(["kds01 (10.0.0.5)"]);
    });

    test("falls back to the current project when the device's project was not returned", async () => {
      seedServer([KDS_ONE]);
      (
        serverDevices[DEVICE_ONE_ID] as unknown as { projectId: unknown }
      ).projectId = undefined;

      const action: BulkActionButtonSchema<NetworkDevice> = getAction();
      await action.onClick(makeActionProps([makeDevice(KDS_ONE)]));

      expect(listRequests()[0].query.projectId.toString()).toBe(
        CURRENT_PROJECT_ID,
      );
    });

    test("skips a device whose short name another device already has, naming that device", async () => {
      getListMock.mockImplementation(
        (request: {
          query: { name: Wildcard<string> };
        }): Promise<{ data: Array<NetworkDevice> }> => {
          if (request.query.name.value === "wb-0660-kds01") {
            return Promise.resolve({
              data: [
                makeDevice({ id: OTHER_DEVICE_ID, name: "WB-0660-KDS01" }),
              ],
            });
          }

          return Promise.resolve({ data: [] });
        },
      );

      await runAction([KDS_ONE, KDS_TWO]);

      const message: string | undefined = failedMessageFor(DEVICE_ONE_ID);

      expect(message).toBe(
        buildNameTakenMessage({
          newName: "wb-0660-kds01",
          existingDeviceName: "WB-0660-KDS01",
        }),
      );
      expect(message).toMatch(/^Skipped: /);
      expect(message).toContain('"WB-0660-KDS01"');

      // The loop carried on to the next device, which was renamed.
      expect(
        updateCalls().map((call: { id: string }) => {
          return call.id;
        }),
      ).toEqual([DEVICE_TWO_ID]);
      expect(lastSnapshot().successIds).toEqual([DEVICE_TWO_ID]);
    });

    test("the device itself in the results is not a collision", async () => {
      getListMock.mockImplementation(
        (): Promise<{ data: Array<NetworkDevice> }> => {
          return Promise.resolve({
            data: [makeDevice({ id: DEVICE_ONE_ID, name: "wb-0660-kds01" })],
          });
        },
      );

      await runAction([KDS_ONE]);

      expect(lastSnapshot().successIds).toEqual([DEVICE_ONE_ID]);
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    test("another device next to the device itself in the results is still a collision", async () => {
      getListMock.mockImplementation(
        (): Promise<{ data: Array<NetworkDevice> }> => {
          return Promise.resolve({
            data: [
              makeDevice({ id: DEVICE_ONE_ID, name: "wb-0660-kds01" }),
              makeDevice({ id: OTHER_DEVICE_ID, name: "Wb-0660-Kds01" }),
            ],
          });
        },
      );

      await runAction([KDS_ONE]);

      expect(failedMessageFor(DEVICE_ONE_ID)).toContain('"Wb-0660-Kds01"');
      expect(updateByIdMock).not.toHaveBeenCalled();
    });

    test("a failed collision check is reported against the device and nothing is written", async () => {
      getListMock.mockImplementation((): Promise<never> => {
        return Promise.reject(new Error("list unavailable"));
      });

      await runAction([KDS_ONE]);

      expect(failedMessageFor(DEVICE_ONE_ID)).toContain("list unavailable");
      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("what is written", () => {
    test("the short name and the full name as the DNS name, and nothing else", async () => {
      await runAction([KDS_ONE]);

      expect(updateByIdMock).toHaveBeenCalledTimes(1);

      const request: any = (updateByIdMock.mock.calls[0] as Array<any>)[0];

      expect(request.modelType).toBe(NetworkDevice);
      expect(request.id.toString()).toBe(DEVICE_ONE_ID);
      expect(request.data).toEqual({
        name: "wb-0660-kds01",
        dnsName: "wb-0660-kds01.wbhq.com",
      });
      expect(Object.keys(request.data).sort()).toEqual(["dnsName", "name"]);
    });

    test("only the name when the device already has a DNS name", async () => {
      await runAction([{ ...KDS_ONE, dnsName: "wb-0660-kds01.wbhq.com" }]);

      const request: any = (updateByIdMock.mock.calls[0] as Array<any>)[0];

      expect(request.data).toEqual({ name: "wb-0660-kds01" });
      expect(Object.keys(request.data)).toEqual(["name"]);
    });

    /*
     * A name that IS the device's sysName is still stored as sysName, so
     * nothing is lost by not copying it - and it may not be a DNS name at
     * all.
     */
    test("only the name when the old name is the device's sysName", async () => {
      await runAction([
        {
          id: DEVICE_ONE_ID,
          name: "core-sw-01.corp.example.com",
          sysName: "CORE-SW-01.corp.example.com",
          hostname: "10.0.0.2",
        },
      ]);

      expect(updateCalls()).toEqual([
        { id: DEVICE_ONE_ID, data: { name: "core-sw-01" } },
      ]);
    });

    test("an address-suffixed name becomes the short name with the same suffix", async () => {
      await runAction([
        {
          id: DEVICE_ONE_ID,
          name: "kds01.store-1.example.com (10.0.0.5)",
          hostname: "10.0.0.5",
        },
      ]);

      expect(updateCalls()).toEqual([
        {
          id: DEVICE_ONE_ID,
          data: {
            name: "kds01 (10.0.0.5)",
            dnsName: "kds01.store-1.example.com",
          },
        },
      ]);
    });

    test("a name that is not a fully qualified hostname is skipped without a collision check or write", async () => {
      await runAction([CORE_SWITCH, { id: DEVICE_FOUR_ID, name: "10.0.0.9" }]);

      expect(failedMessageFor(DEVICE_THREE_ID)).toBe(
        SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE,
      );
      expect(failedMessageFor(DEVICE_FOUR_ID)).toBe(
        SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE,
      );
      expect(getListMock).not.toHaveBeenCalled();
      expect(updateByIdMock).not.toHaveBeenCalled();
    });

    test("a device with no name is skipped with the planner's message", async () => {
      await runAction(
        [{ id: DEVICE_ONE_ID, name: "" }],
        [{ id: DEVICE_ONE_ID, name: "" }],
      );

      expect(failedMessageFor(DEVICE_ONE_ID)).toBe(SKIPPED_NO_NAME_MESSAGE);
      expect(updateByIdMock).not.toHaveBeenCalled();
    });
  });

  describe("devices in the selection that would share a short name", () => {
    /*
     * "First one wins" would make the outcome depend on how the table was
     * sorted, and could rename the wrong device of the two.
     */
    test("are all skipped, each naming the other, while the rest are renamed", async () => {
      const storeOne: DeviceFixture = {
        id: DEVICE_ONE_ID,
        name: "kds01.store-1.example.com",
        hostname: "10.1.0.5",
      };
      const storeTwo: DeviceFixture = {
        id: DEVICE_TWO_ID,
        name: "kds01.store-2.example.com",
        hostname: "10.2.0.5",
      };

      await runAction([
        storeOne,
        storeTwo,
        { ...KDS_TWO, id: DEVICE_THREE_ID },
      ]);

      const first: string | undefined = failedMessageFor(DEVICE_ONE_ID);
      const second: string | undefined = failedMessageFor(DEVICE_TWO_ID);

      expect(first).toMatch(/^Skipped: /);
      expect(first).toContain('"kds01.store-2.example.com"');
      expect(first).toContain('"kds01"');
      expect(second).toMatch(/^Skipped: /);
      expect(second).toContain('"kds01.store-1.example.com"');

      expect(updateCalls()).toEqual([
        {
          id: DEVICE_THREE_ID,
          data: {
            name: "wb-0660-kds02",
            dnsName: "wb-0660-kds02.wbhq.com",
          },
        },
      ]);

      // Only the device that could be renamed cost a collision query.
      expect(listRequests()).toHaveLength(1);
      expect(lastSnapshot().successIds).toEqual([DEVICE_THREE_ID]);
    });

    test("collide without regard to case", async () => {
      await runAction([
        { id: DEVICE_ONE_ID, name: "KDS01.store-1.example.com" },
        { id: DEVICE_TWO_ID, name: "kds01.store-2.example.com" },
      ]);

      expect(failedMessageFor(DEVICE_ONE_ID)).toMatch(/^Skipped: /);
      expect(failedMessageFor(DEVICE_TWO_ID)).toMatch(/^Skipped: /);
      expect(updateByIdMock).not.toHaveBeenCalled();
    });
  });

  describe("progress and failures", () => {
    test("a rejected update is reported against its device and the loop continues", async () => {
      updateByIdMock.mockImplementation(
        (request: { id: { toString: () => string } }): Promise<void> => {
          if (request.id.toString() === DEVICE_ONE_ID) {
            return Promise.reject(new Error("device is read-only"));
          }

          return Promise.resolve();
        },
      );

      await runAction([KDS_ONE, KDS_TWO]);

      expect(updateByIdMock).toHaveBeenCalledTimes(2);

      const snapshot: ProgressSnapshot = lastSnapshot();
      expect(snapshot.failedIds).toEqual([DEVICE_ONE_ID]);
      expect(snapshot.failedMessages[0]).toContain("device is read-only");
      expect(snapshot.successIds).toEqual([DEVICE_TWO_ID]);
      expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
    });

    test("reports progress after every device, and ends the action once", async () => {
      await runAction([KDS_ONE, CORE_SWITCH, KDS_TWO]);

      expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
      expect(progressSnapshots).toHaveLength(3);

      expect(progressSnapshots[0]).toEqual({
        inProgressIds: [DEVICE_THREE_ID, DEVICE_TWO_ID],
        successIds: [DEVICE_ONE_ID],
        failedIds: [],
        failedMessages: [],
      });
      expect(progressSnapshots[1]).toEqual({
        inProgressIds: [DEVICE_TWO_ID],
        successIds: [DEVICE_ONE_ID],
        failedIds: [DEVICE_THREE_ID],
        failedMessages: [SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE],
      });
      expect(progressSnapshots[2]).toEqual({
        inProgressIds: [],
        successIds: [DEVICE_ONE_ID, DEVICE_TWO_ID],
        failedIds: [DEVICE_THREE_ID],
        failedMessages: [SKIPPED_NOT_FULLY_QUALIFIED_MESSAGE],
      });

      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
    });

    test("starts before the first read and ends after the last write", async () => {
      const order: Array<string> = [];

      onBulkActionStartMock.mockImplementation((): void => {
        order.push("start");
      });
      getItemMock.mockImplementation(
        (request: { id: ObjectID }): Promise<NetworkDevice | null> => {
          order.push("read");
          return Promise.resolve(serverDevices[request.id.toString()] || null);
        },
      );
      updateByIdMock.mockImplementation((): Promise<void> => {
        order.push("write");
        return Promise.resolve();
      });
      onBulkActionEndMock.mockImplementation((): void => {
        order.push("end");
      });

      await runAction([KDS_ONE, KDS_TWO]);

      expect(order).toEqual(["start", "read", "write", "read", "write", "end"]);
    });

    test("every skip is reported through the failed list with the Skipped prefix", async () => {
      await runAction(
        [KDS_ONE, CORE_SWITCH],
        [{ ...KDS_ONE, name: "renamed.wbhq.com" }, CORE_SWITCH],
      );

      for (const message of lastSnapshot().failedMessages) {
        expect(message).toMatch(/^Skipped: /);
      }

      expect(lastSnapshot().successIds).toEqual([]);
      expect(lastSnapshot().failedIds).toEqual([
        DEVICE_ONE_ID,
        DEVICE_THREE_ID,
      ]);
    });
  });
});

/*
 * The confirmation promises that "the full name is kept as the device's DNS
 * Name". That promise is only worth something if the operator can SEE the
 * kept name afterwards, and the one place it is shown is the device Overview
 * card. Pinned against the source - comments stripped, whitespace squashed -
 * because the card is JSX configuration with no logic to render against.
 *
 * Three things about the row matter: it is a read-only detail row and never
 * an edit-form field (the value is a record of what DNS said, not something
 * to type); it sits right after Hostname, beside the address it describes;
 * and it is hidden when empty, since most hand-made devices never have one.
 */
describe("the kept DNS name on the device Overview", () => {
  const OVERVIEW_SOURCE_PATH: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "Dashboard",
    "src",
    "Pages",
    "NetworkDevice",
    "View",
    "Index.tsx",
  );

  const source: string = fs
    .readFileSync(OVERVIEW_SOURCE_PATH, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");

  const formFieldsStart: number = source.indexOf("formFields={[");
  const detailStart: number = source.indexOf("modelDetailProps={{");

  test("the card declares both an edit form and a detail list", () => {
    expect(formFieldsStart).toBeGreaterThan(-1);
    expect(detailStart).toBeGreaterThan(formFieldsStart);
  });

  test("is a read-only detail row, guarded so an empty value shows nothing", () => {
    expect(source.slice(detailStart)).toContain(
      'field: { dnsName: true, }, title: "DNS Name", fieldType: FieldType.Text, showIf: (item: NetworkDevice): boolean => { return Boolean(item.dnsName); },',
    );
  });

  test("is not a field of the edit form", () => {
    expect(source.slice(formFieldsStart, detailStart)).not.toContain("dnsName");
  });

  test("sits right after Hostname and before MAC Address", () => {
    const detail: string = source.slice(detailStart);

    const hostnameIndex: number = detail.indexOf('title: "Hostname"');
    const dnsNameIndex: number = detail.indexOf('title: "DNS Name"');
    const macAddressIndex: number = detail.indexOf('title: "MAC Address"');

    expect(hostnameIndex).toBeGreaterThan(-1);
    expect(dnsNameIndex).toBeGreaterThan(hostnameIndex);
    expect(macAddressIndex).toBeGreaterThan(dnsNameIndex);
  });
});
