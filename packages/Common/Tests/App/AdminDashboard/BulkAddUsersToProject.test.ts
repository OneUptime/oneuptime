import { describe, expect, jest, test } from "@jest/globals";

/*
 * Without an injected `createTeamMember`, bulkAddUsersToProject issues the real
 * create through the admin ModelAPI - the one that sends no tenant header,
 * because a master admin is not inside any project. Every test below except
 * "sends the create through the admin ModelAPI..." injects its own create, so
 * this mock only stands in for the one test that exercises the production path.
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
  BulkAddUsersToProjectProgress,
  BulkAddUsersToProjectResult,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/User/BulkAddUsersToProject";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Errors from "../../../Server/Utils/Errors";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ObjectID from "../../../Types/ObjectID";

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
 * tell a sequential loop apart from `Promise.all(users.map(...))` - both record
 * their calls in selection order - so the sequencing tests hold each create
 * open and look at what has NOT happened yet.
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
 * Two full macrotask turns, not a microtask flush. A concurrent implementation
 * starts every create in the tick it is called, so anything it was going to
 * start has definitely started by the time this resolves - which is what makes
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

describe("bulkAddUsersToProject", () => {
  test("creates one membership per selected user, in selection order", async (): Promise<void> => {
    const first: User = makeUser(FIRST_USER_ID);
    const second: User = makeUser(SECOND_USER_ID);
    const third: User = makeUser(THIRD_USER_ID);
    const createdUserIds: Array<string> = [];

    const result: BulkAddUsersToProjectResult = await bulkAddUsersToProject({
      users: [first, second, third],
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        createdUserIds.push(teamMember.userId!.toString());
      },
    });

    /*
     * Pins coverage and attribution, NOT sequencing: exactly one create per
     * selected user, and each user landing in succeededUsers under their own
     * name, which is the row the progress modal prints the outcome against.
     * The ordering here proves nothing about concurrency - these creates
     * resolve instantly, so `Promise.all(users.map(...))` would record the
     * same three ids in the same order. Sequencing is pinned by "does not
     * start the next create until the previous one has settled" below.
     */
    expect(createdUserIds).toEqual([
      FIRST_USER_ID,
      SECOND_USER_ID,
      THIRD_USER_ID,
    ]);
    expect(result.succeededUsers).toEqual([first, second, third]);
    expect(result.failedUsers).toEqual([]);
  });

  test("does not start the next create until the previous one has settled", async (): Promise<void> => {
    const first: User = makeUser(FIRST_USER_ID);
    const second: User = makeUser(SECOND_USER_ID);
    const third: User = makeUser(THIRD_USER_ID);

    const startedUserIds: Array<string> = [];
    const settledUserIds: Array<string> = [];
    const gates: Map<string, Deferred> = makeGates([
      FIRST_USER_ID,
      SECOND_USER_ID,
      THIRD_USER_ID,
    ]);

    const runPromise: Promise<BulkAddUsersToProjectResult> =
      bulkAddUsersToProject({
        users: [first, second, third],
        projectId: PROJECT_ID,
        teamId: TEAM_ID,
        createTeamMember: async (teamMember: TeamMember): Promise<void> => {
          const userId: string = teamMember.userId!.toString();
          startedUserIds.push(userId);
          await gates.get(userId)!.promise;
          settledUserIds.push(userId);
        },
      });

    /*
     * The seat accounting is why this has to be one at a time.
     * TeamMemberService.onBeforeCreate reads the project's current seat count
     * and compares it to the seat limit, so two creates in flight together
     * both read the same pre-increment count and both pass a check that only
     * one of them should have - taking the project past the seat it paid for.
     * A concurrent rewrite is invisible to every other test in this file
     * because instantly-resolving mocks record in selection order either way;
     * it is only visible here, where create #1 is held open and create #2 must
     * still be unstarted.
     */
    await flushPendingWork();
    expect(startedUserIds).toEqual([FIRST_USER_ID]);
    expect(settledUserIds).toEqual([]);

    gates.get(FIRST_USER_ID)!.resolve();
    await flushPendingWork();
    expect(settledUserIds).toEqual([FIRST_USER_ID]);
    expect(startedUserIds).toEqual([FIRST_USER_ID, SECOND_USER_ID]);

    gates.get(SECOND_USER_ID)!.resolve();
    await flushPendingWork();
    expect(settledUserIds).toEqual([FIRST_USER_ID, SECOND_USER_ID]);
    expect(startedUserIds).toEqual([
      FIRST_USER_ID,
      SECOND_USER_ID,
      THIRD_USER_ID,
    ]);

    gates.get(THIRD_USER_ID)!.resolve();

    const result: BulkAddUsersToProjectResult = await runPromise;

    expect(settledUserIds).toEqual([
      FIRST_USER_ID,
      SECOND_USER_ID,
      THIRD_USER_ID,
    ]);
    expect(result.succeededUsers).toEqual([first, second, third]);
    expect(result.failedUsers).toEqual([]);
  });

  test("stamps userId, teamId and projectId onto every created membership", async (): Promise<void> => {
    const users: Array<User> = [
      makeUser(FIRST_USER_ID),
      makeUser(SECOND_USER_ID),
    ];
    const created: Array<TeamMember> = [];

    await bulkAddUsersToProject({
      users: users,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        created.push(teamMember);
      },
    });

    expect(created).toHaveLength(2);
    expect(created[0]!.userId?.toString()).toBe(FIRST_USER_ID);
    expect(created[1]!.userId?.toString()).toBe(SECOND_USER_ID);

    for (const teamMember of created) {
      expect(teamMember.teamId).toEqual(TEAM_ID);

      /*
       * projectId is asserted on its own because nothing upstream can supply
       * it: a master admin sends no tenant header, so dropping this line still
       * type-checks and still renders fine, and only shows up as every single
       * create coming back 400 once an admin actually runs the bulk action.
       */
      expect(teamMember.projectId).toEqual(PROJECT_ID);
    }
  });

  test("sends the create through the admin ModelAPI when no create is injected", async (): Promise<void> => {
    adminModelAPICreateMock.mockClear();

    const user: User = makeUser(FIRST_USER_ID);

    /*
     * Every other test in this file replaces the create, so the real one -
     * the only code path that ever runs in the browser - would otherwise be
     * executed by nothing at all. A wrong call shape here (ModelAPI.create
     * takes `{ model, modelType }`, not the `{ id, modelType, data }` of
     * updateById that the sibling bulk actions on this page use) type-checks
     * against nothing at runtime and fails on the wire for every user.
     */
    const result: BulkAddUsersToProjectResult = await bulkAddUsersToProject({
      users: [user],
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      hasAcceptedInvitation: true,
    });

    expect(adminModelAPICreateMock).toHaveBeenCalledTimes(1);

    const createArgument: AdminModelAPICreateArgument = adminModelAPICreateMock
      .mock.calls[0]![0] as AdminModelAPICreateArgument;

    expect(Object.keys(createArgument).sort()).toEqual(["model", "modelType"]);
    expect(createArgument.modelType).toBe(TeamMember);
    expect(createArgument.model).toBeInstanceOf(TeamMember);
    expect(createArgument.model.userId?.toString()).toBe(FIRST_USER_ID);
    expect(createArgument.model.teamId).toEqual(TEAM_ID);
    expect(createArgument.model.projectId).toEqual(PROJECT_ID);
    expect(createArgument.model.hasAcceptedInvitation).toBe(true);

    expect(result.succeededUsers).toEqual([user]);
    expect(result.failedUsers).toEqual([]);
  });

  test("leaves the membership unaccepted when the checkbox was not ticked", async (): Promise<void> => {
    let created: TeamMember | null = null;

    await bulkAddUsersToProject({
      users: [makeUser(FIRST_USER_ID)],
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        created = teamMember;
      },
    });

    /*
     * Explicitly false, not undefined. Passing the raw optional straight
     * through would leave the column unset on a normal invite, which is the
     * one value TeamMemberService.onBeforeCreate reads to decide whether the
     * user still owes an acceptance.
     */
    expect(created!.hasAcceptedInvitation).toBe(false);
  });

  test("marks the membership accepted when the admin asked for it", async (): Promise<void> => {
    let created: TeamMember | null = null;

    await bulkAddUsersToProject({
      users: [makeUser(FIRST_USER_ID)],
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      hasAcceptedInvitation: true,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        created = teamMember;
      },
    });

    /*
     * The whole point of the checkbox: without it forwarded, the admin picks
     * "accept automatically" and every user still lands in the invited-only
     * state with no way to tell the two runs apart afterwards.
     */
    expect(created!.hasAcceptedInvitation).toBe(true);
  });

  test("keeps going after a create fails and attributes the failure to that user", async (): Promise<void> => {
    const first: User = makeUser(FIRST_USER_ID);
    const failing: User = makeUser(SECOND_USER_ID);
    const last: User = makeUser(THIRD_USER_ID);
    const attemptedUserIds: Array<string> = [];

    const createTeamMember: (teamMember: TeamMember) => Promise<void> = jest.fn(
      async (teamMember: TeamMember): Promise<void> => {
        const userId: string = teamMember.userId!.toString();
        attemptedUserIds.push(userId);

        if (userId === SECOND_USER_ID) {
          throw new Error("Create denied");
        }
      },
    );

    /*
     * One bad user must not abort the run. An early return - or a single
     * try/catch wrapped around the whole loop - would silently drop every user
     * queued behind the first failure, and the progress modal would show them
     * as neither succeeded nor failed.
     *
     * This create throws synchronously, so the recorded order says nothing
     * about whether the loop is sequential; it is here only to name which
     * users were attempted. The same isolation under a create that rejects
     * asynchronously is pinned by "a create that rejects for the first user
     * does not stop the users queued behind it" below.
     */
    const result: BulkAddUsersToProjectResult = await bulkAddUsersToProject({
      users: [first, failing, last],
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: createTeamMember,
    });

    expect(attemptedUserIds).toEqual([
      FIRST_USER_ID,
      SECOND_USER_ID,
      THIRD_USER_ID,
    ]);
    expect(result.succeededUsers).toEqual([first, last]);
    expect(result.failedUsers).toHaveLength(1);
    expect(result.failedUsers[0]!.user).toBe(failing);
    expect(result.failedUsers[0]!.failedMessage).toBe("Create denied");
  });

  test("a create that rejects for the first user does not stop the users queued behind it", async (): Promise<void> => {
    const failing: User = makeUser(FIRST_USER_ID);
    const second: User = makeUser(SECOND_USER_ID);
    const third: User = makeUser(THIRD_USER_ID);

    const startedUserIds: Array<string> = [];
    const gates: Map<string, Deferred> = makeGates([
      FIRST_USER_ID,
      SECOND_USER_ID,
      THIRD_USER_ID,
    ]);

    const runPromise: Promise<BulkAddUsersToProjectResult> =
      bulkAddUsersToProject({
        users: [failing, second, third],
        projectId: PROJECT_ID,
        teamId: TEAM_ID,
        createTeamMember: async (teamMember: TeamMember): Promise<void> => {
          const userId: string = teamMember.userId!.toString();
          startedUserIds.push(userId);
          await gates.get(userId)!.promise;
        },
      });

    /*
     * A real create fails on the wire, i.e. by rejecting a promise that was
     * already in flight, not by throwing before it ever awaits. Driving the
     * rejection from the test rather than from the resolution order proves the
     * loop resumes from the catch and reaches the next user: an implementation
     * that let the rejection escape the loop body would leave users #2 and #3
     * unstarted forever and this run would never settle.
     */
    await flushPendingWork();
    expect(startedUserIds).toEqual([FIRST_USER_ID]);

    gates.get(FIRST_USER_ID)!.reject(new Error("Create denied"));
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

    const result: BulkAddUsersToProjectResult = await runPromise;

    expect(result.succeededUsers).toEqual([second, third]);
    expect(result.failedUsers).toHaveLength(1);
    expect(result.failedUsers[0]!.user).toBe(failing);
    expect(result.failedUsers[0]!.failedMessage).toBe("Create denied");
    expect(result.inProgressUsers).toEqual([]);
  });

  test("reports an already-invited user as a per-user failure instead of throwing", async (): Promise<void> => {
    const alreadyInvited: User = makeUser(FIRST_USER_ID);
    const newMember: User = makeUser(SECOND_USER_ID);

    const createTeamMember: (teamMember: TeamMember) => Promise<void> = jest.fn(
      async (teamMember: TeamMember): Promise<void> => {
        if (teamMember.userId!.toString() === FIRST_USER_ID) {
          throw new HTTPErrorResponse(
            400,
            { message: Errors.TeamMemberService.ALREADY_INVITED },
            {},
          );
        }
      },
    );

    /*
     * There is deliberately no client-side pre-check for existing membership,
     * so re-running the action over an overlapping selection is expected and
     * routine. If this call rejected, the page would never reach
     * onBulkActionEnd and the progress modal would stay open forever with its
     * close button disabled.
     */
    const result: BulkAddUsersToProjectResult = await bulkAddUsersToProject({
      users: [alreadyInvited, newMember],
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: createTeamMember,
    });

    expect(result.failedUsers).toHaveLength(1);
    expect(result.failedUsers[0]!.user).toBe(alreadyInvited);
    expect(result.failedUsers[0]!.failedMessage).toBe(
      Errors.TeamMemberService.ALREADY_INVITED,
    );
    expect(result.succeededUsers).toEqual([newMember]);
  });

  test("counts a repeated user once instead of failing the second copy", async (): Promise<void> => {
    const user: User = makeUser(FIRST_USER_ID);
    const sameUserAgain: User = makeUser(FIRST_USER_ID);
    const other: User = makeUser(SECOND_USER_ID);
    const createdUserIds: Array<string> = [];

    const result: BulkAddUsersToProjectResult = await bulkAddUsersToProject({
      users: [user, sameUserAgain, other],
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (teamMember: TeamMember): Promise<void> => {
        createdUserIds.push(teamMember.userId!.toString());
      },
    });

    /*
     * Without the de-duplication the second copy is a real create that the
     * server rejects, so the admin is told a user they picked once "has
     * already been invited" - a failure their selection did not cause and
     * that they cannot act on.
     */
    expect(createdUserIds).toEqual([FIRST_USER_ID, SECOND_USER_ID]);
    expect(result.totalUsers).toHaveLength(2);
    expect(result.succeededUsers).toHaveLength(2);
    expect(result.succeededUsers[0]).toBe(user);
    expect(result.failedUsers).toEqual([]);
  });

  test("fails a user with no id without sending a create for them", async (): Promise<void> => {
    const missingId: User = makeUser(null);
    const valid: User = makeUser(FIRST_USER_ID);

    const createTeamMember: (teamMember: TeamMember) => Promise<void> = jest.fn(
      async (_teamMember: TeamMember): Promise<void> => {},
    );

    const result: BulkAddUsersToProjectResult = await bulkAddUsersToProject({
      users: [missingId, valid],
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: createTeamMember,
    });

    /*
     * The id has to be checked before the create is issued. A TeamMember with
     * no userId is a round trip that can only come back as an opaque server
     * error, and on a self-hosted install it is a write attempt that should
     * never have left the browser.
     */
    expect(createTeamMember).toHaveBeenCalledTimes(1);
    expect(result.failedUsers).toHaveLength(1);
    expect(result.failedUsers[0]!.user).toBe(missingId);
    expect(result.failedUsers[0]!.failedMessage).toBe("User ID not found.");
    expect(result.succeededUsers).toEqual([valid]);
  });

  test("emits progress once per user with the pending count draining to zero", async (): Promise<void> => {
    const users: Array<User> = [
      makeUser(FIRST_USER_ID),
      makeUser(SECOND_USER_ID),
      makeUser(THIRD_USER_ID),
    ];
    const inProgressCounts: Array<number> = [];

    await bulkAddUsersToProject({
      users: users,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (): Promise<void> => {},
      onProgress: (progress: BulkAddUsersToProjectProgress): void => {
        inProgressCounts.push(progress.inProgressUsers.length);
      },
    });

    /*
     * Two separate contracts, neither of them the progress bar's arithmetic.
     *
     * The bar itself does not read inProgressUsers at all: BulkUpdateForm
     * renders ProgressBar with count={successItems.length + failed.length} and
     * totalCount={totalItems.length}, and inProgressItems is only ever used to
     * seed the state in onBulkActionStart. What the bar needs from here is
     * simply that an emission arrives per user - a skipped one parks the bar
     * short of done even though the run finished.
     *
     * The drain to zero is read by Pages/Users/Index.tsx instead: it keeps the
     * last emission, and if the run itself throws mid-way it reports exactly
     * the users still sitting in inProgressUsers as failed. An inProgressUsers
     * that never drained would blame users who had already been added.
     */
    expect(inProgressCounts).toEqual([2, 1, 0]);
  });

  test("emits an independent snapshot each time rather than the live arrays", async (): Promise<void> => {
    const users: Array<User> = [
      makeUser(FIRST_USER_ID),
      makeUser(SECOND_USER_ID),
      makeUser(THIRD_USER_ID),
    ];
    const emissions: Array<BulkAddUsersToProjectProgress> = [];

    const result: BulkAddUsersToProjectResult = await bulkAddUsersToProject({
      users: users,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (): Promise<void> => {},
      onProgress: (progress: BulkAddUsersToProjectProgress): void => {
        emissions.push(progress);
      },
    });

    /*
     * Read the earlier emissions AFTER the run: if the callback were handed
     * the loop's own arrays, every stored emission would now show the final
     * state. React would also see the same array identity on each setState
     * and skip the re-render, so the modal would sit at 0% and then jump.
     */
    expect(emissions).toHaveLength(3);
    expect(emissions[0]!.inProgressUsers).toHaveLength(2);
    expect(emissions[1]!.inProgressUsers).toHaveLength(1);
    expect(emissions[2]!.inProgressUsers).toHaveLength(0);
    expect(emissions[0]!.succeededUsers).toHaveLength(1);
    expect(emissions[1]!.succeededUsers).toHaveLength(2);
    expect(emissions[2]!.succeededUsers).toHaveLength(3);
    expect(emissions[0]!.inProgressUsers).not.toBe(
      emissions[1]!.inProgressUsers,
    );
    expect(emissions[0]!.succeededUsers).not.toBe(emissions[1]!.succeededUsers);

    /*
     * All FOUR arrays, across all three emissions and the returned result, so
     * that a field which is merely aliased rather than copied cannot hide
     * behind the two that are checked by name above. totalUsers is the one
     * that used to be passed straight through: it never changes value, so no
     * length assertion anywhere in this file can see the difference, and only
     * the reference tells you that the page is holding the run's own array.
     */
    const snapshots: Array<BulkAddUsersToProjectProgress> = [
      ...emissions,
      result,
    ];
    const allEmittedArrays: Array<Array<unknown>> = [];

    for (const snapshot of snapshots) {
      allEmittedArrays.push(
        snapshot.totalUsers,
        snapshot.inProgressUsers,
        snapshot.succeededUsers,
        snapshot.failedUsers,
      );
    }

    expect(allEmittedArrays).toHaveLength(16);

    for (let index: number = 0; index < allEmittedArrays.length; index++) {
      const array: Array<unknown> = allEmittedArrays[index]!;

      /*
       * Not the caller's own array either. Handing `options.users` back out
       * would let the page mutate the run's input through what it thinks is a
       * report.
       */
      expect(array).not.toBe(users);

      for (
        let other: number = index + 1;
        other < allEmittedArrays.length;
        other++
      ) {
        expect(array).not.toBe(allEmittedArrays[other]!);
      }
    }
  });

  test("is unaffected by a receiver that mutates the arrays it was handed", async (): Promise<void> => {
    const users: Array<User> = [
      makeUser(FIRST_USER_ID),
      makeUser(SECOND_USER_ID),
      makeUser(THIRD_USER_ID),
    ];
    const sentinel: User = makeUser(null);
    const emissions: Array<BulkAddUsersToProjectProgress> = [];

    const result: BulkAddUsersToProjectResult = await bulkAddUsersToProject({
      users: users,
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: async (): Promise<void> => {},
      onProgress: (progress: BulkAddUsersToProjectProgress): void => {
        emissions.push(progress);

        if (emissions.length > 1) {
          return;
        }

        /*
         * Only the first emission is vandalised, so everything after it is
         * evidence about the run's own state rather than about this callback.
         */
        progress.totalUsers.push(sentinel);
        progress.inProgressUsers.push(sentinel);
        progress.succeededUsers.push(sentinel);
        progress.failedUsers.push({
          user: sentinel,
          failedMessage: "sentinel",
        });
      },
    });

    /*
     * The reference checks in the previous test show the arrays are copies;
     * this shows the copy is the thing that is handed out rather than the
     * thing the loop keeps. The page really does write to what it is given -
     * BulkUpdateForm stores the emission in React state and the sibling bulk
     * actions on this page splice their own progress arrays in place - so an
     * emission that aliased the loop's state would let a receiver corrupt the
     * run: inProgressUsers would stop draining to zero and the final report
     * would carry rows that no create ever produced.
     */
    expect(emissions).toHaveLength(3);
    expect(emissions[1]!.totalUsers).toHaveLength(3);
    expect(emissions[1]!.inProgressUsers).toHaveLength(1);
    expect(emissions[1]!.succeededUsers).toHaveLength(2);
    expect(emissions[1]!.failedUsers).toEqual([]);
    expect(emissions[2]!.totalUsers).toEqual(users);
    expect(emissions[2]!.inProgressUsers).toEqual([]);
    expect(emissions[2]!.succeededUsers).toEqual(users);
    expect(emissions[2]!.failedUsers).toEqual([]);

    expect(result.totalUsers).toEqual(users);
    expect(result.inProgressUsers).toEqual([]);
    expect(result.succeededUsers).toEqual(users);
    expect(result.failedUsers).toEqual([]);
  });

  test("returns exactly what the last progress emission reported", async (): Promise<void> => {
    const first: User = makeUser(FIRST_USER_ID);
    const failing: User = makeUser(SECOND_USER_ID);
    const last: User = makeUser(THIRD_USER_ID);
    const emissions: Array<BulkAddUsersToProjectProgress> = [];

    const result: BulkAddUsersToProjectResult = await bulkAddUsersToProject({
      users: [first, failing, last],
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: jest.fn(
        async (teamMember: TeamMember): Promise<void> => {
          if (teamMember.userId!.toString() === SECOND_USER_ID) {
            throw new Error("Create denied");
          }
        },
      ),
      onProgress: (progress: BulkAddUsersToProjectProgress): void => {
        emissions.push(progress);
      },
    });

    /*
     * The page renders the live progress while the run is going and then
     * swaps in the returned result when it ends. If the two disagreed, a
     * user's row would flip between succeeded and failed at the moment the
     * run finished.
     */
    expect(result).toEqual(emissions[emissions.length - 1]);
    expect(result.totalUsers).toHaveLength(3);
    expect(result.succeededUsers).toEqual([first, last]);
    expect(result.failedUsers).toHaveLength(1);
    expect(result.inProgressUsers).toEqual([]);
  });

  test("does nothing when the selection is empty", async (): Promise<void> => {
    const createTeamMember: (teamMember: TeamMember) => Promise<void> = jest.fn(
      async (_teamMember: TeamMember): Promise<void> => {},
    );

    const result: BulkAddUsersToProjectResult = await bulkAddUsersToProject({
      users: [],
      projectId: PROJECT_ID,
      teamId: TEAM_ID,
      createTeamMember: createTeamMember,
    });

    /*
     * The modal can be submitted with nothing usable selected, and this still
     * has to resolve so the page reaches onBulkActionEnd - the only thing that
     * re-enables the progress modal's close button.
     */
    expect(createTeamMember).not.toHaveBeenCalled();
    expect(result.totalUsers).toEqual([]);
    expect(result.inProgressUsers).toEqual([]);
    expect(result.succeededUsers).toEqual([]);
    expect(result.failedUsers).toEqual([]);
  });
});
