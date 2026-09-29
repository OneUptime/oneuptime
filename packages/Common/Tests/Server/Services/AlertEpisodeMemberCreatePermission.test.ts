import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import AlertEpisodeMember, {
  AlertEpisodeMemberAddedBy,
} from "../../../Models/DatabaseModels/AlertEpisodeMember";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const EPISODE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

type OnBeforeCreateFunction = (
  createBy: CreateBy<AlertEpisodeMember>,
) => Promise<OnCreate<AlertEpisodeMember>>;

function memberProps(): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectAdmin,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    tenantId: PROJECT_ID,
    userType: UserType.API,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

function createBy(
  data: Partial<AlertEpisodeMember> = {},
  props: DatabaseCommonInteractionProps = memberProps(),
): CreateBy<AlertEpisodeMember> {
  const member: AlertEpisodeMember = new AlertEpisodeMember();
  member.projectId = PROJECT_ID;
  member.alertEpisodeId = EPISODE_ID;
  member.alertId = ALERT_ID;
  member.addedBy = AlertEpisodeMemberAddedBy.API;
  Object.assign(member, data);

  return { data: member, props };
}

function callOnBeforeCreate(
  input: CreateBy<AlertEpisodeMember>,
): Promise<OnCreate<AlertEpisodeMember>> {
  return (
    AlertEpisodeMemberService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate(input);
}

describe("AlertEpisodeMember first-member create permissions", () => {
  beforeEach(() => {
    jest
      .spyOn(AlertEpisodeMemberService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(AlertEpisodeMemberService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a project admin can create the first member after the service stamps it notified", async () => {
    const input: CreateBy<AlertEpisodeMember> = createBy();
    const result: OnCreate<AlertEpisodeMember> =
      await callOnBeforeCreate(input);

    expect(result.createBy.data.isOwnerNotifiedOfAlertAdded).toBe(true);
    expect(() => {
      ModelPermission.checkCreatePermissions(
        AlertEpisodeMember,
        result.createBy.data,
        result.createBy.props,
      );
    }).not.toThrow();
  });

  test.each([true, false])(
    "a non-root caller cannot set the notification flag to %s",
    async (value: boolean) => {
      await expect(
        callOnBeforeCreate(createBy({ isOwnerNotifiedOfAlertAdded: value })),
      ).rejects.toThrow("isOwnerNotifiedOfAlertAdded cannot be set directly");
    },
  );

  test("a later member keeps the database default notification state", async () => {
    jest
      .mocked(AlertEpisodeMemberService.countBy)
      .mockResolvedValue(new PositiveNumber(1) as never);

    const result: OnCreate<AlertEpisodeMember> =
      await callOnBeforeCreate(createBy());

    expect(result.createBy.data.isOwnerNotifiedOfAlertAdded).toBeUndefined();
  });

  test("a root caller can preserve an explicitly supplied notification state", async () => {
    const result: OnCreate<AlertEpisodeMember> = await callOnBeforeCreate(
      createBy({ isOwnerNotifiedOfAlertAdded: false }, { isRoot: true }),
    );

    expect(result.createBy.data.isOwnerNotifiedOfAlertAdded).toBe(false);
  });
});
