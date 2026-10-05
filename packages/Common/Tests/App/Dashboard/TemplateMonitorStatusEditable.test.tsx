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
  configure,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * An incident template's and a scheduled maintenance template's Change
 * Monitor Status to, edited on the template's Affected Resources card - and
 * an incident template's Initial Incident State, on its details card - by
 * the people who may edit the template.
 *
 * Both cards ask for the relation (`changeMonitorStatusTo`,
 * `initialIncidentState`). Its update list was empty while its ID column's
 * listed the template's editors, and ModelForm leaves out a field its
 * viewer may not update: the Edit had no Change Monitor Status to (and the
 * details card no Initial Incident State) for anyone but a master admin.
 * The Affected Resources card now also shows the status it picks.
 *
 * Drawn through the template page with its real card, Edit dialog and form
 * for the card under test (the page's other cards are stand-ins), as a
 * person holding one role in the project - not a master admin. Only the
 * API, the permissions and the person are stubbed.
 */

configure({ asyncUtilTimeout: 15000 });

// The person viewing: their permissions in the project, and whether a master admin.
let mockRole: Array<string> = [];
let mockIsMasterAdmin: boolean = false;

// The one card drawn for real; the page's others are stand-ins.
let mockCardUnderTest: string = "Affected Resources";

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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return mockIsMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      count: async (): Promise<number> => {
        return 0;
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  const actual: {
    default: (props: Record<string, unknown>) => ReactElement;
  } = jest.requireActual(
    "../../../UI/Components/ModelDetail/CardModelDetail",
  ) as { default: (props: Record<string, unknown>) => ReactElement };

  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      if (props["name"] === mockCardUnderTest) {
        return React.createElement(actual.default, props);
      }

      return React.createElement("div", { "data-testid": "other-card" });
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": "model-delete" });
    },
  };
});

jest.mock("../../../UI/Components/CustomFields/CustomFieldsDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": "custom-fields" });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Owners/OwnersCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return React.createElement("div", { "data-testid": "owners-card" });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldSettingsCard",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return React.createElement("div", {
          "data-testid": "custom-field-settings-card",
        });
      },
    };
  },
);

import IncidentTemplatesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentTemplatesView";
import ScheduledMaintenanceTemplateView from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplateView";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";

const TEMPLATE_ID: string = "a1b2c3d4-0000-4000-8000-0000000000aa";

const MONITOR_ID: string = "33333333-3333-4333-8333-000000000001";
const MONITOR_NAME: string = "Checkout API";

const OPERATIONAL_STATUS_ID: string = "55555555-5555-4555-8555-000000000001";
const DEGRADED_STATUS_ID: string = "55555555-5555-4555-8555-000000000002";
const MAJOR_OUTAGE_STATUS_ID: string = "55555555-5555-4555-8555-000000000003";

const INVESTIGATING_STATE_ID: string = "66666666-6666-4666-8666-000000000001";
const IDENTIFIED_STATE_ID: string = "66666666-6666-4666-8666-000000000002";

type ModelClass = { new (): BaseModel };

interface NamedRecord {
  id: string;
  name: string;
  color?: string;
}

const RECORDS: Map<ModelClass, Array<NamedRecord>> = new Map<
  ModelClass,
  Array<NamedRecord>
>([
  [Monitor, [{ id: MONITOR_ID, name: MONITOR_NAME }]],
  [
    MonitorStatus,
    [
      { id: OPERATIONAL_STATUS_ID, name: "Operational", color: "#10b981" },
      { id: DEGRADED_STATUS_ID, name: "Degraded", color: "#f59e0b" },
      { id: MAJOR_OUTAGE_STATUS_ID, name: "Major Outage", color: "#ef4444" },
    ],
  ],
  [
    IncidentState,
    [
      { id: INVESTIGATING_STATE_ID, name: "Investigating", color: "#ef4444" },
      { id: IDENTIFIED_STATE_ID, name: "Identified", color: "#f59e0b" },
    ],
  ],
]);

function recordOf(modelType: ModelClass, record: NamedRecord): BaseModel {
  const model: BaseModel = new modelType();
  model._id = record.id;
  model.setColumnValue("name", record.name);

  if (record.color) {
    model.setColumnValue("color", new Color(record.color));
  }

  return model;
}

function namedRecord(modelType: ModelClass, id: string): BaseModel {
  const record: NamedRecord | undefined = (RECORDS.get(modelType) || []).find(
    (candidate: NamedRecord) => {
      return candidate.id === id;
    },
  );

  expect(record).toBeDefined();

  return recordOf(modelType, record!);
}

// What the template on the server holds, by the ids of its relations.
interface TemplateOnServer {
  changeMonitorStatusToId?: string | undefined;
  initialIncidentStateId?: string | undefined;
}

let templateOnServer: TemplateOnServer = {};

interface TemplatePage {
  kind: string;
  modelType: ModelClass;
  editButton: string;
  render: () => void;
  editors: Array<[string, Array<Permission>]>;
  readers: Array<[string, Array<Permission>]>;
}

function renderIncidentTemplatePage(): void {
  render(
    <MemoryRouter>
      <IncidentTemplatesView
        pageRoute={new Route("/dashboard/project/incidents/settings/templates")}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

function renderScheduledMaintenanceTemplatePage(): void {
  render(
    <MemoryRouter>
      <ScheduledMaintenanceTemplateView
        pageRoute={
          new Route(
            "/dashboard/project/scheduled-maintenance-events/settings/templates",
          )
        }
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

const PAGES: Array<TemplatePage> = [
  {
    kind: "incident template",
    modelType: IncidentTemplate,
    editButton: "Edit Incident Template",
    render: renderIncidentTemplatePage,
    editors: [
      ["a Project Admin", [Permission.ProjectAdmin]],
      ["a Project Member", [Permission.ProjectMember]],
      ["an Incident Member", [Permission.IncidentMember]],
      [
        "a role that may read and edit incident templates",
        [Permission.ReadIncidentTemplate, Permission.EditIncidentTemplate],
      ],
    ],
    readers: [
      ["a Viewer", [Permission.Viewer]],
      ["Read Incident Template", [Permission.ReadIncidentTemplate]],
    ],
  },
  {
    kind: "scheduled maintenance template",
    modelType: ScheduledMaintenanceTemplate,
    editButton: "Edit Scheduled Maintenance Template",
    render: renderScheduledMaintenanceTemplatePage,
    editors: [
      ["a Project Admin", [Permission.ProjectAdmin]],
      ["a Project Member", [Permission.ProjectMember]],
      [
        "a Scheduled Maintenance Member",
        [Permission.ScheduledMaintenanceMember],
      ],
      [
        "a role that may read and edit scheduled maintenance templates",
        [
          Permission.ReadScheduledMaintenanceTemplate,
          Permission.EditScheduledMaintenanceTemplate,
        ],
      ],
    ],
    readers: [
      ["a Viewer", [Permission.Viewer]],
      [
        "Read Scheduled Maintenance Template",
        [Permission.ReadScheduledMaintenanceTemplate],
      ],
    ],
  },
];

let currentPage: TemplatePage = PAGES[0]!;

// The template as the API answers a read of it, whatever was selected.
function storedTemplate(): BaseModel {
  const template: BaseModel = new currentPage.modelType();
  template._id = TEMPLATE_ID;
  template.setColumnValue("templateName", "Payments down");
  template.setColumnValue(
    "templateDescription",
    "When the payment provider fails",
  );
  template.setColumnValue("title", "Payments are failing");
  template.setColumnValue("monitors", [namedRecord(Monitor, MONITOR_ID)]);

  if (templateOnServer.changeMonitorStatusToId) {
    template.setColumnValue(
      "changeMonitorStatusTo",
      namedRecord(MonitorStatus, templateOnServer.changeMonitorStatusToId),
    );
  }

  if (templateOnServer.initialIncidentStateId) {
    template.setColumnValue(
      "initialIncidentState",
      namedRecord(IncidentState, templateOnServer.initialIncidentStateId),
    );
  }

  return template;
}

beforeEach(() => {
  mockRole = [Permission.ProjectAdmin];
  mockIsMasterAdmin = false;
  mockCardUnderTest = "Affected Resources";
  templateOnServer = { changeMonitorStatusToId: DEGRADED_STATUS_ID };
  PermissionGate.clearPermissionPropsCache();

  getItemMock.mockReset();
  getListMock.mockReset();
  createOrUpdateMock.mockReset();

  getItemMock.mockImplementation((async (): Promise<BaseModel> => {
    return storedTemplate();
  }) as never);

  getListMock.mockImplementation((async (...args: Array<unknown>) => {
    const { modelType, query } = args[0] as {
      modelType: ModelClass;
      query?: Record<string, unknown>;
    };
    const idFilter: unknown = query?.["_id"];
    const wanted: Array<string> | null =
      idFilter instanceof Includes
        ? (idFilter.values as Array<unknown>).map((value: unknown) => {
            return String(value);
          })
        : null;
    const data: Array<BaseModel> = (RECORDS.get(modelType) || [])
      .filter((record: NamedRecord) => {
        return !wanted || wanted.includes(record.id);
      })
      .map((record: NamedRecord): BaseModel => {
        return recordOf(modelType, record);
      });

    return { data: data, count: data.length, skip: 0, limit: 10 };
  }) as never);

  createOrUpdateMock.mockImplementation((async (...args: Array<unknown>) => {
    return { data: (args[0] as { model: BaseModel }).model };
  }) as never);

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(TEMPLATE_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(page: TemplatePage): Promise<UserEvent> {
  currentPage = page;

  await act(async () => {
    page.render();
  });

  return userEvent.setup({ delay: null });
}

async function openEdit(user: UserEvent, page: TemplatePage): Promise<void> {
  await user.click(
    await screen.findByRole("button", { name: page.editButton }),
  );
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

/*
 * The field's control, named by its label: with a value picked, the button
 * that shows it (a click opens the list); with none, the search box.
 */
async function fieldControl(label: RegExp): Promise<HTMLElement> {
  return await waitFor(() => {
    const control: HTMLElement | null =
      screen.queryByRole("button", { name: label }) ||
      screen.queryByRole("combobox", { name: label });

    expect(control).not.toBeNull();

    return control!;
  });
}

async function statusDropdown(): Promise<HTMLElement> {
  return await fieldControl(/^Change Monitor Status to/);
}

async function save(user: UserEvent): Promise<BaseModel> {
  await user.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });

  return (createOrUpdateMock.mock.calls[0]![0] as { model: BaseModel }).model;
}

function relationIdOf(model: BaseModel, relation: string): string | undefined {
  const value: unknown = model.getColumnValue(relation);

  if (!value) {
    return undefined;
  }

  return String((value as BaseModel)._id);
}

describe.each(PAGES)(
  "A $kind's Affected Resources card",
  (page: TemplatePage) => {
    test.each(page.editors)(
      "%s sees Change Monitor Status to in its Edit, holding the template's status, and saves another",
      async (_role: string, permissions: Array<Permission>) => {
        mockRole = permissions;

        const user: UserEvent = await renderPage(page);

        // The card shows the status the template picks.
        await screen.findByText("Degraded");

        await openEdit(user, page);

        const status: HTMLElement = await statusDropdown();

        expect(status).toBeInTheDocument();
        expect(
          await screen.findByRole("button", {
            name: /^Change Monitor Status to/,
          }),
        ).toHaveTextContent("Degraded");

        await pickOption(user, status, "Major Outage");

        const saved: BaseModel = await save(user);

        expect(relationIdOf(saved, "changeMonitorStatusTo")).toBe(
          MAJOR_OUTAGE_STATUS_ID,
        );
        // The rest of the card is saved as it was.
        expect(
          ((saved.getColumnValue("monitors") as Array<BaseModel>) || []).map(
            (monitor: BaseModel): string => {
              return String(monitor._id);
            },
          ),
        ).toEqual([MONITOR_ID]);
      },
    );

    test("the Edit asks for it between the monitors and the other resources", async () => {
      const user: UserEvent = await renderPage(page);

      await screen.findByText("Degraded");
      await openEdit(user, page);

      const monitors: HTMLElement = await screen.findByRole("combobox", {
        name: /^Monitors/,
      });
      const status: HTMLElement = await statusDropdown();
      const others: HTMLElement = await screen.findByRole("combobox", {
        name: /^Other Affected Resources/,
      });

      expect(
        monitors.compareDocumentPosition(status) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        status.compareDocumentPosition(others) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    test("a template with no status says its monitors keep theirs, and an editor picks one", async () => {
      templateOnServer = {};

      const user: UserEvent = await renderPage(page);

      expect(
        await screen.findByText("Monitors keep their status."),
      ).toBeInTheDocument();

      await openEdit(user, page);
      await pickOption(user, await statusDropdown(), "Degraded");

      const saved: BaseModel = await save(user);

      expect(relationIdOf(saved, "changeMonitorStatusTo")).toBe(
        DEGRADED_STATUS_ID,
      );
    });

    test("saving without touching it keeps the template's status", async () => {
      const user: UserEvent = await renderPage(page);

      await screen.findByText("Degraded");
      await openEdit(user, page);
      await statusDropdown();

      const saved: BaseModel = await save(user);

      expect(relationIdOf(saved, "changeMonitorStatusTo")).toBe(
        DEGRADED_STATUS_ID,
      );
    });

    test.each(page.readers)(
      "%s sees the status on the card, and the Edit locked",
      async (_role: string, permissions: Array<Permission>) => {
        mockRole = permissions;

        await renderPage(page);

        expect(await screen.findByText("Degraded")).toBeInTheDocument();
        expect(
          screen.getByText("Change Monitor Status to"),
        ).toBeInTheDocument();

        const edit: HTMLElement = await screen.findByRole("button", {
          name: page.editButton,
        });

        expect(edit).toBeDisabled();
        expect(
          screen.queryByRole("combobox", { name: /^Change Monitor Status to/ }),
        ).toBeNull();
      },
    );

    test("a master admin still sees and saves it", async () => {
      mockRole = [];
      mockIsMasterAdmin = true;

      const user: UserEvent = await renderPage(page);

      await screen.findByText("Degraded");
      await openEdit(user, page);
      await pickOption(user, await statusDropdown(), "Operational");

      const saved: BaseModel = await save(user);

      expect(relationIdOf(saved, "changeMonitorStatusTo")).toBe(
        OPERATIONAL_STATUS_ID,
      );
    });
  },
);

describe("An incident template's details card", () => {
  const INCIDENT_PAGE: TemplatePage = PAGES[0]!;

  beforeEach(() => {
    mockCardUnderTest = "Incident Template Details";
    templateOnServer = { initialIncidentStateId: IDENTIFIED_STATE_ID };
  });

  async function walkToIncidentDetails(user: UserEvent): Promise<void> {
    await openEdit(user, INCIDENT_PAGE);
    await screen.findByDisplayValue("Payments down");
    await user.click(screen.getByRole("button", { name: "Next", exact: true }));
    await user.click(
      await screen.findByRole("button", { name: "More fields" }),
    );
  }

  test.each(INCIDENT_PAGE.editors)(
    "%s sees Initial Incident State under More fields in its Edit, and saves another",
    async (_role: string, permissions: Array<Permission>) => {
      mockRole = permissions;

      const user: UserEvent = await renderPage(INCIDENT_PAGE);

      await walkToIncidentDetails(user);

      const state: HTMLElement = await fieldControl(/^Initial Incident State/);

      expect(state).toHaveTextContent("Identified");

      await pickOption(user, state, "Investigating");

      // The action is on the last step only.
      await user.click(
        screen.getByRole("button", { name: "Next", exact: true }),
      );

      const saved: BaseModel = await save(user);

      expect(relationIdOf(saved, "initialIncidentState")).toBe(
        INVESTIGATING_STATE_ID,
      );
    },
  );

  test("More fields names Initial Incident State while folded, for an editor", async () => {
    mockRole = [Permission.ProjectMember];

    const user: UserEvent = await renderPage(INCIDENT_PAGE);

    await openEdit(user, INCIDENT_PAGE);
    await screen.findByDisplayValue("Payments down");
    await user.click(screen.getByRole("button", { name: "Next", exact: true }));

    const header: HTMLElement = await screen.findByRole("button", {
      name: "More fields",
    });

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      listedNames().some((name: string): boolean => {
        return name.startsWith("Initial Incident State");
      }),
    ).toBe(true);
  });
});
