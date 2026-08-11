/*
 * PasswordHash fails to COMPILE under ts-jest (TS 5.9 + @types/node Buffer
 * mismatch) and DatabaseService (which every concrete service, including
 * MonitorService, extends) imports it. Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../../Server/Utils/PasswordHash", () => {
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

import MonitorDependencySuppression, {
  DependencySuppressionResult,
  ParentMonitorStatusRef,
  SuppressingParent,
} from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorService from "../../../../Server/Services/MonitorService";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import ObjectID from "../../../../Types/ObjectID";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Alert-dependency suppression: when a monitor declares dependsOnMonitors
 * and a parent is currently in a suppressing status, alert/incident
 * creation for the child is skipped for the evaluation. These tests pin
 * the pure decision step (getSuppressingParents), the human-readable
 * reason string shared by the alert and incident skip events, and the
 * query orchestration (getDependencySuppression) — including its
 * zero-query contract for monitors with no dependencies, which sits on
 * the hottest Postgres path in the product.
 */

// The house workaround for @jest/globals vs @types/jest spy typing.
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
};

const PARENT_A_ID: string = "11111111-1111-4111-8111-111111111111";
const PARENT_B_ID: string = "22222222-2222-4222-8222-222222222222";
const PARENT_C_ID: string = "33333333-3333-4333-8333-333333333333";
const STATUS_OFFLINE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STATUS_DEGRADED_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STATUS_OPERATIONAL_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type MakeParentRef = (overrides: {
  monitorId?: string;
  monitorName?: string;
  statusId?: string | undefined;
  statusName?: string | undefined;
  isOfflineState?: boolean;
}) => ParentMonitorStatusRef;

const makeParentRef: MakeParentRef = (overrides: {
  monitorId?: string;
  monitorName?: string;
  statusId?: string | undefined;
  statusName?: string | undefined;
  isOfflineState?: boolean;
}): ParentMonitorStatusRef => {
  return {
    monitorId: overrides.monitorId || PARENT_A_ID,
    monitorName: overrides.monitorName || "Router",
    statusId: overrides.statusId,
    statusName: overrides.statusName,
    isOfflineState: overrides.isOfflineState || false,
  };
};

type MakeStatus = (input: {
  id: string;
  name: string;
  isOfflineState: boolean;
}) => MonitorStatus;

const makeStatus: MakeStatus = (input: {
  id: string;
  name: string;
  isOfflineState: boolean;
}): MonitorStatus => {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(input.id);
  status.name = input.name;
  status.isOfflineState = input.isOfflineState;
  return status;
};

type MakeParentRow = (input: {
  id: string;
  name?: string | undefined;
  currentMonitorStatus?: MonitorStatus | undefined;
}) => Monitor;

const makeParentRow: MakeParentRow = (input: {
  id: string;
  name?: string | undefined;
  currentMonitorStatus?: MonitorStatus | undefined;
}): Monitor => {
  const parent: Monitor = new Monitor();
  parent.id = new ObjectID(input.id);
  if (input.name !== undefined) {
    parent.name = input.name;
  }
  if (input.currentMonitorStatus !== undefined) {
    parent.currentMonitorStatus = input.currentMonitorStatus;
  }
  return parent;
};

// A bare id-only reference, the shape dependsOnMonitors rows arrive in.
type MakeParentStub = (id: string) => Monitor;

const makeParentStub: MakeParentStub = (id: string): Monitor => {
  const stub: Monitor = new Monitor();
  stub.id = new ObjectID(id);
  return stub;
};

describe("MonitorDependencySuppression.getSuppressingParents", () => {
  describe("default rule (no configured statuses): offline parents suppress", () => {
    test("a parent whose current status is flagged offline suppresses", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencySuppression.getSuppressingParents({
          parents: [
            makeParentRef({
              monitorId: PARENT_A_ID,
              monitorName: "Router",
              statusId: STATUS_OFFLINE_ID,
              statusName: "Offline",
              isOfflineState: true,
            }),
          ],
          configuredSuppressionStatusIds: new Set<string>(),
        });

      expect(result).toEqual([
        {
          monitorId: PARENT_A_ID,
          monitorName: "Router",
          statusName: "Offline",
        },
      ]);
    });

    test("a parent in a non-offline status does not suppress", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencySuppression.getSuppressingParents({
          parents: [
            makeParentRef({
              statusId: STATUS_OPERATIONAL_ID,
              statusName: "Operational",
              isOfflineState: false,
            }),
          ],
          configuredSuppressionStatusIds: new Set<string>(),
        });

      expect(result).toEqual([]);
    });

    test("a parent with NO current status never suppresses (a never-evaluated parent must not silence its children)", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencySuppression.getSuppressingParents({
          parents: [
            makeParentRef({
              statusId: undefined,
              statusName: undefined,
              isOfflineState: false,
            }),
          ],
          configuredSuppressionStatusIds: new Set<string>(),
        });

      expect(result).toEqual([]);
    });

    test("a suppressing parent with no status name falls back to 'Offline'", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencySuppression.getSuppressingParents({
          parents: [
            makeParentRef({
              statusId: STATUS_OFFLINE_ID,
              statusName: undefined,
              isOfflineState: true,
            }),
          ],
          configuredSuppressionStatusIds: new Set<string>(),
        });

      expect(result[0]?.statusName).toBe("Offline");
    });
  });

  describe("configured-status rule takes full precedence over the offline flag", () => {
    test("a parent in a configured status suppresses even when the status is not offline (degraded-state use case)", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencySuppression.getSuppressingParents({
          parents: [
            makeParentRef({
              monitorId: PARENT_A_ID,
              monitorName: "Upstream API",
              statusId: STATUS_DEGRADED_ID,
              statusName: "Degraded",
              isOfflineState: false,
            }),
          ],
          configuredSuppressionStatusIds: new Set<string>([STATUS_DEGRADED_ID]),
        });

      expect(result).toEqual([
        {
          monitorId: PARENT_A_ID,
          monitorName: "Upstream API",
          statusName: "Degraded",
        },
      ]);
    });

    test("an OFFLINE parent whose status is NOT in the configured set does not suppress", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencySuppression.getSuppressingParents({
          parents: [
            makeParentRef({
              statusId: STATUS_OFFLINE_ID,
              statusName: "Offline",
              isOfflineState: true,
            }),
          ],
          configuredSuppressionStatusIds: new Set<string>([STATUS_DEGRADED_ID]),
        });

      expect(result).toEqual([]);
    });

    test("a parent with no current status does not suppress under a configured list either", () => {
      const result: Array<SuppressingParent> =
        MonitorDependencySuppression.getSuppressingParents({
          parents: [
            makeParentRef({
              statusId: undefined,
              statusName: undefined,
              isOfflineState: false,
            }),
          ],
          configuredSuppressionStatusIds: new Set<string>([STATUS_DEGRADED_ID]),
        });

      expect(result).toEqual([]);
    });
  });

  test("multiple parents: every matching parent is returned, in input order", () => {
    const result: Array<SuppressingParent> =
      MonitorDependencySuppression.getSuppressingParents({
        parents: [
          makeParentRef({
            monitorId: PARENT_A_ID,
            monitorName: "Router",
            statusId: STATUS_OFFLINE_ID,
            statusName: "Offline",
            isOfflineState: true,
          }),
          makeParentRef({
            monitorId: PARENT_B_ID,
            monitorName: "Load Balancer",
            statusId: STATUS_OPERATIONAL_ID,
            statusName: "Operational",
            isOfflineState: false,
          }),
          makeParentRef({
            monitorId: PARENT_C_ID,
            monitorName: "Database",
            statusId: STATUS_OFFLINE_ID,
            statusName: "Offline",
            isOfflineState: true,
          }),
        ],
        configuredSuppressionStatusIds: new Set<string>(),
      });

    expect(result).toEqual([
      {
        monitorId: PARENT_A_ID,
        monitorName: "Router",
        statusName: "Offline",
      },
      {
        monitorId: PARENT_C_ID,
        monitorName: "Database",
        statusName: "Offline",
      },
    ]);
  });

  test("no parents yields no suppression", () => {
    expect(
      MonitorDependencySuppression.getSuppressingParents({
        parents: [],
        configuredSuppressionStatusIds: new Set<string>(),
      }),
    ).toEqual([]);
  });
});

describe("MonitorDependencySuppression.buildSuppressionReason", () => {
  test("single parent: singular phrasing with quoted name and status", () => {
    expect(
      MonitorDependencySuppression.buildSuppressionReason([
        {
          monitorId: PARENT_A_ID,
          monitorName: "Router",
          statusName: "Offline",
        },
      ]),
    ).toBe('parent monitor "Router" is Offline');
  });

  test("multiple parents: plural phrasing, comma-joined, in order", () => {
    expect(
      MonitorDependencySuppression.buildSuppressionReason([
        {
          monitorId: PARENT_A_ID,
          monitorName: "Router",
          statusName: "Offline",
        },
        {
          monitorId: PARENT_B_ID,
          monitorName: "Upstream API",
          statusName: "Degraded",
        },
      ]),
    ).toBe('parent monitors "Router" is Offline, "Upstream API" is Degraded');
  });
});

describe("MonitorDependencySuppression.getDependencySuppression", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function spyOnFindBy(rows: Array<Monitor>): SpyLike {
    return jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue(rows as never) as unknown as SpyLike;
  }

  describe("zero-query contract for monitors without dependencies", () => {
    test("dependsOnMonitors undefined: not suppressed and findBy is NEVER called", async () => {
      const findBySpy: SpyLike = spyOnFindBy([]);

      const monitor: Monitor = new Monitor();
      monitor.id = ObjectID.generate();

      const result: DependencySuppressionResult =
        await MonitorDependencySuppression.getDependencySuppression({
          monitor,
        });

      expect(result).toEqual({ isSuppressed: false, suppressingParents: [] });
      expect(findBySpy.mock.calls.length).toBe(0);
    });

    test("dependsOnMonitors empty array: not suppressed and findBy is NEVER called", async () => {
      const findBySpy: SpyLike = spyOnFindBy([]);

      const monitor: Monitor = new Monitor();
      monitor.id = ObjectID.generate();
      monitor.dependsOnMonitors = [];

      const result: DependencySuppressionResult =
        await MonitorDependencySuppression.getDependencySuppression({
          monitor,
        });

      expect(result).toEqual({ isSuppressed: false, suppressingParents: [] });
      expect(findBySpy.mock.calls.length).toBe(0);
    });

    test("dependency entries without any id are dropped and cause no query", async () => {
      const findBySpy: SpyLike = spyOnFindBy([]);

      const monitor: Monitor = new Monitor();
      monitor.id = ObjectID.generate();
      monitor.dependsOnMonitors = [new Monitor()];

      const result: DependencySuppressionResult =
        await MonitorDependencySuppression.getDependencySuppression({
          monitor,
        });

      expect(result).toEqual({ isSuppressed: false, suppressingParents: [] });
      expect(findBySpy.mock.calls.length).toBe(0);
    });
  });

  test("monitor with parents: exactly one findBy, selecting the parents' current status", async () => {
    const findBySpy: SpyLike = spyOnFindBy([
      makeParentRow({
        id: PARENT_A_ID,
        name: "Router",
        currentMonitorStatus: makeStatus({
          id: STATUS_OPERATIONAL_ID,
          name: "Operational",
          isOfflineState: false,
        }),
      }),
    ]);

    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.dependsOnMonitors = [makeParentStub(PARENT_A_ID)];

    const result: DependencySuppressionResult =
      await MonitorDependencySuppression.getDependencySuppression({ monitor });

    expect(result).toEqual({ isSuppressed: false, suppressingParents: [] });
    expect(findBySpy.mock.calls.length).toBe(1);

    /*
     * The query arg is asserted loosely (QueryHelper.any wraps the ids) but
     * the select is the exact per-parent status shape the pure step needs.
     */
    const callArg: {
      select: Record<string, unknown>;
      limit: number;
      skip: number;
      props: { isRoot: boolean };
    } = findBySpy.mock.calls[0]![0] as {
      select: Record<string, unknown>;
      limit: number;
      skip: number;
      props: { isRoot: boolean };
    };

    expect(callArg.select).toEqual({
      _id: true,
      name: true,
      currentMonitorStatus: {
        _id: true,
        name: true,
        isOfflineState: true,
      },
    });
    expect(callArg.limit).toBe(LIMIT_PER_PROJECT);
    expect(callArg.skip).toBe(0);
    expect(callArg.props).toEqual({ isRoot: true });
  });

  test("an offline parent suppresses; siblings in healthy or unknown status do not", async () => {
    spyOnFindBy([
      makeParentRow({
        id: PARENT_A_ID,
        name: "Router",
        currentMonitorStatus: makeStatus({
          id: STATUS_OFFLINE_ID,
          name: "Offline",
          isOfflineState: true,
        }),
      }),
      makeParentRow({
        id: PARENT_B_ID,
        name: "Load Balancer",
        currentMonitorStatus: makeStatus({
          id: STATUS_OPERATIONAL_ID,
          name: "Operational",
          isOfflineState: false,
        }),
      }),
      // Never evaluated: no current status at all.
      makeParentRow({ id: PARENT_C_ID, name: "Database" }),
    ]);

    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.dependsOnMonitors = [
      makeParentStub(PARENT_A_ID),
      makeParentStub(PARENT_B_ID),
      makeParentStub(PARENT_C_ID),
    ];

    const result: DependencySuppressionResult =
      await MonitorDependencySuppression.getDependencySuppression({ monitor });

    expect(result.isSuppressed).toBe(true);
    expect(result.suppressingParents).toEqual([
      {
        monitorId: PARENT_A_ID,
        monitorName: "Router",
        statusName: "Offline",
      },
    ]);
  });

  test("configured suppression statuses are respected end-to-end: degraded (configured) suppresses, offline (unconfigured) does not", async () => {
    spyOnFindBy([
      makeParentRow({
        id: PARENT_A_ID,
        name: "Upstream API",
        currentMonitorStatus: makeStatus({
          id: STATUS_DEGRADED_ID,
          name: "Degraded",
          isOfflineState: false,
        }),
      }),
      makeParentRow({
        id: PARENT_B_ID,
        name: "Router",
        currentMonitorStatus: makeStatus({
          id: STATUS_OFFLINE_ID,
          name: "Offline",
          isOfflineState: true,
        }),
      }),
    ]);

    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.dependsOnMonitors = [
      makeParentStub(PARENT_A_ID),
      makeParentStub(PARENT_B_ID),
    ];
    monitor.suppressAlertsWhenParentMonitorStatuses = [
      makeStatus({
        id: STATUS_DEGRADED_ID,
        name: "Degraded",
        isOfflineState: false,
      }),
    ];

    const result: DependencySuppressionResult =
      await MonitorDependencySuppression.getDependencySuppression({ monitor });

    expect(result.isSuppressed).toBe(true);
    expect(result.suppressingParents).toEqual([
      {
        monitorId: PARENT_A_ID,
        monitorName: "Upstream API",
        statusName: "Degraded",
      },
    ]);
  });

  test("a nameless suppressing parent is reported as 'Unnamed monitor'", async () => {
    spyOnFindBy([
      makeParentRow({
        id: PARENT_A_ID,
        currentMonitorStatus: makeStatus({
          id: STATUS_OFFLINE_ID,
          name: "Offline",
          isOfflineState: true,
        }),
      }),
    ]);

    const monitor: Monitor = new Monitor();
    monitor.id = ObjectID.generate();
    monitor.dependsOnMonitors = [makeParentStub(PARENT_A_ID)];

    const result: DependencySuppressionResult =
      await MonitorDependencySuppression.getDependencySuppression({ monitor });

    expect(result.suppressingParents).toEqual([
      {
        monitorId: PARENT_A_ID,
        monitorName: "Unnamed monitor",
        statusName: "Offline",
      },
    ]);
  });
});
