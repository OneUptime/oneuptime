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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A record's tab opens the create page with that record in the address.
 *
 * The incidents, alerts and maintenance lists back the project's lists and
 * the tabs of monitors, hosts, clusters and services alike. Their create
 * buttons open a create page of its own, and opened it without the record
 * whose tab they sat on - Monitor > Alerts even handed its list the monitor
 * as create values that no form ever read. Now a list takes the record it
 * belongs to (createFrom) and every one of its create buttons - Declare
 * Incident, Create Alert, Create Scheduled Maintenance Event, and Create
 * from Template beside them - puts it in the address; from a project's list
 * the address carries nothing new.
 *
 * The table is replaced by a recorder, so the card's buttons can be read
 * and pressed; Create from Template's own dialog is drawn for real.
 */

const modelTableMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "00000000-0000-4000-8000-000000000001";
          },
        };
      },
      getCurrentProject: (): null => {
        return null;
      },
      getCurrentPlan: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown): ReactElement => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      default: () => {
        return {
          getOwnersForResource: () => {
            return [];
          },
          isLoadingOwners: false,
          onResourcesFetched: () => {},
          filterBar: null,
          mergeFiltersIntoQuery: (query: unknown) => {
            return query;
          },
          facetSaveState: undefined,
          restoreFacetState: () => {},
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/useCustomFieldFacets",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { facets: [], isLoading: false };
      },
    };
  },
);

jest.mock("../../../UI/Components/BulkUpdate/BulkLabelActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock("../../../UI/Components/BulkUpdate/BulkOwnerActions", () => {
  return {
    __esModule: true,
    default: () => {
      return { bulkActions: [], modals: null };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Alert/BulkIncidentLinkActions",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { bulkActions: [], modals: null };
      },
    };
  },
);

import IncidentsTable from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentsTable";
import AlertsTable from "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertsTable";
import ScheduledMaintenancesTable from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceTable";
import {
  CreateFromRecordAddress,
  CreateFromRecordKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CreateFromRecord/CreateFromRecord";
import { DatabaseBaseModelType } from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: string = "00000000-0000-4000-8000-000000000001";
const MONITOR_ID: string = "0193c0de-2222-4aaa-8bbb-000000000001";
const HOST_ID: string = "0193c0de-2222-4aaa-8bbb-000000000002";
const NETWORK_SITE_ID: string = "0193c0de-2222-4aaa-8bbb-000000000003";
const TEMPLATE_ID: string = "0193c0de-2222-4aaa-8bbb-000000000004";

const INCIDENT_CREATE: string = `/dashboard/${PROJECT_ID}/incidents/create`;
const ALERT_CREATE: string = `/dashboard/${PROJECT_ID}/alerts/create`;
const MAINTENANCE_CREATE: string = `/dashboard/${PROJECT_ID}/scheduled-maintenance-events/create`;

const monitor: CreateFromRecordAddress = {
  kind: CreateFromRecordKind.Monitor,
  id: new ObjectID(MONITOR_ID),
};

const host: CreateFromRecordAddress = {
  kind: CreateFromRecordKind.Host,
  id: new ObjectID(HOST_ID),
};

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderTable(element: ReactElement): Promise<void> {
  render(<MemoryRouter>{element}</MemoryRouter>);
  await flush();

  expect(modelTableMock).toHaveBeenCalled();
}

function cardButton(title: string): CardButtonSchema {
  const props: { cardProps: { buttons: Array<CardButtonSchema> } } =
    modelTableMock.mock.calls[modelTableMock.mock.calls.length - 1]![0] as {
      cardProps: { buttons: Array<CardButtonSchema> };
    };

  const found: Array<CardButtonSchema> = props.cardProps.buttons.filter(
    (button: CardButtonSchema): boolean => {
      return button.title === title;
    },
  );

  expect(found).toHaveLength(1);

  return found[0]!;
}

function navigatedTo(): Array<string> {
  return (Navigation.navigate as unknown as MockFunction).mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as Route).toString();
    },
  );
}

async function press(title: string): Promise<void> {
  await act(async () => {
    cardButton(title).onClick();
  });
}

// Create from Template, its dialog drawn for real: pick the one template.
async function createFromTemplate(templateName: string): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

  await press("Create from Template");

  const dialog: HTMLElement = await screen.findByTestId("modal");

  await user.click(await within(dialog).findByRole("combobox"));
  await user.click(
    await screen.findByRole("option", { name: new RegExp(templateName) }),
  );

  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

  await waitFor(() => {
    expect(Navigation.navigate).toHaveBeenCalled();
  });
}

beforeEach(() => {
  modelTableMock.mockReset();
  getListMock.mockReset();
  PermissionGate.clearPermissionPropsCache();
  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {});

  getListMock.mockImplementation(async (args: unknown) => {
    const modelType: DatabaseBaseModelType = (
      args as { modelType: DatabaseBaseModelType }
    ).modelType;

    if (modelType === IncidentTemplate) {
      const template: IncidentTemplate = new IncidentTemplate();
      template._id = TEMPLATE_ID;
      template.templateName = "Checkout outage";
      return { data: [template], count: 1, skip: 0, limit: 100 };
    }

    if (modelType === ScheduledMaintenanceTemplate) {
      const template: ScheduledMaintenanceTemplate =
        new ScheduledMaintenanceTemplate();
      template._id = TEMPLATE_ID;
      template.templateName = "Weekly patching";
      return { data: [template], count: 1, skip: 0, limit: 100 };
    }

    return { data: [], count: 0, skip: 0, limit: 100 };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a monitor's Incidents tab", () => {
  test("Declare Incident opens the create page with the monitor", async () => {
    await renderTable(<IncidentsTable createFrom={monitor} />);
    await press("Declare Incident");

    expect(navigatedTo()).toEqual([
      `${INCIDENT_CREATE}?monitorId=${MONITOR_ID}`,
    ]);
  });

  test("Create from Template opens it with the monitor and the template", async () => {
    await renderTable(<IncidentsTable createFrom={monitor} />);
    await createFromTemplate("Checkout outage");

    expect(navigatedTo()).toEqual([
      `${INCIDENT_CREATE}?monitorId=${MONITOR_ID}&incidentTemplateId=${TEMPLATE_ID}`,
    ]);
  });
});

describe("a host's Incidents tab", () => {
  test("Declare Incident opens the create page with the host", async () => {
    await renderTable(<IncidentsTable createFrom={host} />);
    await press("Declare Incident");

    expect(navigatedTo()).toEqual([`${INCIDENT_CREATE}?hostId=${HOST_ID}`]);
  });
});

describe("the project's incidents list", () => {
  test("Declare Incident opens the create page with nothing picked", async () => {
    await renderTable(<IncidentsTable />);
    await press("Declare Incident");

    expect(navigatedTo()).toEqual([INCIDENT_CREATE]);
  });

  test("Create from Template opens it with the template only", async () => {
    await renderTable(<IncidentsTable />);
    await createFromTemplate("Checkout outage");

    expect(navigatedTo()).toEqual([
      `${INCIDENT_CREATE}?incidentTemplateId=${TEMPLATE_ID}`,
    ]);
  });

  test("a record an incident cannot name adds nothing", async () => {
    await renderTable(
      <IncidentsTable
        createFrom={{
          kind: CreateFromRecordKind.NetworkSite,
          id: new ObjectID(NETWORK_SITE_ID),
        }}
      />,
    );
    await press("Declare Incident");

    expect(navigatedTo()).toEqual([INCIDENT_CREATE]);
  });
});

describe("a monitor's Alerts tab", () => {
  test("Create Alert opens the create page with the monitor", async () => {
    await renderTable(<AlertsTable createFrom={monitor} />);
    await press("Create Alert");

    expect(navigatedTo()).toEqual([`${ALERT_CREATE}?monitorId=${MONITOR_ID}`]);
  });

  test("the list draws no create form of its own: it hands its table no create values", async () => {
    await renderTable(<AlertsTable createFrom={monitor} />);

    const props: Record<string, unknown> = modelTableMock.mock.calls[
      modelTableMock.mock.calls.length - 1
    ]![0] as Record<string, unknown>;

    expect(props["isCreateable"]).toBe(false);
    expect(props["createInitialValues"]).toBeUndefined();
    expect(props["showCreateForm"]).toBeUndefined();
  });
});

describe("the project's alerts list", () => {
  test("Create Alert opens the create page with nothing picked", async () => {
    await renderTable(<AlertsTable />);
    await press("Create Alert");

    expect(navigatedTo()).toEqual([ALERT_CREATE]);
  });
});

describe("a host's Scheduled Maintenance tab", () => {
  test("Create Scheduled Maintenance Event opens the create page with the host", async () => {
    await renderTable(<ScheduledMaintenancesTable createFrom={host} />);
    await press("Create Scheduled Maintenance Event");

    expect(navigatedTo()).toEqual([`${MAINTENANCE_CREATE}?hostId=${HOST_ID}`]);
  });

  test("Create from Template opens it with the host and the template", async () => {
    await renderTable(<ScheduledMaintenancesTable createFrom={host} />);
    await createFromTemplate("Weekly patching");

    expect(navigatedTo()).toEqual([
      `${MAINTENANCE_CREATE}?hostId=${HOST_ID}&scheduledMaintenanceTemplateId=${TEMPLATE_ID}`,
    ]);
  });
});

describe("a network site's Scheduled Maintenance tab", () => {
  test("Create Scheduled Maintenance Event opens the create page with the site", async () => {
    await renderTable(
      <ScheduledMaintenancesTable
        createFrom={{
          kind: CreateFromRecordKind.NetworkSite,
          id: new ObjectID(NETWORK_SITE_ID),
        }}
      />,
    );
    await press("Create Scheduled Maintenance Event");

    expect(navigatedTo()).toEqual([
      `${MAINTENANCE_CREATE}?networkSiteId=${NETWORK_SITE_ID}`,
    ]);
  });
});

describe("the project's maintenance list", () => {
  test("both buttons open the create page as they always did", async () => {
    await renderTable(<ScheduledMaintenancesTable />);
    await press("Create Scheduled Maintenance Event");
    await createFromTemplate("Weekly patching");

    expect(navigatedTo()).toEqual([
      MAINTENANCE_CREATE,
      `${MAINTENANCE_CREATE}?scheduledMaintenanceTemplateId=${TEMPLATE_ID}`,
    ]);
  });
});
