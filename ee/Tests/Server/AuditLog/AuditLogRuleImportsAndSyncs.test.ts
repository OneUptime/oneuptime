import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import DatabaseService from "Common/Server/Services/DatabaseService";
import { RuleRunWriteProps } from "Common/Server/Utils/Rules/RuleRun/RuleApplication";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Project from "Common/Models/DatabaseModels/Project";
import ServiceLevelObjective from "Common/Models/DatabaseModels/ServiceLevelObjective";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import User from "Common/Models/DatabaseModels/User";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import WriteSource from "Common/Types/BaseDatabase/WriteSource";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE ENTRIES OF AN AUTO IMPORT RULE'S RUN NOW, AND OF A STATUS PAGE OR SLO
 * MONITOR RULE'S, AS THE RECORDER WRITES THEM (issues #6323, #6324).
 *
 * Each was System's: the devices and monitors an auto import rule's Run Now
 * created, and the status page resources and SLO monitors a monitor rule's
 * Run now changed, were written as plain root - kept only when the project
 * stores system events, and saying nobody ran the rule. Pinned here is what
 * each entry now says - by whom, of what, on which page - and that it is
 * kept whether or not the project stores system events. What the automatic
 * import and a sync after a save write stays OneUptime's own. What reaches
 * the recorder from each write is pinned at the write sites (the engines'
 * suites, OwnerAndPrivacyRuleRunAuditLog, and the route suites).
 */

const findProjectMock: jest.Mock = jest.fn();
const findUserMock: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findProjectMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findUserMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const SLO_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const RULE_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const KEY_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");
const GROUP_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

// The person's request, as the routes have it.
const PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: RUNNER_ID,
  userType: UserType.User,
  userTenantAccessPermission: {},
};

let project: Project;
let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

function makeProject(storeSystemEvents: boolean): Project {
  const item: Project = new Project();
  item._id = PROJECT_ID.toString();
  item.enableAuditLogs = true;
  item.auditLogsRetentionInDays = 30;
  item.storeSystemEventsInAuditLogs = storeSystemEvents;
  return item;
}

function onlyEntry(): AuditLog {
  expect(inserted).toHaveLength(1);
  return inserted[0]!;
}

function fieldsOf(entry: AuditLog): Array<string> {
  return ((entry.changes || []) as Array<JSONObject>).map(
    (change: JSONObject): string => {
      return String(change["field"]);
    },
  );
}

async function storingSystemEvents(): Promise<void> {
  project = makeProject(true);
  recorder.invalidateProjectSettings(PROJECT_ID);
}

// A device as an auto import rule's Run Now creates it.
function importedDevice(): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(DEVICE_ID);
  device.projectId = PROJECT_ID;
  device.name = "core-switch-01";
  device.hostname = "10.0.0.5";
  device.createdByUserId = RUNNER_ID;
  return device;
}

// A monitor as the rule's template makes it for that device.
function provisionedMonitor(): Monitor {
  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.projectId = PROJECT_ID;
  monitor.name = "core-switch-01 - SNMP health";
  monitor.monitorType = MonitorType.NetworkDevice;
  monitor.autoProvisionedNetworkDeviceId = DEVICE_ID;
  monitor.createdByUserId = RUNNER_ID;
  return monitor;
}

// A resource as a status page monitor rule's sync adds it.
function ruleResource(): StatusPageResource {
  const resource: StatusPageResource = new StatusPageResource(RESOURCE_ID);
  resource.projectId = PROJECT_ID;
  resource.statusPageId = STATUS_PAGE_ID;
  resource.monitorId = MONITOR_ID;
  resource.statusPageMonitorRuleId = RULE_ID;
  resource.displayName = "Checkout API";
  resource.showCurrentStatus = true;
  return resource;
}

function sloBefore(): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(SLO_ID);
  slo.projectId = PROJECT_ID;
  slo.name = "Checkout";
  slo.monitors = [];
  slo.autoAddedMonitors = [];
  return slo;
}

beforeEach(() => {
  setTestBillingEnabled(false);
  project = makeProject(false);
  inserted = [];

  recorder = new AuditLogRecorder({
    store: {
      create: jest.fn(((createBy: { data: AuditLog }) => {
        inserted.push(createBy.data);
        return Promise.resolve(createBy.data);
      }) as never),
    } as unknown as AuditLogStore,
  });

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    return Promise.resolve(project);
  });

  findUserMock.mockReset();
  findUserMock.mockImplementation(((findOneById: { id: ObjectID }) => {
    if (findOneById.id.toString() !== RUNNER_ID.toString()) {
      return Promise.resolve(null);
    }

    const user: User = new User();
    user._id = RUNNER_ID.toString();
    user.name = new Name("Ada Lovelace");
    user.email = new Email("ada@example.com");
    return Promise.resolve(user);
  }) as never);

  // The names of related rows the recorder looks up: the monitors.
  jest
    .spyOn(DatabaseService.prototype, "findBy")
    .mockImplementation((async (): Promise<Array<BaseModel>> => {
      const monitor: Monitor = new Monitor(MONITOR_ID);
      monitor.name = "Checkout API";
      return [monitor];
    }) as never);

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("what an auto import rule's Run Now creates (issue #6323)", () => {
  test("a device is a Create, named after it, by whoever ran the rule", async () => {
    await recorder.recordCreate({
      model: new NetworkDevice(),
      createdItem: importedDevice(),
      props: RuleRunWriteProps.get(PERSON),
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Create);
    expect(entry.resourceType).toBe("Network Device");
    expect(entry.resourceName).toBe("core-switch-01");
    expect(String(entry.projectId)).toBe(PROJECT_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.userType).toBe(UserType.User);
    expect(String(entry.userId)).toBe(RUNNER_ID.toString());
  });

  test("a monitor from the rule's template is a Create in the project, by them", async () => {
    await recorder.recordCreate({
      model: new Monitor(),
      createdItem: provisionedMonitor(),
      props: RuleRunWriteProps.getInProject(PERSON, PROJECT_ID),
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Create);
    expect(entry.resourceType).toBe("Monitor");
    expect(entry.resourceName).toBe("core-switch-01 - SNMP health");
    expect(String(entry.projectId)).toBe(PROJECT_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    expect(String(entry.userId)).toBe(RUNNER_ID.toString());
  });

  test("both are kept though the project does not store system events: they are the person's", async () => {
    project = makeProject(false);

    await recorder.recordCreate({
      model: new NetworkDevice(),
      createdItem: importedDevice(),
      props: RuleRunWriteProps.get(PERSON),
    });
    await recorder.recordCreate({
      model: new Monitor(),
      createdItem: provisionedMonitor(),
      props: RuleRunWriteProps.getInProject(PERSON, PROJECT_ID),
    });

    expect(inserted).toHaveLength(2);

    for (const entry of inserted) {
      expect(entry.userName).toBe("Ada Lovelace");
    }
  });

  test("what the automatic import creates is System's, kept only with system events stored", async () => {
    const importAutomatically: () => Promise<void> =
      async (): Promise<void> => {
        await recorder.recordCreate({
          model: new NetworkDevice(),
          createdItem: importedDevice(),
          props: RuleRunWriteProps.get(undefined),
        });
        await recorder.recordCreate({
          model: new Monitor(),
          createdItem: provisionedMonitor(),
          props: RuleRunWriteProps.getInProject(undefined, PROJECT_ID),
        });
      };

    await importAutomatically();
    expect(inserted).toHaveLength(0);

    await storingSystemEvents();
    await importAutomatically();

    expect(inserted).toHaveLength(2);

    for (const entry of inserted) {
      expect(entry.userType).toBe("System");
      expect(entry.userName).toBeUndefined();
    }
  });

  test("an API key's run is credited to the key", async () => {
    await recorder.recordCreate({
      model: new NetworkDevice(),
      createdItem: importedDevice(),
      props: RuleRunWriteProps.get({
        tenantId: PROJECT_ID,
        userType: UserType.API,
        apiKeyId: KEY_ID,
        apiKeyName: "Terraform",
      }),
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.userType).toBe(UserType.API);
    expect(entry.apiKeyName).toBe("Terraform");
    expect(String(entry.apiKeyId)).toBe(KEY_ID.toString());
  });
});

describe("what a status page monitor rule's Run now changes on the page (issue #6324)", () => {
  test("a resource it adds is a Create on the status page's page, by whoever ran the rule", async () => {
    await recorder.recordCreate({
      model: new StatusPageResource(),
      createdItem: ruleResource(),
      props: RuleRunWriteProps.get(PERSON),
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Create);
    expect(entry.resourceType).toBe("Status Page Resource");
    expect(entry.resourceName).toBe("Checkout API");
    expect(entry.rootResourceType).toBe("Status Page");
    expect(entry.rootResourceId?.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
  });

  test("a resource it moves to the rule's group is an Update, by them", async () => {
    await recorder.recordUpdate({
      model: new StatusPageResource(),
      before: ruleResource(),
      updatedFields: { statusPageGroupId: GROUP_ID },
      itemId: RESOURCE_ID,
      props: RuleRunWriteProps.get(PERSON),
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Update);
    expect(fieldsOf(entry)).toEqual(["statusPageGroupId"]);
    expect(entry.rootResourceId?.toString()).toBe(STATUS_PAGE_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
  });

  test("a resource it removes is a Delete, by them", async () => {
    await recorder.recordDelete({
      model: new StatusPageResource(),
      deletedItem: ruleResource(),
      itemId: RESOURCE_ID,
      props: RuleRunWriteProps.get(PERSON),
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Delete);
    expect(entry.resourceName).toBe("Checkout API");
    expect(entry.userName).toBe("Ada Lovelace");
  });

  test("a sync after the rule is saved is OneUptime's own, kept only with system events stored", async () => {
    const syncAfterSave: () => Promise<void> = async (): Promise<void> => {
      await recorder.recordCreate({
        model: new StatusPageResource(),
        createdItem: ruleResource(),
        props: RuleRunWriteProps.get(undefined),
      });
    };

    await syncAfterSave();
    expect(inserted).toHaveLength(0);

    await storingSystemEvents();
    await syncAfterSave();

    expect(onlyEntry().userType).toBe("System");
  });
});

describe("what an SLO monitor rule's Run now changes on the SLO (issue #6324)", () => {
  test("the monitors it attaches are an Update of the SLO's monitors, by whoever ran the rule", async () => {
    const attached: Monitor = new Monitor(MONITOR_ID);

    await recorder.recordUpdate({
      model: new ServiceLevelObjective(),
      before: sloBefore(),
      updatedFields: {
        monitors: [attached],
        autoAddedMonitors: [attached],
      } as unknown as JSONObject,
      itemId: SLO_ID,
      props: RuleRunWriteProps.get(PERSON),
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Update);
    expect(entry.resourceName).toBe("Checkout");
    // Which monitors the rules own is OneUptime's bookkeeping, left out.
    expect(fieldsOf(entry)).toEqual(["monitors"]);
    expect(entry.userName).toBe("Ada Lovelace");
    expect(String(entry.userId)).toBe(RUNNER_ID.toString());
  });

  test("kept though the project does not store system events, and System's after a save", async () => {
    const attach: (
      props: DatabaseCommonInteractionProps,
    ) => Promise<void> = async (
      props: DatabaseCommonInteractionProps,
    ): Promise<void> => {
      await recorder.recordUpdate({
        model: new ServiceLevelObjective(),
        before: sloBefore(),
        updatedFields: {
          monitors: [new Monitor(MONITOR_ID)],
        } as unknown as JSONObject,
        itemId: SLO_ID,
        props: props,
      });
    };

    await attach(RuleRunWriteProps.get(PERSON));
    expect(onlyEntry().userName).toBe("Ada Lovelace");

    inserted.length = 0;
    await attach(RuleRunWriteProps.get(undefined));
    expect(inserted).toHaveLength(0);
  });
});

/*
 * Whoever runs a rule - a person, an API key, a member through an MCP
 * client or Ask AI - and whatever it changes, each entry is theirs and is
 * kept without system events; the same change with nobody named is not.
 */
describe("whoever runs a rule, whatever it changes", () => {
  test("of 200 seeded runs, every entry names who ran it, and OneUptime's own are left to system events", async () => {
    const random: SeededRandom = seededRandom(6324);

    const identities: Array<DatabaseCommonInteractionProps> = [
      { ...PERSON },
      {
        tenantId: PROJECT_ID,
        userType: UserType.API,
        apiKeyId: KEY_ID,
        apiKeyName: "Deploy bot",
      },
      {
        ...PERSON,
        mcpOAuthGrantId: KEY_ID,
        mcpClientName: "Claude",
      },
      { ...PERSON, writeSource: WriteSource.AskAi },
    ];

    type Change = (props: DatabaseCommonInteractionProps) => Promise<void>;

    const changes: Array<[string, (given?: DatabaseCommonInteractionProps) => Change]> = [
      [
        "device",
        (): Change => {
          return async (props: DatabaseCommonInteractionProps) => {
            await recorder.recordCreate({
              model: new NetworkDevice(),
              createdItem: importedDevice(),
              props,
            });
          };
        },
      ],
      [
        "monitor",
        (): Change => {
          return async (props: DatabaseCommonInteractionProps) => {
            await recorder.recordCreate({
              model: new Monitor(),
              createdItem: provisionedMonitor(),
              props: { ...props, tenantId: PROJECT_ID },
            });
          };
        },
      ],
      [
        "resource added",
        (): Change => {
          return async (props: DatabaseCommonInteractionProps) => {
            await recorder.recordCreate({
              model: new StatusPageResource(),
              createdItem: ruleResource(),
              props,
            });
          };
        },
      ],
      [
        "resource removed",
        (): Change => {
          return async (props: DatabaseCommonInteractionProps) => {
            await recorder.recordDelete({
              model: new StatusPageResource(),
              deletedItem: ruleResource(),
              itemId: RESOURCE_ID,
              props,
            });
          };
        },
      ],
      [
        "SLO monitors",
        (): Change => {
          return async (props: DatabaseCommonInteractionProps) => {
            await recorder.recordUpdate({
              model: new ServiceLevelObjective(),
              before: sloBefore(),
              updatedFields: {
                monitors: [new Monitor(MONITOR_ID)],
              } as unknown as JSONObject,
              itemId: SLO_ID,
              props,
            });
          };
        },
      ],
    ];

    for (let draw: number = 0; draw < 200; draw++) {
      const identity: DatabaseCommonInteractionProps =
        identities[random(identities.length)]!;
      const [kind, changeOf] = changes[random(changes.length)]!;
      const named: boolean = random(4) !== 0;

      inserted.length = 0;
      await changeOf()(RuleRunWriteProps.get(named ? identity : undefined));

      if (!named) {
        // OneUptime's own: not stored while the project stores no system events.
        expect([draw, kind, inserted.length]).toEqual([draw, kind, 0]);
        continue;
      }

      expect([draw, kind, inserted.length]).toEqual([draw, kind, 1]);

      const entry: AuditLog = inserted[0]!;

      expect([draw, kind, entry.userType]).toEqual([
        draw,
        kind,
        identity.userType,
      ]);

      if (identity.userType === UserType.API) {
        expect([draw, entry.apiKeyName]).toEqual([draw, "Deploy bot"]);
      } else {
        expect([draw, entry.userName]).toEqual([draw, "Ada Lovelace"]);
      }

      if (identity.mcpClientName) {
        expect([draw, entry.mcpClientName]).toEqual([draw, "Claude"]);
      }
    }
  });
});
