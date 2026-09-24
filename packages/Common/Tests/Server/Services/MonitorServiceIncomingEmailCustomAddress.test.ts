/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService (which every concrete service, including
 * MonitorService, extends) imports it. Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

/*
 * The inbound domain comes from the environment. Pinned, so the messages and
 * the "whole address" normalization are deterministic.
 */
jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    InboundEmailDomain: "inbound.example.com",
    IsBillingEnabled: false,
  };
});

import MonitorService from "../../../Server/Services/MonitorService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * MonitorService.onBeforeUpdate guards writes to
 * Monitor.incomingEmailCustomLocalPart -- the custom name of an Incoming Email
 * monitor's inbound address. These tests pin its contract without a database:
 *
 *   - the stored value is always the normalized bare name (trimmed,
 *     lowercased, "@inbound-domain" stripped);
 *   - null / "" clears the name, which puts the generated address back;
 *   - malformed and reserved names are refused before any query;
 *   - one address cannot be given to two monitors, or to a non-email monitor;
 *   - a name another monitor holds -- in ANY project, because every project
 *     shares the inbound domain -- is refused with a readable message, while
 *     re-saving a monitor's own name is fine.
 */

// The house workaround for @jest/globals vs @types/jest spy typing.
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

const PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

type MakeMonitorRow = (input: {
  id: ObjectID;
  monitorType?: MonitorType | undefined;
}) => Monitor;

const makeMonitorRow: MakeMonitorRow = (input: {
  id: ObjectID;
  monitorType?: MonitorType | undefined;
}): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.id = input.id;
  if (input.monitorType) {
    monitor.monitorType = input.monitorType;
  }
  return monitor;
};

type FindByArgs = {
  query: Record<string, unknown>;
  props: Record<string, unknown>;
  limit?: unknown;
};

/*
 * The hook runs two lookups: the monitors the update targets (query carries
 * _id), then the monitors already holding the name (query carries
 * incomingEmailCustomLocalPart). The mock answers each from its own list.
 */
let targetRows: Array<Monitor> = [];
let holderRows: Array<Monitor> = [];
let findBySpy: SpyLike;

const findByCalls: () => Array<FindByArgs> = (): Array<FindByArgs> => {
  return findBySpy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as FindByArgs;
  });
};

type RunHook = (input: {
  data: Record<string, unknown>;
  isRoot?: boolean | undefined;
  query?: Record<string, unknown> | undefined;
}) => Promise<OnUpdate<Monitor>>;

const runHook: RunHook = (input: {
  data: Record<string, unknown>;
  isRoot?: boolean | undefined;
  query?: Record<string, unknown> | undefined;
}): Promise<OnUpdate<Monitor>> => {
  const updateBy: UpdateBy<Monitor> = {
    query: (input.query || { _id: MONITOR_ID.toString() }) as never,
    data: input.data as never,
    limit: 1,
    skip: 0,
    props: input.isRoot
      ? { isRoot: true }
      : {
          tenantId: PROJECT_ID,
          userId: new ObjectID("33333333-3333-4333-8333-333333333333"),
        },
  };

  return (
    MonitorService as unknown as {
      onBeforeUpdate: (u: UpdateBy<Monitor>) => Promise<OnUpdate<Monitor>>;
    }
  ).onBeforeUpdate(updateBy);
};

const storedValue: (result: OnUpdate<Monitor>) => unknown = (
  result: OnUpdate<Monitor>,
): unknown => {
  return (result.updateBy.data as unknown as Record<string, unknown>)[
    "incomingEmailCustomLocalPart"
  ];
};

beforeEach(() => {
  targetRows = [
    makeMonitorRow({ id: MONITOR_ID, monitorType: MonitorType.IncomingEmail }),
  ];
  holderRows = [];

  findBySpy = jest
    .spyOn(
      DatabaseService.prototype as unknown as {
        findBy: (args: FindByArgs) => Promise<Array<DatabaseBaseModel>>;
      },
      "findBy",
    )
    .mockImplementation((args: FindByArgs) => {
      if ("incomingEmailCustomLocalPart" in args.query) {
        return Promise.resolve(holderRows);
      }

      return Promise.resolve(targetRows);
    }) as unknown as SpyLike;
});

afterEach(() => {
  findBySpy.mockRestore();
});

describe("normalizing the custom name", () => {
  test("stores a valid name as given", async () => {
    const result: OnUpdate<Monitor> = await runHook({
      data: { incomingEmailCustomLocalPart: "nightly-backups" },
    });

    expect(storedValue(result)).toBe("nightly-backups");
  });

  test("trims and lowercases what the user typed", async () => {
    const result: OnUpdate<Monitor> = await runHook({
      data: { incomingEmailCustomLocalPart: "  Nightly-Backups " },
    });

    expect(storedValue(result)).toBe("nightly-backups");
  });

  test("strips the inbound domain when the whole address is pasted", async () => {
    const result: OnUpdate<Monitor> = await runHook({
      data: {
        incomingEmailCustomLocalPart: "Nightly-Backups@Inbound.Example.com",
      },
    });

    expect(storedValue(result)).toBe("nightly-backups");
  });

  test("checks uniqueness against the normalized name, not the raw input", async () => {
    await runHook({
      data: { incomingEmailCustomLocalPart: "Nightly-Backups" },
    });

    const holderLookup: FindByArgs | undefined = findByCalls().find(
      (args: FindByArgs) => {
        return "incomingEmailCustomLocalPart" in args.query;
      },
    );

    expect(holderLookup?.query["incomingEmailCustomLocalPart"]).toBe(
      "nightly-backups",
    );
  });
});

describe("clearing the custom name", () => {
  test.each([null, ""])(
    "%p clears it to null without any lookup",
    async (value: string | null) => {
      const result: OnUpdate<Monitor> = await runHook({
        data: { incomingEmailCustomLocalPart: value },
      });

      expect(storedValue(result)).toBeNull();
      expect(findBySpy.mock.calls).toHaveLength(0);
    },
  );

  test("clearing works together with a new secret key (the reset write)", async () => {
    const newKey: string = "5ec2e7a1-9b3c-4d2e-8f10-7a6b5c4d3e2f";

    const result: OnUpdate<Monitor> = await runHook({
      data: {
        incomingEmailSecretKey: newKey,
        incomingEmailCustomLocalPart: null,
      },
    });

    const data: Record<string, unknown> = result.updateBy
      .data as unknown as Record<string, unknown>;

    expect(data["incomingEmailCustomLocalPart"]).toBeNull();
    expect(data["incomingEmailSecretKey"]).toBe(newKey);
  });
});

describe("refusing names that can never be used", () => {
  test.each([
    ["ab", "at least 3 characters"],
    ["a".repeat(65), "cannot be longer than 64 characters"],
    ["night backups", "can only contain lowercase letters"],
    ["backups+prod", "can only contain lowercase letters"],
    ["-backups", "can only contain lowercase letters"],
    ["nightly..backups", "two dots in a row"],
    ["postmaster", "is reserved"],
    ["admin", "is reserved"],
    [
      "monitor-b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba",
      "reserved for generated addresses",
    ],
    ["backups@acme.com", "must use the inbound email domain"],
  ])(
    "%p is refused (%s) before any query",
    async (value: string, message: string) => {
      await expect(
        runHook({ data: { incomingEmailCustomLocalPart: value } }),
      ).rejects.toThrow(message);

      expect(findBySpy.mock.calls).toHaveLength(0);
    },
  );

  test.each([42, true, { name: "backups" }, ["backups"]])(
    "a non-string value (%p) is refused",
    async (value: unknown) => {
      await expect(
        runHook({ data: { incomingEmailCustomLocalPart: value } }),
      ).rejects.toThrow("Incoming email custom address must be a string.");
    },
  );

  test("errors are BadDataExceptions, which the API returns as a 400", async () => {
    await expect(
      runHook({ data: { incomingEmailCustomLocalPart: "no" } }),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("which monitors may take a custom name", () => {
  test("refuses a write that would give one address to several monitors", async () => {
    targetRows = [
      makeMonitorRow({
        id: MONITOR_ID,
        monitorType: MonitorType.IncomingEmail,
      }),
      makeMonitorRow({
        id: OTHER_MONITOR_ID,
        monitorType: MonitorType.IncomingEmail,
      }),
    ];

    await expect(
      runHook({
        data: { incomingEmailCustomLocalPart: "nightly-backups" },
        query: { projectId: PROJECT_ID },
      }),
    ).rejects.toThrow(
      "A custom email address can only be set on one monitor at a time.",
    );
  });

  test.each([
    MonitorType.API,
    MonitorType.Website,
    MonitorType.IncomingRequest,
    MonitorType.Server,
    MonitorType.Manual,
  ])("refuses a %s monitor", async (monitorType: MonitorType) => {
    targetRows = [makeMonitorRow({ id: MONITOR_ID, monitorType: monitorType })];

    await expect(
      runHook({ data: { incomingEmailCustomLocalPart: "nightly-backups" } }),
    ).rejects.toThrow(
      "Custom email addresses can only be set on Incoming Email monitors.",
    );
  });

  test("an update that matches no monitor passes through (it writes nothing)", async () => {
    targetRows = [];

    const result: OnUpdate<Monitor> = await runHook({
      data: { incomingEmailCustomLocalPart: "nightly-backups" },
    });

    expect(storedValue(result)).toBe("nightly-backups");
    // No target, so no uniqueness lookup either.
    expect(findByCalls()).toHaveLength(1);
  });

  test("scopes the target lookup to the caller's project", async () => {
    await runHook({
      data: { incomingEmailCustomLocalPart: "nightly-backups" },
    });

    const targetLookup: FindByArgs = findByCalls()[0]!;

    expect(targetLookup.query["_id"]).toBe(MONITOR_ID.toString());
    expect(String(targetLookup.query["projectId"])).toBe(PROJECT_ID.toString());
    expect(targetLookup.props["isRoot"]).toBe(true);
  });

  test("a root update is not project-scoped", async () => {
    await runHook({
      data: { incomingEmailCustomLocalPart: "nightly-backups" },
      isRoot: true,
    });

    expect(findByCalls()[0]!.query["projectId"]).toBeUndefined();
  });
});

describe("uniqueness across every monitor", () => {
  test("refuses a name another monitor already uses, naming the address", async () => {
    holderRows = [makeMonitorRow({ id: OTHER_MONITOR_ID })];

    await expect(
      runHook({ data: { incomingEmailCustomLocalPart: "nightly-backups" } }),
    ).rejects.toThrow(
      "The email address nightly-backups@inbound.example.com is already used by another monitor. Please choose a different name.",
    );
  });

  test("the holder lookup is global: root, and not limited to this project", async () => {
    /*
     * Every project receives mail on the same inbound domain, so a name taken
     * in someone else's project is just as taken.
     */
    await runHook({
      data: { incomingEmailCustomLocalPart: "nightly-backups" },
    });

    const holderLookup: FindByArgs = findByCalls()[1]!;

    expect(holderLookup.query).toEqual({
      incomingEmailCustomLocalPart: "nightly-backups",
    });
    expect(holderLookup.props["isRoot"]).toBe(true);
  });

  test("re-saving the name this monitor already has is fine", async () => {
    holderRows = [makeMonitorRow({ id: MONITOR_ID })];

    const result: OnUpdate<Monitor> = await runHook({
      data: { incomingEmailCustomLocalPart: "nightly-backups" },
    });

    expect(storedValue(result)).toBe("nightly-backups");
  });

  test("a free name is accepted", async () => {
    holderRows = [];

    const result: OnUpdate<Monitor> = await runHook({
      data: { incomingEmailCustomLocalPart: "nightly-backups" },
    });

    expect(storedValue(result)).toBe("nightly-backups");
  });
});

describe("updates that do not touch the custom name", () => {
  test("run no custom-address lookups", async () => {
    await runHook({ data: { name: "Nightly backups" } });

    expect(findBySpy.mock.calls).toHaveLength(0);
  });

  test("rotating only the secret key leaves the custom name alone", async () => {
    const result: OnUpdate<Monitor> = await runHook({
      data: { incomingEmailSecretKey: "5ec2e7a1-9b3c-4d2e-8f10-7a6b5c4d3e2f" },
    });

    expect(
      "incomingEmailCustomLocalPart" in
        (result.updateBy.data as unknown as Record<string, unknown>),
    ).toBe(false);
    expect(findBySpy.mock.calls).toHaveLength(0);
  });
});
