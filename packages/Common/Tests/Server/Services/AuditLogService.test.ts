import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AuditLogServiceInstance, {
  AuditLogService,
} from "../../../Server/Services/AuditLogService";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import logger from "../../../Server/Utils/Logger";
import AuditLog from "../../../Models/AnalyticsModels/AuditLog";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import FakeEnterpriseModule, {
  createAuditLogRecorderSpy,
  installFakeEnterpriseModule,
  MockedAuditLogRecorder,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";

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

// The four entry points, each driven the way its caller drives it.
type EntryPoint = {
  name: "recordCreate" | "recordUpdate" | "recordDelete";
  call: (service: AuditLogService) => Promise<void>;
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

  test("invalidateProjectSettings reaches the recorder's cache", () => {
    AuditLogServiceInstance.invalidateProjectSettings(PROJECT_ID);

    expect(recorder.invalidateProjectSettings).toHaveBeenCalledTimes(1);
    expect(recorder.invalidateProjectSettings).toHaveBeenCalledWith(
      PROJECT_ID,
    );
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
      recorder[entryPoint.name].mockImplementation(
        async (): Promise<void> => {
          throw new Error("clickhouse unavailable");
        },
      );

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
      "invalidateProjectSettings",
    ]) {
      expect(methods).toContain(entryPoint);
    }
  });
});
