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
import type { Mock } from "jest-mock";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * ADMIN DASHBOARD: THE PROJECT PICKER OFFERS EVERY PROJECT.
 *
 * Users > Add to Project (the bulk action), a user's Projects > Add to
 * Project, and a global SSO or OIDC provider's Attached Projects pick a
 * project with an entity dropdown, which searches the server as the menu
 * opens and as the admin types. The browser remembers the project its user
 * last opened in the Dashboard (`last_accessed_project_id`), and the shared
 * ModelAPI names that project in every request (the `tenantid` header) - and
 * the server then lists that one project and no other. So the picker offered
 * only the project last opened in the Dashboard, and a search for any other
 * found nothing. Seen on oneuptime.com: with "Acme Demo (MCP Review)" last
 * opened, a search for "Okta OIN" found nothing, though "Okta OIN Review"
 * existed.
 *
 * A master admin works from outside every project, so everything these forms
 * read goes through AdminModelAPI, which names none - the dropdown's own
 * searches included. These drive the real forms and the real EntityDropdown;
 * only the network is stood in for, by a server that scopes a list the way the
 * real one does: a request that names a project lists that project only.
 */

jest.setTimeout(60000);

const WAIT_FOR_TIMEOUT: number = 20000;

const ACME_PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165001";
const OKTA_PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165002";
const ZETA_PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165003";

const ACME_OWNERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165011";
const ACME_MEMBERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165012";
const OKTA_OWNERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165021";
const OKTA_MEMBERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165022";
const ZETA_OWNERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165031";

const USER_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165041";
const USER_TWO_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165042";
const PROVIDER_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194165051";

/*
 * A page's own keys come back as the key; the shared components' whole
 * sentences (looked up with a defaultValue) come back as the sentence.
 */
jest.mock("react-i18next", () => {
  return {
    __esModule: true,
    useTranslation: () => {
      return {
        t: (key: string, options?: Record<string, unknown>): string => {
          if (options && typeof options["defaultValue"] === "string") {
            return options["defaultValue"] as string;
          }

          return key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

// A fixed origin for the API and for the provider pages' printed URLs.
jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const protocol: { default: { HTTPS: string } } = jest.requireActual(
    "../../../Types/API/Protocol",
  ) as { default: { HTTPS: string } };
  const url: { default: { fromString: (value: string) => unknown } } =
    jest.requireActual("../../../Types/API/URL") as {
      default: { fromString: (value: string) => unknown };
    };

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "HTTP_PROTOCOL", {
    get: (): string => {
      return protocol.default.HTTPS;
    },
  });

  Object.defineProperty(mocked, "HOST", {
    get: (): string => {
      return "oneuptime.example.com";
    },
  });

  Object.defineProperty(mocked, "IDENTITY_URL", {
    get: (): unknown => {
      return url.default.fromString("https://oneuptime.example.com/identity");
    },
  });

  return mocked;
});

type MockProps = Record<string, unknown>;

const mockTables: Array<MockProps> = [];

interface CardButton {
  title: string;
  onClick?: (() => void) | undefined;
}

/*
 * The tables, as their card buttons: a page opens its own dialog from those,
 * and a provider page's Attached Projects form is drawn from the props the
 * table was handed (see renderAttachForm).
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: MockProps): ReactElement => {
      mockTables.push(props);

      const buttons: Array<CardButton> =
        ((props["cardProps"] as MockProps | undefined)?.["buttons"] as
          | Array<CardButton>
          | undefined) || [];

      return (
        <div data-testid={`model-table-${String(props["id"])}`}>
          {buttons.map((button: CardButton) => {
            return (
              <button
                key={button.title}
                type="button"
                onClick={() => {
                  button.onClick?.();
                }}
              >
                {button.title}
              </button>
            );
          })}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="card-model-detail" />;
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <div data-testid="model-delete" />;
    },
  };
});

jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: { children?: ReactNode }): ReactElement => {
      return <div data-testid="model-page">{props.children}</div>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <nav />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <nav />;
      },
    };
  },
);

import BulkAddUsersToProjectModal, {
  BulkAddUsersToProjectSelection,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/User/BulkAddUsersToProjectModal";
import UserProjects from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/View/Projects";
import GlobalSSOView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalSSO/View";
import GlobalOIDCView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalOIDC/View";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalOIDCProject from "../../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSSOProject from "../../../Models/DatabaseModels/GlobalSsoProject";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import UserModel from "../../../Models/DatabaseModels/User";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import DashboardAPI from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";

interface ProjectFixture {
  id: string;
  name: string;
  teams: Array<{ id: string; name: string; permission: Permission }>;
}

// Every project on the instance, none of which the admin is a member of.
const PROJECTS: Array<ProjectFixture> = [
  {
    id: ACME_PROJECT_ID,
    name: "Acme Demo (MCP Review)",
    teams: [
      {
        id: ACME_OWNERS_ID,
        name: "Owners",
        permission: Permission.ProjectOwner,
      },
      {
        id: ACME_MEMBERS_ID,
        name: "Members",
        permission: Permission.ProjectMember,
      },
    ],
  },
  {
    id: OKTA_PROJECT_ID,
    name: "Okta OIN Review",
    teams: [
      {
        id: OKTA_OWNERS_ID,
        name: "Owners",
        permission: Permission.ProjectOwner,
      },
      {
        id: OKTA_MEMBERS_ID,
        name: "Members",
        permission: Permission.ProjectMember,
      },
    ],
  },
  {
    id: ZETA_PROJECT_ID,
    name: "Zeta Labs",
    teams: [
      {
        id: ZETA_OWNERS_ID,
        name: "Owners",
        permission: Permission.ProjectOwner,
      },
    ],
  },
];

const ALL_PROJECT_NAMES: Array<string> = PROJECTS.map(
  (project: ProjectFixture) => {
    return project.name;
  },
);

// One request as the server received it.
interface ServerRequest {
  method: HTTPMethod;
  path: string;
  // The project the request names, if any (the `tenantid` header).
  tenantId: string | null;
  query: JSONObject;
  body: JSONObject;
  limit: number;
}

const serverRequests: Array<ServerRequest> = [];

type ListResponseFunction = (rows: JSONArray) => HTTPResponse<JSONArray>;

const listResponse: ListResponseFunction = (
  rows: JSONArray,
): HTTPResponse<JSONArray> => {
  return new HTTPResponse<JSONArray>(
    200,
    { data: rows, count: rows.length, skip: 0, limit: rows.length },
    {},
  );
};

type IdOfFunction = (value: unknown) => string;

const idOf: IdOfFunction = (value: unknown): string => {
  return value === undefined || value === null ? "" : String(value);
};

/*
 * The projects a master admin's list request gets. A request that names a
 * project gets that project only - Project's tenant column is its own id - and
 * a search narrows by name, as the server's Search does: case-insensitive,
 * anywhere in the name.
 */
type ListProjectsFunction = (request: ServerRequest) => JSONArray;

const listProjects: ListProjectsFunction = (
  request: ServerRequest,
): JSONArray => {
  const nameQuery: unknown = request.query["name"];
  const idQuery: unknown = request.query["_id"];

  const projects: Array<Project> = PROJECTS.filter(
    (fixture: ProjectFixture) => {
      if (request.tenantId && fixture.id !== request.tenantId) {
        return false;
      }

      if (
        nameQuery instanceof Search &&
        !fixture.name
          .toLowerCase()
          .includes(nameQuery.toString().trim().toLowerCase())
      ) {
        return false;
      }

      if (
        idQuery instanceof Includes &&
        !idQuery.values.map(idOf).includes(fixture.id)
      ) {
        return false;
      }

      return true;
    },
  )
    .sort((a: ProjectFixture, b: ProjectFixture) => {
      return a.name.localeCompare(b.name);
    })
    .slice(0, request.limit)
    .map((fixture: ProjectFixture): Project => {
      const project: Project = new Project();
      project._id = fixture.id;
      project.name = fixture.name;
      return project;
    });

  return BaseModel.toJSONArray(projects, Project);
};

/*
 * A project's teams, or their permission rows. Here too a project named by
 * the request wins over the one in the query.
 */
type ListTeamsFunction = (
  request: ServerRequest,
  modelType: typeof Team | typeof TeamPermission,
) => JSONArray;

const listTeams: ListTeamsFunction = (
  request: ServerRequest,
  modelType: typeof Team | typeof TeamPermission,
): JSONArray => {
  const projectId: string =
    request.tenantId || idOf(request.query["projectId"]);

  const fixture: ProjectFixture | undefined = PROJECTS.find(
    (project: ProjectFixture) => {
      return project.id === projectId;
    },
  );

  const teams: ProjectFixture["teams"] = fixture?.teams || [];

  if (modelType === TeamPermission) {
    return BaseModel.toJSONArray(
      teams.map((team: ProjectFixture["teams"][number]): TeamPermission => {
        const row: TeamPermission = new TeamPermission();
        row._id = ObjectID.generate().toString();
        row.teamId = new ObjectID(team.id);
        row.permission = team.permission;
        row.isBlockPermission = false;
        row.scope = PermissionScope.All;
        return row;
      }),
      TeamPermission,
    );
  }

  return BaseModel.toJSONArray(
    teams.map((team: ProjectFixture["teams"][number]): Team => {
      const model: Team = new Team();
      model._id = team.id;
      model.name = team.name;
      return model;
    }),
    Team,
  );
};

interface FetchOptions {
  method: HTTPMethod;
  url: URL;
  data?: JSONObject | undefined;
  headers?: Dictionary<string> | undefined;
  params?: Dictionary<string> | undefined;
}

type AnswerFunction = (
  options: FetchOptions,
) => Promise<HTTPResponse<JSONObject | JSONArray>>;

const answer: AnswerFunction = async (
  options: FetchOptions,
): Promise<HTTPResponse<JSONObject | JSONArray>> => {
  const body: JSONObject = options.data || {};

  const request: ServerRequest = {
    method: options.method,
    path: options.url.toString(),
    tenantId: options.headers?.["tenantid"] || null,
    query: JSONFunctions.deserialize((body["query"] as JSONObject) || {}),
    body: body,
    limit: Number(options.params?.["limit"] || 0),
  };

  serverRequests.push(request);

  // Cross a task boundary, as a real request does.
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });

  if (request.path.endsWith("/project/get-list")) {
    return listResponse(listProjects(request));
  }

  if (request.path.endsWith("/team/get-list")) {
    return listResponse(listTeams(request, Team));
  }

  if (request.path.endsWith("/team-permission/get-list")) {
    return listResponse(listTeams(request, TeamPermission));
  }

  // A created membership comes back as it was sent.
  if (
    request.method === HTTPMethod.POST &&
    request.path.endsWith("/team-member")
  ) {
    return new HTTPResponse<JSONObject>(
      200,
      (body["data"] as JSONObject) || {},
      {},
    );
  }

  return listResponse([]);
};

type RequestsForFunction = (pathEnd: string) => Array<ServerRequest>;

const requestsFor: RequestsForFunction = (
  pathEnd: string,
): Array<ServerRequest> => {
  return serverRequests.filter((request: ServerRequest) => {
    return request.path.endsWith(pathEnd);
  });
};

/*
 * The admin works from outside every project: nothing a form read or wrote
 * named one, whichever project the browser last opened in the Dashboard.
 */
type ExpectNoRequestNamedAProjectFunction = () => void;

const expectNoRequestNamedAProject: ExpectNoRequestNamedAProjectFunction =
  (): void => {
    expect(requestsFor("/project/get-list").length).toBeGreaterThan(0);

    expect(
      serverRequests
        .filter((request: ServerRequest) => {
          return request.tenantId !== null;
        })
        .map((request: ServerRequest) => {
          return `${request.path} named ${request.tenantId}`;
        }),
    ).toEqual([]);
  };

type GoToFunction = (path: string) => void;

const goTo: GoToFunction = (path: string): void => {
  window.history.pushState({}, "", path);
  Navigation.setLocation(window.location as unknown as never);
};

type LastTableFunction = (id: string) => MockProps;

const lastTable: LastTableFunction = (id: string): MockProps => {
  const found: MockProps | undefined = [...mockTables]
    .reverse()
    .find((props: MockProps) => {
      return props["id"] === id;
    });

  if (!found) {
    throw new Error(`No model table ${id} was rendered.`);
  }

  return found;
};

// The project field's search box, once the form has drawn it.
type FindProjectPickerFunction = (fieldTitle: string) => Promise<HTMLElement>;

const findProjectPicker: FindProjectPickerFunction = async (
  fieldTitle: string,
): Promise<HTMLElement> => {
  return await screen.findByRole(
    "combobox",
    { name: new RegExp(`^${fieldTitle}`) },
    { timeout: WAIT_FOR_TIMEOUT },
  );
};

// The names the open menu offers, once it offers exactly these.
type ExpectOfferedFunction = (names: Array<string>) => Promise<void>;

const expectOffered: ExpectOfferedFunction = async (
  names: Array<string>,
): Promise<void> => {
  await waitFor(
    () => {
      expect(
        screen.queryAllByRole("option").map((option: HTMLElement) => {
          return option.textContent?.trim() || "";
        }),
      ).toEqual(names);
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
};

/*
 * Types a name into the picker and picks the project the server finds for
 * it: what an admin does to add someone to a project they are not in.
 */
type SearchAndPickFunction = (
  picker: HTMLElement,
  searchText: string,
  projectName: string,
) => Promise<void>;

const searchAndPick: SearchAndPickFunction = async (
  picker: HTMLElement,
  searchText: string,
  projectName: string,
): Promise<void> => {
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: searchText } });

  await expectOffered([projectName]);

  fireEvent.click(screen.getByRole("option", { name: projectName }));

  await waitFor(
    () => {
      expect(screen.getByTestId("entity-dropdown-value")).toHaveTextContent(
        projectName,
      );
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
};

// The team picker under the project has loaded its teams and picked this one.
type WaitForPickedTeamFunction = (teamName: string) => Promise<void>;

const waitForPickedTeam: WaitForPickedTeamFunction = async (
  teamName: string,
): Promise<void> => {
  await waitFor(
    () => {
      expect(screen.getByText(teamName)).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
};

interface StaticSpy {
  mockImplementation: (
    implementation: (options: FetchOptions) => Promise<unknown>,
  ) => StaticSpy;
}

beforeEach(() => {
  mockTables.length = 0;
  serverRequests.length = 0;

  localStorage.clear();
  sessionStorage.clear();

  // The Admin Dashboard is only ever used by a master admin.
  User.setIsMasterAdmin(true);

  (
    jest.spyOn(DashboardAPI, "fetch") as unknown as StaticSpy
  ).mockImplementation((options: FetchOptions): Promise<unknown> => {
    return answer(options);
  });

  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {
    return;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Users > Add to Project (bulk)", () => {
  type OnSubmitFunction = (selection: BulkAddUsersToProjectSelection) => void;

  type MakeUserFunction = (id: string) => UserModel;

  const makeUser: MakeUserFunction = (id: string): UserModel => {
    const user: UserModel = new UserModel();
    user._id = id;
    return user;
  };

  type OpenModalFunction = (
    onSubmit?: OnSubmitFunction | undefined,
  ) => Promise<HTMLElement>;

  const openModal: OpenModalFunction = async (
    onSubmit?: OnSubmitFunction | undefined,
  ): Promise<HTMLElement> => {
    goTo("/admin/users");

    render(
      <BulkAddUsersToProjectModal
        users={[makeUser(USER_ID), makeUser(USER_TWO_ID)]}
        onClose={jest.fn()}
        onSubmit={onSubmit || jest.fn()}
      />,
    );

    return await findProjectPicker("pages.users.bulkAddToProjectFieldProject");
  };

  test.each([
    { lastOpened: "Acme Demo (MCP Review)", projectId: ACME_PROJECT_ID },
    { lastOpened: "Okta OIN Review", projectId: OKTA_PROJECT_ID },
    { lastOpened: "no project", projectId: null },
  ])(
    "offers every project, with $lastOpened last opened in the Dashboard",
    async (data: { lastOpened: string; projectId: string | null }) => {
      if (data.projectId) {
        ProjectUtil.setLastAccessedProjectId(data.projectId);
      }

      const picker: HTMLElement = await openModal();

      fireEvent.focus(picker);

      await expectOffered(ALL_PROJECT_NAMES);

      expectNoRequestNamedAProject();
    },
  );

  test("finds a project other than the one last opened by its name, and adds the users to it", async () => {
    ProjectUtil.setLastAccessedProjectId(ACME_PROJECT_ID);

    const onSubmit: Mock<OnSubmitFunction> = jest.fn<OnSubmitFunction>();

    const picker: HTMLElement = await openModal(onSubmit);

    await searchAndPick(picker, "Okta OIN", "Okta OIN Review");

    // The team picker under it starts on the picked project's members team.
    await waitForPickedTeam("Members");

    expect(
      requestsFor("/team/get-list").map((request: ServerRequest) => {
        return idOf(request.query["projectId"]);
      }),
    ).toContain(OKTA_PROJECT_ID);

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const selection: BulkAddUsersToProjectSelection =
      onSubmit.mock.calls[0]![0];

    expect(selection.projectId.toString()).toBe(OKTA_PROJECT_ID);
    expect(selection.teamId.toString()).toBe(OKTA_MEMBERS_ID);
    expect(selection.hasAcceptedInvitation).toBe(false);

    expectNoRequestNamedAProject();
  });
});

describe("Users > a user's Projects > Add to Project", () => {
  type OpenFormFunction = () => Promise<HTMLElement>;

  const openForm: OpenFormFunction = async (): Promise<HTMLElement> => {
    goTo(`/admin/users/${USER_ID}/projects`);

    render(<UserProjects />);

    fireEvent.click(
      screen.getByRole("button", { name: "pages.userProjects.addToProject" }),
    );

    return await findProjectPicker("pages.userProjects.fieldProject");
  };

  test("finds a project other than the one last opened by its name, and adds the user to it", async () => {
    ProjectUtil.setLastAccessedProjectId(ACME_PROJECT_ID);

    const picker: HTMLElement = await openForm();

    await searchAndPick(picker, "Okta OIN", "Okta OIN Review");

    await waitForPickedTeam("Members");

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(requestsFor("/team-member")).toHaveLength(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const created: TeamMember = BaseModel.fromJSON(
      requestsFor("/team-member")[0]!.body["data"] as JSONObject,
      TeamMember,
    ) as TeamMember;

    expect(created.userId?.toString()).toBe(USER_ID);
    expect(created.projectId?.toString()).toBe(OKTA_PROJECT_ID);
    expect(created.teamId?.toString() || created.team?._id?.toString()).toBe(
      OKTA_MEMBERS_ID,
    );

    expectNoRequestNamedAProject();
  });

  test("the search behind the menu looks across every project, with a project last opened in the Dashboard", async () => {
    ProjectUtil.setLastAccessedProjectId(OKTA_PROJECT_ID);

    const picker: HTMLElement = await openForm();

    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "Zeta" } });

    await expectOffered(["Zeta Labs"]);

    // The search went out, and like everything else it named no project.
    await waitFor(
      () => {
        expect(
          requestsFor("/project/get-list").some((request: ServerRequest) => {
            return request.query["name"] instanceof Search;
          }),
        ).toBe(true);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expectNoRequestNamedAProject();
  });
});

/*
 * A provider's Attached Projects form, drawn the way ModelTable draws its
 * Create dialog: a ModelFormModal with the table's API and fields.
 */
type RenderAttachFormFunction = (
  table: MockProps,
  modelType: { new (): BaseModel },
) => void;

const renderAttachForm: RenderAttachFormFunction = (
  table: MockProps,
  modelType: { new (): BaseModel },
): void => {
  render(
    <ModelFormModal<BaseModel>
      modelType={modelType}
      modelAPI={table["modelAPI"] as typeof AdminModelAPI}
      title="Attach a project"
      submitButtonText="Attach"
      formProps={{
        name: "attach-project",
        id: "attach-project-form",
        modelType: modelType,
        modelAPI: table["modelAPI"] as typeof AdminModelAPI,
        fields: table["formFields"] as never,
        steps: table["formSteps"] as never,
        formType: FormType.Create,
      }}
    />,
  );
};

describe.each([
  {
    name: "Global SSO",
    path: `/admin/settings/global-sso/${PROVIDER_ID}`,
    Page: GlobalSSOView,
    table: "global-sso-project-table",
    modelType: GlobalSSOProject as { new (): BaseModel },
  },
  {
    name: "Global OIDC",
    path: `/admin/settings/global-oidc/${PROVIDER_ID}`,
    Page: GlobalOIDCView,
    table: "global-oidc-project-table",
    modelType: GlobalOIDCProject as { new (): BaseModel },
  },
])(
  "$name > Attached Projects",
  (provider: {
    name: string;
    path: string;
    Page: FunctionComponent;
    table: string;
    modelType: { new (): BaseModel };
  }) => {
    test("finds a project other than the one last opened by its name", async () => {
      ProjectUtil.setLastAccessedProjectId(ACME_PROJECT_ID);

      goTo(provider.path);

      const page: ReturnType<typeof render> = render(<provider.Page />);
      const table: MockProps = lastTable(provider.table);

      page.unmount();

      renderAttachForm(table, provider.modelType);

      const picker: HTMLElement = await findProjectPicker("Project");

      await searchAndPick(picker, "Okta OIN", "Okta OIN Review");

      await waitForPickedTeam("Members");

      expectNoRequestNamedAProject();
    });
  },
);
