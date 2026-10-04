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
 * fields the event's page hands its card (Components/ScheduledMaintenance/
 * ScheduledMaintenanceAffectedResourcesFormFields), as a project owner.
 *
 * Split as Create Scheduled Maintenance Event is: the monitors in a picker
 * of their own, everything else below. Saving stores what the one picker
 * stored for the same picks - each resource in its own relation - and sends
 * no monitor status: an event's is chosen when it is created, and the API
 * takes no change to it.
 */

configure({ asyncUtilTimeout: 15000 });

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
  const granted: Array<string> = [
    PermissionEnum["ProjectOwner"]!,
    PermissionEnum["User"]!,
    PermissionEnum["Public"]!,
  ];

  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return granted;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: granted };
      },
    },
  };
});

// A project owner, not a master admin: the Edit offers what a person may update.
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

import { getScheduledMaintenanceAffectedResourcesFormFields } from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceAffectedResourcesFormFields";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
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
const STATUS_ID: string = "55555555-5555-4555-8555-555555555555";

type ModelClass = { new (): BaseModel };

const NAMES: Map<ModelClass, Record<string, string>> = new Map<
  ModelClass,
  Record<string, string>
>([
  [
    Monitor,
    { [MONITOR_ID]: MONITOR_NAME, [OTHER_MONITOR_ID]: OTHER_MONITOR_NAME },
  ],
  [Host, { [HOST_ID]: HOST_NAME, [OTHER_HOST_ID]: OTHER_HOST_NAME }],
  [NetworkSite, { [SITE_ID]: SITE_NAME }],
  [Service, { [SERVICE_ID]: SERVICE_NAME }],
  [MonitorStatus, { [STATUS_ID]: "Under Maintenance" }],
]);

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

let eventOnServer: JSONObject = ATTACHED;

function renderEditForm(): UserEvent {
  render(
    <ModelForm<ScheduledMaintenance>
      modelType={ScheduledMaintenance}
      id="edit-scheduled-maintenance-affected-resources"
      name="Edit Scheduled Maintenance"
      fields={getScheduledMaintenanceAffectedResourcesFormFields()}
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
  dockerSwarmClusters: [],
  iotFleets: [],
  databaseServers: [],
  networkSites: [SITE_ID],
  services: [SERVICE_ID],
};

beforeEach(() => {
  capturedGetItemSelect = null;
  eventOnServer = ATTACHED;
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
    const names: Record<string, string> = NAMES.get(modelType) || {};
    const idFilter: unknown = query?.["_id"];
    const ids: Array<string> =
      idFilter instanceof Includes
        ? (idFilter.values as Array<string>).map((v: string) => {
            return String(v);
          })
        : Object.keys(names);
    const data: Array<BaseModel> = ids
      .filter((id: string) => {
        return names[id] !== undefined;
      })
      .map((id: string) => {
        const model: BaseModel = new modelType();
        model._id = id;
        (model as unknown as { name: string }).name = names[id]!;
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
  test("loads every relation the two pickers write, and no monitor status", async () => {
    renderEditForm();

    await waitFor(() => {
      expect(capturedGetItemSelect).not.toBeNull();
    });

    for (const key of [
      "monitors",
      "hosts",
      "kubernetesClusters",
      "dockerHosts",
      "podmanHosts",
      "proxmoxClusters",
      "vmwareVCenters",
      "cephClusters",
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

    expect(capturedGetItemSelect!["changeMonitorStatusTo"]).toBeUndefined();
  });

  test("asks for the monitors apart from the other resources, each picker named by its label", async () => {
    renderEditForm();

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

  test("asks for no monitor status, monitors picked or not", async () => {
    renderEditForm();

    await screen.findByText(MONITOR_NAME);

    expect(screen.queryByText("Change Monitor Status to")).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: /^Change Monitor Status to/ }),
    ).toBeNull();
  });

  test("saving without changes keeps every attached resource, and sends no status", async () => {
    eventOnServer = {
      ...ATTACHED,
      changeMonitorStatusTo: { _id: STATUS_ID },
    };

    renderEditForm();

    await screen.findByText(SERVICE_NAME);

    const saved: ScheduledMaintenance = await save();

    expect(resourcesOf(saved)).toEqual(AS_ATTACHED);

    // The request carries no status: the event keeps the one it was created with.
    const sent: JSONObject = BaseModel.toJSON(saved, ScheduledMaintenance);

    expect(saved.changeMonitorStatusTo).toBeUndefined();
    expect(sent["changeMonitorStatusTo"]).toBeUndefined();
    expect(sent["changeMonitorStatusToId"]).toBeUndefined();
  });

  test("a monitor added is saved with the one already there, and the other resources kept", async () => {
    const user: UserEvent = renderEditForm();

    await screen.findByText(SERVICE_NAME);
    await pickResource(user, monitorsPicker(), OTHER_MONITOR_NAME);

    const saved: ScheduledMaintenance = await save();

    expect(resourcesOf(saved)).toEqual({
      ...AS_ATTACHED,
      monitors: [MONITOR_ID, OTHER_MONITOR_ID],
    });
  });

  test("a host added is saved with the others, and the monitors kept", async () => {
    const user: UserEvent = renderEditForm();

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
  test("removing the monitor saves the event without it, and the rest as they were", async () => {
    renderEditForm();

    fireEvent.click(
      await screen.findByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    );
    await waitFor(() => {
      expect(screen.queryByText(MONITOR_NAME)).toBeNull();
    });
    // The other chips keep their names through the form's rewrite to IDs.
    expect(screen.getByText(HOST_NAME)).toBeInTheDocument();
    expect(screen.getByText(SITE_NAME)).toBeInTheDocument();

    const saved: ScheduledMaintenance = await save();

    expect(resourcesOf(saved)).toEqual({ ...AS_ATTACHED, monitors: [] });
  });

  test("removing the network site saves the event without it, and the monitors as they were", async () => {
    renderEditForm();

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
