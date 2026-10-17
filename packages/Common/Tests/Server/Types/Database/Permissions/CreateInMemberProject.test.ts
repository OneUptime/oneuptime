import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ProjectUserProfile from "../../../../../Models/DatabaseModels/ProjectUserProfile";
import TeamMember from "../../../../../Models/DatabaseModels/TeamMember";
import UserIncomingCallNumber from "../../../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserNotificationRule from "../../../../../Models/DatabaseModels/UserNotificationRule";
import UserSession from "../../../../../Models/DatabaseModels/UserSession";
import UserSMS from "../../../../../Models/DatabaseModels/UserSMS";
import UserTotpAuth from "../../../../../Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "../../../../../Models/DatabaseModels/UserWebAuthn";
import UserIncomingCallNumberService from "../../../../../Server/Services/UserIncomingCallNumberService";
import UserSmsService from "../../../../../Server/Services/UserSmsService";
import CreatePermission from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import RelationIdUtil from "../../../../../Server/Utils/Database/RelationIdUtil";
import UserPermissionUtil from "../../../../../Server/Utils/UserPermission/UserPermission";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A ROW A PERSON ADDS FOR THEMSELVES GOES INTO A PROJECT THEY ARE A MEMBER
 * OF (CreatePermission.checkCreateInMemberProject).
 *
 * Permission.CurrentUser is granted to every signed-in person, whatever
 * project a request names. The models that belong to a project and are
 * created by that grant alone - a person's own email addresses and phone
 * numbers, their notification rules and settings, their shift reminders -
 * were therefore created by people who are not in the project too: the
 * table check let CurrentUser through, and the ownership check only asked
 * whose row it was. A phone number added that way sent its verification
 * code on the project's account.
 *
 * This file holds the rule itself: who it asks (only a caller whom nothing
 * but CurrentUser lets create, on a model of a project), what counts as
 * membership (the project's permission set on the request), what it refuses
 * (a stranger, a member of another project, a row that names another project
 * than the request's, a request that names none) and what it leaves alone
 * (root, a master admin, a role permission, a model of no project). And it
 * holds every model with that shape to it, found by a scan: a model added
 * later is held to the rule the moment it exists, and shows up in the list
 * below for review.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6e000000-0000-4000-8000-0000000000a1",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "6e000000-0000-4000-8000-0000000000a2",
);
const CALLER_ID: ObjectID = new ObjectID(
  "6e000000-0000-4000-8000-0000000000b1",
);

type ModelConstructor = { new (): BaseModel };

/*
 * The project's permission set as AccessTokenService builds it for a member:
 * Project User for being in the project, and whatever their teams grant.
 */
function permissionSetFor(
  projectId: ObjectID,
  permissions: Array<Permission>,
): UserTenantAccessPermission {
  return {
    projectId: projectId,
    permissions: [Permission.ProjectUser, ...permissions].map(
      (permission: Permission) => {
        return {
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
          _type: "UserPermission" as const,
        };
      },
    ),
    _type: "UserTenantAccessPermission",
  };
}

// A member of PROJECT_ID whose teams grant `permissions` there.
function memberProps(
  permissions: Array<Permission> = [],
): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: permissionSetFor(PROJECT_ID, permissions),
    },
  };
}

/*
 * Somebody signed in who names PROJECT_ID in the request and holds nothing
 * there: getUserMiddleware found no membership, so the request carries no
 * permission set for it - a former member, a fresh sign-up, somebody whose
 * invitation is not accepted yet.
 */
function strangerProps(): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    ...ON_HIGHEST_PLAN,
  };
}

// A member of OTHER_PROJECT_ID who names PROJECT_ID in the request.
function memberOfAnotherProjectProps(): DatabaseCommonInteractionProps {
  return {
    userId: CALLER_ID,
    tenantId: PROJECT_ID,
    userType: UserType.User,
    ...ON_HIGHEST_PLAN,
    userGlobalAccessPermission: {
      projectIds: [OTHER_PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [OTHER_PROJECT_ID.toString()]: permissionSetFor(OTHER_PROJECT_ID, [
        Permission.ProjectOwner,
      ]),
    },
  };
}

function rowOf(
  modelType: ModelConstructor,
  values: Dictionary<unknown> = {},
): BaseModel {
  const row: BaseModel = new modelType();

  for (const [column, value] of Object.entries(values)) {
    row.setColumnValue(column, value as never);
  }

  return row;
}

function refusalOf(action: () => void): Error | null {
  try {
    action();
  } catch (error) {
    return error as Error;
  }

  return null;
}

/*
 * Every model the rule holds: it belongs to a project (a tenant column that
 * is not its own id) and lists Permission.CurrentUser for create. Read from
 * the models themselves, so a new one cannot be missed.
 */
function modelsCreatedForOneself(): Array<ModelConstructor> {
  return AllModelTypes.filter((modelType: ModelConstructor): boolean => {
    const model: BaseModel = new modelType();
    const tenantColumn: string | null = model.getTenantColumn();

    return (
      Boolean(tenantColumn) &&
      tenantColumn !== "_id" &&
      model.getCreatePermissions().includes(Permission.CurrentUser)
    );
  });
}

function nameOf(modelType: ModelConstructor): string {
  return new modelType().tableName || modelType.name;
}

/*
 * The models with that shape today. A new one fails "the scan finds exactly
 * these" until it is added here - not because it escapes the rule (the
 * cases below run against whatever the scan finds), but so that it is read
 * in review: a person's own row in a project.
 */
const KNOWN_MODELS: Array<string> = [
  "ProjectUserProfile",
  "UserCall",
  "UserEmail",
  "UserIncomingCallNumber",
  "UserMicrosoftTeams",
  "UserNotificationEmailRollupSetting",
  "UserNotificationRule",
  "UserNotificationSetting",
  "UserOnCallShiftReminder",
  "UserPush",
  "UserSMS",
  "UserSlack",
  "UserTelegram",
  "UserWebhook",
  "UserWhatsApp",
];

const SCANNED: Array<[string, ModelConstructor]> =
  modelsCreatedForOneself().map(
    (modelType: ModelConstructor): [string, ModelConstructor] => {
      return [nameOf(modelType), modelType];
    },
  );

describe("which models the rule holds", () => {
  test("the scan finds exactly the known models", () => {
    expect(
      SCANNED.map(([name]: [string, ModelConstructor]): string => {
        return name;
      }).sort(),
    ).toEqual([...KNOWN_MODELS].sort());
  });

  test("every one of them names its project in a column the rule reads", () => {
    for (const [, modelType] of SCANNED) {
      expect(new modelType().getTenantColumn()).toBe("projectId");
    }
  });

  /*
   * The rule is asked when a row is created, so a row must not be movable
   * into a project afterwards: nobody may change the project a person's
   * own row is in, or whose row it is - under either name.
   */
  test("no row of them is moved to another project, or another person, by an update", () => {
    for (const [name, modelType] of SCANNED) {
      const model: BaseModel = new modelType();

      for (const column of ["projectId", "project", "userId", "user"]) {
        expect({
          model: name,
          column: column,
          update: model.getColumnAccessControlFor(column)?.update,
        }).toEqual({ model: name, column: column, update: [] });
      }
    }
  });
});

describe.each(SCANNED)(
  "%s: added only in a project its creator belongs to",
  (_name: string, modelType: ModelConstructor) => {
    test("a member adding their own row is let through", () => {
      expect(
        refusalOf(() => {
          CreatePermission.checkCreatePermissions(
            modelType,
            rowOf(modelType, { projectId: PROJECT_ID, userId: CALLER_ID }),
            memberProps(),
          );
        }),
      ).toBeNull();
    });

    test("a member who names no project in the row is let through (the request names it)", () => {
      expect(
        refusalOf(() => {
          CreatePermission.checkCreateInMemberProject(
            modelType,
            rowOf(modelType),
            memberProps(),
          );
        }),
      ).toBeNull();
    });

    test("somebody signed in who is not a member of the project is refused", () => {
      const refusal: Error | null = refusalOf(() => {
        CreatePermission.checkCreatePermissions(
          modelType,
          rowOf(modelType, { projectId: PROJECT_ID, userId: CALLER_ID }),
          strangerProps(),
        );
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal?.message).toBe(
        CreatePermission.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
    });

    test("a member of another project - its owner, even - is refused", () => {
      const refusal: Error | null = refusalOf(() => {
        CreatePermission.checkCreatePermissions(
          modelType,
          rowOf(modelType, { projectId: PROJECT_ID, userId: CALLER_ID }),
          memberOfAnotherProjectProps(),
        );
      });

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal?.message).toBe(
        CreatePermission.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
    });

    test("the check before the hooks refuses the stranger too", () => {
      expect(
        refusalOf(() => {
          ModelPermission.checkCreateInMemberProject(
            modelType,
            rowOf(modelType, { projectId: PROJECT_ID }),
            strangerProps(),
          );
        }),
      ).toBeInstanceOf(NotAuthorizedException);
    });

    test("OneUptime's own create (root) is not asked", () => {
      expect(
        refusalOf(() => {
          CreatePermission.checkCreateInMemberProject(
            modelType,
            rowOf(modelType, { projectId: PROJECT_ID, userId: CALLER_ID }),
            { isRoot: true },
          );
        }),
      ).toBeNull();
    });
  },
);

describe("what counts as being a member of the project", () => {
  test("the project's permission set on the request - nothing in it but Project User - is enough", () => {
    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          UserSMS,
          rowOf(UserSMS, { projectId: PROJECT_ID }),
          memberProps(),
        );
      }),
    ).toBeNull();
  });

  test("a set for another project is not a set for this one", () => {
    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          UserSMS,
          rowOf(UserSMS, { projectId: PROJECT_ID }),
          memberOfAnotherProjectProps(),
        );
      }),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("being listed in the caller's global projects is not enough without the project's set", () => {
    /*
     * The global list is a cached list of project ids. The set for the
     * request's project is what getUserMiddleware builds after it has asked
     * the project's sign-in rules and whether it is blocked.
     */
    const props: DatabaseCommonInteractionProps = {
      ...strangerProps(),
      userGlobalAccessPermission: {
        projectIds: [PROJECT_ID],
        globalPermissions: [Permission.Public, Permission.User],
        _type: "UserGlobalAccessPermission",
      },
    };

    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          UserSMS,
          rowOf(UserSMS, { projectId: PROJECT_ID }),
          props,
        );
      }),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("a set present under the project's key but empty is no set", () => {
    const props: DatabaseCommonInteractionProps = {
      ...strangerProps(),
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: null as unknown as UserTenantAccessPermission,
      },
    };

    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          UserSMS,
          rowOf(UserSMS, { projectId: PROJECT_ID }),
          props,
        );
      }),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("the refusal is the same whether the project exists or not: nothing is looked up", () => {
    const unknownProject: ObjectID = new ObjectID(
      "6e000000-0000-4000-8000-0000000000ff",
    );

    const refusal: Error | null = refusalOf(() => {
      CreatePermission.checkCreateInMemberProject(
        UserSMS,
        rowOf(UserSMS, { projectId: unknownProject }),
        { ...strangerProps(), tenantId: unknownProject },
      );
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal?.message).toBe(
      CreatePermission.NOT_A_PROJECT_MEMBER_MESSAGE,
    );
  });
});

describe("the project a row is added to is the request's", () => {
  test("a row naming another project than the request's is refused, even for a member", () => {
    /*
     * A create's hooks read the row's own project before DatabaseService
     * stamps the request's onto it: a member of one project naming another
     * in the row would have that other project's SMS setting and balance
     * described back to them.
     */
    const refusal: Error | null = refusalOf(() => {
      CreatePermission.checkCreateInMemberProject(
        UserIncomingCallNumber,
        rowOf(UserIncomingCallNumber, { projectId: OTHER_PROJECT_ID }),
        memberProps(),
      );
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(CreatePermission.PROJECT_MISMATCH_MESSAGE);
  });

  test("so is one naming it through the project relation instead", () => {
    const row: BaseModel = rowOf(UserIncomingCallNumber);
    row.setColumnValue("project", {
      _id: OTHER_PROJECT_ID.toString(),
    } as never);

    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          UserIncomingCallNumber,
          row,
          memberProps(),
        );
      })?.message,
    ).toBe(CreatePermission.PROJECT_MISMATCH_MESSAGE);
  });

  /*
   * The two names are read as every reference check reads them
   * (RelationIdUtil.readConsistent): which of two disagreeing names TypeORM
   * stores depends on the shape of the write, so the rule could otherwise
   * check one project and the database keep another.
   */
  test("a row whose project ID and project relation disagree is refused", () => {
    const row: BaseModel = rowOf(UserSMS, { projectId: PROJECT_ID });
    row.setColumnValue("project", {
      _id: OTHER_PROJECT_ID.toString(),
    } as never);

    const refusal: Error | null = refusalOf(() => {
      CreatePermission.checkCreateInMemberProject(UserSMS, row, memberProps());
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(
      RelationIdUtil.getConflictMessage("Project", ["projectId", "project"]),
    );
  });

  test("a row that clears its project under one name and names it under the other is refused", () => {
    const row: BaseModel = rowOf(UserSMS);
    (row as unknown as Record<string, unknown>)["projectId"] = null;
    row.setColumnValue("project", { _id: PROJECT_ID.toString() } as never);

    const refusal: Error | null = refusalOf(() => {
      CreatePermission.checkCreateInMemberProject(UserSMS, row, memberProps());
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(
      RelationIdUtil.getConflictMessage("Project", ["projectId", "project"]),
    );
  });

  test("so is one doing that across the caller's own projects, with no project in the request", () => {
    const row: BaseModel = rowOf(UserSMS);
    (row as unknown as Record<string, unknown>)["projectId"] = null;
    row.setColumnValue("project", { _id: PROJECT_ID.toString() } as never);

    const props: DatabaseCommonInteractionProps = {
      ...memberProps(),
      isMultiTenantRequest: true,
    };
    delete props.tenantId;

    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(UserSMS, row, props);
      }),
    ).toBeInstanceOf(BadDataException);
  });

  test("the request's own project, in another case or under both names, is the same project", () => {
    const row: BaseModel = rowOf(UserSMS, {
      projectId: PROJECT_ID.toString().toUpperCase(),
    });
    row.setColumnValue("project", { _id: PROJECT_ID.toString() } as never);

    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          UserSMS,
          row,
          memberProps(),
        );
      }),
    ).toBeNull();
  });

  test("a stranger naming their own project in the header and this one in the row is refused", () => {
    const props: DatabaseCommonInteractionProps = {
      ...memberOfAnotherProjectProps(),
      tenantId: OTHER_PROJECT_ID,
    };

    const refusal: Error | null = refusalOf(() => {
      CreatePermission.checkCreateInMemberProject(
        UserSMS,
        rowOf(UserSMS, { projectId: PROJECT_ID }),
        props,
      );
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(CreatePermission.PROJECT_MISMATCH_MESSAGE);
  });
});

describe("a request that names no project", () => {
  test("is asked for one when the row names a project but the request carries no permission set", () => {
    const props: DatabaseCommonInteractionProps = { ...strangerProps() };
    delete props.tenantId;

    const refusal: Error | null = refusalOf(() => {
      CreatePermission.checkCreateInMemberProject(
        UserSMS,
        rowOf(UserSMS, { projectId: PROJECT_ID }),
        props,
      );
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(CreatePermission.PROJECT_REQUIRED_MESSAGE);
  });

  test("is asked for one when nothing names a project at all", () => {
    const props: DatabaseCommonInteractionProps = { ...memberProps() };
    delete props.tenantId;

    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          UserSMS,
          rowOf(UserSMS),
          props,
        );
      })?.message,
    ).toBe(CreatePermission.PROJECT_REQUIRED_MESSAGE);
  });

  /*
   * A change is made in one project at a time: a request across the
   * caller's own projects (is-multi-tenant-query) names none, so it is
   * asked for one - even by a member of the project the row names, whose
   * set the request carries.
   */
  test("across the caller's own projects, a row naming one of them is asked for the project", () => {
    const props: DatabaseCommonInteractionProps = {
      ...memberProps(),
      isMultiTenantRequest: true,
    };
    delete props.tenantId;

    const refusal: Error | null = refusalOf(() => {
      CreatePermission.checkCreateInMemberProject(
        UserSMS,
        rowOf(UserSMS, { projectId: PROJECT_ID }),
        props,
      );
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(CreatePermission.PROJECT_REQUIRED_MESSAGE);
  });

  test("across the caller's own projects, a row naming any other project is asked for the project too", () => {
    const props: DatabaseCommonInteractionProps = {
      ...memberOfAnotherProjectProps(),
      isMultiTenantRequest: true,
    };
    delete props.tenantId;

    const refusal: Error | null = refusalOf(() => {
      CreatePermission.checkCreateInMemberProject(
        UserSMS,
        rowOf(UserSMS, { projectId: PROJECT_ID }),
        props,
      );
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal?.message).toBe(CreatePermission.PROJECT_REQUIRED_MESSAGE);
  });

  /*
   * Across projects, a project whose sign-in rules the caller has not met
   * (it requires SSO, and they signed in without it) comes with the
   * placeholder set that lets them see how to sign in
   * (UserPermissionUtil.getDefaultUserTenantAccessPermission) - CurrentUser
   * and UnAuthorizedSsoUser, no Project User. That is not membership: the
   * project would refuse the same person if the request named it.
   */
  test("across the caller's own projects, a project whose SSO they have not signed in with is not opened by its placeholder set", () => {
    const props: DatabaseCommonInteractionProps = {
      userId: CALLER_ID,
      userType: UserType.User,
      isMultiTenantRequest: true,
      ...ON_HIGHEST_PLAN,
      userGlobalAccessPermission: {
        projectIds: [PROJECT_ID],
        globalPermissions: [Permission.Public, Permission.User],
        _type: "UserGlobalAccessPermission",
      },
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]:
          UserPermissionUtil.getDefaultUserTenantAccessPermission(PROJECT_ID),
      },
    };

    for (const modelType of [UserSMS, UserIncomingCallNumber]) {
      const refusal: Error | null = refusalOf(() => {
        ModelPermission.checkCreateInMemberProject(
          modelType,
          rowOf(modelType, { projectId: PROJECT_ID, userId: CALLER_ID }),
          props,
        );
      });

      expect(refusal).toBeInstanceOf(BadDataException);
      expect(refusal?.message).toBe(CreatePermission.PROJECT_REQUIRED_MESSAGE);
    }
  });
});

describe("who the rule leaves alone", () => {
  test("a master admin", () => {
    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          UserSMS,
          rowOf(UserSMS, { projectId: PROJECT_ID, userId: CALLER_ID }),
          { ...strangerProps(), isMasterAdmin: true },
        );
      }),
    ).toBeNull();
  });

  test("a caller whose role in the create list lets them create (a profile for a teammate)", () => {
    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          ProjectUserProfile,
          rowOf(ProjectUserProfile, { projectId: PROJECT_ID }),
          memberProps([Permission.ProjectMember]),
        );
      }),
    ).toBeNull();
  });

  test("an administrator repairing a member's notification rules holds a role, not CurrentUser alone", () => {
    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          UserNotificationRule,
          rowOf(UserNotificationRule, { projectId: PROJECT_ID }),
          memberProps([Permission.EditProjectUserNotificationRule]),
        );
      }),
    ).toBeNull();
  });

  test.each([
    ["UserSession", UserSession],
    ["UserTotpAuth", UserTotpAuth],
    ["UserWebAuthn", UserWebAuthn],
  ])(
    "%s - a person's own row of no project - for anybody signed in",
    (_name: string, modelType: ModelConstructor) => {
      expect(
        refusalOf(() => {
          CreatePermission.checkCreateInMemberProject(
            modelType,
            rowOf(modelType, { userId: CALLER_ID }),
            strangerProps(),
          );
        }),
      ).toBeNull();
    },
  );

  test("a model a role creates (team members) is not this rule's", () => {
    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          TeamMember,
          rowOf(TeamMember, { projectId: PROJECT_ID }),
          strangerProps(),
        );
      }),
    ).toBeNull();
  });

  test("an anonymous caller is left to the sign-in check, which answers it with a 401", () => {
    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          UserSMS,
          rowOf(UserSMS, { projectId: PROJECT_ID }),
          { tenantId: PROJECT_ID },
        );
      }),
    ).toBeNull();
  });
});

describe("a caller that is not a person", () => {
  test("an API key holding CurrentUser is refused as no session, before anything else", () => {
    const refusal: Error | null = refusalOf(() => {
      CreatePermission.checkCreateInMemberProject(
        UserSMS,
        rowOf(UserSMS, { projectId: PROJECT_ID }),
        {
          userType: UserType.API,
          tenantId: PROJECT_ID,
          userTenantAccessPermission: {
            [PROJECT_ID.toString()]: permissionSetFor(PROJECT_ID, [
              Permission.CurrentUser,
            ]),
          },
        },
      );
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal?.message).toBe(
      "A user session is required to create Phone Number for SMS Notifications.",
    );
  });

  test("an API key without CurrentUser is the table check's to refuse", () => {
    const props: DatabaseCommonInteractionProps = {
      userType: UserType.API,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: permissionSetFor(PROJECT_ID, [
          Permission.ProjectOwner,
        ]),
      },
    };

    expect(
      refusalOf(() => {
        CreatePermission.checkCreateInMemberProject(
          UserSMS,
          rowOf(UserSMS, { projectId: PROJECT_ID }),
          props,
        );
      }),
    ).toBeNull();

    expect(
      refusalOf(() => {
        CreatePermission.checkCreatePermissions(
          UserSMS,
          rowOf(UserSMS, { projectId: PROJECT_ID }),
          props,
        );
      }),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  test("a read-only credential is refused by the check before the hooks, as every write entry point refuses it", () => {
    const refusal: Error | null = refusalOf(() => {
      ModelPermission.checkCreateInMemberProject(
        UserSMS,
        rowOf(UserSMS, { projectId: PROJECT_ID }),
        { ...memberProps(), isReadOnlyCredential: true },
      );
    });

    expect(refusal).toBeInstanceOf(NotAuthorizedException);
    expect(refusal?.message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
  });
});

/*
 * DatabaseService asks before a create's hooks run: a service's hooks read
 * the project (whether it may send SMS, its balance) and send the first
 * code, so none of that happens for somebody who is not a member. The
 * repository is made to fail loudly: nothing may be read or written.
 */
describe("asked before the create's hooks run", () => {
  const REPOSITORY_REACHED: string =
    "The database was reached - the create got past the membership check.";

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [
      "UserSmsService",
      UserSmsService as unknown as Record<string, () => unknown>,
      UserSMS,
    ],
    [
      "UserIncomingCallNumberService",
      UserIncomingCallNumberService as unknown as Record<string, () => unknown>,
      UserIncomingCallNumber,
    ],
  ])(
    "%s.create refuses a stranger before its hook, and touches nothing",
    async (
      _name: string,
      service: Record<string, () => unknown>,
      modelType: ModelConstructor,
    ) => {
      const hook: ReturnType<typeof jest.spyOn> = jest.spyOn(
        service,
        "onBeforeCreate",
      );
      const repository: ReturnType<typeof jest.spyOn> = jest
        .spyOn(service, "getRepository")
        .mockImplementation(() => {
          throw new Error(REPOSITORY_REACHED);
        });

      let caught: unknown = undefined;

      try {
        await (
          service as unknown as {
            create: (data: {
              data: BaseModel;
              props: DatabaseCommonInteractionProps;
            }) => Promise<unknown>;
          }
        ).create({
          data: rowOf(modelType, { projectId: PROJECT_ID }),
          props: strangerProps(),
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(NotAuthorizedException);
      expect((caught as Error).message).toBe(
        CreatePermission.NOT_A_PROJECT_MEMBER_MESSAGE,
      );
      expect(hook).not.toHaveBeenCalled();
      expect(repository).not.toHaveBeenCalled();
    },
  );

  test("the check that asks without creating gives the same answer", async () => {
    const repository: ReturnType<typeof jest.spyOn> = jest
      .spyOn(
        UserSmsService as unknown as Record<string, () => unknown>,
        "getRepository",
      )
      .mockImplementation(() => {
        throw new Error(REPOSITORY_REACHED);
      });

    await expect(
      UserSmsService.checkCallerMayCreate({
        data: rowOf(UserSMS, { projectId: PROJECT_ID }) as UserSMS,
        props: strangerProps(),
      }),
    ).rejects.toThrow(CreatePermission.NOT_A_PROJECT_MEMBER_MESSAGE);

    expect(repository).not.toHaveBeenCalled();
  });
});
