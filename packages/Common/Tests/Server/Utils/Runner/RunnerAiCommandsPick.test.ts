import { afterEach, describe, expect, jest, test } from "@jest/globals";
import Runner from "../../../../Models/DatabaseModels/Runner";
import RunnerService from "../../../../Server/Services/RunnerService";
import AiCommandCredentialReach, {
  CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE,
  CredentialReachHold,
} from "../../../../Server/Utils/AutoRemediation/AiCommandCredentialReach";
import RunnerAiCommandsPick from "../../../../Server/Utils/Runner/RunnerAiCommandsPick";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";

/*
 * PICKING A RUNNER FOR ONEUPTIME AI'S COMMANDS IS WHAT LETS THEM RUN THERE.
 *
 * The Runner's own "Runs AI Remediation Commands" switch is gone: an auto
 * remediation rule that picks a Runner, or a Kubernetes cluster's AI
 * settings that bind one, turn Runner.canRunAiCommands on for it - the
 * column every serve, approve and run check still reads. Only the project's
 * own Runners: never a global Runner, never another project's, never the
 * in-cluster Runner the Kubernetes agent chart installed.
 *
 * And the pick asks what the switch asked: someone who may not read runbook
 * credentials may not let OneUptime AI's commands reach a Runner that holds
 * SSH credentials, and their pick holds the project's lock
 * (AiCommandCredentialReach) from before it reads until it is written.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-000000000001",
);
const HOST_RUNNER_ID: string = "aaaaaaaa-0000-4000-8000-000000000001";
const AGENT_RUNNER_ID: string = "aaaaaaaa-0000-4000-8000-000000000002";
const POSTURE_AGENT_RUNNER_ID: string = "aaaaaaaa-0000-4000-8000-000000000003";

function row(id: string, fields: Record<string, unknown> = {}): Runner {
  return Object.assign(new Runner(), { _id: id, name: "bash-runner" }, fields);
}

interface FindCall {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  props: { isRoot?: boolean };
}

interface UpdateCall {
  id: ObjectID;
  data: Record<string, unknown>;
  props: { isRoot?: boolean };
}

function stubRunners(rows: Array<Runner>): {
  findCalls: () => Array<FindCall>;
  updateCalls: () => Array<UpdateCall>;
} {
  const findBy: ReturnType<typeof jest.spyOn> = jest
    .spyOn(RunnerService, "findBy")
    .mockResolvedValue(rows as never);
  const updateOneById: ReturnType<typeof jest.spyOn> = jest
    .spyOn(RunnerService, "updateOneById")
    .mockResolvedValue(undefined as never);

  return {
    findCalls: (): Array<FindCall> => {
      return findBy.mock.calls.map((call: Array<unknown>): FindCall => {
        return call[0] as FindCall;
      });
    },
    updateCalls: (): Array<UpdateCall> => {
      return updateOneById.mock.calls.map(
        (call: Array<unknown>): UpdateCall => {
          return call[0] as UpdateCall;
        },
      );
    },
  };
}

// The ids a QueryHelper.any condition holds (its parameter name is random).
function idsOf(condition: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (condition as { _objectLiteralParameters?: Record<string, unknown> })
      ._objectLiteralParameters || {};

  return Object.values(parameters).flatMap((value: unknown): Array<string> => {
    return (Array.isArray(value) ? value : [value]).map(String);
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("RunnerAiCommandsPick.allowPickedRunners", () => {
  test("reads, as root, only the project's own Runners the pick names that do not run them yet, and are not global", async () => {
    const runners: ReturnType<typeof stubRunners> = stubRunners([]);

    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: [new ObjectID(HOST_RUNNER_ID), AGENT_RUNNER_ID],
    });

    expect(runners.findCalls()).toHaveLength(1);
    const find: FindCall = runners.findCalls()[0]!;
    expect(idsOf(find.query["_id"])).toEqual([HOST_RUNNER_ID, AGENT_RUNNER_ID]);
    expect({ ...find.query, _id: undefined }).toEqual({
      _id: undefined,
      projectId: PROJECT_ID,
      isGlobalRunner: false,
      canRunAiCommands: false,
    });
    // The name and posture decide whether it is the chart's own Runner.
    expect(find.select).toEqual({ _id: true, name: true, hostInfo: true });
    expect(find.limit).toBe(2);
    expect(find.props.isRoot).toBe(true);
    // Nothing read, nothing written.
    expect(runners.updateCalls()).toEqual([]);
  });

  test("turns OneUptime AI's commands on for each Runner it finds, as root", async () => {
    const runners: ReturnType<typeof stubRunners> = stubRunners([
      row(HOST_RUNNER_ID),
    ]);

    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: [HOST_RUNNER_ID],
    });

    expect(runners.updateCalls()).toHaveLength(1);
    const update: UpdateCall = runners.updateCalls()[0]!;
    expect(update.id.toString()).toBe(HOST_RUNNER_ID);
    expect(update.data).toEqual({ canRunAiCommands: true });
    expect(update.props.isRoot).toBe(true);
  });

  test("never the in-cluster Runner the Kubernetes agent chart installed, by its name or its posture", async () => {
    const runners: ReturnType<typeof stubRunners> = stubRunners([
      row(AGENT_RUNNER_ID, { name: "kubernetes-agent/prod-east" }),
      row(POSTURE_AGENT_RUNNER_ID, {
        name: "prod-east-kubectl",
        hostInfo: {
          kubernetes: {
            inCluster: true,
            allowWrites: true,
            clusterIdentifier: "prod-east",
          },
        },
      }),
      row(HOST_RUNNER_ID),
    ]);

    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: [AGENT_RUNNER_ID, POSTURE_AGENT_RUNNER_ID, HOST_RUNNER_ID],
    });

    expect(
      runners.updateCalls().map((update: UpdateCall): string => {
        return update.id.toString();
      }),
    ).toEqual([HOST_RUNNER_ID]);
  });

  test("does nothing without a project, or without a Runner picked", async () => {
    const runners: ReturnType<typeof stubRunners> = stubRunners([
      row(HOST_RUNNER_ID),
    ]);

    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: null,
      runnerIds: [HOST_RUNNER_ID],
    });
    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: [],
    });
    // Clearing a rule's Runner, or a cluster's binding, picks none.
    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: [null, undefined, ""],
    });
    // Not an id at all.
    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: ["not-a-runner"],
    });

    expect(runners.findCalls()).toEqual([]);
    expect(runners.updateCalls()).toEqual([]);
  });
});

describe("who picks the Runner", () => {
  // Someone in the project with `permissions`.
  function picker(
    permissions: Array<Permission>,
  ): DatabaseCommonInteractionProps {
    return {
      tenantId: PROJECT_ID,
      userId: ObjectID.generate(),
      userType: UserType.User,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: permissions.map(
            (permission: Permission): UserPermission => {
              return {
                _type: "UserPermission",
                permission: permission,
                labelIds: [],
              };
            },
          ),
        },
      },
    } as unknown as DatabaseCommonInteractionProps;
  }

  const RULE_EDITOR: Array<Permission> = [
    Permission.CreateAutoRemediationRule,
    Permission.EditAutoRemediationRule,
  ];

  interface Lock {
    hold: CredentialReachHold;
    take: ReturnType<typeof jest.spyOn>;
    keep: ReturnType<typeof jest.spyOn>;
    giveBack: ReturnType<typeof jest.spyOn>;
  }

  function stubLock(): Lock {
    const hold: CredentialReachHold = { locks: [] };

    return {
      hold,
      take: jest
        .spyOn(AiCommandCredentialReach, "take")
        .mockResolvedValue(hold as never),
      keep: jest
        .spyOn(AiCommandCredentialReach, "keepForWrite")
        .mockResolvedValue(undefined as never),
      giveBack: jest
        .spyOn(AiCommandCredentialReach, "giveBack")
        .mockResolvedValue(undefined as never),
    };
  }

  test("someone who may read runbook credentials is not asked, and takes no lock", async () => {
    const runners: ReturnType<typeof stubRunners> = stubRunners([
      row(HOST_RUNNER_ID),
    ]);
    const lock: Lock = stubLock();
    const credentials: ReturnType<typeof jest.spyOn> = jest.spyOn(
      RunnerService,
      "assertNoCredentialsForAiCommands",
    );

    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: [HOST_RUNNER_ID],
      props: picker([...RULE_EDITOR, Permission.ReadRunbookCredential]),
    });

    expect(lock.take).not.toHaveBeenCalled();
    expect(credentials).not.toHaveBeenCalled();
    expect(runners.updateCalls()).toHaveLength(1);
  });

  test("OneUptime's own pick is not asked either", async () => {
    const runners: ReturnType<typeof stubRunners> = stubRunners([
      row(HOST_RUNNER_ID),
    ]);
    const lock: Lock = stubLock();

    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: [HOST_RUNNER_ID],
      props: { isRoot: true },
    });

    expect(lock.take).not.toHaveBeenCalled();
    expect(runners.updateCalls()).toHaveLength(1);
  });

  test("anyone else's pick is checked under the project's lock, kept right before the write, then given back", async () => {
    const runners: ReturnType<typeof stubRunners> = stubRunners([
      row(HOST_RUNNER_ID),
    ]);
    const lock: Lock = stubLock();
    const order: Array<string> = [];
    lock.take.mockImplementation(async (): Promise<never> => {
      order.push("lock");
      return lock.hold as never;
    });
    jest
      .spyOn(RunnerService, "assertNoCredentialsForAiCommands")
      .mockImplementation(async (turnedOn: unknown): Promise<void> => {
        order.push(
          `check ${(turnedOn as Array<Runner>)
            .map((runner: Runner): string => {
              return String(runner._id);
            })
            .join(",")}`,
        );
      });
    lock.keep.mockImplementation(async (): Promise<void> => {
      order.push("keep");
    });
    jest
      .mocked(RunnerService.updateOneById)
      .mockImplementation(async (): Promise<never> => {
        order.push("write");
        return undefined as never;
      });
    lock.giveBack.mockImplementation(async (): Promise<void> => {
      order.push("give back");
    });

    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: [HOST_RUNNER_ID],
      props: picker(RULE_EDITOR),
    });

    expect(lock.take).toHaveBeenCalledWith([PROJECT_ID]);
    expect(order).toEqual([
      "lock",
      `check ${HOST_RUNNER_ID}`,
      "keep",
      "write",
      "give back",
    ]);
    // Read under the lock: the switch as it is now.
    expect(runners.findCalls()).toHaveLength(1);
  });

  test("a Runner that holds SSH credentials is refused, says who may, and nothing is written", async () => {
    const runners: ReturnType<typeof stubRunners> = stubRunners([
      row(HOST_RUNNER_ID),
    ]);
    stubLock();
    jest
      .spyOn(AiCommandCredentialReach, "giveBackAfterFailedWrite")
      .mockResolvedValue(undefined as never);
    const refusal: NotAuthorizedException = new NotAuthorizedException(
      'Runner "bash-runner" holds SSH credentials that OneUptime AI picks from for the commands it runs there, so letting it run OneUptime AI\'s commands takes permission to read runbook credentials: Read Runbook Credential.',
    );
    jest
      .spyOn(RunnerService, "assertNoCredentialsForAiCommands")
      .mockRejectedValue(refusal as never);

    await expect(
      RunnerAiCommandsPick.allowPickedRunners({
        projectId: PROJECT_ID,
        runnerIds: [HOST_RUNNER_ID],
        props: picker(RULE_EDITOR),
      }),
    ).rejects.toBe(refusal);

    expect(runners.updateCalls()).toEqual([]);
    expect(
      AiCommandCredentialReach.giveBackAfterFailedWrite,
    ).toHaveBeenCalled();
  });

  test("the check is asked about exactly the Runners the pick turns on, for the picker", async () => {
    stubRunners([row(HOST_RUNNER_ID)]);
    stubLock();
    // RunnerServiceAiCommandsCredentialRead pins what the check reads.
    const props: DatabaseCommonInteractionProps = picker(RULE_EDITOR);
    const assertion: ReturnType<typeof jest.spyOn> = jest.spyOn(
      RunnerService,
      "assertNoCredentialsForAiCommands",
    );
    assertion.mockResolvedValue(undefined as never);

    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: [HOST_RUNNER_ID],
      props,
    });

    expect(assertion).toHaveBeenCalledWith(
      [expect.objectContaining({ _id: HOST_RUNNER_ID })],
      props,
    );
  });

  test("a pick that cannot have the lock is refused before anything is read", async () => {
    const runners: ReturnType<typeof stubRunners> = stubRunners([
      row(HOST_RUNNER_ID),
    ]);
    jest
      .spyOn(AiCommandCredentialReach, "take")
      .mockRejectedValue(
        new BadDataException(
          CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE,
        ) as never,
      );

    await expect(
      RunnerAiCommandsPick.allowPickedRunners({
        projectId: PROJECT_ID,
        runnerIds: [HOST_RUNNER_ID],
        props: picker(RULE_EDITOR),
      }),
    ).rejects.toThrow(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE);

    expect(runners.findCalls()).toEqual([]);
    expect(runners.updateCalls()).toEqual([]);
  });

  test("a Runner that runs OneUptime AI's commands already is not asked about", async () => {
    // Read with canRunAiCommands: false, so none comes back.
    const runners: ReturnType<typeof stubRunners> = stubRunners([]);
    const lock: Lock = stubLock();
    const credentials: ReturnType<typeof jest.spyOn> = jest.spyOn(
      RunnerService,
      "assertNoCredentialsForAiCommands",
    );

    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: [HOST_RUNNER_ID],
      props: picker(RULE_EDITOR),
    });

    expect(credentials).not.toHaveBeenCalled();
    expect(runners.updateCalls()).toEqual([]);
    // The lock is given back all the same.
    expect(lock.giveBack).toHaveBeenCalledWith(lock.hold);
  });
});
