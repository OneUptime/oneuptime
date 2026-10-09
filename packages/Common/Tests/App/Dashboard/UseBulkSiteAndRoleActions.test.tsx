import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * "Set Site" / "Clear Site" and "Set Device Role" / "Clear Device Role" on
 * Network -> Devices - the customer's "select 20 switches and give them all
 * the Access Switch role" and "assign multiple devices to a site at once".
 *
 * What has to hold, for both relations:
 *
 *   - Set is one dialog with one required question - the project's sites
 *     (or roles), searched server-side - and one save for the selection;
 *   - the save writes the relation's id column and nothing else, through the
 *     ordinary device update, ONE DEVICE AT A TIME (a site move re-rolls the
 *     site's health, a role or site change reconciles alert-policy monitors
 *     against the plan; two in flight would race);
 *   - a device already holding what was picked is not written again, and the
 *     result says so;
 *   - a refused write is reported against its device with the server's
 *     words, and the rest carry on;
 *   - Clear is offered only when a selected device holds something to clear,
 *     its confirmation counts those devices, and only they are written;
 *   - both are locked, with the reason, for anyone who may not edit devices.
 *
 * BasicFormModal is replaced by a recorder: the contract here is the field
 * the dialog declares and what its submit does, not the form library.
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

const updateByIdMock: MockFunction = getJestMockFunction();
const permissionCheckMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
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

interface CapturedModalProps {
  title: string;
  description?: string;
  submitButtonText?: string;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  formProps: {
    fields: Array<Record<string, any>>;
  };
}

let capturedModal: CapturedModalProps | null = null;

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedModalProps): React.ReactElement => {
      capturedModal = props;
      const field: Record<string, any> | undefined = props.formProps.fields[0];
      return (
        <div data-testid="basic-form-modal">
          <h2>{props.title}</h2>
          {field?.footerElement || null}
        </div>
      );
    },
  };
});

import useBulkSiteActions, {
  ALREADY_IN_SITE_REASON,
  CLEAR_SITE_ACTION_TITLE,
  NOT_IN_A_SITE_REASON,
  SET_SITE_ACTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkSiteActions";
import useBulkDeviceRoleActions, {
  ALREADY_HAS_ROLE_REASON,
  CLEAR_DEVICE_ROLE_ACTION_TITLE,
  HAS_NO_ROLE_REASON,
  SET_DEVICE_ROLE_ACTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkDeviceRoleActions";
import { BulkDeviceRelationActionsResult } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useBulkDeviceRelationActions";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
  BulkActionUnchanged,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { ModelAction } from "../../../UI/Utils/PermissionGate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "../../../Models/DatabaseModels/NetworkDeviceRole";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";

const DEVICE_UPDATE_REASON: string =
  "You need the Edit Network Device permission to do this.";

const SITE_A: string = "55555555-5555-4555-8555-555555555551";
const SITE_B: string = "55555555-5555-4555-8555-555555555552";
const ROLE_ACCESS: string = "66666666-6666-4666-8666-666666666661";
const ROLE_CORE: string = "66666666-6666-4666-8666-666666666662";

function deviceId(index: number): string {
  return `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
}

/*
 * One relation's half of the suite: which hook, which column it writes, the
 * row fields that say what a device holds, and the copy that names them.
 */
interface RelationCase {
  name: string;
  useHook: () => BulkDeviceRelationActionsResult;
  setTitle: string;
  clearTitle: string;
  setIcon: IconProp;
  column: "siteId" | "networkDeviceRoleId";
  modelType: unknown;
  pickedId: string;
  otherId: string;
  alreadyReason: string;
  notSetReason: string;
  sideLinkText: string;
  sideLinkPath: string;
  submitButtonText: string;
  clearTitleOne: string;
  clearMessagePart: string;
  hold: (device: NetworkDevice, id: string) => void;
}

const CASES: Array<RelationCase> = [
  {
    name: "site",
    useHook: useBulkSiteActions,
    setTitle: SET_SITE_ACTION_TITLE,
    clearTitle: CLEAR_SITE_ACTION_TITLE,
    setIcon: IconProp.BuildingOffice,
    column: "siteId",
    modelType: NetworkSite,
    pickedId: SITE_A,
    otherId: SITE_B,
    alreadyReason: ALREADY_IN_SITE_REASON,
    notSetReason: NOT_IN_A_SITE_REASON,
    sideLinkText: "Manage sites",
    sideLinkPath: "/network-sites",
    submitButtonText: "Set Site",
    clearTitleOne: "Remove 1 device from its site?",
    clearMessagePart: "site assignment rule",
    hold: (device: NetworkDevice, id: string): void => {
      device.siteId = new ObjectID(id);
    },
  },
  {
    name: "role",
    useHook: useBulkDeviceRoleActions,
    setTitle: SET_DEVICE_ROLE_ACTION_TITLE,
    clearTitle: CLEAR_DEVICE_ROLE_ACTION_TITLE,
    setIcon: IconProp.Identification,
    column: "networkDeviceRoleId",
    modelType: NetworkDeviceRole,
    pickedId: ROLE_ACCESS,
    otherId: ROLE_CORE,
    alreadyReason: ALREADY_HAS_ROLE_REASON,
    notSetReason: HAS_NO_ROLE_REASON,
    sideLinkText: "Manage roles",
    sideLinkPath: "/network-devices/settings/device-roles",
    submitButtonText: "Set Role",
    clearTitleOne: "Clear the role of 1 device?",
    clearMessagePart: "SNMP identity",
    hold: (device: NetworkDevice, id: string): void => {
      device.networkDeviceRoleId = new ObjectID(id);
    },
  },
];

function makeDevice(index: number): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device._id = deviceId(index);
  device.name = `access-switch-${index}`;
  return device;
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

function renderHook(relation: RelationCase): void {
  const Harness: FunctionComponent = (): ReactElement => {
    const result: BulkDeviceRelationActionsResult = relation.useHook();
    capturedActions = result.bulkActions;
    return <div>{result.modals}</div>;
  };

  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
}

function findAction(title: string): BulkActionButtonSchema<NetworkDevice> {
  const action: BulkActionButtonSchema<NetworkDevice> | undefined =
    capturedActions.find(
      (candidate: BulkActionButtonSchema<NetworkDevice>) => {
        return candidate.title === title;
      },
    );

  if (!action) {
    throw new Error(`No "${title}" action was returned.`);
  }

  return action;
}

async function openSetDialog(
  relation: RelationCase,
  items: Array<NetworkDevice>,
): Promise<CapturedModalProps> {
  await act(async () => {
    await findAction(relation.setTitle).onClick(makeActionProps(items));
  });

  if (!capturedModal) {
    throw new Error("The dialog did not open.");
  }

  return capturedModal;
}

function writtenIds(): Array<string> {
  return updateByIdMock.mock.calls.map((call: Array<any>): string => {
    return call[0].id.toString();
  });
}

describe.each(CASES)("bulk $name actions", (relation: RelationCase) => {
  beforeEach(() => {
    capturedModal = null;
    capturedActions = [];
    progressSnapshots = [];
    gateResults = {};

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

    updateByIdMock.mockImplementation((): Promise<void> => {
      return Promise.resolve();
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  describe("the menu", () => {
    test("offers Set and Clear, in that order, with their icons", () => {
      renderHook(relation);

      expect(
        capturedActions.map(
          (action: BulkActionButtonSchema<NetworkDevice>): string => {
            return action.title;
          },
        ),
      ).toEqual([relation.setTitle, relation.clearTitle]);
      expect(findAction(relation.setTitle).icon).toBe(relation.setIcon);
      expect(findAction(relation.clearTitle).icon).toBe(IconProp.LinkSlash);
    });

    test("Set is offered to any selection", () => {
      renderHook(relation);

      const action: BulkActionButtonSchema<NetworkDevice> = findAction(
        relation.setTitle,
      );

      expect(action.isVisible?.([makeDevice(1)]) ?? true).toBe(true);
    });

    test("Clear is offered only when a selected device holds something to clear", () => {
      renderHook(relation);

      const action: BulkActionButtonSchema<NetworkDevice> = findAction(
        relation.clearTitle,
      );

      const holding: NetworkDevice = makeDevice(2);
      relation.hold(holding, relation.pickedId);

      expect(action.isVisible!([makeDevice(1)])).toBe(false);
      expect(action.isVisible!([makeDevice(1), holding])).toBe(true);
      // The convention every device bulk action follows; the bar is not drawn for none.
      expect(action.isVisible!([])).toBe(true);
    });

    test("both are locked with the reason for anyone who may not edit devices", () => {
      gateResults = {
        [`Network Device:${ModelAction.Update}`]: {
          isAllowed: false,
          disabledReason: DEVICE_UPDATE_REASON,
        },
      };

      renderHook(relation);

      for (const title of [relation.setTitle, relation.clearTitle]) {
        expect(findAction(title).disabled).toBe(true);
        expect(findAction(title).tooltip).toBe(DEVICE_UPDATE_REASON);
      }
    });

    test("both are plain menu items for someone who may", () => {
      renderHook(relation);

      for (const title of [relation.setTitle, relation.clearTitle]) {
        expect(findAction(title).disabled).toBeUndefined();
        expect(findAction(title).tooltip).toBeUndefined();
      }
    });
  });

  describe("the Set dialog", () => {
    test("asks one required question: which one, from the project's own list", async () => {
      renderHook(relation);

      const modal: CapturedModalProps = await openSetDialog(relation, [
        makeDevice(1),
      ]);

      expect(modal.title).toBe(relation.setTitle);
      expect(modal.submitButtonText).toBe(relation.submitButtonText);
      expect(modal.description).toBeTruthy();
      expect(modal.formProps.fields).toHaveLength(1);

      const field: Record<string, any> = modal.formProps.fields[0]!;
      expect(field["fieldType"]).toBe(FormFieldSchemaType.Dropdown);
      expect(field["required"]).toBe(true);
      expect(field["dropdownModal"]).toEqual(
        expect.objectContaining({
          type: relation.modelType,
          labelField: "name",
          valueField: "_id",
        }),
      );
    });

    test("links to the page that adds one, in a new tab, for when it is not on the list", async () => {
      renderHook(relation);

      const modal: CapturedModalProps = await openSetDialog(relation, [
        makeDevice(1),
      ]);

      const sideLink: Record<string, any> =
        modal.formProps.fields[0]!["sideLink"];
      expect(sideLink["text"]).toBe(relation.sideLinkText);
      expect(sideLink["url"].toString()).toContain(relation.sideLinkPath);
      expect(sideLink["openLinkInNewTab"]).toBe(true);
    });

    test("writes the picked id, and nothing else, on every selected device, one at a time and in order", async () => {
      renderHook(relation);

      const items: Array<NetworkDevice> = [
        makeDevice(1),
        makeDevice(2),
        makeDevice(3),
      ];
      const modal: CapturedModalProps = await openSetDialog(relation, items);

      await act(async () => {
        await modal.onSubmit({ relationId: relation.pickedId });
      });

      expect(writtenIds()).toEqual([deviceId(1), deviceId(2), deviceId(3)]);

      for (const call of updateByIdMock.mock.calls as Array<Array<any>>) {
        expect(call[0].modelType).toBe(NetworkDevice);
        expect(Object.keys(call[0].data)).toEqual([relation.column]);
        expect(call[0].data[relation.column]).toBeInstanceOf(ObjectID);
        expect(call[0].data[relation.column].toString()).toBe(
          relation.pickedId,
        );
      }

      expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
      expect(lastSnapshot().successIds).toEqual([
        deviceId(1),
        deviceId(2),
        deviceId(3),
      ]);
    });

    test("never has two writes in flight", async () => {
      let inFlight: number = 0;
      let highWater: number = 0;

      updateByIdMock.mockImplementation(async (): Promise<void> => {
        inFlight += 1;
        highWater = Math.max(highWater, inFlight);
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
      });

      renderHook(relation);

      const modal: CapturedModalProps = await openSetDialog(
        relation,
        [1, 2, 3, 4, 5].map(makeDevice),
      );

      await act(async () => {
        await modal.onSubmit({ relationId: relation.pickedId });
      });

      expect(updateByIdMock).toHaveBeenCalledTimes(5);
      expect(highWater).toBe(1);
    });

    test("a device already holding the pick is not written again, and the result says so", async () => {
      renderHook(relation);

      const already: NetworkDevice = makeDevice(2);
      relation.hold(already, relation.pickedId);

      const elsewhere: NetworkDevice = makeDevice(3);
      relation.hold(elsewhere, relation.otherId);

      const modal: CapturedModalProps = await openSetDialog(relation, [
        makeDevice(1),
        already,
        elsewhere,
      ]);

      await act(async () => {
        await modal.onSubmit({ relationId: relation.pickedId });
      });

      // The one elsewhere moves; the one already there is left.
      expect(writtenIds()).toEqual([deviceId(1), deviceId(3)]);

      const snapshot: Snapshot = lastSnapshot();
      expect(snapshot.successIds).toEqual([deviceId(1), deviceId(3)]);
      expect(snapshot.unchangedIds).toEqual([deviceId(2)]);
      expect(snapshot.unchangedReasons).toEqual([relation.alreadyReason]);
    });

    test("a refused write is reported against its device in the server's words, and the rest carry on", async () => {
      updateByIdMock.mockImplementation(
        async (request: { id: ObjectID }): Promise<void> => {
          if (request.id.toString() === deviceId(2)) {
            throw new Error(
              "You do not have permission to edit this Network Device.",
            );
          }
        },
      );

      renderHook(relation);

      const modal: CapturedModalProps = await openSetDialog(
        relation,
        [1, 2, 3].map(makeDevice),
      );

      await act(async () => {
        await modal.onSubmit({ relationId: relation.pickedId });
      });

      expect(updateByIdMock).toHaveBeenCalledTimes(3);

      const snapshot: Snapshot = lastSnapshot();
      expect(snapshot.successIds).toEqual([deviceId(1), deviceId(3)]);
      expect(snapshot.failedIds).toEqual([deviceId(2)]);
      expect(snapshot.failedMessages).toEqual([
        "You do not have permission to edit this Network Device.",
      ]);
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
    });

    test("a device without an id fails on its own", async () => {
      renderHook(relation);

      const noId: NetworkDevice = new NetworkDevice();
      noId.name = "ghost";

      const modal: CapturedModalProps = await openSetDialog(relation, [
        noId,
        makeDevice(2),
      ]);

      await act(async () => {
        await modal.onSubmit({ relationId: relation.pickedId });
      });

      expect(writtenIds()).toEqual([deviceId(2)]);
      expect(lastSnapshot().failedMessages).toEqual(["Item ID not found"]);
    });

    test("an empty pick writes nothing and closes the dialog", async () => {
      renderHook(relation);

      const modal: CapturedModalProps = await openSetDialog(relation, [
        makeDevice(1),
      ]);

      await act(async () => {
        await modal.onSubmit({ relationId: "  " });
      });

      expect(updateByIdMock).not.toHaveBeenCalled();
      expect(onBulkActionStartMock).not.toHaveBeenCalled();
      expect(screen.queryByTestId("basic-form-modal")).toBeNull();
    });

    test("closing the dialog writes nothing", async () => {
      renderHook(relation);

      const modal: CapturedModalProps = await openSetDialog(relation, [
        makeDevice(1),
      ]);

      expect(screen.getByTestId("basic-form-modal")).toBeInTheDocument();

      act(() => {
        modal.onClose();
      });

      expect(screen.queryByTestId("basic-form-modal")).toBeNull();
      expect(updateByIdMock).not.toHaveBeenCalled();
    });
  });

  describe("Clear", () => {
    test("counts, in its confirmation, only the devices it would change", () => {
      renderHook(relation);

      const holding: NetworkDevice = makeDevice(2);
      relation.hold(holding, relation.pickedId);

      const items: Array<NetworkDevice> = [makeDevice(1), holding];
      const action: BulkActionButtonSchema<NetworkDevice> = findAction(
        relation.clearTitle,
      );

      expect(action.confirmTitle!(items)).toBe(relation.clearTitleOne);
      expect(action.confirmMessage!(items)).toContain(
        relation.clearMessagePart,
      );
    });

    test("writes null on the devices that hold one, and lists the rest as not changed", async () => {
      renderHook(relation);

      const first: NetworkDevice = makeDevice(1);
      relation.hold(first, relation.pickedId);

      const third: NetworkDevice = makeDevice(3);
      relation.hold(third, relation.otherId);

      await act(async () => {
        await findAction(relation.clearTitle).onClick(
          makeActionProps([first, makeDevice(2), third]),
        );
      });

      expect(writtenIds()).toEqual([deviceId(1), deviceId(3)]);

      for (const call of updateByIdMock.mock.calls as Array<Array<any>>) {
        expect(call[0].data).toEqual({ [relation.column]: null });
      }

      const snapshot: Snapshot = lastSnapshot();
      expect(snapshot.successIds).toEqual([deviceId(1), deviceId(3)]);
      expect(snapshot.unchangedIds).toEqual([deviceId(2)]);
      expect(snapshot.unchangedReasons).toEqual([relation.notSetReason]);
      expect(onBulkActionStartMock).toHaveBeenCalledTimes(1);
      expect(onBulkActionEndMock).toHaveBeenCalledTimes(1);
    });

    test("runs straight from its confirmation, with no dialog of its own", async () => {
      renderHook(relation);

      const holding: NetworkDevice = makeDevice(1);
      relation.hold(holding, relation.pickedId);

      await act(async () => {
        await findAction(relation.clearTitle).onClick(
          makeActionProps([holding]),
        );
      });

      expect(capturedModal).toBeNull();
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("the Set Site dialog's way to the automatic version", () => {
  beforeEach(() => {
    capturedModal = null;
    permissionCheckMock.mockImplementation(() => {
      return { isAllowed: true };
    });
  });

  afterEach(() => {
    cleanup();
    jest.clearAllMocks();
  });

  test("links to the site assignment rules, in a new tab, from under the picker", async () => {
    renderHook(CASES[0]!);

    await openSetDialog(CASES[0]!, [makeDevice(1)]);

    const hint: HTMLElement = screen.getByTestId(
      "set-site-assignment-rules-hint",
    );
    expect(hint).toHaveTextContent(
      "Devices that discovery finds later can be placed in a site automatically with a site assignment rule.",
    );

    const link: HTMLElement = within(hint).getByText("site assignment rule");
    const anchor: HTMLAnchorElement | null = link.closest("a");
    expect(anchor?.getAttribute("href")).toContain(
      "/network-sites/assignment-rules",
    );
    expect(anchor?.getAttribute("target")).toBe("_blank");
  });
});
