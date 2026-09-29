import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import IncidentEpisodeMember, {
  IncidentEpisodeMemberAddedBy,
} from "../../../Models/DatabaseModels/IncidentEpisodeMember";
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
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

type OnBeforeCreateFunction = (
  createBy: CreateBy<IncidentEpisodeMember>,
) => Promise<OnCreate<IncidentEpisodeMember>>;

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
  data: Partial<IncidentEpisodeMember> = {},
  props: DatabaseCommonInteractionProps = memberProps(),
): CreateBy<IncidentEpisodeMember> {
  const member: IncidentEpisodeMember = new IncidentEpisodeMember();
  member.projectId = PROJECT_ID;
  member.incidentEpisodeId = EPISODE_ID;
  member.incidentId = INCIDENT_ID;
  member.addedBy = IncidentEpisodeMemberAddedBy.API;
  Object.assign(member, data);

  return { data: member, props };
}

function callOnBeforeCreate(
  input: CreateBy<IncidentEpisodeMember>,
): Promise<OnCreate<IncidentEpisodeMember>> {
  return (
    IncidentEpisodeMemberService as unknown as {
      onBeforeCreate: OnBeforeCreateFunction;
    }
  ).onBeforeCreate(input);
}

describe("IncidentEpisodeMember first-member create permissions", () => {
  beforeEach(() => {
    jest
      .spyOn(IncidentEpisodeMemberService, "findOneBy")
      .mockResolvedValue(null as never);
    jest
      .spyOn(IncidentEpisodeMemberService, "countBy")
      .mockResolvedValue(new PositiveNumber(0) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a project admin can create the first member after the service stamps it notified", async () => {
    const input: CreateBy<IncidentEpisodeMember> = createBy();
    const result: OnCreate<IncidentEpisodeMember> =
      await callOnBeforeCreate(input);

    expect(result.createBy.data.isOwnerNotifiedOfIncidentAdded).toBe(true);
    expect(() => {
      ModelPermission.checkCreatePermissions(
        IncidentEpisodeMember,
        result.createBy.data,
        result.createBy.props,
      );
    }).not.toThrow();
  });

  test.each([true, false])(
    "a non-root caller cannot set the notification flag to %s",
    async (value: boolean) => {
      await expect(
        callOnBeforeCreate(createBy({ isOwnerNotifiedOfIncidentAdded: value })),
      ).rejects.toThrow(
        "isOwnerNotifiedOfIncidentAdded cannot be set directly",
      );
    },
  );

  test("a later member keeps the database default notification state", async () => {
    jest
      .mocked(IncidentEpisodeMemberService.countBy)
      .mockResolvedValue(new PositiveNumber(1) as never);

    const result: OnCreate<IncidentEpisodeMember> =
      await callOnBeforeCreate(createBy());

    expect(result.createBy.data.isOwnerNotifiedOfIncidentAdded).toBeUndefined();
  });

  test("a root caller can preserve an explicitly supplied notification state", async () => {
    const result: OnCreate<IncidentEpisodeMember> = await callOnBeforeCreate(
      createBy({ isOwnerNotifiedOfIncidentAdded: false }, { isRoot: true }),
    );

    expect(result.createBy.data.isOwnerNotifiedOfIncidentAdded).toBe(false);
  });
});
