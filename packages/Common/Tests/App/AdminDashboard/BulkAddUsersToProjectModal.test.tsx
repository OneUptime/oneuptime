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
 */

/*
 * Common/jest.config.json sets no testTimeout, so the default 5s has to cover
 * mounting Modal + BasicForm + the async teams fetch, twice over in the tests
 * that walk both steps.
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
/*
 * A second project with a team of its own. The two team sets are disjoint on
 * purpose: it is the only way a test can tell "the team of the project that is
 * selected now" apart from "the team of the project that was selected before",
 * which is the whole of the stale-selection bug.
 */
const OTHER_PROJECT_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162004";
const TEAM_BILLING_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194162005";
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
 * selection in: the bare id string, not an option object. Two projects are on
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

      return (
        <div>
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
/*
 * The picker is rendered by this modal, but a few of its rules cannot be driven
 * through the modal at all - an in-flight fetch and a failed fetch are states
 * the step rail cannot hold still in - so it is also exercised on its own here,
 * with the same isMultiSelect={false} wiring the modal gives it.
 */
import ProjectScopedTeamsPicker from "../../../../App/FeatureSet/AdminDashboard/src/Components/GlobalProvider/ProjectScopedTeamsPicker";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";

const mockGetList: jest.MockedFunction<any> =
  AdminModelAPI.getList as unknown as jest.MockedFunction<any>;

const LOCALE_FILE_PATH: string = path.join(
  __dirname,
  "../../../../App/FeatureSet/AdminDashboard/src/Locales/en.json",
);

type MakeTeamFunction = (id: string, name: string) => Team;

const makeTeam: MakeTeamFunction = (id: string, name: string): Team => {
  const team: Team = new Team();
  team._id = id;
  team.name = name;
  return team;
};

type TeamsOfProjectFunction = (projectId: string) => Array<Team>;

/*
 * Two projects with nothing in common. `getList` is scoped by projectId, so a
 * mock that ignored the query would hand back the same teams whichever project
 * was chosen - and a picker that kept showing the old project's teams would
 * look exactly like one that had refetched.
 */
const teamsOfProject: TeamsOfProjectFunction = (
  projectId: string,
): Array<Team> => {
  if (projectId === OTHER_PROJECT_ID) {
    return [makeTeam(TEAM_BILLING_ID, "Billing")];
  }

  return [
    makeTeam(TEAM_ENGINEERING_ID, "Engineering"),
    makeTeam(TEAM_SUPPORT_ID, "Support"),
  ];
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

type ChooseProjectFunction = (view: ReturnType<typeof render>) => void;

const chooseProject: ChooseProjectFunction = (
  view: ReturnType<typeof render>,
): void => {
  fireEvent.click(view.getByRole("button", { name: "Choose a project" }));
};

const chooseOtherProject: ChooseProjectFunction = (
  view: ReturnType<typeof render>,
): void => {
  fireEvent.click(
    view.getByRole("button", { name: "Choose the other project" }),
  );
};

type GoBackToProjectStepFunction = (
  view: ReturnType<typeof render>,
) => Promise<void>;

/*
 * The way back is the step rail, the same as in the browser: a completed step
 * is clickable and returns the form to it. There is no back button - the modal
 * footer only ever goes forward - so this is the only route an admin has to
 * change their mind about the project after picking a team.
 */
const goBackToProjectStep: GoBackToProjectStepFunction = async (
  view: ReturnType<typeof render>,
): Promise<void> => {
  fireEvent.click(view.getByText("pages.users.bulkAddToProjectStepProject"));

  await waitFor(
    () => {
      expect(view.getByTestId("modal-footer-submit-button")).toHaveTextContent(
        "pages.users.bulkAddToProjectNext",
      );
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
};

type SubmitFunction = (view: ReturnType<typeof render>) => void;

const submitModal: SubmitFunction = (view: ReturnType<typeof render>): void => {
  fireEvent.click(view.getByTestId("modal-footer-submit-button"));
};

type GoToTeamStepFunction = (
  view: ReturnType<typeof render>,
  expectedTeamName?: string,
) => Promise<void>;

/*
 * Step two is where every interesting assertion lives, and getting there means
 * both the step change and the teams fetch have to have settled. The team named
 * here is the one the fetch is waited on through, so it has to be a team of the
 * project that was just chosen.
 */
const goToTeamStep: GoToTeamStepFunction = async (
  view: ReturnType<typeof render>,
  expectedTeamName: string = "Engineering",
): Promise<void> => {
  submitModal(view);

  await waitFor(
    () => {
      expect(view.getByTestId("modal-footer-submit-button")).toHaveTextContent(
        "pages.users.bulkAddToProjectSubmit",
      );
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  await waitFor(
    () => {
      expect(
        view.getByRole("button", { name: `Pick ${expectedTeamName}` }),
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

describe("BulkAddUsersToProjectModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    translationCalls.length = 0;
    capturedDropdownProps = null;

    mockGetList.mockImplementation(
      async (args: {
        query?: { projectId?: ObjectID | undefined } | undefined;
      }): Promise<any> => {
        const teams: Array<Team> = teamsOfProject(
          args?.query?.projectId?.toString() || "",
        );

        return {
          data: teams,
          count: teams.length,
        };
      },
    );
  });

  type RenderPickerFunction = (overrides: {
    projectId: ObjectID;
    selectedTeamIds: Array<string>;
    onChange: (teamIds: Array<string>) => void;
  }) => ReturnType<typeof render>;

  /*
   * The picker exactly as this modal configures it: one team, not a list.
   */
  const renderPicker: RenderPickerFunction = (overrides: {
    projectId: ObjectID;
    selectedTeamIds: Array<string>;
    onChange: (teamIds: Array<string>) => void;
  }): ReturnType<typeof render> => {
    return render(
      <ProjectScopedTeamsPicker
        isMultiSelect={false}
        projectId={overrides.projectId}
        selectedTeamIds={overrides.selectedTeamIds}
        onChange={overrides.onChange}
      />,
    );
  };

  type SettleFunction = () => Promise<void>;

  /*
   * Drains the microtask queue so a `.then` that was going to fire has fired.
   * "onChange was not called" is only worth anything once the promise chain the
   * call would have come from has had its turn.
   */
  const settle: SettleFunction = async (): Promise<void> => {
    for (let index: number = 0; index < 10; index++) {
      await Promise.resolve();
    }
  };

  /*
   * The teams on offer are the chosen project's, so there is nothing to ask on
   * step one but the project. A team picker rendered alongside it would either
   * sit there empty or - worse - fetch before a project exists and offer the
   * teams of no project at all.
   */
  test("asks for the project on its own step, with no team picker beside it", () => {
    const view: ReturnType<typeof render> = renderModal();

    expect(
      view.getByText("pages.users.bulkAddToProjectFieldProject"),
    ).toBeVisible();
    expect(
      view.queryByText("pages.users.bulkAddToProjectFieldTeam"),
    ).not.toBeInTheDocument();
    expect(capturedDropdownProps).toBeNull();
    expect(mockGetList).not.toHaveBeenCalled();
  });

  /*
   * The query is the whole of the scoping. Without projectId on it the picker
   * would offer every team on the instance, and an admin picking one would move
   * users into a project they never chose.
   */
  test("fetches the chosen project's teams, by name, on the team step", async () => {
    const view: ReturnType<typeof render> = renderModal();

    chooseProject(view);
    await goToTeamStep(view);

    expect(mockGetList).toHaveBeenCalledTimes(1);

    const getListArgs: {
      modelType: unknown;
      query: Record<string, ObjectID>;
      sort: Record<string, SortOrder>;
    } = mockGetList.mock.calls[0]![0];

    expect(getListArgs.modelType).toBe(Team);
    expect(Object.keys(getListArgs.query)).toEqual(["projectId"]);
    expect(getListArgs.query["projectId"]?.toString()).toBe(PROJECT_ID);
    expect(getListArgs.sort).toEqual({ name: SortOrder.Ascending });
  });

  /*
   * The one thing this component exists to produce. hasAcceptedInvitation has
   * to come out false when the box was never ticked rather than undefined -
   * TeamMemberService rejects an already-accepted membership for anyone who is
   * not a master admin, so the flag is not a field to leave unset.
   */
  test("hands the caller the chosen project and team once", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    await goToTeamStep(view);
    chooseTeam(view, "Engineering");
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
    expect(selection.hasAcceptedInvitation).toBe(false);
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
    await goToTeamStep(view);
    chooseTeam(view, "Engineering");
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
   * A submit with no team must not reach the caller. It would either create
   * memberships against an undefined team or - since the page closes this modal
   * before it starts creating - tear the picker down over nothing.
   *
   * Which layer refuses: BasicForm's own required-field validation. `team` is
   * `required: true`, so submitForm collects a validation error and returns
   * before it ever calls props.onSubmit, which means the modal's own
   * `!teamId` guard is not entered and its
   * `pages.users.bulkAddToProjectSelectTeam` message is not what is being
   * pinned here. This test pins the outcome - nothing reaches the caller and
   * the form stays on the team step - not the guard.
   */
  test("does not submit while no team has been chosen", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    await goToTeamStep(view);
    submitModal(view);

    // Still on the last step, still asking - it held rather than advanced.
    await waitFor(
      () => {
        expect(
          view.getByTestId("modal-footer-submit-button"),
        ).toHaveTextContent("pages.users.bulkAddToProjectSubmit");
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(onSubmit).not.toHaveBeenCalled();
  });

  /*
   * Changing your mind about the project after having picked a team.
   *
   * The team lives in the form value, and the form value survives the walk back
   * to step one. Refetching the teams alone does not fix that: the dropdown
   * filters its selection against the options it now has, so the old project's
   * team stops being *shown* while it is still *set*. Required-validation reads
   * the value, not the dropdown, so the form would happily submit, and nothing
   * downstream would catch it - TeamMemberService checks that the team exists,
   * not that it belongs to the project being written - leaving memberships
   * whose team is in one project and whose projectId is another.
   *
   * So: pick a project, pick its team, go back, pick the other project. The
   * team of the first project must not come out the other end.
   */
  test("does not carry a team of the old project into the new one", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    await goToTeamStep(view);
    chooseTeam(view, "Engineering");

    await goBackToProjectStep(view);
    chooseOtherProject(view);
    await goToTeamStep(view, "Billing");

    // The refetch really was scoped to the newly chosen project.
    expect(mockGetList).toHaveBeenCalledTimes(2);
    expect(
      (
        mockGetList.mock.calls[1]![0] as {
          query: Record<string, ObjectID>;
        }
      ).query["projectId"]?.toString(),
    ).toBe(OTHER_PROJECT_ID);

    // The old project's team is not on offer, and nothing is selected anymore.
    expect(
      view.queryByRole("button", { name: "Pick Engineering" }),
    ).not.toBeInTheDocument();
    expect(capturedDropdownProps!.value).toBeUndefined();

    submitModal(view);

    /*
     * Nothing may reach the caller carrying the first project's team. In
     * practice the cleared value fails required-validation and the form stays
     * on the team step, but the assertion is written to accept any outcome
     * except a membership pointing at a team of the project that was
     * abandoned.
     */
    await waitFor(
      () => {
        expect(
          view.getByTestId("modal-footer-submit-button"),
        ).toHaveTextContent("pages.users.bulkAddToProjectSubmit");
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    await settle();

    const submitMock: jest.MockedFunction<any> =
      onSubmit as unknown as jest.MockedFunction<any>;

    const submittedTeamIds: Array<string> = submitMock.mock.calls.map(
      (call: Array<BulkAddUsersToProjectSelection>) => {
        return call[0]!.teamId.toString();
      },
    );

    expect(submittedTeamIds).not.toContain(TEAM_ENGINEERING_ID);
    expect(submittedTeamIds).not.toContain(TEAM_SUPPORT_ID);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  /*
   * The same invariant one layer down, where it is stated rather than inferred:
   * a selection the fetched project does not offer is dropped, and only that
   * one - ids that ARE the project's teams stay. A blanket clear would be just
   * as wrong in the other direction, wiping a valid pick on every refetch.
   */
  test("drops only the team ids the fetched project does not offer", async () => {
    const onChange: (teamIds: Array<string>) => void = jest.fn(
      (_teamIds: Array<string>): void => {},
    );

    renderPicker({
      projectId: new ObjectID(OTHER_PROJECT_ID),
      selectedTeamIds: [TEAM_ENGINEERING_ID, TEAM_BILLING_ID],
      onChange: onChange,
    });

    await waitFor(
      () => {
        expect(onChange).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const onChangeMock: jest.MockedFunction<any> =
      onChange as unknown as jest.MockedFunction<any>;

    expect(onChangeMock.mock.calls[0]![0]).toEqual([TEAM_BILLING_ID]);
  });

  /*
   * The other half of that: when everything selected is still a team of the
   * project, the picker must leave the value alone. Reporting a change here
   * would make the form dirty - and, in a form that reacted to its own onChange
   * by re-rendering the custom element, would be a loop.
   */
  test("leaves a selection the fetched project does offer alone", async () => {
    const onChange: (teamIds: Array<string>) => void = jest.fn(
      (_teamIds: Array<string>): void => {},
    );

    const view: ReturnType<typeof render> = renderPicker({
      projectId: new ObjectID(PROJECT_ID),
      selectedTeamIds: [TEAM_ENGINEERING_ID],
      onChange: onChange,
    });

    await waitFor(
      () => {
        expect(
          view.getByRole("button", { name: "Pick Engineering" }),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    await settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  /*
   * Clearing is bound to the fetch's success path, and this is why. While the
   * request is in flight the picker knows nothing about which teams the project
   * has, so a selection cleared here would be one thrown away on no evidence -
   * and the admin, watching "Loading teams...", would never see it go.
   */
  test("does not clear the selection while the teams are still loading", async () => {
    mockGetList.mockImplementation((): Promise<any> => {
      // Never settles: the picker is held in its loading state for the test.
      return new Promise((): void => {});
    });

    const onChange: (teamIds: Array<string>) => void = jest.fn(
      (_teamIds: Array<string>): void => {},
    );

    const view: ReturnType<typeof render> = renderPicker({
      projectId: new ObjectID(OTHER_PROJECT_ID),
      selectedTeamIds: [TEAM_ENGINEERING_ID],
      onChange: onChange,
    });

    expect(view.getByText("Loading teams...")).toBeVisible();

    await settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  /*
   * And when the request fails outright. The teams may well be fine and the
   * network not; discarding the pick on an error would turn a retryable blip
   * into silently lost input, on top of the error the admin is already reading.
   */
  test("does not clear the selection when the teams fail to load", async () => {
    mockGetList.mockImplementation(async (): Promise<any> => {
      throw new Error("Teams could not be loaded.");
    });

    const onChange: (teamIds: Array<string>) => void = jest.fn(
      (_teamIds: Array<string>): void => {},
    );

    const view: ReturnType<typeof render> = renderPicker({
      projectId: new ObjectID(OTHER_PROJECT_ID),
      selectedTeamIds: [TEAM_ENGINEERING_ID],
      onChange: onChange,
    });

    await waitFor(
      () => {
        expect(view.getByText("Teams could not be loaded.")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    await settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  /*
   * A project with no teams cannot be a destination: there is no team to create
   * a TeamMember in. The picker has to say so rather than render an empty
   * dropdown that looks like it is still loading, and the form must not be
   * submittable out of that state.
   */
  test("cannot be submitted when the chosen project has no teams", async () => {
    mockGetList.mockImplementation(async (): Promise<any> => {
      return { data: [], count: 0 };
    });

    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    submitModal(view);

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

    await waitFor(
      () => {
        expect(
          view.getByTestId("modal-footer-submit-button"),
        ).toHaveTextContent("pages.users.bulkAddToProjectSubmit");
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

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
    await goToTeamStep(view);
    chooseTeam(view, "Engineering");

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
   *
   * What is NOT pinned: that the emitted teamId is a scalar and not an array.
   * The Dropdown here is a stub that hands its onChange a single string in
   * either mode, so the shape of what comes back is the stub's doing, not the
   * component's - asserting on it would be asserting on this file.
   */
  test("takes one team, not a list of them", async () => {
    const onSubmit: OnSubmitFunction = makeOnSubmit();
    const view: ReturnType<typeof render> = renderModal({ onSubmit: onSubmit });

    chooseProject(view);
    await goToTeamStep(view);

    expect(capturedDropdownProps!.isMultiSelect).toBe(false);

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
   * The modal owns the footer button, and BasicForm's own submit button is
   * hidden, so the two have to be kept in step by hand. A button still reading
   * "next" on the last step is the one that looks like it did nothing.
   */
  test("labels the footer button for the step it is on", async () => {
    const view: ReturnType<typeof render> = renderModal();

    expect(view.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "pages.users.bulkAddToProjectNext",
    );

    chooseProject(view);
    await goToTeamStep(view);

    expect(view.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "pages.users.bulkAddToProjectSubmit",
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
    await goToTeamStep(view);

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
  });
});
