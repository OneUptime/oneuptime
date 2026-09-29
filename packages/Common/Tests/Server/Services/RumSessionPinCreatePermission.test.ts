import DatabaseService from "../../../Server/Services/DatabaseService";
import RumSessionPinService from "../../../Server/Services/RumSessionPinService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import RumSessionPin from "../../../Models/DatabaseModels/RumSessionPin";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { JSONObject } from "../../../Types/JSON";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * RumSessionPinService.create answers "already pinned" by looking the pin up
 * as root and returning it, before super.create has run any permission
 * check. That lookup must not be reachable by a caller who could not create
 * the pin themselves, must search only the project the caller was checked
 * in, and must not hand back more of the pin than the caller could read.
 *
 * findOneBy is stubbed to return a pin for every lookup, so a missing gate
 * shows up as that pin coming back rather than as a database error.
 * DatabaseService.prototype.create is stubbed so no insert is attempted.
 */

const VICTIM_PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-00000000000a",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-00000000000b",
);
const RUM_APPLICATION_ID: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("00000000-0000-4000-8000-000000000003");
const PIN_ID: string = "00000000-0000-4000-8000-000000000004";
const SESSION_ID: string = "session-abc";
const STORED_REASON: string = "Customer reported checkout freezing";

type TenantPropsFunction = (data: {
  tenantId: ObjectID;
  permissions: Array<Permission>;
  blockedPermissions?: Array<Permission> | undefined;
  blockLabelIds?: Array<ObjectID> | undefined;
}) => DatabaseCommonInteractionProps;

/* The shape getUserMiddleware builds for a signed-in member of tenantId. */
const memberProps: TenantPropsFunction = (data: {
  tenantId: ObjectID;
  permissions: Array<Permission>;
  blockedPermissions?: Array<Permission> | undefined;
  blockLabelIds?: Array<ObjectID> | undefined;
}): DatabaseCommonInteractionProps => {
  type ToUserPermissionFunction = (
    isBlockPermission: boolean,
  ) => (permission: Permission) => UserPermission;

  const toUserPermission: ToUserPermissionFunction = (
    isBlockPermission: boolean,
  ): ((permission: Permission) => UserPermission) => {
    return (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: isBlockPermission ? data.blockLabelIds || [] : [],
        isBlockPermission: isBlockPermission,
      };
    };
  };

  const tenantPermission: UserTenantAccessPermission = {
    projectId: data.tenantId,
    _type: "UserTenantAccessPermission",
    permissions: [
      ...data.permissions.map(toUserPermission(false)),
      ...(data.blockedPermissions || []).map(toUserPermission(true)),
    ],
  };

  return {
    userId: USER_ID,
    tenantId: data.tenantId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [data.tenantId.toString()]: tenantPermission,
    },
  };
};

/* The shape ProjectMiddleware builds for a project API key. */
const apiKeyProps: TenantPropsFunction = (data: {
  tenantId: ObjectID;
  permissions: Array<Permission>;
}): DatabaseCommonInteractionProps => {
  const props: DatabaseCommonInteractionProps = memberProps(data);
  delete props.userId;
  props.userType = UserType.API;

  return props;
};

function pinRequest(
  props: DatabaseCommonInteractionProps,
): CreateBy<RumSessionPin> {
  const data: RumSessionPin = new RumSessionPin();
  data.projectId = VICTIM_PROJECT_ID;
  data.rumApplicationId = RUM_APPLICATION_ID;
  data.sessionId = SESSION_ID;

  return { data, props };
}

/* The model BaseAPI.createItem builds from a request body. */
function pinRequestFromBody(
  body: JSONObject,
  props: DatabaseCommonInteractionProps,
): CreateBy<RumSessionPin> {
  const data: RumSessionPin = DatabaseBaseModel.fromJSON<RumSessionPin>(
    body,
    RumSessionPin,
  ) as RumSessionPin;

  return { data, props };
}

function storedPin(projectId: ObjectID): RumSessionPin {
  const pin: RumSessionPin = new RumSessionPin();
  pin._id = PIN_ID;
  pin.projectId = projectId;
  pin.rumApplicationId = RUM_APPLICATION_ID;
  pin.sessionId = SESSION_ID;
  pin.reason = STORED_REASON;
  pin.incidentId = new ObjectID("00000000-0000-4000-8000-000000000005");
  pin.alertId = new ObjectID("00000000-0000-4000-8000-000000000007");
  pin.pinnedByUserId = new ObjectID("00000000-0000-4000-8000-000000000006");

  return pin;
}

/* The error DatabaseService.create throws when the unique index is hit. */
function translatedUniqueViolation(): unknown {
  return PostgresErrorTranslator.translate({
    message:
      'duplicate key value violates unique constraint "IDX_rum_session_pin_session"',
    code: "23505",
    table: "RumSessionPin",
    detail:
      'Key ("projectId", "rumApplicationId", "sessionId")=(00000000-0000-4000-8000-00000000000a, 00000000-0000-4000-8000-000000000002, session-abc) already exists.',
  });
}

type ExpectFullPinFunction = (result: RumSessionPin) => void;

const expectFullPin: ExpectFullPinFunction = (result: RumSessionPin): void => {
  expect(result._id).toBe(PIN_ID);
  expect(result.reason).toBe(STORED_REASON);
  expect(result.incidentId).toBeDefined();
  expect(result.pinnedByUserId).toBeDefined();
};

/*
 * Confirms the recording is pinned without anything somebody else wrote on
 * the pin - nor its id, which the update and delete endpoints take.
 */
const expectAcknowledgementOnly: ExpectFullPinFunction = (
  result: RumSessionPin,
): void => {
  expect(result._id).toBeUndefined();
  expect(result.projectId?.toString()).toBe(VICTIM_PROJECT_ID.toString());
  expect(result.rumApplicationId?.toString()).toBe(
    RUM_APPLICATION_ID.toString(),
  );
  expect(result.sessionId).toBe(SESSION_ID);
  expect(result.reason).toBeUndefined();
  expect(result.incidentId).toBeUndefined();
  expect(result.alertId).toBeUndefined();
  expect(result.expiresAt).toBeUndefined();
  expect(result.materializedAt).toBeUndefined();
  expect(result.pinnedByUserId).toBeUndefined();
};

describe("RumSessionPinService.create permission gate", () => {
  let findOneBySpy: jest.SpyInstance;
  let insertSpy: jest.SpyInstance;

  beforeEach(() => {
    findOneBySpy = jest
      .spyOn(RumSessionPinService, "findOneBy")
      .mockImplementation(
        async (findOneBy: FindOneBy<RumSessionPin>): Promise<RumSessionPin> => {
          return storedPin(findOneBy.query.projectId as ObjectID);
        },
      );

    insertSpy = jest
      .spyOn(DatabaseService.prototype, "create")
      .mockImplementation(async (createBy: CreateBy<any>) => {
        return createBy.data;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type RefusalType =
    | typeof NotAuthenticatedException
    | typeof NotAuthorizedException
    | typeof BadDataException;

  type ExpectRefusedFunction = (
    createBy: CreateBy<RumSessionPin>,
    exception: RefusalType,
  ) => Promise<void>;

  const expectRefusedBeforeLookup: ExpectRefusedFunction = async (
    createBy: CreateBy<RumSessionPin>,
    exception: RefusalType,
  ): Promise<void> => {
    await expect(RumSessionPinService.create(createBy)).rejects.toBeInstanceOf(
      exception,
    );

    expect(findOneBySpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  };

  describe("anonymous caller", () => {
    test("is refused as unauthenticated and never sees the pin", async () => {
      await expectRefusedBeforeLookup(
        pinRequest({ userType: UserType.Public }),
        NotAuthenticatedException,
      );
    });

    test("naming the project in the tenantid header changes nothing", async () => {
      /*
       * getUserMiddleware lets public requests through and takes tenantId
       * from the caller-supplied header, so an anonymous request can arrive
       * already carrying the victim's tenant.
       */
      await expectRefusedBeforeLookup(
        pinRequest({ userType: UserType.Public, tenantId: VICTIM_PROJECT_ID }),
        NotAuthenticatedException,
      );
    });
  });

  describe("authenticated member of another project", () => {
    test("claiming the victim project as tenant is refused", async () => {
      /*
       * The header names the victim project, but the caller has no grants
       * there: getUserMiddleware only attaches tenant permissions the user
       * actually holds.
       */
      const props: DatabaseCommonInteractionProps = memberProps({
        tenantId: OTHER_PROJECT_ID,
        permissions: [Permission.ProjectOwner],
      });
      props.tenantId = VICTIM_PROJECT_ID;

      await expectRefusedBeforeLookup(
        pinRequest(props),
        NotAuthorizedException,
      );
    });

    test("naming the victim project from their own tenant is refused", async () => {
      /*
       * A real owner of their own project, pointing the body's projectId at
       * someone else's. Their grants belong to their own tenant only.
       */
      await expectRefusedBeforeLookup(
        pinRequest(
          memberProps({
            tenantId: OTHER_PROJECT_ID,
            permissions: [Permission.ProjectOwner],
          }),
        ),
        NotAuthorizedException,
      );
    });

    test("naming the victim project through the project relation is refused", async () => {
      /*
       * The relation shares the projectId column and wins over it when
       * TypeORM saves, so a matching scalar alongside it proves nothing: the
       * row would be written into the victim project.
       */
      const createBy: CreateBy<RumSessionPin> = pinRequest(
        memberProps({
          tenantId: OTHER_PROJECT_ID,
          permissions: [Permission.ProjectOwner],
        }),
      );
      createBy.data.projectId = OTHER_PROJECT_ID;
      createBy.data.project = new Project(VICTIM_PROJECT_ID);

      await expectRefusedBeforeLookup(createBy, NotAuthorizedException);
    });
  });

  describe("member of the project without a create grant", () => {
    test("read-only access is not enough to reach the existing pin", async () => {
      await expectRefusedBeforeLookup(
        pinRequest(
          memberProps({
            tenantId: VICTIM_PROJECT_ID,
            permissions: [Permission.ReadRumSessionReplay],
          }),
        ),
        NotAuthorizedException,
      );
    });

    test("a team block on creating pins outranks the member role", async () => {
      /*
       * ProjectMember is on the create list, so the allow check alone would
       * let this caller through; only the block list stops them.
       */
      await expectRefusedBeforeLookup(
        pinRequest(
          memberProps({
            tenantId: VICTIM_PROJECT_ID,
            permissions: [Permission.ProjectMember],
            blockedPermissions: [Permission.CreateRumSessionReplay],
          }),
        ),
        NotAuthorizedException,
      );
    });
  });

  describe("permitted caller", () => {
    test("pinning an already-pinned recording returns the existing pin", async () => {
      const result: RumSessionPin = await RumSessionPinService.create(
        pinRequest(
          memberProps({
            tenantId: VICTIM_PROJECT_ID,
            permissions: [Permission.ProjectMember],
          }),
        ),
      );

      expectFullPin(result);
      /* Idempotent: nothing was inserted. */
      expect(insertSpy).not.toHaveBeenCalled();
    });

    test("the lookup searches the tenant, not the project as the body spelled it", async () => {
      /*
       * The same project in upper case is accepted, and it is the tenant's
       * spelling that reaches the query - which is also what shows the
       * lookup is keyed on the tenant rather than on the body.
       */
      const createBy: CreateBy<RumSessionPin> = pinRequest(
        apiKeyProps({
          tenantId: VICTIM_PROJECT_ID,
          permissions: [Permission.ProjectMember],
        }),
      );
      createBy.data.projectId = new ObjectID(
        VICTIM_PROJECT_ID.toString().toUpperCase(),
      );

      await RumSessionPinService.create(createBy);

      expect(findOneBySpy).toHaveBeenCalledTimes(1);

      const lookup: FindOneBy<RumSessionPin> = findOneBySpy.mock
        .calls[0]![0] as FindOneBy<RumSessionPin>;

      expect((lookup.query.projectId as ObjectID).toString()).toBe(
        VICTIM_PROJECT_ID.toString(),
      );
      expect((lookup.query.rumApplicationId as ObjectID).toString()).toBe(
        RUM_APPLICATION_ID.toString(),
      );
      expect(lookup.query.sessionId).toBe(SESSION_ID);
    });

    test("a new pin reaches super.create with the project relation dropped", async () => {
      findOneBySpy.mockResolvedValue(null as never);

      const createBy: CreateBy<RumSessionPin> = pinRequest(
        memberProps({
          tenantId: VICTIM_PROJECT_ID,
          permissions: [Permission.ProjectMember],
        }),
      );
      createBy.data.project = new Project(VICTIM_PROJECT_ID);

      await RumSessionPinService.create(createBy);

      expect(insertSpy).toHaveBeenCalledTimes(1);

      const inserted: CreateBy<RumSessionPin> = insertSpy.mock
        .calls[0]![0] as CreateBy<RumSessionPin>;

      expect(inserted.data.project).toBeUndefined();
      expect(inserted.data.projectId?.toString()).toBe(
        VICTIM_PROJECT_ID.toString(),
      );
    });

    test("a pin that appears mid-create is returned by the race recovery", async () => {
      findOneBySpy.mockResolvedValueOnce(null as never);
      insertSpy.mockRejectedValueOnce(translatedUniqueViolation() as never);

      const result: RumSessionPin = await RumSessionPinService.create(
        pinRequest(
          memberProps({
            tenantId: VICTIM_PROJECT_ID,
            permissions: [Permission.ProjectMember],
          }),
        ),
      );

      expectFullPin(result);
      expect(findOneBySpy).toHaveBeenCalledTimes(2);
    });
  });

  describe("caller who may create pins but not read them", () => {
    test("an ingest-only API key learns the recording is pinned, nothing more", async () => {
      /*
       * CreateRumSessionReplay is on the pin's create list but not its read
       * list; the same key is refused by get-list.
       */
      const result: RumSessionPin = await RumSessionPinService.create(
        pinRequest(
          apiKeyProps({
            tenantId: VICTIM_PROJECT_ID,
            permissions: [Permission.CreateRumSessionReplay],
          }),
        ),
      );

      expectAcknowledgementOnly(result);
      expect(insertSpy).not.toHaveBeenCalled();
    });

    test("an API key that can also read gets the whole pin", async () => {
      const result: RumSessionPin = await RumSessionPinService.create(
        pinRequest(
          apiKeyProps({
            tenantId: VICTIM_PROJECT_ID,
            permissions: [
              Permission.CreateRumSessionReplay,
              Permission.ReadRumSessionReplay,
            ],
          }),
        ),
      );

      expectFullPin(result);
    });

    test("a member whose team blocks reading pins gets the acknowledgement", async () => {
      const result: RumSessionPin = await RumSessionPinService.create(
        pinRequest(
          memberProps({
            tenantId: VICTIM_PROJECT_ID,
            permissions: [Permission.ProjectMember],
            blockedPermissions: [Permission.ReadRumSessionReplay],
          }),
        ),
      );

      expectAcknowledgementOnly(result);
    });

    test("a label-scoped read block also gets the acknowledgement", async () => {
      /*
       * Pins carry no labels, so the read path cannot narrow a label-scoped
       * block to rows and refuses the read outright.
       */
      const result: RumSessionPin = await RumSessionPinService.create(
        pinRequest(
          memberProps({
            tenantId: VICTIM_PROJECT_ID,
            permissions: [Permission.ProjectMember],
            blockedPermissions: [Permission.ReadRumSessionReplay],
            blockLabelIds: [
              new ObjectID("00000000-0000-4000-8000-0000000000aa"),
            ],
          }),
        ),
      );

      expectAcknowledgementOnly(result);
    });

    test("the race recovery is held to the same rule", async () => {
      findOneBySpy.mockResolvedValueOnce(null as never);
      insertSpy.mockRejectedValueOnce(translatedUniqueViolation() as never);

      const result: RumSessionPin = await RumSessionPinService.create(
        pinRequest(
          apiKeyProps({
            tenantId: VICTIM_PROJECT_ID,
            permissions: [Permission.CreateRumSessionReplay],
          }),
        ),
      );

      expectAcknowledgementOnly(result);
    });
  });

  describe("request body", () => {
    const ingestKey: () => DatabaseCommonInteractionProps =
      (): DatabaseCommonInteractionProps => {
        return apiKeyProps({
          tenantId: VICTIM_PROJECT_ID,
          permissions: [Permission.CreateRumSessionReplay],
        });
      };

    test("a query operator in sessionId is refused before the lookup", async () => {
      /*
       * Deserialized as a StartsWith, this would turn "is this recording
       * pinned" into a search across every pin in the project.
       */
      await expectRefusedBeforeLookup(
        pinRequestFromBody(
          {
            projectId: VICTIM_PROJECT_ID.toJSON(),
            rumApplicationId: RUM_APPLICATION_ID.toJSON(),
            sessionId: { _type: "StartsWith", value: "a" },
          },
          ingestKey(),
        ),
        BadDataException,
      );
    });

    test("a query operator in rumApplicationId is refused before the lookup", async () => {
      await expectRefusedBeforeLookup(
        pinRequestFromBody(
          {
            projectId: VICTIM_PROJECT_ID.toJSON(),
            rumApplicationId: { _type: "NotNull" },
            sessionId: SESSION_ID,
          },
          ingestKey(),
        ),
        BadDataException,
      );
    });

    test("a query operator in projectId is refused before the lookup", async () => {
      await expectRefusedBeforeLookup(
        pinRequestFromBody(
          {
            projectId: {
              _type: "StartsWith",
              value: VICTIM_PROJECT_ID.toString(),
            },
            rumApplicationId: RUM_APPLICATION_ID.toJSON(),
            sessionId: SESSION_ID,
          },
          ingestKey(),
        ),
        BadDataException,
      );
    });

    test("ids sent as plain UUID strings still work", async () => {
      await RumSessionPinService.create(
        pinRequestFromBody(
          {
            projectId: VICTIM_PROJECT_ID.toString(),
            rumApplicationId: RUM_APPLICATION_ID.toString(),
            sessionId: SESSION_ID,
          },
          ingestKey(),
        ),
      );

      const lookup: FindOneBy<RumSessionPin> = findOneBySpy.mock
        .calls[0]![0] as FindOneBy<RumSessionPin>;

      expect(lookup.query.rumApplicationId).toBeInstanceOf(ObjectID);
      expect((lookup.query.rumApplicationId as ObjectID).toString()).toBe(
        RUM_APPLICATION_ID.toString(),
      );
    });

    test("client-chosen system columns never reach super.create", async () => {
      findOneBySpy.mockResolvedValue(null as never);

      const createBy: CreateBy<RumSessionPin> = pinRequest(ingestKey());
      createBy.data._id = "00000000-0000-4000-8000-0000000000ff";
      createBy.data.deletedAt = new Date("2020-01-01T00:00:00Z");
      createBy.data.createdAt = new Date("2020-01-01T00:00:00Z");

      await RumSessionPinService.create(createBy);

      const inserted: CreateBy<RumSessionPin> = insertSpy.mock
        .calls[0]![0] as CreateBy<RumSessionPin>;

      expect(inserted.data._id).toBeUndefined();
      expect(inserted.data.deletedAt).toBeUndefined();
      expect(inserted.data.createdAt).toBeUndefined();
    });

    test("a project relation in the body naming another project is refused", async () => {
      await expectRefusedBeforeLookup(
        pinRequestFromBody(
          {
            projectId: VICTIM_PROJECT_ID.toJSON(),
            project: { _id: OTHER_PROJECT_ID.toString() },
            rumApplicationId: RUM_APPLICATION_ID.toJSON(),
            sessionId: SESSION_ID,
          },
          ingestKey(),
        ),
        NotAuthorizedException,
      );
    });

    test("a project relation too nested to read is still dropped", async () => {
      /*
       * fromJSON leaves this as an array with no _id to check, so only the
       * unconditional drop keeps it out of the save.
       */
      findOneBySpy.mockResolvedValue(null as never);

      await RumSessionPinService.create(
        pinRequestFromBody(
          {
            projectId: VICTIM_PROJECT_ID.toJSON(),
            project: [[{ _id: OTHER_PROJECT_ID.toString() }]],
            rumApplicationId: RUM_APPLICATION_ID.toJSON(),
            sessionId: SESSION_ID,
          },
          ingestKey(),
        ),
      );

      const inserted: CreateBy<RumSessionPin> = insertSpy.mock
        .calls[0]![0] as CreateBy<RumSessionPin>;

      expect(inserted.data.project).toBeUndefined();
    });

    test("a rumApplication relation that disagrees is refused", async () => {
      const createBy: CreateBy<RumSessionPin> = pinRequest(ingestKey());
      createBy.data.rumApplication = new RumApplication(
        new ObjectID("00000000-0000-4000-8000-0000000000bb"),
      );

      await expectRefusedBeforeLookup(createBy, BadDataException);
    });

    test("a rumApplication relation that agrees is dropped before saving", async () => {
      findOneBySpy.mockResolvedValue(null as never);

      const createBy: CreateBy<RumSessionPin> = pinRequest(ingestKey());
      createBy.data.rumApplication = new RumApplication(RUM_APPLICATION_ID);

      await RumSessionPinService.create(createBy);

      const inserted: CreateBy<RumSessionPin> = insertSpy.mock
        .calls[0]![0] as CreateBy<RumSessionPin>;

      expect(inserted.data.rumApplication).toBeUndefined();
    });

    test("a request without projectId goes to onBeforeCreate, not the lookup", async () => {
      const createBy: CreateBy<RumSessionPin> = pinRequest(ingestKey());
      delete createBy.data.projectId;

      await RumSessionPinService.create(createBy);

      expect(findOneBySpy).not.toHaveBeenCalled();
      expect(insertSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("internal callers", () => {
    test("root is not gated", async () => {
      const result: RumSessionPin = await RumSessionPinService.create(
        pinRequest({ isRoot: true }),
      );

      expectFullPin(result);
    });

    test("a master admin is not gated", async () => {
      const result: RumSessionPin = await RumSessionPinService.create(
        pinRequest({ isMasterAdmin: true, userId: USER_ID }),
      );

      expectFullPin(result);
    });

    test("root still cannot save a project relation that disagrees", async () => {
      const createBy: CreateBy<RumSessionPin> = pinRequest({ isRoot: true });
      createBy.data.project = new Project(OTHER_PROJECT_ID);

      await expectRefusedBeforeLookup(createBy, BadDataException);
    });
  });
});
