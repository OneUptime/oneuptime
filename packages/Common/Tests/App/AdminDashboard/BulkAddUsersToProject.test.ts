import { describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * Without an injected `createTeamMember`, a membership is created through
 * the admin ModelAPI - the one that sends no tenant header, because a master
 * admin is not inside any project. Every test below except "sends the create
 * through the admin ModelAPI..." injects its own create, so this mock only
 * stands in for the one test that exercises the production path.
 */
jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI",
  () => {
    return {
      __esModule: true,
      default: {
        create: jest.fn(),
      },
    };
  },
);

import bulkAddUsersToProject, {
  addUserToProject,
  getUsersToAdd,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/User/BulkAddUsersToProject";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Errors from "../../../Server/Utils/Errors";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";
import { BulkActionRunResult } from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionOnClickProps,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";

/*
 * ADD TO PROJECT, ON THE SHARED BULK RUNNER (fu-bulk-actions).
 *
 * The Admin Dashboard's Users page used to add the selected users to a
 * project in a loop of its own: no Stop, no time left, and a report of its
 * own shape that the page renamed into the progress dialog's. It now runs
 * through runBulkAction like every other bulk action, one user at a time
 * (the project's seat accounting), and this module keeps what is its own:
 * each user once, each membership stamped with the picked project and team,
 * and the auto-accept the admin chose.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-384194170001",
);
const TEAM_ID: ObjectID = new ObjectID("0198c8ec-2a1d-7f0c-9e75-384194170002");

const FIRST_USER_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194170010";
const SECOND_USER_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194170011";
const THIRD_USER_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194170012";

const makeUser: (id: string | null) => User = (id: string | null): User => {
  const user: User = new User();

  if (id) {
    user._id = id;
  }

  return user;
};

const adminModelAPICreateMock: jest.MockedFunction<any> =
  AdminModelAPI.create as unknown as jest.MockedFunction<any>;

interface AdminModelAPICreateArgument {
  model: TeamMember;
  modelType: unknown;
}

type DeferredResolve = () => void;
type DeferredReject = (error: Error) => void;

// The parameter types the Promise constructor hands its executor.
type PromiseVoidResolve = (value: void | PromiseLike<void>) => void;
type PromiseReject = (reason?: unknown) => void;

interface Deferred {
  promise: Promise<void>;
  resolve: DeferredResolve;
  reject: DeferredReject;
}

/*
 * A create the test decides the timing of. Instantly-resolving mocks cannot
 * tell one at a time apart from several at once - both record their calls in
 * selection order - so the sequencing tests hold each create open and look
 * at what has NOT happened yet.
 */
const makeDeferred: () => Deferred = (): Deferred => {
  let resolveDeferred: DeferredResolve = (): void => {};
  let rejectDeferred: DeferredReject = (): void => {};

  const promise: Promise<void> = new Promise<void>(
    (resolve: PromiseVoidResolve, reject: PromiseReject): void => {
      resolveDeferred = (): void => {
        resolve();
      };
      rejectDeferred = (error: Error): void => {
        reject(error);
      };
    },
  );

  return {
    promise: promise,
    resolve: resolveDeferred,
    reject: rejectDeferred,
  };
};

/*
 * Two full macrotask turns, not a microtask flush: anything the run was
 * going to start has started by the time this resolves, which makes
 * "create #2 has not started" a real assertion rather than a race.
 */
const flushPendingWork: () => Promise<void> = async (): Promise<void> => {
  for (let turn: number = 0; turn < 2; turn++) {
    await new Promise<void>((resolve: PromiseVoidResolve): void => {
      setTimeout(resolve, 0);
    });
  }
};

type MakeGatesFunction = (userIds: Array<string>) => Map<string, Deferred>;

const makeGates: MakeGatesFunction = (
  userIds: Array<string>,
): Map<string, Deferred> => {
  const gates: Map<string, Deferred> = new Map<string, Deferred>();

  for (const userId of userIds) {
    gates.set(userId, makeDeferred());
  }

  return gates;
};

// The click the bulk menu hands the action, watched.
interface WatchedClick {
  actionProps: BulkActionOnClickProps<User>;
  starts: Array<unknown>;
  reports: Array<ProgressInfo<User>>;
  ends: () => number;
  stop: () => void;
}

function watchClick(users: Array<User>): WatchedClick {
  const starts: Array<unknown> = [];
  const reports: Array<ProgressInfo<User>> = [];
  let endCount: number = 0;
  const stopper: AbortController = new AbortController();

  return {
    actionProps: {
      items: users,
      onBulkActionStart: ((options?: unknown): void => {
        starts.push(options);
      }) as BulkActionOnClickProps<User>["onBulkActionStart"],
      onProgressInfo: (info: ProgressInfo<User>): void => {
        reports.push(info);
      },
      onBulkActionEnd: (): void => {
        endCount += 1;
      },
      stopSignal: stopper.signal,
    },
    starts: starts,
    reports: reports,
    ends: (): number => {
      return endCount;
    },
    stop: (): void => {
      stopper.abort();
    },
  };
}

describe("bulkAddUsersToProject", () => {
  test("creates one membership per selected user, in selection order", async (): Promise<void> => {
    const first: User = makeUser(FIRST_USER_ID);
    const second: User = makeUser(SECOND_USER_ID);
    const third: User = makeUser(THIRD_USER_ID);
    const createdUserIds: Array<string> = [];
    const click: WatchedClick = watchClick([first, second, third]);

    const result: BulkActionRunResult<User> = await bulkAddUsersToProject({
      actionProps: click.actionProps,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        createdUserIds.push(teamMember.userId!.toString());
      },
    });

    expect(createdUserIds).toEqual([
      FIRST_USER_ID,
      SECOND_USER_ID,
      THIRD_USER_ID,
    ]);
    expect(result.changed).toEqual([first, second, third]);
    expect(result.failed).toEqual([]);
    expect(result.notStarted).toEqual([]);
  });

  test("never has two creates in flight: the next starts once the one before it settled", async (): Promise<void> => {
    const first: User = makeUser(FIRST_USER_ID);
    const second: User = makeUser(SECOND_USER_ID);
    const third: User = makeUser(THIRD_USER_ID);

    const startedUserIds: Array<string> = [];
    const gates: Map<string, Deferred> = makeGates([
      FIRST_USER_ID,
      SECOND_USER_ID,
      THIRD_USER_ID,
    ]);

    const runPromise: Promise<BulkActionRunResult<User>> =
      bulkAddUsersToProject({
        actionProps: watchClick([first, second, third]).actionProps,
        projectId: PROJECT_ID,
        teamId: TEAM_ID,
        createTeamMember: async (teamMember: TeamMember): Promise<void> => {
          const userId: string = teamMember.userId!.toString();
          startedUserIds.push(userId);
          await gates.get(userId)!.promise;
        },
      });

    /*
     * The seat accounting is why this has to be one at a time.
     * TeamMemberService.onBeforeCreate reads the project's current seat count
     * and compares it to the seat limit, so two creates in flight together
     * both read the same count and both pass a check only one of them should
     * have - taking the project past the seats it paid for. The runner's
     * default (several at once) would do exactly that.
     */
    await flushPendingWork();
    expect(startedUserIds).toEqual([FIRST_USER_ID]);

    gates.get(FIRST_USER_ID)!.resolve();
    await flushPendingWork();
    expect(startedUserIds).toEqual([FIRST_USER_ID, SECOND_USER_ID]);

    gates.get(SECOND_USER_ID)!.resolve();
    await flushPendingWork();
    expect(startedUserIds).toEqual([
      FIRST_USER_ID,
      SECOND_USER_ID,
      THIRD_USER_ID,
    ]);

    gates.get(THIRD_USER_ID)!.resolve();

    const result: BulkActionRunResult<User> = await runPromise;
    expect(result.changed).toEqual([first, second, third]);
  });

  test("stamps userId, teamId and projectId onto every created membership", async (): Promise<void> => {
    const created: Array<TeamMember> = [];

    await bulkAddUsersToProject({
      actionProps: watchClick([
        makeUser(FIRST_USER_ID),
        makeUser(SECOND_USER_ID),
      ]).actionProps,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        created.push(teamMember);
      },
    });

    /*
     * projectId is set by hand: a master admin sends no tenant header, so
     * nothing on the way to the server fills the project column in.
     */
    expect(
      created.map((teamMember: TeamMember): Array<string> => {
        return [
          teamMember.userId!.toString(),
          teamMember.teamId!.toString(),
          teamMember.projectId!.toString(),
        ];
      }),
    ).toEqual([
      [FIRST_USER_ID, TEAM_ID.toString(), PROJECT_ID.toString()],
      [SECOND_USER_ID, TEAM_ID.toString(), PROJECT_ID.toString()],
    ]);
  });

  test("sends the create through the admin ModelAPI when no create is injected", async (): Promise<void> => {
    adminModelAPICreateMock.mockReset();
    adminModelAPICreateMock.mockResolvedValue(undefined);

    const result: BulkActionRunResult<User> = await bulkAddUsersToProject({
      actionProps: watchClick([makeUser(FIRST_USER_ID)]).actionProps,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
    });

    expect(adminModelAPICreateMock).toHaveBeenCalledTimes(1);

    const argument: AdminModelAPICreateArgument = adminModelAPICreateMock.mock
      .calls[0]![0] as AdminModelAPICreateArgument;

    expect(argument.modelType).toBe(TeamMember);
    expect(argument.model.userId!.toString()).toBe(FIRST_USER_ID);
    expect(argument.model.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(result.changed).toHaveLength(1);
  });

  test.each([
    ["left unticked", undefined, false],
    ["unticked", false, false],
    ["ticked", true, true],
  ])(
    "auto-accept %s makes the membership accepted: %s -> %s",
    async (
      _name: string,
      hasAcceptedInvitation: boolean | undefined,
      expected: boolean,
    ): Promise<void> => {
      let created: TeamMember | null = null;

      await bulkAddUsersToProject({
        actionProps: watchClick([makeUser(FIRST_USER_ID)]).actionProps,
        projectId: PROJECT_ID,
        teamId: TEAM_ID,
        hasAcceptedInvitation: hasAcceptedInvitation,
        createTeamMember: async (teamMember: TeamMember): Promise<void> => {
          created = teamMember;
        },
      });

      expect(created!.hasAcceptedInvitation).toBe(expected);
    },
  );

  test("keeps going after a create fails, and names the user it failed for with why", async (): Promise<void> => {
    const first: User = makeUser(FIRST_USER_ID);
    const failing: User = makeUser(SECOND_USER_ID);
    const last: User = makeUser(THIRD_USER_ID);
    const attemptedUserIds: Array<string> = [];

    const result: BulkActionRunResult<User> = await bulkAddUsersToProject({
      actionProps: watchClick([first, failing, last]).actionProps,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        const userId: string = teamMember.userId!.toString();
        attemptedUserIds.push(userId);

        if (userId === SECOND_USER_ID) {
          throw new Error("Create denied");
        }
      },
    });

    expect(attemptedUserIds).toEqual([
      FIRST_USER_ID,
      SECOND_USER_ID,
      THIRD_USER_ID,
    ]);
    expect(result.changed).toEqual([first, last]);
    expect(result.failed).toEqual([
      { item: failing, failedMessage: "Create denied" },
    ]);
  });

  test("a create that rejects in flight for the first user does not stop the users queued behind it", async (): Promise<void> => {
    const failing: User = makeUser(FIRST_USER_ID);
    const second: User = makeUser(SECOND_USER_ID);
    const startedUserIds: Array<string> = [];
    const gates: Map<string, Deferred> = makeGates([
      FIRST_USER_ID,
      SECOND_USER_ID,
    ]);

    const runPromise: Promise<BulkActionRunResult<User>> =
      bulkAddUsersToProject({
        actionProps: watchClick([failing, second]).actionProps,
        projectId: PROJECT_ID,
        teamId: TEAM_ID,
        createTeamMember: async (teamMember: TeamMember): Promise<void> => {
          const userId: string = teamMember.userId!.toString();
          startedUserIds.push(userId);
          await gates.get(userId)!.promise;
        },
      });

    await flushPendingWork();
    gates.get(FIRST_USER_ID)!.reject(new Error("Create denied"));
    await flushPendingWork();
    expect(startedUserIds).toEqual([FIRST_USER_ID, SECOND_USER_ID]);

    gates.get(SECOND_USER_ID)!.resolve();

    const result: BulkActionRunResult<User> = await runPromise;
    expect(result.changed).toEqual([second]);
    expect(result.failed).toEqual([
      { item: failing, failedMessage: "Create denied" },
    ]);
  });

  test("reports an already-invited user as their own failure, in the server's words", async (): Promise<void> => {
    const alreadyInvited: User = makeUser(FIRST_USER_ID);
    const newMember: User = makeUser(SECOND_USER_ID);

    /*
     * There is deliberately no check for an existing membership before the
     * create, so running the action again over an overlapping selection is
     * routine: the users already in the team are named, the rest added.
     */
    const result: BulkActionRunResult<User> = await bulkAddUsersToProject({
      actionProps: watchClick([alreadyInvited, newMember]).actionProps,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        if (teamMember.userId!.toString() === FIRST_USER_ID) {
          throw new HTTPErrorResponse(
            400,
            { message: Errors.TeamMemberService.ALREADY_INVITED },
            {},
          );
        }
      },
    });

    expect(result.failed).toEqual([
      {
        item: alreadyInvited,
        failedMessage: Errors.TeamMemberService.ALREADY_INVITED,
      },
    ]);
    expect(result.changed).toEqual([newMember]);
  });

  test("counts a repeated user once instead of failing the second copy", async (): Promise<void> => {
    const user: User = makeUser(FIRST_USER_ID);
    const sameUserAgain: User = makeUser(FIRST_USER_ID);
    const other: User = makeUser(SECOND_USER_ID);
    const createdUserIds: Array<string> = [];
    const click: WatchedClick = watchClick([user, sameUserAgain, other]);

    const result: BulkActionRunResult<User> = await bulkAddUsersToProject({
      actionProps: click.actionProps,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        createdUserIds.push(teamMember.userId!.toString());
      },
    });

    expect(createdUserIds).toEqual([FIRST_USER_ID, SECOND_USER_ID]);
    expect(result.changed).toEqual([user, other]);
    expect(result.failed).toEqual([]);
    // The dialog counts the users the run works on: two, not three.
    expect(click.reports[click.reports.length - 1]!.totalItems).toEqual([
      user,
      other,
    ]);
  });

  test("fails a user with no id without sending a create for them", async (): Promise<void> => {
    const missingId: User = makeUser(null);
    const valid: User = makeUser(FIRST_USER_ID);
    const createdUserIds: Array<string> = [];

    const result: BulkActionRunResult<User> = await bulkAddUsersToProject({
      actionProps: watchClick([missingId, valid]).actionProps,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        createdUserIds.push(teamMember.userId!.toString());
      },
    });

    expect(createdUserIds).toEqual([FIRST_USER_ID]);
    expect(result.failed).toEqual([
      { item: missingId, failedMessage: "User ID not found." },
    ]);
    expect(result.changed).toEqual([valid]);
  });
});

/*
 * THE SHARED PROGRESS DIALOG: the run opens it as one that can stop, counts
 * the users down in its shape, and ends it once - whatever the users did.
 */
describe("bulkAddUsersToProject in the progress dialog", () => {
  test("opens the dialog as a run that can stop, and ends it once", async (): Promise<void> => {
    const click: WatchedClick = watchClick([
      makeUser(FIRST_USER_ID),
      makeUser(SECOND_USER_ID),
    ]);

    await bulkAddUsersToProject({
      actionProps: click.actionProps,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (): Promise<void> => {},
    });

    expect(click.starts).toEqual([{ isStoppable: true }]);
    expect(click.ends()).toBe(1);
  });

  test("ends the dialog even when every user fails, and its last report names each with why", async (): Promise<void> => {
    const first: User = makeUser(FIRST_USER_ID);
    const second: User = makeUser(SECOND_USER_ID);
    const click: WatchedClick = watchClick([first, second]);

    await bulkAddUsersToProject({
      actionProps: click.actionProps,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (): Promise<void> => {
        throw new Error("Seat limit reached");
      },
    });

    expect(click.ends()).toBe(1);

    const last: ProgressInfo<User> = click.reports[click.reports.length - 1]!;
    expect(last.totalItems).toEqual([first, second]);
    expect(last.successItems).toEqual([]);
    expect(last.inProgressItems).toEqual([]);
    expect(last.failed).toEqual([
      { item: first, failedMessage: "Seat limit reached" },
      { item: second, failedMessage: "Seat limit reached" },
    ]);
  });

  test("Stop starts no more users: the ones done stay done, the rest are listed as never started", async (): Promise<void> => {
    const first: User = makeUser(FIRST_USER_ID);
    const second: User = makeUser(SECOND_USER_ID);
    const third: User = makeUser(THIRD_USER_ID);
    const click: WatchedClick = watchClick([first, second, third]);
    const createdUserIds: Array<string> = [];

    const result: BulkActionRunResult<User> = await bulkAddUsersToProject({
      actionProps: click.actionProps,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        createdUserIds.push(teamMember.userId!.toString());
        // The admin presses Stop while the first user is being added.
        click.stop();
      },
    });

    // The user in flight finishes; no other is started.
    expect(createdUserIds).toEqual([FIRST_USER_ID]);
    expect(result.changed).toEqual([first]);
    expect(result.notStarted).toEqual([second, third]);
    expect(click.ends()).toBe(1);

    const last: ProgressInfo<User> = click.reports[click.reports.length - 1]!;
    expect(last.notStartedItems).toEqual([second, third]);
  });

  test("an empty selection creates nothing and still ends the dialog", async (): Promise<void> => {
    const click: WatchedClick = watchClick([]);
    const createTeamMember: Mock<(teamMember: TeamMember) => Promise<void>> =
      jest.fn<(teamMember: TeamMember) => Promise<void>>(
        async (): Promise<void> => {},
      );

    const result: BulkActionRunResult<User> = await bulkAddUsersToProject({
      actionProps: click.actionProps,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: createTeamMember,
    });

    expect(createTeamMember).not.toHaveBeenCalled();
    expect(result).toEqual({
      changed: [],
      unchanged: [],
      failed: [],
      notStarted: [],
    });
    expect(click.ends()).toBe(1);
  });
});

describe("getUsersToAdd", () => {
  test("keeps the selection's order, each user once", () => {
    const first: User = makeUser(FIRST_USER_ID);
    const second: User = makeUser(SECOND_USER_ID);

    expect(getUsersToAdd([first, second, makeUser(FIRST_USER_ID)])).toEqual([
      first,
      second,
    ]);
  });

  test("keeps a user without an id, for the run to name as failed", () => {
    const missingId: User = makeUser(null);

    expect(getUsersToAdd([missingId])).toEqual([missingId]);
  });
});

describe("addUserToProject", () => {
  test("throws for a user without an id, creating nothing", async (): Promise<void> => {
    const createTeamMember: Mock<(teamMember: TeamMember) => Promise<void>> =
      jest.fn<(teamMember: TeamMember) => Promise<void>>(
        async (): Promise<void> => {},
      );

    await expect(
      addUserToProject({
        user: makeUser(null),
        projectId: PROJECT_ID,
        teamId: TEAM_ID,
        createTeamMember: createTeamMember,
      }),
    ).rejects.toThrow("User ID not found.");
    expect(createTeamMember).not.toHaveBeenCalled();
  });

  test("lets the create's failure through, for the run to name", async (): Promise<void> => {
    await expect(
      addUserToProject({
        user: makeUser(FIRST_USER_ID),
        projectId: PROJECT_ID,
        teamId: TEAM_ID,
        createTeamMember: async (): Promise<void> => {
          throw new Error("Create denied");
        },
      }),
    ).rejects.toThrow("Create denied");
  });
});
