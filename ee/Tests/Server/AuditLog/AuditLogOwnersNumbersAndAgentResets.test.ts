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
import OnBehalfOfProps from "Common/Server/Utils/AuditLog/OnBehalfOfProps";
import { RuleRunWriteProps } from "Common/Server/Utils/Rules/RuleRun/RuleApplication";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import Host from "Common/Models/DatabaseModels/Host";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import KubernetesAiAgent from "Common/Models/DatabaseModels/KubernetesAiAgent";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import ResourceAiAgent from "Common/Models/DatabaseModels/ResourceAiAgent";
import Team from "Common/Models/DatabaseModels/Team";
import User from "Common/Models/DatabaseModels/User";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { AUDIT_LOG_REDACTED_VALUE } from "Common/Types/AuditLog/AuditLogRedaction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE ENTRIES OF AN OWNER OR PRIVACY RULE'S RUN NOW, A CALL POLICY'S NUMBER
 * BOUGHT, ATTACHED OR RELEASED, AND AN AI AGENT RESET, AS THE RECORDER WRITES
 * THEM (issues #6300-#6302).
 *
 * Each was System's or nothing: owners a rule's Run now added and numbers
 * someone bought were written as plain root, and an AI agent's reset wrote
 * only the agent's own row, which the audit log leaves out. Pinned here is
 * what each entry now says - by whom, of what, on which page - and that no
 * secret reaches one: no provider's id or token for a number, no agent key
 * or hash. What reaches the recorder from each write is pinned at the write
 * sites (OwnerAndPrivacyRuleRunAuditLog, PhoneNumberAPI, AiAgentResetAuditLog).
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
const OWNER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RECORD_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const POLICY_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const CONFIG_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const TEAM_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const KEY_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

// The person's request, as the routes have it.
const PERSON: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: RUNNER_ID,
  userType: UserType.User,
  userTenantAccessPermission: {},
};

// A write OneUptime makes on their behalf.
const ON_THEIR_BEHALF: DatabaseCommonInteractionProps =
  OnBehalfOfProps.get(PERSON);

let project: Project;
let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;
// The names the recorder looks up for related rows, by id.
let relatedNames: Map<string, string>;

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

function changesOf(entry: AuditLog): Array<JSONObject> {
  return (entry.changes || []) as Array<JSONObject>;
}

function fieldsOf(entry: AuditLog): Array<string> {
  return changesOf(entry).map((change: JSONObject): string => {
    return String(change["field"]);
  });
}

async function storingSystemEvents(): Promise<void> {
  project = makeProject(true);
  recorder.invalidateProjectSettings(PROJECT_ID);
}

beforeEach(() => {
  setTestBillingEnabled(false);
  project = makeProject(false);
  inserted = [];
  relatedNames = new Map<string, string>([
    [POLICY_ID.toString(), "Support line"],
    [MONITOR_ID.toString(), "API"],
    [TEAM_ID.toString(), "Platform"],
  ]);

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
    const names: Record<string, [string, string]> = {
      [RUNNER_ID.toString()]: ["Ada Lovelace", "ada@example.com"],
      [OWNER_ID.toString()]: ["Grace Hopper", "grace@example.com"],
    };
    const known: [string, string] | undefined =
      names[findOneById.id.toString()];

    if (!known) {
      return Promise.resolve(null);
    }

    const user: User = new User();
    user._id = findOneById.id.toString();
    user.name = new Name(known[0]);
    user.email = new Email(known[1]);
    return Promise.resolve(user);
  }) as never);

  // The names of related rows the recorder looks up: a policy, a monitor, a team.
  jest
    .spyOn(DatabaseService.prototype, "findBy")
    .mockImplementation((async (findBy: {
      query: { _id: { value?: Array<ObjectID> } };
    }): Promise<Array<BaseModel>> => {
      const rows: Array<BaseModel> = [];

      for (const [id, name] of relatedNames.entries()) {
        const row: Team = new Team(new ObjectID(id));
        row.name = name;
        rows.push(row);
      }

      void findBy;
      return rows;
    }) as never);

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the owners an owner rule's Run now adds (issue #6300)", () => {
  function ownerAdded(): MonitorOwnerUser {
    const owner: MonitorOwnerUser = new MonitorOwnerUser(RECORD_ID);
    owner.projectId = PROJECT_ID;
    owner.monitorId = MONITOR_ID;
    owner.userId = OWNER_ID;
    owner.isOwnerNotified = false;
    owner.createdByUserId = RUNNER_ID;
    return owner;
  }

  test("are a Create on the monitor's page, named after the owner, by whoever ran the rule", async () => {
    await recorder.recordCreate({
      model: new MonitorOwnerUser(),
      createdItem: ownerAdded(),
      props: RuleRunWriteProps.get(PERSON),
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Create);
    expect(entry.resourceType).toBe("Monitor User Owner");
    expect(entry.resourceName).toBe("Grace Hopper");
    expect(entry.rootResourceType).toBe("Monitor");
    expect(entry.rootResourceId?.toString()).toBe(MONITOR_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.userType).toBe(UserType.User);
    expect(String(entry.userId)).toBe(RUNNER_ID.toString());
  });

  test("are kept though the project does not store system events: they are the person's", async () => {
    project = makeProject(false);

    for (const createdItem of [ownerAdded(), new MonitorOwnerTeam(RECORD_ID)]) {
      const record: Record<string, unknown> = createdItem as unknown as Record<
        string,
        unknown
      >;
      record["projectId"] = PROJECT_ID;
      record["monitorId"] = MONITOR_ID;

      await recorder.recordCreate({
        model: new (createdItem.constructor as { new (): BaseModel })(),
        createdItem,
        props: RuleRunWriteProps.get(PERSON),
      });
    }

    expect(inserted).toHaveLength(2);

    for (const entry of inserted) {
      expect(entry.userName).toBe("Ada Lovelace");
    }
  });

  test("written as plain root - as Run now was, and as a rule applied on create is - they are System's, kept only with system events stored", async () => {
    const create: () => Promise<void> = async (): Promise<void> => {
      await recorder.recordCreate({
        model: new MonitorOwnerUser(),
        createdItem: ownerAdded(),
        props: RuleRunWriteProps.get(undefined),
      });
    };

    await create();
    expect(inserted).toHaveLength(0);

    await storingSystemEvents();
    await create();

    expect(onlyEntry().userType).toBe("System");
    expect(onlyEntry().userName).toBeUndefined();
  });

  test("an API key's run is credited to the key", async () => {
    await recorder.recordCreate({
      model: new MonitorOwnerUser(),
      createdItem: ownerAdded(),
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

describe("a record a privacy rule's Run now makes private (issue #6300)", () => {
  function incidentBefore(): Incident {
    const incident: Incident = new Incident(RECORD_ID);
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout is down";
    incident.isPrivate = false;
    return incident;
  }

  test("is an Update by whoever ran the rule: private, from false to true", async () => {
    await recorder.recordUpdate({
      model: new Incident(),
      before: incidentBefore(),
      updatedFields: { isPrivate: true },
      itemId: RECORD_ID,
      props: RuleRunWriteProps.get(PERSON),
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Update);
    expect(entry.resourceName).toBe("Checkout is down");
    expect(entry.userName).toBe("Ada Lovelace");
    expect(changesOf(entry)).toEqual([
      { field: "isPrivate", oldValue: false, newValue: true },
    ]);
  });

  test("applied as the incident is created, it is OneUptime's own", async () => {
    await recorder.recordUpdate({
      model: new Incident(),
      before: incidentBefore(),
      updatedFields: { isPrivate: true },
      itemId: RECORD_ID,
      props: RuleRunWriteProps.get(undefined),
    });

    expect(inserted).toHaveLength(0);
  });
});

describe("a call policy's number bought, attached or released (issue #6301)", () => {
  // A number's row as the routes write it, with its provider's id and settings.
  function numberRow(data: {
    phone: string;
    sid: string;
    config?: ProjectCallSMSConfig | undefined;
  }): IncomingCallPolicyPhoneNumber {
    const row: IncomingCallPolicyPhoneNumber =
      new IncomingCallPolicyPhoneNumber(RECORD_ID);
    row.projectId = PROJECT_ID;
    row.incomingCallPolicyId = POLICY_ID;
    row.projectCallSMSConfigId = CONFIG_ID;
    row.phoneNumber = new Phone(data.phone);
    row.callProviderPhoneNumberId = data.sid;
    row.countryCode = "US";
    row.areaCode = "415";
    row.phoneNumberPurchasedAt = new Date("2026-11-08T10:00:00.000Z");

    if (data.config) {
      row.projectCallSMSConfig = data.config;
    }

    return row;
  }

  function config(accountSid: string, authToken: string): ProjectCallSMSConfig {
    const item: ProjectCallSMSConfig = new ProjectCallSMSConfig(CONFIG_ID);
    item.projectId = PROJECT_ID;
    item.name = "Twilio";
    item.twilioAccountSID = accountSid;
    item.twilioAuthToken = authToken;
    return item;
  }

  test("buying or attaching one is a Create on the policy's page, named after the number, by the person", async () => {
    await recorder.recordCreate({
      model: new IncomingCallPolicyPhoneNumber(),
      createdItem: numberRow({
        phone: "+14155550102",
        sid: "PN0123456789abcdef0123456789abcdef",
      }),
      props: ON_THEIR_BEHALF,
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Create);
    expect(entry.resourceType).toBe("Incoming Call Policy Phone Number");
    expect(entry.resourceName).toBe("+14155550102");
    expect(entry.rootResourceType).toBe("Incoming Call Policy");
    expect(entry.rootResourceId?.toString()).toBe(POLICY_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    // Which policy - the page it is on - and nothing of the provider's.
    expect(fieldsOf(entry)).toEqual(["incomingCallPolicyId"]);
    expect(changesOf(entry)[0]!["newValue"]).toBe(POLICY_ID.toString());
  });

  test("is kept though the project does not store system events: a bought number costs money", async () => {
    project = makeProject(false);

    await recorder.recordCreate({
      model: new IncomingCallPolicyPhoneNumber(),
      createdItem: numberRow({ phone: "+14155550102", sid: "PN1" }),
      props: ON_THEIR_BEHALF,
    });

    expect(inserted).toHaveLength(1);
  });

  test("written as plain root, as it was, it was System's and dropped without system events", async () => {
    await recorder.recordCreate({
      model: new IncomingCallPolicyPhoneNumber(),
      createdItem: numberRow({ phone: "+14155550102", sid: "PN1" }),
      props: { isRoot: true },
    });

    expect(inserted).toHaveLength(0);
  });

  test("releasing one is a Delete named after the number, by the person", async () => {
    await recorder.recordDelete({
      model: new IncomingCallPolicyPhoneNumber(),
      deletedItem: numberRow({ phone: "+14155550103", sid: "PN2" }),
      itemId: RECORD_ID,
      props: ON_THEIR_BEHALF,
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Delete);
    expect(entry.resourceName).toBe("+14155550103");
    expect(entry.userName).toBe("Ada Lovelace");
    expect(fieldsOf(entry)).toEqual(["incomingCallPolicyId"]);
  });

  test("releasing a number a policy kept in its own columns names the number that went, and nothing of the provider's", async () => {
    const before: IncomingCallPolicy = new IncomingCallPolicy(POLICY_ID);
    before.projectId = PROJECT_ID;
    before.name = "Support line";
    before.routingPhoneNumber = new Phone("+14155550100");
    before.callProviderPhoneNumberId = "PNlegacy0123456789";
    before.phoneNumberCountryCode = "US";

    await recorder.recordUpdate({
      model: new IncomingCallPolicy(),
      before,
      updatedFields: {
        routingPhoneNumber: null,
        callProviderPhoneNumberId: null,
        phoneNumberCountryCode: null,
        phoneNumberAreaCode: null,
        phoneNumberPurchasedAt: null,
      },
      itemId: POLICY_ID,
      props: ON_THEIR_BEHALF,
      includeColumns: ["routingPhoneNumber"],
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.resourceName).toBe("Support line");
    expect(entry.userName).toBe("Ada Lovelace");
    // The number that went, and only it: the provider's id for it stays out.
    expect(fieldsOf(entry)).toEqual(["routingPhoneNumber"]);
    expect(JSON.stringify(changesOf(entry)[0]!["oldValue"])).toContain(
      "+14155550100",
    );
    expect(changesOf(entry)[0]!["newValue"]).toBeNull();
    expect(JSON.stringify(entry)).not.toContain("PNlegacy");
  });

  /*
   * Whatever the provider calls the number, and whatever the settings it is
   * bought with hold - its account and token, even handed over with the
   * row - no entry carries any of it: only the number names the entry.
   */
  test("over 300 generated numbers, provider ids and credentials, no entry carries a provider's id or a credential", async () => {
    const random: SeededRandom = seededRandom(6301);
    const hex: string = "0123456789abcdef";
    const draw: (length: number) => string = (length: number): string => {
      let text: string = "";

      for (let index: number = 0; index < length; index++) {
        text += hex[random(hex.length)];
      }

      return text;
    };
    const problems: Array<string> = [];

    for (let run: number = 0; run < 300; run++) {
      inserted = [];

      const phone: string = `+1415${String(1000000 + random(9000000))}`;
      const sid: string = `PN${draw(32)}`;
      const accountSid: string = `AC${draw(32)}`;
      const authToken: string = draw(32);
      const row: IncomingCallPolicyPhoneNumber = numberRow({
        phone,
        sid,
        config: random(2) === 1 ? config(accountSid, authToken) : undefined,
      });
      const props: DatabaseCommonInteractionProps =
        random(2) === 1 ? ON_THEIR_BEHALF : PERSON;

      if (random(2) === 1) {
        await recorder.recordCreate({
          model: new IncomingCallPolicyPhoneNumber(),
          createdItem: row,
          props,
        });
      } else {
        await recorder.recordDelete({
          model: new IncomingCallPolicyPhoneNumber(),
          deletedItem: row,
          itemId: RECORD_ID,
          props,
        });
      }

      const written: string = JSON.stringify(inserted);

      if (inserted.length !== 1 || inserted[0]!.resourceName !== phone) {
        problems.push(`run ${run}: not one entry named ${phone}`);
      }

      for (const secret of [sid, sid.slice(2), accountSid, authToken]) {
        if (written.includes(secret)) {
          problems.push(`run ${run}: carries ${secret}`);
        }
      }

      if (written.includes(CONFIG_ID.toString())) {
        problems.push(`run ${run}: carries the call and SMS settings`);
      }
    }

    expect(problems).toEqual([]);
  });
});

describe("an AI agent reset, on the resource's own page (issue #6302)", () => {
  const RESET_AT: Date = new Date("2026-11-08T10:00:00.000Z");

  function dockerHostBefore(lastResetAt?: Date): DockerHost {
    const row: DockerHost = new DockerHost(RECORD_ID);
    row.projectId = PROJECT_ID;
    row.name = "prod-docker-1";

    if (lastResetAt) {
      row.aiAgentResetAt = lastResetAt;
    }

    return row;
  }

  async function reset(data: {
    model: BaseModel;
    before: BaseModel;
    props?: DatabaseCommonInteractionProps | undefined;
    includeColumns?: Array<string> | undefined;
  }): Promise<void> {
    await recorder.recordUpdate({
      model: data.model,
      before: data.before,
      updatedFields: { aiAgentResetAt: RESET_AT } as unknown as JSONObject,
      itemId: RECORD_ID,
      props: data.props || PERSON,
      includeColumns: data.includeColumns || ["aiAgentResetAt"],
    });
  }

  test("is an Update of the host, on its page, by whoever reset it, saying when", async () => {
    await reset({ model: new DockerHost(), before: dockerHostBefore() });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Update);
    expect(entry.resourceType).toBe("Docker Host");
    expect(entry.resourceName).toBe("prod-docker-1");
    expect(entry.rootResourceType).toBe("Docker Host");
    expect(entry.rootResourceId?.toString()).toBe(RECORD_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    expect(changesOf(entry)).toEqual([
      {
        field: "aiAgentResetAt",
        oldValue: null,
        newValue: "2026-11-08T10:00:00.000Z",
      },
    ]);
  });

  test("a second reset says when the one before was", async () => {
    await reset({
      model: new DockerHost(),
      before: dockerHostBefore(new Date("2026-10-01T09:00:00.000Z")),
    });

    expect(changesOf(onlyEntry())).toEqual([
      {
        field: "aiAgentResetAt",
        oldValue: "2026-10-01T09:00:00.000Z",
        newValue: "2026-11-08T10:00:00.000Z",
      },
    ]);
  });

  test("a Kubernetes cluster's is on the cluster's page", async () => {
    const before: KubernetesCluster = new KubernetesCluster(RECORD_ID);
    before.projectId = PROJECT_ID;
    before.name = "prod-eks";

    await reset({ model: new KubernetesCluster(), before });

    const entry: AuditLog = onlyEntry();

    expect(entry.resourceType).toBe("Kubernetes Cluster");
    expect(entry.rootResourceId?.toString()).toBe(RECORD_ID.toString());
    expect(entry.resourceName).toBe("prod-eks");
    expect(fieldsOf(entry)).toEqual(["aiAgentResetAt"]);
  });

  test("is kept though the project does not store system events: it is the person's", async () => {
    project = makeProject(false);

    await reset({ model: new Host(), before: dockerHostBefore() as never });

    expect(inserted).toHaveLength(1);
  });

  test("the column is OneUptime's: written without naming it, a reset records nothing", async () => {
    await recorder.recordUpdate({
      model: new DockerHost(),
      before: dockerHostBefore(),
      updatedFields: { aiAgentResetAt: RESET_AT } as unknown as JSONObject,
      itemId: RECORD_ID,
      props: PERSON,
    });

    expect(inserted).toHaveLength(0);
  });

  test("what agents report stays out: a host's readings and the agents' own rows record nothing", async () => {
    const before: Host = new Host(RECORD_ID);
    before.projectId = PROJECT_ID;
    before.name = "web-01";
    before.osType = "linux" as never;

    await storingSystemEvents();
    await recorder.recordUpdate({
      model: new Host(),
      before,
      updatedFields: {
        osType: "darwin",
        cpuCores: 16,
        processCount: 412,
      } as unknown as JSONObject,
      itemId: RECORD_ID,
      props: { isRoot: true },
    });

    expect(inserted).toHaveLength(0);

    // The agents' rows are not audited at all: DatabaseService never asks.
    expect(new ResourceAiAgent().enableAuditLogOn).toBeUndefined();
    expect(new KubernetesAiAgent().enableAuditLogOn).toBeUndefined();
  });

  test("a key someone makes for a Cloud AI agent is the account's keys as changed, never a hash", async () => {
    const hashes: Array<string> = [
      "a".repeat(64),
      "b".repeat(64),
      "c".repeat(64),
    ];
    const before: CloudAccount = new CloudAccount(RECORD_ID);
    before.projectId = PROJECT_ID;
    before.name = "Production AWS";
    before.aiAgentKeys = {
      current: { hash: hashes[0], madeAt: "2026-10-01T09:00:00.000Z" },
      pending: [],
    } as unknown as JSONObject;

    await recorder.recordUpdate({
      model: new CloudAccount(),
      before,
      updatedFields: {
        aiAgentKeys: {
          current: { hash: hashes[0], madeAt: "2026-10-01T09:00:00.000Z" },
          pending: [{ hash: hashes[1], madeAt: "2026-11-08T10:00:00.000Z" }],
        },
      } as unknown as JSONObject,
      itemId: RECORD_ID,
      props: PERSON,
      includeColumns: ["aiAgentKeys"],
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.resourceName).toBe("Production AWS");
    expect(entry.userName).toBe("Ada Lovelace");
    expect(changesOf(entry)).toEqual([
      {
        field: "aiAgentKeys",
        oldValue: AUDIT_LOG_REDACTED_VALUE,
        newValue: AUDIT_LOG_REDACTED_VALUE,
      },
    ]);

    for (const hash of hashes) {
      expect(JSON.stringify(entry)).not.toContain(hash);
    }
  });

  /*
   * Whatever a resource's row holds besides - an error the agent reported,
   * keys and hashes of every shape - a reset's entry names when, and only
   * that, on every kind of resource.
   */
  test("over 200 resets of every kind of resource holding generated keys, no entry carries one", async () => {
    const random: SeededRandom = seededRandom(6302);
    const hex: string = "0123456789abcdef";
    const draw: (length: number) => string = (length: number): string => {
      let text: string = "";

      for (let index: number = 0; index < length; index++) {
        text += hex[random(hex.length)];
      }

      return text;
    };
    const kinds: Array<{ new (): BaseModel }> = [
      DockerHost,
      Host,
      KubernetesCluster,
      CloudAccount,
    ];
    const problems: Array<string> = [];

    for (let run: number = 0; run < 200; run++) {
      inserted = [];

      const modelType: { new (): BaseModel } = kinds[random(kinds.length)]!;
      const key: string = `ouca_${RECORD_ID.toString()}_${draw(64)}`;
      const hash: string = draw(64);
      const before: BaseModel = new modelType();
      const record: Record<string, unknown> = before as unknown as Record<
        string,
        unknown
      >;
      before.id = RECORD_ID;
      record["projectId"] = PROJECT_ID;
      record["name"] = `resource-${run}`;
      record["aiAccessLastError"] = `the agent said ${key}`;

      if (before instanceof CloudAccount) {
        record["aiAgentKeys"] = { current: { hash: hash } };
      }

      await reset({
        model: new modelType(),
        before,
        props: random(2) === 1 ? PERSON : ON_THEIR_BEHALF,
      });

      const written: string = JSON.stringify(inserted);

      if (inserted.length !== 1) {
        problems.push(`run ${run}: ${inserted.length} entries`);
        continue;
      }

      if (fieldsOf(inserted[0]!).join(",") !== "aiAgentResetAt") {
        problems.push(`run ${run}: names ${fieldsOf(inserted[0]!).join(",")}`);
      }

      for (const secret of [key, hash, key.slice(-64)]) {
        if (written.includes(secret)) {
          problems.push(`run ${run}: carries ${secret.slice(0, 12)}…`);
        }
      }
    }

    expect(problems).toEqual([]);
  });
});
