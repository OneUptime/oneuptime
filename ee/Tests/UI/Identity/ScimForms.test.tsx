import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * Adding a SCIM connection, for a project and for a status page.
 *
 * First through the REAL ModelForm, with only the network stubbed: the form
 * is one page that asks for the name (and, in a project, starts Default
 * Teams on the members team), and saves provisioning and deprovisioning on
 * and push groups off - sent as such, not left out for the server to fill
 * in. Their switches start where their columns do, so turning one off
 * saves it off: the unticked path the old checkboxes got wrong (an untouched
 * checkbox was left out of the request, and the server stored its column's
 * default, on, whatever the form showed).
 *
 * Then the two pages, with the table a stand-in that records its props: the
 * page hands the table the builder's fields and no steps, a project's
 * connection starts on the members team, push groups drop the hidden teams,
 * and the dialog with the SCIM URLs and the bearer token opens as soon as a
 * connection is saved.
 */

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectOwner"] };
      },
    },
  };
});

type MockTableProps = Record<string, unknown>;

// The last props each stand-in table was rendered with, by table id.
const mockTables: Record<string, MockTableProps> = {};

jest.mock("Common/UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: MockTableProps): ReactElement => {
      mockTables[String(props["id"])] = props;

      return <div data-testid={`model-table-${String(props["id"])}`} />;
    },
  };
});

jest.mock("Common/UI/Components/Tabs/Tabs", () => {
  return {
    __esModule: true,
    default: (props: {
      tabs: Array<{ name: string; children: ReactNode }>;
    }): ReactElement => {
      return (
        <div>
          {props.tabs.map((tab: { name: string; children: ReactNode }) => {
            return <section key={tab.name}>{tab.children}</section>;
          })}
        </div>
      );
    },
  };
});

jest.mock(
  "../../../Dashboard/Identity/Components/SCIMLogs/ProjectSCIMLogsTable",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="project-scim-logs" />;
      },
    };
  },
);

jest.mock(
  "../../../Dashboard/Identity/Components/SCIMLogs/StatusPageSCIMLogsTable",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="status-page-scim-logs" />;
      },
    };
  },
);

// A valid license: the configuration can be changed.
jest.mock(
  "../../../Dashboard/Identity/License/UseEnterpriseLicenseMode",
  () => {
    return {
      __esModule: true,
      default: (): string => {
        return "editable";
      },
    };
  },
);

/*
 * The team a project's new connection starts on (the Dashboard's
 * Utils/DefaultInviteTeam, looked up when Settings > SCIM opens). Its own
 * suite tests the lookup.
 */
const mockDefaultTeam: {
  team: { id: string; name: string } | null;
  lookups: number;
} = { team: null, lookups: 0 };

jest.mock("@oneuptime/dashboard/Utils/DefaultInviteTeam", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "@oneuptime/dashboard/Utils/DefaultInviteTeam",
  );

  return {
    ...actual,
    findDefaultInviteTeam: async (): Promise<{
      id: string;
      name: string;
    } | null> => {
      mockDefaultTeam.lookups++;
      return mockDefaultTeam.team;
    },
  };
});

import ProjectSCIMPage from "../../../Dashboard/Identity/Pages/Settings/SCIM";
import StatusPageSCIMPage from "../../../Dashboard/Identity/Pages/StatusPages/SCIM";
import {
  getProjectScimFormFields,
  getStatusPageScimFormFields,
} from "../../../Dashboard/Identity/ScimFormFields";
import PageComponentProps from "@oneuptime/dashboard/Pages/PageComponentProps";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import Team from "Common/Models/DatabaseModels/Team";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Field from "Common/UI/Components/Forms/Types/Field";
import ModelForm, { FormType } from "Common/UI/Components/Forms/ModelForm";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalType } from "Common/UI/Components/ModelTable/BaseModelTable";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const CONNECTION_ID: string = "33333333-3333-4333-8333-333333333333";
const MEMBERS_TEAM_ID: string = "00000000-0000-4000-8000-0000000000a1";
const OWNERS_TEAM_ID: string = "00000000-0000-4000-8000-0000000000a2";
const BEARER_TOKEN: string = "4f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e";

const MORE_FIELDS_SUMMARY: string =
  "People added in your identity provider join the default teams, and people removed there leave them.";
const STATUS_PAGE_MORE_FIELDS_SUMMARY: string =
  "People added in your identity provider can sign in to this status page, and people removed there lose access.";

let createOrUpdate: jest.SpyInstance;
let recordToEdit: JSONObject = {};

const makeTeam: (id: string, name: string) => Team = (
  id: string,
  name: string,
): Team => {
  const team: Team = new Team();
  team._id = id;
  team.name = name;
  return team;
};

beforeEach(() => {
  mockDefaultTeam.team = null;
  mockDefaultTeam.lookups = 0;

  for (const key of Object.keys(mockTables)) {
    delete mockTables[key];
  }

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    return { ...recordToEdit };
  }) as never);
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (data: {
    modelType: { new (): unknown };
  }) => {
    if (data.modelType === Team) {
      const teams: Array<Team> = [
        makeTeam(MEMBERS_TEAM_ID, "Members"),
        makeTeam(OWNERS_TEAM_ID, "Owners"),
      ];

      return { data: teams, count: teams.length, skip: 0, limit: 10 };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  }) as never);
  createOrUpdate = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation((async (data: { model: BaseModel }) => {
      return { data: data.model, miscData: {} };
    }) as never);
});

afterEach(() => {
  cleanup();
  recordToEdit = {};
  jest.restoreAllMocks();
});

/*
 * What the form sends: the model it built, as the request body carries it
 * (BaseModel.toJSON drops what is undefined, as the request does).
 */
const sentBody: <TModel extends BaseModel>(modelType: {
  new (): TModel;
}) => JSONObject = <TModel extends BaseModel>(modelType: {
  new (): TModel;
}): JSONObject => {
  expect(createOrUpdate).toHaveBeenCalledTimes(1);

  const model: BaseModel = (
    createOrUpdate.mock.calls[0]![0] as { model: BaseModel }
  ).model;

  return BaseModel.toJSONObject(model, modelType);
};

const renderForm: <TModel extends BaseModel>(data: {
  modelType: { new (): TModel };
  fields: Array<Field<TModel>>;
  formType: FormType;
  initialValues?: FormValues<TModel> | undefined;
}) => Promise<void> = async <TModel extends BaseModel>(data: {
  modelType: { new (): TModel };
  fields: Array<Field<TModel>>;
  formType: FormType;
  initialValues?: FormValues<TModel> | undefined;
}): Promise<void> => {
  await act(async () => {
    render(
      <ModelForm<TModel>
        modelType={data.modelType}
        id="scim-form"
        name="Settings > Project SCIM"
        fields={data.fields}
        formType={data.formType}
        modelIdToEdit={
          data.formType === FormType.Update
            ? new ObjectID(CONNECTION_ID)
            : undefined
        }
        initialValues={data.initialValues}
        submitButtonText={
          data.formType === FormType.Update ? "Save Changes" : "Create SCIM"
        }
        onSuccess={() => {
          // Not asserted on.
        }}
        disableAutofocus={true}
      />,
    );
  });

  await screen.findByPlaceholderText(/Okta SCIM/);
  await act(async () => {});
};

const typeName: (name: string) => Promise<void> = async (
  name: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText(/Okta SCIM/), {
      target: { value: name },
    });
  });
};

const toggleMoreFields: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "More fields" }));
  });
};

// Every name the folded More fields header lists, set or not.
const listedNames: () => Array<string> = (): Array<string> => {
  return screen
    .queryAllByTestId("folded-section-item")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
};

// The chips of the set ones: "Auto Deprovision Users: Off".
const setChips: () => Array<string> = (): Array<string> => {
  return screen
    .queryAllByTestId("folded-section-item")
    .filter((item: HTMLElement): boolean => {
      return item.getAttribute("data-item-set") === "true";
    })
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
};

const flip: (name: string) => Promise<void> = async (
  name: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("switch", { name }));
  });
};

const submit: (name: string) => Promise<void> = async (
  name: string,
): Promise<void> => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });

  await waitFor(() => {
    expect(createOrUpdate).toHaveBeenCalledTimes(1);
  });
};

const teamIdsOf: (body: JSONObject) => Array<string> = (
  body: JSONObject,
): Array<string> => {
  return ((body["teams"] as Array<JSONObject> | undefined) || []).map(
    (team: JSONObject): string => {
      return String(team["_id"]);
    },
  );
};

describe("adding a project's SCIM connection", () => {
  const WITH_MEMBERS: FormValues<ProjectSCIM> = {
    teams: [MEMBERS_TEAM_ID],
  } as unknown as FormValues<ProjectSCIM>;

  test("is one page: the name, the default teams on the members team, and More fields folded with what it does", async () => {
    await renderForm({
      modelType: ProjectSCIM,
      fields: getProjectScimFormFields(),
      formType: FormType.Create,
      initialValues: WITH_MEMBERS,
    });

    expect(
      screen.queryByRole("navigation", { name: "Progress" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Name")).toBeVisible();
    expect(screen.getByText("Default Teams")).toBeVisible();
    expect(await screen.findByText("Members")).toBeInTheDocument();
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      MORE_FIELDS_SUMMARY,
    );
    expect(screen.queryByText("Configured")).not.toBeInTheDocument();

    // Folded, its header names what it holds, none of it set.
    expect(listedNames()).toEqual([
      "Auto Provision Users",
      "Auto Deprovision Users",
      "Enable Push Groups",
      "Description",
    ]);
    expect(setChips()).toEqual([]);

    // Drawn, so their values are kept and sent, but not shown.
    expect(
      screen.getByRole("switch", {
        name: "Auto Provision Users",
        hidden: true,
      }),
    ).not.toBeVisible();

    await toggleMoreFields();

    // The switches start where their columns do.
    expect(
      screen.getByRole("switch", { name: "Auto Provision Users" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("switch", { name: "Auto Deprovision Users" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("switch", { name: "Enable Push Groups" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("with only a name, saves provisioning and deprovisioning on and push groups off - sent, not left out", async () => {
    await renderForm({
      modelType: ProjectSCIM,
      fields: getProjectScimFormFields(),
      formType: FormType.Create,
      initialValues: WITH_MEMBERS,
    });

    await typeName("Okta SCIM");
    await submit("Create SCIM");

    const body: JSONObject = sentBody(ProjectSCIM);

    expect({
      name: body["name"],
      autoProvisionUsers: body["autoProvisionUsers"],
      autoDeprovisionUsers: body["autoDeprovisionUsers"],
      enablePushGroups: body["enablePushGroups"],
      description: body["description"],
    }).toEqual({
      name: "Okta SCIM",
      autoProvisionUsers: true,
      autoDeprovisionUsers: true,
      enablePushGroups: false,
      description: undefined,
    });
    expect(teamIdsOf(body)).toEqual([MEMBERS_TEAM_ID]);
  });

  test("a switch turned off is saved off: the unticked path", async () => {
    await renderForm({
      modelType: ProjectSCIM,
      fields: getProjectScimFormFields(),
      formType: FormType.Create,
      initialValues: WITH_MEMBERS,
    });

    await typeName("Okta SCIM");
    await toggleMoreFields();
    await flip("Auto Provision Users");
    await flip("Auto Deprovision Users");

    expect(
      screen.getByRole("switch", { name: "Auto Provision Users" }),
    ).toHaveAttribute("aria-checked", "false");

    // Folded again, it shows what is set instead of what the defaults do.
    await toggleMoreFields();

    expect(setChips()).toEqual([
      "Auto Provision Users: Off",
      "Auto Deprovision Users: Off",
    ]);
    expect(screen.queryByText("Configured")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("collapsible-section-summary"),
    ).not.toBeInTheDocument();

    await submit("Create SCIM");

    const body: JSONObject = sentBody(ProjectSCIM);

    expect(body["autoProvisionUsers"]).toBe(false);
    expect(body["autoDeprovisionUsers"]).toBe(false);
    expect(body["enablePushGroups"]).toBe(false);
  });

  test("push groups on: Default Teams goes away, and push groups are saved on", async () => {
    await renderForm({
      modelType: ProjectSCIM,
      fields: getProjectScimFormFields(),
      formType: FormType.Create,
      initialValues: WITH_MEMBERS,
    });

    await typeName("Okta SCIM");
    await toggleMoreFields();
    await flip("Enable Push Groups");

    await waitFor(() => {
      expect(screen.queryByText("Default Teams")).not.toBeInTheDocument();
    });

    await submit("Create SCIM");

    const body: JSONObject = sentBody(ProjectSCIM);

    expect(body["enablePushGroups"]).toBe(true);
    expect(body["autoProvisionUsers"]).toBe(true);
  });

  test("without a team to start on, it can still be saved: Default Teams is optional", async () => {
    await renderForm({
      modelType: ProjectSCIM,
      fields: getProjectScimFormFields(),
      formType: FormType.Create,
    });

    await typeName("Okta SCIM");
    await submit("Create SCIM");

    expect(teamIdsOf(sentBody(ProjectSCIM))).toEqual([]);
  });

  test("an existing connection with deprovisioning off keeps it off, and More fields shows it", async () => {
    recordToEdit = {
      _id: CONNECTION_ID,
      name: "Okta SCIM",
      autoProvisionUsers: true,
      autoDeprovisionUsers: false,
      enablePushGroups: false,
      teams: [{ _id: MEMBERS_TEAM_ID, name: "Members" }],
    };

    await renderForm({
      modelType: ProjectSCIM,
      fields: getProjectScimFormFields(),
      formType: FormType.Update,
    });

    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText(/Okta SCIM/) as HTMLInputElement).value,
      ).toBe("Okta SCIM");
    });

    // Only what differs from its column's default: provisioning is on, as a connection starts.
    await waitFor(() => {
      expect(setChips()).toEqual(["Auto Deprovision Users: Off"]);
    });
    expect(screen.queryByText("Configured")).not.toBeInTheDocument();

    await typeName("Okta SCIM (EU)");
    await submit("Save Changes");

    const model: ProjectSCIM = (
      createOrUpdate.mock.calls[0]![0] as { model: ProjectSCIM }
    ).model;

    expect(model.name).toBe("Okta SCIM (EU)");
    expect(model.autoDeprovisionUsers).toBe(false);
    expect(model.autoProvisionUsers).toBe(true);
  });
});

describe("adding a status page's SCIM connection", () => {
  test("is one page: the name, and More fields folded with what it does", async () => {
    await renderForm({
      modelType: StatusPageSCIM,
      fields: getStatusPageScimFormFields(),
      formType: FormType.Create,
    });

    expect(
      screen.queryByRole("navigation", { name: "Progress" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Default Teams")).not.toBeInTheDocument();
    expect(screen.queryByText("Enable Push Groups")).not.toBeInTheDocument();
    expect(screen.getByTestId("collapsible-section-summary")).toHaveTextContent(
      STATUS_PAGE_MORE_FIELDS_SUMMARY,
    );
  });

  test("with only a name, saves provisioning and deprovisioning on", async () => {
    await renderForm({
      modelType: StatusPageSCIM,
      fields: getStatusPageScimFormFields(),
      formType: FormType.Create,
    });

    await typeName("Okta SCIM for Status Page");
    await submit("Create SCIM");

    const body: JSONObject = sentBody(StatusPageSCIM);

    expect([
      body["name"],
      body["autoProvisionUsers"],
      body["autoDeprovisionUsers"],
    ]).toEqual(["Okta SCIM for Status Page", true, true]);
  });

  test("deprovisioning turned off is saved off", async () => {
    await renderForm({
      modelType: StatusPageSCIM,
      fields: getStatusPageScimFormFields(),
      formType: FormType.Create,
    });

    await typeName("Okta SCIM for Status Page");
    await toggleMoreFields();
    await flip("Auto Deprovision Users");
    await submit("Create SCIM");

    const body: JSONObject = sentBody(StatusPageSCIM);

    expect(body["autoDeprovisionUsers"]).toBe(false);
    expect(body["autoProvisionUsers"]).toBe(true);
  });
});

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID.toString()}/settings/scim`),
  currentProject: null,
  hasPaymentMethod: true,
};

const renderPage: (data: {
  Page: FunctionComponent<PageComponentProps>;
  path: string;
}) => Promise<void> = async (data: {
  Page: FunctionComponent<PageComponentProps>;
  path: string;
}): Promise<void> => {
  window.history.pushState({}, "", data.path);
  Navigation.setLocation(window.location as unknown as never);

  await act(async () => {
    render(<data.Page {...PAGE_PROPS} />);
  });

  await act(async () => {
    await Promise.resolve();
  });
};

const keysOf: (fields: unknown) => Array<string> = (
  fields: unknown,
): Array<string> => {
  return ((fields as Array<{ field: Record<string, unknown> }>) || []).map(
    (field: { field: Record<string, unknown> }): string => {
      return Object.keys(field.field)[0] || "";
    },
  );
};

type OnCreateSuccess = (
  item: BaseModel,
  modalType?: ModalType,
) => Promise<BaseModel>;

describe("the Settings > SCIM page", () => {
  const PATH: string = `/dashboard/${PROJECT_ID.toString()}/settings/scim`;

  test("hands the table the one-page form, starting on the members team", async () => {
    mockDefaultTeam.team = { id: MEMBERS_TEAM_ID, name: "Members" };

    await renderPage({ Page: ProjectSCIMPage, path: PATH });

    await waitFor(() => {
      expect(mockTables["scim-table"]?.["createInitialValues"]).toEqual({
        teams: [MEMBERS_TEAM_ID],
      });
    });

    const table: MockTableProps = mockTables["scim-table"]!;

    expect(table["formSteps"]).toBeUndefined();
    expect(keysOf(table["formFields"])).toEqual([
      "name",
      "teams",
      "autoProvisionUsers",
      "autoDeprovisionUsers",
      "enablePushGroups",
      "description",
    ]);
    expect(mockDefaultTeam.lookups).toBe(1);
  });

  test("with no team to start on, the form starts with nothing picked", async () => {
    await renderPage({ Page: ProjectSCIMPage, path: PATH });

    expect(mockDefaultTeam.lookups).toBe(1);
    expect(mockTables["scim-table"]?.["createInitialValues"]).toBeUndefined();
  });

  test("a connection saved with push groups on keeps no teams; one without keeps them", async () => {
    await renderPage({ Page: ProjectSCIMPage, path: PATH });

    const onBeforeCreate: (item: ProjectSCIM) => Promise<ProjectSCIM> =
      mockTables["scim-table"]!["onBeforeCreate"] as (
        item: ProjectSCIM,
      ) => Promise<ProjectSCIM>;

    const withPushGroups: ProjectSCIM = new ProjectSCIM();
    withPushGroups.enablePushGroups = true;
    withPushGroups.teams = [makeTeam(MEMBERS_TEAM_ID, "Members")];

    expect((await onBeforeCreate(withPushGroups)).teams).toBeUndefined();

    const withoutPushGroups: ProjectSCIM = new ProjectSCIM();
    withoutPushGroups.enablePushGroups = false;
    withoutPushGroups.teams = [makeTeam(MEMBERS_TEAM_ID, "Members")];

    expect(
      (await onBeforeCreate(withoutPushGroups)).teams?.map((team: Team) => {
        return team._id;
      }),
    ).toEqual([MEMBERS_TEAM_ID]);
  });

  test("opens the SCIM URLs and the bearer token as soon as a connection is saved", async () => {
    await renderPage({ Page: ProjectSCIMPage, path: PATH });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();

    const created: ProjectSCIM = new ProjectSCIM();
    created._id = CONNECTION_ID;
    created.name = "Okta SCIM";
    created.bearerToken = BEARER_TOKEN;

    await act(async () => {
      await (mockTables["scim-table"]!["onCreateSuccess"] as OnCreateSuccess)(
        created,
        ModalType.Create,
      );
    });

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      "SCIM Configuration URLs",
    );
    expect(modal).toHaveTextContent(`/scim/v2/${CONNECTION_ID}`);
    expect(modal).toHaveTextContent(`/scim/v2/${CONNECTION_ID}/Users`);

    fireEvent.click(within(modal).getByText("Click to reveal"));

    expect(within(modal).getByRole("revealed-text")).toHaveTextContent(
      BEARER_TOKEN,
    );
  });

  test("saving an edit opens nothing", async () => {
    await renderPage({ Page: ProjectSCIMPage, path: PATH });

    const edited: ProjectSCIM = new ProjectSCIM();
    edited._id = CONNECTION_ID;

    await act(async () => {
      await (mockTables["scim-table"]!["onCreateSuccess"] as OnCreateSuccess)(
        edited,
        ModalType.Edit,
      );
    });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });
});

describe("the status page > SCIM page", () => {
  const PATH: string = `/dashboard/${PROJECT_ID.toString()}/status-pages/${STATUS_PAGE_ID}/scim`;

  test("hands the table the one-page form, with no teams and nothing looked up", async () => {
    mockDefaultTeam.team = { id: MEMBERS_TEAM_ID, name: "Members" };

    await renderPage({ Page: StatusPageSCIMPage, path: PATH });

    const table: MockTableProps = mockTables["status-page-scim-table"]!;

    expect(table["formSteps"]).toBeUndefined();
    expect(table["createInitialValues"]).toBeUndefined();
    expect(keysOf(table["formFields"])).toEqual([
      "name",
      "autoProvisionUsers",
      "autoDeprovisionUsers",
      "description",
    ]);
    expect(mockDefaultTeam.lookups).toBe(0);
  });

  test("a new connection is made on this status page", async () => {
    await renderPage({ Page: StatusPageSCIMPage, path: PATH });

    const onBeforeCreate: (item: StatusPageSCIM) => Promise<StatusPageSCIM> =
      mockTables["status-page-scim-table"]!["onBeforeCreate"] as (
        item: StatusPageSCIM,
      ) => Promise<StatusPageSCIM>;

    const created: StatusPageSCIM = await onBeforeCreate(new StatusPageSCIM());

    expect(created.statusPageId?.toString()).toBe(STATUS_PAGE_ID);
  });

  test("opens the SCIM URLs and the bearer token as soon as a connection is saved", async () => {
    await renderPage({ Page: StatusPageSCIMPage, path: PATH });

    const created: StatusPageSCIM = new StatusPageSCIM();
    created._id = CONNECTION_ID;
    created.name = "Okta SCIM for Status Page";
    created.bearerToken = BEARER_TOKEN;

    await act(async () => {
      await (
        mockTables["status-page-scim-table"]![
          "onCreateSuccess"
        ] as OnCreateSuccess
      )(created, ModalType.Create);
    });

    const modal: HTMLElement = screen.getByTestId("modal");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      "SCIM URLs - Okta SCIM for Status Page",
    );
    expect(modal).toHaveTextContent(`/status-page-scim/v2/${CONNECTION_ID}`);

    fireEvent.click(within(modal).getByText("Click to reveal"));

    expect(within(modal).getByRole("revealed-text")).toHaveTextContent(
      BEARER_TOKEN,
    );
  });

  test("saving an edit opens nothing", async () => {
    await renderPage({ Page: StatusPageSCIMPage, path: PATH });

    const edited: StatusPageSCIM = new StatusPageSCIM();
    edited._id = CONNECTION_ID;

    await act(async () => {
      await (
        mockTables["status-page-scim-table"]![
          "onCreateSuccess"
        ] as OnCreateSuccess
      )(edited, ModalType.Edit);
    });

    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });
});

test("the stand-in table is handed the dialogs the way the real one names them", () => {
  expect([ModalType.Create, ModalType.Edit]).toEqual([0, 1]);
});
