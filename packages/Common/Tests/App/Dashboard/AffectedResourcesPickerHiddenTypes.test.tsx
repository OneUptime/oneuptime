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
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Silent data loss in the affected-resources picker. A viewer whose role can
 * edit an incident (IncidentMember) but cannot read some resource type
 * (Kubernetes clusters here) opened the incident's Affected Resources card,
 * clicked Edit, removed one monitor chip and saved - and every Kubernetes
 * cluster attached to the incident was detached with it.
 *
 * The edit form loads those clusters as bare IDs (a `true` relation select
 * comes back as `{ _id }` per resource, which ModelForm flattens to IDs).
 * The picker hid the type from the viewer, which is right, but
 * then rebuilt EVERY payload array from what it showed, so the hidden type
 * went out as []. The page wrote that into the form and the many-to-many save
 * cleared the junction rows. The picker now carries a type it is not showing
 * through unchanged.
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

let isMasterAdmin: boolean = false;
let projectPermissions: Array<Permission> = [];

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return isMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return projectPermissions;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
      getProjectPermissions: (): UserTenantAccessPermission => {
        return {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: projectPermissions.map(
            (permission: Permission): UserPermission => {
              return {
                _type: "UserPermission",
                permission,
                labelIds: [],
              };
            },
          ),
        };
      },
    },
  };
});

import AffectedResourcesPicker, {
  AffectedResourcesPayload,
  AffectedResourceType,
  isAffectedResourcesPayload,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../UI/Components/Forms/ModelForm";
import { CustomElementProps } from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";

const PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const id: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
};

const MONITOR_ID: string = id(1);
const MONITOR_NAME: string = "Checkout API";
const SECOND_MONITOR_ID: string = id(2);
const SECOND_MONITOR_NAME: string = "Orders DB";
const THIRD_MONITOR_ID: string = id(3);
const THIRD_MONITOR_NAME: string = "Payments";
const CLUSTER_ID: string = id(11);
const SECOND_CLUSTER_ID: string = id(12);
const HOST_ID: string = id(21);
const NETWORK_SITE_ID: string = id(31);

/*
 * An IncidentMember: may edit an incident's affected resources and read
 * monitors, but holds no permission that reads Kubernetes clusters (or
 * hosts, services, ...).
 */
const INCIDENT_MEMBER_WHO_READS_MONITORS: Array<Permission> = [
  Permission.IncidentMember,
  Permission.ReadProjectMonitor,
];

// The types the incident page offers, in its order.
const INCIDENT_PAGE_TYPES: Array<AffectedResourceType> = [
  "Monitor",
  "Host",
  "KubernetesCluster",
  "DockerHost",
  "PodmanHost",
  "ProxmoxCluster",
  "VMwareVCenter",
  "CephCluster",
  "DockerSwarmCluster",
  "IoTFleet",
  "DatabaseServer",
  "Service",
];

type ModelClass = { new (): BaseModel };

const NAMES: Map<ModelClass, Record<string, string>> = new Map<
  ModelClass,
  Record<string, string>
>([
  [
    Monitor,
    {
      [MONITOR_ID]: MONITOR_NAME,
      [SECOND_MONITOR_ID]: SECOND_MONITOR_NAME,
      [THIRD_MONITOR_ID]: THIRD_MONITOR_NAME,
    },
  ],
]);

/*
 * Answers the picker's search (every readable type) and, should the picker
 * look names up by ID, those lookups too. Only monitors exist here.
 */
const fakeGetList: (args: {
  modelType: ModelClass;
  query: Record<string, unknown>;
}) => Promise<{
  data: Array<BaseModel>;
  count: number;
  skip: number;
  limit: number;
}> = async (args: {
  modelType: ModelClass;
  query: Record<string, unknown>;
}): Promise<{
  data: Array<BaseModel>;
  count: number;
  skip: number;
  limit: number;
}> => {
  const names: Record<string, string> = NAMES.get(args.modelType) || {};
  const idFilter: unknown = args.query["_id"];
  const ids: Array<string> =
    idFilter instanceof Includes
      ? (idFilter.values as Array<string>).map((v: string) => {
          return String(v);
        })
      : Object.keys(names);
  const data: Array<BaseModel> =
    args.query["description"] !== undefined
      ? []
      : ids
          .filter((rowId: string) => {
            return names[rowId] !== undefined;
          })
          .map((rowId: string) => {
            const model: BaseModel = new args.modelType();
            model._id = rowId;
            (model as unknown as { name: string }).name = names[rowId]!;
            return model;
          });
  return { data, count: data.length, skip: 0, limit: 10 };
};

const named: (rowId: string, name: string) => { _id: string; name: string } = (
  rowId: string,
  name: string,
): { _id: string; name: string } => {
  return { _id: rowId, name };
};

type PickerValues = Partial<
  Record<
    Exclude<keyof AffectedResourcesPayload, "__affectedResourcesPayload">,
    unknown
  >
>;

let payloads: Array<AffectedResourcesPayload> = [];

const lastPayload: () => AffectedResourcesPayload =
  (): AffectedResourcesPayload => {
    expect(payloads.length).toBeGreaterThan(0);
    return payloads[payloads.length - 1]!;
  };

/*
 * Stands in for a page: holds the form values, hands them to the picker, and
 * writes every array of the payload back - which is what the incident, alert
 * and scheduled maintenance pages all do.
 */
const PageHarness: (props: {
  initial: PickerValues;
  resourceTypes?: Array<AffectedResourceType> | undefined;
}) => ReactElement = (props: {
  initial: PickerValues;
  resourceTypes?: Array<AffectedResourceType> | undefined;
}): ReactElement => {
  const [values, setValues] = useState<PickerValues>(props.initial);
  return (
    <AffectedResourcesPicker
      monitors={values.monitors as Array<Monitor>}
      hosts={values.hosts as Array<Host>}
      kubernetesClusters={values.kubernetesClusters as Array<KubernetesCluster>}
      networkSites={values.networkSites as Array<NetworkSite>}
      services={values.services as Array<Service>}
      resourceTypes={props.resourceTypes}
      onChange={(payload: AffectedResourcesPayload) => {
        payloads.push(payload);
        setValues({
          ...values,
          monitors: payload.monitors,
          hosts: payload.hosts,
          kubernetesClusters: payload.kubernetesClusters,
          networkSites: payload.networkSites,
          services: payload.services,
        });
      }}
    />
  );
};

beforeEach(() => {
  isMasterAdmin = false;
  projectPermissions = INCIDENT_MEMBER_WHO_READS_MONITORS;
  payloads = [];
  getItemMock.mockReset();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    return fakeGetList(
      args[0] as { modelType: ModelClass; query: Record<string, unknown> },
    );
  });
});

afterEach(() => {
  cleanup();
});

describe("AffectedResourcesPicker, for a viewer who cannot read every type", () => {
  test("removing a monitor chip keeps the Kubernetes clusters the viewer cannot read", () => {
    render(
      <PageHarness
        initial={{
          monitors: [
            named(MONITOR_ID, MONITOR_NAME),
            named(SECOND_MONITOR_ID, SECOND_MONITOR_NAME),
          ],
          // Bare IDs - what ModelForm hands the picker in an edit form.
          kubernetesClusters: [CLUSTER_ID, SECOND_CLUSTER_ID],
        }}
        resourceTypes={INCIDENT_PAGE_TYPES}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    );

    expect(lastPayload().monitors).toEqual([SECOND_MONITOR_ID]);
    expect(lastPayload().kubernetesClusters).toEqual([
      CLUSTER_ID,
      SECOND_CLUSTER_ID,
    ]);
  });

  test("the clusters survive edit after edit, down to the last monitor", () => {
    render(
      <PageHarness
        initial={{
          monitors: [
            named(MONITOR_ID, MONITOR_NAME),
            named(SECOND_MONITOR_ID, SECOND_MONITOR_NAME),
          ],
          kubernetesClusters: [CLUSTER_ID, SECOND_CLUSTER_ID],
        }}
        resourceTypes={INCIDENT_PAGE_TYPES}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${SECOND_MONITOR_NAME}` }),
    );

    expect(payloads).toHaveLength(2);
    // A type the viewer CAN read still goes out as [] once emptied.
    expect(lastPayload().monitors).toEqual([]);
    expect(lastPayload().kubernetesClusters).toEqual([
      CLUSTER_ID,
      SECOND_CLUSTER_ID,
    ]);
  });

  test("adding a monitor from the search keeps the hidden clusters", async () => {
    render(
      <PageHarness
        initial={{
          monitors: [named(MONITOR_ID, MONITOR_NAME)],
          kubernetesClusters: [CLUSTER_ID],
        }}
        resourceTypes={INCIDENT_PAGE_TYPES}
      />,
    );

    fireEvent.focus(screen.getByRole("combobox"));
    fireEvent.click(
      await screen.findByRole("option", { name: THIRD_MONITOR_NAME }),
    );

    expect(lastPayload().monitors).toEqual([MONITOR_ID, THIRD_MONITOR_ID]);
    expect(lastPayload().kubernetesClusters).toEqual([CLUSTER_ID]);
    // Only the readable type was searched.
    for (const call of getListMock.mock.calls) {
      expect((call[0] as { modelType: ModelClass }).modelType).toBe(Monitor);
    }
  });

  test("'Clear all' clears what the viewer can see and keeps what they cannot", () => {
    const monitors: Array<{ _id: string; name: string }> = [];
    for (let i: number = 0; i < 50; i++) {
      monitors.push(named(id(1000 + i), `Monitor ${i}`));
    }
    render(
      <PageHarness
        initial={{ monitors, kubernetesClusters: [CLUSTER_ID] }}
        resourceTypes={INCIDENT_PAGE_TYPES}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(lastPayload().monitors).toEqual([]);
    expect(lastPayload().kubernetesClusters).toEqual([CLUSTER_ID]);
  });

  test("Backspace on the empty input keeps the hidden clusters", () => {
    render(
      <PageHarness
        initial={{
          monitors: [named(MONITOR_ID, MONITOR_NAME)],
          kubernetesClusters: [CLUSTER_ID],
        }}
        resourceTypes={INCIDENT_PAGE_TYPES}
      />,
    );

    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Backspace" });

    expect(lastPayload().monitors).toEqual([]);
    expect(lastPayload().kubernetesClusters).toEqual([CLUSTER_ID]);
  });

  test("hidden resources handed in as models go out as their IDs", () => {
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster._id = SECOND_CLUSTER_ID;
    render(
      <PageHarness
        initial={{
          monitors: [named(MONITOR_ID, MONITOR_NAME)],
          kubernetesClusters: [{ _id: CLUSTER_ID }, cluster],
        }}
        resourceTypes={INCIDENT_PAGE_TYPES}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    );

    expect(lastPayload().kubernetesClusters).toEqual([
      CLUSTER_ID,
      SECOND_CLUSTER_ID,
    ]);
  });

  test("a hidden type the form never loaded stays undefined rather than []", () => {
    render(
      <PageHarness
        initial={{
          monitors: [named(MONITOR_ID, MONITOR_NAME)],
          kubernetesClusters: [CLUSTER_ID],
          hosts: [],
        }}
        resourceTypes={INCIDENT_PAGE_TYPES}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    );

    /*
     * undefined is left out of the save request, so the server keeps the
     * relation as it is. [] would detach everything under it.
     */
    expect(lastPayload().services).toBeUndefined();
    expect(lastPayload().dockerHosts).toBeUndefined();
    // An empty array that WAS loaded is carried through as the same [].
    expect(lastPayload().hosts).toEqual([]);
  });

  test("a type the page left out of resourceTypes is carried through too", () => {
    isMasterAdmin = true;
    render(
      <PageHarness
        initial={{
          monitors: [named(MONITOR_ID, MONITOR_NAME)],
          hosts: [HOST_ID],
          networkSites: [{ _id: NETWORK_SITE_ID }],
        }}
        resourceTypes={["Monitor"]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${MONITOR_NAME}` }),
    );

    expect(lastPayload().monitors).toEqual([]);
    expect(lastPayload().hosts).toEqual([HOST_ID]);
    expect(lastPayload().networkSites).toEqual([NETWORK_SITE_ID]);
  });

  test("says how many attached resources are hidden, without a removable chip for them", () => {
    render(
      <PageHarness
        initial={{
          monitors: [named(MONITOR_ID, MONITOR_NAME)],
          hosts: [HOST_ID],
          kubernetesClusters: [CLUSTER_ID, SECOND_CLUSTER_ID],
        }}
        resourceTypes={INCIDENT_PAGE_TYPES}
      />,
    );

    expect(
      screen.getByTestId("affected-resources-hidden-note"),
    ).toHaveTextContent(
      "3 resources you don't have permission to view are also attached (Host, Kubernetes Cluster). They will be kept.",
    );
    // One chip - the monitor - and one remove button.
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
    expect(screen.queryByText("Kubernetes Cluster")).toBeNull();
    expect(screen.queryByText(/^Unnamed /)).toBeNull();
  });

  test("uses the singular for a single hidden resource", () => {
    render(
      <PageHarness
        initial={{ kubernetesClusters: [CLUSTER_ID] }}
        resourceTypes={INCIDENT_PAGE_TYPES}
      />,
    );

    expect(
      screen.getByTestId("affected-resources-hidden-note"),
    ).toHaveTextContent(
      "1 resource you don't have permission to view is also attached (Kubernetes Cluster). It will be kept.",
    );
  });

  test("shows no note when the viewer can read every attached type", () => {
    isMasterAdmin = true;
    render(
      <PageHarness
        initial={{
          monitors: [named(MONITOR_ID, MONITOR_NAME)],
          kubernetesClusters: [CLUSTER_ID],
        }}
        resourceTypes={INCIDENT_PAGE_TYPES}
      />,
    );

    expect(screen.queryByTestId("affected-resources-hidden-note")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(2);
  });

  test("shows no note when a denied type has nothing attached", () => {
    render(
      <PageHarness
        initial={{
          monitors: [named(MONITOR_ID, MONITOR_NAME)],
          kubernetesClusters: [],
        }}
        resourceTypes={INCIDENT_PAGE_TYPES}
      />,
    );

    expect(screen.queryByTestId("affected-resources-hidden-note")).toBeNull();
  });
});

/*
 * The whole path as the viewer met it, through the real ModelForm: the
 * incident loads with its relations as `{ _id }`, ModelForm flattens them to
 * IDs, the picker edits, the page's onChange writes every array back, and
 * ModelForm submits.
 */

const INCIDENT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const hiddenField: (
  key: "hosts" | "kubernetesClusters" | "services",
) => ModelField<Incident> = (
  key: "hosts" | "kubernetesClusters" | "services",
): ModelField<Incident> => {
  return {
    field: { [key]: true } as ModelField<Incident>["field"],
    title: "",
    fieldType: FormFieldSchemaType.Text,
    required: false,
    showIf: () => {
      return false;
    },
  };
};

// The incident page's Affected Resources edit fields.
const AFFECTED_RESOURCE_FIELDS: Array<ModelField<Incident>> = [
  {
    field: { monitors: true },
    title: "",
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    getCustomElement: (
      values: FormValues<Incident>,
      elementProps: CustomElementProps,
    ): ReactElement => {
      return (
        <AffectedResourcesPicker
          monitors={values.monitors as Array<Monitor>}
          hosts={values.hosts as Array<Host>}
          kubernetesClusters={
            values.kubernetesClusters as Array<KubernetesCluster>
          }
          services={values.services as Array<Service>}
          resourceTypes={INCIDENT_PAGE_TYPES}
          onChange={(payload: unknown) => {
            elementProps.onChange?.(payload);
          }}
        />
      );
    },
    onChange: (
      value: unknown,
      currentValues: FormValues<Incident>,
      setNewFormValues: (values: FormValues<Incident>) => void,
    ) => {
      if (isAffectedResourcesPayload(value)) {
        const payload: typeof value = value;
        payloads.push(payload);
        queueMicrotask(() => {
          setNewFormValues({
            ...currentValues,
            monitors: payload.monitors,
            hosts: payload.hosts,
            kubernetesClusters: payload.kubernetesClusters,
            dockerHosts: payload.dockerHosts,
            podmanHosts: payload.podmanHosts,
            proxmoxClusters: payload.proxmoxClusters,
            vmwareVCenters: payload.vmwareVCenters,
            cephClusters: payload.cephClusters,
            dockerSwarmClusters: payload.dockerSwarmClusters,
            iotFleets: payload.iotFleets,
            databaseServers: payload.databaseServers,
            services: payload.services,
          } as FormValues<Incident>);
        });
      }
    },
  },
  hiddenField("hosts"),
  hiddenField("kubernetesClusters"),
  hiddenField("services"),
];

const renderEditForm: () => void = (): void => {
  render(
    <ModelForm<Incident>
      modelType={Incident}
      id="edit-incident-affected-resources"
      name="Edit Incident"
      fields={AFFECTED_RESOURCE_FIELDS}
      formType={FormType.Update}
      modelIdToEdit={INCIDENT_ID}
      submitButtonText="Save Changes"
      onSuccess={() => {
        // asserted through createOrUpdateMock
      }}
    />,
  );
};

const idsOf: (models: Array<BaseModel> | undefined) => Array<string> = (
  models: Array<BaseModel> | undefined,
): Array<string> => {
  return (models || []).map((model: BaseModel) => {
    return String(model._id);
  });
};

const saveAndGetSavedIncident: () => Promise<Incident> =
  async (): Promise<Incident> => {
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    return (createOrUpdateMock.mock.calls[0]![0] as { model: Incident }).model;
  };

describe("the incident Affected Resources Edit modal, for an IncidentMember who cannot read Kubernetes clusters", () => {
  beforeEach(() => {
    getItemMock.mockImplementation(async () => {
      // A `true` relation select comes back as `{ _id }` per resource.
      return BaseModel.fromJSON(
        {
          _id: INCIDENT_ID.toString(),
          monitors: [{ _id: MONITOR_ID }, { _id: SECOND_MONITOR_ID }],
          hosts: [{ _id: HOST_ID }],
          kubernetesClusters: [{ _id: CLUSTER_ID }, { _id: SECOND_CLUSTER_ID }],
          services: [],
        },
        Incident,
      ) as Incident;
    });
    createOrUpdateMock.mockImplementation(async () => {
      return { data: new Incident(), miscData: undefined };
    });
  });

  test("removing a monitor keeps the clusters in the payload and in the saved incident", async () => {
    renderEditForm();

    const removeButtons: Array<HTMLElement> = await screen.findAllByRole(
      "button",
      { name: /^Remove / },
    );
    // Only the two monitors get a chip; the clusters and the host are hidden.
    expect(removeButtons).toHaveLength(2);
    expect(
      screen.getByTestId("affected-resources-hidden-note"),
    ).toHaveTextContent(
      "3 resources you don't have permission to view are also attached (Host, Kubernetes Cluster). They will be kept.",
    );

    fireEvent.click(removeButtons[0]!);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(
        1,
      );
    });

    expect(lastPayload().monitors).toEqual([SECOND_MONITOR_ID]);
    expect(lastPayload().kubernetesClusters).toEqual([
      CLUSTER_ID,
      SECOND_CLUSTER_ID,
    ]);
    expect(lastPayload().hosts).toEqual([HOST_ID]);

    const saved: Incident = await saveAndGetSavedIncident();
    expect(idsOf(saved.monitors)).toEqual([SECOND_MONITOR_ID]);
    expect(idsOf(saved.kubernetesClusters)).toEqual([
      CLUSTER_ID,
      SECOND_CLUSTER_ID,
    ]);
    expect(idsOf(saved.hosts)).toEqual([HOST_ID]);
  });

  test("saving without touching the picker keeps every attached resource", async () => {
    renderEditForm();

    await screen.findAllByRole("button", { name: /^Remove / });
    const saved: Incident = await saveAndGetSavedIncident();

    expect(payloads).toHaveLength(0);
    expect(idsOf(saved.monitors)).toEqual([MONITOR_ID, SECOND_MONITOR_ID]);
    expect(idsOf(saved.kubernetesClusters)).toEqual([
      CLUSTER_ID,
      SECOND_CLUSTER_ID,
    ]);
    expect(idsOf(saved.hosts)).toEqual([HOST_ID]);
  });
});
