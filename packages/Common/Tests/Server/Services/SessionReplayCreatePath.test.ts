import RumApplicationService from "../../../Server/Services/RumApplicationService";
import RumSessionErasureRequestService from "../../../Server/Services/RumSessionErasureRequestService";
import RumSessionPinService from "../../../Server/Services/RumSessionPinService";
import RumSessionReplayViewService from "../../../Server/Services/RumSessionReplayViewService";
import ColumnPermission from "../../../Server/Types/Database/Permissions/ColumnPermission";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import RumSessionErasureRequest, {
  RumSessionErasureRequestStatus,
  RumSessionErasureRequestType,
} from "../../../Models/DatabaseModels/RumSessionErasureRequest";
import RumSessionPin from "../../../Models/DatabaseModels/RumSessionPin";
import RumSessionReplayView from "../../../Models/DatabaseModels/RumSessionReplayView";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { beforeEach, describe, expect, it } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * The records these tests name are their project's own: the services check
 * every reference against the project (ProjectReferencesService).
 */
beforeEach(() => {
  stubProjectDirectory({});
});

/*
 * The create path for the session replay Postgres models.
 *
 * Neither model-shape assertions nor service unit tests catch what breaks
 * here: DatabaseService.create() runs onBeforeCreate, then
 * checkRequiredFields, then ModelPermission.checkCreatePermissions. A
 * column can be individually well-formed and still make every create of
 * its model throw, because those three steps disagree about it. Each test
 * below drives the same sequence create() does.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();

type MakePropsFunction = (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps;

const makeProps: MakePropsFunction = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: projectId,
    _type: "UserTenantAccessPermission",
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission" as const,
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };

  return {
    userId: userId,
    tenantId: projectId,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantPermission,
    },
  };
};

/*
 * checkRequiredFields and onBeforeCreate are protected on DatabaseService.
 * The tests have to call exactly what create() calls rather than a
 * re-implementation, otherwise they cannot see the defect at all.
 */
interface CreatePathAccess<TBaseModel extends DatabaseBaseModel> {
  checkRequiredFields: (data: TBaseModel) => TBaseModel;
  onBeforeCreate: (
    createBy: CreateBy<TBaseModel>,
  ) => Promise<OnCreate<TBaseModel>>;
}

type AsCreatePathFunction = <TBaseModel extends DatabaseBaseModel>(
  service: unknown,
) => CreatePathAccess<TBaseModel>;

const asCreatePath: AsCreatePathFunction = <
  TBaseModel extends DatabaseBaseModel,
>(
  service: unknown,
): CreatePathAccess<TBaseModel> => {
  return service as CreatePathAccess<TBaseModel>;
};

class PastTheHooks extends Error {}

type PastTheHooksFunction = (
  service: unknown,
  createBy: CreateBy<DatabaseBaseModel>,
) => Promise<Record<string, unknown>>;

/*
 * The service's real create path, hooks included, stopped right after the
 * hooks: what the row would be saved with as far as they are concerned.
 * DatabaseService takes out whatever the request named as who did something
 * to the record before the hooks run (UserAttribution).
 */
const pastTheHooks: PastTheHooksFunction = async (
  service: unknown,
  createBy: CreateBy<DatabaseBaseModel>,
): Promise<Record<string, unknown>> => {
  let reached: Record<string, unknown> = {};

  const stop: jest.SpyInstance = jest
    .spyOn(
      service as { generateSlug: (createBy: { data: unknown }) => unknown },
      "generateSlug",
    )
    .mockImplementation((write: { data: unknown }) => {
      reached = { ...(write.data as Record<string, unknown>) };
      throw new PastTheHooks();
    });

  try {
    await expect(
      (
        service as {
          create: (createBy: CreateBy<DatabaseBaseModel>) => Promise<unknown>;
        }
      ).create(createBy),
    ).rejects.toBeInstanceOf(PastTheHooks);
  } finally {
    stop.mockRestore();
  }

  return reached;
};

// An API key acting with the same permissions: no person on the request.
const asApiKey: (
  props: DatabaseCommonInteractionProps,
) => DatabaseCommonInteractionProps = (
  props: DatabaseCommonInteractionProps,
): DatabaseCommonInteractionProps => {
  return { ...props, userId: undefined, userType: UserType.API };
};

describe("RumApplication create path", () => {
  it("does not require the session replay selector lists to be supplied", () => {
    /*
     * RumApplicationService.findOrCreateByAppIdentifier auto-provisions an
     * application from the RUM ingest hot path with nothing but
     * projectId/name/appIdentifier. If a session replay column is declared
     * required without being a default-value column, checkRequiredFields
     * throws before the INSERT, the bare catch in findOrCreateByAppIdentifier
     * swallows it, and all RUM ingest for a new app dies.
     */
    const app: RumApplication = new RumApplication();
    app.projectId = projectId;
    app.name = "checkout-web";
    app.appIdentifier = "checkout-web";
    /* create() generates this from name before checkRequiredFields runs. */
    app.slug = "checkout-web";

    expect(() => {
      return asCreatePath<RumApplication>(
        RumApplicationService,
      ).checkRequiredFields(app);
    }).not.toThrow();
  });

  it("leaves no session replay column required without a default", () => {
    /*
     * The general form of the above: any required column that is not a
     * default-value column has to be one the caller actually supplies.
     */
    const app: RumApplication = new RumApplication();

    const requiredWithoutDefault: Array<string> = app
      .getRequiredColumns()
      .columns.filter((columnName: string): boolean => {
        return (
          columnName.startsWith("sessionReplay") &&
          !app.isDefaultValueColumn(columnName)
        );
      });

    expect(requiredWithoutDefault).toEqual([]);
  });
});

describe("RumSessionErasureRequestService create path", () => {
  type BuildFunction = () => CreateBy<RumSessionErasureRequest>;

  const buildCreateBy: BuildFunction =
    (): CreateBy<RumSessionErasureRequest> => {
      const model: RumSessionErasureRequest = new RumSessionErasureRequest();
      model.projectId = projectId;
      model.requestType = RumSessionErasureRequestType.BySessionId;
      model.targetValue = "session-123";

      return {
        data: model,
        props: makeProps([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.CreateRumSessionErasureRequest,
        ]),
      };
    };

  it("produces a model a project admin is allowed to create", async () => {
    /*
     * onBeforeCreate runs BEFORE checkCreatePermissions, so anything it
     * writes onto the model is checked against the caller's create ACL as
     * if the caller had sent it.
     */
    const createBy: CreateBy<RumSessionErasureRequest> = buildCreateBy();

    const onCreate: OnCreate<RumSessionErasureRequest> =
      await asCreatePath<RumSessionErasureRequest>(
        RumSessionErasureRequestService,
      ).onBeforeCreate(createBy);

    expect(() => {
      return ColumnPermission.checkDataColumnPermissions(
        RumSessionErasureRequest,
        onCreate.createBy.data,
        onCreate.createBy.props,
        DatabaseRequestType.Create,
      );
    }).not.toThrow();

    expect(() => {
      return asCreatePath<RumSessionErasureRequest>(
        RumSessionErasureRequestService,
      ).checkRequiredFields(onCreate.createBy.data);
    }).not.toThrow();
  });

  it("overwrites everything the requester could lie about", async () => {
    const createBy: CreateBy<RumSessionErasureRequest> = buildCreateBy();
    createBy.data.status = RumSessionErasureRequestStatus.Completed;
    createBy.data.sessionsDeleted = 9999;
    createBy.data.chunksDeleted = 9999;
    const spoofedRequestedAt: Date = OneUptimeDate.fromString(
      "2000-01-01T00:00:00.000Z",
    );
    createBy.data.requestedAt = spoofedRequestedAt;
    createBy.data.requestedByUserId = ObjectID.generate();

    const onCreate: OnCreate<RumSessionErasureRequest> =
      await asCreatePath<RumSessionErasureRequest>(
        RumSessionErasureRequestService,
      ).onBeforeCreate(createBy);

    expect(onCreate.createBy.data.status).toBe(
      RumSessionErasureRequestStatus.Pending,
    );
    expect(onCreate.createBy.data.sessionsDeleted).toBe(0);
    expect(onCreate.createBy.data.chunksDeleted).toBe(0);
    expect(onCreate.createBy.data.requestedAt?.getTime() || 0).toBeGreaterThan(
      spoofedRequestedAt.getTime(),
    );
    expect(onCreate.createBy.data.requestedByUserId?.toString()).toBe(
      userId.toString(),
    );
  });

  it("drops a spoofed requester when the caller is not a user", async () => {
    /*
     * API key callers have no props.userId. A client-supplied
     * requestedByUserId never reaches the row: DatabaseService takes it out
     * before the hook, which names nobody.
     */
    const createBy: CreateBy<RumSessionErasureRequest> = buildCreateBy();
    createBy.props = asApiKey(createBy.props);
    createBy.data.requestedByUserId = ObjectID.generate();

    const row: Record<string, unknown> = await pastTheHooks(
      RumSessionErasureRequestService,
      createBy as unknown as CreateBy<DatabaseBaseModel>,
    );

    expect(row["requestedByUserId"]).toBeUndefined();
    expect(row["status"]).toBe(RumSessionErasureRequestStatus.Pending);
  });

  it("the hook alone names nobody when the caller is not a user", async () => {
    const createBy: CreateBy<RumSessionErasureRequest> = buildCreateBy();
    createBy.props = asApiKey(createBy.props);

    const onCreate: OnCreate<RumSessionErasureRequest> =
      await asCreatePath<RumSessionErasureRequest>(
        RumSessionErasureRequestService,
      ).onBeforeCreate(createBy);

    expect(onCreate.createBy.data.requestedByUserId).toBeUndefined();
  });
});

describe("RumSessionPinService create path", () => {
  type BuildFunction = () => CreateBy<RumSessionPin>;

  const buildCreateBy: BuildFunction = (): CreateBy<RumSessionPin> => {
    const model: RumSessionPin = new RumSessionPin();
    model.projectId = projectId;
    model.rumApplicationId = ObjectID.generate();
    model.sessionId = "session-123";

    return {
      data: model,
      props: makeProps([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.CreateRumSessionReplay,
      ]),
    };
  };

  it("produces a model a project admin is allowed to create", async () => {
    const createBy: CreateBy<RumSessionPin> = buildCreateBy();

    const onCreate: OnCreate<RumSessionPin> =
      await asCreatePath<RumSessionPin>(RumSessionPinService).onBeforeCreate(
        createBy,
      );

    expect(() => {
      return ColumnPermission.checkDataColumnPermissions(
        RumSessionPin,
        onCreate.createBy.data,
        onCreate.createBy.props,
        DatabaseRequestType.Create,
      );
    }).not.toThrow();

    expect(() => {
      return asCreatePath<RumSessionPin>(
        RumSessionPinService,
      ).checkRequiredFields(onCreate.createBy.data);
    }).not.toThrow();
  });

  it("records the pinning user and never a client-supplied one", async () => {
    const createBy: CreateBy<RumSessionPin> = buildCreateBy();
    createBy.data.pinnedByUserId = ObjectID.generate();
    createBy.data.materializedAt = OneUptimeDate.getCurrentDate();

    const onCreate: OnCreate<RumSessionPin> =
      await asCreatePath<RumSessionPin>(RumSessionPinService).onBeforeCreate(
        createBy,
      );

    expect(onCreate.createBy.data.pinnedByUserId?.toString()).toBe(
      userId.toString(),
    );
    expect(onCreate.createBy.data.materializedAt).toBeUndefined();
  });

  it("drops a spoofed pinnedByUserId when the caller is not a user", async () => {
    const createBy: CreateBy<RumSessionPin> = buildCreateBy();
    createBy.props = asApiKey(createBy.props);
    createBy.data.pinnedByUserId = ObjectID.generate();

    // Not pinned yet: the create goes on to the write path.
    const lookup: jest.SpyInstance = jest
      .spyOn(
        RumSessionPinService as unknown as {
          getPinForSession: () => Promise<unknown>;
        },
        "getPinForSession",
      )
      .mockResolvedValue(null as never);

    try {
      const row: Record<string, unknown> = await pastTheHooks(
        RumSessionPinService,
        createBy as unknown as CreateBy<DatabaseBaseModel>,
      );

      expect(row["pinnedByUserId"]).toBeUndefined();
      expect(row["sessionId"]).toBe("session-123");
    } finally {
      lookup.mockRestore();
    }
  });

  it("the hook alone names nobody as the pinner when the caller is not a user", async () => {
    const createBy: CreateBy<RumSessionPin> = buildCreateBy();
    createBy.props = asApiKey(createBy.props);

    const onCreate: OnCreate<RumSessionPin> =
      await asCreatePath<RumSessionPin>(RumSessionPinService).onBeforeCreate(
        createBy,
      );

    expect(onCreate.createBy.data.pinnedByUserId).toBeUndefined();
  });

  it("returns the existing pin instead of a duplicate-key error", async () => {
    /*
     * The service comment promises clicking Pin twice is idempotent. The
     * unique index makes the second insert a 23505, which surfaces as a
     * raw 500 unless the service short-circuits first.
     */
    const existing: RumSessionPin = new RumSessionPin();
    existing.id = ObjectID.generate();

    const findOneBySpy: jest.SpyInstance = jest
      .spyOn(RumSessionPinService, "findOneBy")
      .mockResolvedValue(existing);

    const createSpy: jest.SpyInstance = jest.spyOn(
      RumSessionPinService,
      "create",
    );

    try {
      const created: RumSessionPin =
        await RumSessionPinService.create(buildCreateBy());

      expect(created.id?.toString()).toBe(existing.id.toString());
      /* Only the outer call; no insert was attempted. */
      expect(createSpy).toHaveBeenCalledTimes(1);
    } finally {
      findOneBySpy.mockRestore();
      createSpy.mockRestore();
    }
  });
});

describe("RumSessionReplayViewService.recordView", () => {
  it("truncates caller-supplied audit text to the column length", async () => {
    /*
     * accessReason, userAgent and ipAddress come straight off an untrusted
     * request. The audit table is append-only and never deleted, so an
     * oversized value is either a permanent row of junk or a hard insert
     * error on a request that should have been audited.
     */
    let saved: RumSessionReplayView | null = null;

    const createSpy: jest.SpyInstance = jest
      .spyOn(RumSessionReplayViewService, "create")
      .mockImplementation(async (createBy: CreateBy<RumSessionReplayView>) => {
        saved = createBy.data;
        return createBy.data;
      });

    try {
      await RumSessionReplayViewService.recordView({
        projectId: projectId,
        rumApplicationId: ObjectID.generate(),
        sessionId: "session-123",
        viewedByUserId: userId,
        ipAddress: "1".repeat(ColumnLength.ShortText + 500),
        userAgent: "u".repeat(ColumnLength.LongText + 500),
        accessReason: "r".repeat(ColumnLength.LongText + 500),
      });

      const row: RumSessionReplayView =
        saved as unknown as RumSessionReplayView;

      expect(row.ipAddress?.length).toBe(ColumnLength.ShortText);
      expect(row.userAgent?.length).toBe(ColumnLength.LongText);
      expect(row.accessReason?.length).toBe(ColumnLength.LongText);
    } finally {
      createSpy.mockRestore();
    }
  });
});
