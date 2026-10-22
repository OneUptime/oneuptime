import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Runner from "../../../../Models/DatabaseModels/Runner";
import RunnerService from "../../../../Server/Services/RunnerService";
import RunnerAiCommandsPick from "../../../../Server/Utils/Runner/RunnerAiCommandsPick";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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
 * The pick asked one thing more while runbook credentials existed: someone
 * who could not read them could not let OneUptime AI's commands reach a
 * Runner that held SSH credentials, and their pick held the project's lock
 * (AiCommandCredentialReach) from before it read until it wrote. Runbook
 * credentials were removed, and the check and its lock with them: who may
 * pick is decided where the pick is saved.
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

  test.each([
    [
      "a rule editor who may not read anything else",
      (): DatabaseCommonInteractionProps | undefined => {
        return picker(RULE_EDITOR);
      },
    ],
    [
      "OneUptime itself",
      (): DatabaseCommonInteractionProps | undefined => {
        return { isRoot: true };
      },
    ],
    [
      "a caller who names no one",
      (): DatabaseCommonInteractionProps | undefined => {
        return undefined;
      },
    ],
  ])(
    "%s: the pick turns the Runner on, and asks nothing more",
    async (
      _label: string,
      props: () => DatabaseCommonInteractionProps | undefined,
    ) => {
      const runners: ReturnType<typeof stubRunners> = stubRunners([
        row(HOST_RUNNER_ID),
      ]);

      await RunnerAiCommandsPick.allowPickedRunners({
        projectId: PROJECT_ID,
        runnerIds: [HOST_RUNNER_ID],
        props: props(),
      });

      // One read and one write, both as OneUptime, whoever picked.
      expect(runners.findCalls()).toHaveLength(1);
      expect(runners.findCalls()[0]!.props.isRoot).toBe(true);
      expect(runners.updateCalls()).toHaveLength(1);
      expect(runners.updateCalls()[0]!.data).toEqual({
        canRunAiCommands: true,
      });
    },
  );

  test("the credential check and the project's lock went with runbook credentials", () => {
    expect(RunnerService).not.toHaveProperty(
      "assertNoCredentialsForAiCommands",
    );
    expect(
      fs.existsSync(
        path.join(
          __dirname,
          "../../../../Server/Utils/AutoRemediation/AiCommandCredentialReach.ts",
        ),
      ),
    ).toBe(false);
  });

  test("a pick that writes nothing reads once, and turns nothing on", async () => {
    // Read with canRunAiCommands: false, so a Runner that runs them already is not.
    const runners: ReturnType<typeof stubRunners> = stubRunners([]);

    await RunnerAiCommandsPick.allowPickedRunners({
      projectId: PROJECT_ID,
      runnerIds: [HOST_RUNNER_ID],
      props: picker(RULE_EDITOR),
    });

    expect(runners.findCalls()).toHaveLength(1);
    expect(runners.updateCalls()).toEqual([]);
  });
});
