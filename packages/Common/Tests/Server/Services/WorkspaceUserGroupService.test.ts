import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import WorkspaceUserGroup from "../../../Models/DatabaseModels/WorkspaceUserGroup";
import WorkspaceUserGroupService, {
  ALREADY_LINKED_MESSAGE,
  NO_SCHEDULE_MESSAGE,
} from "../../../Server/Services/WorkspaceUserGroupService";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import WorkspaceUserGroupSync from "../../../Server/Utils/Workspace/UserGroups/WorkspaceUserGroupSync";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * The rules of an on-call user group record (WorkspaceUserGroupService),
 * whichever way it is written - the schedule page's card, the API,
 * Terraform: a workspace and the group's id there, a Microsoft Teams tag's
 * team, at least one schedule, one record per group in a project; and a
 * new or changed record is looked at straight away. The hooks are
 * protected, so they are reached through `as any`, as other service hook
 * tests do.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "e0000000-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "e0000000-0000-4000-8000-000000000002",
);

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("e0000000-0000-4000-8000-000000000003"),
};

// The service's protected hooks.
const hooks: {
  checkUpdateBeforeReferences: (updateBy: unknown) => Promise<void>;
  onBeforeCreate: (createBy: unknown) => Promise<unknown>;
  onCreateSuccess: (
    onCreate: unknown,
    item: WorkspaceUserGroup,
  ) => Promise<unknown>;
  onUpdateSuccess: (
    onUpdate: unknown,
    ids: Array<ObjectID>,
  ) => Promise<unknown>;
} = WorkspaceUserGroupService as never;

function schedule(id: ObjectID = SCHEDULE_ID): OnCallDutyPolicySchedule {
  const model: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  model.id = id;
  return model;
}

function slackGroup(
  overrides: Partial<Record<string, unknown>> = {},
): WorkspaceUserGroup {
  const model: WorkspaceUserGroup = new WorkspaceUserGroup();
  model.projectId = PROJECT_ID;
  model.workspaceType = WorkspaceType.Slack;
  model.workspaceGroupId = "S0604QSJC";
  model.onCallDutyPolicySchedules = [schedule()];
  Object.assign(model, overrides);
  return model;
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  throw new Error("It was not refused.");
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * A create, past the project's reference check (a project's own schedules
 * pass it) and with no record keeping the group yet: the record's own rules.
 */
async function createRules(data: WorkspaceUserGroup): Promise<unknown> {
  return await hooks.onBeforeCreate({ data: data, props: PROPS });
}

describe("what a group record must be", () => {
  beforeEach(() => {
    jest
      .spyOn(ProjectReferenceCheck, "validateCreate")
      .mockResolvedValue(undefined as never);
    jest.spyOn(WorkspaceUserGroupService, "findOneBy").mockResolvedValue(null);
  });

  test("a Slack group following a schedule passes, its id trimmed", async () => {
    const data: WorkspaceUserGroup = slackGroup({
      workspaceGroupId: "  S0604QSJC ",
    });

    await createRules(data);

    expect(data.workspaceGroupId).toBe("S0604QSJC");
  });

  test("a workspace other than Slack or Microsoft Teams is refused", async () => {
    const error: Error = await refusal(
      createRules(slackGroup({ workspaceType: "Discord" })),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(
      "Workspace Type must be Slack or MicrosoftTeams.",
    );
  });

  test("no group id in the workspace is refused", async () => {
    const error: Error = await refusal(
      createRules(slackGroup({ workspaceGroupId: "   " })),
    );

    expect(error.message).toBe(
      "Workspace Group ID is required: the id of the Slack user group or the Microsoft Teams tag.",
    );
  });

  test("a Microsoft Teams tag needs its team", async () => {
    const error: Error = await refusal(
      createRules(slackGroup({ workspaceType: WorkspaceType.MicrosoftTeams })),
    );

    expect(error.message).toBe(
      "Workspace Team ID is required for a Microsoft Teams tag: the team the tag is in.",
    );

    const data: WorkspaceUserGroup = slackGroup({
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceTeamId: " team-1 ",
      name: "x".repeat(60),
    });

    await createRules(data);

    expect(data.workspaceTeamId).toBe("team-1");
    // A tag's name holds 40 characters.
    expect(data.name).toBe("x".repeat(40));
  });

  test("a Slack group's name is trimmed and held to 100 characters", async () => {
    const data: WorkspaceUserGroup = slackGroup({
      name: `  ${"y".repeat(130)}`,
    });

    await createRules(data);

    expect(data.name).toBe("y".repeat(100));
  });

  test("a group follows at least one schedule", async () => {
    for (const schedules of [undefined, [], [null], ["  "]]) {
      const error: Error = await refusal(
        createRules(slackGroup({ onCallDutyPolicySchedules: schedules })),
      );

      expect(error.message).toBe(NO_SCHEDULE_MESSAGE);
    }
  });

  test("a schedule may be named by its id in any form an API caller sends", async () => {
    for (const schedules of [
      [SCHEDULE_ID],
      [SCHEDULE_ID.toString()],
      [{ _id: SCHEDULE_ID.toString() }],
      [schedule()],
    ]) {
      await expect(
        createRules(slackGroup({ onCallDutyPolicySchedules: schedules })),
      ).resolves.toEqual(expect.objectContaining({ carryForward: undefined }));
    }
  });

  test("another project's schedule is answered by the reference check first, whatever else the write lacks", async () => {
    jest
      .spyOn(ProjectReferenceCheck, "validateCreate")
      .mockRejectedValue(
        new ProjectScopedReferenceException(
          'This WorkspaceUserGroup references records that are not in this project: OnCallDutyPolicySchedule "x".',
        ) as never,
      );

    const error: Error = await refusal(
      createRules(
        slackGroup({ workspaceType: undefined, workspaceGroupId: "" }),
      ),
    );

    // Not "Workspace Type must be...": an id from another project gets the
    // answer an id that matches nothing gets.
    expect(error).toBeInstanceOf(ProjectScopedReferenceException);
  });

  test("an update may change the schedules, never down to none", async () => {
    const error: Error = await refusal(
      hooks.checkUpdateBeforeReferences({
        data: { onCallDutyPolicySchedules: [] },
        props: PROPS,
      }),
    );

    expect(error.message).toBe(NO_SCHEDULE_MESSAGE);

    await expect(
      hooks.checkUpdateBeforeReferences({
        data: { onCallDutyPolicySchedules: [schedule()] },
        props: PROPS,
      }),
    ).resolves.toBeUndefined();

    // An update that does not touch them.
    await expect(
      hooks.checkUpdateBeforeReferences({
        data: { name: "Payments on-call" },
        props: PROPS,
      }),
    ).resolves.toBeUndefined();
  });

  test("the words say what to do instead", () => {
    expect(NO_SCHEDULE_MESSAGE).toBe(
      "A user group follows at least one on-call schedule. To stop OneUptime from updating it, delete it instead.",
    );
    expect(ALREADY_LINKED_MESSAGE).toBe(
      "This user group already follows on-call schedules in this project. Add the schedule to it instead.",
    );
  });
});

describe("one record per group in a project", () => {
  test("a group the project keeps in step already is refused - its schedules are added to that one", async () => {
    jest
      .spyOn(ProjectReferenceCheck, "validateCreate")
      .mockResolvedValue(undefined as never);
    const findOneBy: SpyInstance<typeof WorkspaceUserGroupService.findOneBy> =
      jest
        .spyOn(WorkspaceUserGroupService, "findOneBy")
        .mockResolvedValue(slackGroup());

    const error: Error = await refusal(
      hooks.onBeforeCreate({ data: slackGroup(), props: PROPS }),
    );

    expect(error.message).toBe(ALREADY_LINKED_MESSAGE);
    expect(findOneBy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: {
          projectId: PROJECT_ID,
          workspaceType: WorkspaceType.Slack,
          workspaceGroupId: "S0604QSJC",
        },
        props: { isRoot: true },
      }),
    );
  });

  test("a group no record keeps yet passes, after the project's references and the record's rules are checked", async () => {
    const order: Array<string> = [];

    jest
      .spyOn(ProjectReferenceCheck, "validateCreate")
      .mockImplementation((async (data: {
        createBy: { data: WorkspaceUserGroup };
      }) => {
        // The rules have not trimmed the id yet: they come after.
        order.push(`references ${data.createBy.data.workspaceGroupId}`);
      }) as never);
    jest
      .spyOn(WorkspaceUserGroupService, "findOneBy")
      .mockImplementation((async (query: {
        query: { workspaceGroupId: string };
      }) => {
        order.push(`one per group ${query.query.workspaceGroupId}`);
        return null;
      }) as never);

    await hooks.onBeforeCreate({
      data: slackGroup({ workspaceGroupId: " S0604QSJC " }),
      props: PROPS,
    });

    expect(order).toEqual([
      "references  S0604QSJC ",
      "one per group S0604QSJC",
    ]);
  });
});

describe("a new or changed group is looked at straight away", () => {
  test("a new group is synced in the background - the create does not wait for Slack", async () => {
    const requested: Array<Array<string>> = [];

    jest.spyOn(WorkspaceUserGroupSync, "requestSync").mockImplementation(((
      ids: Array<ObjectID>,
    ) => {
      requested.push(
        ids.map((id: ObjectID): string => {
          return id.toString();
        }),
      );
      // Slack never answers: the create must not wait for it.
      return new Promise<void>(() => {});
    }) as never);

    const created: WorkspaceUserGroup = slackGroup();
    created.id = new ObjectID("e0000000-0000-4000-8000-000000000010");

    await expect(hooks.onCreateSuccess({}, created)).resolves.toBe(created);
    expect(requested).toEqual([[created.id.toString()]]);
  });

  test("a group whose schedules changed is synced", async () => {
    const requestSync: SpyInstance<typeof WorkspaceUserGroupSync.requestSync> =
      jest
        .spyOn(WorkspaceUserGroupSync, "requestSync")
        .mockResolvedValue(undefined);
    const ids: Array<ObjectID> = [
      new ObjectID("e0000000-0000-4000-8000-000000000011"),
    ];

    await hooks.onUpdateSuccess(
      {
        updateBy: { data: { onCallDutyPolicySchedules: [schedule()] } },
      },
      ids,
    );

    expect(requestSync).toHaveBeenCalledTimes(1);
    expect(requestSync.mock.calls[0]![0]).toBe(ids);
  });

  test("an update that does not touch the schedules syncs nothing", async () => {
    const requestSync: SpyInstance<typeof WorkspaceUserGroupSync.requestSync> =
      jest
        .spyOn(WorkspaceUserGroupSync, "requestSync")
        .mockResolvedValue(undefined);

    await hooks.onUpdateSuccess({ updateBy: { data: { name: "x" } } }, [
      new ObjectID("e0000000-0000-4000-8000-000000000012"),
    ]);

    expect(requestSync).not.toHaveBeenCalled();
  });
});

describe("the groups that follow some schedules", () => {
  test("read as OneUptime, by the schedules they follow", async () => {
    const group: WorkspaceUserGroup = slackGroup();
    group.id = new ObjectID("e0000000-0000-4000-8000-000000000013");

    const findBy: SpyInstance<typeof WorkspaceUserGroupService.findBy> = jest
      .spyOn(WorkspaceUserGroupService, "findBy")
      .mockResolvedValue([group]);

    const ids: Array<ObjectID> =
      await WorkspaceUserGroupService.findIdsFollowingSchedules([SCHEDULE_ID]);

    expect(
      ids.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([group.id.toString()]);
    expect(findBy.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        query: { onCallDutyPolicySchedules: [SCHEDULE_ID] },
        select: { _id: true },
        props: { isRoot: true },
      }),
    );
  });

  test("no schedules: nothing is read", async () => {
    const findBy: SpyInstance<typeof WorkspaceUserGroupService.findBy> =
      jest.spyOn(WorkspaceUserGroupService, "findBy");

    expect(
      await WorkspaceUserGroupService.findIdsFollowingSchedules([]),
    ).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });
});
