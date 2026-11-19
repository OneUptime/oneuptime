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
import type { SpyInstance } from "jest-mock";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useState,
} from "react";

/*
 * THE ADMIN DASHBOARD'S INVITATION FORMS SUGGEST PEOPLE AS AN ADDRESS IS
 * TYPED (#9826), as the Dashboard's do - on the real pages and the real
 * form stack (ModelFormModal, ModelForm, BasicForm, InviteeEmailField),
 * with only the network, the tables and the page chrome stood in for:
 *
 *   - Projects > a project > Users > Invite New User, and a team's members
 *     form, draw their email row as the suggesting box;
 *   - two letters ask the server about that project - named in the path of
 *     the master admins' route, never as a tenant, since the Admin Dashboard
 *     works in no project - for the team the form has picked;
 *   - each person is listed with where they stand: the server's accounts
 *     Not in this project yet, the project's Invited, and - listed, never
 *     offered - Already in this team or Already invited to this team;
 *   - a pick fills its address in, and the Name row goes, as the person
 *     has an account and a name; changing the address brings it back;
 *   - the invitation goes to the address picked.
 */

jest.setTimeout(60000);

const WAIT_FOR_TIMEOUT: number = 20000;

const PROJECT_ID: string = "98260000-0000-4000-8000-0000000000e1";
const OWNERS_ID: string = "98260000-0000-4000-8000-0000000000e2";
const MEMBERS_ID: string = "98260000-0000-4000-8000-0000000000e3";
const SUPPORT_ID: string = "98260000-0000-4000-8000-0000000000e4";

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

type MockProps = Record<string, unknown>;

interface CardButton {
  title: string;
  onClick?: (() => void) | undefined;
}

/*
 * The tables: their card buttons (Users opens Invite New User from one),
 * and - for a table that creates, as a team's members does - its Create
 * dialog, drawn as ModelTable draws it: a ModelFormModal with the table's
 * fields and hooks, handed again each time the page draws the table.
 */
const MockModelTable: FunctionComponent<MockProps> = (
  props: MockProps,
): ReactElement => {
  const [isCreating, setIsCreating] = useState<boolean>(false);

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
      {props["isCreateable"] ? (
        <button
          type="button"
          onClick={() => {
            setIsCreating(true);
          }}
        >
          Open the Invite form
        </button>
      ) : (
        <></>
      )}
      {isCreating ? (
        <ModelFormModal<TeamMember>
          modelType={TeamMember}
          modelAPI={props["modelAPI"] as typeof AdminModelAPI}
          title="Invite New Team Member"
          submitButtonText="Invite"
          onClose={() => {
            setIsCreating(false);
          }}
          onBeforeCreate={
            props["onBeforeCreate"] as (item: TeamMember) => Promise<TeamMember>
          }
          onSuccess={() => {
            setIsCreating(false);
          }}
          formProps={{
            name: "create-TeamMember-from",
            id: "create-TeamMember-from",
            modelType: TeamMember,
            modelAPI: props["modelAPI"] as typeof AdminModelAPI,
            fields: props["formFields"] as never,
            steps: [],
            formType: FormType.Create,
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: MockProps): ReactElement => {
      return <MockModelTable {...props} />;
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

interface DropdownOptionStub {
  label: string;
  value: string;
}

/*
 * The Team picker, stood in for: what is picked, and one button per team,
 * which hands the form the team's id as the real one does.
 */
jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 60,
    default: (props: {
      options: Array<DropdownOptionStub>;
      value?: unknown;
      onChange?: ((value: string) => void) | undefined;
    }): ReactElement => {
      const picked: unknown = Array.isArray(props.value)
        ? props.value[0]
        : props.value;
      const pickedId: string =
        typeof picked === "string"
          ? picked
          : (picked as DropdownOptionStub | undefined)?.value || "";

      return (
        <div>
          <p data-testid="selected-team">
            {props.options.find((option: DropdownOptionStub) => {
              return option.value === pickedId;
            })?.label || "(none)"}
          </p>
          {props.options.map((option: DropdownOptionStub) => {
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
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
import ProjectTeamView from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Projects/View/TeamView";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  INVITE_SUGGESTIONS_ROUTE,
  InviteSuggestion,
  InviteSuggestionStanding,
  getInviteSuggestionsInProjectRoute,
  toInviteSuggestionsAnswerJSON,
} from "../../../Types/Team/InviteSuggestions";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import {
  ALREADY_INVITED_TO_THIS_TEAM_TEXT,
  ALREADY_IN_THIS_TEAM_TEXT,
  INVITED_TEXT,
  INVITE_SUGGESTIONS_LIST_LABEL,
  NOT_IN_THIS_PROJECT_YET_TEXT,
} from "../../../UI/Components/InviteeEmailField/InviteeEmailField";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import API from "../../../UI/Utils/API/API";
import { INVITEE_NAME_DESCRIPTION } from "../../../UI/Utils/InviteeName";
import Navigation from "../../../UI/Utils/Navigation";
import User from "../../../UI/Utils/User";
import { standInForGlobalConfig } from "../../Helpers/GlobalConfigStandIn";

const mockGetList: jest.MockedFunction<any> =
  AdminModelAPI.getList as unknown as jest.MockedFunction<any>;
const mockCreateOrUpdate: jest.MockedFunction<any> =
  AdminModelAPI.createOrUpdate as unknown as jest.MockedFunction<any>;

// The project's teams: Members is the team Invite New User starts on.
const TEAMS: Array<{ id: string; name: string; permission: Permission }> = [
  { id: OWNERS_ID, name: "Owners", permission: Permission.ProjectOwner },
  { id: MEMBERS_ID, name: "Members", permission: Permission.ProjectMember },
  { id: SUPPORT_ID, name: "Support", permission: Permission.Viewer },
];

// An account of the server, in no team of the project.
const ADA_BYRON: InviteSuggestion = {
  userId: "98260000-0000-4000-8000-0000000000f1",
  name: "Ada Byron",
  email: "ada.byron@other.test",
  standing: InviteSuggestionStanding.NotInProject,
};

/*
 * Where the project's people stand, for the team asked about: Grace is in
 * Members, Alan invited to it, Linus invited to the project only.
 */
function suggestionsFor(teamId: unknown): Array<InviteSuggestion> {
  const isMembers: boolean = teamId === MEMBERS_ID;

  return [
    {
      userId: "98260000-0000-4000-8000-0000000000f2",
      name: "Grace Adams",
      email: "grace@acme.test",
      standing: isMembers
        ? InviteSuggestionStanding.InThisTeam
        : InviteSuggestionStanding.Member,
    },
    {
      userId: "98260000-0000-4000-8000-0000000000f3",
      name: "Alan Adair",
      email: "alan@acme.test",
      standing: isMembers
        ? InviteSuggestionStanding.InvitedToThisTeam
        : InviteSuggestionStanding.Invited,
    },
    {
      userId: "98260000-0000-4000-8000-0000000000f4",
      name: "Linus Adler",
      email: "linus@acme.test",
      standing: InviteSuggestionStanding.Invited,
    },
    ADA_BYRON,
  ];
}

interface ListArgs {
  modelType: unknown;
  query?: { projectId?: ObjectID | string | undefined } | undefined;
}

// The members-team lookup and the Team picker read the project's teams.
async function answerList(args: ListArgs): Promise<unknown> {
  if (args.query?.projectId?.toString() !== PROJECT_ID) {
    return { data: [], count: 0 };
  }

  if (args.modelType === TeamPermission) {
    const rows: Array<TeamPermission> = TEAMS.map(
      (fixture: { id: string; permission: Permission }): TeamPermission => {
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
    const teams: Array<Team> = TEAMS.map(
      (fixture: { id: string; name: string }): Team => {
        const team: Team = new Team();
        team._id = fixture.id;
        team.name = fixture.name;
        return team;
      },
    );

    return { data: teams, count: teams.length };
  }

  return { data: [], count: 0 };
}

type Request = { url: URL; data: JSONObject; headers?: JSONObject };

let postSpy: SpyInstance<typeof API.post>;
// When set, the server refuses every suggestions read with this status.
let refuseWith: number | null = null;

function asks(): Array<Request> {
  return postSpy.mock.calls.map((call: Array<unknown>): Request => {
    return call[0] as Request;
  });
}

function goTo(path: string): void {
  window.history.pushState({}, "", path);
  Navigation.setLocation(window.location as unknown as never);
}

function emailBox(): HTMLInputElement {
  return screen.getByTestId("invitee-email") as HTMLInputElement;
}

function nameBox(): HTMLInputElement | null {
  return screen.queryByPlaceholderText("John Smith") as HTMLInputElement | null;
}

async function typeAddress(value: string): Promise<void> {
  await act(async () => {
    fireEvent.focus(emailBox());
    fireEvent.change(emailBox(), { target: { value: value } });
  });
}

// What the list says, person by person, once the server has answered.
async function listed(): Promise<Array<HTMLElement>> {
  return await screen.findAllByTestId(
    "invitee-suggestion",
    {},
    { timeout: WAIT_FOR_TIMEOUT },
  );
}

function optionOf(options: Array<HTMLElement>, name: string): HTMLElement {
  const option: HTMLElement | undefined = options.find(
    (each: HTMLElement): boolean => {
      return (each.textContent || "").includes(name);
    },
  );

  if (!option) {
    throw new Error(`${name} is not suggested.`);
  }

  return option;
}

function standingOf(option: HTMLElement): string | null {
  return (
    within(option).queryByTestId("invitee-suggestion-standing")?.textContent ||
    null
  );
}

// The invitation ModelForm sent, as the admin API was handed it.
function sentInvitation(): { model: TeamMember; miscDataProps: JSONObject } {
  expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);

  return mockCreateOrUpdate.mock.calls[0]![0] as {
    model: TeamMember;
    miscDataProps: JSONObject;
  };
}

function teamIdOf(member: TeamMember): string | undefined {
  return member.teamId?.toString() || member.team?._id?.toString();
}

beforeEach(() => {
  jest.clearAllMocks();
  refuseWith = null;
  localStorage.clear();

  standInForGlobalConfig();
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

  postSpy = jest.spyOn(API, "post").mockImplementation((async (
    request: Request,
  ) => {
    if (refuseWith) {
      return new HTTPErrorResponse(
        refuseWith,
        {
          message:
            "This project does not exist. It may have been deleted: open another one from the Projects list.",
        },
        {},
      );
    }

    return new HTTPResponse<JSONObject>(
      200,
      toInviteSuggestionsAnswerJSON(suggestionsFor(request.data["teamId"])),
      {},
    );
  }) as never) as unknown as SpyInstance<typeof API.post>;

  jest.spyOn(Navigation, "navigate").mockImplementation((): void => {
    return;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  localStorage.clear();
});

describe("Projects > a project > Users > Invite New User", () => {
  async function openInviteDialog(): Promise<void> {
    goTo(`/admin/projects/${PROJECT_ID}/users`);

    render(<ProjectUsers />);

    fireEvent.click(
      screen.getByRole("button", { name: "pages.projectUsers.inviteUser" }),
    );

    await waitFor(
      () => {
        expect(emailBox()).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    // Starts on the members team, which the suggestions are read for.
    await waitFor(
      () => {
        expect(screen.getByTestId("selected-team")).toHaveTextContent(
          "Members",
        );
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  }

  test("draws the email row as the box that suggests people, and asks nothing before two letters", async () => {
    await openInviteDialog();

    expect(emailBox()).toHaveAttribute("role", "combobox");
    expect(emailBox()).toHaveAttribute("placeholder", "member@company.com");
    expect(emailBox()).toHaveAttribute("autocomplete", "off");

    await typeAddress("a");

    // Long past the wait before asking.
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 600);
      });
    });

    expect(postSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("invitee-suggestions")).toBeNull();
  });

  test("two letters ask about this project - in the path, with no tenant - for the team picked", async () => {
    await openInviteDialog();

    await typeAddress("ad");
    await listed();

    expect(asks()).toHaveLength(1);

    const request: Request = asks()[0]!;

    expect(
      request.url
        .toString()
        .endsWith(getInviteSuggestionsInProjectRoute(PROJECT_ID)),
    ).toBe(true);
    // Not the Dashboard's route, which reads the request's tenant.
    expect(request.url.toString().endsWith(INVITE_SUGGESTIONS_ROUTE)).toBe(
      false,
    );
    expect(request.data).toEqual({ text: "ad", teamId: MEMBERS_ID });
    expect(request.headers).toEqual({});
  });

  test("lists the server's accounts and the project's people, each with where they stand for the team picked", async () => {
    await openInviteDialog();

    await typeAddress("ad");

    const options: Array<HTMLElement> = await listed();

    expect(options).toHaveLength(4);
    expect(screen.getByTestId("invitee-suggestions")).toHaveAttribute(
      "aria-label",
      INVITE_SUGGESTIONS_LIST_LABEL,
    );

    const adaByron: HTMLElement = optionOf(options, "Ada Byron");

    expect(adaByron).toHaveTextContent("ada.byron@other.test");
    expect(standingOf(adaByron)).toBe(NOT_IN_THIS_PROJECT_YET_TEXT);
    expect(standingOf(optionOf(options, "Linus Adler"))).toBe(INVITED_TEXT);

    // In Members already, or invited to it: listed, never offered.
    const grace: HTMLElement = optionOf(options, "Grace Adams");
    const alan: HTMLElement = optionOf(options, "Alan Adair");

    expect(standingOf(grace)).toBe(ALREADY_IN_THIS_TEAM_TEXT);
    expect(standingOf(alan)).toBe(ALREADY_INVITED_TO_THIS_TEAM_TEXT);
    expect(grace).toHaveAttribute("aria-disabled", "true");
    expect(alan).toHaveAttribute("aria-disabled", "true");
    expect(grace.tagName).toBe("DIV");
    expect(adaByron.tagName).toBe("BUTTON");
  });

  test("the Team picked decides where each person stands", async () => {
    await openInviteDialog();

    fireEvent.click(screen.getByRole("button", { name: "Pick Support" }));

    await waitFor(
      () => {
        expect(screen.getByTestId("selected-team")).toHaveTextContent(
          "Support",
        );
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    await typeAddress("ada");

    const options: Array<HTMLElement> = await listed();

    expect(asks()[0]!.data).toEqual({ text: "ada", teamId: SUPPORT_ID });
    // In the project, not in Support: a member needs no word, Alan is invited.
    expect(standingOf(optionOf(options, "Grace Adams"))).toBeNull();
    expect(standingOf(optionOf(options, "Alan Adair"))).toBe(INVITED_TEXT);
    expect(optionOf(options, "Grace Adams").tagName).toBe("BUTTON");
  });

  test("a pick fills its address in and asks no name; another address brings the Name back", async () => {
    await openInviteDialog();

    // A whole address of somebody new: the Name is asked, optional.
    await typeAddress("new.person@acme.test");

    await waitFor(
      () => {
        expect(nameBox()).not.toBeNull();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(screen.getByText(INVITEE_NAME_DESCRIPTION)).toBeInTheDocument();

    await typeAddress("ad");

    const options: Array<HTMLElement> = await listed();

    await act(async () => {
      fireEvent.click(optionOf(options, "Ada Byron"));
    });

    expect(emailBox().value).toBe("ada.byron@other.test");
    expect(screen.queryByTestId("invitee-suggestions")).toBeNull();

    await waitFor(
      () => {
        expect(nameBox()).toBeNull();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    // Somebody else's address: their name may be needed.
    await typeAddress("ada.byron+ops@other.test");

    await waitFor(
      () => {
        expect(nameBox()).not.toBeNull();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    // Back to the person picked: nothing to ask.
    await typeAddress("ada.byron@other.test");

    await waitFor(
      () => {
        expect(nameBox()).toBeNull();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  });

  test("the invitation goes to the person picked, in the team picked", async () => {
    await openInviteDialog();

    await typeAddress("ad");

    const options: Array<HTMLElement> = await listed();

    await act(async () => {
      fireEvent.click(optionOf(options, "Ada Byron"));
    });

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const sent: { model: TeamMember; miscDataProps: JSONObject } =
      sentInvitation();

    expect(sent.miscDataProps["email"]).toBe("ada.byron@other.test");
    expect(sent.miscDataProps["name"]).toBeUndefined();
    expect(teamIdOf(sent.model)).toBe(MEMBERS_ID);
    expect(sent.model.projectId?.toString()).toBe(PROJECT_ID);
  });

  test("a read that is refused - the project gone - suggests nobody, and an address typed still invites", async () => {
    refuseWith = 404;

    await openInviteDialog();

    await typeAddress("new.person@acme.test");

    await waitFor(
      () => {
        expect(asks()).toHaveLength(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId("invitee-suggestions")).toBeNull();
    expect(emailBox().value).toBe("new.person@acme.test");

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(sentInvitation().miscDataProps["email"]).toBe(
      "new.person@acme.test",
    );
  });
});

describe("Projects > a project > Teams > a team's members", () => {
  async function openInviteForm(): Promise<void> {
    goTo(`/admin/projects/${PROJECT_ID}/teams/${MEMBERS_ID}`);

    render(<ProjectTeamView />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open the Invite form" }),
    );

    await waitFor(
      () => {
        expect(emailBox()).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  }

  test("two letters ask about this project - in the path, with no tenant - for this team", async () => {
    await openInviteForm();

    expect(emailBox()).toHaveAttribute("role", "combobox");

    await typeAddress("ad");
    await listed();

    expect(asks()).toHaveLength(1);

    const request: Request = asks()[0]!;

    expect(
      request.url
        .toString()
        .endsWith(getInviteSuggestionsInProjectRoute(PROJECT_ID)),
    ).toBe(true);
    expect(request.data).toEqual({ text: "ad", teamId: MEMBERS_ID });
    expect(request.headers).toEqual({});
  });

  test("lists each person with where they stand for this team", async () => {
    await openInviteForm();

    await typeAddress("ad");

    const options: Array<HTMLElement> = await listed();

    expect(standingOf(optionOf(options, "Ada Byron"))).toBe(
      NOT_IN_THIS_PROJECT_YET_TEXT,
    );
    expect(standingOf(optionOf(options, "Linus Adler"))).toBe(INVITED_TEXT);
    expect(standingOf(optionOf(options, "Grace Adams"))).toBe(
      ALREADY_IN_THIS_TEAM_TEXT,
    );
    expect(standingOf(optionOf(options, "Alan Adair"))).toBe(
      ALREADY_INVITED_TO_THIS_TEAM_TEXT,
    );
  });

  test("a pick fills its address in and asks no name; another address brings the Name back", async () => {
    await openInviteForm();

    await typeAddress("ad");

    const options: Array<HTMLElement> = await listed();

    await act(async () => {
      fireEvent.click(optionOf(options, "Linus Adler"));
    });

    expect(emailBox().value).toBe("linus@acme.test");

    await waitFor(
      () => {
        expect(nameBox()).toBeNull();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    await typeAddress("linus.adler@acme.test");

    await waitFor(
      () => {
        expect(nameBox()).not.toBeNull();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  });

  test("the invitation goes to the person picked, in this team of this project", async () => {
    await openInviteForm();

    await typeAddress("ad");

    const options: Array<HTMLElement> = await listed();

    await act(async () => {
      fireEvent.click(optionOf(options, "Ada Byron"));
    });

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const sent: { model: TeamMember; miscDataProps: JSONObject } =
      sentInvitation();

    expect(sent.miscDataProps["email"]).toBe("ada.byron@other.test");
    expect(teamIdOf(sent.model)).toBe(MEMBERS_ID);
    expect(sent.model.projectId?.toString()).toBe(PROJECT_ID);
  });
});
