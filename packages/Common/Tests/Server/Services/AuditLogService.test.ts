import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AuditLogServiceInstance, {
  AUDIT_LOG_CREATE_REFUSED_MESSAGE,
  AuditLogService,
} from "../../../Server/Services/AuditLogService";
import AnalyticsDatabaseService from "../../../Server/Services/AnalyticsDatabaseService";
import ModelPermission from "../../../Server/Types/AnalyticsDatabase/ModelPermission";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import logger from "../../../Server/Utils/Logger";
import AuditLog from "../../../Models/AnalyticsModels/AuditLog";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import FakeEnterpriseModule, {
  createAuditLogRecorderSpy,
  installFakeEnterpriseModule,
  MockedAuditLogRecorder,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import AuditLogAction from "../../../Types/AuditLog/AuditLogAction";
import { SessionAuditEvent } from "../../../Types/AuditLog/AuditLogSessionEvent";
import {
  SignInFailureAuditEvent,
  SignInFailureReason,
} from "../../../Types/AuditLog/AuditLogSignInFailure";
import { StatusPageSessionAuditEvent } from "../../../Types/AuditLog/AuditLogStatusPageSession";
import { SignInSettingsClearedAuditEvent } from "../../../Types/AuditLog/AuditLogSignInSettingsCleared";
import { SignInMethod } from "../../../Types/UserSession/SessionSignIn";

/*
 * Core's AuditLogService after the Community / Enterprise split.
 *
 * Audit-log RECORDING is an Enterprise Edition feature: which changes are
 * recorded, the diff, redaction, names and the settings cache live in ee/
 * (ee/Server/AuditLog/AuditLogRecorder.ts, pinned by
 * ee/Tests/Server/AuditLog/AuditLogRecorder.test.ts). What stays here, and is
 * pinned here, is the seam every audited write goes through:
 *
 *   - Community Edition: no recorder, every call is a no-op and nothing is
 *     written - there is no recording code left in core to write it;
 *   - Enterprise Edition: each call reaches the recorder with exactly the
 *     arguments DatabaseService passed, looked up on every call (the module
 *     registers after core loaded);
 *   - never a failed write because of its audit entry, whatever the recorder
 *     does.
 *
 * Billing and the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true). This suite must pass with ee/ deleted: it uses only
 * the fake enterprise module.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("22222222-2222-4222-8222-222222222222"),
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

type CreateData = {
  model: Monitor;
  createdItem: Monitor;
  props: DatabaseCommonInteractionProps;
};

type UpdateData = {
  model: Monitor;
  before: Monitor;
  updatedFields: { name: string };
  itemId: ObjectID;
  props: DatabaseCommonInteractionProps;
};

type DeleteData = {
  model: Monitor;
  deletedItem: Monitor;
  itemId: ObjectID;
  props: DatabaseCommonInteractionProps;
};

const makeMonitor: () => Monitor = (): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.name = "Checkout API";
  return monitor;
};

const createData: () => CreateData = (): CreateData => {
  return { model: new Monitor(), createdItem: makeMonitor(), props: PROPS };
};

const updateData: () => UpdateData = (): UpdateData => {
  return {
    model: new Monitor(),
    before: makeMonitor(),
    updatedFields: { name: "Checkout API (primary)" },
    itemId: MONITOR_ID,
    props: PROPS,
  };
};

const deleteData: () => DeleteData = (): DeleteData => {
  return {
    model: new Monitor(),
    deletedItem: makeMonitor(),
    itemId: MONITOR_ID,
    props: PROPS,
  };
};

type DownloadData = {
  model: Monitor;
  downloadedItem: Monitor;
  itemId: ObjectID;
  props: DatabaseCommonInteractionProps;
};

// A download of a record's file, as the packet capture download route makes it.
const downloadData: () => DownloadData = (): DownloadData => {
  return {
    model: new Monitor(),
    downloadedItem: makeMonitor(),
    itemId: MONITOR_ID,
    props: PROPS,
  };
};

// The record entry points, each driven the way its caller drives it.
type EntryPoint = {
  name:
    | "recordCreate"
    | "recordUpdate"
    | "recordDelete"
    | "recordDownload"
    | "recordSessionEvents"
    | "recordSignInFailures"
    | "recordSignInSettingsCleared"
    | "recordStatusPageSessionEvents";
  call: (service: AuditLogService) => Promise<void>;
};

/*
 * A master admin clearing someone's sign-in settings, as LocalSignInClearing
 * hands it over (issue #9762).
 */
const signInSettingsCleared: () => Array<SignInSettingsClearedAuditEvent> =
  (): Array<SignInSettingsClearedAuditEvent> => {
    return [
      {
        userId: new ObjectID("12121212-1212-4212-8212-121212121212"),
        clearedByUserId: new ObjectID("17171717-1717-4717-8717-171717171717"),
        cleared: {
          hasPassword: true,
          isTwoFactorAuthEnabled: true,
          authenticatorAppCount: 1,
          passkeyAndSecurityKeyCount: 2,
          backupCodeCount: 8,
        },
      },
    ];
  };

// A failed sign-in, as FailedSignInAuditLog hands it over (issue #6788).
const signInFailures: () => Array<SignInFailureAuditEvent> =
  (): Array<SignInFailureAuditEvent> => {
    return [
      {
        userId: new ObjectID("12121212-1212-4212-8212-121212121212"),
        attemptId: new ObjectID("14141414-1414-4414-8414-141414141414"),
        reason: SignInFailureReason.WrongPassword,
        signIn: { method: SignInMethod.Password },
        device: "Chrome 130 on macOS",
        ipAddress: "203.0.113.7",
        failedAttempts: 1,
      },
    ];
  };

// A status page reader's sign-in (issue #6790).
const statusPageSessionEvents: () => Array<StatusPageSessionAuditEvent> =
  (): Array<StatusPageSessionAuditEvent> => {
    return [
      {
        action: AuditLogAction.SignIn,
        sessionId: new ObjectID("15151515-1515-4515-8515-151515151515"),
        projectId: PROJECT_ID,
        statusPageId: new ObjectID("16161616-1616-4616-8616-161616161616"),
        readerEmail: "customer@example.com",
        signIn: { method: SignInMethod.Password },
        device: "Chrome 130 on macOS",
        ipAddress: "203.0.113.7",
      },
    ];
  };

// A sign-in, as UserSessionService hands it over (issue #6762).
const sessionEvents: () => Array<SessionAuditEvent> =
  (): Array<SessionAuditEvent> => {
    return [
      {
        action: AuditLogAction.SignIn,
        userId: new ObjectID("12121212-1212-4212-8212-121212121212"),
        sessionId: new ObjectID("13131313-1313-4313-8313-131313131313"),
        signIn: { method: SignInMethod.Password },
        device: "Chrome 130 on macOS",
        ipAddress: "203.0.113.7",
      },
    ];
  };

const RECORD_ENTRY_POINTS: Array<EntryPoint> = [
  {
    name: "recordCreate",
    call: (service: AuditLogService): Promise<void> => {
      return service.recordCreate(createData());
    },
  },
  {
    name: "recordUpdate",
    call: (service: AuditLogService): Promise<void> => {
      return service.recordUpdate(updateData());
    },
  },
  {
    name: "recordDelete",
    call: (service: AuditLogService): Promise<void> => {
      return service.recordDelete(deleteData());
    },
  },
  {
    name: "recordDownload",
    call: (service: AuditLogService): Promise<void> => {
      return service.recordDownload(downloadData());
    },
  },
  {
    name: "recordSessionEvents",
    call: (service: AuditLogService): Promise<void> => {
      return service.recordSessionEvents(sessionEvents());
    },
  },
  {
    name: "recordSignInFailures",
    call: (service: AuditLogService): Promise<void> => {
      return service.recordSignInFailures(signInFailures());
    },
  },
  {
    name: "recordSignInSettingsCleared",
    call: (service: AuditLogService): Promise<void> => {
      return service.recordSignInSettingsCleared(signInSettingsCleared());
    },
  },
  {
    name: "recordStatusPageSessionEvents",
    call: (service: AuditLogService): Promise<void> => {
      return service.recordStatusPageSessionEvents(statusPageSessionEvents());
    },
  },
];

let insertSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();

  // Nothing here may ever reach ClickHouse: a write would be a bug.
  insertSpy = jest
    .spyOn(AuditLogServiceInstance, "create")
    .mockImplementation(((createBy: { data: AuditLog }) => {
      return Promise.resolve(createBy.data);
    }) as never);

  warnSpy = jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("on the Community Edition (no enterprise module)", () => {
  test.each([false, true])(
    "with billing=%s every record call resolves and writes nothing",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);

      expect(EnterpriseEdition.isLoaded()).toBe(false);

      for (const entryPoint of RECORD_ENTRY_POINTS) {
        await expect(
          entryPoint.call(AuditLogServiceInstance),
        ).resolves.toBeUndefined();
      }

      expect(insertSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    },
  );

  // A failed sign-in is not even counted where nothing could record it.
  test("nothing records here", () => {
    expect(AuditLogServiceInstance.hasRecorder()).toBe(false);
  });

  test("invalidating a project's settings is a harmless no-op", () => {
    expect(() => {
      AuditLogServiceInstance.invalidateProjectSettings(PROJECT_ID);
    }).not.toThrow();
  });

  test("a fresh instance behaves the same as the shared one", async () => {
    const service: AuditLogService = new AuditLogService();
    const freshInsert: jest.SpyInstance = jest
      .spyOn(service, "create")
      .mockImplementation(((createBy: { data: AuditLog }) => {
        return Promise.resolve(createBy.data);
      }) as never);

    for (const entryPoint of RECORD_ENTRY_POINTS) {
      await entryPoint.call(service);
    }

    expect(freshInsert).not.toHaveBeenCalled();
  });
});

describe("with the Enterprise Edition loaded", () => {
  let recorder: MockedAuditLogRecorder;

  beforeEach(() => {
    recorder = createAuditLogRecorderSpy();
    installFakeEnterpriseModule({ auditLogRecorder: recorder });
  });

  test.each([false, true])(
    "with billing=%s recordCreate hands the recorder the very arguments it was given",
    async (billing: boolean) => {
      setTestBillingEnabled(billing);
      const data: CreateData = createData();

      await AuditLogServiceInstance.recordCreate(data);

      expect(recorder.recordCreate).toHaveBeenCalledTimes(1);
      expect(recorder.recordCreate.mock.calls[0]![0]).toBe(data);
      expect(recorder.recordUpdate).not.toHaveBeenCalled();
      expect(recorder.recordDelete).not.toHaveBeenCalled();
    },
  );

  test("recordUpdate hands the recorder the very arguments it was given", async () => {
    const data: UpdateData = updateData();

    await AuditLogServiceInstance.recordUpdate(data);

    expect(recorder.recordUpdate).toHaveBeenCalledTimes(1);
    expect(recorder.recordUpdate.mock.calls[0]![0]).toBe(data);
    expect(recorder.recordCreate).not.toHaveBeenCalled();
  });

  test("recordDelete hands the recorder the very arguments it was given", async () => {
    const data: DeleteData = deleteData();

    await AuditLogServiceInstance.recordDelete(data);

    expect(recorder.recordDelete).toHaveBeenCalledTimes(1);
    expect(recorder.recordDelete.mock.calls[0]![0]).toBe(data);
    expect(recorder.recordCreate).not.toHaveBeenCalled();
  });

  test("recordDownload hands the recorder the very arguments it was given", async () => {
    const data: DownloadData = downloadData();

    await AuditLogServiceInstance.recordDownload(data);

    expect(recorder.recordDownload).toHaveBeenCalledTimes(1);
    expect(recorder.recordDownload.mock.calls[0]![0]).toBe(data);
    expect(recorder.recordCreate).not.toHaveBeenCalled();
    expect(recorder.recordUpdate).not.toHaveBeenCalled();
    expect(recorder.recordDelete).not.toHaveBeenCalled();
  });

  test("recordSessionEvents hands the recorder the very events it was given", async () => {
    const events: Array<SessionAuditEvent> = sessionEvents();

    await AuditLogServiceInstance.recordSessionEvents(events);

    expect(recorder.recordSessionEvents).toHaveBeenCalledTimes(1);
    expect(recorder.recordSessionEvents.mock.calls[0]![0]).toBe(events);
    expect(recorder.recordCreate).not.toHaveBeenCalled();
  });

  test("no events are not handed over at all", async () => {
    await AuditLogServiceInstance.recordSessionEvents([]);

    expect(recorder.recordSessionEvents).not.toHaveBeenCalled();
  });

  test("recordSessionEvents never throws when the recorder does: the sign-in goes ahead", async () => {
    recorder.recordSessionEvents.mockRejectedValue(
      new Error("recorder broke its promise") as never,
    );

    await expect(
      AuditLogServiceInstance.recordSessionEvents(sessionEvents()),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "AuditLog: failed to record session events",
    );
  });

  test("recordSignInFailures hands the recorder the very failed sign-ins it was given", async () => {
    const events: Array<SignInFailureAuditEvent> = signInFailures();

    await AuditLogServiceInstance.recordSignInFailures(events);

    expect(recorder.recordSignInFailures).toHaveBeenCalledTimes(1);
    expect(recorder.recordSignInFailures.mock.calls[0]![0]).toBe(events);
  });

  test("recordSignInFailures with none asks the recorder nothing, and never throws when it fails", async () => {
    await AuditLogServiceInstance.recordSignInFailures([]);

    expect(recorder.recordSignInFailures).not.toHaveBeenCalled();

    recorder.recordSignInFailures.mockRejectedValue(
      new Error("recorder broke its promise") as never,
    );

    await expect(
      AuditLogServiceInstance.recordSignInFailures(signInFailures()),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "AuditLog: failed to record failed sign-ins",
    );
  });

  test("recordSignInSettingsCleared hands the recorder the very clears it was given", async () => {
    const events: Array<SignInSettingsClearedAuditEvent> =
      signInSettingsCleared();

    await AuditLogServiceInstance.recordSignInSettingsCleared(events);

    expect(recorder.recordSignInSettingsCleared).toHaveBeenCalledTimes(1);
    expect(recorder.recordSignInSettingsCleared.mock.calls[0]![0]).toBe(events);
    expect(recorder.recordUpdate).not.toHaveBeenCalled();
    expect(recorder.recordSessionEvents).not.toHaveBeenCalled();
  });

  test("recordSignInSettingsCleared with none asks the recorder nothing, and never throws when it fails: the settings are gone", async () => {
    await AuditLogServiceInstance.recordSignInSettingsCleared([]);

    expect(recorder.recordSignInSettingsCleared).not.toHaveBeenCalled();

    recorder.recordSignInSettingsCleared.mockRejectedValue(
      new Error("recorder broke its promise") as never,
    );

    await expect(
      AuditLogServiceInstance.recordSignInSettingsCleared(
        signInSettingsCleared(),
      ),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "AuditLog: failed to record cleared sign-in settings",
    );
  });

  test("recordStatusPageSessionEvents hands the recorder the very events it was given", async () => {
    const events: Array<StatusPageSessionAuditEvent> =
      statusPageSessionEvents();

    await AuditLogServiceInstance.recordStatusPageSessionEvents(events);

    expect(recorder.recordStatusPageSessionEvents).toHaveBeenCalledTimes(1);
    expect(recorder.recordStatusPageSessionEvents.mock.calls[0]![0]).toBe(
      events,
    );
  });

  test("recordStatusPageSessionEvents with none asks the recorder nothing, and never throws when it fails", async () => {
    await AuditLogServiceInstance.recordStatusPageSessionEvents([]);

    expect(recorder.recordStatusPageSessionEvents).not.toHaveBeenCalled();

    recorder.recordStatusPageSessionEvents.mockRejectedValue(
      new Error("recorder broke its promise") as never,
    );

    await expect(
      AuditLogServiceInstance.recordStatusPageSessionEvents(
        statusPageSessionEvents(),
      ),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "AuditLog: failed to record status page session events",
    );
  });

  test("hasRecorder says the Enterprise Edition records here", () => {
    expect(AuditLogServiceInstance.hasRecorder()).toBe(true);
  });

  test("invalidateProjectSettings reaches the recorder's cache", () => {
    AuditLogServiceInstance.invalidateProjectSettings(PROJECT_ID);

    expect(recorder.invalidateProjectSettings).toHaveBeenCalledTimes(1);
    expect(recorder.invalidateProjectSettings).toHaveBeenCalledWith(PROJECT_ID);
  });

  test("core itself never writes: an entry is the recorder's to write", async () => {
    for (const entryPoint of RECORD_ENTRY_POINTS) {
      await entryPoint.call(AuditLogServiceInstance);
    }

    expect(insertSpy).not.toHaveBeenCalled();
  });

  test("the call waits for the recorder, so the entry is written before the write returns", async () => {
    let finished: boolean = false;

    recorder.recordCreate.mockImplementation(async (): Promise<void> => {
      await Promise.resolve();
      finished = true;
    });

    await AuditLogServiceInstance.recordCreate(createData());

    expect(finished).toBe(true);
  });

  test.each(RECORD_ENTRY_POINTS)(
    "$name never fails the audited write when the recorder rejects",
    async (entryPoint: EntryPoint) => {
      recorder[entryPoint.name].mockImplementation(async (): Promise<void> => {
        throw new Error("clickhouse unavailable");
      });

      await expect(
        entryPoint.call(AuditLogServiceInstance),
      ).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    },
  );

  test("invalidateProjectSettings never throws when the recorder does", () => {
    recorder.invalidateProjectSettings.mockImplementation((): void => {
      throw new Error("cache unavailable");
    });

    expect(() => {
      AuditLogServiceInstance.invalidateProjectSettings(PROJECT_ID);
    }).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("the recorder is looked up on every call", () => {
  test("installing, then removing, the enterprise module takes effect at once", async () => {
    await AuditLogServiceInstance.recordCreate(createData());

    const recorder: MockedAuditLogRecorder = createAuditLogRecorderSpy();
    installFakeEnterpriseModule({ auditLogRecorder: recorder });

    await AuditLogServiceInstance.recordCreate(createData());
    expect(recorder.recordCreate).toHaveBeenCalledTimes(1);

    uninstallEnterpriseModule();

    await AuditLogServiceInstance.recordCreate(createData());
    expect(recorder.recordCreate).toHaveBeenCalledTimes(1);
    expect(insertSpy).not.toHaveBeenCalled();
  });

  test("an enterprise module that has no recorder records nothing", async () => {
    installFakeEnterpriseModule({ auditLogRecorder: null });

    for (const entryPoint of RECORD_ENTRY_POINTS) {
      await expect(
        entryPoint.call(AuditLogServiceInstance),
      ).resolves.toBeUndefined();
    }

    expect(() => {
      AuditLogServiceInstance.invalidateProjectSettings(PROJECT_ID);
    }).not.toThrow();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  test("an enterprise module that fails to hand over its recorder records nothing, and the write still succeeds", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule();

    jest.spyOn(fake, "getAuditLogRecorder").mockImplementation(() => {
      throw new Error("recorder unavailable");
    });
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    for (const entryPoint of RECORD_ENTRY_POINTS) {
      await expect(
        entryPoint.call(AuditLogServiceInstance),
      ).resolves.toBeUndefined();
    }

    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("what core's AuditLogService still is", () => {
  test("the audit log's analytics service, so reads, retention and migrations stay core", () => {
    expect(AuditLogServiceInstance).toBeInstanceOf(AuditLogService);
    expect(typeof AuditLogServiceInstance.create).toBe("function");
    expect(typeof AuditLogServiceInstance.findBy).toBe("function");
  });

  test("it carries none of the recording logic, which is Enterprise code", () => {
    const methods: Array<string> = Object.getOwnPropertyNames(
      AuditLogService.prototype,
    );

    for (const recordingHelper of [
      "insert",
      "isEligible",
      "getProjectSettings",
      "buildSnapshotChanges",
      "buildUpdateDiff",
      "getRedactedFields",
      "addRelationNames",
      "resolveActor",
    ]) {
      expect(methods).not.toContain(recordingHelper);
    }

    for (const entryPoint of [
      "recordCreate",
      "recordUpdate",
      "recordDelete",
      "recordDownload",
      "recordSessionEvents",
      "recordSignInFailures",
      "recordSignInSettingsCleared",
      "recordStatusPageSessionEvents",
      "invalidateProjectSettings",
    ]) {
      expect(methods).toContain(entryPoint);
    }
  });
});

/*
 * The audit trail cannot be forged. Entries are written only by the
 * Enterprise recorder, as root. The model grants create to nobody (a project
 * owner or admin used to be able to POST /audit-log), and AuditLogService
 * refuses every create that is not root, master admins' included.
 */
const auditEntry: () => AuditLog = (): AuditLog => {
  const entry: AuditLog = new AuditLog();
  entry.projectId = PROJECT_ID;
  entry.resourceType = "Monitor";
  entry.resourceId = MONITOR_ID;
  entry.action = "Delete";
  entry.changes = [];
  return entry;
};

const projectMemberProps: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: PROPS.userId,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        _type: "UserTenantAccessPermission",
        permissions: permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
      } as UserTenantAccessPermission,
    },
  };
};

const NON_ROOT_CALLERS: Array<[string, DatabaseCommonInteractionProps]> = [
  ["a Project Owner", projectMemberProps([Permission.ProjectOwner])],
  ["a Project Admin", projectMemberProps([Permission.ProjectAdmin])],
  [
    "a master admin",
    {
      userId: PROPS.userId,
      userType: UserType.MasterAdmin,
      isMasterAdmin: true,
    },
  ],
  [
    "an API key",
    {
      userType: UserType.API,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: projectMemberProps([Permission.ProjectOwner])
        .userTenantAccessPermission!,
    },
  ],
  ["a caller with no identity", {}],
  [
    "a Project Admin skipping hooks",
    {
      ...projectMemberProps([Permission.ProjectAdmin]),
      ignoreHooks: true,
    },
  ],
];

describe("nobody but root creates audit log entries", () => {
  let analyticsCreateMany: jest.SpyInstance;

  beforeEach(() => {
    // The real create path here; the ClickHouse insert underneath is stubbed.
    insertSpy.mockRestore();
    analyticsCreateMany = jest
      .spyOn(AnalyticsDatabaseService.prototype, "createMany")
      .mockImplementation((async (createBy: { items: Array<AuditLog> }) => {
        return createBy.items;
      }) as never);
  });

  test.each(NON_ROOT_CALLERS)(
    "%s cannot create one",
    async (_caller: string, props: DatabaseCommonInteractionProps) => {
      await expect(
        AuditLogServiceInstance.create({ data: auditEntry(), props }),
      ).rejects.toThrow(
        new NotAuthorizedException(AUDIT_LOG_CREATE_REFUSED_MESSAGE),
      );
      await expect(
        AuditLogServiceInstance.createMany({ items: [auditEntry()], props }),
      ).rejects.toThrow(NotAuthorizedException);

      expect(analyticsCreateMany).not.toHaveBeenCalled();
    },
  );

  test("a root create - the recorder's - goes through", async () => {
    const entry: AuditLog = auditEntry();

    await expect(
      AuditLogServiceInstance.create({ data: entry, props: { isRoot: true } }),
    ).resolves.toBe(entry);

    expect(analyticsCreateMany).toHaveBeenCalledTimes(1);
    expect(analyticsCreateMany.mock.calls[0]![0]).toEqual({
      items: [entry],
      props: { isRoot: true },
    });
  });

  test("a root create that skips hooks goes through too", async () => {
    await expect(
      AuditLogServiceInstance.createMany({
        items: [auditEntry(), auditEntry()],
        props: { isRoot: true, ignoreHooks: true },
      }),
    ).resolves.toHaveLength(2);
  });

  test("a fresh instance refuses the same way", async () => {
    await expect(
      new AuditLogService().create({
        data: auditEntry(),
        props: projectMemberProps([Permission.ProjectAdmin]),
      }),
    ).rejects.toThrow(NotAuthorizedException);
  });
});

describe("the AuditLog model grants create to nobody", () => {
  test("no create permission at table level", () => {
    const model: AuditLog = new AuditLog();

    expect(model.getCreatePermissions()).toEqual([]);
    expect(model.getUpdatePermissions()).toEqual([]);
    expect(model.getDeletePermissions()).toEqual([]);
  });

  test("no create permission on any column", () => {
    const columns: Array<AnalyticsTableColumn> = new AuditLog().tableColumns;

    expect(columns.length).toBeGreaterThan(10);

    const creatable: Array<string> = columns
      .filter((column: AnalyticsTableColumn): boolean => {
        return (column.accessControl?.create || []).length > 0;
      })
      .map((column: AnalyticsTableColumn): string => {
        return column.key;
      });

    expect(creatable).toEqual([]);
  });

  // Reading the trail is unchanged.
  test("owners, admins, settings admins and audit readers can still read it", () => {
    expect(new AuditLog().getReadPermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SettingsAdmin,
      Permission.ReadAuditLog,
    ]);
  });

  /*
   * The permission layer on its own turns a project owner or admin away,
   * before AuditLogService is even reached.
   */
  test.each([
    ["a Project Owner", Permission.ProjectOwner],
    ["a Project Admin", Permission.ProjectAdmin],
  ])(
    "the analytics create check refuses %s",
    (_caller: string, permission: Permission) => {
      expect(() => {
        ModelPermission.checkCreatePermissions(
          AuditLog,
          auditEntry(),
          projectMemberProps([permission]),
        );
      }).toThrow(NotAuthorizedException);
    },
  );
});
