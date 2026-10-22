import WorkspaceNotificationRuleService, {
  SECURITY_CASE_RULE_PERMISSION_MESSAGE,
} from "../../../Server/Services/WorkspaceNotificationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
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
 * A Security Case rule posts every security case it matches to the channels
 * it names, so it takes a role that may set up security playbooks. A Project
 * Member may set up every other kind of rule, but reads no security case:
 * without this, they could post every case to a channel of their own.
 *
 * An update or a delete is judged by the rules it changes, read with
 * findRowsAndHoldUpdateToThem / findRowsAndHoldDeleteToThem - the rules the
 * caller may write that the write names, the write held to them - never by
 * a read of its own over the write's query (UpdateChecksReadHeldRows,
 * DeleteChecksReadHeldRows).
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

  // A count over the write's own query finds no Security Case rule.
  jest
    .spyOn(WorkspaceNotificationRuleService, "countBy")
    .mockResolvedValue(new PositiveNumber(0));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("who may set up a Security Case rule", () => {
  test("a Project Member may not create one, and is told who may", async () => {
    await expect(
      service.onBeforeCreate(
        create(
          NotificationRuleEventType.SecurityCase,
          props([Permission.ProjectMember]),
        ),
      ),
    ).rejects.toThrow(
      new NotAuthorizedException(SECURITY_CASE_RULE_PERMISSION_MESSAGE),
    );
  });

  test("a Project Member still creates every other kind of rule", async () => {
    await expect(
      service.onBeforeCreate(
        create(
          NotificationRuleEventType.Incident,
          props([Permission.ProjectMember]),
        ),
      ),
    ).resolves.toBeDefined();
  });

  test.each([
    Permission.ProjectOwner,
    Permission.ProjectAdmin,
    Permission.SecurityAdmin,
    Permission.CreateSecurityPlaybook,
  ])("%s may create one", async (permission: Permission) => {
    await expect(
      service.onBeforeCreate(
        create(NotificationRuleEventType.SecurityCase, props([permission])),
      ),
    ).resolves.toBeDefined();
  });

  test("a Security Member or Viewer, who works cases but sets up no playbooks, may not", async () => {
    for (const permission of [
      Permission.SecurityMember,
      Permission.SecurityViewer,
    ]) {
      await expect(
        service.onBeforeCreate(
          create(NotificationRuleEventType.SecurityCase, props([permission])),
        ),
      ).rejects.toThrow(NotAuthorizedException);
    }
  });

  test("a Project Member may not change or delete one, nor turn another rule into one", async () => {
    const member: DatabaseCommonInteractionProps = props([
      Permission.ProjectMember,
    ]);

    rulesWritten = [NotificationRuleEventType.SecurityCase];
    await expect(
      service.onBeforeUpdate({
        query: { _id: RULE_ID },
        data: { name: "Everything to #random" },
        props: member,
      } as unknown as UpdateBy<WorkspaceNotificationRule>),
    ).rejects.toThrow(NotAuthorizedException);
    await expect(
      service.onBeforeDelete({
        query: { _id: RULE_ID },
        props: member,
      } as unknown as DeleteBy<WorkspaceNotificationRule>),
    ).rejects.toThrow(NotAuthorizedException);

    rulesWritten = [NotificationRuleEventType.Incident];
    await expect(
      service.onBeforeUpdate({
        query: { _id: RULE_ID },
        data: { eventType: NotificationRuleEventType.SecurityCase },
        props: member,
      } as unknown as UpdateBy<WorkspaceNotificationRule>),
    ).rejects.toThrow(NotAuthorizedException);

    // Their own incident rule, as before.
    await expect(
      service.onBeforeUpdate({
        query: { _id: RULE_ID },
        data: { name: "Incidents to #ops" },
        props: member,
      } as unknown as UpdateBy<WorkspaceNotificationRule>),
    ).resolves.toEqual(expect.objectContaining({ carryForward: null }));
  });

  test("a write over several rules takes the role when one of them is a Security Case rule", async () => {
    const member: DatabaseCommonInteractionProps = props([
      Permission.ProjectMember,
    ]);

    rulesWritten = [
      NotificationRuleEventType.Incident,
      NotificationRuleEventType.SecurityCase,
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

    rulesWritten = [NotificationRuleEventType.SecurityCase];

    await expect(
      service.onBeforeUpdate({
        query: { _id: RULE_ID },
        data: { name: "Cases to #security" },
        props: securityAdmin,
      } as unknown as UpdateBy<WorkspaceNotificationRule>),
    ).resolves.toEqual(expect.objectContaining({ carryForward: null }));
    await expect(
      service.onBeforeDelete({
        query: { _id: RULE_ID },
        props: securityAdmin,
      } as unknown as DeleteBy<WorkspaceNotificationRule>),
    ).resolves.toEqual(expect.objectContaining({ carryForward: null }));
  });

  test("judges the rules the write changes: the update and the delete themselves are handed to the held-rows reads", async () => {
    const member: DatabaseCommonInteractionProps = props([
      Permission.ProjectMember,
    ]);

    const update: UpdateBy<WorkspaceNotificationRule> = {
      query: { _id: RULE_ID },
      data: { name: "Incidents to #ops" },
      props: member,
    } as unknown as UpdateBy<WorkspaceNotificationRule>;

    const remove: DeleteBy<WorkspaceNotificationRule> = {
      query: { _id: RULE_ID },
      props: member,
    } as unknown as DeleteBy<WorkspaceNotificationRule>;

    await service.onBeforeUpdate(update);
    await service.onBeforeDelete(remove);

    const updateReads: Array<Array<unknown>> = jest.mocked(
      WorkspaceNotificationRuleService.findRowsAndHoldUpdateToThem,
    ).mock.calls;
    const deleteReads: Array<Array<unknown>> = jest.mocked(
      WorkspaceNotificationRuleService.findRowsAndHoldDeleteToThem,
    ).mock.calls;

    // The writes themselves, so each is held to the rules read.
    expect(updateReads).toHaveLength(1);
    expect(updateReads[0]![0]).toBe(update);
    expect(updateReads[0]![1]).toEqual({ eventType: true });
    expect(deleteReads).toHaveLength(1);
    expect(deleteReads[0]![0]).toBe(remove);
    expect(deleteReads[0]![1]).toEqual({ eventType: true });
    // No count of its own over the write's query.
    expect(WorkspaceNotificationRuleService.countBy).not.toHaveBeenCalled();
  });

  test("OneUptime itself is never asked", async () => {
    rulesWritten = [NotificationRuleEventType.SecurityCase];

    await expect(
      service.onBeforeUpdate({
        query: { _id: RULE_ID },
        data: { name: "Renamed" },
        props: { isRoot: true },
      } as unknown as UpdateBy<WorkspaceNotificationRule>),
    ).resolves.toBeDefined();
    await expect(
      service.onBeforeDelete({
        query: { _id: RULE_ID },
        props: { isRoot: true },
      } as unknown as DeleteBy<WorkspaceNotificationRule>),
    ).resolves.toBeDefined();
    expect(
      WorkspaceNotificationRuleService.findRowsAndHoldUpdateToThem,
    ).not.toHaveBeenCalled();
    expect(
      WorkspaceNotificationRuleService.findRowsAndHoldDeleteToThem,
    ).not.toHaveBeenCalled();
    expect(WorkspaceNotificationRuleService.countBy).not.toHaveBeenCalled();
  });
});
