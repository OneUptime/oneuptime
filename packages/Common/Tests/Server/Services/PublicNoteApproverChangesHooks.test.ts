import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import PublicNoteApprovalStep from "../../../Models/DatabaseModels/PublicNoteApprovalStep";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import PublicNoteApprovalStepService from "../../../Server/Services/PublicNoteApprovalStepService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import PublicNoteApprovalPolicy from "../../../Server/Utils/Notes/PublicNoteApprovalPolicy";
import PublicNoteApproverChanges from "../../../Server/Utils/Notes/PublicNoteApproverChanges";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import ObjectID from "../../../Types/ObjectID";
import { PublicNoteApprovalEventType } from "../../../Types/StatusPage/PublicNoteApproval";
import type { SpyInstance } from "jest-mock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpy = SpyInstance<(...args: Array<any>) => any>;

/*
 * WHAT STARTS FOLLOWING UP THE NOTES WAITING FOR APPROVAL (#6353): the step
 * service's and the team member service's hooks.
 *
 *  - A step created, updated or deleted hands the notes of its project and
 *    kind to PublicNoteApproverChanges - an update by the steps it wrote,
 *    read in the background; a delete by the projects and kinds of the steps
 *    it removed, read before they go.
 *  - A membership accepted - created accepted, or an invitation accepted -
 *    and an accepted membership removed hand its project's notes over.
 *    An invitation not accepted yet changes nobody's approvals.
 *  - None of it ever fails, or waits on, the write: a hook hands back at once,
 *    and one whose follow-up cannot even start logs that.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4121-8121-121212121212",
);
const BOB: ObjectID = new ObjectID("b2b2b2b2-0000-4000-8000-000000000002");
const STEP_ID: ObjectID = new ObjectID("5e000000-0000-4000-8000-0000000000a1");

interface StepHooks {
  onCreateSuccess: (
    onCreate: OnCreate<PublicNoteApprovalStep>,
    item: PublicNoteApprovalStep,
  ) => Promise<PublicNoteApprovalStep>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<PublicNoteApprovalStep>,
    ids: Array<ObjectID>,
  ) => Promise<OnUpdate<PublicNoteApprovalStep>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<PublicNoteApprovalStep>,
  ) => Promise<OnDelete<PublicNoteApprovalStep>>;
  onDeleteSuccess: (
    onDelete: OnDelete<PublicNoteApprovalStep>,
    ids: Array<ObjectID>,
  ) => Promise<OnDelete<PublicNoteApprovalStep>>;
}

interface MemberHooks {
  onCreateSuccess: (
    onCreate: OnCreate<TeamMember>,
    item: TeamMember,
  ) => Promise<TeamMember>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<TeamMember>,
    ids: Array<ObjectID>,
  ) => Promise<OnUpdate<TeamMember>>;
  onDeleteSuccess: (
    onDelete: OnDelete<TeamMember>,
    ids: Array<ObjectID>,
  ) => Promise<OnDelete<TeamMember>>;
}

const stepHooks: StepHooks =
  PublicNoteApprovalStepService as unknown as StepHooks;
const memberHooks: MemberHooks = TeamMemberService as unknown as MemberHooks;

function stepOf(
  projectId: ObjectID,
  eventType: PublicNoteApprovalEventType,
  id: string = STEP_ID.toString(),
): PublicNoteApprovalStep {
  const step: PublicNoteApprovalStep = new PublicNoteApprovalStep();
  step._id = id;
  step.projectId = projectId;
  step.eventType = eventType;
  return step;
}

function memberOf(
  projectId: ObjectID,
  hasAcceptedInvitation: boolean,
): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = ObjectID.generate().toString();
  member.projectId = projectId;
  member.userId = BOB;
  member.teamId = ObjectID.generate();
  member.hasAcceptedInvitation = hasAcceptedInvitation;
  return member;
}

let stepsChanged: AnySpy;
let stepsUpdated: AnySpy;
let teamsChanged: AnySpy;

beforeEach(() => {
  stepsChanged = jest
    .spyOn(PublicNoteApproverChanges, "afterStepsChanged")
    .mockImplementation((): void => {
      return undefined;
    }) as AnySpy;
  stepsUpdated = jest
    .spyOn(PublicNoteApproverChanges, "afterStepsUpdated")
    .mockImplementation((): void => {
      return undefined;
    }) as AnySpy;
  teamsChanged = jest
    .spyOn(PublicNoteApproverChanges, "afterTeamMembersChanged")
    .mockImplementation((): void => {
      return undefined;
    }) as AnySpy;
  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PublicNoteApprovalStepService", () => {
  test("a step created hands over the notes of its project and kind", async () => {
    const step: PublicNoteApprovalStep = stepOf(
      PROJECT_ID,
      PublicNoteApprovalEventType.ScheduledMaintenance,
    );

    await expect(
      stepHooks.onCreateSuccess(
        {
          createBy: {
            data: step,
            props: { isRoot: true },
          } as CreateBy<PublicNoteApprovalStep>,
          carryForward: null,
        },
        step,
      ),
    ).resolves.toBe(step);

    expect(stepsChanged).toHaveBeenCalledWith([
      {
        projectId: PROJECT_ID,
        eventType: PublicNoteApprovalEventType.ScheduledMaintenance,
      },
    ]);
  });

  test("a step created with nothing to name hands nothing over", async () => {
    const step: PublicNoteApprovalStep = new PublicNoteApprovalStep();

    await stepHooks.onCreateSuccess(
      {
        createBy: {
          data: step,
          props: { isRoot: true },
        } as CreateBy<PublicNoteApprovalStep>,
        carryForward: null,
      },
      step,
    );

    expect(stepsChanged).not.toHaveBeenCalled();
  });

  test("steps updated hand over the steps they wrote, to be read in the background; none, nothing", async () => {
    const onUpdate: OnUpdate<PublicNoteApprovalStep> = {
      updateBy: {
        query: {},
        data: { name: "Legal" },
        props: { isRoot: true },
      } as unknown as UpdateBy<PublicNoteApprovalStep>,
      carryForward: null,
    };

    await expect(stepHooks.onUpdateSuccess(onUpdate, [STEP_ID])).resolves.toBe(
      onUpdate,
    );
    expect(stepsUpdated).toHaveBeenCalledWith([STEP_ID]);

    await stepHooks.onUpdateSuccess(onUpdate, []);
    expect(stepsUpdated).toHaveBeenCalledTimes(1);
  });

  test("a delete carries the projects and kinds of the steps it removes, each once, and hands them over once done", async () => {
    jest
      .spyOn(PublicNoteApprovalStepService, "findRowsAndHoldDeleteToThem")
      .mockResolvedValue([
        stepOf(PROJECT_ID, PublicNoteApprovalEventType.Incident, "s1"),
        stepOf(PROJECT_ID, PublicNoteApprovalEventType.Incident, "s2"),
        stepOf(OTHER_PROJECT_ID, PublicNoteApprovalEventType.Incident, "s3"),
        stepOf(
          PROJECT_ID,
          PublicNoteApprovalEventType.ScheduledMaintenance,
          "s4",
        ),
      ] as never);
    jest
      .spyOn(PublicNoteApprovalPolicy, "isRequired")
      .mockResolvedValue(false as never);

    const deleteBy: DeleteBy<PublicNoteApprovalStep> = {
      query: {},
      props: { isRoot: true },
      limit: 10,
      skip: 0,
    } as DeleteBy<PublicNoteApprovalStep>;
    const onDelete: OnDelete<PublicNoteApprovalStep> =
      await stepHooks.onBeforeDelete(deleteBy);

    // Nothing is handed over before the delete is done.
    expect(stepsChanged).not.toHaveBeenCalled();

    await expect(
      stepHooks.onDeleteSuccess(onDelete, [
        new ObjectID("5e000000-0000-4000-8000-000000000001"),
      ]),
    ).resolves.toBe(onDelete);

    expect(stepsChanged).toHaveBeenCalledTimes(1);
    expect(stepsChanged.mock.calls[0]![0]).toEqual([
      {
        projectId: PROJECT_ID,
        eventType: PublicNoteApprovalEventType.Incident,
      },
      {
        projectId: OTHER_PROJECT_ID,
        eventType: PublicNoteApprovalEventType.Incident,
      },
      {
        projectId: PROJECT_ID,
        eventType: PublicNoteApprovalEventType.ScheduledMaintenance,
      },
    ]);
  });

  test("a delete that removed nothing hands nothing over", async () => {
    await stepHooks.onDeleteSuccess(
      {
        deleteBy: {} as DeleteBy<PublicNoteApprovalStep>,
        carryForward: {
          publicNoteApproverChanges: [
            {
              projectId: PROJECT_ID,
              eventType: PublicNoteApprovalEventType.Incident,
            },
          ],
        },
      },
      [],
    );
    await stepHooks.onDeleteSuccess(
      { deleteBy: {} as DeleteBy<PublicNoteApprovalStep>, carryForward: null },
      [STEP_ID],
    );

    expect(stepsChanged).not.toHaveBeenCalled();
  });

  test("a follow-up that cannot even start never fails the save: it is logged", async () => {
    stepsChanged.mockImplementation((): void => {
      throw new Error("Cannot start.");
    });
    stepsUpdated.mockImplementation((): void => {
      throw new Error("Cannot start.");
    });
    const step: PublicNoteApprovalStep = stepOf(
      PROJECT_ID,
      PublicNoteApprovalEventType.Incident,
    );

    await expect(
      stepHooks.onCreateSuccess(
        {
          createBy: {
            data: step,
            props: { isRoot: true },
          } as CreateBy<PublicNoteApprovalStep>,
          carryForward: null,
        },
        step,
      ),
    ).resolves.toBe(step);
    await expect(
      stepHooks.onUpdateSuccess(
        {
          updateBy: {} as UpdateBy<PublicNoteApprovalStep>,
          carryForward: null,
        },
        [STEP_ID],
      ),
    ).resolves.toBeDefined();
    await expect(
      stepHooks.onDeleteSuccess(
        {
          deleteBy: {} as DeleteBy<PublicNoteApprovalStep>,
          carryForward: {
            publicNoteApproverChanges: [
              {
                projectId: PROJECT_ID,
                eventType: PublicNoteApprovalEventType.Incident,
              },
            ],
          },
        },
        [STEP_ID],
      ),
    ).resolves.toBeDefined();

    expect(logger.error).toHaveBeenCalledTimes(6);
  });
});

describe("TeamMemberService", () => {
  beforeEach(() => {
    for (const method of [
      "acceptPendingInvitationsInProject",
      "refreshTokens",
      "syncSubscriptionSeatsAfterMembershipChange",
      "addDefaultNotificationSettingsAndRules",
      "removeProjectAccessIfUserLeftProject",
      "cleanupOnCallAssignmentsIfUserLeftProject",
      "cleanupResourceAssignmentsIfUserLeftProject",
      "removeWorkspaceAccountLinksIfUserLeftProject",
      "removePersonalNotificationSettingsIfUserLeftProject",
      "endOnCallTimeLogsOfRemovedMembers",
    ]) {
      jest
        .spyOn(TeamMemberService as never, method as never)
        .mockResolvedValue(0 as never);
    }

    jest
      .spyOn(
        UserNotificationSettingService,
        "removeDefaultNotificationSettingsForUser",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ProductAnalytics, "captureForUser")
      .mockImplementation((): void => {
        return undefined;
      });
  });

  function created(member: TeamMember): OnCreate<TeamMember> {
    return {
      createBy: {
        data: member,
        props: { isRoot: true },
      } as CreateBy<TeamMember>,
      carryForward: null,
    };
  }

  test("somebody added to a team, accepted, hands over the project's notes", async () => {
    const member: TeamMember = memberOf(PROJECT_ID, true);

    await expect(
      memberHooks.onCreateSuccess(created(member), member),
    ).resolves.toBe(member);

    expect(teamsChanged).toHaveBeenCalledWith([PROJECT_ID]);
  });

  test("somebody only invited changes nobody's approvals yet", async () => {
    const member: TeamMember = memberOf(PROJECT_ID, false);

    await memberHooks.onCreateSuccess(created(member), member);

    expect(teamsChanged).not.toHaveBeenCalled();
  });

  test("an invitation accepted hands over each project of the memberships it wrote, once", async () => {
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([
        memberOf(PROJECT_ID, true),
        memberOf(PROJECT_ID, true),
        memberOf(OTHER_PROJECT_ID, true),
      ] as never);

    await memberHooks.onUpdateSuccess(
      {
        updateBy: {
          query: {},
          data: { hasAcceptedInvitation: true },
          props: { isRoot: true },
        } as unknown as UpdateBy<TeamMember>,
        carryForward: null,
      },
      [ObjectID.generate()],
    );

    expect(teamsChanged).toHaveBeenCalledTimes(1);
    expect(teamsChanged.mock.calls[0]![0]).toEqual([
      PROJECT_ID,
      OTHER_PROJECT_ID,
    ]);
  });

  test("an update that accepts nothing hands nothing over", async () => {
    jest
      .spyOn(TeamMemberService, "findBy")
      .mockResolvedValue([memberOf(PROJECT_ID, true)] as never);

    await memberHooks.onUpdateSuccess(
      {
        updateBy: {
          query: {},
          data: { invitationAcceptedAt: new Date() },
          props: { isRoot: true },
        } as unknown as UpdateBy<TeamMember>,
        carryForward: null,
      },
      [ObjectID.generate()],
    );

    expect(teamsChanged).not.toHaveBeenCalled();
  });

  test("an accepted member removed hands over their project's notes; a revoked invitation does not", async () => {
    await memberHooks.onDeleteSuccess(
      {
        deleteBy: { props: { isRoot: true } } as DeleteBy<TeamMember>,
        carryForward: [
          memberOf(PROJECT_ID, true),
          memberOf(OTHER_PROJECT_ID, false),
        ],
      },
      [ObjectID.generate()],
    );

    expect(teamsChanged).toHaveBeenCalledWith([PROJECT_ID]);
  });

  test("a follow-up that cannot even start never fails the membership's write: it is logged", async () => {
    teamsChanged.mockImplementation((): void => {
      throw new Error("Cannot start.");
    });
    const member: TeamMember = memberOf(PROJECT_ID, true);

    await expect(
      memberHooks.onCreateSuccess(created(member), member),
    ).resolves.toBe(member);
    await expect(
      memberHooks.onDeleteSuccess(
        {
          deleteBy: { props: { isRoot: true } } as DeleteBy<TeamMember>,
          carryForward: [member],
        },
        [ObjectID.generate()],
      ),
    ).resolves.toBeDefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("could not start asking the new approvers"),
    );
  });
});
