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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Edit dialog of a scheduled maintenance event's Affected Resources
 * card, drawn through the real ModelForm and the real pickers with the very
 * fields and save step the event's page hands its card
 * (Components/ScheduledMaintenance/ScheduledMaintenanceAffectedResourcesFormFields),
 * as a person holding one role in the project - not a master admin.
 *
 * Split as Create Scheduled Maintenance Event is: the monitors in a picker
 * of their own, Change Monitor Status to right under them once one is
 * picked, everything else below. Saving stores what the one picker stored
 * for the same picks - each resource in its own relation.
 *
 * The maintainer's decision: an event's Change Monitor Status to can be
 * changed until the event starts, by anyone who may edit the event; once
 * it is ongoing or over the field is read-only, with a line saying why,
 * and the save sends nothing for it (the server refuses a change then).
 */

configure({ asyncUtilTimeout: 15000 });

// The person viewing: their permissions in the project.
let mockRole: Array<string> = [];

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  const actualPermission: Record<string, unknown> = jest.requireActual(
    "../../../Types/Permission",
  ) as Record<string, unknown>;
  const PermissionEnum: Record<string, string> = actualPermission[
    "default"
  ] as Record<string, string>;
  const everyone: Array<string> = [
    PermissionEnum["User"]!,
    PermissionEnum["CurrentUser"]!,
    PermissionEnum["Public"]!,
  ];

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return [...mockRole, ...everyone];
      },
      getProjectPermissions: (): {
        permissions: Array<Record<string, unknown>>;
      } => {
        return {
          permissions: mockRole.map((permission: string) => {
            return {
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
              _type: "UserPermission",
            };
          }),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: everyone };
      },
    },
  };
});

// Not a master admin: the Edit offers what the person may update.
jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import {
  getScheduledMaintenanceAffectedResourcesFormFields,
  getScheduledMaintenanceAffectedResourcesOnBeforeUpdate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceAffectedResourcesFormFields";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const EVENT_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";
const MONITOR_NAME: string = "Checkout API";
const OTHER_MONITOR_ID: string = "22222222-2222-4222-8222-222222222223";
const OTHER_MONITOR_NAME: string = "Payments API";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const HOST_NAME: string = "db-primary";
const OTHER_HOST_ID: string = "33333333-3333-4333-8333-333333333334";
const OTHER_HOST_NAME: string = "db-replica";
const SITE_ID: string = "34333333-3333-4333-8333-333333333333";
const SITE_NAME: string = "Frankfurt DC";
const SERVICE_ID: string = "44444444-4444-4444-8444-444444444444";
const SERVICE_NAME: string = "checkout-api";

const UNDER_MAINTENANCE_STATUS_ID: string =
  "55555555-5555-4555-8555-555555555555";
const DEGRADED_STATUS_ID: string = "55555555-5555-4555-8555-555555555556";
const OPERATIONAL_STATUS_ID: string = "55555555-5555-4555-8555-555555555557";

const BEFORE_START_DESCRIPTION: string =
  "When the event starts, its monitors change to this status, and back to operational when it ends.";
const STARTED_DESCRIPTION: string =
  "The event has started, so this can no longer be changed.";

type ModelClass = { new (): BaseModel };

interface NamedRecord {
  name: string;
  color?: string;
}

const RECORDS: Map<ModelClass, Record<string, NamedRecord>> = new Map<
  ModelClass,
  Record<string, NamedRecord>
>([
  [
    Monitor,
    {
      [MONITOR_ID]: { name: MONITOR_NAME },
      [OTHER_MONITOR_ID]: { name: OTHER_MONITOR_NAME },
    },
  ],
  [
    Host,
    {
      [HOST_ID]: { name: HOST_NAME },
      [OTHER_HOST_ID]: { name: OTHER_HOST_NAME },
    },
  ],
  [NetworkSite, { [SITE_ID]: { name: SITE_NAME } }],
  [Service, { [SERVICE_ID]: { name: SERVICE_NAME } }],
  [
    MonitorStatus,
    {
      [OPERATIONAL_STATUS_ID]: { name: "Operational", color: "#10b981" },
      [DEGRADED_STATUS_ID]: { name: "Degraded", color: "#f59e0b" },
      [UNDER_MAINTENANCE_STATUS_ID]: {
        name: "Under Maintenance",
        color: "#6366f1",
      },
    },
  ],
]);

// Everyone who may edit the event, each holding that one role.
const EDITORS: Array<[string, Array<Permission>]> = [
  ["a Project Owner", [Permission.ProjectOwner]],
  ["a Project Admin", [Permission.ProjectAdmin]],
  ["a Project Member", [Permission.ProjectMember]],
  ["a Scheduled Maintenance Admin", [Permission.ScheduledMaintenanceAdmin]],
  ["a Scheduled Maintenance Member", [Permission.ScheduledMaintenanceMember]],
  [
    "a role that may read and edit scheduled maintenance events",
    [
      Permission.ReadProjectScheduledMaintenance,
      Permission.EditProjectScheduledMaintenance,
    ],
  ],
];

let capturedGetItemSelect: Record<string, unknown> | null = null;

/*
 * What the API answers for the edit form's load: each relation selected as
 * `true` comes back as `{ _id }` only.
 */
const ATTACHED: JSONObject = {
  monitors: [{ _id: MONITOR_ID }],
  hosts: [{ _id: HOST_ID }],
  networkSites: [{ _id: SITE_ID }],
  services: [{ _id: SERVICE_ID }],
};

const ATTACHED_WITH_STATUS: JSONObject = {
  ...ATTACHED,
  changeMonitorStatusTo: { _id: UNDER_MAINTENANCE_STATUS_ID },
};

let eventOnServer: JSONObject = ATTACHED_WITH_STATUS;

function renderEditForm(data: { hasEventStarted: boolean }): UserEvent {
  render(
    <ModelForm<ScheduledMaintenance>
      modelType={ScheduledMaintenance}
      id="edit-scheduled-maintenance-affected-resources"
      name="Edit Scheduled Maintenance"
      fields={getScheduledMaintenanceAffectedResourcesFormFields({
        hasEventStarted: data.hasEventStarted,
      })}
      onBeforeUpdate={getScheduledMaintenanceAffectedResourcesOnBeforeUpdate({
        hasEventStarted: data.hasEventStarted,
      })}
      formType={FormType.Update}
      modelIdToEdit={EVENT_ID}
      submitButtonText="Save Changes"
      onSuccess={() => {
        // asserted through createOrUpdateMock
      }}
    />,
  );

  return userEvent.setup({ delay: null });
}

function monitorsPicker(): HTMLElement {
  return screen.getByRole("combobox", { name: /^Monitors/ });
}

function otherResourcesPicker(): HTMLElement {
  return screen.getByRole("combobox", { name: /^Other Affected Resources/ });
}

// The field a control belongs to: the label naming it, and what is under it.
function fieldOf(control: HTMLElement): HTMLElement {
  const labelId: string | null = control.getAttribute("aria-labelledby");

  expect(labelId).toBeTruthy();

  return document.getElementById(labelId!)!.parentElement as HTMLElement;
}

/*
 * Change Monitor Status to's control, named by its label: with a status
 * picked, the button that shows it (a click opens the list); with none,
 * the search box. Null when the form does not ask it.
 */
function queryStatusControl(): HTMLElement | null {
  return (
    screen.queryByRole("button", { name: /^Change Monitor Status to/ }) ||
    screen.queryByRole("combobox", { name: /^Change Monitor Status to/ })
  );
}

async function statusControl(): Promise<HTMLElement> {
  return await waitFor(() => {
    const control: HTMLElement | null = queryStatusControl();

    expect(control).not.toBeNull();

    return control!;
  });
}

// The read-only status an event that has started shows in place of the picker.
async function startedStatus(): Promise<HTMLElement> {
  return await screen.findByTestId("started-event-monitor-status");
}

// A dropdown opens on a click; its options are listed under it.
async function pickOption(
  user: UserEvent,
  combobox: HTMLElement,
  optionText: string,
): Promise<void> {
  await user.click(combobox);
  const options: Array<HTMLElement> = await screen.findAllByText(optionText, {
    exact: true,
  });
  await user.click(options[options.length - 1]!);
}

async function pickResource(
  user: UserEvent,
  picker: HTMLElement,
  name: string,
): Promise<void> {
  await user.click(picker);
  await user.click(await screen.findByRole("option", { name: name }));
  await screen.findByRole("button", { name: `Remove ${name}` });
}

async function save(): Promise<ScheduledMaintenance> {
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  return (
    createOrUpdateMock.mock.calls[0]![0] as { model: ScheduledMaintenance }
  ).model;
}

const idsOf: (models: Array<BaseModel> | undefined) => Array<string> = (
  models: Array<BaseModel> | undefined,
): Array<string> => {
  return (models || []).map((model: BaseModel) => {
    return String(model._id);
  });
};

// Every relation the event holds, by IDs, as an edit sends it.
function resourcesOf(
  event: ScheduledMaintenance,
): Record<string, Array<string>> {
  return {
    monitors: idsOf(event.monitors),
    hosts: idsOf(event.hosts),
    kubernetesClusters: idsOf(event.kubernetesClusters),
    dockerHosts: idsOf(event.dockerHosts),
    podmanHosts: idsOf(event.podmanHosts),
    proxmoxClusters: idsOf(event.proxmoxClusters),
    vmwareVCenters: idsOf(event.vmwareVCenters),
    cephClusters: idsOf(event.cephClusters),
    storageArrays: idsOf(event.storageArrays),
    dockerSwarmClusters: idsOf(event.dockerSwarmClusters),
    iotFleets: idsOf(event.iotFleets),
    databaseServers: idsOf(event.databaseServers),
    networkSites: idsOf(event.networkSites),
    services: idsOf(event.services),
  };
}

const AS_ATTACHED: Record<string, Array<string>> = {
  monitors: [MONITOR_ID],
  hosts: [HOST_ID],
  kubernetesClusters: [],
  dockerHosts: [],
  podmanHosts: [],
  proxmoxClusters: [],
  vmwareVCenters: [],
  cephClusters: [],
  storageArrays: [],
  dockerSwarmClusters: [],
  iotFleets: [],
  databaseServers: [],
  networkSites: [SITE_ID],
  services: [SERVICE_ID],
};

// The status an edit sends, by id, under either name; undefined for none.
function sentStatusOf(event: ScheduledMaintenance): {
  relation: string | undefined;
  id: string | undefined;
} {
  const sent: JSONObject = BaseModel.toJSON(event, ScheduledMaintenance);
  const relation: unknown = sent["changeMonitorStatusTo"];
  const id: unknown = sent["changeMonitorStatusToId"];

  return {
    relation:
      relation && typeof relation === "object"
        ? String((relation as JSONObject)["_id"])
        : relation === undefined || relation === null
          ? undefined
          : String(relation),
    id: id === undefined || id === null ? undefined : String(id),
  };
}

function expectNoStatusSent(event: ScheduledMaintenance): void {
  expect(event.changeMonitorStatusTo).toBeUndefined();
  expect(event.changeMonitorStatusToId).toBeUndefined();
  expect(sentStatusOf(event)).toEqual({ relation: undefined, id: undefined });
}

function expectStatusSent(event: ScheduledMaintenance, statusId: string): void {
  expect(String(event.changeMonitorStatusTo?._id)).toBe(statusId);
  expect(sentStatusOf(event).relation).toBe(statusId);
}

// The MonitorStatus reads: the dropdown's list and the read-only line's.
function monitorStatusReads(): Array<{
  query: Record<string, unknown>;
}> {
  return getListMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        modelType: ModelClass;
        query: Record<string, unknown>;
      };
    })
    .filter((request: { modelType: ModelClass }) => {
      return request.modelType === MonitorStatus;
    });
}

beforeEach(() => {
  mockRole = [Permission.ProjectOwner];
  capturedGetItemSelect = null;
  eventOnServer = ATTACHED_WITH_STATUS;
  PermissionGate.clearPermissionPropsCache();
  getItemMock.mockReset();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();

  getItemMock.mockImplementation(async (...args: Array<unknown>) => {
    capturedGetItemSelect = (args[0] as { select: Record<string, unknown> })
      .select;
    return BaseModel.fromJSON(
      { _id: EVENT_ID.toString(), ...eventOnServer },
      ScheduledMaintenance,
    ) as ScheduledMaintenance;
  });

  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const { modelType, query } = args[0] as {
      modelType: ModelClass;
      query: Record<string, unknown>;
    };
    const records: Record<string, NamedRecord> = RECORDS.get(modelType) || {};
    const idFilter: unknown = query?.["_id"];
    const ids: Array<string> =
      idFilter instanceof Includes
        ? (idFilter.values as Array<unknown>).map((v: unknown) => {
            return String(v);
          })
        : Object.keys(records);
    const data: Array<BaseModel> = ids
      .filter((id: string) => {
        return records[id] !== undefined;
      })
      .map((id: string) => {
        const model: BaseModel = new modelType();
        model._id = id;
        model.setColumnValue("name", records[id]!.name);

        if (records[id]!.color) {
          model.setColumnValue("color", new Color(records[id]!.color!));
        }

        return model;
      });
    return { data, count: data.length, skip: 0, limit: 10 };
  });

  createOrUpdateMock.mockImplementation(async () => {
    return { data: new ScheduledMaintenance(), miscData: undefined };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Edit dialog of a scheduled maintenance event's Affected Resources card", () => {
  test.each([
    ["before the event starts", false],
    ["once the event has started", true],
  ])(
    "%s, loads Change Monitor Status to with every relation the two pickers write",
    async (_when: string, hasEventStarted: boolean) => {
      renderEditForm({ hasEventStarted });

      await waitFor(() => {
        expect(capturedGetItemSelect).not.toBeNull();
      });

      for (const key of [
        "monitors",
        "changeMonitorStatusTo",
        "hosts",
        "kubernetesClusters",
        "dockerHosts",
        "podmanHosts",
        "proxmoxClusters",
        "vmwareVCenters",
        "cephClusters",
        "storageArrays",
        "dockerSwarmClusters",
        "iotFleets",
        "databaseServers",
        "networkSites",
        "services",
      ]) {
        expect(`${key}: ${String(capturedGetItemSelect![key])}`).toBe(
          `${key}: true`,
        );
      }
    },
  );

  test("asks for the monitors apart from the other resources, each picker named by its label", async () => {
    renderEditForm({ hasEventStarted: false });

    await screen.findByText(SERVICE_NAME);

    const monitors: HTMLElement = fieldOf(monitorsPicker());
    const others: HTMLElement = fieldOf(otherResourcesPicker());

    expect(monitorsPicker()).toHaveAttribute(
      "placeholder",
      "Search monitors...",
    );
    expect(
      monitors.compareDocumentPosition(others) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(within(monitors).getByText(MONITOR_NAME)).toBeInTheDocument();
    expect(within(monitors).queryByText(HOST_NAME)).toBeNull();

    for (const name of [HOST_NAME, SITE_NAME, SERVICE_NAME]) {
      expect(within(others).getByText(name)).toBeInTheDocument();
    }
    expect(within(others).queryByText(MONITOR_NAME)).toBeNull();

    expect(
      within(monitors).getByText(
        "Search and attach the monitors affected by this scheduled maintenance.",
      ),
    ).toBeInTheDocument();
    expect(
      within(others).getByText(
        "Search and attach hosts, clusters, container hosts, databases, IoT fleets, network sites, or services affected by this scheduled maintenance. Attaching a network site covers every site beneath it.",
      ),
    ).toBeInTheDocument();
  });

  describe("before the event starts", () => {
    test("asks Change Monitor Status to right under the monitors, above the other resources, holding the event's status", async () => {
      renderEditForm({ hasEventStarted: false });

      await screen.findByText(SERVICE_NAME);

      const status: HTMLElement = await statusControl();

      await waitFor(() => {
        expect(status).toHaveTextContent("Under Maintenance");
      });

      const monitors: HTMLElement = fieldOf(monitorsPicker());
      const others: HTMLElement = fieldOf(otherResourcesPicker());

      expect(
        monitors.compareDocumentPosition(status) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        status.compareDocumentPosition(others) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // Its own field, not inside either picker's.
      expect(monitors.contains(status)).toBe(false);
      expect(others.contains(status)).toBe(false);

      expect(screen.getByText(BEFORE_START_DESCRIPTION)).toBeInTheDocument();
      expect(screen.queryByText(STARTED_DESCRIPTION)).toBeNull();
      expect(screen.queryByTestId("started-event-monitor-status")).toBeNull();
    });

    test("is not asked while no monitor is picked, and asked once one is", async () => {
      eventOnServer = {
        hosts: [{ _id: HOST_ID }],
      };

      const user: UserEvent = renderEditForm({ hasEventStarted: false });

      await screen.findByText(HOST_NAME);

      expect(screen.queryByText("Change Monitor Status to")).toBeNull();
      expect(queryStatusControl()).toBeNull();

      await pickResource(user, monitorsPicker(), MONITOR_NAME);

      const status: HTMLElement = await statusControl();

      expect(status).toBeInTheDocument();
      expect(screen.getByText(BEFORE_START_DESCRIPTION)).toBeInTheDocument();
    });

    test.each(EDITORS)(
      "%s picks another status, and it is saved with the resources as they were",
      async (_role: string, permissions: Array<Permission>) => {
        mockRole = permissions;

        const user: UserEvent = renderEditForm({ hasEventStarted: false });

        /*
         * Waits on the status, not on a resource chip: the pickers list
         * only the resource types a role may read, and some editors here
         * read none of them - their relations are still loaded and saved.
         */
        const status: HTMLElement = await statusControl();

        await waitFor(() => {
          expect(status).toHaveTextContent("Under Maintenance");
        });

        await pickOption(user, status, "Degraded");

        await waitFor(() => {
          expect(
            screen.getByRole("button", { name: /^Change Monitor Status to/ }),
          ).toHaveTextContent("Degraded");
        });

        const saved: ScheduledMaintenance = await save();

        expectStatusSent(saved, DEGRADED_STATUS_ID);
        expect(resourcesOf(saved)).toEqual(AS_ATTACHED);
      },
    );

    test("an event created without a status gets one picked here", async () => {
      eventOnServer = ATTACHED;

      const user: UserEvent = renderEditForm({ hasEventStarted: false });

      await screen.findByText(SERVICE_NAME);

      const status: HTMLElement = await statusControl();

      expect(status).toHaveAttribute("role", "combobox");

      await pickOption(user, status, "Degraded");

      const saved: ScheduledMaintenance = await save();

      expectStatusSent(saved, DEGRADED_STATUS_ID);
    });

    test("saving without changes keeps every attached resource, and sends back the status the event holds", async () => {
      renderEditForm({ hasEventStarted: false });

      await screen.findByText(SERVICE_NAME);
      await statusControl();

      const saved: ScheduledMaintenance = await save();

      expect(resourcesOf(saved)).toEqual(AS_ATTACHED);
      expectStatusSent(saved, UNDER_MAINTENANCE_STATUS_ID);
    });

    test("a monitor added is saved with the one already there, the status and the other resources kept", async () => {
      const user: UserEvent = renderEditForm({ hasEventStarted: false });

      await screen.findByText(SERVICE_NAME);
      await pickResource(user, monitorsPicker(), OTHER_MONITOR_NAME);

      const saved: ScheduledMaintenance = await save();

      expect(resourcesOf(saved)).toEqual({
        ...AS_ATTACHED,
        monitors: [MONITOR_ID, OTHER_MONITOR_ID],
      });
      expectStatusSent(saved, UNDER_MAINTENANCE_STATUS_ID);
    });

    test("a host added is saved with the others, and the monitors kept", async () => {
      const user: UserEvent = renderEditForm({ hasEventStarted: false });

      await screen.findByText(SERVICE_NAME);
      await pickResource(user, otherResourcesPicker(), OTHER_HOST_NAME);

      const saved: ScheduledMaintenance = await save();

      expect(resourcesOf(saved)).toEqual({
        ...AS_ATTACHED,
        hosts: [HOST_ID, OTHER_HOST_ID],
      });
    });

    /*
     * Also covers the in-between render: the form briefly holds the picker's
     * payload under `monitors` before the split, and must not throw on it.
     */
    test("removing the last monitor hides the status and saves none, the rest as they were", async () => {
      renderEditForm({ hasEventStarted: false });

      await statusControl();

      fireEvent.click(
        await screen.findByRole("button", { name: `Remove ${MONITOR_NAME}` }),
      );
      await waitFor(() => {
        expect(screen.queryByText(MONITOR_NAME)).toBeNull();
      });
      await waitFor(() => {
        expect(queryStatusControl()).toBeNull();
      });
      // The other chips keep their names through the form's rewrite to IDs.
      expect(screen.getByText(HOST_NAME)).toBeInTheDocument();
      expect(screen.getByText(SITE_NAME)).toBeInTheDocument();

      const saved: ScheduledMaintenance = await save();

      expect(resourcesOf(saved)).toEqual({ ...AS_ATTACHED, monitors: [] });
      // Left out of the request: the event keeps the status it had.
      expectNoStatusSent(saved);
    });

    test("removing the network site saves the event without it, and the monitors as they were", async () => {
      renderEditForm({ hasEventStarted: false });

      fireEvent.click(
        await screen.findByRole("button", { name: `Remove ${SITE_NAME}` }),
      );
      await waitFor(() => {
        expect(screen.queryByText(SITE_NAME)).toBeNull();
      });

      const saved: ScheduledMaintenance = await save();

      expect(resourcesOf(saved)).toEqual({ ...AS_ATTACHED, networkSites: [] });
    });
  });

  describe("once the event has started", () => {
    test("shows the status the event holds, read-only, with why, right under the monitors", async () => {
      renderEditForm({ hasEventStarted: true });

      await screen.findByText(SERVICE_NAME);

      const status: HTMLElement = await startedStatus();

      await waitFor(() => {
        expect(
          within(status).getByText("Under Maintenance"),
        ).toBeInTheDocument();
      });

      // Nothing to change it with.
      expect(queryStatusControl()).toBeNull();
      expect(within(status).queryByRole("button")).toBeNull();
      expect(within(status).queryByRole("combobox")).toBeNull();
      expect(within(status).queryByRole("textbox")).toBeNull();

      // Why, in the field's description.
      expect(screen.getByText("Change Monitor Status to")).toBeInTheDocument();
      expect(screen.getByText(STARTED_DESCRIPTION)).toBeInTheDocument();
      expect(screen.queryByText(BEFORE_START_DESCRIPTION)).toBeNull();

      const monitors: HTMLElement = fieldOf(monitorsPicker());
      const others: HTMLElement = fieldOf(otherResourcesPicker());

      expect(
        monitors.compareDocumentPosition(status) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        status.compareDocumentPosition(others) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // The one status the event holds is read, by its id.
      const reads: Array<{ query: Record<string, unknown> }> =
        monitorStatusReads();

      expect(reads.length).toBeGreaterThanOrEqual(1);
      expect(
        reads.some((read: { query: Record<string, unknown> }) => {
          const filter: unknown = read.query["_id"];
          return (
            filter instanceof Includes &&
            (filter.values as Array<unknown>).map(String).join(",") ===
              UNDER_MAINTENANCE_STATUS_ID
          );
        }),
      ).toBe(true);
    });

    test("with no status, says the monitors keep theirs", async () => {
      eventOnServer = ATTACHED;

      renderEditForm({ hasEventStarted: true });

      await screen.findByText(SERVICE_NAME);

      const status: HTMLElement = await startedStatus();

      expect(status).toHaveTextContent("Monitors keep their status.");
      expect(screen.getByText(STARTED_DESCRIPTION)).toBeInTheDocument();
      expect(queryStatusControl()).toBeNull();
      // Nothing to look up.
      expect(monitorStatusReads()).toEqual([]);
    });

    test("is not shown while no monitor is picked", async () => {
      eventOnServer = {
        hosts: [{ _id: HOST_ID }],
        changeMonitorStatusTo: { _id: UNDER_MAINTENANCE_STATUS_ID },
      };

      renderEditForm({ hasEventStarted: true });

      await screen.findByText(HOST_NAME);

      expect(screen.queryByText("Change Monitor Status to")).toBeNull();
      expect(screen.queryByTestId("started-event-monitor-status")).toBeNull();
      expect(screen.queryByText(STARTED_DESCRIPTION)).toBeNull();
    });

    test.each(EDITORS)(
      "%s saves the resources and sends no status",
      async (_role: string, permissions: Array<Permission>) => {
        mockRole = permissions;

        renderEditForm({ hasEventStarted: true });

        // As above: the status, not a resource chip some editors cannot read.
        const status: HTMLElement = await startedStatus();

        await waitFor(() => {
          expect(
            within(status).getByText("Under Maintenance"),
          ).toBeInTheDocument();
        });
        expect(screen.getByText(STARTED_DESCRIPTION)).toBeInTheDocument();
        expect(queryStatusControl()).toBeNull();

        const saved: ScheduledMaintenance = await save();

        expect(resourcesOf(saved)).toEqual(AS_ATTACHED);
        expectNoStatusSent(saved);
      },
    );

    test("a monitor added is saved, and no status is sent with it", async () => {
      const user: UserEvent = renderEditForm({ hasEventStarted: true });

      await screen.findByText(SERVICE_NAME);
      await startedStatus();
      await pickResource(user, monitorsPicker(), OTHER_MONITOR_NAME);

      const saved: ScheduledMaintenance = await save();

      expect(resourcesOf(saved)).toEqual({
        ...AS_ATTACHED,
        monitors: [MONITOR_ID, OTHER_MONITOR_ID],
      });
      expectNoStatusSent(saved);
    });

    test("removing a resource still saves, and no status is sent", async () => {
      renderEditForm({ hasEventStarted: true });

      await startedStatus();

      fireEvent.click(
        await screen.findByRole("button", { name: `Remove ${SITE_NAME}` }),
      );
      await waitFor(() => {
        expect(screen.queryByText(SITE_NAME)).toBeNull();
      });

      const saved: ScheduledMaintenance = await save();

      expect(resourcesOf(saved)).toEqual({ ...AS_ATTACHED, networkSites: [] });
      expectNoStatusSent(saved);
    });
  });
});
