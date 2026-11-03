import WorkspaceNotificationRuleService, {
  SECURITY_CASE_RULE_PERMISSION_MESSAGE,
  SECURITY_HUNT_RULE_PERMISSION_MESSAGE,
  isPostOnlyNotificationRuleEventType,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A Security Hunt rule posts what every hunt it matches finds - the hunt,
 * its search, how many events, and when - to the channels it names:
 * security data, as a case is. So, like a Security Case rule, it takes a
 * role that may set up security playbooks (SecurityPlaybook's create
 * permissions), and a Project Member, who sets up every other kind of rule,
 * may not post a project's hunts to a channel of their own.
 *
 * An update or a delete is judged by the rules it changes, read with the
 * held-rows helpers (UpdateChecksReadHeldRows, DeleteChecksReadHeldRows) -
 * the same read that judges a Security Case rule.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

type Hooks = {
  onBeforeCreate: (
    createBy: CreateBy<WorkspaceNotificationRule>,
  ) => Promise<OnCreate<WorkspaceNotificationRule>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<WorkspaceNotificationRule>,
  ) => Promise<OnUpdate<WorkspaceNotificationRule>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<WorkspaceNotificationRule>,
  ) => Promise<OnDelete<WorkspaceNotificationRule>>;
};

const service: Hooks = WorkspaceNotificationRuleService as unknown as Hooks;

function props(permissions: Array<Permission>): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [Permission.ProjectUser, ...permissions].map(
          (permission: Permission) => {
            return { _type: "UserPermission", permission, labelIds: [] };
          },
        ),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function create(
  eventType: NotificationRuleEventType,
  caller: DatabaseCommonInteractionProps,
): CreateBy<WorkspaceNotificationRule> {
  const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
  rule.projectId = PROJECT_ID;
  rule.eventType = eventType;

  return { data: rule, props: caller } as CreateBy<WorkspaceNotificationRule>;
}

function update(
  data: Record<string, unknown>,
  caller: DatabaseCommonInteractionProps,
): UpdateBy<WorkspaceNotificationRule> {
  return {
    query: { _id: RULE_ID },
    data,
    props: caller,
  } as unknown as UpdateBy<WorkspaceNotificationRule>;
}

function remove(
  caller: DatabaseCommonInteractionProps,
): DeleteBy<WorkspaceNotificationRule> {
  return {
    query: { _id: RULE_ID },
    props: caller,
  } as unknown as DeleteBy<WorkspaceNotificationRule>;
}

// The events of the rules a write changes, as the held-rows helpers read them.
let rulesWritten: Array<NotificationRuleEventType>;

function rulesRead(): Array<WorkspaceNotificationRule> {
  return rulesWritten.map(
    (eventType: NotificationRuleEventType): WorkspaceNotificationRule => {
      const rule: WorkspaceNotificationRule = new WorkspaceNotificationRule();
      rule._id = RULE_ID.toString();
      rule.eventType = eventType;
      return rule;
    },
  );
}

beforeEach(() => {
  rulesWritten = [NotificationRuleEventType.Incident];

  jest
    .spyOn(WorkspaceNotificationRuleService, "findRowsAndHoldUpdateToThem")
    .mockImplementation(async (): Promise<Array<WorkspaceNotificationRule>> => {
      return rulesRead();
    });

  jest
    .spyOn(WorkspaceNotificationRuleService, "findRowsAndHoldDeleteToThem")
    .mockImplementation(async (): Promise<Array<WorkspaceNotificationRule>> => {
      return rulesRead();
    });

  jest
    .spyOn(WorkspaceNotificationRuleService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may set up a Security Hunt rule", () => {
  test("a Project Member may not create one, and is told who may - in words of hunts, not of cases", async () => {
    await expect(
      service.onBeforeCreate(
        create(
          NotificationRuleEventType.SecurityHunt,
          props([Permission.ProjectMember]),
        ),
      ),
    ).rejects.toThrow(
      new NotAuthorizedException(SECURITY_HUNT_RULE_PERMISSION_MESSAGE),
    );
    expect(SECURITY_HUNT_RULE_PERMISSION_MESSAGE).toBe(
      "A Security Hunt rule posts what hunts find to Slack and Microsoft Teams, so it takes a role that may set up security playbooks, such as Project Owner, Project Admin or Security Admin.",
    );
    expect(SECURITY_HUNT_RULE_PERMISSION_MESSAGE).not.toBe(
      SECURITY_CASE_RULE_PERMISSION_MESSAGE,
    );
  });

  // The roles are the playbook's: one list, so the two never drift apart.
  test.each(new SecurityPlaybook().getCreatePermissions())(
    "%s, who may set up a security playbook, may create one",
    async (permission: Permission) => {
      await expect(
        service.onBeforeCreate(
          create(NotificationRuleEventType.SecurityHunt, props([permission])),
        ),
      ).resolves.toBeDefined();
    },
  );

  test("a Security Member or Viewer, who runs hunts but sets up no playbooks, may not", async () => {
    for (const permission of [
      Permission.SecurityMember,
      Permission.SecurityViewer,
    ]) {
      await expect(
        service.onBeforeCreate(
          create(NotificationRuleEventType.SecurityHunt, props([permission])),
        ),
      ).rejects.toThrow(SECURITY_HUNT_RULE_PERMISSION_MESSAGE);
    }
  });

  test("a Project Member may not change or delete one, nor turn another rule into one", async () => {
    const member: DatabaseCommonInteractionProps = props([
      Permission.ProjectMember,
    ]);

    rulesWritten = [NotificationRuleEventType.SecurityHunt];
    await expect(
      service.onBeforeUpdate(update({ name: "Every hunt to #random" }, member)),
    ).rejects.toThrow(SECURITY_HUNT_RULE_PERMISSION_MESSAGE);
    await expect(service.onBeforeDelete(remove(member))).rejects.toThrow(
      SECURITY_HUNT_RULE_PERMISSION_MESSAGE,
    );

    rulesWritten = [NotificationRuleEventType.Incident];
    await expect(
      service.onBeforeUpdate(
        update({ eventType: NotificationRuleEventType.SecurityHunt }, member),
      ),
    ).rejects.toThrow(SECURITY_HUNT_RULE_PERMISSION_MESSAGE);

    // Their own incident rule, as before.
    await expect(
      service.onBeforeUpdate(update({ name: "Incidents to #ops" }, member)),
    ).resolves.toEqual(expect.objectContaining({ carryForward: null }));
  });

  test("nor turn a hunt rule into a case rule, or a case rule into a hunt rule", async () => {
    const member: DatabaseCommonInteractionProps = props([
      Permission.ProjectMember,
    ]);

    rulesWritten = [NotificationRuleEventType.SecurityHunt];
    await expect(
      service.onBeforeUpdate(
        update({ eventType: NotificationRuleEventType.SecurityCase }, member),
      ),
    ).rejects.toThrow(SECURITY_CASE_RULE_PERMISSION_MESSAGE);

    rulesWritten = [NotificationRuleEventType.SecurityCase];
    await expect(
      service.onBeforeUpdate(
        update({ eventType: NotificationRuleEventType.SecurityHunt }, member),
      ),
    ).rejects.toThrow(SECURITY_HUNT_RULE_PERMISSION_MESSAGE);
  });

  test("a write over several rules takes the role when one of them is a hunt rule", async () => {
    const member: DatabaseCommonInteractionProps = props([
      Permission.ProjectMember,
    ]);

    rulesWritten = [
      NotificationRuleEventType.Incident,
      NotificationRuleEventType.SecurityHunt,
      NotificationRuleEventType.Alert,
    ];

    await expect(
      service.onBeforeUpdate({
        query: { projectId: PROJECT_ID },
        data: { isEnabled: false },
        props: member,
      } as unknown as UpdateBy<WorkspaceNotificationRule>),
    ).rejects.toThrow(NotAuthorizedException);
    await expect(
      service.onBeforeDelete({
        query: { projectId: PROJECT_ID },
        props: member,
      } as unknown as DeleteBy<WorkspaceNotificationRule>),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("a Security Admin changes and deletes one", async () => {
    const securityAdmin: DatabaseCommonInteractionProps = props([
      Permission.SecurityAdmin,
    ]);

    rulesWritten = [NotificationRuleEventType.SecurityHunt];

    await expect(
      service.onBeforeUpdate(
        update({ name: "Hunts to #threat-hunting" }, securityAdmin),
      ),
    ).resolves.toEqual(expect.objectContaining({ carryForward: null }));
    await expect(
      service.onBeforeDelete(remove(securityAdmin)),
    ).resolves.toEqual(expect.objectContaining({ carryForward: null }));
  });

  test("judges the rules the write changes, through the held-rows reads, never a count of its own", async () => {
    const member: DatabaseCommonInteractionProps = props([
      Permission.ProjectMember,
    ]);
    const updateBy: UpdateBy<WorkspaceNotificationRule> = update(
      { name: "Incidents to #ops" },
      member,
    );
    const deleteBy: DeleteBy<WorkspaceNotificationRule> = remove(member);

    await service.onBeforeUpdate(updateBy);
    await service.onBeforeDelete(deleteBy);

    const updateReads: Array<Array<unknown>> = jest.mocked(
      WorkspaceNotificationRuleService.findRowsAndHoldUpdateToThem,
    ).mock.calls;
    const deleteReads: Array<Array<unknown>> = jest.mocked(
      WorkspaceNotificationRuleService.findRowsAndHoldDeleteToThem,
    ).mock.calls;

    expect(updateReads).toHaveLength(1);
    expect(updateReads[0]![0]).toBe(updateBy);
    expect(updateReads[0]![1]).toEqual({ eventType: true });
    expect(deleteReads).toHaveLength(1);
    expect(deleteReads[0]![0]).toBe(deleteBy);
    expect(deleteReads[0]![1]).toEqual({ eventType: true });
    expect(WorkspaceNotificationRuleService.countBy).not.toHaveBeenCalled();
  });

  test("OneUptime itself, and a master admin, are never asked", async () => {
    rulesWritten = [NotificationRuleEventType.SecurityHunt];

    await expect(
      service.onBeforeCreate(
        create(NotificationRuleEventType.SecurityHunt, { isRoot: true }),
      ),
    ).resolves.toBeDefined();
    await expect(
      service.onBeforeCreate(
        create(NotificationRuleEventType.SecurityHunt, {
          isMasterAdmin: true,
          userId: USER_ID,
          tenantId: PROJECT_ID,
        } as DatabaseCommonInteractionProps),
      ),
    ).resolves.toBeDefined();
    await expect(
      service.onBeforeUpdate(update({ name: "Renamed" }, { isRoot: true })),
    ).resolves.toBeDefined();
    await expect(
      service.onBeforeDelete(remove({ isRoot: true })),
    ).resolves.toBeDefined();
    expect(
      WorkspaceNotificationRuleService.findRowsAndHoldUpdateToThem,
    ).not.toHaveBeenCalled();
    expect(
      WorkspaceNotificationRuleService.findRowsAndHoldDeleteToThem,
    ).not.toHaveBeenCalled();
  });
});

describe("the kinds of rule that only post", () => {
  test("a security case and a hunt, which get no channel of their own; every other kind of record may", () => {
    expect(
      Object.values(NotificationRuleEventType).filter(
        (eventType: NotificationRuleEventType): boolean => {
          return isPostOnlyNotificationRuleEventType(eventType);
        },
      ),
    ).toEqual([
      NotificationRuleEventType.SecurityCase,
      NotificationRuleEventType.SecurityHunt,
    ]);
    expect(isPostOnlyNotificationRuleEventType(undefined)).toBe(false);
  });
});
