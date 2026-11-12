import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WebsiteDownApi from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownApi";
import { parseWebsiteAddress } from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
import AlertOnCallRule from "../../../Models/DatabaseModels/AlertOnCallRule";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRuleTeam from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator } from "../../../Types/Translator";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

/*
 * What the website-down guided setup asks the model API for (issue #6804):
 * the same creates Create Monitor and Create On-Call Policy send, so the
 * server's permissions, plan limits and defaults apply to it as they do to
 * them.
 */

const id: (n: number) => ObjectID = (n: number): ObjectID => {
  return new ObjectID(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
};

const model: <T>(type: { new (): T }, values: Record<string, unknown>) => T = <
  T,
>(
  type: { new (): T },
  values: Record<string, unknown>,
): T => {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
};

const list: <T>(data: Array<T>) => {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
} = <T>(
  data: Array<T>,
): { data: Array<T>; count: number; skip: number; limit: number } => {
  return { data, count: data.length, skip: 0, limit: data.length };
};

// ModelAPI's methods are generic; the spies answer for any model.
type LooseSpy = SpyInstance<(...args: Array<never>) => Promise<unknown>>;

let getListSpy: LooseSpy;
let createSpy: LooseSpy;
let countSpy: LooseSpy;

const seedLists: (data?: {
  statuses?: Array<MonitorStatus>;
  incidentSeverities?: Array<IncidentSeverity>;
}) => void = (data?: {
  statuses?: Array<MonitorStatus>;
  incidentSeverities?: Array<IncidentSeverity>;
}): void => {
  getListSpy.mockImplementation((async (args: {
    modelType: { new (): unknown };
  }) => {
    if (args.modelType === MonitorStatus) {
      return list(
        data?.statuses || [
          model(MonitorStatus, {
            _id: id(1).toString(),
            isOperationalState: true,
          }),
          model(MonitorStatus, { _id: id(2).toString() }),
          model(MonitorStatus, { _id: id(3).toString(), isOfflineState: true }),
        ],
      );
    }

    if (args.modelType === IncidentSeverity) {
      return list(
        data?.incidentSeverities || [
          model(IncidentSeverity, { _id: id(10).toString(), isArchived: true }),
          model(IncidentSeverity, { _id: id(11).toString() }),
          model(IncidentSeverity, { _id: id(12).toString() }),
        ],
      );
    }

    if (args.modelType === AlertSeverity) {
      return list([model(AlertSeverity, { _id: id(20).toString() })]);
    }

    return list([]);
  }) as unknown as (...args: Array<never>) => Promise<unknown>);
};

beforeEach(() => {
  getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as LooseSpy;
  createSpy = jest.spyOn(ModelAPI, "create") as unknown as LooseSpy;
  countSpy = jest.spyOn(ModelAPI, "count") as unknown as LooseSpy;
  seedLists();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the monitor", () => {
  test("its criteria take the project's operational and offline statuses and its most severe live severities", async () => {
    expect(await WebsiteDownApi.loadMonitorSeeds()).toEqual({
      operationalStatusId: id(1),
      offlineStatusId: id(3),
      incidentSeverityId: id(11),
      alertSeverityId: id(20),
    });
  });

  test("a project missing a status or severity says so rather than making a monitor nothing evaluates", async () => {
    seedLists({
      statuses: [
        model(MonitorStatus, {
          _id: id(1).toString(),
          isOperationalState: true,
        }),
      ],
    });

    await expect(WebsiteDownApi.loadMonitorSeeds()).rejects.toThrow(
      /missing its monitor statuses or severities/,
    );

    seedLists({
      incidentSeverities: [
        model(IncidentSeverity, { _id: id(10).toString(), isArchived: true }),
      ],
    });

    await expect(WebsiteDownApi.loadMonitorSeeds()).rejects.toThrow(
      /missing its monitor statuses or severities/,
    );
  });

  test("is made through the model API, with no probes named: the server adds a new monitor's", async () => {
    createSpy.mockResolvedValue({
      data: model(Monitor, { _id: id(99).toString() }),
    });

    const monitorId: string = await WebsiteDownApi.createMonitor({
      address: parseWebsiteAddress("acme.example")!,
      isApi: false,
      translator: createTranslator(undefined, "en"),
    });

    expect(monitorId).toBe(id(99).toString());
    expect(createSpy).toHaveBeenCalledTimes(1);

    const call: Parameters<typeof ModelAPI.create>[0] = createSpy.mock
      .calls[0]![0] as unknown as Parameters<typeof ModelAPI.create>[0];
    const created: Monitor = call.model as Monitor;

    expect(call.modelType).toBe(Monitor);
    expect(call.miscDataProps).toBeUndefined();
    expect(created.name).toBe("acme.example");
    expect(created.monitorType).toBe(MonitorType.Website);
    expect(created.monitorSteps?.data?.defaultMonitorStatusId?.toString()).toBe(
      id(1).toString(),
    );
  });

  test("a create that answers without an id is an error, not a monitor that can't be found", async () => {
    createSpy.mockResolvedValue({
      data: {},
    });

    await expect(
      WebsiteDownApi.createMonitor({
        address: parseWebsiteAddress("acme.example")!,
        isApi: true,
        translator: createTranslator(undefined, "en"),
      }),
    ).rejects.toThrow("The monitor was made, but it can't be shown.");
  });

  test("a monitor that is gone reads as null", async () => {
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null);

    expect(await WebsiteDownApi.loadMonitor(id(99).toString())).toBeNull();
  });
});

describe("the first check", () => {
  test("reads the monitor's enabled probes and their latest answers", async () => {
    getListSpy.mockResolvedValue(
      list([
        model(MonitorProbe, {
          lastMonitoringLog: {
            step: {
              isOnline: true,
              responseCode: 200,
              responseTimeInMs: 120,
            },
          },
        }),
        model(MonitorProbe, {}),
      ]),
    );

    expect(await WebsiteDownApi.loadFirstCheck(id(99).toString())).toEqual({
      locationCount: 2,
      answers: [
        {
          isOnline: true,
          responseCode: 200,
          responseTimeInMs: 120,
          failureCause: undefined,
        },
      ],
    });

    const query: Record<string, unknown> = (
      getListSpy.mock.calls[0]![0] as unknown as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(getListSpy.mock.calls[0]![0]).toMatchObject({
      modelType: MonitorProbe,
    });
    expect(String(query["monitorId"])).toBe(id(99).toString());
    expect(query["isEnabled"]).toBe(true);
  });
});

describe("who is told", () => {
  const allow: (allowed: boolean) => void = (allowed: boolean): void => {
    jest
      .spyOn(PermissionGate, "check")
      .mockImplementation((): PermissionGateResult => {
        return { isAllowed: allowed };
      });
  };

  test("counts the project's policies and both kinds of on-call rules, and reads the permissions", async () => {
    allow(true);
    countSpy.mockImplementation((async (args: {
      modelType: { new (): unknown };
    }) => {
      return args.modelType === OnCallDutyPolicy
        ? 0
        : args.modelType === IncidentOnCallRule
          ? 2
          : args.modelType === AlertOnCallRule
            ? 3
            : -1;
    }) as unknown as (...args: Array<never>) => Promise<unknown>);

    expect(await WebsiteDownApi.loadWhoIsToldFacts()).toEqual({
      policyCount: 0,
      incidentRuleCount: 2,
      alertRuleCount: 3,
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    });
  });

  test("counts that fail are unknown, never zero", async () => {
    allow(false);
    countSpy.mockRejectedValue(new Error("offline"));

    expect(await WebsiteDownApi.loadWhoIsToldFacts()).toEqual({
      policyCount: null,
      incidentRuleCount: null,
      alertRuleCount: null,
      mayCreatePolicy: false,
      mayAddEscalationRules: false,
      mayAddRules: false,
    });
  });

  test("the policy is made with who is paged first and the two catch-all rules, as Create On-Call Policy sends them", async () => {
    createSpy.mockResolvedValue({
      data: model(OnCallDutyPolicy, { _id: id(50).toString() }),
    });

    expect(
      await WebsiteDownApi.createPolicy({
        userIds: [id(1).toString()],
        teamIds: [id(2).toString()],
      }),
    ).toBe(id(50).toString());

    const call: Parameters<typeof ModelAPI.create>[0] = createSpy.mock
      .calls[0]![0] as unknown as Parameters<typeof ModelAPI.create>[0];

    expect(call.modelType).toBe(OnCallDutyPolicy);
    expect((call.model as OnCallDutyPolicy).name).toBe(
      "Default on-call policy",
    );
    expect(call.miscDataProps).toEqual({
      users: [id(1).toString()],
      teams: [id(2).toString()],
      pageForEveryNewIncidentAndAlert: true,
    });
  });

  test("the policy is read back with who it pages, people and teams, each once", async () => {
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(
      model(OnCallDutyPolicy, {
        _id: id(50).toString(),
        name: "Default on-call policy",
      }),
    );
    getListSpy.mockImplementation((async (args: {
      modelType: { new (): unknown };
    }) => {
      if (args.modelType === OnCallDutyPolicyEscalationRuleUser) {
        return list([
          model(OnCallDutyPolicyEscalationRuleUser, {
            user: model(User, { name: "Ada Lovelace" }),
          }),
          model(OnCallDutyPolicyEscalationRuleUser, {
            user: model(User, { name: "Ada Lovelace" }),
          }),
          model(OnCallDutyPolicyEscalationRuleUser, {
            user: model(User, {
              email: "grace@example.com",
            }),
          }),
        ]);
      }

      return list([
        model(OnCallDutyPolicyEscalationRuleTeam, {
          team: model(Team, { name: "Platform" }),
        }),
      ]);
    }) as unknown as (...args: Array<never>) => Promise<unknown>);

    expect(await WebsiteDownApi.loadPolicy(id(50).toString())).toEqual({
      id: id(50).toString(),
      name: "Default on-call policy",
      responders: ["Ada Lovelace", "grace@example.com", "Platform"],
    });
  });

  test("a policy that is gone reads as null", async () => {
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null);

    expect(await WebsiteDownApi.loadPolicy(id(50).toString())).toBeNull();
  });
});

describe("the summary's other records", () => {
  test("ownership: true only when the person owns the monitor, false when it can't be read", async () => {
    countSpy.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

    expect(
      await WebsiteDownApi.isMonitorOwner({
        monitorId: id(99).toString(),
        userId: id(1).toString(),
      }),
    ).toBe(true);
    expect(
      await WebsiteDownApi.isMonitorOwner({
        monitorId: id(99).toString(),
        userId: id(1).toString(),
      }),
    ).toBe(false);

    countSpy.mockRejectedValue(new Error("offline"));

    expect(
      await WebsiteDownApi.isMonitorOwner({
        monitorId: id(99).toString(),
        userId: id(1).toString(),
      }),
    ).toBe(false);
  });

  test("the severity's name, or nothing when there is none to read", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(model(IncidentSeverity, { name: "Critical" }));

    expect(
      await WebsiteDownApi.loadIncidentSeverityName(id(11).toString()),
    ).toBe("Critical");
    expect(await WebsiteDownApi.loadIncidentSeverityName(null)).toBeNull();
  });
});
