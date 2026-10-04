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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Edit modal of an incident's Affected Resources card, rendered through
 * the real ModelForm and the real pickers with the very fields and save hook
 * the incident page hands its card (Components/Incident/
 * IncidentAffectedResourcesFormFields).
 *
 * The bug as the user met it: open an incident, click Edit on the Affected
 * Resources card, and the attached monitor reads "MONITOR Unnamed Monitor".
 * ModelForm loads the incident with `monitors: true`, which the server
 * answers with `{ _id }` per monitor, and then flattens the relation to bare
 * ID strings before the picker ever sees it - so the picker has to find the
 * names itself.
 *
 * And as Declare Incident asks: the monitors in a picker of their own, then
 * "Change Monitor Status to" right under them - only while a monitor is
 * picked - then everything else. Saving stores what the one picker stored:
 * each resource in its own relation, and the status untouched unless there
 * is a monitor to put in it.
 */

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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import {
  getIncidentAffectedResourcesFormFields,
  onBeforeIncidentAffectedResourcesUpdate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentAffectedResourcesFormFields";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

const INCIDENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";
const MONITOR_NAME: string = "Production Website";
const OTHER_MONITOR_ID: string = "22222222-2222-4222-8222-222222222223";
const OTHER_MONITOR_NAME: string = "Checkout API";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const HOST_NAME: string = "web-01";
const SERVICE_ID: string = "44444444-4444-4444-8444-444444444444";
const SERVICE_NAME: string = "checkout-api";
const STATUS_ID: string = "55555555-5555-4555-8555-555555555555";
const STATUS_NAME: string = "Degraded";

type ModelClass = { new (): BaseModel };

const NAMES: Map<ModelClass, Record<string, string>> = new Map<
  ModelClass,
  Record<string, string>
>([
  [
    Monitor,
    { [MONITOR_ID]: MONITOR_NAME, [OTHER_MONITOR_ID]: OTHER_MONITOR_NAME },
  ],
  [Host, { [HOST_ID]: HOST_NAME }],
  [Service, { [SERVICE_ID]: SERVICE_NAME }],
  [MonitorStatus, { [STATUS_ID]: STATUS_NAME }],
]);

let capturedGetItemSelect: Record<string, unknown> | null = null;

/*
 * What the API answers for the edit form's load: each relation selected as
 * `true` comes back as `{ _id }` only.
 */
const ATTACHED: JSONObject = {
  monitors: [{ _id: MONITOR_ID }],
  hosts: [{ _id: HOST_ID }],
  services: [{ _id: SERVICE_ID }],
};

let incidentOnServer: JSONObject = ATTACHED;

const renderEditForm: () => void = (): void => {
  render(
    <ModelForm<Incident>
      modelType={Incident}
      id="edit-incident-affected-resources"
      name="Edit Incident"
      fields={getIncidentAffectedResourcesFormFields()}
      formType={FormType.Update}
      modelIdToEdit={INCIDENT_ID}
      submitButtonText="Save Changes"
      onBeforeUpdate={onBeforeIncidentAffectedResourcesUpdate}
      onSuccess={() => {
        // asserted through createOrUpdateMock
      }}
    />,
  );
};

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

async function save(): Promise<Incident> {
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  return (createOrUpdateMock.mock.calls[0]![0] as { model: Incident }).model;
}

const idsOf: (models: Array<BaseModel> | undefined) => Array<string> = (
  models: Array<BaseModel> | undefined,
): Array<string> => {
  return (models || []).map((model: BaseModel) => {
    return String(model._id);
  });
};

beforeEach(() => {
  capturedGetItemSelect = null;
  incidentOnServer = ATTACHED;
  getItemMock.mockReset();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();

  getItemMock.mockImplementation(async (...args: Array<unknown>) => {
    capturedGetItemSelect = (args[0] as { select: Record<string, unknown> })
      .select;
    return BaseModel.fromJSON(
      { _id: INCIDENT_ID.toString(), ...incidentOnServer },
      Incident,
    ) as Incident;
  });

  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const { modelType, query } = args[0] as {
      modelType: ModelClass;
      query: Record<string, unknown>;
    };
    const names: Record<string, string> = NAMES.get(modelType) || {};
    const idFilter: unknown = query["_id"];
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
    return { data: new Incident(), miscData: undefined };
  });
});

afterEach(() => {
  cleanup();
});

describe("the Edit modal of an incident's Affected Resources card", () => {
  test("loads the relations the way the bug report saw them: IDs only", async () => {
    renderEditForm();

    await waitFor(() => {
      expect(capturedGetItemSelect).not.toBeNull();
    });
    // `true`, not `{ _id, name }` - the server hands back `{ _id }` for this.
    expect(capturedGetItemSelect!["monitors"]).toBe(true);
    // Every other relation and the status are loaded too, to be saved back.
    for (const key of [
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
      "services",
      "changeMonitorStatusTo",
    ]) {
      expect(`${key}: ${String(capturedGetItemSelect![key])}`).toBe(
        `${key}: true`,
      );
    }
  });

  test("names the attached monitor instead of showing 'Unnamed Monitor'", async () => {
    renderEditForm();

    expect(await screen.findByText(MONITOR_NAME)).toBeInTheDocument();
    expect(screen.queryByText("Unnamed Monitor")).toBeNull();
  });

  test("names every attached resource type, not just monitors", async () => {
    renderEditForm();

    expect(await screen.findByText(MONITOR_NAME)).toBeInTheDocument();
    expect(await screen.findByText(HOST_NAME)).toBeInTheDocument();
    expect(await screen.findByText(SERVICE_NAME)).toBeInTheDocument();
    expect(screen.queryByText(/^Unnamed /)).toBeNull();
    expect(screen.queryByText(/^Unknown /)).toBeNull();
  });

  test("looks each name up by ID against its own model", async () => {
    renderEditForm();

    await screen.findByText(SERVICE_NAME);

    const lookups: Array<{ modelType: ModelClass; ids: Array<string> }> =
      getListMock.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as {
            modelType: ModelClass;
            query: Record<string, unknown>;
          };
        })
        .filter((args: { query: Record<string, unknown> }) => {
          return args.query["_id"] instanceof Includes;
        })
        .map(
          (args: { modelType: ModelClass; query: Record<string, unknown> }) => {
            return {
              modelType: args.modelType,
              ids: (
                (args.query["_id"] as Includes).values as Array<string>
              ).map((v: string) => {
                return String(v);
              }),
            };
          },
        );

    expect(lookups).toHaveLength(3);
    expect(lookups).toEqual(
      expect.arrayContaining([
        { modelType: Monitor, ids: [MONITOR_ID] },
        { modelType: Host, ids: [HOST_ID] },
        { modelType: Service, ids: [SERVICE_ID] },
      ]),
    );
  });

  test("asks for the monitors apart from the other resources, each picker named by its label", async () => {
    renderEditForm();

    await screen.findByText(SERVICE_NAME);

    const monitors: HTMLElement = fieldOf(monitorsPicker());
    const others: HTMLElement = fieldOf(otherResourcesPicker());

    expect(within(monitors).getByText(MONITOR_NAME)).toBeInTheDocument();
    expect(within(monitors).queryByText(HOST_NAME)).toBeNull();
    expect(within(others).getByText(HOST_NAME)).toBeInTheDocument();
    expect(within(others).getByText(SERVICE_NAME)).toBeInTheDocument();
    expect(within(others).queryByText(MONITOR_NAME)).toBeNull();

    // The status the monitors change to sits between the two.
    const status: HTMLElement = screen.getByRole("combobox", {
      name: /^Change Monitor Status to/,
    });

    expect(
      monitors.compareDocumentPosition(fieldOf(status)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      fieldOf(status).compareDocumentPosition(others) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("saving without changes keeps every attached resource, and the status", async () => {
    incidentOnServer = {
      ...ATTACHED,
      changeMonitorStatusTo: { _id: STATUS_ID },
    };

    renderEditForm();

    await screen.findByText(MONITOR_NAME);
    // The status the incident has, named in its dropdown.
    expect(
      await screen.findByRole("button", { name: /^Change Monitor Status to/ }),
    ).toHaveTextContent(STATUS_NAME);

    const saved: Incident = await save();

    expect(idsOf(saved.monitors)).toEqual([MONITOR_ID]);
    expect(idsOf(saved.hosts)).toEqual([HOST_ID]);
    expect(idsOf(saved.services)).toEqual([SERVICE_ID]);
    expect(saved.changeMonitorStatusTo?._id?.toString()).toBe(STATUS_ID);
  });

  /*
   * Also covers the in-between render: act() flushes the form's
   * setFieldValue(monitors, <picker payload>) before the page's queued
   * splitter runs, so the picker is briefly handed a non-array and must not
   * throw on it.
   */
  test("removing the monitor in the modal saves the incident without it", async () => {
    renderEditForm();

    fireEvent.click(
      await screen.findByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    );
    await waitFor(() => {
      expect(screen.queryByText(MONITOR_NAME)).toBeNull();
    });
    // The other chips keep their names through the form's rewrite to IDs.
    expect(screen.getByText(HOST_NAME)).toBeInTheDocument();
    expect(screen.getByText(SERVICE_NAME)).toBeInTheDocument();

    const saved: Incident = await save();

    expect(saved.monitors || []).toEqual([]);
    expect(idsOf(saved.hosts)).toEqual([HOST_ID]);
    expect(idsOf(saved.services)).toEqual([SERVICE_ID]);
  });

  test("removing the last monitor takes the status away, and leaves it as it was on save", async () => {
    incidentOnServer = {
      ...ATTACHED,
      changeMonitorStatusTo: { _id: STATUS_ID },
    };

    renderEditForm();

    fireEvent.click(
      await screen.findByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Change Monitor Status to")).toBeNull();
    });

    const saved: Incident = await save();

    expect(saved.monitors || []).toEqual([]);
    // Not sent: the server leaves the incident's status as it was.
    expect("changeMonitorStatusTo" in saved).toBe(false);
    expect("changeMonitorStatusToId" in saved).toBe(false);
  });

  test("an incident with a status but no monitor: the status is not asked, and is left as it was", async () => {
    incidentOnServer = {
      hosts: [{ _id: HOST_ID }],
      changeMonitorStatusTo: { _id: STATUS_ID },
    };

    renderEditForm();

    await screen.findByText(HOST_NAME);
    expect(screen.queryByText("Change Monitor Status to")).toBeNull();

    const saved: Incident = await save();

    expect(idsOf(saved.hosts)).toEqual([HOST_ID]);
    expect("changeMonitorStatusTo" in saved).toBe(false);
  });

  test("a monitor picked on such an incident brings its status back, and both are saved", async () => {
    incidentOnServer = {
      hosts: [{ _id: HOST_ID }],
      changeMonitorStatusTo: { _id: STATUS_ID },
    };

    renderEditForm();

    await screen.findByText(HOST_NAME);

    fireEvent.focus(monitorsPicker());
    fireEvent.click(
      await screen.findByRole("option", { name: OTHER_MONITOR_NAME }),
    );

    expect(
      await screen.findByRole("button", { name: /^Change Monitor Status to/ }),
    ).toHaveTextContent(STATUS_NAME);

    const saved: Incident = await save();

    expect(idsOf(saved.monitors)).toEqual([OTHER_MONITOR_ID]);
    expect(idsOf(saved.hosts)).toEqual([HOST_ID]);
    expect(saved.changeMonitorStatusTo?._id?.toString()).toBe(STATUS_ID);
  });
});
