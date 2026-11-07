import Project from "../../../../Models/DatabaseModels/Project";
import PublicNoteApprovalStep from "../../../../Models/DatabaseModels/PublicNoteApprovalStep";
import Team from "../../../../Models/DatabaseModels/Team";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import ProjectReferencesService from "../../../../Server/Services/ProjectReferencesService";
import ProjectService from "../../../../Server/Services/ProjectService";
import PublicNoteApprovalStepService from "../../../../Server/Services/PublicNoteApprovalStepService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import PublicNoteApprovalPolicy, {
  PUBLIC_NOTE_APPROVAL_SWITCH_COLUMNS,
  PublicNoteApprovalPolicyMessages,
} from "../../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  PublicNoteApprovalEventType,
  PublicNoteApprovalStepRule,
} from "../../../../Types/StatusPage/PublicNoteApproval";
import { getJestSpyOn } from "../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A project's public note approval (issue #5720): whether it is on for a
 * kind of event, and the steps that approve. Read fresh every time. Turning
 * it on takes a step that names somebody, every step names somebody, and
 * the last step of a kind stays while approval is on - a note never waits
 * for nobody.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ALICE: string = "a1a1a1a1-0000-4000-8000-000000000001";
const TEAM: string = "d4d4d4d4-0000-4000-8000-000000000004";

function user(id: string): User {
  const record: User = new User();
  record._id = id;
  return record;
}

function team(id: string): Team {
  const record: Team = new Team();
  record._id = id;
  return record;
}

function storedStep(data: {
  id: string;
  name?: string;
  order?: number;
  users?: Array<string>;
  teams?: Array<string>;
}): PublicNoteApprovalStep {
  const step: PublicNoteApprovalStep = new PublicNoteApprovalStep();
  step._id = data.id;
  if (data.name !== undefined) {
    step.name = data.name;
  }
  if (data.order !== undefined) {
    step.order = data.order;
  }
  step.approverUsers = (data.users || []).map(user);
  step.approverTeams = (data.teams || []).map(team);
  return step;
}

function rule(
  overrides: Partial<PublicNoteApprovalStepRule> = {},
): PublicNoteApprovalStepRule {
  return { id: "s1", order: 1, userIds: [], teamIds: [], ...overrides };
}

async function refusalOf(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected a refusal");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PublicNoteApprovalPolicy.isRequired", () => {
  test("reads the project's switch for the kind, as OneUptime", async () => {
    for (const eventType of Object.values(PublicNoteApprovalEventType)) {
      for (const value of [true, false, null, undefined]) {
        const project: Project = new Project();
        project.setColumnValue(
          PUBLIC_NOTE_APPROVAL_SWITCH_COLUMNS[eventType],
          value as never,
        );

        const find: jest.SpyInstance = getJestSpyOn(
          ProjectService,
          "findOneById",
        ).mockResolvedValue(project as never);

        expect(
          await PublicNoteApprovalPolicy.isRequired({
            projectId: PROJECT_ID,
            eventType,
          }),
        ).toBe(value === true);

        expect(find).toHaveBeenCalledWith({
          id: PROJECT_ID,
          select: { [PUBLIC_NOTE_APPROVAL_SWITCH_COLUMNS[eventType]]: true },
          props: { isRoot: true },
        });

        find.mockRestore();
      }
    }
  });

  test("a project not found asks for nothing", async () => {
    getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(
      null as never,
    );

    expect(
      await PublicNoteApprovalPolicy.isRequired({
        projectId: PROJECT_ID,
        eventType: PublicNoteApprovalEventType.Incident,
      }),
    ).toBe(false);
  });

  test("incidents and episodes share one switch; maintenance has its own", () => {
    expect(PUBLIC_NOTE_APPROVAL_SWITCH_COLUMNS).toEqual({
      [PublicNoteApprovalEventType.Incident]:
        "requireApprovalForIncidentPublicNotes",
      [PublicNoteApprovalEventType.ScheduledMaintenance]:
        "requireApprovalForScheduledMaintenancePublicNotes",
    });
  });
});

describe("PublicNoteApprovalPolicy.getSteps", () => {
  test("the kind's steps of the project, with who each names, each once", async () => {
    const find: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalStepService,
      "findBy",
    ).mockResolvedValue([
      storedStep({
        id: "s1",
        name: "  Support  ",
        order: 1,
        users: [ALICE, ALICE],
        teams: [TEAM],
      }),
      storedStep({ id: "s2", name: "   ", order: 2 }),
      storedStep({ id: "s3" }),
    ] as never);

    expect(
      await PublicNoteApprovalPolicy.getSteps({
        projectId: PROJECT_ID,
        eventType: PublicNoteApprovalEventType.ScheduledMaintenance,
      }),
    ).toEqual([
      {
        id: "s1",
        name: "Support",
        order: 1,
        userIds: [ALICE],
        teamIds: [TEAM],
      },
      { id: "s2", order: 2, userIds: [], teamIds: [] },
      { id: "s3", order: 0, userIds: [], teamIds: [] },
    ]);

    const query: any = (find.mock.calls[0]![0] as any).query;
    expect(query).toEqual({
      projectId: PROJECT_ID,
      eventType: PublicNoteApprovalEventType.ScheduledMaintenance,
    });
  });
});

describe("PublicNoteApprovalPolicy.assertCanTurnOn", () => {
  test("turning a kind on takes a step that names somebody", async () => {
    getJestSpyOn(PublicNoteApprovalPolicy, "getSteps").mockResolvedValue([
      rule(),
    ]);

    const refusal: Error = await refusalOf(() => {
      return PublicNoteApprovalPolicy.assertCanTurnOn({
        projectIds: [PROJECT_ID],
        written: { requireApprovalForIncidentPublicNotes: true },
      });
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      PublicNoteApprovalPolicyMessages.noApproverToTurnOn(
        PublicNoteApprovalEventType.Incident,
      ),
    );
  });

  test("a step with a person, or a team, is enough", async () => {
    for (const steps of [
      [rule({ userIds: [ALICE] })],
      [rule(), rule({ id: "s2", teamIds: [TEAM] })],
    ]) {
      getJestSpyOn(PublicNoteApprovalPolicy, "getSteps").mockResolvedValue(
        steps,
      );

      await expect(
        PublicNoteApprovalPolicy.assertCanTurnOn({
          projectIds: [PROJECT_ID],
          written: { requireApprovalForScheduledMaintenancePublicNotes: true },
        }),
      ).resolves.toBeUndefined();
    }
  });

  test("a write that leaves the switches alone, or turns them off, asks nothing", async () => {
    const getSteps: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalPolicy,
      "getSteps",
    ).mockResolvedValue([]);

    for (const written of [
      {},
      { requireApprovalForIncidentPublicNotes: false },
      { requireApprovalForScheduledMaintenancePublicNotes: null },
    ]) {
      await PublicNoteApprovalPolicy.assertCanTurnOn({
        projectIds: [PROJECT_ID],
        written: written as never,
      });
    }

    expect(getSteps).not.toHaveBeenCalled();
  });

  test("the maintenance switch is checked against maintenance steps", async () => {
    const getSteps: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalPolicy,
      "getSteps",
    ).mockResolvedValue([]);

    const refusal: Error = await refusalOf(() => {
      return PublicNoteApprovalPolicy.assertCanTurnOn({
        projectIds: [PROJECT_ID],
        written: { requireApprovalForScheduledMaintenancePublicNotes: true },
      });
    });

    expect(refusal.message).toContain("scheduled maintenance");
    expect(getSteps).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      eventType: PublicNoteApprovalEventType.ScheduledMaintenance,
    });
  });
});

describe("PublicNoteApprovalPolicy: teams", () => {
  test("a person's teams are those they accepted, each once", async () => {
    const find: jest.SpyInstance = getJestSpyOn(
      TeamMemberService,
      "findBy",
    ).mockResolvedValue([
      Object.assign(new TeamMember(), { teamId: new ObjectID(TEAM) }),
      Object.assign(new TeamMember(), { teamId: new ObjectID(TEAM) }),
      new TeamMember(),
    ] as never);

    expect(
      await PublicNoteApprovalPolicy.getUserTeamIds({
        projectId: PROJECT_ID,
        userId: new ObjectID(ALICE),
      }),
    ).toEqual([TEAM]);
    expect((find.mock.calls[0]![0] as any).query.hasAcceptedInvitation).toBe(
      true,
    );
  });

  test("the members of teams, by team; no teams reads nothing", async () => {
    const find: jest.SpyInstance = getJestSpyOn(
      TeamMemberService,
      "findBy",
    ).mockResolvedValue([
      Object.assign(new TeamMember(), {
        teamId: new ObjectID(TEAM),
        userId: new ObjectID(ALICE),
      }),
      Object.assign(new TeamMember(), {
        teamId: new ObjectID(TEAM),
        userId: new ObjectID(ALICE),
      }),
      Object.assign(new TeamMember(), { teamId: new ObjectID(TEAM) }),
    ] as never);

    expect(
      await PublicNoteApprovalPolicy.getTeamMemberIds({
        projectId: PROJECT_ID,
        teamIds: [TEAM],
      }),
    ).toEqual({ [TEAM]: [ALICE] });

    find.mockClear();

    expect(
      await PublicNoteApprovalPolicy.getTeamMemberIds({
        projectId: PROJECT_ID,
        teamIds: [],
      }),
    ).toEqual({});
    expect(find).not.toHaveBeenCalled();
  });
});

describe("PublicNoteApprovalStepService: every step names somebody", () => {
  interface StepHooks {
    onBeforeCreate: (createBy: CreateBy<PublicNoteApprovalStep>) => Promise<{
      createBy: CreateBy<PublicNoteApprovalStep>;
    }>;
    onBeforeUpdate: (updateBy: UpdateBy<PublicNoteApprovalStep>) => Promise<{
      updateBy: UpdateBy<PublicNoteApprovalStep>;
    }>;
    onBeforeDelete: (deleteBy: DeleteBy<PublicNoteApprovalStep>) => Promise<{
      deleteBy: DeleteBy<PublicNoteApprovalStep>;
    }>;
  }

  const hooks: StepHooks = PublicNoteApprovalStepService as unknown as StepHooks;

  function passReferences(): void {
    getJestSpyOn(
      ProjectReferencesService.prototype as unknown as StepHooks,
      "onBeforeCreate",
    ).mockImplementation((async (createBy: unknown) => {
      return { createBy, carryForward: null };
    }) as never);
    getJestSpyOn(
      ProjectReferencesService.prototype as unknown as StepHooks,
      "onBeforeUpdate",
    ).mockImplementation((async (updateBy: unknown) => {
      return { updateBy, carryForward: null };
    }) as never);
  }

  function newStep(data: {
    eventType?: string;
    users?: Array<string>;
    teams?: Array<string>;
  }): PublicNoteApprovalStep {
    const step: PublicNoteApprovalStep = new PublicNoteApprovalStep();
    step.projectId = PROJECT_ID;
    step.eventType = (data.eventType ??
      PublicNoteApprovalEventType.Incident) as PublicNoteApprovalEventType;
    step.approverUsers = (data.users || []).map(user);
    step.approverTeams = (data.teams || []).map(team);
    return step;
  }

  test("a step that names nobody is refused", async () => {
    passReferences();

    const refusal: Error = await refusalOf(() => {
      return hooks.onBeforeCreate({
        data: newStep({}),
        props: { isRoot: true },
      });
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      PublicNoteApprovalPolicyMessages.stepNeedsApprover,
    );
  });

  test("a step for an unknown kind of note is refused", async () => {
    passReferences();

    const refusal: Error = await refusalOf(() => {
      return hooks.onBeforeCreate({
        data: newStep({ eventType: "Alert", users: [ALICE] }),
        props: { isRoot: true },
      });
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toContain("Incident or ScheduledMaintenance");
  });

  test("a step naming a person, or a team, is created", async () => {
    passReferences();

    for (const step of [
      newStep({ users: [ALICE] }),
      newStep({
        eventType: PublicNoteApprovalEventType.ScheduledMaintenance,
        teams: [TEAM],
      }),
    ]) {
      await expect(
        hooks.onBeforeCreate({ data: step, props: { isRoot: true } }),
      ).resolves.toMatchObject({ createBy: { data: step } });
    }
  });

  test("an update that takes everybody off a step is refused", async () => {
    passReferences();
    getJestSpyOn(PublicNoteApprovalStepService, "findBy").mockResolvedValue([
      storedStep({ id: "s1", users: [ALICE] }),
    ] as never);

    const refusal: Error = await refusalOf(() => {
      return hooks.onBeforeUpdate({
        query: { _id: "s1" },
        data: { approverUsers: [] } as never,
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as UpdateBy<PublicNoteApprovalStep>);
    });

    expect(refusal.message).toBe(
      PublicNoteApprovalPolicyMessages.stepNeedsApprover,
    );
  });

  test("an update that takes the people off a step its team still approves is fine", async () => {
    passReferences();
    getJestSpyOn(PublicNoteApprovalStepService, "findBy").mockResolvedValue([
      storedStep({ id: "s1", users: [ALICE], teams: [TEAM] }),
    ] as never);

    await expect(
      hooks.onBeforeUpdate({
        query: { _id: "s1" },
        data: { approverUsers: [] } as never,
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as UpdateBy<PublicNoteApprovalStep>),
    ).resolves.toBeTruthy();
  });

  test("an update of anything else reads nothing", async () => {
    passReferences();
    const find: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalStepService,
      "findBy",
    ).mockResolvedValue([] as never);

    await hooks.onBeforeUpdate({
      query: { _id: "s1" },
      data: { name: "Legal" } as never,
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    } as UpdateBy<PublicNoteApprovalStep>);

    expect(find).not.toHaveBeenCalled();
  });

  function deleting(eventType: PublicNoteApprovalEventType): void {
    const step: PublicNoteApprovalStep = new PublicNoteApprovalStep();
    step._id = "s1";
    step.projectId = PROJECT_ID;
    step.eventType = eventType;

    getJestSpyOn(
      PublicNoteApprovalStepService,
      "findRowsAndHoldDeleteToThem",
    ).mockResolvedValue([step] as never);
  }

  const deleteBy: DeleteBy<PublicNoteApprovalStep> = {
    query: { _id: "s1" },
    props: { isRoot: true },
    limit: 1,
    skip: 0,
  } as DeleteBy<PublicNoteApprovalStep>;

  test("while approval is on, its last step of the kind stays", async () => {
    deleting(PublicNoteApprovalEventType.Incident);
    getJestSpyOn(PublicNoteApprovalPolicy, "isRequired").mockResolvedValue(
      true,
    );
    getJestSpyOn(PublicNoteApprovalPolicy, "getSteps").mockResolvedValue([
      rule({ id: "s1", userIds: [ALICE] }),
    ]);

    const refusal: Error = await refusalOf(() => {
      return hooks.onBeforeDelete(deleteBy);
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(
      PublicNoteApprovalPolicyMessages.lastStepWhileOn,
    );
  });

  test("a step with another left, or while approval is off, is deleted", async () => {
    deleting(PublicNoteApprovalEventType.Incident);
    getJestSpyOn(PublicNoteApprovalPolicy, "isRequired").mockResolvedValue(
      true,
    );
    getJestSpyOn(PublicNoteApprovalPolicy, "getSteps").mockResolvedValue([
      rule({ id: "s1", userIds: [ALICE] }),
      rule({ id: "s2", teamIds: [TEAM] }),
    ]);

    await expect(hooks.onBeforeDelete(deleteBy)).resolves.toMatchObject({
      deleteBy,
    });

    jest.restoreAllMocks();
    deleting(PublicNoteApprovalEventType.ScheduledMaintenance);
    getJestSpyOn(PublicNoteApprovalPolicy, "isRequired").mockResolvedValue(
      false,
    );
    const getSteps: jest.SpyInstance = getJestSpyOn(
      PublicNoteApprovalPolicy,
      "getSteps",
    ).mockResolvedValue([]);

    await expect(hooks.onBeforeDelete(deleteBy)).resolves.toMatchObject({
      deleteBy,
    });
    expect(getSteps).not.toHaveBeenCalled();
  });
});
