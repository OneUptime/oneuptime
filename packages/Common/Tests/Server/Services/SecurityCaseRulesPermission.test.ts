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

let securityCaseRules: number;

beforeEach(() => {
  securityCaseRules = 0;

  jest
    .spyOn(WorkspaceNotificationRuleService, "countBy")
    .mockImplementation((async (): Promise<PositiveNumber> => {
      return new PositiveNumber(securityCaseRules);
    }) as never);
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

    securityCaseRules = 1;
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

    securityCaseRules = 0;
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

  test("OneUptime itself is never asked", async () => {
    securityCaseRules = 1;

    await expect(
      service.onBeforeUpdate({
        query: { _id: RULE_ID },
        data: { name: "Renamed" },
        props: { isRoot: true },
      } as unknown as UpdateBy<WorkspaceNotificationRule>),
    ).resolves.toBeDefined();
    expect(WorkspaceNotificationRuleService.countBy).not.toHaveBeenCalled();
  });
});
