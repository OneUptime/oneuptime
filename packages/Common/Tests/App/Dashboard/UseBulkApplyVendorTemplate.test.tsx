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
  within,
} from "@testing-library/react";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Apply Vendor Template" on Network -> Devices: the customer's thirty
 * discovered Cambium switches, each of which used to be opened, edited and
 * given its vendor template by hand.
 *
 * Driven through the real dialog (BasicFormModal, react-select), because the
 * preview under the dropdown is half the feature: it says, before anything is
 * written, which template each selected device gets and which are left alone
 * and why. What has to hold:
 *
 *   - the action is withheld from a selection of only monitor-backed devices,
 *     and locked for anyone who may not edit devices;
 *   - the dialog starts on "Match each device's vendor" and lists every
 *     vendor template after it;
 *   - Apply re-reads the selection (a page per hundred) and decides every
 *     device again from what it holds NOW;
 *   - only the list that grows is written, merged into what the device has;
 *     a device that needs nothing costs no request;
 *   - every device left alone is listed with its reason, and a refused write
 *     with the server's;
 *   - at most four writes are in flight.
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

import useBulkApplyVendorTemplate, {
  APPLY_VENDOR_TEMPLATE_ACTION_TITLE,
  APPLY_VENDOR_TEMPLATE_CONCURRENCY,
  BulkApplyVendorTemplateResult,
  VENDOR_TEMPLATE_DEVICE_SELECT,
  VENDOR_TEMPLATE_MONITOR_BACKED_REASON,
  VENDOR_TEMPLATE_NOT_IDENTIFIED_REASON,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkApplyVendorTemplate";
import { DEVICE_NOT_READABLE_MESSAGE } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/BulkDeviceReader";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
  BulkActionUnchanged,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ModelAction } from "../../../UI/Utils/PermissionGate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceOidTemplate from "../../../Models/DatabaseModels/NetworkDeviceOidTemplate";
import Includes from "../../../Types/BaseDatabase/Includes";
import SnmpOid from "../../../Types/Monitor/SnmpMonitor/SnmpOid";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import IconProp from "../../../Types/Icon/IconProp";

// A real Formik + react-select tree behind a modal: 1s is not enough on a loaded box.
const WAIT_TIMEOUT: number = 20000;

const DEVICE_UPDATE_REASON: string =
  "You need the Edit Network Device permission to do this.";

const CNMATRIX_OID: string = "1.3.6.1.4.1.17713.24.1.2";
const CISCO_OID: string = "1.3.6.1.4.1.9.1.1208";
const UNKNOWN_OID: string = "1.3.6.1.4.1.987654.1";

const CNMATRIX: SnmpVendorTemplate =
  SnmpVendorTemplateUtil.getById("cambium-cnmatrix")!;
const CISCO: SnmpVendorTemplate = SnmpVendorTemplateUtil.getById("cisco-ios")!;
const GENERIC: SnmpVendorTemplate =
  SnmpVendorTemplateUtil.getById("host-resources-mib")!;

function deviceId(index: number): string {
  return `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
}

interface DeviceShape {
  index: number;
  name?: string;
  method?: NetworkDeviceMonitoringMethod;
  sysObjectId?: string;
  sysDescr?: string;
  vendor?: string;
  oidTemplateName?: string;
  snmpOids?: Array<SnmpOid>;
}

function makeDevice(shape: DeviceShape): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device._id = deviceId(shape.index);
  device.name = shape.name || `cnmatrix-sw-${shape.index}`;
  device.monitoringMethod =
    shape.method || NetworkDeviceMonitoringMethod.Probe;

  if (shape.sysObjectId) {
    device.sysObjectId = shape.sysObjectId;
  }

  if (shape.sysDescr) {
    device.sysDescr = shape.sysDescr;
  }

  if (shape.vendor) {
    device.vendor = shape.vendor;
  }

  if (shape.oidTemplateName) {
    const template: NetworkDeviceOidTemplate = new NetworkDeviceOidTemplate();
    template._id = "77777777-7777-4777-8777-777777777777";
    template.name = shape.oidTemplateName;
    device.oidTemplate = template;
    device.oidTemplateId = template.id!;
  }

  device.snmpOids = shape.snmpOids || [];
  device.snmpTables = [];
  return device;
}

/*
 * What the server holds, by device id. The fresh read answers from here, so
 * a test can make the server disagree with the rows on screen.
 */
let serverDevices: Map<string, NetworkDevice> = new Map();

function serve(devices: Array<NetworkDevice>): void {
  serverDevices = new Map();

  for (const device of devices) {
    serverDevices.set(device._id!, device);
  }
}

interface Snapshot {
  successIds: Array<string>;
  failedIds: Array<string>;
  failedMessages: Array<string>;
  unchangedIds: Array<string>;
  unchangedReasons: Array<string>;
}

let progressSnapshots: Array<Snapshot> = [];
let capturedActions: Array<BulkActionButtonSchema<NetworkDevice>> = [];
let gateResults: Record<
  string,
  { isAllowed: boolean; disabledReason?: string | undefined }
> = {};

const onBulkActionStartMock: MockFunction = getJestMockFunction();
const onBulkActionEndMock: MockFunction = getJestMockFunction();

function makeActionProps(
  items: Array<NetworkDevice>,
): BulkActionOnClickProps<NetworkDevice> {
  return {
    items: items,
    onProgressInfo: (info: ProgressInfo<NetworkDevice>): void => {
      progressSnapshots.push({
        successIds: info.successItems.map((item: NetworkDevice): string => {
          return item._id || "";
        }),
        failedIds: info.failed.map(
          (entry: BulkActionFailed<NetworkDevice>): string => {
            return entry.item._id || "";
          },
        ),
        failedMessages: info.failed.map(
          (entry: BulkActionFailed<NetworkDevice>): string => {
            return String(entry.failedMessage);
          },
        ),
        unchangedIds: (info.unchanged || []).map(
          (entry: BulkActionUnchanged<NetworkDevice>): string => {
            return entry.item._id || "";
          },
        ),
        unchangedReasons: (info.unchanged || []).map(
          (entry: BulkActionUnchanged<NetworkDevice>): string => {
            return String(entry.reason);
          },
        ),
      });
    },
    onBulkActionStart: onBulkActionStartMock as unknown as () => void,
    onBulkActionEnd: onBulkActionEndMock as unknown as () => void,
  };
}

function lastSnapshot(): Snapshot {
  const snapshot: Snapshot | undefined =
    progressSnapshots[progressSnapshots.length - 1];

  if (!snapshot) {
    throw new Error("No progress was reported.");
  }

  return snapshot;
}

interface HarnessProps {
  items: Array<NetworkDevice>;
}

const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const result: BulkApplyVendorTemplateResult = useBulkApplyVendorTemplate();
  capturedActions = result.bulkActions;

  return (
    <div>
      {result.bulkActions.map(
        (action: BulkActionButtonSchema<NetworkDevice>) => {
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
        },
      )}
      {result.modals}
    </div>
  );
};

function renderHarness(items: Array<NetworkDevice>): void {
  render(
    <MemoryRouter>
      <Harness items={items} />
    </MemoryRouter>,
  );
}

async function openDialog(items: Array<NetworkDevice>): Promise<void> {
  renderHarness(items);

  fireEvent.click(
    screen.getByText(`Trigger ${APPLY_VENDOR_TEMPLATE_ACTION_TITLE}`),
  );

  await waitFor(
    () => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        APPLY_VENDOR_TEMPLATE_ACTION_TITLE,
      );
    },
    { timeout: WAIT_TIMEOUT },
  );

  await screen.findByRole("combobox", undefined, { timeout: WAIT_TIMEOUT });
}

async function pickTemplate(label: string): Promise<void> {
  const combobox: HTMLElement = await screen.findByRole("combobox", undefined, {
    timeout: WAIT_TIMEOUT,
  });
  fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
  const options: Array<HTMLElement> = await screen.findAllByText(
    label,
    undefined,
    { timeout: WAIT_TIMEOUT },
  );
  // The last match is the option in the open menu, not the current value.
  fireEvent.click(options[options.length - 1]!);
}

async function applyAndWait(): Promise<void> {
  fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

  await waitFor(
    () => {
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

function planLines(): Array<string> {
  const plan: HTMLElement = screen.getByTestId("vendor-template-plan");
  return within(plan)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

function writes(): Array<{ id: string; data: Record<string, any> }> {
  return updateByIdMock.mock.calls.map((call: Array<any>) => {
    return { id: call[0].id.toString(), data: call[0].data };
  });
}

describe("useBulkApplyVendorTemplate", () => {
  beforeEach(() => {
    progressSnapshots = [];
    capturedActions = [];
    gateResults = {};
    serverDevices = new Map();

    permissionCheckMock.mockImplementation(
      (
        model: { singularName: string | null },
        action: ModelAction,
      ): { isAllowed: boolean; disabledReason?: string | undefined } => {
        return (
          gateResults[`${model.singularName}:${action}`] || { isAllowed: true }
        );
      },
    );

    getListMock.mockImplementation(
      async (request: any): Promise<{ data: Array<NetworkDevice> }> => {
        const ids: Array<string> = (request.query._id as Includes).values.map(
          (value: unknown): string => {
            return String(value);
          },
        );

        return {
          data: ids
            .map((id: string): NetworkDevice | undefined => {
              return serverDevices.get(id);
            })
            .filter((device: NetworkDevice | undefined): boolean => {
              return Boolean(device);
            }) as Array<NetworkDevice>,
        };
      },
    );

    updateByIdMock.mockImplementation(async (): Promise<void> => {
      // saved
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  describe("where it is offered", () => {
    test("on the menu with its icon, for any selection a probe polls", () => {
      renderHarness([]);

      const action: BulkActionButtonSchema<NetworkDevice> =
        capturedActions[0]!;

      expect(capturedActions).toHaveLength(1);
      expect(action.title).toBe(APPLY_VENDOR_TEMPLATE_ACTION_TITLE);
      expect(action.icon).toBe(IconProp.CPUChip);

      const probe: NetworkDevice = makeDevice({ index: 1 });
      const monitorBacked: NetworkDevice = makeDevice({
        index: 2,
        method: NetworkDeviceMonitoringMethod.Monitor,
      });

      expect(action.isVisible!([monitorBacked])).toBe(false);
      expect(action.isVisible!([monitorBacked, probe])).toBe(true);
      expect(action.isVisible!([probe])).toBe(true);
      expect(action.isVisible!([])).toBe(true);
    });

    test("locked with the reason for anyone who may not edit devices", () => {
      gateResults = {
        [`Network Device:${ModelAction.Update}`]: {
          isAllowed: false,
          disabledReason: DEVICE_UPDATE_REASON,
        },
      };

      renderHarness([]);

      expect(capturedActions[0]!.disabled).toBe(true);
      expect(capturedActions[0]!.tooltip).toBe(DEVICE_UPDATE_REASON);
    });
  });

  describe("the dialog", () => {
    test("starts on matching each device's vendor, and says it removes nothing", async () => {
      await openDialog([makeDevice({ index: 1, sysObjectId: CNMATRIX_OID })]);

      expect(
        screen.getByText("Match each device's vendor", { exact: true }),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("modal-description").textContent || "",
      ).toContain("removes nothing a device already collects");
      expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
        "Apply Template",
      );
    });

    test("lists every vendor template after the match option", async () => {
      await openDialog([makeDevice({ index: 1 })]);

      const combobox: HTMLElement = screen.getByRole("combobox");
      fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });

      for (const template of SnmpVendorTemplateUtil.getAll()) {
        expect(
          (await screen.findAllByText(template.label)).length,
        ).toBeGreaterThan(0);
      }
    });

    test("previews what matching does to the selection before anything is written", async () => {
      await openDialog([
        makeDevice({ index: 1, sysObjectId: CNMATRIX_OID }),
        makeDevice({ index: 2, sysObjectId: CNMATRIX_OID }),
        makeDevice({ index: 3, sysObjectId: CISCO_OID }),
        makeDevice({ index: 4 }),
        makeDevice({ index: 5, oidTemplateName: "Catalyst 9300" }),
        makeDevice({
          index: 6,
          method: NetworkDeviceMonitoringMethod.Monitor,
        }),
      ]);

      expect(planLines()).toEqual([
        `2 devices get ${CNMATRIX.label}.`,
        `1 device gets ${CISCO.label}.`,
        "1 device is not identified yet and is left as it is.",
        "1 device is linked to an OID Collection Template and is left as it is.",
        "1 device is monitor-backed and is left as it is.",
      ]);
      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(getListMock).not.toHaveBeenCalled();
    });

    test("the preview follows the dropdown to a template the operator picks", async () => {
      await openDialog([
        makeDevice({ index: 1, sysObjectId: CISCO_OID }),
        makeDevice({ index: 2 }),
        makeDevice({
          index: 3,
          method: NetworkDeviceMonitoringMethod.Monitor,
        }),
      ]);

      await pickTemplate(CNMATRIX.label);

      await waitFor(() => {
        expect(planLines()).toEqual([
          `2 devices get ${CNMATRIX.label}.`,
          "1 device is monitor-backed and is left as it is.",
        ]);
      });
    });
  });

  describe("applying", () => {
    test("re-reads the selection, a page at a time, for exactly what the merge needs", async () => {
      const devices: Array<NetworkDevice> = [
        makeDevice({ index: 1, sysObjectId: CNMATRIX_OID }),
        makeDevice({ index: 2, sysObjectId: CNMATRIX_OID }),
      ];
      serve(devices);

      await openDialog(devices);
      await applyAndWait();

      expect(getListMock).toHaveBeenCalledTimes(1);

      const request: any = (getListMock.mock.calls[0] as Array<any>)[0];
      expect(request.modelType).toBe(NetworkDevice);
      expect(
        (request.query._id as Includes).values.map((value: unknown) => {
          return String(value);
        }),
      ).toEqual([deviceId(1), deviceId(2)]);
      expect(request.select).toEqual({
        ...VENDOR_TEMPLATE_DEVICE_SELECT,
        _id: true,
      });
      expect(request.select).toEqual(
        expect.objectContaining({
          snmpOids: true,
          snmpTables: true,
          sysObjectId: true,
          sysDescr: true,
          oidTemplateId: true,
          monitoringMethod: true,
        }),
      );
    });

    test("matching gives each device its own vendor's OIDs and tables", async () => {
      const devices: Array<NetworkDevice> = [
        makeDevice({ index: 1, sysObjectId: CNMATRIX_OID }),
        makeDevice({ index: 2, name: "core-rtr", sysObjectId: CISCO_OID }),
      ];
      serve(devices);

      await openDialog(devices);
      await applyAndWait();

      const byId: Map<string, Record<string, any>> = new Map(
        writes().map((write: { id: string; data: Record<string, any> }) => {
          return [write.id, write.data];
        }),
      );

      expect(byId.get(deviceId(1))).toEqual({
        snmpOids: CNMATRIX.oids,
        snmpTables: CNMATRIX.tables,
      });
      // Cisco's template has no tables, so the device's tables are not written.
      expect(byId.get(deviceId(2))).toEqual({ snmpOids: CISCO.oids });

      expect(lastSnapshot().successIds).toEqual([deviceId(1), deviceId(2)]);
      expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
    });

    test("decides from what the device holds now, not from the row on screen", async () => {
      // The row was loaded before the first walk identified the switch.
      const row: NetworkDevice = makeDevice({ index: 1 });
      serve([makeDevice({ index: 1, sysObjectId: CNMATRIX_OID })]);

      await openDialog([row]);

      expect(planLines()).toEqual([
        "1 device is not identified yet and is left as it is.",
      ]);

      await applyAndWait();

      expect(writes()).toHaveLength(1);
      expect(writes()[0]!.data["snmpOids"]).toEqual(CNMATRIX.oids);
    });

    test("merges into the device's own OIDs, keeping them first and untouched", async () => {
      const own: Array<SnmpOid> = [
        { oid: "1.3.6.1.4.1.9.2.1.58.0", name: "Busy Per (legacy)" },
        { oid: CISCO.oids[0]!.oid, name: "My CPU name" },
      ];
      const device: NetworkDevice = makeDevice({
        index: 1,
        sysObjectId: CISCO_OID,
        snmpOids: own,
      });
      serve([device]);

      await openDialog([device]);
      await applyAndWait();

      const written: Array<SnmpOid> = writes()[0]!.data["snmpOids"];
      expect(written.slice(0, 2)).toEqual(own);
      expect(written).toHaveLength(own.length + CISCO.oids.length - 1);
    });

    test("a device that already collects everything costs no request, and says so", async () => {
      const device: NetworkDevice = makeDevice({
        index: 1,
        sysObjectId: CISCO_OID,
        snmpOids: [...CISCO.oids],
      });
      serve([device]);

      await openDialog([device]);
      await applyAndWait();

      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(lastSnapshot().unchangedReasons).toEqual([
        `Already collects everything in ${CISCO.label}.`,
      ]);
    });

    test("every device left alone is listed with the reason that applies to it", async () => {
      const devices: Array<NetworkDevice> = [
        makeDevice({ index: 1, method: NetworkDeviceMonitoringMethod.Monitor }),
        makeDevice({
          index: 2,
          sysObjectId: CISCO_OID,
          oidTemplateName: "Cisco Catalyst 9300",
        }),
        makeDevice({ index: 3 }),
        makeDevice({
          index: 4,
          sysObjectId: UNKNOWN_OID,
          vendor: "Acme Optics",
        }),
        makeDevice({ index: 5, sysObjectId: UNKNOWN_OID }),
      ];
      serve(devices);

      await openDialog(devices);
      await applyAndWait();

      expect(updateByIdMock).not.toHaveBeenCalled();

      const snapshot: Snapshot = lastSnapshot();
      expect(snapshot.unchangedIds).toEqual([1, 2, 3, 4, 5].map(deviceId));
      expect(snapshot.unchangedReasons).toEqual([
        VENDOR_TEMPLATE_MONITOR_BACKED_REASON,
        'Linked to the OID Collection Template "Cisco Catalyst 9300", which decides what it collects. Add the vendor\'s OIDs to that template, or clear it on this device first.',
        VENDOR_TEMPLATE_NOT_IDENTIFIED_REASON,
        `No vendor template matches this Acme Optics device. Choose one yourself — ${GENERIC.label} suits most Linux-based devices.`,
        `No vendor template matches this device's sysObjectID (${UNKNOWN_OID}). Choose one yourself — ${GENERIC.label} suits most Linux-based devices.`,
      ]);
    });

    test("a picked template goes on every device it can, identified or not", async () => {
      const devices: Array<NetworkDevice> = [
        makeDevice({ index: 1, sysObjectId: CISCO_OID }),
        makeDevice({ index: 2 }),
      ];
      serve(devices);

      await openDialog(devices);
      await pickTemplate(GENERIC.label);
      await applyAndWait();

      expect(writes()).toHaveLength(2);

      for (const write of writes()) {
        expect(write.data["snmpOids"]).toEqual(GENERIC.oids);
        expect(write.data["snmpTables"]).toEqual(GENERIC.tables);
      }
    });

    test("a refused write is reported against its device, in the server's words", async () => {
      const devices: Array<NetworkDevice> = [
        makeDevice({ index: 1, sysObjectId: CNMATRIX_OID }),
        makeDevice({ index: 2, sysObjectId: CNMATRIX_OID }),
      ];
      serve(devices);

      updateByIdMock.mockImplementation(
        async (request: { id: { toString: () => string } }): Promise<void> => {
          if (request.id.toString() === deviceId(2)) {
            throw new Error(
              "Device-Specific Health OIDs: 205 OIDs is more than the limit of 200. Remove some, or move them to another template.",
            );
          }
        },
      );

      await openDialog(devices);
      await applyAndWait();

      const snapshot: Snapshot = lastSnapshot();
      expect(snapshot.successIds).toEqual([deviceId(1)]);
      expect(snapshot.failedIds).toEqual([deviceId(2)]);
      expect(snapshot.failedMessages[0]).toContain("limit of 200");
    });

    test("a device the re-read does not return fails on its own", async () => {
      const devices: Array<NetworkDevice> = [
        makeDevice({ index: 1, sysObjectId: CNMATRIX_OID }),
        makeDevice({ index: 2, sysObjectId: CNMATRIX_OID }),
      ];
      // Deleted since the list loaded.
      serve([devices[0]!]);

      await openDialog(devices);
      await applyAndWait();

      const snapshot: Snapshot = lastSnapshot();
      expect(snapshot.successIds).toEqual([deviceId(1)]);
      expect(snapshot.failedIds).toEqual([deviceId(2)]);
      expect(snapshot.failedMessages).toEqual([DEVICE_NOT_READABLE_MESSAGE]);
    });

    test("a re-read that fails fails its devices with the reason, and writes nothing", async () => {
      const devices: Array<NetworkDevice> = [
        makeDevice({ index: 1, sysObjectId: CNMATRIX_OID }),
      ];

      getListMock.mockImplementation(async (): Promise<never> => {
        throw new Error("The connection was interrupted.");
      });

      await openDialog(devices);
      await applyAndWait();

      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(lastSnapshot().failedMessages).toEqual([
        "The connection was interrupted.",
      ]);
    });

    test(`never has more than ${APPLY_VENDOR_TEMPLATE_CONCURRENCY} writes in flight`, async () => {
      const devices: Array<NetworkDevice> = Array.from(
        { length: 12 },
        (_value: unknown, index: number) => {
          return makeDevice({ index: index + 1, sysObjectId: CNMATRIX_OID });
        },
      );
      serve(devices);

      let inFlight: number = 0;
      let highWater: number = 0;

      updateByIdMock.mockImplementation(async (): Promise<void> => {
        inFlight += 1;
        highWater = Math.max(highWater, inFlight);
        await new Promise((resolve: (value: unknown) => void) => {
          setTimeout(resolve, 5);
        });
        inFlight -= 1;
      });

      await openDialog(devices);
      await applyAndWait();

      expect(updateByIdMock).toHaveBeenCalledTimes(12);
      expect(APPLY_VENDOR_TEMPLATE_CONCURRENCY).toBe(4);
      expect(highWater).toBe(4);
      expect(lastSnapshot().successIds).toEqual(
        devices.map((device: NetworkDevice): string => {
          return device._id!;
        }),
      );
    });

    test("closing the dialog writes nothing", async () => {
      await openDialog([makeDevice({ index: 1, sysObjectId: CNMATRIX_OID })]);

      fireEvent.click(screen.getByTestId("modal-footer-close-button"));

      await waitFor(() => {
        expect(screen.queryByTestId("modal-title")).toBeNull();
      });
      expect(getListMock).not.toHaveBeenCalled();
      expect(updateByIdMock).not.toHaveBeenCalled();
    });
  });
});
