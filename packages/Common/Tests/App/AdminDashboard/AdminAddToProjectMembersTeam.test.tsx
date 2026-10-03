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
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

/*
 * ADMIN DASHBOARD: ADDING SOMEONE TO A PROJECT STARTS ON ITS MEMBERS TEAM,
 * IN ONE STEP - on the real pages and the real form stack (ModelFormModal,
 * ModelForm, BasicForm, the picker), with only the network, the tables and
 * the page chrome stood in for.
 *
 *   - Projects > Users > Invite User is one page, as the Dashboard's is: the
 *     email, the team - the project's members team picked to start with,
 *     which its description names - and the auto-accept box, so Invite
 *     needs only the email. With no members team it opens with no team.
 *   - Users > Projects > Add to Project is one page: the project, its team
 *     (its members team as soon as the project is picked) and the auto-accept
 *     box. One press adds the user to that team.
 *   - A global SSO or OIDC provider's Attached Projects form is one page: the
 *     project, then its teams, starting on its members team.
 *
 * A master admin may hand on any team, so the members team is offered
 * whatever the signed-in browser's own project permissions say.
 */

jest.setTimeout(60000);

const WAIT_FOR_TIMEOUT: number = 20000;

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164001";
const PLAIN_PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164002";
const USER_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164003";
const PROVIDER_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164004";

const OWNERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164011";
const MEMBERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164012";
const SUPPORT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164013";
const PLAIN_OWNERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164021";
const PLAIN_AUDITORS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194164022";

interface TranslationCall {
  key: string;
  options: Record<string, unknown> | undefined;
}

const mockTranslationCalls: Array<TranslationCall> = [];

/*
 * A page's own keys come back as the key; the shared components' whole
 * sentences (looked up with a defaultValue) come back as the sentence. A key
 * with a team name in it says so, so a test can read which team it named.
 */
jest.mock("react-i18next", () => {
  return {
    __esModule: true,
    useTranslation: () => {
      return {
        t: (key: string, options?: Record<string, unknown>): string => {
          mockTranslationCalls.push({ key, options });

          if (options && typeof options["defaultValue"] === "string") {
            return options["defaultValue"] as string;
          }

          if (options && "teamName" in options) {
            return `${key} teamName=${String(options["teamName"])}`;
          }

          return key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

// A fixed origin for the provider pages' printed URLs.
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

// Every invite form checks whether the email has an account; this one has.
jest.mock("../../../UI/Utils/UserEmailRegistrationStatus", () => {
  return {
    __esModule: true,
    useUserEmailRegistrationStatus: () => {
      return {
        isEmailRegistered: true,
        checkEmail: (): void => {},
      };
    },
  };
});

type MockProps = Record<string, unknown>;

const mockTables: Array<MockProps> = [];

interface CardButton {
  title: string;
  isLoading?: boolean | undefined;
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
                data-loading={String(Boolean(button.isLoading))}
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
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/SideMenu",
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

/*
 * The project field is an entity dropdown that would search the Projects
 * endpoint; here it is two buttons that pick a project the way the real one
 * reports it (the id).
 */
jest.mock("../../../UI/Components/EntityDropdown/EntityDropdown", () => {
  return {
    __esModule: true,
    default: (props: {
      onChange?: ((value: string) => void) | undefined;
    }): ReactElement => {
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              props.onChange?.(PROJECT_ID);
            }}
          >
            Choose a project
          </button>
          <button
            type="button"
            onClick={() => {
              props.onChange?.(PLAIN_PROJECT_ID);
            }}
          >
            Choose the project with no members team
          </button>
        </div>
      );
    },
  };
});

interface DropdownOptionStub {
  label: string;
  value: string;
}

/*
 * react-select stood in for: what is selected - an option, a list of them,
 * or the bare id a form field hands it - and one button per option. A
 * multi-select adds the option to what is picked, as the real one does.
 */
jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 60,
    default: (props: {
      options: Array<DropdownOptionStub>;
      value?: unknown;
      isMultiSelect?: boolean | undefined;
      onChange?: ((value: string | Array<string>) => void) | undefined;
    }): ReactElement => {
      const values: Array<unknown> = Array.isArray(props.value)
        ? props.value
        : props.value
          ? [props.value]
          : [];

      const labels: Array<string> = values.map((value: unknown) => {
        if (typeof value === "string") {
          return (
            props.options.find((option: DropdownOptionStub) => {
              return option.value === value;
            })?.label || `id:${value}`
          );
        }

        return (value as DropdownOptionStub).label;
      });

      return (
        <div>
          <p data-testid="selected-teams">{labels.join(", ") || "(none)"}</p>
          {props.options.map((option: DropdownOptionStub) => {
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  if (props.isMultiSelect) {
                    props.onChange?.([
                      ...values.map((value: unknown) => {
                        return typeof value === "string"
                          ? value
                          : (value as DropdownOptionStub).value;
                      }),
                      option.value,
                    ]);
                    return;
                  }

                  props.onChange?.(option.value);
                }}
              >
                Pick {option.label}
              </button>
            );
          })}
        </div>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI",
  () => {
    return {
      __esModule: true,
      default: {
        getList: jest.fn(),
        createOrUpdate: jest.fn(),
        getCommonHeaders: (): Record<string, string> => {
          return {};
        },
      },
    };
  },
);

import ProjectUsers from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/Users";
import UserProjects from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Users/View/Projects";
import GlobalSSOView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalSSO/View";
import GlobalOIDCView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/GlobalOIDC/View";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import GlobalOIDCProject from "../../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSSOProject from "../../../Models/DatabaseModels/GlobalSsoProject";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import Navigation from "../../../UI/Utils/Navigation";
import User from "../../../UI/Utils/User";

const mockGetList: jest.MockedFunction<any> =
  AdminModelAPI.getList as unknown as jest.MockedFunction<any>;
const mockCreateOrUpdate: jest.MockedFunction<any> =
  AdminModelAPI.createOrUpdate as unknown as jest.MockedFunction<any>;

interface TeamFixture {
  id: string;
  name: string;
  permission: Permission;
}

// A new project's teams, and a project with no members team.
const PROJECT_TEAMS: Record<string, Array<TeamFixture>> = {
  [PROJECT_ID]: [
    { id: OWNERS_ID, name: "Owners", permission: Permission.ProjectOwner },
    { id: MEMBERS_ID, name: "Members", permission: Permission.ProjectMember },
    { id: SUPPORT_ID, name: "Support", permission: Permission.Viewer },
  ],
  [PLAIN_PROJECT_ID]: [
    {
      id: PLAIN_OWNERS_ID,
      name: "Owners",
      permission: Permission.ProjectOwner,
    },
    {
      id: PLAIN_AUDITORS_ID,
      name: "Auditors",
      permission: Permission.Viewer,
    },
  ],
};

interface ListArgs {
  modelType: unknown;
  query?: { projectId?: ObjectID | string | undefined } | undefined;
  sort?: Record<string, unknown> | undefined;
}

// Held until the test lets the members-team lookup answer, when it says so.
let holdPermissionRows: boolean = false;
const heldPermissionAnswers: Array<() => void> = [];

async function answerList(args: ListArgs): Promise<unknown> {
  const fixtures: Array<TeamFixture> =
    PROJECT_TEAMS[args.query?.projectId?.toString() || ""] || [];

  if (args.modelType === TeamPermission) {
    if (holdPermissionRows) {
      await new Promise<void>((resolve: () => void) => {
        heldPermissionAnswers.push(resolve);
      });
    }

    const rows: Array<TeamPermission> = fixtures.map(
      (fixture: TeamFixture): TeamPermission => {
        const row: TeamPermission = new TeamPermission();
        row._id = ObjectID.generate().toString();
        row.teamId = new ObjectID(fixture.id);
        row.permission = fixture.permission;
        row.isBlockPermission = false;
        row.scope = PermissionScope.All;
        return row;
      },
    );

    return { data: rows, count: rows.length };
  }

  if (args.modelType === Team) {
    const teams: Array<Team> = fixtures.map((fixture: TeamFixture): Team => {
      const team: Team = new Team();
      team._id = fixture.id;
      team.name = fixture.name;
      return team;
    });

    return { data: teams, count: teams.length };
  }

  // The project dropdown's own list (ModelForm reads it for the options).
  if (args.modelType === Project) {
    const project: Project = new Project();
    project._id = PROJECT_ID;
    project.name = "Acme";

    return { data: [project], count: 1 };
  }

  return { data: [], count: 0 };
}

function goTo(path: string): void {
  window.history.pushState({}, "", path);
  Navigation.setLocation(window.location as unknown as never);
}

function lastTable(id: string): MockProps {
  const found: MockProps | undefined = [...mockTables]
    .reverse()
    .find((props: MockProps) => {
      return props["id"] === id;
    });

  if (!found) {
    throw new Error(`No model table ${id} was rendered.`);
  }

  return found;
}

// The model the form saved, as ModelForm hands it to the admin API.
function savedModel<T extends BaseModel>(): T {
  expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);

  const request: { model: T; formType: FormType } = mockCreateOrUpdate.mock
    .calls[0]![0] as { model: T; formType: FormType };

  expect(request.formType).toBe(FormType.Create);

  return request.model;
}

function teamIdOf(member: TeamMember): string | undefined {
  return member.teamId?.toString() || member.team?._id?.toString();
}

async function waitForSelectedTeams(text: string): Promise<void> {
  await waitFor(
    () => {
      expect(screen.getByTestId("selected-teams")).toHaveTextContent(text);
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTables.length = 0;
  mockTranslationCalls.length = 0;
  holdPermissionRows = false;
  heldPermissionAnswers.length = 0;

  localStorage.clear();
  // The Admin Dashboard is only ever used by a master admin.
  User.setIsMasterAdmin(true);

  mockGetList.mockImplementation((args: ListArgs) => {
    return answerList(args);
  });
  mockCreateOrUpdate.mockImplementation(
    async (request: { model: BaseModel }): Promise<unknown> => {
      return { data: request.model };
    },
  );

  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {
    return;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  localStorage.clear();
});

describe("Projects > Users > Invite User", () => {
  async function openInviteDialog(): Promise<void> {
    goTo(`/admin/projects/${PROJECT_ID}/users`);

    render(<ProjectUsers />);

    fireEvent.click(
      screen.getByRole("button", { name: "pages.projectUsers.inviteUser" }),
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    // The form's fields are in (ModelForm reads them in an effect).
    await waitFor(
      () => {
        expect(screen.getByPlaceholderText("member@company.com")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  }

  test("looks up the project's members team through the admin API when the dialog is asked for", async () => {
    await openInviteDialog();

    const lookups: Array<ListArgs> = mockGetList.mock.calls
      .map((call: Array<unknown>): ListArgs => {
        return call[0] as ListArgs;
      })
      .filter((args: ListArgs) => {
        return args.modelType === Team || args.modelType === TeamPermission;
      });

    const modelTypes: Array<unknown> = lookups.map((args: ListArgs) => {
      return args.modelType;
    });

    // The lookup comes first, before the dialog opens: teams, then their roles.
    expect(modelTypes.slice(0, 2)).toEqual([Team, TeamPermission]);

    /*
     * Then only the Team field's own list of the project's teams, which the
     * dialog reads as soon as it draws the field - on its one page.
     */
    expect(
      modelTypes.slice(2).filter((modelType: unknown): boolean => {
        return modelType !== Team;
      }),
    ).toEqual([]);

    for (const args of lookups) {
      expect(args.query?.projectId?.toString()).toBe(PROJECT_ID);
    }
  });

  test("is one page that opens with the members team picked, so Invite needs only the email", async () => {
    await openInviteDialog();

    await waitForSelectedTeams("Members");
    await settle();

    // One page: no step list and no Next, only Invite.
    expect(
      screen.queryByRole("navigation", { name: "Progress" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("modal-footer-next-button")).toBeNull();
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "pages.projectUsers.inviteUserSubmit",
    );

    // The team and the auto-accept box are beside the email, in view.
    expect(screen.getByText("Team")).toBeVisible();
    expect(
      screen.getByText("Accept the invitation automatically"),
    ).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("member@company.com"), {
      target: { value: "new.person@example.com" },
    });

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const member: TeamMember = savedModel<TeamMember>();

    expect(teamIdOf(member)).toBe(MEMBERS_ID);
    expect(member.projectId?.toString()).toBe(PROJECT_ID);
    /*
     * Not accepted on their behalf: an untouched checkbox is left out of the
     * request, and the server's default (an invitation) applies.
     */
    expect(Boolean(member.hasAcceptedInvitation)).toBe(false);
  });

  test("shows the members team picked beside the email, and says so", async () => {
    await openInviteDialog();

    fireEvent.change(screen.getByPlaceholderText("member@company.com"), {
      target: { value: "new.person@example.com" },
    });

    await waitForSelectedTeams("Members");

    expect(
      screen.getByText(
        "pages.projectUsers.inviteTeamDescriptionWithDefault teamName=Members",
      ),
    ).toBeVisible();

    // Another team can be picked instead, and is the one invited to.
    fireEvent.click(screen.getByRole("button", { name: "Pick Support" }));
    await waitForSelectedTeams("Support");

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(teamIdOf(savedModel<TeamMember>())).toBe(SUPPORT_ID);
  });

  test("a project with no members team opens with nothing picked, and asks for a team before inviting", async () => {
    goTo(`/admin/projects/${PLAIN_PROJECT_ID}/users`);

    render(<ProjectUsers />);

    fireEvent.click(
      screen.getByRole("button", { name: "pages.projectUsers.inviteUser" }),
    );

    await waitFor(
      () => {
        expect(screen.getByPlaceholderText("member@company.com")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    await settle();

    // Still one page, whose button invites: there is no step to walk to.
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "pages.projectUsers.inviteUserSubmit",
    );
    expect(screen.queryByTestId("modal-footer-next-button")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("member@company.com"), {
      target: { value: "new.person@example.com" },
    });

    await waitForSelectedTeams("(none)");

    expect(
      screen.getByText("Select the team you would like to add this user to."),
    ).toBeVisible();
    expect(
      mockTranslationCalls.some((call: TranslationCall) => {
        return (
          call.key === "pages.projectUsers.inviteTeamDescriptionWithDefault"
        );
      }),
    ).toBe(false);

    // Nothing is sent without a team.
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await settle();

    expect(mockCreateOrUpdate).not.toHaveBeenCalled();
  });

  test("the button waits for the lookup, and a second press does not start another", async () => {
    holdPermissionRows = true;

    goTo(`/admin/projects/${PROJECT_ID}/users`);

    render(<ProjectUsers />);

    const button: HTMLElement = screen.getByRole("button", {
      name: "pages.projectUsers.inviteUser",
    });

    fireEvent.click(button);

    await waitFor(
      () => {
        expect(
          screen.getByRole("button", { name: "pages.projectUsers.inviteUser" }),
        ).toHaveAttribute("data-loading", "true");
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "pages.projectUsers.inviteUser" }),
    );

    await settle();

    expect(
      mockGetList.mock.calls.filter((call: Array<unknown>) => {
        return (call[0] as ListArgs).modelType === TeamPermission;
      }),
    ).toHaveLength(1);
    expect(screen.queryByTestId("modal")).toBeNull();

    for (const release of heldPermissionAnswers) {
      release();
    }

    await waitFor(
      () => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(
      screen.getByRole("button", { name: "pages.projectUsers.inviteUser" }),
    ).toHaveAttribute("data-loading", "false");
  });
});

describe("Users > Projects > Add to Project", () => {
  async function openAddToProject(): Promise<void> {
    goTo(`/admin/users/${USER_ID}/projects`);

    render(<UserProjects />);

    fireEvent.click(
      screen.getByRole("button", { name: "pages.userProjects.addToProject" }),
    );

    await waitFor(
      () => {
        expect(
          screen.getByText("pages.userProjects.fieldProject"),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  }

  test("is one page: the project, its team and the auto-accept box, with Add from the start", async () => {
    await openAddToProject();

    expect(screen.getByText("pages.userProjects.fieldTeam")).toBeVisible();
    expect(
      screen.getByText("pages.userProjects.fieldAutoAccept"),
    ).toBeVisible();
    expect(
      screen.getByText("pages.userProjects.selectProjectFirst"),
    ).toBeVisible();

    await settle();

    expect(
      screen.queryByRole("navigation", { name: "Progress" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("modal-footer-next-button")).toBeNull();
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "pages.userProjects.addToProjectSubmit",
    );
  });

  test("picking a project starts on its members team, and one press adds the user to it", async () => {
    await openAddToProject();

    fireEvent.click(screen.getByRole("button", { name: "Choose a project" }));

    await waitForSelectedTeams("Members");

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const member: TeamMember = savedModel<TeamMember>();

    expect(member.userId?.toString()).toBe(USER_ID);
    expect(member.projectId?.toString()).toBe(PROJECT_ID);
    expect(teamIdOf(member)).toBe(MEMBERS_ID);
    // An untouched checkbox is left out: the server's default, invited.
    expect(Boolean(member.hasAcceptedInvitation)).toBe(false);
  });

  test("a project with no members team waits for a team", async () => {
    await openAddToProject();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Choose the project with no members team",
      }),
    );

    await waitFor(
      () => {
        expect(
          screen.getByRole("button", { name: "Pick Auditors" }),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    await settle();

    expect(screen.getByTestId("selected-teams")).toHaveTextContent("(none)");

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    await settle();

    expect(mockCreateOrUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Pick Auditors" }));
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(teamIdOf(savedModel<TeamMember>())).toBe(PLAIN_AUDITORS_ID);
  });
});

/*
 * A provider's Attached Projects form, drawn the way ModelTable draws its
 * Create dialog: a ModelFormModal with the table's fields, steps and hooks.
 */
function renderAttachForm<T extends BaseModel>(
  table: MockProps,
  modelType: { new (): T },
): void {
  render(
    <ModelFormModal<T>
      modelType={modelType}
      modelAPI={table["modelAPI"] as typeof AdminModelAPI}
      title="Attach a project"
      submitButtonText="Attach"
      onBeforeCreate={table["onBeforeCreate"] as (item: T) => Promise<T>}
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
}

describe.each([
  {
    name: "Global SSO",
    path: `/admin/settings/global-sso/${PROVIDER_ID}`,
    Page: GlobalSSOView,
    table: "global-sso-project-table",
    modelType: GlobalSSOProject as { new (): BaseModel },
    providerColumn: "globalSsoId",
  },
  {
    name: "Global OIDC",
    path: `/admin/settings/global-oidc/${PROVIDER_ID}`,
    Page: GlobalOIDCView,
    table: "global-oidc-project-table",
    modelType: GlobalOIDCProject as { new (): BaseModel },
    providerColumn: "globalOidcId",
  },
])(
  "$name > Attached Projects",
  (provider: {
    name: string;
    path: string;
    Page: FunctionComponent;
    table: string;
    modelType: { new (): BaseModel };
    providerColumn: string;
  }) => {
    function openAttachForm(): void {
      goTo(provider.path);

      const page: ReturnType<typeof render> = render(<provider.Page />);
      const table: MockProps = lastTable(provider.table);

      page.unmount();

      renderAttachForm(table, provider.modelType);
    }

    test("is one page: the project, then its teams", async () => {
      openAttachForm();

      await waitFor(
        () => {
          expect(screen.getByText("Project")).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      expect(screen.getByText("Teams")).toBeVisible();
      expect(
        screen.getByText("Select a project first to choose its default teams."),
      ).toBeVisible();

      await settle();

      expect(
        screen.queryByRole("navigation", { name: "Progress" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("modal-footer-next-button")).toBeNull();
      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent("Attach");
    });

    test("starts the attached project on its members team, and saves it with one press", async () => {
      openAttachForm();

      await waitFor(
        () => {
          expect(
            screen.getByRole("button", { name: "Choose a project" }),
          ).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      fireEvent.click(screen.getByRole("button", { name: "Choose a project" }));

      await waitForSelectedTeams("Members");

      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      await waitFor(
        () => {
          expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      const attachment: BaseModel = savedModel<BaseModel>();
      const values: Record<string, unknown> = attachment as unknown as Record<
        string,
        unknown
      >;

      expect(String(values[provider.providerColumn])).toBe(PROVIDER_ID);
      expect(
        ((values["project"] as BaseModel | undefined)?._id || "").toString(),
      ).toBe(PROJECT_ID);
      expect(
        ((values["teams"] as Array<BaseModel> | undefined) || []).map(
          (team: BaseModel) => {
            return team._id?.toString();
          },
        ),
      ).toEqual([MEMBERS_ID]);
    });

    test("more teams can be added next to the members team", async () => {
      openAttachForm();

      await waitFor(
        () => {
          expect(
            screen.getByRole("button", { name: "Choose a project" }),
          ).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      fireEvent.click(screen.getByRole("button", { name: "Choose a project" }));

      await waitForSelectedTeams("Members");

      fireEvent.click(screen.getByRole("button", { name: "Pick Support" }));
      await waitForSelectedTeams("Members, Support");

      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

      await waitFor(
        () => {
          expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      const values: Record<string, unknown> =
        savedModel<BaseModel>() as unknown as Record<string, unknown>;

      expect(
        ((values["teams"] as Array<BaseModel> | undefined) || []).map(
          (team: BaseModel) => {
            return team._id?.toString();
          },
        ),
      ).toEqual([MEMBERS_ID, SUPPORT_ID]);
    });
  },
);
