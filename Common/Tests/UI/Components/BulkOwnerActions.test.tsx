import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { FunctionComponent, ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Scope: this is baseline coverage, not change coverage. Read the green count
 * accordingly. useBulkOwnerActions is a shared hook that shipped with no tests
 * at all, and all but two of the cases below characterise behaviour that
 * already existed - they pass just as well against the pre-change hook. They
 * are written now because this change is what makes the SLO lists depend on
 * that behaviour.
 *
 * Exactly two tests pin this change: "opening Add Owner closes an open Remove
 * Owner modal" and "opening Remove Owner closes an open Add Owner modal". The
 * hook now clears the sibling modal's flag, and both fail without it.
 *
 * The model under test is the ServiceLevelObjectiveOwnerUser /
 * ServiceLevelObjectiveOwnerTeam junction pair because the SLO lists are the
 * adoption this change adds; the hook itself is model-agnostic.
 *
 * The hook is not a thin wrapper: it flattens every team's membership into a
 * single de-duped people list, tags each option with a "user:"/"team:" prefix
 * so one dropdown can drive two different junction tables, and then - per
 * selected item - reads that item's existing owners so a second "Add Owner"
 * run does not create duplicate rows. Every one of those steps is silent when
 * it goes wrong: a wrong resourceIdField or a dropped prefix does not fail, it
 * just queries nothing and reports the item as a success. So the suite drives
 * the real modal, the real form and the real dropdown, and asserts on what
 * actually reaches ModelAPI.
 */

/*
 * react-i18next is not initialized in the test environment. Mock the hook so
 * translate helpers echo their input and the component renders synchronously.
 */
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

/*
 * Declared before jest.mock but dereferenced inside the factory: ts-jest
 * hoists the jest.mock call above these initializers, so naming the mocks
 * directly in the factory would capture undefined.
 */
const getListMock: MockFunction = getJestMockFunction();
const createMock: MockFunction = getJestMockFunction();
const deleteItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      create: (...args: Array<any>) => {
        return createMock(...args);
      },
      deleteItem: (...args: Array<any>) => {
        return deleteItemMock(...args);
      },
    },
  };
});

import useBulkOwnerActions, {
  BulkOwnerActionsConfig,
  BulkOwnerActionsResult,
} from "../../../UI/Components/BulkUpdate/BulkOwnerActions";
import {
  BulkActionButtonSchema,
  BulkActionFailed,
  BulkActionOnClickProps,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveOwnerTeam from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import Email from "../../../Types/Email";
import IconProp from "../../../Types/Icon/IconProp";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

/*
 * Rendering the real modal pulls in Formik and react-select, which are slow
 * to mount on a loaded box; the testing-library default of 1s flakes there.
 */
const WAIT_TIMEOUT: number = 20000;

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SLO_ONE_ID: string = "22222222-2222-4222-8222-222222222221";
const SLO_TWO_ID: string = "22222222-2222-4222-8222-222222222222";
const ALICE_ID: string = "33333333-3333-4333-8333-333333333331";
const BOB_ID: string = "33333333-3333-4333-8333-333333333332";
const CAROL_ID: string = "33333333-3333-4333-8333-333333333333";
const TEAM_ONE_ID: string = "44444444-4444-4444-8444-444444444441";
const TEAM_TWO_ID: string = "44444444-4444-4444-8444-444444444442";
const OWNER_ROW_ID: string = "55555555-5555-4555-8555-555555555551";
const OWNER_ROW_TWO_ID: string = "55555555-5555-4555-8555-555555555552";

const SLO_OWNER_CONFIG: BulkOwnerActionsConfig = {
  ownerUserModelType: ServiceLevelObjectiveOwnerUser,
  ownerTeamModelType: ServiceLevelObjectiveOwnerTeam,
  resourceIdField: "serviceLevelObjectiveId",
};

interface TeamMemberSeed {
  userId: string;
  name?: string;
  email?: string;
}

type MakeTeamMemberFunction = (seed: TeamMemberSeed) => TeamMember;

const makeTeamMember: MakeTeamMemberFunction = (
  seed: TeamMemberSeed,
): TeamMember => {
  const user: User = new User();
  user._id = seed.userId;

  if (seed.name) {
    user.name = new Name(seed.name);
  }

  if (seed.email) {
    user.email = new Email(seed.email);
  }

  const member: TeamMember = new TeamMember();
  member.user = user;

  return member;
};

type MakeTeamFunction = (id: string, name: string) => Team;

const makeTeam: MakeTeamFunction = (id: string, name: string): Team => {
  const team: Team = new Team();
  team._id = id;
  team.name = name;

  return team;
};

type MakeSloFunction = (id?: string) => ServiceLevelObjective;

const makeSlo: MakeSloFunction = (id?: string): ServiceLevelObjective => {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();

  if (id) {
    slo._id = id;
  }

  return slo;
};

interface OwnerRowSeed {
  id?: string;
  userId?: string;
  teamId?: string;
}

type MakeOwnerUserRowFunction = (
  seed: OwnerRowSeed,
) => ServiceLevelObjectiveOwnerUser;

const makeOwnerUserRow: MakeOwnerUserRowFunction = (
  seed: OwnerRowSeed,
): ServiceLevelObjectiveOwnerUser => {
  const row: ServiceLevelObjectiveOwnerUser =
    new ServiceLevelObjectiveOwnerUser();

  if (seed.id) {
    row._id = seed.id;
  }

  if (seed.userId) {
    row.userId = new ObjectID(seed.userId);
  }

  return row;
};

type MakeOwnerTeamRowFunction = (
  seed: OwnerRowSeed,
) => ServiceLevelObjectiveOwnerTeam;

const makeOwnerTeamRow: MakeOwnerTeamRowFunction = (
  seed: OwnerRowSeed,
): ServiceLevelObjectiveOwnerTeam => {
  const row: ServiceLevelObjectiveOwnerTeam =
    new ServiceLevelObjectiveOwnerTeam();

  if (seed.id) {
    row._id = seed.id;
  }

  if (seed.teamId) {
    row.teamId = new ObjectID(seed.teamId);
  }

  return row;
};

interface ListSeeds {
  teamMembers?: Array<TeamMember>;
  teams?: Array<Team>;
  ownerUsers?: Array<ServiceLevelObjectiveOwnerUser>;
  ownerTeams?: Array<ServiceLevelObjectiveOwnerTeam>;
}

type MockListsFunction = (seeds: ListSeeds) => void;

/*
 * All four reads go through the same ModelAPI.getList, so every assertion
 * about "which table did it ask for" has to branch on modelType rather than
 * on call order.
 */
const mockLists: MockListsFunction = (seeds: ListSeeds): void => {
  getListMock.mockImplementation(async (listData: any): Promise<any> => {
    let rows: Array<any> = [];

    if (listData.modelType === TeamMember) {
      rows = seeds.teamMembers || [];
    } else if (listData.modelType === Team) {
      rows = seeds.teams || [];
    } else if (listData.modelType === ServiceLevelObjectiveOwnerUser) {
      rows = seeds.ownerUsers || [];
    } else if (listData.modelType === ServiceLevelObjectiveOwnerTeam) {
      rows = seeds.ownerTeams || [];
    }

    return {
      data: rows,
      count: rows.length,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    };
  });
};

interface ProgressSnapshot {
  totalItems: Array<string>;
  inProgressItems: Array<string>;
  successItems: Array<string>;
  failed: Array<{ id: string; failedMessage: string }>;
}

const progressSnapshots: Array<ProgressSnapshot> = [];

const onProgressInfo: MockFunction = getJestMockFunction();
const onBulkActionStart: MockFunction = getJestMockFunction();
const onBulkActionEnd: MockFunction = getJestMockFunction();

type IdsOfFunction = (items: Array<ServiceLevelObjective>) => Array<string>;

const idsOf: IdsOfFunction = (
  items: Array<ServiceLevelObjective>,
): Array<string> => {
  return items.map((item: ServiceLevelObjective) => {
    return item._id || "no-id";
  });
};

interface HarnessProps {
  items: Array<ServiceLevelObjective>;
}

/*
 * The hook hands back action descriptors that render nothing plus a `modals`
 * element, so the modals only exist once something mounts them - renderHook
 * alone cannot reach the form.
 */
const Harness: FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): ReactElement => {
  const { bulkActions, modals }: BulkOwnerActionsResult<ServiceLevelObjective> =
    useBulkOwnerActions<ServiceLevelObjective>(SLO_OWNER_CONFIG);

  return (
    <div>
      {bulkActions.map(
        (action: BulkActionButtonSchema<ServiceLevelObjective>) => {
          return (
            <button
              key={action.title}
              type="button"
              onClick={() => {
                void action.onClick({
                  items: props.items,
                  onProgressInfo: onProgressInfo,
                  onBulkActionStart: onBulkActionStart,
                  onBulkActionEnd: onBulkActionEnd,
                } as BulkActionOnClickProps<ServiceLevelObjective>);
              }}
            >
              {`Trigger ${action.title}`}
            </button>
          );
        },
      )}
      {modals}
    </div>
  );
};

type WaitForOwnerSourcesFunction = () => Promise<void>;

const waitForOwnerSources: WaitForOwnerSourcesFunction =
  async (): Promise<void> => {
    /*
     * Drained inside act() first: waitFor's own await would otherwise let
     * the mount fetch settle between checks, landing the dropdown state
     * outside act and burying the run in warnings.
     */
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });

    await waitFor(
      () => {
        expect(getListMock).toHaveBeenCalledTimes(2);
      },
      { timeout: WAIT_TIMEOUT },
    );
  };

type OpenOwnerModalFunction = (title: string) => Promise<void>;

const openOwnerModal: OpenOwnerModalFunction = async (
  title: string,
): Promise<void> => {
  fireEvent.click(screen.getByText(`Trigger ${title}`));

  await waitFor(
    () => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(title);
    },
    { timeout: WAIT_TIMEOUT },
  );
};

type ClickOwnerActionFunction = (title: string) => void;

/*
 * openOwnerModal is unusable for the exclusion tests: its getByTestId gate
 * throws on a multiple match, so a stacked second modal makes the helper spin
 * until the test times out and neither assertion ever runs. Clicking without
 * the gate leaves the count assertion as the thing that reports the
 * regression. Safe to read the DOM straight after: fireEvent is act-wrapped
 * and the onClick sets both flags before its first await.
 */
const clickOwnerAction: ClickOwnerActionFunction = (title: string): void => {
  fireEvent.click(screen.getByText(`Trigger ${title}`));
};

type SelectOwnerFunction = (optionLabel: string) => Promise<void>;

/*
 * react-select closes its menu after each pick and hides already-selected
 * options, so re-opening between picks is what makes multi-select reachable
 * and keeps the option text unambiguous against the value pill.
 */
const selectOwner: SelectOwnerFunction = async (
  optionLabel: string,
): Promise<void> => {
  const combobox: HTMLElement = screen.getByRole("combobox");
  fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
  fireEvent.click(
    await screen.findByText(optionLabel, {}, { timeout: WAIT_TIMEOUT }),
  );
};

type OpenOwnerMenuFunction = () => void;

const openOwnerMenu: OpenOwnerMenuFunction = (): void => {
  const combobox: HTMLElement = screen.getByRole("combobox");
  fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
};

type SubmitOwnerModalFunction = () => void;

const submitOwnerModal: SubmitOwnerModalFunction = (): void => {
  fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
};

type GetListCallsForFunction = (modelType: unknown) => Array<any>;

const getListCallsFor: GetListCallsForFunction = (
  modelType: unknown,
): Array<any> => {
  return (getListMock.mock.calls as Array<Array<any>>)
    .map((call: Array<any>) => {
      return call[0];
    })
    .filter((listData: any) => {
      return listData.modelType === modelType;
    });
};

/*
 * These mount the real Modal, Formik and react-select trees, so a cold
 * ts-jest transform of that import graph can push individual tests past
 * jest's 5s default - which CI, always starting cold, would report as a
 * red build with no assertion having failed. The slowest test here runs
 * in ~1.3s warm; 30s is the same ceiling App/jest.config.json already
 * sets for its whole suite.
 */
jest.setTimeout(30000);

describe("useBulkOwnerActions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    progressSnapshots.length = 0;
    window.localStorage.clear();
    window.sessionStorage.clear();

    /*
     * ProjectUtil.getCurrentProjectId() reads pathname.split("/")[2] before
     * falling back to storage, so the URL is the whole "current project"
     * fixture.
     */
    window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/slos`);

    /*
     * The progress arrays are allocated once and handed to every callback by
     * reference, so anything kept without copying reads back as the final
     * state of the run.
     */
    onProgressInfo.mockImplementation(
      (progressInfo: ProgressInfo<ServiceLevelObjective>): void => {
        progressSnapshots.push({
          totalItems: idsOf(progressInfo.totalItems),
          inProgressItems: idsOf(progressInfo.inProgressItems),
          successItems: idsOf(progressInfo.successItems),
          failed: progressInfo.failed.map(
            (failure: BulkActionFailed<ServiceLevelObjective>) => {
              return {
                id: failure.item._id || "no-id",
                failedMessage: failure.failedMessage as string,
              };
            },
          ),
        });
      },
    );

    mockLists({});
    createMock.mockResolvedValue({});
    deleteItemMock.mockResolvedValue({});
  });

  test("offers Add Owner then Remove Owner, in that order", async () => {
    const { result } = renderHook(() => {
      return useBulkOwnerActions<ServiceLevelObjective>(SLO_OWNER_CONFIG);
    });

    await waitForOwnerSources();

    /*
     * Consumers splice these straight into ModelTable's button list, which
     * renders them in array order.
     */
    expect(result.current.bulkActions).toHaveLength(2);
    expect(result.current.bulkActions[0]!.title).toBe("Add Owner");
    expect(result.current.bulkActions[1]!.title).toBe("Remove Owner");
  });

  test("gives both actions the user icons and a non-danger button style", async () => {
    const { result } = renderHook(() => {
      return useBulkOwnerActions<ServiceLevelObjective>(SLO_OWNER_CONFIG);
    });

    await waitForOwnerSources();

    expect(result.current.bulkActions[0]!.icon).toBe(IconProp.UserPlus);
    expect(result.current.bulkActions[0]!.buttonStyleType).toBe(
      ButtonStyleType.NORMAL,
    );
    expect(result.current.bulkActions[1]!.icon).toBe(IconProp.UserMinus);

    /*
     * BulkUpdateForm splits danger-styled buttons into their own red menu
     * group below a divider. Removing an owner is reversible, so it has to
     * stay with the ordinary actions.
     */
    expect(result.current.bulkActions[1]!.buttonStyleType).toBe(
      ButtonStyleType.NORMAL,
    );
  });

  test("fetches this project's team members and teams on mount", async () => {
    render(<Harness items={[]} />);

    await waitForOwnerSources();

    const memberCall: any = getListCallsFor(TeamMember)[0];
    expect(memberCall.query.projectId.toString()).toBe(PROJECT_ID);
    expect(memberCall.limit).toBe(LIMIT_PER_PROJECT);
    expect(memberCall.skip).toBe(0);
    expect(memberCall.select).toEqual({
      _id: true,
      user: { _id: true, name: true, email: true },
    });

    const teamCall: any = getListCallsFor(Team)[0];
    expect(teamCall.query.projectId.toString()).toBe(PROJECT_ID);
    expect(teamCall.limit).toBe(LIMIT_PER_PROJECT);
    expect(teamCall.select).toEqual({ _id: true, name: true });
    expect(teamCall.sort).toEqual({ name: SortOrder.Ascending });
  });

  test("fetches team members and teams in parallel", async () => {
    getListMock.mockImplementation((listData: any): Promise<any> => {
      if (listData.modelType === TeamMember) {
        // Never settles, so the team read can only happen if it did not await this one.
        return new Promise((): void => {});
      }

      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
    });

    render(<Harness items={[]} />);

    /*
     * A project with a large membership table would otherwise hold the Teams
     * group out of the dropdown for as long as that read takes.
     */
    await waitForOwnerSources();
    expect(getListCallsFor(TeamMember)).toHaveLength(1);
    expect(getListCallsFor(Team)).toHaveLength(1);
  });

  test("fetches nothing when there is no current project", async () => {
    window.history.replaceState({}, "", "/dashboard");

    render(<Harness items={[]} />);

    await screen.findByText("Trigger Add Owner", {}, { timeout: WAIT_TIMEOUT });

    /*
     * Without the guard the query goes out with projectId undefined, which
     * the API answers with every team member the caller can read.
     */
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("lists a user once even when they are on several teams", async () => {
    mockLists({
      teamMembers: [
        makeTeamMember({ userId: ALICE_ID, name: "Alice" }),
        makeTeamMember({ userId: BOB_ID, name: "Bob" }),
        makeTeamMember({ userId: ALICE_ID, name: "Alice" }),
      ],
      teams: [],
    });

    render(<Harness items={[]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    openOwnerMenu();

    await screen.findByText("Bob", {}, { timeout: WAIT_TIMEOUT });
    expect(screen.getAllByText("Alice")).toHaveLength(1);
  });

  test("sorts people case-insensitively by name", async () => {
    mockLists({
      teamMembers: [
        makeTeamMember({ userId: CAROL_ID, name: "carol" }),
        makeTeamMember({ userId: BOB_ID, name: "Bob" }),
        makeTeamMember({ userId: ALICE_ID, name: "alice" }),
      ],
      teams: [],
    });

    render(<Harness items={[]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    openOwnerMenu();

    await screen.findByText("alice", {}, { timeout: WAIT_TIMEOUT });

    const optionLabels: Array<string> = screen
      .getAllByRole("option")
      .map((option: HTMLElement) => {
        return option.textContent || "";
      });

    /*
     * A plain codepoint sort puts every capitalised name ahead of every
     * lowercase one, so "Bob" would jump the queue ahead of "alice".
     */
    expect(optionLabels).toEqual(["alice", "Bob", "carol"]);
  });

  test("falls back to a member's email when they have no name", async () => {
    mockLists({
      teamMembers: [
        makeTeamMember({ userId: ALICE_ID, email: "alice@example.com" }),
      ],
      teams: [],
    });

    render(<Harness items={[]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    openOwnerMenu();

    expect(
      await screen.findByText(
        "alice@example.com",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
  });

  test("groups the options under People and Teams", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [makeTeam(TEAM_ONE_ID, "Team One")],
    });

    render(<Harness items={[]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    openOwnerMenu();

    expect(
      await screen.findByText("People", {}, { timeout: WAIT_TIMEOUT }),
    ).toBeInTheDocument();
    expect(screen.getByText("Teams")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Team One")).toBeInTheDocument();
  });

  test("offers every team in the project, in the order the API returned them", async () => {
    mockLists({
      teamMembers: [],
      teams: [
        makeTeam(TEAM_TWO_ID, "Zebra Team"),
        makeTeam(TEAM_ONE_ID, "Apple Team"),
      ],
    });

    render(<Harness items={[]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    openOwnerMenu();

    await screen.findByText("Zebra Team", {}, { timeout: WAIT_TIMEOUT });

    /*
     * Teams keep the server's ordering (the query asks for name ASC); only
     * the people list is re-sorted in the hook, because it is stitched
     * together from every team's membership.
     */
    expect(
      screen.getAllByRole("option").map((option: HTMLElement) => {
        return option.textContent || "";
      }),
    ).toEqual(["Zebra Team", "Apple Team"]);
  });

  test("omits the People group when the project has no team members", async () => {
    mockLists({
      teamMembers: [],
      teams: [makeTeam(TEAM_ONE_ID, "Team One")],
    });

    render(<Harness items={[]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    openOwnerMenu();

    await screen.findByText("Teams", {}, { timeout: WAIT_TIMEOUT });

    /*
     * An empty group still renders its heading, so the dropdown would show a
     * "People" label with nothing under it.
     */
    expect(screen.queryByText("People")).not.toBeInTheDocument();
  });

  test("omits the Teams group when the project has no teams", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
    });

    render(<Harness items={[]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    openOwnerMenu();

    await screen.findByText("People", {}, { timeout: WAIT_TIMEOUT });
    expect(screen.queryByText("Teams")).not.toBeInTheDocument();
  });

  test("creates one owner row per picked user and per picked team", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [makeTeam(TEAM_ONE_ID, "Team One")],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    await selectOwner("Alice");
    await selectOwner("Team One");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(createMock).toHaveBeenCalledTimes(2);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const userCall: any = (createMock.mock.calls[0] as Array<any>)[0];
    expect(userCall.modelType).toBe(ServiceLevelObjectiveOwnerUser);
    expect(userCall.model.userId.toString()).toBe(ALICE_ID);
    expect(userCall.model.serviceLevelObjectiveId.toString()).toBe(SLO_ONE_ID);
    expect(userCall.model.projectId.toString()).toBe(PROJECT_ID);

    const teamCall: any = (createMock.mock.calls[1] as Array<any>)[0];
    expect(teamCall.modelType).toBe(ServiceLevelObjectiveOwnerTeam);
    expect(teamCall.model.teamId.toString()).toBe(TEAM_ONE_ID);
    expect(teamCall.model.serviceLevelObjectiveId.toString()).toBe(SLO_ONE_ID);
    expect(teamCall.model.projectId.toString()).toBe(PROJECT_ID);
  });

  test("creates a row for every selected item", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID), makeSlo(SLO_TWO_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    await selectOwner("Alice");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(createMock).toHaveBeenCalledTimes(2);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const resourceIds: Array<string> = (
      createMock.mock.calls as Array<Array<any>>
    ).map((call: Array<any>) => {
      return call[0].model.serviceLevelObjectiveId.toString();
    });

    expect(resourceIds).toEqual([SLO_ONE_ID, SLO_TWO_ID]);
  });

  test("skips an owner the item already has", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [makeTeam(TEAM_ONE_ID, "Team One")],
      ownerUsers: [makeOwnerUserRow({ id: OWNER_ROW_ID, userId: ALICE_ID })],
      ownerTeams: [],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    await selectOwner("Alice");
    await selectOwner("Team One");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(createMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    /*
     * Re-adding an existing owner is not a harmless duplicate: the owner
     * lists on the resource render one row per junction record.
     */
    const onlyCall: any = (createMock.mock.calls[0] as Array<any>)[0];
    expect(onlyCall.modelType).toBe(ServiceLevelObjectiveOwnerTeam);
  });

  test("reads the item's existing user owners with the resource-scoped query", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    await selectOwner("Alice");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(createMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const ownerUserCall: any = getListCallsFor(
      ServiceLevelObjectiveOwnerUser,
    )[0];

    /*
     * The foreign key is a config string. Spelling it wrong compiles, and
     * then this query matches every owner row in the project.
     */
    expect(ownerUserCall.query.serviceLevelObjectiveId.toString()).toBe(
      SLO_ONE_ID,
    );
    expect(ownerUserCall.query.projectId.toString()).toBe(PROJECT_ID);
    expect(ownerUserCall.select).toEqual({ userId: true });
    expect(ownerUserCall.limit).toBe(LIMIT_PER_PROJECT);
    expect(ownerUserCall.skip).toBe(0);
  });

  test("does not touch the team owner table when only a user was picked", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [makeTeam(TEAM_ONE_ID, "Team One")],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    await selectOwner("Alice");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(createMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(getListCallsFor(ServiceLevelObjectiveOwnerUser)).toHaveLength(1);
    expect(getListCallsFor(ServiceLevelObjectiveOwnerTeam)).toHaveLength(0);
  });

  test("does not touch the user owner table when only a team was picked", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [makeTeam(TEAM_ONE_ID, "Team One")],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    await selectOwner("Team One");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(createMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(getListCallsFor(ServiceLevelObjectiveOwnerTeam)).toHaveLength(1);
    expect(getListCallsFor(ServiceLevelObjectiveOwnerUser)).toHaveLength(0);
  });

  test("deletes the junction rows that match the removed owners", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [makeTeam(TEAM_ONE_ID, "Team One")],
      ownerUsers: [makeOwnerUserRow({ id: OWNER_ROW_ID, userId: ALICE_ID })],
      ownerTeams: [
        makeOwnerTeamRow({ id: OWNER_ROW_TWO_ID, teamId: TEAM_ONE_ID }),
      ],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Remove Owner");
    await selectOwner("Alice");
    await selectOwner("Team One");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(deleteItemMock).toHaveBeenCalledTimes(2);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const userDelete: any = (deleteItemMock.mock.calls[0] as Array<any>)[0];
    expect(userDelete.modelType).toBe(ServiceLevelObjectiveOwnerUser);
    expect(userDelete.id.toString()).toBe(OWNER_ROW_ID);

    const teamDelete: any = (deleteItemMock.mock.calls[1] as Array<any>)[0];
    expect(teamDelete.modelType).toBe(ServiceLevelObjectiveOwnerTeam);
    expect(teamDelete.id.toString()).toBe(OWNER_ROW_TWO_ID);

    expect(createMock).not.toHaveBeenCalled();
  });

  test("looks the removable rows up by the selected owner ids", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
      ownerUsers: [makeOwnerUserRow({ id: OWNER_ROW_ID, userId: ALICE_ID })],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Remove Owner");
    await selectOwner("Alice");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(deleteItemMock).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const lookup: any = getListCallsFor(ServiceLevelObjectiveOwnerUser)[0];
    expect(lookup.query.serviceLevelObjectiveId.toString()).toBe(SLO_ONE_ID);
    expect(lookup.query.userId).toBeInstanceOf(Includes);
    expect(
      (lookup.query.userId.values as Array<ObjectID>).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([ALICE_ID]);
    expect(lookup.select).toEqual({ _id: true });
  });

  test("skips a junction row that came back without an id", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
      ownerUsers: [
        makeOwnerUserRow({ userId: ALICE_ID }),
        makeOwnerUserRow({ id: OWNER_ROW_ID, userId: ALICE_ID }),
      ],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Remove Owner");
    await selectOwner("Alice");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(onBulkActionEnd).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    /*
     * A select that drops _id would otherwise send DELETE with an undefined
     * id, which the API resolves to "delete by query".
     */
    expect(deleteItemMock).toHaveBeenCalledTimes(1);
    expect((deleteItemMock.mock.calls[0] as Array<any>)[0].id.toString()).toBe(
      OWNER_ROW_ID,
    );
  });

  test("counts an item that has none of the removed owners as a success", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
      ownerUsers: [],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Remove Owner");
    await selectOwner("Alice");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(onBulkActionEnd).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(deleteItemMock).not.toHaveBeenCalled();
    expect(progressSnapshots).toHaveLength(1);
    expect(progressSnapshots[0]!.successItems).toEqual([SLO_ONE_ID]);
    expect(progressSnapshots[0]!.failed).toEqual([]);
  });

  test("keeps going after one item fails and reports why", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
    });

    createMock.mockImplementation(async (data: any): Promise<any> => {
      if (data.model.serviceLevelObjectiveId.toString() === SLO_ONE_ID) {
        throw new BadDataException("Owner could not be added");
      }

      return {};
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID), makeSlo(SLO_TWO_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    await selectOwner("Alice");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(onBulkActionEnd).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const finalSnapshot: ProgressSnapshot = progressSnapshots[1]!;
    expect(finalSnapshot.successItems).toEqual([SLO_TWO_ID]);
    expect(finalSnapshot.failed).toEqual([
      { id: SLO_ONE_ID, failedMessage: "Owner could not be added" },
    ]);
  });

  test("fails an item with no id without calling the API for it", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
    });

    render(<Harness items={[makeSlo(), makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    await selectOwner("Alice");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(onBulkActionEnd).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const finalSnapshot: ProgressSnapshot = progressSnapshots[1]!;
    expect(finalSnapshot.failed).toEqual([
      { id: "no-id", failedMessage: "Item ID not found" },
    ]);
    expect(finalSnapshot.successItems).toEqual([SLO_ONE_ID]);

    /*
     * An id-less item must not reach the junction query: with the resource
     * id missing the filter collapses to the whole project.
     */
    expect(getListCallsFor(ServiceLevelObjectiveOwnerUser)).toHaveLength(1);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  test("fails every item when the project is gone by the time the form is submitted", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    await selectOwner("Alice");

    window.history.replaceState({}, "", "/dashboard");

    submitOwnerModal();

    await waitFor(
      () => {
        expect(onBulkActionEnd).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(progressSnapshots[0]!.failed).toEqual([
      { id: SLO_ONE_ID, failedMessage: "Project not found" },
    ]);
    expect(createMock).not.toHaveBeenCalled();
  });

  test("brackets the run with onBulkActionStart and onBulkActionEnd", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID), makeSlo(SLO_TWO_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    await selectOwner("Alice");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(onBulkActionEnd).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(onBulkActionStart).toHaveBeenCalledTimes(1);
    expect(onProgressInfo).toHaveBeenCalledTimes(2);
    expect(onBulkActionStart.mock.invocationCallOrder[0]!).toBeLessThan(
      onProgressInfo.mock.invocationCallOrder[0]!,
    );
    expect(onBulkActionEnd.mock.invocationCallOrder[0]!).toBeGreaterThan(
      onProgressInfo.mock.invocationCallOrder[1]!,
    );
  });

  test("moves each item from in-progress to success as it is processed", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID), makeSlo(SLO_TWO_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    await selectOwner("Alice");
    submitOwnerModal();

    await waitFor(
      () => {
        expect(onBulkActionEnd).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    /*
     * The item being worked on is spliced out of inProgressItems before its
     * own callback fires, so the progress bar never double-counts it.
     */
    expect(progressSnapshots).toEqual([
      {
        totalItems: [SLO_ONE_ID, SLO_TWO_ID],
        inProgressItems: [SLO_TWO_ID],
        successItems: [SLO_ONE_ID],
        failed: [],
      },
      {
        totalItems: [SLO_ONE_ID, SLO_TWO_ID],
        inProgressItems: [],
        successItems: [SLO_ONE_ID, SLO_TWO_ID],
        failed: [],
      },
    ]);
  });

  test("opening Add Owner closes an open Remove Owner modal", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Remove Owner");
    clickOwnerAction("Add Owner");

    const openTitles: Array<HTMLElement> = screen.getAllByTestId("modal-title");

    /*
     * Both dialogs share one bulkActionProps, and the first submit nulls it -
     * so a second one left stacked behind would swallow its own submit.
     */
    expect(openTitles).toHaveLength(1);
    expect(openTitles[0]!).toHaveTextContent("Add Owner");
  });

  test("opening Remove Owner closes an open Add Owner modal", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    clickOwnerAction("Remove Owner");

    const openTitles: Array<HTMLElement> = screen.getAllByTestId("modal-title");

    expect(openTitles).toHaveLength(1);
    expect(openTitles[0]!).toHaveTextContent("Remove Owner");
  });

  test("blocks a submit with nothing selected", async () => {
    mockLists({
      teamMembers: [makeTeamMember({ userId: ALICE_ID, name: "Alice" })],
      teams: [makeTeam(TEAM_ONE_ID, "Team One")],
    });

    render(<Harness items={[makeSlo(SLO_ONE_ID)]} />);
    await waitForOwnerSources();
    await openOwnerModal("Add Owner");
    submitOwnerModal();

    expect(
      await screen.findByText(
        "Select Owners is required.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();

    /*
     * Without the required rule an empty submit still walks every selected
     * item, reporting a batch of successes that changed nothing.
     */
    expect(createMock).not.toHaveBeenCalled();
    expect(onBulkActionStart).not.toHaveBeenCalled();
    expect(getListMock).toHaveBeenCalledTimes(2);
  });
});
