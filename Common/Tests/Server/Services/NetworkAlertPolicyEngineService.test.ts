/*
 * Contract under test — the Network Alert Policy engine, the ONE place in the
 * product that creates or deletes a policy-owned Monitor.
 *
 * Monitors are billed and they own incident history, so nearly every case
 * here is a case about NOT doing something. The engine is reached from a
 * dozen directions — a device created, re-sited, re-labelled, archived,
 * switched to monitor-backed, handed a probe; a policy saved, enabled,
 * re-scoped, re-pointed, deleted; a five-minute sweep — and each of them
 * ends in `reconcileDevice`, which computes DESIRED against ACTUAL for one
 * device under that device's own Redis lock. What this file pins is the
 * behaviour that would otherwise fail silently and expensively:
 *
 *   - TWO POLICIES ON ONE DEVICE each get their own monitor, and neither
 *     pass touches the other's row. Ownership is the PAIR (policy,
 *     template), not the device.
 *   - A SCOPE THAT SHRINKS deletes only monitors stamped with THAT policy.
 *     A hand-made Network Device monitor on the same device, and an
 *     auto-import rule's, carry no networkAlertPolicyId and are therefore
 *     not even in ACTUAL — the query, not a filter afterwards, is what makes
 *     that true.
 *   - AN UNOWNED (device, template) MONITOR IS ADOPTED, never duplicated.
 *     Monitor's partial unique index on (autoProvisionedNetworkDeviceId,
 *     monitorTemplateId) would refuse the duplicate on this pass and on
 *     every pass after it, so the policy would report a failure forever
 *     beside a perfectly good monitor.
 *   - A DEVICE THAT STOPS BEING PROVISIONABLE — archived, monitor-backed, or
 *     with no probe — loses every policy monitor. A monitor-backed device's
 *     health is a bound monitor's; a Network Device monitor on it is billed
 *     for a poll that will never happen.
 *   - A DISABLED POLICY PAUSES its monitors instead of deleting them, and
 *     enabling reverses it. Deleting would lose the incident history and
 *     re-bill the fleet on the way back.
 *   - THE PLAN IS ASKED ONCE PER RUN and the run stops at the first refusal,
 *     so a project that cannot hold another monitor gets one sentence in
 *     lastSyncError rather than five hundred identical failures.
 *   - THE LOCK is per device, taken before anything is read, released even
 *     when the body throws, and a lock somebody else holds means this pass
 *     does nothing at all.
 *
 * The collaborating singleton services — and the Semaphore module, which
 * would otherwise reach Redis — are stubbed at the MODULE level before the
 * engine is imported: their real files reach Postgres through
 * DatabaseService, and nothing here should touch any of it.
 *
 * MonitorService.findBy and NetworkDeviceService.findBy are backed by small
 * in-memory tables rather than by call-order mocks, because the engine asks
 * them several different questions per pass and a `mockResolvedValueOnce`
 * chain would pass for the wrong reason the moment the query order changed.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: true,
    AllowedActiveMonitorCountInFreePlan: 10,
  };
});

jest.mock("../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      countBy: jest.fn(),
      deleteBy: jest.fn(),
      updateBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/MonitorTemplateService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/NetworkAlertPolicyService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/NetworkDeviceService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import NetworkAlertPolicyEngineService, {
  MAX_MONITORS_PER_POLICY_SYNC,
  POLICY_DEVICE_LOCK_NAMESPACE,
  PolicyRunContext,
  policyDeviceLockKey,
} from "../../../Server/Services/NetworkAlertPolicyEngineService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorTemplateService from "../../../Server/Services/MonitorTemplateService";
import NetworkAlertPolicyService from "../../../Server/Services/NetworkAlertPolicyService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import ProjectService from "../../../Server/Services/ProjectService";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkAlertPolicy from "../../../Models/DatabaseModels/NetworkAlertPolicy";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import FindBy from "../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NetworkDeviceMonitoringMethod from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import NetworkAlertPolicyScope from "../../../Types/NetworkDevice/NetworkAlertPolicyScope";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_DEVICE_ID: ObjectID = new ObjectID(
  "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b",
);
const POLICY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OTHER_POLICY_ID: ObjectID = new ObjectID(
  "3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_TEMPLATE_ID: ObjectID = new ObjectID(
  "4b4b4b4b-4b4b-4b4b-8b4b-4b4b4b4b4b4b",
);
const PROBE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const SITE_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const OTHER_SITE_ID: ObjectID = new ObjectID(
  "6b6b6b6b-6b6b-4b6b-8b6b-6b6b6b6b6b6b",
);
const LABEL_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");

// What the mocked Semaphore.lock hands back and release must get back.
const FAKE_MUTEX: { id: string } = { id: "fake-device-mutex" };

const monitorCreateMock: jest.Mock =
  MonitorService.create as unknown as jest.Mock;
const monitorFindByMock: jest.Mock =
  MonitorService.findBy as unknown as jest.Mock;
const monitorFindOneByMock: jest.Mock =
  MonitorService.findOneBy as unknown as jest.Mock;
const monitorCountByMock: jest.Mock =
  MonitorService.countBy as unknown as jest.Mock;
const monitorDeleteByMock: jest.Mock =
  MonitorService.deleteBy as unknown as jest.Mock;
const monitorUpdateByMock: jest.Mock =
  MonitorService.updateBy as unknown as jest.Mock;
const monitorStampMock: jest.Mock =
  MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;
const templateFindOneByMock: jest.Mock =
  MonitorTemplateService.findOneBy as unknown as jest.Mock;
const policyFindByMock: jest.Mock =
  NetworkAlertPolicyService.findBy as unknown as jest.Mock;
const policyFindOneByMock: jest.Mock =
  NetworkAlertPolicyService.findOneBy as unknown as jest.Mock;
const policyStampMock: jest.Mock =
  NetworkAlertPolicyService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;
const deviceFindByMock: jest.Mock =
  NetworkDeviceService.findBy as unknown as jest.Mock;
const deviceFindOneByMock: jest.Mock =
  NetworkDeviceService.findOneBy as unknown as jest.Mock;
const currentPlanMock: jest.Mock =
  ProjectService.getCurrentPlan as unknown as jest.Mock;
const semaphoreLockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;
const semaphoreReleaseMock: jest.Mock =
  Semaphore.release as unknown as jest.Mock;

/*
 * A query value the engine could have written. Understanding the raw
 * operators (rather than only exact values) is what lets the fake tables
 * answer the SAME questions the database would — including the two that
 * carry the whole safety story here, `networkAlertPolicyId IS NOT NULL` and
 * `IS NULL`.
 */
function matchesQueryValue(actual: unknown, expected: unknown): boolean {
  const findOperator: {
    getSql?: (alias: string) => string;
    objectLiteralParameters?: Record<string, unknown>;
  } = expected as {
    getSql?: (alias: string) => string;
    objectLiteralParameters?: Record<string, unknown>;
  };

  if (findOperator && typeof findOperator.getSql === "function") {
    const sql: string = findOperator.getSql("column");
    const parameters: Array<unknown> = Object.values(
      findOperator.objectLiteralParameters || {},
    ).flat();

    if (sql.includes("IS NOT NULL")) {
      return actual !== null && actual !== undefined;
    }

    if (sql.includes("IS NULL")) {
      return actual === null || actual === undefined;
    }

    if (sql.includes("IN (")) {
      return parameters.some((parameter: unknown): boolean => {
        return parameter?.toString() === actual?.toString();
      });
    }

    if (sql.includes(">")) {
      return (
        actual !== null &&
        actual !== undefined &&
        String(actual) > String(parameters[0])
      );
    }

    throw new Error(`Unhandled query operator in test matcher: ${sql}`);
  }

  if (expected === null || expected === undefined) {
    return actual === null || actual === undefined;
  }

  if (typeof expected === "boolean") {
    return Boolean(actual) === expected;
  }

  return actual?.toString() === expected.toString();
}

function matchesQuery(
  row: Record<string, unknown>,
  query: Record<string, unknown>,
): boolean {
  for (const [column, expected] of Object.entries(query)) {
    if (column === "labels") {
      /*
       * The many-to-many spelling: `labels: [id, id]` is "carries any of
       * these labels", which is exactly what the scope means by a label list.
       */
      const wanted: Array<unknown> = expected as Array<unknown>;
      const carried: Array<Label> = (row["labels"] as Array<Label>) || [];

      const hasAny: boolean = carried.some((label: Label): boolean => {
        return wanted.some((id: unknown): boolean => {
          return id?.toString() === label.id?.toString();
        });
      });

      if (!hasAny) {
        return false;
      }

      continue;
    }

    const actual: unknown = column === "_id" ? row["_id"] : row[column];

    if (!matchesQueryValue(actual, expected)) {
      return false;
    }
  }

  return true;
}

// The fake tables. Rebuilt per test.
let monitorTable: Array<Monitor> = [];
let deviceTable: Array<NetworkDevice> = [];
let policyTable: Array<NetworkAlertPolicy> = [];

function sortAndPage<TRow extends { _id?: string }>(
  rows: Array<TRow>,
  findBy: FindBy<never>,
): Array<TRow> {
  const sorted: Array<TRow> = [...rows].sort(
    (left: TRow, right: TRow): number => {
      return (left._id || "").localeCompare(right._id || "");
    },
  );

  const limit: number =
    typeof findBy.limit === "number" ? findBy.limit : sorted.length;

  return sorted.slice(0, limit);
}

function installFakeTables(): void {
  monitorFindByMock.mockImplementation(
    async (findBy: FindBy<Monitor>): Promise<Array<Monitor>> => {
      return sortAndPage(
        monitorTable.filter((monitor: Monitor): boolean => {
          return matchesQuery(
            monitor as unknown as Record<string, unknown>,
            findBy.query as Record<string, unknown>,
          );
        }),
        findBy as unknown as FindBy<never>,
      );
    },
  );

  monitorFindOneByMock.mockImplementation(
    async (findOneBy: FindOneBy<Monitor>): Promise<Monitor | null> => {
      return (
        monitorTable.find((monitor: Monitor): boolean => {
          return matchesQuery(
            monitor as unknown as Record<string, unknown>,
            findOneBy.query as Record<string, unknown>,
          );
        }) || null
      );
    },
  );

  deviceFindByMock.mockImplementation(
    async (findBy: FindBy<NetworkDevice>): Promise<Array<NetworkDevice>> => {
      return sortAndPage(
        deviceTable.filter((device: NetworkDevice): boolean => {
          return matchesQuery(
            device as unknown as Record<string, unknown>,
            findBy.query as Record<string, unknown>,
          );
        }),
        findBy as unknown as FindBy<never>,
      );
    },
  );

  deviceFindOneByMock.mockImplementation(
    async (
      findOneBy: FindOneBy<NetworkDevice>,
    ): Promise<NetworkDevice | null> => {
      return (
        deviceTable.find((device: NetworkDevice): boolean => {
          return matchesQuery(
            device as unknown as Record<string, unknown>,
            findOneBy.query as Record<string, unknown>,
          );
        }) || null
      );
    },
  );

  policyFindByMock.mockImplementation(
    async (
      findBy: FindBy<NetworkAlertPolicy>,
    ): Promise<Array<NetworkAlertPolicy>> => {
      return policyTable.filter((policy: NetworkAlertPolicy): boolean => {
        return matchesQuery(
          policy as unknown as Record<string, unknown>,
          findBy.query as Record<string, unknown>,
        );
      });
    },
  );

  policyFindOneByMock.mockImplementation(
    async (
      findOneBy: FindOneBy<NetworkAlertPolicy>,
    ): Promise<NetworkAlertPolicy | null> => {
      return (
        policyTable.find((policy: NetworkAlertPolicy): boolean => {
          return matchesQuery(
            policy as unknown as Record<string, unknown>,
            findOneBy.query as Record<string, unknown>,
          );
        }) || null
      );
    },
  );

  /*
   * Writes land back in the fake tables so a second pass in the same test
   * sees what the first one did — which is the only way to assert that
   * reconciliation is idempotent.
   */
  monitorCreateMock.mockImplementation(
    async (createBy: { data: Monitor }): Promise<Monitor> => {
      const monitor: Monitor = createBy.data;
      monitor.id = ObjectID.generate();
      monitorTable.push(monitor);

      return monitor;
    },
  );

  monitorDeleteByMock.mockImplementation(
    async (deleteBy: { query: Record<string, unknown> }): Promise<number> => {
      const remaining: Array<Monitor> = monitorTable.filter(
        (monitor: Monitor): boolean => {
          return !matchesQuery(
            monitor as unknown as Record<string, unknown>,
            deleteBy.query,
          );
        },
      );

      const deleted: number = monitorTable.length - remaining.length;
      monitorTable = remaining;

      return deleted;
    },
  );

  monitorUpdateByMock.mockImplementation(
    async (updateBy: {
      query: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<number> => {
      let updated: number = 0;

      for (const monitor of monitorTable) {
        if (
          matchesQuery(
            monitor as unknown as Record<string, unknown>,
            updateBy.query,
          )
        ) {
          Object.assign(monitor, updateBy.data);
          updated++;
        }
      }

      return updated;
    },
  );

  monitorStampMock.mockImplementation(
    async (input: {
      id: ObjectID;
      data: Record<string, unknown>;
    }): Promise<void> => {
      const monitor: Monitor | undefined = monitorTable.find(
        (candidate: Monitor): boolean => {
          return candidate.id?.toString() === input.id.toString();
        },
      );

      if (monitor) {
        Object.assign(monitor, input.data);
      }
    },
  );

  policyStampMock.mockResolvedValue(undefined);
  templateFindOneByMock.mockImplementation(
    async (
      findOneBy: FindOneBy<MonitorTemplate>,
    ): Promise<MonitorTemplate | null> => {
      const queriedId: unknown = (findOneBy.query as Record<string, unknown>)[
        "_id"
      ];

      return queriedId?.toString() === TEMPLATE_ID.toString()
        ? monitorTemplate(TEMPLATE_ID, "Reachability")
        : queriedId?.toString() === OTHER_TEMPLATE_ID.toString()
          ? monitorTemplate(OTHER_TEMPLATE_ID, "Interfaces")
          : null;
    },
  );

  semaphoreLockMock.mockResolvedValue(FAKE_MUTEX);
  semaphoreReleaseMock.mockResolvedValue(undefined);
  currentPlanMock.mockResolvedValue({
    plan: PlanType.Growth,
    isSubscriptionUnpaid: false,
  });
  monitorCountByMock.mockResolvedValue(new PositiveNumber(0));
}

function monitorTemplate(id: ObjectID, name: string): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = id;
  template.projectId = PROJECT_ID;
  template.monitorType = MonitorType.NetworkDevice;
  template.monitorName = name;

  const step: MonitorStep = new MonitorStep();
  step.data!.networkDeviceMonitor = {
    // A design-time placeholder; buildMonitor rebinds it to the real device.
    networkDeviceId: ObjectID.generate().toString(),
    monitorInterfaces: false,
    oids: [],
  };
  template.monitorSteps = new MonitorSteps();
  template.monitorSteps.data = { monitorStepsInstanceArray: [step] };

  return template;
}

function device(
  overrides: Partial<NetworkDevice> = {},
  id: ObjectID = DEVICE_ID,
): NetworkDevice {
  const networkDevice: NetworkDevice = new NetworkDevice();
  networkDevice.id = id;
  networkDevice.projectId = PROJECT_ID;
  networkDevice.name = "Core switch";
  networkDevice.isArchived = false;
  networkDevice.monitoringMethod = NetworkDeviceMonitoringMethod.Probe;
  networkDevice.probeId = PROBE_ID;
  networkDevice.siteId = SITE_ID;
  Object.assign(networkDevice, overrides);

  return networkDevice;
}

function policy(
  overrides: Partial<NetworkAlertPolicy> = {},
  id: ObjectID = POLICY_ID,
): NetworkAlertPolicy {
  const alertPolicy: NetworkAlertPolicy = new NetworkAlertPolicy();
  alertPolicy.id = id;
  alertPolicy.projectId = PROJECT_ID;
  alertPolicy.name = "Warehouse switches";
  alertPolicy.isEnabled = true;
  alertPolicy.monitorTemplateId = TEMPLATE_ID;
  alertPolicy.scope = {} as NetworkAlertPolicyScope;
  Object.assign(alertPolicy, overrides);

  return alertPolicy;
}

function monitorRow(overrides: Partial<Monitor> = {}): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.NetworkDevice;
  monitor.disableActiveMonitoring = false;
  Object.assign(monitor, overrides);

  return monitor;
}

function labelled(labelId: ObjectID): Array<Label> {
  const label: Label = new Label();
  label.id = labelId;

  return [label];
}

function monitorsOfDevice(deviceId: ObjectID = DEVICE_ID): Array<Monitor> {
  return monitorTable.filter((monitor: Monitor): boolean => {
    return (
      monitor.autoProvisionedNetworkDeviceId?.toString() === deviceId.toString()
    );
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  monitorTable = [];
  deviceTable = [];
  policyTable = [];
  installFakeTables();
});

describe("reconcileDevice provisions what the policies ask for", () => {
  it("creates one monitor for a device an enabled policy covers", async () => {
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorsOfDevice()).toHaveLength(1);
    expect(monitorsOfDevice()[0]!.networkAlertPolicyId?.toString()).toBe(
      POLICY_ID.toString(),
    );
    expect(monitorsOfDevice()[0]!.monitorTemplateId?.toString()).toBe(
      TEMPLATE_ID.toString(),
    );
  });

  /*
   * The stamp goes on the CREATE, not in a follow-up update. A monitor that
   * exists for a moment without its owner is one a concurrent pass of a
   * different policy could adopt.
   */
  it("stamps the owning policy in the same write that creates the monitor", async () => {
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    const created: { data: Monitor } = monitorCreateMock.mock.calls[0]![0] as {
      data: Monitor;
    };

    expect(created.data.networkAlertPolicyId?.toString()).toBe(
      POLICY_ID.toString(),
    );
  });

  it("is idempotent: a second pass over an already-covered device writes nothing", async () => {
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });
    monitorCreateMock.mockClear();
    monitorDeleteByMock.mockClear();

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorCreateMock).not.toHaveBeenCalled();
    expect(monitorDeleteByMock).not.toHaveBeenCalled();
    expect(monitorsOfDevice()).toHaveLength(1);
  });

  it("provisions nothing for a device outside every policy's scope", async () => {
    deviceTable = [device({ siteId: OTHER_SITE_ID })];
    policyTable = [policy({ scope: { siteIds: [SITE_ID.toString()] } })];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorCreateMock).not.toHaveBeenCalled();
  });

  it("matches a device by label as well as by site", async () => {
    deviceTable = [device({ labels: labelled(LABEL_ID) })];
    policyTable = [policy({ scope: { labelIds: [LABEL_ID.toString()] } })];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorsOfDevice()).toHaveLength(1);
  });
});

/*
 * THE DANGEROUS CASE. Two policies covering one device is the ordinary
 * situation ("everything gets reachability" plus "warehouse switches get
 * interface alerts"), and it is the one where a wrong ownership key destroys
 * a monitor: if the engine keyed on the DEVICE rather than on (policy,
 * template), each pass would see a monitor that is "not mine" and delete it,
 * and the two policies would take turns removing each other's alerting.
 */
describe("two policies on one device", () => {
  beforeEach(() => {
    deviceTable = [device()];
    policyTable = [
      policy(),
      policy(
        {
          name: "Interface alerts",
          monitorTemplateId: OTHER_TEMPLATE_ID,
        },
        OTHER_POLICY_ID,
      ),
    ];
  });

  it("gives the device one monitor per policy", async () => {
    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    const owners: Array<string> = monitorsOfDevice().map(
      (monitor: Monitor): string => {
        return monitor.networkAlertPolicyId!.toString();
      },
    );

    expect(owners.sort()).toEqual(
      [POLICY_ID.toString(), OTHER_POLICY_ID.toString()].sort(),
    );
  });

  it("leaves the other policy's monitor alone when one policy's scope stops matching", async () => {
    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    // The first policy narrows to a site this device is not in.
    policyTable[0]!.scope = {
      siteIds: [OTHER_SITE_ID.toString()],
    } as NetworkAlertPolicyScope;

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    const survivors: Array<Monitor> = monitorsOfDevice();

    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.networkAlertPolicyId?.toString()).toBe(
      OTHER_POLICY_ID.toString(),
    );
  });
});

/*
 * THE OTHER DANGEROUS CASE. A shrinking scope is the ordinary way a policy
 * stops covering a device, and it is the moment the engine deletes. What it
 * must delete is exactly the rows stamped with the policy that shrank —
 * never the monitor a person built by hand, and never the one an auto-import
 * rule provisioned, both of which sit on the same device and carry the same
 * `autoProvisionedNetworkDeviceId`.
 */
describe("a scope that shrinks", () => {
  it("deletes only the monitors the shrinking policy owns", async () => {
    const handMade: Monitor = monitorRow({
      autoProvisionedNetworkDeviceId: DEVICE_ID,
      // No networkAlertPolicyId: nobody's policy made this.
      monitorTemplateId: OTHER_TEMPLATE_ID,
    });

    monitorTable = [handMade];
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorsOfDevice()).toHaveLength(2);

    policyTable[0]!.scope = {
      siteIds: [OTHER_SITE_ID.toString()],
    } as NetworkAlertPolicyScope;

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    const survivors: Array<Monitor> = monitorsOfDevice();

    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.id?.toString()).toBe(handMade.id?.toString());
  });

  /*
   * ...and the hand-made monitor is not merely filtered out afterwards: the
   * QUERY that reads ACTUAL asks for `networkAlertPolicyId IS NOT NULL`, so
   * a monitor with no owner is never even a candidate for deletion.
   */
  it("never reads an unowned monitor into the set it may delete", async () => {
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    const actualQuery: Record<string, unknown> = (
      monitorFindByMock.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(
      (
        actualQuery["networkAlertPolicyId"] as {
          getSql: (alias: string) => string;
        }
      ).getSql("column"),
    ).toContain("IS NOT NULL");
    expect(actualQuery["autoProvisionedNetworkDeviceId"]?.toString()).toBe(
      DEVICE_ID.toString(),
    );
  });
});

/*
 * Adoption. A (device, template) monitor that already exists without an owner
 * occupies the pair Monitor's partial unique index protects, so creating a
 * second one is impossible — not slow, impossible, on this pass and on every
 * pass after it.
 */
describe("an unowned monitor for the same (device, template)", () => {
  it("is adopted by stamping the policy, not duplicated", async () => {
    const unowned: Monitor = monitorRow({
      autoProvisionedNetworkDeviceId: DEVICE_ID,
      monitorTemplateId: TEMPLATE_ID,
    });

    monitorTable = [unowned];
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorCreateMock).not.toHaveBeenCalled();
    expect(monitorsOfDevice()).toHaveLength(1);
    expect(unowned.networkAlertPolicyId?.toString()).toBe(POLICY_ID.toString());
  });

  /*
   * The stamp is a provenance marker, not an operational change: no hooks,
   * no workflow, no realtime event, no audit row. The monitor keeps doing
   * exactly what it was doing.
   */
  it("is adopted without running the monitor update pipeline", async () => {
    monitorTable = [
      monitorRow({
        autoProvisionedNetworkDeviceId: DEVICE_ID,
        monitorTemplateId: TEMPLATE_ID,
      }),
    ];
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorStampMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          networkAlertPolicyId: expect.anything(),
        }),
      }),
    );
    expect(monitorUpdateByMock).not.toHaveBeenCalled();
  });

  /*
   * A monitor another policy owns is not adoptable and not deletable. The
   * one-policy-per-template rule makes this unreachable through the API, but
   * the engine must never be the thing that turns a data anomaly into a lost
   * monitor.
   */
  it("is left alone when a different policy already owns it", async () => {
    const foreign: Monitor = monitorRow({
      autoProvisionedNetworkDeviceId: DEVICE_ID,
      monitorTemplateId: TEMPLATE_ID,
      networkAlertPolicyId: OTHER_POLICY_ID,
    });

    monitorTable = [foreign];
    deviceTable = [device()];
    policyTable = [
      policy(),
      policy(
        { name: "Other", scope: { siteIds: [SITE_ID.toString()] } },
        OTHER_POLICY_ID,
      ),
    ];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(foreign.networkAlertPolicyId?.toString()).toBe(
      OTHER_POLICY_ID.toString(),
    );
    expect(monitorTable).toContain(foreign);
  });
});

/*
 * Provisionability is a property of the DEVICE, and losing it removes every
 * policy monitor. The monitor-backed case is the one that matters most: the
 * device's health is now a bound monitor's, nothing polls it, and a Network
 * Device monitor left behind is billed for a verdict that will never arrive.
 */
describe("a device that stops being provisionable", () => {
  async function reconcileAfter(
    change: Partial<NetworkDevice>,
  ): Promise<Array<Monitor>> {
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorsOfDevice()).toHaveLength(1);

    Object.assign(deviceTable[0]!, change);

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    return monitorsOfDevice();
  }

  it("loses its policy monitors when it becomes monitor-backed", async () => {
    expect(
      await reconcileAfter({
        monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
      }),
    ).toHaveLength(0);
  });

  it("loses its policy monitors when it is archived", async () => {
    expect(await reconcileAfter({ isArchived: true })).toHaveLength(0);
  });

  /*
   * A device with no probe is polled by nothing, so its monitor would sit
   * Pending forever — and still be billed.
   */
  it("loses its policy monitors when its probe is cleared", async () => {
    expect(
      await reconcileAfter({ probeId: undefined as unknown as ObjectID }),
    ).toHaveLength(0);
  });

  it("gets them back when it becomes probe-polled again", async () => {
    deviceTable = [
      device({ monitoringMethod: NetworkDeviceMonitoringMethod.Monitor }),
    ];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorsOfDevice()).toHaveLength(0);

    deviceTable[0]!.monitoringMethod = NetworkDeviceMonitoringMethod.Probe;

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorsOfDevice()).toHaveLength(1);
  });

  /*
   * The legacy free-text values — NULL, "" and "SNMP" — all mean "the probe
   * polls it". A device written before ping-first polling must not be read
   * as monitor-backed and quietly stripped of its alerting.
   */
  it("treats a legacy SNMP monitoringMethod as probe-polled", async () => {
    deviceTable = [device({ monitoringMethod: "SNMP" })];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorsOfDevice()).toHaveLength(1);
  });
});

describe("a disabled policy", () => {
  it("keeps its monitors and pauses them rather than deleting them", async () => {
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    policyTable[0]!.isEnabled = false;

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    /*
     * The row survives — with its id, its incident history and its
     * dependencies — which is the whole difference between pausing a policy
     * and deleting one.
     */
    expect(monitorsOfDevice()).toHaveLength(1);
    expect(monitorsOfDevice()[0]!.disableActiveMonitoring).toBe(true);
  });

  it("provisions nothing new while it is off", async () => {
    deviceTable = [device()];
    policyTable = [policy({ isEnabled: false })];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorCreateMock).not.toHaveBeenCalled();
  });

  /*
   * A template-less policy — only reachable through the FK's SET NULL
   * backstop, because MonitorTemplateService refuses to delete a template a
   * policy uses — is treated exactly like a disabled one. Nothing to
   * provision from, so nothing is provisioned and nothing is destroyed.
   */
  it("behaves the same when its template was deleted out from under it", async () => {
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    delete policyTable[0]!.monitorTemplateId;

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorsOfDevice()).toHaveLength(1);
  });
});

/*
 * Re-pointing a policy at a different template is a re-clone: the monitors
 * from the old template are the old alerting configuration and must go, and
 * new ones are provisioned from the template the policy names now. This is
 * why ownership is the pair, not the policy id alone.
 */
describe("a policy re-pointed at a different template", () => {
  it("replaces the monitors made from the old template", async () => {
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    const originalMonitorId: string = monitorsOfDevice()[0]!.id!.toString();

    policyTable[0]!.monitorTemplateId = OTHER_TEMPLATE_ID;

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    const survivors: Array<Monitor> = monitorsOfDevice();

    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.id!.toString()).not.toBe(originalMonitorId);
    expect(survivors[0]!.monitorTemplateId?.toString()).toBe(
      OTHER_TEMPLATE_ID.toString(),
    );
  });
});

/*
 * A monitor whose owning policy row is gone is nobody's. In practice the
 * policy delete path removed it already; this is the backstop for the row
 * that outlived it, and without it that monitor would be billed forever with
 * nothing left to explain it.
 */
describe("a monitor whose policy no longer exists", () => {
  it("is removed on the next pass", async () => {
    monitorTable = [
      monitorRow({
        autoProvisionedNetworkDeviceId: DEVICE_ID,
        monitorTemplateId: TEMPLATE_ID,
        networkAlertPolicyId: OTHER_POLICY_ID,
      }),
    ];
    deviceTable = [device()];
    policyTable = [];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(monitorsOfDevice()).toHaveLength(0);
  });
});

describe("the per-device lock", () => {
  it("is taken on the device, by name, before anything is read", async () => {
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(semaphoreLockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: policyDeviceLockKey(DEVICE_ID),
        namespace: POLICY_DEVICE_LOCK_NAMESPACE,
        /*
         * One attempt, never a queue: whoever holds it is computing the same
         * difference from fresher data than this pass would.
         */
        acquireAttemptsLimit: 1,
      }),
    );
    expect(policyDeviceLockKey(DEVICE_ID)).toBe(
      `NetworkAlertPolicy:Device:${DEVICE_ID.toString()}`,
    );
  });

  /*
   * A pass that cannot take the lock does NOTHING — it does not read, and
   * above all it does not write. That is what makes "two policies racing on
   * one device" safe: the loser of the race is not a second writer, it is a
   * no-op.
   */
  it("makes a pass that cannot acquire it a complete no-op", async () => {
    deviceTable = [device()];
    policyTable = [policy()];
    semaphoreLockMock.mockRejectedValue(new Error("lock held"));

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(deviceFindOneByMock).not.toHaveBeenCalled();
    expect(monitorCreateMock).not.toHaveBeenCalled();
    expect(monitorDeleteByMock).not.toHaveBeenCalled();
  });

  it("is released even when the reconciliation throws", async () => {
    deviceTable = [device()];
    policyTable = [policy()];
    deviceFindOneByMock.mockRejectedValue(new Error("database is on fire"));

    await NetworkAlertPolicyEngineService.reconcileDevice({
      projectId: PROJECT_ID,
      deviceId: DEVICE_ID,
    });

    expect(semaphoreReleaseMock).toHaveBeenCalledWith(FAKE_MUTEX);
  });

  /*
   * ...and the throw is recorded rather than propagated. reconcileDevice is
   * called from a device create's detached chain; a template that stopped
   * validating must not become a failed device import.
   */
  it("records the failure instead of throwing it at the caller", async () => {
    deviceTable = [device()];
    policyTable = [policy()];
    deviceFindOneByMock.mockRejectedValue(new Error("database is on fire"));

    const context: PolicyRunContext =
      await NetworkAlertPolicyEngineService.reconcileDevice({
        projectId: PROJECT_ID,
        deviceId: DEVICE_ID,
      });

    expect(context.failures[0]).toContain("database is on fire");
  });
});

/*
 * Prerequisite 5. A project whose plan cannot hold another monitor must
 * produce ONE message an operator can act on, not five hundred identical
 * create failures — and the run must stop, because every remaining create
 * would fail the same way.
 */
describe("the plan check", () => {
  it("stops the run before the first create when the subscription is unpaid", async () => {
    deviceTable = [device()];
    policyTable = [policy()];
    currentPlanMock.mockResolvedValue({
      plan: PlanType.Growth,
      isSubscriptionUnpaid: true,
    });

    const context: PolicyRunContext =
      await NetworkAlertPolicyEngineService.reconcileDevice({
        projectId: PROJECT_ID,
        deviceId: DEVICE_ID,
      });

    expect(monitorCreateMock).not.toHaveBeenCalled();
    expect(context.isStopped).toBe(true);
    expect(context.planException).toContain("subscription is unpaid");
  });

  it("stops the run when the free plan's monitor limit is already reached", async () => {
    deviceTable = [device()];
    policyTable = [policy()];
    currentPlanMock.mockResolvedValue({
      plan: PlanType.Free,
      isSubscriptionUnpaid: false,
    });
    monitorCountByMock.mockResolvedValue(new PositiveNumber(10));

    const context: PolicyRunContext =
      await NetworkAlertPolicyEngineService.reconcileDevice({
        projectId: PROJECT_ID,
        deviceId: DEVICE_ID,
      });

    expect(monitorCreateMock).not.toHaveBeenCalled();
    expect(context.planException).toContain("free plan");
  });

  /*
   * Asked ONCE per run. Fifty devices in one sweep must not be fifty billing
   * lookups; that is the difference between a five-minute sweep and a
   * five-minute outage.
   */
  it("asks the plan once for a whole run", async () => {
    deviceTable = [device(), device({}, OTHER_DEVICE_ID)];
    policyTable = [policy()];

    const context: PolicyRunContext =
      NetworkAlertPolicyEngineService.createRunContext(PROJECT_ID);

    await NetworkAlertPolicyEngineService.reconcileDevices({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
      context: context,
    });

    expect(monitorCreateMock).toHaveBeenCalledTimes(2);
    expect(currentPlanMock).toHaveBeenCalledTimes(1);
  });

  /*
   * The ceiling can be crossed DURING a run: the precheck passed at nine of
   * ten monitors and the tenth create is the one that is refused. The verdict
   * is re-asked after a failed create — never pattern-matched out of the
   * error text, which would drift the moment MonitorService reworded its
   * refusal — and the run stops at the first refusal instead of the five
   * hundredth.
   */
  it("stops mid-run when a create fails and the plan now refuses another monitor", async () => {
    deviceTable = [device(), device({}, OTHER_DEVICE_ID)];
    policyTable = [policy()];
    currentPlanMock.mockResolvedValue({
      plan: PlanType.Free,
      isSubscriptionUnpaid: false,
    });
    monitorCountByMock
      .mockResolvedValueOnce(new PositiveNumber(9))
      .mockResolvedValue(new PositiveNumber(10));
    monitorCreateMock.mockRejectedValueOnce(
      new BadDataException("monitor limit reached"),
    );

    const context: PolicyRunContext =
      NetworkAlertPolicyEngineService.createRunContext(PROJECT_ID);

    await NetworkAlertPolicyEngineService.reconcileDevices({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
      context: context,
    });

    expect(context.isStopped).toBe(true);
    expect(context.planException).toContain("free plan");
    // The second device was never attempted.
    expect(monitorCreateMock).toHaveBeenCalledTimes(1);
  });

  /*
   * A billing lookup that FAILS is not a plan refusal. A Stripe blip must not
   * stop a fleet from being provisioned; it is recorded and the run carries
   * on.
   */
  it("treats a billing lookup failure as an ordinary failure, not a refusal", async () => {
    deviceTable = [device()];
    policyTable = [policy()];
    currentPlanMock.mockRejectedValue(new Error("stripe timed out"));

    const context: PolicyRunContext =
      await NetworkAlertPolicyEngineService.reconcileDevice({
        projectId: PROJECT_ID,
        deviceId: DEVICE_ID,
      });

    expect(context.isStopped).toBe(false);
    expect(context.failures[0]).toContain("stripe timed out");
    expect(monitorCreateMock).toHaveBeenCalledTimes(1);
  });
});

describe("the run's monitor budget", () => {
  it("stops writing once MAX_MONITORS_PER_POLICY_SYNC monitors have been written", async () => {
    deviceTable = [device(), device({}, OTHER_DEVICE_ID)];
    policyTable = [policy()];

    const context: PolicyRunContext =
      NetworkAlertPolicyEngineService.createRunContext(PROJECT_ID, 1);

    await NetworkAlertPolicyEngineService.reconcileDevices({
      projectId: PROJECT_ID,
      deviceIds: [DEVICE_ID, OTHER_DEVICE_ID],
      context: context,
    });

    /*
     * One monitor, and the run marked truncated rather than failed: nothing
     * is half-written, and the next sweep computes the same difference and
     * continues.
     */
    expect(monitorCreateMock).toHaveBeenCalledTimes(1);
    expect(context.isTruncated).toBe(true);
    expect(context.failures).toHaveLength(0);
  });

  it("defaults to the documented cap", () => {
    expect(
      NetworkAlertPolicyEngineService.createRunContext(PROJECT_ID)
        .monitorBudget,
    ).toBe(MAX_MONITORS_PER_POLICY_SYNC);
  });
});

describe("syncPolicy over a policy's whole fleet", () => {
  it("provisions every matching device and stamps the covered count", async () => {
    deviceTable = [device(), device({}, OTHER_DEVICE_ID)];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.syncPolicy({ policyId: POLICY_ID });

    expect(monitorTable).toHaveLength(2);
    expect(policyStampMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: POLICY_ID,
        data: expect.objectContaining({
          coveredDeviceCount: 2,
          lastSyncError: null,
        }),
      }),
    );
  });

  /*
   * The covered count is what the settings table prints beside the scope
   * sentence, so it counts the devices the policy actually provisions for —
   * not every device the scope's SQL half matches. An archived or
   * monitor-backed device is in the site, and gets no monitor.
   */
  it("counts only the devices it can actually provision for", async () => {
    deviceTable = [
      device(),
      device(
        { monitoringMethod: NetworkDeviceMonitoringMethod.Monitor },
        OTHER_DEVICE_ID,
      ),
    ];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.syncPolicy({ policyId: POLICY_ID });

    expect(policyStampMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ coveredDeviceCount: 1 }),
      }),
    );
  });

  it("removes the monitors of devices that have left the scope", async () => {
    deviceTable = [device(), device({}, OTHER_DEVICE_ID)];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.syncPolicy({ policyId: POLICY_ID });
    expect(monitorTable).toHaveLength(2);

    // The second device moves to a site the policy does not cover.
    deviceTable[1]!.siteId = OTHER_SITE_ID;
    policyTable[0]!.scope = {
      siteIds: [SITE_ID.toString()],
    } as NetworkAlertPolicyScope;

    await NetworkAlertPolicyEngineService.syncPolicy({ policyId: POLICY_ID });

    expect(monitorTable).toHaveLength(1);
    expect(monitorTable[0]!.autoProvisionedNetworkDeviceId?.toString()).toBe(
      DEVICE_ID.toString(),
    );
  });

  it("records a failure in lastSyncError where the operator will see it", async () => {
    deviceTable = [device()];
    policyTable = [policy()];
    // The template vanished between the policy's save and this pass.
    templateFindOneByMock.mockResolvedValue(null);

    await NetworkAlertPolicyEngineService.syncPolicy({ policyId: POLICY_ID });

    expect(policyStampMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastSyncError: expect.stringContaining("Monitor template"),
        }),
      }),
    );
  });

  /*
   * A disabled policy is looked at and found to have nothing to do. Stamping
   * lastSyncAt for it is honest — and leaving lastSyncError null is what
   * stops the settings table showing a red row for a policy somebody
   * deliberately switched off.
   */
  it("stamps a disabled policy without touching a single monitor", async () => {
    deviceTable = [device()];
    policyTable = [policy({ isEnabled: false })];

    await NetworkAlertPolicyEngineService.syncPolicy({ policyId: POLICY_ID });

    expect(monitorCreateMock).not.toHaveBeenCalled();
    expect(monitorDeleteByMock).not.toHaveBeenCalled();
    expect(policyStampMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSyncError: null }),
      }),
    );
  });

  it("does nothing at all for a policy that has been deleted", async () => {
    policyTable = [];

    await expect(
      NetworkAlertPolicyEngineService.syncPolicy({ policyId: POLICY_ID }),
    ).resolves.toBeNull();

    expect(policyStampMock).not.toHaveBeenCalled();
  });

  /*
   * templateSyncedAt means "every monitor this policy owns is running the
   * template's current configuration". A sweep that changed nothing has
   * re-synced nothing, so it must not stamp it — otherwise an operator would
   * read "Template Synced: 2 minutes ago" and believe a criteria edit they
   * made an hour ago had landed.
   */
  it("does not stamp templateSyncedAt on an ordinary sweep", async () => {
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.syncPolicy({ policyId: POLICY_ID });

    const stamped: Record<string, unknown> = (
      policyStampMock.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect(stamped["templateSyncedAt"]).toBeUndefined();
  });

  it("stamps templateSyncedAt when the fleet was rebuilt from a new template", async () => {
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.syncPolicy({
      policyId: POLICY_ID,
      stampTemplateSyncedOnCleanPass: true,
    });

    const stamped: Record<string, unknown> = (
      policyStampMock.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect(stamped["templateSyncedAt"]).toBeInstanceOf(Date);
  });

  /*
   * ...but not when the pass ADOPTED a monitor. An adopted monitor was built
   * by somebody else and its criteria are not this template's, so claiming
   * the fleet is in step with the template would be false.
   */
  it("does not stamp templateSyncedAt for a pass that adopted a monitor", async () => {
    monitorTable = [
      monitorRow({
        autoProvisionedNetworkDeviceId: DEVICE_ID,
        monitorTemplateId: TEMPLATE_ID,
      }),
    ];
    deviceTable = [device()];
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.syncPolicy({
      policyId: POLICY_ID,
      stampTemplateSyncedOnCleanPass: true,
    });

    const stamped: Record<string, unknown> = (
      policyStampMock.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect(stamped["templateSyncedAt"]).toBeUndefined();
  });
});

/*
 * Prerequisite 9's engine half. A scope is validated at write, so a stale or
 * malformed id only ever arrives here through a hand-edited row — and the
 * engine's answer is "match nothing", never "throw" and never "match
 * everything".
 */
describe("scope ids the engine cannot use", () => {
  it("matches nothing when a kind holds only unusable ids", async () => {
    deviceTable = [device()];
    policyTable = [
      policy({
        scope: { siteIds: ["not-a-uuid"] } as NetworkAlertPolicyScope,
      }),
    ];

    await NetworkAlertPolicyEngineService.syncPolicy({ policyId: POLICY_ID });

    /*
     * Dropping the last unusable id and leaving the kind EMPTY would be the
     * dangerous bug: an empty kind matches every device, so a typo'd scope
     * would silently provision the whole estate.
     */
    expect(monitorCreateMock).not.toHaveBeenCalled();
  });

  it("adds no clause at all for a kind that is genuinely empty", async () => {
    deviceTable = [device()];
    policyTable = [policy({ scope: {} as NetworkAlertPolicyScope })];

    await NetworkAlertPolicyEngineService.syncPolicy({ policyId: POLICY_ID });

    const deviceQuery: Record<string, unknown> = (
      deviceFindByMock.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(deviceQuery["siteId"]).toBeUndefined();
    expect(deviceQuery["networkDeviceRoleId"]).toBeUndefined();
    expect(deviceQuery["labels"]).toBeUndefined();
    expect(monitorCreateMock).toHaveBeenCalledTimes(1);
  });

  // The engine reads a scope. It never writes one back.
  it("never rewrites the policy's scope", async () => {
    deviceTable = [device()];
    policyTable = [
      policy({
        scope: { siteIds: ["not-a-uuid"] } as NetworkAlertPolicyScope,
      }),
    ];

    await NetworkAlertPolicyEngineService.syncPolicy({ policyId: POLICY_ID });

    for (const call of policyStampMock.mock.calls) {
      expect(
        (call[0] as { data: Record<string, unknown> }).data["scope"],
      ).toBeUndefined();
    }

    expect(policyTable[0]!.scope).toEqual({ siteIds: ["not-a-uuid"] });
  });
});

describe("deleting a policy", () => {
  it("removes exactly the monitors it owns, as root", async () => {
    const ownMonitor: Monitor = monitorRow({
      autoProvisionedNetworkDeviceId: DEVICE_ID,
      monitorTemplateId: TEMPLATE_ID,
      networkAlertPolicyId: POLICY_ID,
    });
    const otherPolicyMonitor: Monitor = monitorRow({
      autoProvisionedNetworkDeviceId: OTHER_DEVICE_ID,
      monitorTemplateId: OTHER_TEMPLATE_ID,
      networkAlertPolicyId: OTHER_POLICY_ID,
    });
    const handMade: Monitor = monitorRow({
      autoProvisionedNetworkDeviceId: DEVICE_ID,
      monitorTemplateId: OTHER_TEMPLATE_ID,
    });

    monitorTable = [ownMonitor, otherPolicyMonitor, handMade];

    const deleted: number =
      await NetworkAlertPolicyEngineService.deleteMonitorsOwnedByPolicy({
        projectId: PROJECT_ID,
        policyId: POLICY_ID,
      });

    expect(deleted).toBe(1);
    expect(monitorTable).toEqual([otherPolicyMonitor, handMade]);
    expect(monitorDeleteByMock).toHaveBeenCalledWith(
      expect.objectContaining({ props: { isRoot: true } }),
    );
  });

  it("does nothing when the policy owns no monitors", async () => {
    monitorTable = [
      monitorRow({
        autoProvisionedNetworkDeviceId: DEVICE_ID,
        monitorTemplateId: TEMPLATE_ID,
      }),
    ];

    expect(
      await NetworkAlertPolicyEngineService.deleteMonitorsOwnedByPolicy({
        projectId: PROJECT_ID,
        policyId: POLICY_ID,
      }),
    ).toBe(0);
    expect(monitorDeleteByMock).not.toHaveBeenCalled();
  });
});

describe("deleting devices", () => {
  it("removes their policy-owned monitors and leaves the rest to the caller", async () => {
    const policyMonitor: Monitor = monitorRow({
      autoProvisionedNetworkDeviceId: DEVICE_ID,
      monitorTemplateId: TEMPLATE_ID,
      networkAlertPolicyId: POLICY_ID,
    });
    const ruleMonitor: Monitor = monitorRow({
      autoProvisionedNetworkDeviceId: DEVICE_ID,
      monitorTemplateId: OTHER_TEMPLATE_ID,
    });

    monitorTable = [policyMonitor, ruleMonitor];

    const deleted: number =
      await NetworkAlertPolicyEngineService.deletePolicyMonitorsForDevices({
        projectId: PROJECT_ID,
        deviceIds: [DEVICE_ID],
      });

    expect(deleted).toBe(1);
    /*
     * The auto-import rule's monitor survives this call: it is removed by
     * NetworkDeviceService's own preflight, under the caller's permissions,
     * because somebody chose that rule.
     */
    expect(monitorTable).toEqual([ruleMonitor]);
  });

  it("asks nothing when there are no devices", async () => {
    expect(
      await NetworkAlertPolicyEngineService.deletePolicyMonitorsForDevices({
        projectId: PROJECT_ID,
        deviceIds: [],
      }),
    ).toBe(0);
    expect(monitorFindByMock).not.toHaveBeenCalled();
  });
});

describe("pausing and resuming a policy's monitors", () => {
  beforeEach(() => {
    monitorTable = [
      monitorRow({
        autoProvisionedNetworkDeviceId: DEVICE_ID,
        monitorTemplateId: TEMPLATE_ID,
        networkAlertPolicyId: POLICY_ID,
      }),
      monitorRow({
        autoProvisionedNetworkDeviceId: OTHER_DEVICE_ID,
        monitorTemplateId: TEMPLATE_ID,
        networkAlertPolicyId: POLICY_ID,
      }),
      // Another policy's monitor: never touched by this policy's pause.
      monitorRow({
        autoProvisionedNetworkDeviceId: DEVICE_ID,
        monitorTemplateId: OTHER_TEMPLATE_ID,
        networkAlertPolicyId: OTHER_POLICY_ID,
      }),
    ];
  });

  it("pauses only its own, and resuming reverses it exactly", async () => {
    await NetworkAlertPolicyEngineService.setPolicyMonitorsPaused({
      projectId: PROJECT_ID,
      policyId: POLICY_ID,
      isPaused: true,
    });

    expect(monitorTable[0]!.disableActiveMonitoring).toBe(true);
    expect(monitorTable[1]!.disableActiveMonitoring).toBe(true);
    expect(monitorTable[2]!.disableActiveMonitoring).toBe(false);

    await NetworkAlertPolicyEngineService.setPolicyMonitorsPaused({
      projectId: PROJECT_ID,
      policyId: POLICY_ID,
      isPaused: false,
    });

    expect(monitorTable[0]!.disableActiveMonitoring).toBe(false);
    expect(monitorTable[1]!.disableActiveMonitoring).toBe(false);
  });

  /*
   * The pause goes through updateBy, not a raw column write, so workflows,
   * realtime and audit see it exactly as they would an operator's — and the
   * walk fan-out, which reads this flag, stops feeding the monitor.
   */
  it("writes disableActiveMonitoring through the monitor service", async () => {
    await NetworkAlertPolicyEngineService.setPolicyMonitorsPaused({
      projectId: PROJECT_ID,
      policyId: POLICY_ID,
      isPaused: true,
    });

    expect(monitorUpdateByMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { disableActiveMonitoring: true },
        props: { isRoot: true },
      }),
    );
  });

  /*
   * The page is re-read on the flag it is about to write, so a write that
   * lands on nothing would be read again forever. It stops and says so
   * instead of spinning the worker.
   */
  it("gives up rather than looping when the write lands on nothing", async () => {
    monitorUpdateByMock.mockResolvedValue(0);

    await expect(
      NetworkAlertPolicyEngineService.setPolicyMonitorsPaused({
        projectId: PROJECT_ID,
        policyId: POLICY_ID,
        isPaused: true,
      }),
    ).resolves.toBe(2);
  });
});

describe("onMonitorTemplateSynced", () => {
  it("stamps templateSyncedAt on the policy that provisions from the template", async () => {
    policyTable = [policy()];

    await NetworkAlertPolicyEngineService.onMonitorTemplateSynced({
      monitorTemplateId: TEMPLATE_ID,
      projectId: PROJECT_ID,
    });

    expect(policyStampMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: POLICY_ID,
        data: { templateSyncedAt: expect.any(Date) },
      }),
    );
  });

  it("stamps nothing when no policy uses the template", async () => {
    policyTable = [policy({ monitorTemplateId: OTHER_TEMPLATE_ID })];

    await NetworkAlertPolicyEngineService.onMonitorTemplateSynced({
      monitorTemplateId: TEMPLATE_ID,
      projectId: PROJECT_ID,
    });

    expect(policyStampMock).not.toHaveBeenCalled();
  });

  /*
   * Never throws. A bookkeeping column must not fail the template sync the
   * operator actually asked for.
   */
  it("swallows a stamping failure", async () => {
    policyTable = [policy()];
    policyStampMock.mockRejectedValue(new Error("no"));

    await expect(
      NetworkAlertPolicyEngineService.onMonitorTemplateSynced({
        monitorTemplateId: TEMPLATE_ID,
        projectId: PROJECT_ID,
      }),
    ).resolves.toBeUndefined();
  });
});
