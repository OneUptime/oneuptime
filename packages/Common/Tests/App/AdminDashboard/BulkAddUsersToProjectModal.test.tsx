import "@testing-library/jest-dom";
import { fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * This modal only COLLECTS. It asks for a project, one of that project's teams
 * and whether to accept the invitations, then hands the three of them to
 * props.onSubmit - the page is what creates the TeamMembers and feeds the
 * table's shared bulk progress modal. So every test here is about what comes
 * out of onSubmit, and nothing here mocks a create: a create appearing in this
 * file would mean the collecting and the creating had been fused back together,
 * which is what keeps the picker off the progress modal in the first place.
 *
 * It is one page: the project, the team under it - the project's members team
 * as soon as the project is picked - and the auto-accept box. Adding people to
 * a project's members team is a project pick and one press. The team picker
 * on its own is tested in ProjectScopedTeamsPicker.test.tsx.
 */

/*
 * Common/jest.config.json sets no testTimeout, so the default 5s has to cover
 * mounting Modal + BasicForm + the async teams fetch.
 */
jest.setTimeout(30000);

/*
 * waitFor's own default ceiling is 1s, which is the tighter of the two and the
 * one that actually bites on a loaded CI box.
 */
const WAIT_FOR_TIMEOUT: number = 20000;

const PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162001";
const TEAM_ENGINEERING_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162002";
const TEAM_SUPPORT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162003";
const TEAM_MEMBERS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162006";
/*
 * A second project with a team of its own. The two team sets are disjoint on
 * purpose: it is the only way a test can tell "the team of the project that is
 * selected now" apart from "the team of the project that was selected before",
 * which is the whole of the stale-selection bug. Its members team is called
 * Billing: what makes a members team is the ProjectMember role, not the name.
 */
const OTHER_PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162004";
const TEAM_BILLING_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162005";
// A project whose teams hold no ProjectMember and none is called Members.
const NO_MEMBERS_PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162007";
const TEAM_AUDITORS_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162008";

const USER_ONE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162011";
const USER_TWO_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162012";
const USER_THREE_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162013";

interface TranslationCall {
  key: string;
  options: Record<string, unknown> | undefined;
}

const translationCalls: Array<TranslationCall> = [];

/*
 * t() echoes its key so assertions can target the raw key strings rather than
 * today's English wording. The second argument matters as much as the first:
 * the description is interpolated, and a key-only echo would happily pass a
 * modal that had stopped passing the user count at all.
 */
const translate: (key: string, options?: Record<string, unknown>) => string = (
  key: string,
  options?: Record<string, unknown>,
): string => {
  translationCalls.push({ key: key, options: options });

  if (options && "userCount" in options) {
    return `${key} userCount=${String(options["userCount"])}`;
  }

  return key;
};

jest.mock("react-i18next", () => {
  return {
    __esModule: true,
    useTranslation: (): {
      t: (key: string, options?: Record<string, unknown>) => string;
    } => {
      return { t: translate };
    },
  };
});

/*
 * The project field is an entity dropdown, so the real one would lazily search
 * the Projects endpoint. All this file needs from it is a way to say "the admin
 * picked this project", in the shape the real component reports a single
 * selection in: the bare id string, not an option object. Three projects are on
 * offer so a test can change its mind about which one, which is what surfaces
 * the stale-team bug.
 */
jest.mock("Common/UI/Components/EntityDropdown/EntityDropdown", () => {
  return {
    __esModule: true,
    default: (props: {
      onChange?: ((value: string) => void) | undefined;
    }): React.ReactElement => {
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
              props.onChange?.(OTHER_PROJECT_ID);
            }}
          >
            Choose the other project
          </button>
          <button
            type="button"
            onClick={() => {
              props.onChange?.(NO_MEMBERS_PROJECT_ID);
            }}
          >
            Choose the project with no members team
          </button>
        </div>
      );
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
  /*
   * Captured, not rendered: in single-select mode the real Dropdown is handed
   * one option and in multi-select an array of them, so the shape of this is
   * the picker's own answer to which mode it thinks it is in.
   */
  value?: unknown;
  placeholder?: string | undefined;
  onChange?: ((value: string) => void) | undefined;
}

let capturedDropdownProps: DropdownStubProps | null = null;

/*
 * The team picker renders this. react-select in jsdom is more machinery than
 * signal, so it is stood in for - but DROPDOWN_MENU_Z_INDEX has to come along:
 * it is a real value export of the module and EntityDropdown imports it, so a
 * stub without it crashes that importer instead of this file's subject.
 */
jest.mock("Common/UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 60,
    default: (props: DropdownStubProps): React.ReactElement => {
      capturedDropdownProps = props;

      const selected: DropdownStubOption | undefined = props.value as
        | DropdownStubOption
        | undefined;

      return (
        <div>
          <p data-testid="selected-team">{selected?.label || "(none)"}</p>
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

/*
 * The teams come from the admin ModelAPI - the one that sends no tenant header,
 * because a master admin is not inside any project.
 */
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

import BulkAddUsersToProjectModal, {
  BulkAddUsersToProjectSelection,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/User/BulkAddUsersToProjectModal";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Team from "../../../Models/DatabaseModels/Team";
import TeamPermission from "../../../Models/DatabaseModels/TeamPermission";
import User from "../../../Models/DatabaseModels/User";

const mockGetList: jest.MockedFunction<any> =
  AdminModelAPI.getList as unknown as jest.MockedFunction<any>;

const LOCALE_FILE_PATH: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/AdminDashboard/src/Locales/en.json",
);

interface TeamFixture {
  id: string;
  name: string;
  permission: Permission;
}

/*
 * The projects, with nothing in common. `getList` is scoped by projectId, so a
 * mock that ignored the query would hand back the same teams whichever project
 * was chosen - and a picker that kept showing the old project's teams would
 * look exactly like one that had refetched.
 */
const PROJECT_TEAMS: Record<string, Array<TeamFixture>> = {
  [PROJECT_ID]: [
    {
      id: TEAM_ENGINEERING_ID,
      name: "Engineering",
      permission: Permission.ProjectAdmin,
    },
    {
      id: TEAM_MEMBERS_ID,
      name: "Members",
      permission: Permission.ProjectMember,
    },
    { id: TEAM_SUPPORT_ID, name: "Support", permission: Permission.Viewer },
  ],
  [OTHER_PROJECT_ID]: [
    {
      id: TEAM_BILLING_ID,
      name: "Billing",
      permission: Permission.ProjectMember,
    },
  ],
  [NO_MEMBERS_PROJECT_ID]: [
    {
      id: TEAM_AUDITORS_ID,
      name: "Auditors",
      permission: Permission.Viewer,
    },
  ],
};

let projectTeams: Record<string, Array<TeamFixture>> = PROJECT_TEAMS;

interface ListArgs {
  modelType: unknown;
  query?: { projectId?: ObjectID | undefined } | undefined;
  sort?: Record<string, unknown> | undefined;
}

// The project's teams, or their permission rows, as the API answers them.
const answerList: (args: ListArgs) => Promise<unknown> = async (
  args: ListArgs,
): Promise<unknown> => {
  const fixtures: Array<TeamFixture> =
    projectTeams[args?.query?.projectId?.toString() || ""] || [];

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
};

type MakeUserFunction = (id: string) => User;

// The modal reads nothing off a user but how many of them there are.
const makeUser: MakeUserFunction = (id: string): User => {
  const user: User = new User();
  user._id = id;
  return user;
};

type RenderModalFunction = (
  overrides?: Partial<React.ComponentProps<typeof BulkAddUsersToProjectModal>>,
) => ReturnType<typeof render>;

const renderModal: RenderModalFunction = (
  overrides: Partial<
    React.ComponentProps<typeof BulkAddUsersToProjectModal>
  > = {},
): ReturnType<typeof render> => {
  return render(
    <BulkAddUsersToProjectModal
      users={[makeUser(USER_ONE_ID), makeUser(USER_TWO_ID)]}
      onClose={jest.fn()}
      onSubmit={jest.fn()}
      {...overrides}
    />,
  );
};

type ClickFunction = (view: ReturnType<typeof render>) => void;

const chooseProject: ClickFunction = (
  view: ReturnType<typeof render>,
): void => {
  fireEvent.click(view.getByRole("button", { name: "Choose a project" }));
};

const chooseOtherProject: ClickFunction = (
  view: ReturnType<typeof render>,
): void => {
  fireEvent.click(
    view.getByRole("button", { name: "Choose the other project" }),
  );
};

const chooseProjectWithoutMembersTeam: ClickFunction = (
  view: ReturnType<typeof render>,
): void => {
  fireEvent.click(
    view.getByRole("button", {
      name: "Choose the project with no members team",
    }),
  );
};

const submitModal: ClickFunction = (view: ReturnType<typeof render>): void => {
  fireEvent.click(view.getByTestId("modal-footer-submit-button"));
};

type WaitForTeamFunction = (
  view: ReturnType<typeof render>,
  teamName: string,
) => Promise<void>;

// The picker shows this team as the one selected.
const waitForSelectedTeam: WaitForTeamFunction = async (
  view: ReturnType<typeof render>,
  teamName: string,
): Promise<void> => {
  await waitFor(
    () => {
      expect(view.getByTestId("selected-team")).toHaveTextContent(teamName);
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
};

// The picker offers this team (its teams have loaded).
const waitForTeamOnOffer: WaitForTeamFunction = async (
  view: ReturnType<typeof render>,
  teamName: string,
): Promise<void> => {
  await waitFor(
    () => {
      expect(
        view.getByRole("button", { name: `Pick ${teamName}` }),
      ).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
};

type OnSubmitFunction = (selection: BulkAddUsersToProjectSelection) => void;

type MakeOnSubmitFunction = () => OnSubmitFunction;

const makeOnSubmit: MakeOnSubmitFunction = (): OnSubmitFunction => {
  return jest.fn((_selection: BulkAddUsersToProjectSelection): void => {});
};

type SubmittedSelectionFunction = (
  onSubmit: OnSubmitFunction,
) => BulkAddUsersToProjectSelection;

const submittedSelection: SubmittedSelectionFunction = (
  onSubmit: OnSubmitFunction,
): BulkAddUsersToProjectSelection => {
  const submitMock: jest.MockedFunction<any> =
    onSubmit as unknown as jest.MockedFunction<any>;

  return submitMock.mock.calls[0]![0];
};

type ChooseTeamFunction = (
  view: ReturnType<typeof render>,
  teamName: string,
) => void;

const chooseTeam: ChooseTeamFunction = (
  view: ReturnType<typeof render>,
  teamName: string,
): void => {
  fireEvent.click(view.getByRole("button", { name: `Pick ${teamName}` }));
};

type SettleFunction = () => Promise<void>;

/*
 * Drains the microtask queue so a `.then` that was going to fire has fired.
 * "onSubmit was not called" is only worth anything once the promise chain the
 * call would have come from has had its turn.
 */
const settle: SettleFunction = async (): Promise<void> => {
  for (let index: number = 0; index < 10; index++) {
    await Promise.resolve();
  }
};

describe("BulkAddUsersToProjectModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    translationCalls.length = 0;
    capturedDropdownProps = null;
    projectTeams = PROJECT_TEAMS;

    mockGetList.mockImplementation((args: ListArgs): Promise<unknown> => {
      return answerList(args);
    });
  });

  /*
   * One page. The project, the team under it and the auto-accept box are all
   * on screen together, with no step list and no Next: the team is the chosen
   * project's, so until a project is picked the picker says so, and asks the
   * server nothing - a team picker that fetched before a project exists would
   * offer the teams of no project at all.
   */
  test("asks for the project, its team and the invitations on one page", async () => {
    const view: ReturnType<typeof render> = renderModal();

    expect(
      view.getByText("pages.users.bulkAddToProjectFieldProject"),
    ).toBeVisible();
    expect(
      view.getByText("pages.users.bulkAddToProjectFieldTeam"),
    ).toBeVisible();
    expect(
      view.getByText("pages.users.bulkAddToProjectFieldAutoAccept"),
    ).toBeVisible();

    // Under the team, until a project is picked.
    expect(
      view.getByText("pages.users.bulkAddToProjectSelectProject"),
    ).toBeVisible();

    // No step list, no "Step 1 of 2", no Next.
    expect(
      view.queryByRole("navigation", { name: "Progress" }),
    ).not.toBeInTheDocument();
    expect(view.queryByText(/Step 1 of/)).not.toBeInTheDocument();
    expect(view.queryByRole("button", { name: "Next" })).toBeNull();

    // The footer offers the action from the start.
    expect(view.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "pages.users.bulkAddToProjectSubmit",
    );

    await settle();

    expect(capturedDropdownProps).toBeNull();
    expect(mockGetList).not.toHaveBeenCalled();
  });

  /*
   * The query is the whole of the scoping. Without projectId on it the picker
   * would offer every team on the instance, and an admin picking one would move
   * users into a project they never chose.
   */
  test("picking a project loads its teams, by name, and starts on its members team", async () => {
    const view: ReturnType<typeof render> = renderModal();

    chooseProject(view);
    await waitForSelectedTeam(view, "Members");

    const calls: Array<ListArgs> = mockGetList.mock.calls.map(
      (call: Array<unknown>): ListArgs => {
        return call[0] as ListArgs;
      },
    );

    for (const call of calls) {
      expect(Object.keys(call.query || {})).toEqual(["projectId"]);
      expect(call.query?.projectId?.toString()).toBe(PROJECT_ID);
    }

    // The options, by name; the members team from the teams and their roles.
    expect(
      calls.filter((call: ListArgs) => {
        return call.modelType === Team;
      }),
    ).toHaveLength(2);
    expect(
      calls.some((call: ListArgs) => {
        return (
          call.modelType === Team &&
          JSON.stringify(call.sort) ===
            JSON.stringify({ name: SortOrder.Ascending })
        );
      }),
    ).toBe(true);
    expect(
      calls.filter((call: ListArgs) => {
        return call.modelType === TeamPermission;
      }),
    ).toHaveLength(1);

    // Every team of the project is still on offer.
    expect(
      view.getByRole("button", { name: "Pick Engineering" }),
    ).toBeVisible();
    expect(view.getByRole("button", { name: "Pick Support" })).toBeVisible();
  });

  /*
   * The one thing this component exists to produce, in two presses: the
   * project, then Add. hasAcceptedInvitation has to come out false when the
   * box was never ticked rather than undefined - TeamMemberService rejects an
   * already-accepted membership for anyone who is not a master admin, so the
   * flag is not a field to leave unset.
   */
  test("adds to the project's members team with the project picked and one press", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    await waitForSelectedTeam(view, "Members");
    submitModal(view);

    await waitFor(
      () => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const selection: BulkAddUsersToProjectSelection =
      submittedSelection(onSubmit);

    expect(selection.projectId.toString()).toBe(PROJECT_ID);
    expect(selection.teamId.toString()).toBe(TEAM_MEMBERS_ID);
    expect(selection.hasAcceptedInvitation).toBe(false);
  });

  test("hands the caller another team of the project when the admin picks one", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    await waitForSelectedTeam(view, "Members");
    chooseTeam(view, "Engineering");
    await waitForSelectedTeam(view, "Engineering");
    submitModal(view);

    await waitFor(
      () => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const selection: BulkAddUsersToProjectSelection =
      submittedSelection(onSubmit);

    expect(selection.projectId.toString()).toBe(PROJECT_ID);
    expect(selection.teamId.toString()).toBe(TEAM_ENGINEERING_ID);
  });

  /*
   * The checkbox is the difference between users who are invited and users who
   * are members. Dropping it on the way out would silently leave every bulk-added
   * user pending, which looks identical in the progress modal.
   */
  test("reports the auto-accept checkbox when it is ticked", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    await waitForSelectedTeam(view, "Members");
    fireEvent.click(view.getByRole("checkbox"));
    submitModal(view);

    await waitFor(
      () => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(submittedSelection(onSubmit).hasAcceptedInvitation).toBe(true);
  });

  /*
   * A submit with no project must not reach the caller: BasicForm's own
   * required-field validation holds it, before the modal's guards.
   */
  test("does not submit before a project is picked", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    submitModal(view);

    await settle();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(mockGetList).not.toHaveBeenCalled();
  });

  /*
   * A project without a members team (no team holds ProjectMember for the
   * whole project and none is called Members) starts with nothing picked, as
   * the whole form did before. A submit with no team must not reach the
   * caller: BasicForm's required-field validation holds it, and the form
   * stays as it is until a team is picked.
   */
  test("a project with no members team waits for a team to be picked", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProjectWithoutMembersTeam(view);
    await waitForTeamOnOffer(view, "Auditors");
    await settle();

    expect(view.getByTestId("selected-team")).toHaveTextContent("(none)");

    submitModal(view);
    await settle();

    expect(onSubmit).not.toHaveBeenCalled();

    chooseTeam(view, "Auditors");
    submitModal(view);

    await waitFor(
      () => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(submittedSelection(onSubmit).projectId.toString()).toBe(
      NO_MEMBERS_PROJECT_ID,
    );
    expect(submittedSelection(onSubmit).teamId.toString()).toBe(
      TEAM_AUDITORS_ID,
    );
  });

  /*
   * Changing your mind about the project after having picked a team.
   *
   * The team lives in the form value, and the form value survives the switch.
   * Refetching the teams alone does not fix that: the dropdown filters its
   * selection against the options it now has, so the old project's team stops
   * being *shown* while it is still *set*. Required-validation reads the value,
   * not the dropdown, so the form would happily submit, and nothing downstream
   * would catch it - TeamMemberService checks that the team exists, not that it
   * belongs to the project being written - leaving memberships whose team is in
   * one project and whose projectId is another.
   *
   * So: pick a project, pick its team, pick the other project. The team of the
   * first project must not come out the other end: the other project's members
   * team takes its place.
   */
  test("does not carry a team of the old project into the new one", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    await waitForSelectedTeam(view, "Members");
    chooseTeam(view, "Engineering");
    await waitForSelectedTeam(view, "Engineering");

    chooseOtherProject(view);
    await waitForSelectedTeam(view, "Billing");

    // The refetch really was scoped to the newly chosen project.
    const otherProjectCalls: Array<ListArgs> = mockGetList.mock.calls
      .map((call: Array<unknown>): ListArgs => {
        return call[0] as ListArgs;
      })
      .filter((call: ListArgs) => {
        return call.query?.projectId?.toString() === OTHER_PROJECT_ID;
      });

    expect(otherProjectCalls).toHaveLength(3);

    // The old project's teams are not on offer.
    expect(
      view.queryByRole("button", { name: "Pick Engineering" }),
    ).not.toBeInTheDocument();

    submitModal(view);

    await waitFor(
      () => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const selection: BulkAddUsersToProjectSelection =
      submittedSelection(onSubmit);

    expect(selection.projectId.toString()).toBe(OTHER_PROJECT_ID);
    expect(selection.teamId.toString()).toBe(TEAM_BILLING_ID);
  });

  /*
   * And the stale team is dropped even when the new project has no members
   * team to put in its place: nothing is picked, and nothing reaches the
   * caller carrying the first project's team.
   */
  test("drops the old project's team when the new one has no members team", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    await waitForSelectedTeam(view, "Members");

    chooseProjectWithoutMembersTeam(view);
    await waitForTeamOnOffer(view, "Auditors");
    await settle();

    expect(view.getByTestId("selected-team")).toHaveTextContent("(none)");

    submitModal(view);
    await settle();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  /*
   * A project with no teams cannot be a destination: there is no team to create
   * a TeamMember in. The picker has to say so rather than render an empty
   * dropdown that looks like it is still loading, and the form must not be
   * submittable out of that state.
   */
  test("cannot be submitted when the chosen project has no teams", async () => {
    projectTeams = {};

    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);

    await waitFor(
      () => {
        expect(
          view.getByText("This project has no teams to choose from."),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    // No dropdown at all, so there is nothing that could be picked.
    expect(capturedDropdownProps).toBeNull();

    submitModal(view);

    await settle();

    expect(onSubmit).not.toHaveBeenCalled();
  });

  /*
   * Two presses of the footer button, one run.
   *
   * The button is not disabled after the first press - the page closes this
   * modal on its own schedule, and BasicForm.submitForm is happy to be called
   * again - so without a guard the second press starts a second pass over the
   * same selection. The two passes share the page's bulk progress modal: the
   * first one finishing re-enables its Close button while the second is still
   * creating memberships, so the admin is invited to close a run that is only
   * half done.
   */
  test("submits once even when the button is pressed twice", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    await waitForSelectedTeam(view, "Members");

    submitModal(view);

    await waitFor(
      () => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    // The modal is still mounted and still shows a live submit button.
    expect(view.getByTestId("modal-footer-submit-button")).toBeVisible();

    submitModal(view);

    await settle();

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  /*
   * One TeamMember is created per user, in one team. The picker defaults to
   * multi-select - it was written for the SSO attachment forms, which provision
   * into several teams - so this modal has to turn that off.
   *
   * What is pinned here is the two things the components actually decide:
   * `isMultiSelect={false}` reaching the dropdown, and the single-select `value`
   * being one option rather than an array of them (the picker's
   * `isMultiSelect ? selectedOptions : selectedOptions[0]`). Then that a second
   * pick replaces the first instead of piling up next to it, which is the
   * modal's `teamIds[0]`.
   */
  test("takes one team, not a list of them", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    await waitForSelectedTeam(view, "Members");

    expect(capturedDropdownProps!.isMultiSelect).toBe(false);
    expect(capturedDropdownProps!.value).toEqual({
      label: "Members",
      value: TEAM_MEMBERS_ID,
    });

    chooseTeam(view, "Support");

    await waitFor(
      () => {
        expect(capturedDropdownProps!.value).toEqual({
          label: "Support",
          value: TEAM_SUPPORT_ID,
        });
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    chooseTeam(view, "Engineering");
    submitModal(view);

    await waitFor(
      () => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(submittedSelection(onSubmit).teamId.toString()).toBe(
      TEAM_ENGINEERING_ID,
    );
  });

  /*
   * How many users this is about is the one thing the admin cannot see from
   * inside the modal - the table's selection is behind it. The count is passed
   * as `userCount` and not `count` on purpose: i18next reads a `count` option as
   * a request for the plural forms (`..._one` / `..._other`), which these keys
   * do not define, so the lookup would miss and the sentence would come out as
   * the raw key.
   */
  test("says how many users are being added", () => {
    const view: ReturnType<typeof render> = renderModal({
      users: [
        makeUser(USER_ONE_ID),
        makeUser(USER_TWO_ID),
        makeUser(USER_THREE_ID),
      ],
    });

    expect(view.getByTestId("modal-description")).toHaveTextContent(
      "pages.users.bulkAddToProjectDescription userCount=3",
    );

    const descriptionCall: TranslationCall | undefined = translationCalls.find(
      (call: TranslationCall) => {
        return call.key === "pages.users.bulkAddToProjectDescription";
      },
    );

    expect(descriptionCall?.options).toEqual({ userCount: 3 });
  });

  /*
   * Closing has to stay a pure cancel. The page treats onSubmit as the signal to
   * close the picker and start creating memberships, so a close that also
   * submitted would add every selected user to a team the admin just backed out
   * of.
   */
  test("closing cancels and never submits", () => {
    const onClose: () => void = jest.fn((): void => {});
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({
      onClose: onClose,
      onSubmit: onSubmit,
    });

    fireEvent.click(view.getByTestId("modal-footer-close-button"));
    expect(onClose).toHaveBeenCalledTimes(1);

    // The header's X is the other way out, and it has to mean the same thing.
    fireEvent.click(view.getByTestId("close-button"));
    expect(onClose).toHaveBeenCalledTimes(2);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  /*
   * Every string in here is an i18n key, and a key with no entry renders as the
   * key itself - "pages.users.bulkAddToProjectFieldTeam" in the middle of the
   * form. Nothing else catches that: the modal renders, the form works, and the
   * only symptom is the wording. So the keys are collected from the component
   * as it is actually driven, and each one is looked up in the locale file.
   *
   * Only the modal's own lookups count. Modal and BasicForm re-translate the
   * strings handed to them through the same t(), always with a `defaultValue` -
   * those are whole sentences, not keys, and are filtered back out here.
   */
  test("asks only for keys that exist in the admin locale file", async () => {
    const view: ReturnType<typeof render> = renderModal();

    chooseProject(view);
    await waitForSelectedTeam(view, "Members");

    const localeStrings: unknown = JSON.parse(
      fs.readFileSync(LOCALE_FILE_PATH, "utf8"),
    );

    type ResolveKeyFunction = (key: string) => unknown;

    const resolveKey: ResolveKeyFunction = (key: string): unknown => {
      return key
        .split(".")
        .reduce((current: unknown, part: string): unknown => {
          if (current && typeof current === "object") {
            return (current as Record<string, unknown>)[part];
          }

          return undefined;
        }, localeStrings);
    };

    const requestedKeys: Array<string> = Array.from(
      new Set(
        translationCalls
          .filter((call: TranslationCall) => {
            return !call.options || !("defaultValue" in call.options);
          })
          .map((call: TranslationCall) => {
            return call.key;
          }),
      ),
    );

    // Guards the guard: an empty list would make the loop below vacuously true.
    expect(requestedKeys).toContain("pages.users.bulkAddToProjectTitle");
    expect(requestedKeys).toContain("pages.users.bulkAddToProjectFieldTeam");

    const unresolvedKeys: Array<string> = requestedKeys.filter(
      (key: string) => {
        const value: unknown = resolveKey(key);

        return typeof value !== "string" || value.length === 0;
      },
    );

    expect(unresolvedKeys).toEqual([]);

    // The step names and the Next of the old two-step form are gone for good.
    for (const retired of [
      "pages.users.bulkAddToProjectNext",
      "pages.users.bulkAddToProjectStepProject",
      "pages.users.bulkAddToProjectStepTeam",
    ]) {
      expect(requestedKeys).not.toContain(retired);
      expect(resolveKey(retired)).toBeUndefined();
    }
  });
});
