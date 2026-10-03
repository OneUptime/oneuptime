import "@testing-library/jest-dom";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ADDING SOMEONE TO A PROJECT STARTS ON ITS MEMBERS TEAM - the Admin
 * Dashboard's project-scoped team picker.
 *
 * The picker sits under the project on Add to Project (one user, or many
 * from the Users list) and on a global SSO or OIDC provider's Attached
 * Projects form. Once a project is picked it loads that project's teams and,
 * with nothing selected, picks the project's members team - the same rule as
 * the Dashboard's Invite User (Common/UI/Utils/DefaultInviteTeam), read as a
 * master admin, who may hand on any team. A team the admin picked is never
 * replaced, one they cleared is not put back, and a team of a project they
 * switched away from is dropped.
 */

jest.setTimeout(30000);

const WAIT_FOR_TIMEOUT: number = 20000;

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163001";
const OTHER_PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163002";
const PLAIN_PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163003";

const OWNERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163011";
const ADMIN_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163012";
const MEMBERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163013";
const SUPPORT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163014";

const OTHER_OWNERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163021";
const OTHER_ENGINEERING_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163022";

const PLAIN_OWNERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163031";
const PLAIN_AUDITORS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194163032";

/*
 * Nobody signed in holds a permission in any project, and nobody is a master
 * admin by the browser's account: a default the picker offers can only come
 * from treating the admin as one who may hand on any team.
 */
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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

interface DropdownStubOption {
  label: string;
  value: string;
}

interface DropdownStubProps {
  isMultiSelect?: boolean | undefined;
  options: Array<DropdownStubOption>;
  value?: unknown;
  placeholder?: string | undefined;
  onChange?: ((value: string | Array<string>) => void) | undefined;
}

let capturedDropdownProps: DropdownStubProps | null = null;

/*
 * react-select in jsdom is more machinery than signal: the stand-in shows
 * what is selected and offers one button per team.
 */
jest.mock("Common/UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 60,
    default: (props: DropdownStubProps): React.ReactElement => {
      capturedDropdownProps = props;

      const selected: Array<DropdownStubOption> = Array.isArray(props.value)
        ? (props.value as Array<DropdownStubOption>)
        : props.value
          ? [props.value as DropdownStubOption]
          : [];

      return (
        <div>
          <p data-testid="selected-teams">
            {selected
              .map((option: DropdownStubOption) => {
                return option.label;
              })
              .join(", ") || "(none)"}
          </p>
          {props.options.map((option: DropdownStubOption) => {
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
      },
    };
  },
);

import ProjectScopedTeamsPicker, {
  getTeamIdsAfterTeamsLoad,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/GlobalProvider/ProjectScopedTeamsPicker";
import {
  findProjectDefaultTeam,
  masterAdminCanGrantAll,
} from "../../../../App/FeatureSet/AdminDashboard/src/Utils/DefaultProjectTeam";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

const mockGetList: jest.MockedFunction<any> =
  AdminModelAPI.getList as unknown as jest.MockedFunction<any>;

interface TeamFixture {
  id: string;
  name: string;
  permission: Permission;
}

/*
 * Three projects with nothing in common: a new one (Owners, Admin, Members,
 * Support), one whose ProjectMember team was renamed Engineering, and one
 * with no members team at all.
 */
const PROJECT_TEAMS: Record<string, Array<TeamFixture>> = {
  [PROJECT_ID]: [
    { id: OWNERS_ID, name: "Owners", permission: Permission.ProjectOwner },
    { id: ADMIN_ID, name: "Admin", permission: Permission.ProjectAdmin },
    { id: MEMBERS_ID, name: "Members", permission: Permission.ProjectMember },
    { id: SUPPORT_ID, name: "Support", permission: Permission.Viewer },
  ],
  [OTHER_PROJECT_ID]: [
    {
      id: OTHER_OWNERS_ID,
      name: "Owners",
      permission: Permission.ProjectOwner,
    },
    {
      id: OTHER_ENGINEERING_ID,
      name: "Engineering",
      permission: Permission.ProjectMember,
    },
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
  query: { projectId?: ObjectID | undefined };
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}

let permissionsAnswer: "rows" | "fail" | "never" = "rows";
let teamsAnswer: "rows" | "fail" | "never" = "rows";

function answerList(args: ListArgs): Promise<unknown> {
  const answer: "rows" | "fail" | "never" =
    args.modelType === TeamPermission ? permissionsAnswer : teamsAnswer;

  if (answer === "never") {
    return new Promise((): void => {});
  }

  return answerListNow(args, answer);
}

// An async function, so a refusal is a rejected request, as the API's is.
async function answerListNow(
  args: ListArgs,
  answer: "rows" | "fail",
): Promise<unknown> {
  const fixtures: Array<TeamFixture> =
    PROJECT_TEAMS[args.query.projectId?.toString() || ""] || [];

  if (answer === "fail") {
    throw new Error("Teams could not be loaded.");
  }

  if (args.modelType === TeamPermission) {
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

  const teams: Array<Team> = fixtures.map((fixture: TeamFixture): Team => {
    const team: Team = new Team();
    team._id = fixture.id;
    team.name = fixture.name;
    return team;
  });

  return { data: teams, count: teams.length };
}

type OnChangeMock = jest.MockedFunction<(teamIds: Array<string>) => void>;

function makeOnChange(): OnChangeMock {
  return jest.fn((_teamIds: Array<string>): void => {}) as OnChangeMock;
}

interface PickerProps {
  projectId: string | undefined;
  selectedTeamIds: Array<string>;
  onChange: (teamIds: Array<string>) => void;
  isMultiSelect?: boolean | undefined;
}

function picker(props: PickerProps): React.ReactElement {
  return (
    <ProjectScopedTeamsPicker
      isMultiSelect={props.isMultiSelect}
      projectId={props.projectId ? new ObjectID(props.projectId) : undefined}
      selectedTeamIds={props.selectedTeamIds}
      onChange={props.onChange}
    />
  );
}

/*
 * Drains the microtask queue, so a `.then` that was going to run has run:
 * "onChange was not called" only means something after that.
 */
async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await Promise.resolve();
  }
}

async function waitForTeams(view: ReturnType<typeof render>): Promise<void> {
  await waitFor(
    () => {
      expect(view.getByTestId("selected-teams")).toBeInTheDocument();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  capturedDropdownProps = null;
  permissionsAnswer = "rows";
  teamsAnswer = "rows";
  mockGetList.mockImplementation((args: ListArgs) => {
    return answerList(args);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("what the form holds once a project's teams are known", () => {
  const ALL: Array<string> = [OWNERS_ID, ADMIN_ID, MEMBERS_ID, SUPPORT_ID];

  test("nothing selected: the members team", () => {
    expect(
      getTeamIdsAfterTeamsLoad({
        selectedTeamIds: [],
        availableTeamIds: ALL,
        defaultTeamId: MEMBERS_ID,
      }),
    ).toEqual([MEMBERS_ID]);
  });

  test("a team the admin picked stays, and nothing is reported", () => {
    expect(
      getTeamIdsAfterTeamsLoad({
        selectedTeamIds: [SUPPORT_ID],
        availableTeamIds: ALL,
        defaultTeamId: MEMBERS_ID,
      }),
    ).toBeNull();

    expect(
      getTeamIdsAfterTeamsLoad({
        selectedTeamIds: [SUPPORT_ID, OWNERS_ID],
        availableTeamIds: ALL,
        defaultTeamId: MEMBERS_ID,
      }),
    ).toBeNull();
  });

  test("the members team already picked: nothing is reported", () => {
    expect(
      getTeamIdsAfterTeamsLoad({
        selectedTeamIds: [MEMBERS_ID],
        availableTeamIds: ALL,
        defaultTeamId: MEMBERS_ID,
      }),
    ).toBeNull();
  });

  test("a team of another project is dropped, and the members team takes its place", () => {
    expect(
      getTeamIdsAfterTeamsLoad({
        selectedTeamIds: [OTHER_ENGINEERING_ID],
        availableTeamIds: ALL,
        defaultTeamId: MEMBERS_ID,
      }),
    ).toEqual([MEMBERS_ID]);
  });

  test("only the stale ids are dropped when some picked teams are this project's", () => {
    expect(
      getTeamIdsAfterTeamsLoad({
        selectedTeamIds: [OTHER_ENGINEERING_ID, SUPPORT_ID],
        availableTeamIds: ALL,
        defaultTeamId: MEMBERS_ID,
      }),
    ).toEqual([SUPPORT_ID]);
  });

  test("no members team: stale ids are still dropped, and nothing is picked", () => {
    expect(
      getTeamIdsAfterTeamsLoad({
        selectedTeamIds: [OTHER_ENGINEERING_ID],
        availableTeamIds: ALL,
        defaultTeamId: null,
      }),
    ).toEqual([]);

    expect(
      getTeamIdsAfterTeamsLoad({
        selectedTeamIds: [],
        availableTeamIds: ALL,
        defaultTeamId: null,
      }),
    ).toBeNull();
  });

  test("a members team that is not among the project's teams is never picked", () => {
    expect(
      getTeamIdsAfterTeamsLoad({
        selectedTeamIds: [],
        availableTeamIds: [OWNERS_ID, ADMIN_ID],
        defaultTeamId: MEMBERS_ID,
      }),
    ).toBeNull();
  });

  test("a project with no teams leaves nothing selected", () => {
    expect(
      getTeamIdsAfterTeamsLoad({
        selectedTeamIds: [MEMBERS_ID],
        availableTeamIds: [],
        defaultTeamId: null,
      }),
    ).toEqual([]);
  });
});

describe("the team a master admin starts on", () => {
  test("is looked up through the admin API, as one who may hand on any team", async () => {
    const found: { id: string; name: string } | null =
      await findProjectDefaultTeam({ projectId: new ObjectID(PROJECT_ID) });

    expect(found).toEqual({ id: MEMBERS_ID, name: "Members" });

    // Both lists, through the admin API, for this project only.
    const listed: Array<ListArgs> = mockGetList.mock.calls.map(
      (call: Array<unknown>): ListArgs => {
        return call[0] as ListArgs;
      },
    );

    expect(
      listed.map((args: ListArgs) => {
        return args.modelType;
      }),
    ).toEqual([Team, TeamPermission]);

    for (const args of listed) {
      expect(Object.keys(args.query)).toEqual(["projectId"]);
      expect(args.query.projectId?.toString()).toBe(PROJECT_ID);
    }
  });

  test("a master admin may hand on every team's permissions, the owners' included", () => {
    expect(masterAdminCanGrantAll([Permission.ProjectOwner])).toBe(true);
    expect(
      masterAdminCanGrantAll([
        Permission.ProjectMember,
        Permission.ProjectAdmin,
        Permission.DeleteProjectMonitor,
      ]),
    ).toBe(true);
    expect(masterAdminCanGrantAll([])).toBe(true);
  });

  test("a renamed members team is found by what it holds", async () => {
    await expect(
      findProjectDefaultTeam({ projectId: new ObjectID(OTHER_PROJECT_ID) }),
    ).resolves.toEqual({ id: OTHER_ENGINEERING_ID, name: "Engineering" });
  });

  test("none without a project, and none when a list cannot be read", async () => {
    await expect(findProjectDefaultTeam({ projectId: null })).resolves.toBe(
      null,
    );
    expect(mockGetList).not.toHaveBeenCalled();

    permissionsAnswer = "fail";

    await expect(
      findProjectDefaultTeam({ projectId: new ObjectID(PROJECT_ID) }),
    ).resolves.toBeNull();
  });
});

describe("ProjectScopedTeamsPicker", () => {
  test("asks for a project first, and asks the server nothing until one is picked", async () => {
    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({ projectId: undefined, selectedTeamIds: [], onChange }),
    );

    expect(
      view.getByText("Select a project first to choose its default teams."),
    ).toBeVisible();

    await settle();

    expect(mockGetList).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("loads the picked project's teams by name, and which of them is its members team", async () => {
    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: PROJECT_ID,
        selectedTeamIds: [],
        onChange,
        isMultiSelect: false,
      }),
    );

    await waitForTeams(view);

    const calls: Array<ListArgs> = mockGetList.mock.calls.map(
      (call: Array<unknown>): ListArgs => {
        return call[0] as ListArgs;
      },
    );

    // The options: this project's teams, by name.
    const byName: Array<ListArgs> = calls.filter((args: ListArgs) => {
      return args.modelType === Team && "name" in args.sort;
    });

    expect(byName).toHaveLength(1);
    expect(byName[0]!.sort).toEqual({ name: SortOrder.Ascending });
    expect(byName[0]!.query.projectId?.toString()).toBe(PROJECT_ID);

    // The members team: the teams, oldest first, and their permission rows.
    expect(
      calls.filter((args: ListArgs) => {
        return args.modelType === Team && "createdAt" in args.sort;
      }),
    ).toHaveLength(1);
    expect(
      calls.filter((args: ListArgs) => {
        return args.modelType === TeamPermission;
      }),
    ).toHaveLength(1);

    expect(calls).toHaveLength(3);

    for (const args of calls) {
      expect(args.query.projectId?.toString()).toBe(PROJECT_ID);
    }
  });

  test("starts on the project's members team when one team is wanted", async () => {
    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: PROJECT_ID,
        selectedTeamIds: [],
        onChange,
        isMultiSelect: false,
      }),
    );

    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(onChange.mock.calls[0]![0]).toEqual([MEMBERS_ID]);

    // The form holds it now, and the picker shows it.
    view.rerender(
      picker({
        projectId: PROJECT_ID,
        selectedTeamIds: [MEMBERS_ID],
        onChange,
        isMultiSelect: false,
      }),
    );

    expect(view.getByTestId("selected-teams")).toHaveTextContent("Members");
    expect(capturedDropdownProps!.isMultiSelect).toBe(false);
    expect(capturedDropdownProps!.value).toEqual({
      label: "Members",
      value: MEMBERS_ID,
    });

    await settle();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("starts on the members team when several teams may be picked (a provider's attached project)", async () => {
    const onChange: OnChangeMock = makeOnChange();

    render(picker({ projectId: PROJECT_ID, selectedTeamIds: [], onChange }));

    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(onChange.mock.calls[0]![0]).toEqual([MEMBERS_ID]);
    expect(capturedDropdownProps!.isMultiSelect).toBe(true);
  });

  test("a renamed members team is the one picked", async () => {
    const onChange: OnChangeMock = makeOnChange();

    render(
      picker({ projectId: OTHER_PROJECT_ID, selectedTeamIds: [], onChange }),
    );

    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(onChange.mock.calls[0]![0]).toEqual([OTHER_ENGINEERING_ID]);
  });

  test("a project with no members team shows its teams with nothing picked", async () => {
    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: PLAIN_PROJECT_ID,
        selectedTeamIds: [],
        onChange,
        isMultiSelect: false,
      }),
    );

    await waitForTeams(view);
    await settle();

    expect(view.getByRole("button", { name: "Pick Auditors" })).toBeVisible();
    expect(view.getByTestId("selected-teams")).toHaveTextContent("(none)");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("never replaces a team already picked", async () => {
    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: PROJECT_ID,
        selectedTeamIds: [SUPPORT_ID],
        onChange,
        isMultiSelect: false,
      }),
    );

    await waitForTeams(view);
    await settle();

    expect(view.getByTestId("selected-teams")).toHaveTextContent("Support");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a team the admin cleared is not put back while the project stays the same", async () => {
    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({ projectId: PROJECT_ID, selectedTeamIds: [], onChange }),
    );

    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    // The form took the members team, then the admin removed it.
    view.rerender(
      picker({
        projectId: PROJECT_ID,
        selectedTeamIds: [MEMBERS_ID],
        onChange,
      }),
    );
    view.rerender(
      picker({ projectId: PROJECT_ID, selectedTeamIds: [], onChange }),
    );

    await settle();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(mockGetList).toHaveBeenCalledTimes(3);
    expect(view.getByTestId("selected-teams")).toHaveTextContent("(none)");
  });

  test("switching project swaps in that project's members team", async () => {
    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: PROJECT_ID,
        selectedTeamIds: [],
        onChange,
        isMultiSelect: false,
      }),
    );

    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    view.rerender(
      picker({
        projectId: OTHER_PROJECT_ID,
        selectedTeamIds: [MEMBERS_ID],
        onChange,
        isMultiSelect: false,
      }),
    );

    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalledTimes(2);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(onChange.mock.calls[1]![0]).toEqual([OTHER_ENGINEERING_ID]);
  });

  test("switching to a project with no members team drops the old team and picks nothing", async () => {
    const onChange: OnChangeMock = makeOnChange();

    render(
      picker({
        projectId: PLAIN_PROJECT_ID,
        selectedTeamIds: [MEMBERS_ID],
        onChange,
        isMultiSelect: false,
      }),
    );

    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(onChange.mock.calls[0]![0]).toEqual([]);

    await settle();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("a project switched away from before its teams arrive writes nothing", async () => {
    const onChange: OnChangeMock = makeOnChange();

    // The first project's lists only arrive when the test says so.
    const releases: Array<() => void> = [];

    mockGetList.mockImplementation((args: ListArgs) => {
      if (args.query.projectId?.toString() !== PROJECT_ID) {
        return answerList(args);
      }

      return new Promise((resolve: (value: unknown) => void) => {
        releases.push(() => {
          resolve(answerList(args));
        });
      });
    });

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: PROJECT_ID,
        selectedTeamIds: [],
        onChange,
        isMultiSelect: false,
      }),
    );

    view.rerender(
      picker({
        projectId: OTHER_PROJECT_ID,
        selectedTeamIds: [],
        onChange,
        isMultiSelect: false,
      }),
    );

    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(onChange.mock.calls[0]![0]).toEqual([OTHER_ENGINEERING_ID]);

    // The first project's answer, late: it must not land in the form.
    for (const release of releases) {
      release();
    }

    await settle();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("reads the selection as it is when the teams arrive", async () => {
    const onChange: OnChangeMock = makeOnChange();
    const releases: Array<() => void> = [];

    mockGetList.mockImplementation((args: ListArgs) => {
      return new Promise((resolve: (value: unknown) => void) => {
        releases.push(() => {
          resolve(answerList(args));
        });
      });
    });

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: PROJECT_ID,
        selectedTeamIds: [],
        onChange,
        isMultiSelect: false,
      }),
    );

    // Something else filled the value in while the teams were on their way.
    view.rerender(
      picker({
        projectId: PROJECT_ID,
        selectedTeamIds: [SUPPORT_ID],
        onChange,
        isMultiSelect: false,
      }),
    );

    for (const release of releases) {
      release();
    }

    await waitForTeams(view);
    await settle();

    expect(onChange).not.toHaveBeenCalled();
    expect(view.getByTestId("selected-teams")).toHaveTextContent("Support");
  });

  test("nothing changes while the teams are loading", async () => {
    teamsAnswer = "never";

    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: OTHER_PROJECT_ID,
        selectedTeamIds: [MEMBERS_ID],
        onChange,
        isMultiSelect: false,
      }),
    );

    expect(view.getByText("Loading teams...")).toBeVisible();

    await settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  test("teams that fail to load leave the selection alone and say why", async () => {
    teamsAnswer = "fail";

    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: OTHER_PROJECT_ID,
        selectedTeamIds: [MEMBERS_ID],
        onChange,
        isMultiSelect: false,
      }),
    );

    await waitFor(
      () => {
        expect(view.getByText("Teams could not be loaded.")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    await settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  test("a members team that cannot be worked out only means nothing is picked", async () => {
    permissionsAnswer = "fail";

    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: OTHER_PROJECT_ID,
        selectedTeamIds: [],
        onChange,
        isMultiSelect: false,
      }),
    );

    await waitForTeams(view);
    await settle();

    expect(
      view.getByRole("button", { name: "Pick Engineering" }),
    ).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a members team that takes too long to work out does not hold the teams back", async () => {
    jest.useFakeTimers();
    permissionsAnswer = "never";

    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: PROJECT_ID,
        selectedTeamIds: [],
        onChange,
        isMultiSelect: false,
      }),
    );

    expect(view.getByText("Loading teams...")).toBeVisible();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    jest.useRealTimers();

    await waitForTeams(view);
    await settle();

    expect(view.getByRole("button", { name: "Pick Members" })).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a project with no teams says so", async () => {
    const onChange: OnChangeMock = makeOnChange();

    const view: ReturnType<typeof render> = render(
      picker({
        projectId: "0198c8ec-2a1d-7f0c-9e75-384194163099",
        selectedTeamIds: [],
        onChange,
      }),
    );

    await waitFor(
      () => {
        expect(
          view.getByText("This project has no teams to choose from."),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    await settle();

    expect(onChange).not.toHaveBeenCalled();
    expect(capturedDropdownProps).toBeNull();
  });
});
