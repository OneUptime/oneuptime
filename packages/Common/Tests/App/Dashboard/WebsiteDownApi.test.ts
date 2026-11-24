import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import WebsiteDownApi, {
  FirstCheckState,
  OTHER_MONITORS_READ_LIMIT,
  OWN_MONITORS_READ_LIMIT,
  STATUS_PAGES_READ_LIMIT,
  WebsiteDownFoundMonitor,
  WebsiteDownMonitorRecord,
  isPaymentRequired,
  mayAddMonitorOwner,
  mayAddPaymentMethod,
  mayAddToStatusPage,
  mayUseOnCallSetup,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownApi";
import StatusPageSetupApi from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/StatusPage/StatusPageSetupApi";
import ProbeUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Probe";
import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import { isProjectOnFreePlan } from "../../../../App/FeatureSet/Dashboard/src/Utils/PayAsYouGo";
import BillingPaymentMethod from "../../../Models/DatabaseModels/BillingPaymentMethod";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
  getNameTakenRefusalText,
} from "../../../Types/Database/UniqueName";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import API from "../../../UI/Utils/API/API";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  WhoIsToldFacts,
  WhoIsToldMode,
  buildWebsiteMonitor,
  getWhoIsToldMode,
  parseWebsiteAddress,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/WebsiteDown/WebsiteDownSetup";
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
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { createTranslator } from "../../../Types/Translator";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";
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

/*
 * THIS PERSON'S OWN MONITOR FOR AN ADDRESS (#7059): looked for before a
 * monitor is made, so a run the browser lost makes no second one.
 */
describe("this person's own monitor for an address", () => {
  const ME: string = id(7).toString();

  // A monitor as the list read answers it, made for `text` the way the setup makes one.
  const monitorFor: (
    n: number,
    text: string,
    values?: Record<string, unknown>,
  ) => Monitor = (
    n: number,
    text: string,
    values?: Record<string, unknown>,
  ): Monitor => {
    const made: Monitor = buildWebsiteMonitor({
      address: parseWebsiteAddress(text)!,
      isApi: false,
      seeds: {
        operationalStatusId: id(1),
        offlineStatusId: id(3),
        incidentSeverityId: id(11),
        alertSeverityId: id(20),
      },
    });

    return model(Monitor, {
      _id: id(n).toString(),
      name: made.name,
      monitorSteps: made.monitorSteps,
      monitoringInterval: made.monitoringInterval,
      ...(values || {}),
    });
  };

  const answer: (monitors: Array<Monitor>) => void = (
    monitors: Array<Monitor>,
  ): void => {
    getListSpy.mockResolvedValue(list(monitors));
  };

  const find: (text: string) => Promise<WebsiteDownMonitorRecord | null> = (
    text: string,
  ): Promise<WebsiteDownMonitorRecord | null> => {
    return WebsiteDownApi.findOwnMonitor({
      address: parseWebsiteAddress(text)!,
      userId: ME,
    });
  };

  test("reads the newest Website and API monitors this person made, with what decides a match", async () => {
    answer([]);

    expect(await find("acme.example")).toBeNull();
    expect(getListSpy).toHaveBeenCalledTimes(1);

    const call: {
      modelType: unknown;
      query: Record<string, unknown>;
      limit: number;
      skip: number;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = getListSpy.mock.calls[0]![0] as unknown as {
      modelType: unknown;
      query: Record<string, unknown>;
      limit: number;
      skip: number;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    };

    expect(call.modelType).toBe(Monitor);
    // Made by this person: a teammate's monitor is not this run's.
    expect(String(call.query["createdByUserId"])).toBe(ME);
    expect(call.query["monitorType"]).toBeInstanceOf(Includes);
    expect((call.query["monitorType"] as Includes).values).toEqual([
      MonitorType.Website,
      MonitorType.API,
    ]);
    expect(Object.keys(call.query).sort()).toEqual([
      "createdByUserId",
      "monitorType",
    ]);
    // The newest first: the one a lost run made is the newest.
    expect(call.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(call.limit).toBe(OWN_MONITORS_READ_LIMIT);
    expect(OWN_MONITORS_READ_LIMIT).toBe(100);
    expect(call.skip).toBe(0);
    expect(call.select).toEqual({
      _id: true,
      name: true,
      monitorSteps: true,
      monitoringInterval: true,
      // How many probes must agree: what the first check's words follow (#7410).
      minimumProbeAgreement: true,
      isArchived: true,
      disableActiveMonitoring: true,
    });
  });

  test("the newest that checks the address now, typed any way; archived, turned off and other addresses passed by", async () => {
    const theirs: Monitor = monitorFor(7, "https://acme.example/", {
      name: "Acme website",
    });

    // The newest first, as the read sorts them.
    answer([
      monitorFor(1, "acme.example", { isArchived: true }),
      monitorFor(2, "acme.example", { disableActiveMonitoring: true }),
      monitorFor(3, "status.acme.example"),
      monitorFor(4, "http://acme.example"),
      monitorFor(5, "www.acme.example"),
      monitorFor(6, "acme.example/health"),
      theirs,
      monitorFor(8, "acme.example", { name: "An older one" }),
    ]);

    const found: WebsiteDownMonitorRecord | null = await find("ACME.example");

    expect(found).toEqual({
      id: id(7).toString(),
      name: "Acme website",
      monitorSteps: theirs.monitorSteps,
      monitoringInterval: "*/5 * * * *",
      // Not set: all of its probes must agree.
      minimumProbeAgreement: null,
    });
    // Its steps as read: the setup's first check and summary read them.
    expect(found!.monitorSteps).toBe(theirs.monitorSteps);
  });

  test("an API monitor for the address is one too", async () => {
    const made: Monitor = buildWebsiteMonitor({
      address: parseWebsiteAddress("https://api.acme.example/health")!,
      isApi: true,
      seeds: {
        operationalStatusId: id(1),
        offlineStatusId: id(3),
        incidentSeverityId: id(11),
        alertSeverityId: id(20),
      },
    });
    answer([
      model(Monitor, {
        _id: id(9).toString(),
        name: made.name,
        monitorSteps: made.monitorSteps,
        monitoringInterval: made.monitoringInterval,
      }),
    ]);

    expect((await find("api.acme.example/health/"))?.id).toBe(id(9).toString());
  });

  test("a monitor read without a name is named nothing, not undefined", async () => {
    answer([monitorFor(3, "acme.example", { name: undefined })]);

    expect((await find("acme.example"))?.name).toBe("");
  });

  test("none that checks it: null, and nothing else is read or made", async () => {
    answer([
      monitorFor(1, "status.acme.example"),
      monitorFor(2, "acme.example", { isArchived: true }),
    ]);

    expect(await find("acme.example")).toBeNull();
    expect(getListSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("a monitor with no first step, or no id, is passed by for the next one", async () => {
    answer([
      model(Monitor, { _id: id(1).toString(), name: "acme.example" }),
      model(Monitor, {
        name: "acme.example",
        monitorSteps: monitorFor(2, "acme.example").monitorSteps,
      }),
      monitorFor(3, "acme.example"),
    ]);

    expect((await find("acme.example"))?.id).toBe(id(3).toString());

    answer([model(Monitor, { _id: id(1).toString(), name: "acme.example" })]);

    expect(await find("acme.example")).toBeNull();
  });

  test("with no one signed in there is nobody's monitor to look for: null, and nothing is read", async () => {
    expect(
      await WebsiteDownApi.findOwnMonitor({
        address: parseWebsiteAddress("acme.example")!,
        userId: "",
      }),
    ).toBeNull();
    expect(getListSpy).not.toHaveBeenCalled();
  });

  test("a read that fails throws: a monitor is never made on a guess", async () => {
    getListSpy.mockRejectedValue(new Error("offline"));

    await expect(find("acme.example")).rejects.toThrow("offline");
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
      // A probe whose connection was not read counts as connected.
      activeLocationCount: 2,
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
    // Each probe's connection: a disconnected one checks nothing (#7410).
    expect(
      (
        getListSpy.mock.calls[0]![0] as unknown as {
          select: Record<string, unknown>;
        }
      ).select,
    ).toEqual({
      _id: true,
      lastMonitoringLog: true,
      probe: { connectionStatus: true },
    });
  });

  test("a disconnected probe is left out, its old answer with it, as the probe agreement leaves it out", async () => {
    const probe: (
      connectionStatus: ProbeConnectionStatus | undefined,
      isOnline: boolean,
    ) => MonitorProbe = (
      connectionStatus: ProbeConnectionStatus | undefined,
      isOnline: boolean,
    ): MonitorProbe => {
      return model(MonitorProbe, {
        probe: model(Probe, { connectionStatus: connectionStatus }),
        lastMonitoringLog: {
          step: { isOnline: isOnline, responseCode: isOnline ? 200 : 503 },
        },
      });
    };

    getListSpy.mockResolvedValue(
      list([
        probe(ProbeConnectionStatus.Connected, true),
        probe(ProbeConnectionStatus.Disconnected, false),
        probe(undefined, true),
      ]),
    );

    const state: FirstCheckState = await WebsiteDownApi.loadFirstCheck(
      id(99).toString(),
    );

    expect(state.locationCount).toBe(3);
    expect(state.activeLocationCount).toBe(2);
    expect(
      state.answers.map((answer: { responseCode?: number | undefined }) => {
        return answer.responseCode;
      }),
    ).toEqual([200, 200]);
  });

  test("the monitor is read with its probe agreement", async () => {
    const getItemSpy: LooseSpy = jest
      .spyOn(ModelAPI, "getItem")
      .mockResolvedValue(
        model(Monitor, {
          _id: id(99).toString(),
          name: "acme.example",
          minimumProbeAgreement: 2,
        }),
      ) as unknown as LooseSpy;

    const record: WebsiteDownMonitorRecord | null =
      await WebsiteDownApi.loadMonitor(id(99).toString());

    expect(record?.minimumProbeAgreement).toBe(2);
    expect(
      (
        getItemSpy.mock.calls[0]![0] as unknown as {
          select: Record<string, unknown>;
        }
      ).select,
    ).toMatchObject({ minimumProbeAgreement: true });

    // Not set: null, which is all of them.
    getItemSpy.mockResolvedValue(
      model(Monitor, { _id: id(99).toString(), name: "acme.example" }),
    );
    expect(
      (await WebsiteDownApi.loadMonitor(id(99).toString()))
        ?.minimumProbeAgreement,
    ).toBeNull();
  });
});

/*
 * THE PERSON SETTING IT UP OWNS THE MONITOR (#7409): the creator of an
 * operational resource is made its owner - but never a master admin, and
 * the first person to sign up to a self-hosted server is one.
 */
describe("making the person its owner", () => {
  const ME: string = id(7).toString();
  const MONITOR: string = id(99).toString();

  const allowOwners: (allowed: boolean) => void = (allowed: boolean): void => {
    jest
      .spyOn(PermissionGate, "check")
      .mockImplementation((): PermissionGateResult => {
        return { isAllowed: allowed };
      });
  };

  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(id(500));
  });

  test("an owner already - the creator, as the server makes them - is left as they are", async () => {
    allowOwners(true);
    countSpy.mockResolvedValue(1);

    expect(
      await WebsiteDownApi.ensureMonitorOwner({
        monitorId: MONITOR,
        userId: ME,
      }),
    ).toBe(true);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("not one - a master admin - is made one, quietly, and read back", async () => {
    allowOwners(true);
    countSpy.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    createSpy.mockResolvedValue({ data: model(MonitorOwnerUser, {}) });

    expect(
      await WebsiteDownApi.ensureMonitorOwner({
        monitorId: MONITOR,
        userId: ME,
      }),
    ).toBe(true);
    expect(createSpy).toHaveBeenCalledTimes(1);

    const call: { model: MonitorOwnerUser; modelType: unknown } = createSpy.mock
      .calls[0]![0] as unknown as {
      model: MonitorOwnerUser;
      modelType: unknown;
    };

    expect(call.modelType).toBe(MonitorOwnerUser);
    expect(call.model.monitorId?.toString()).toBe(MONITOR);
    expect(call.model.userId?.toString()).toBe(ME);
    expect(call.model.projectId?.toString()).toBe(id(500).toString());
    // Their own row: nobody is told they were made an owner.
    expect(call.model.isOwnerNotified).toBe(true);

    // Asked of the records, both times, for this monitor and this person.
    for (const countCall of countSpy.mock.calls) {
      const query: Record<string, unknown> = (
        countCall[0] as unknown as { query: Record<string, unknown> }
      ).query;

      expect(
        (countCall[0] as unknown as { modelType: unknown }).modelType,
      ).toBe(MonitorOwnerUser);
      expect(String(query["monitorId"])).toBe(MONITOR);
      expect(String(query["userId"])).toBe(ME);
    }
  });

  test("a create that fails: what the records say decides", async () => {
    allowOwners(true);
    createSpy.mockRejectedValue(new Error("already an owner"));

    // Another tab made them one meanwhile.
    countSpy.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    expect(
      await WebsiteDownApi.ensureMonitorOwner({
        monitorId: MONITOR,
        userId: ME,
      }),
    ).toBe(true);

    // Refused, and not one.
    countSpy.mockResolvedValue(0);
    expect(
      await WebsiteDownApi.ensureMonitorOwner({
        monitorId: MONITOR,
        userId: ME,
      }),
    ).toBe(false);
  });

  test("someone who may not add an owner is not, and nothing is sent", async () => {
    allowOwners(false);
    countSpy.mockResolvedValue(0);

    expect(
      await WebsiteDownApi.ensureMonitorOwner({
        monitorId: MONITOR,
        userId: ME,
      }),
    ).toBe(false);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("with no one signed in there is nobody to make an owner", async () => {
    allowOwners(true);

    expect(
      await WebsiteDownApi.ensureMonitorOwner({
        monitorId: MONITOR,
        userId: "",
      }),
    ).toBe(false);
    expect(countSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("asks the permission to add a monitor owner", () => {
    const checkSpy: LooseSpy = jest
      .spyOn(PermissionGate, "check")
      .mockReturnValue({ isAllowed: true }) as unknown as LooseSpy;

    expect(mayAddMonitorOwner()).toBe(true);
    expect(checkSpy.mock.calls[0]![0]).toBeInstanceOf(MonitorOwnerUser);
  });
});

/*
 * A PAYMENT METHOD BEFORE START CHECKING (#7367): asked on Cloud's Free plan
 * only, as the server asks it.
 */
describe("whether a payment method is needed first", () => {
  test("off Cloud's Free plan nothing is asked: self-hosted is never billed", async () => {
    const getSpy: LooseSpy = jest.spyOn(API, "get") as unknown as LooseSpy;

    expect(isProjectOnFreePlan()).toBe(false);
    expect(await WebsiteDownApi.needsPaymentMethod()).toBe(false);
    expect(getSpy).not.toHaveBeenCalled();
  });

  test("a refusal for want of one is the server's 402, and nothing else", () => {
    expect(
      isPaymentRequired(new HTTPErrorResponse(402, { message: "Pay" }, {})),
    ).toBe(true);
    expect(
      isPaymentRequired(new HTTPErrorResponse(400, { message: "Bad" }, {})),
    ).toBe(false);
    expect(
      isPaymentRequired(new HTTPErrorResponse(403, { message: "No" }, {})),
    ).toBe(false);
    expect(isPaymentRequired(new Error("402"))).toBe(false);
    expect(isPaymentRequired(null)).toBe(false);
    expect(ExceptionCode.PaymentRequiredException).toBe(402);
  });

  test("asks the permission to add a payment method, as the billing page's button does", () => {
    const checkSpy: LooseSpy = jest
      .spyOn(PermissionGate, "check")
      .mockReturnValue({ isAllowed: false }) as unknown as LooseSpy;

    expect(mayAddPaymentMethod()).toBe(false);
    expect(checkSpy.mock.calls[0]![0]).toBeInstanceOf(BillingPaymentMethod);
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

  // An on-call rule, read with its policies: each one's isArchived given.
  const rule: <T>(
    type: { new (): T },
    policiesArchived: Array<boolean | undefined>,
  ) => T = <T>(
    type: { new (): T },
    policiesArchived: Array<boolean | undefined>,
  ): T => {
    return model(type, {
      _id: ObjectID.generate().toString(),
      onCallDutyPolicies: policiesArchived.map(
        (isArchived: boolean | undefined): OnCallDutyPolicy => {
          return model(OnCallDutyPolicy, {
            _id: ObjectID.generate().toString(),
            ...(isArchived === undefined ? {} : { isArchived: isArchived }),
          });
        },
      ),
    });
  };

  // The project's on-call rules, as a list of them answers.
  const serveRules: (rules: {
    incident?: Array<Array<boolean | undefined>> | undefined;
    alert?: Array<Array<boolean | undefined>> | undefined;
  }) => void = (rules: {
    incident?: Array<Array<boolean | undefined>> | undefined;
    alert?: Array<Array<boolean | undefined>> | undefined;
  }): void => {
    getListSpy.mockImplementation((async (args: {
      modelType: { new (): unknown };
    }) => {
      if (args.modelType === IncidentOnCallRule) {
        return list(
          (rules.incident || []).map(
            (policies: Array<boolean | undefined>): IncidentOnCallRule => {
              return rule(IncidentOnCallRule, policies);
            },
          ),
        );
      }

      if (args.modelType === AlertOnCallRule) {
        return list(
          (rules.alert || []).map(
            (policies: Array<boolean | undefined>): AlertOnCallRule => {
              return rule(AlertOnCallRule, policies);
            },
          ),
        );
      }

      return list([]);
    }) as unknown as (...args: Array<never>) => Promise<unknown>);
  };

  test("counts the project's policies and both kinds of on-call rules, and reads the permissions", async () => {
    allow(true);
    countSpy.mockImplementation((async (args: {
      modelType: { new (): unknown };
    }) => {
      return args.modelType === OnCallDutyPolicy ? 1 : -1;
    }) as unknown as (...args: Array<never>) => Promise<unknown>);
    serveRules({
      incident: [[false], [false, true]],
      alert: [[false], [false], [false]],
    });

    expect(await WebsiteDownApi.loadWhoIsToldFacts()).toEqual({
      policyCount: 1,
      incidentRuleCount: 2,
      alertRuleCount: 3,
      mayCreatePolicy: true,
      mayAddEscalationRules: true,
      mayAddRules: true,
    });
  });

  /*
   * An on-call rule pages people only through a policy in service (#8433).
   * Counted whatever it ran, a project whose only policy was archived, with
   * the rules that run it, was told its own policies and rules decide who
   * is paged, and the setup made nothing: nobody was paged when the monitor
   * opened an incident. The rules are read with their policies, and one
   * counts only when it runs a policy in service, as WhoIsToldService and
   * Setup Health judge a project.
   */
  describe("on-call rules count only when they run a policy in service (#8433)", () => {
    const facts: (data: {
      policies: number;
      incident?: Array<Array<boolean | undefined>>;
      alert?: Array<Array<boolean | undefined>>;
    }) => Promise<WhoIsToldFacts> = async (data: {
      policies: number;
      incident?: Array<Array<boolean | undefined>>;
      alert?: Array<Array<boolean | undefined>>;
    }): Promise<WhoIsToldFacts> => {
      allow(true);
      countSpy.mockImplementation((async (args: {
        modelType: { new (): unknown };
      }) => {
        return args.modelType === OnCallDutyPolicy ? data.policies : -1;
      }) as unknown as (...args: Array<never>) => Promise<unknown>);
      serveRules({ incident: data.incident, alert: data.alert });

      return await WebsiteDownApi.loadWhoIsToldFacts();
    };

    test("the rules are read with each policy's archived flag, one list each, never just counted", async () => {
      await facts({ policies: 0 });

      for (const type of [IncidentOnCallRule, AlertOnCallRule]) {
        const calls: Array<Array<unknown>> = getListSpy.mock.calls.filter(
          (call: Array<unknown>): boolean => {
            return (call[0] as { modelType: unknown }).modelType === type;
          },
        );

        expect(calls).toHaveLength(1);
        expect(calls[0]![0]).toEqual(
          expect.objectContaining({
            query: {},
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              _id: true,
              onCallDutyPolicies: { _id: true, isArchived: true },
            },
          }),
        );
      }

      // Only the policies are counted: a rule's count says nothing of what it runs.
      expect(
        countSpy.mock.calls.map((call: Array<unknown>): unknown => {
          return (call[0] as { modelType: unknown }).modelType;
        }),
      ).toEqual([OnCallDutyPolicy]);
    });

    test("the issue's project: its only policy archived, and the two rules that run it - none count, and the setup makes a policy", async () => {
      const read: WhoIsToldFacts = await facts({
        policies: 0,
        incident: [[true]],
        alert: [[true]],
      });

      expect(read.incidentRuleCount).toBe(0);
      expect(read.alertRuleCount).toBe(0);
      expect(getWhoIsToldMode(read)).toBe(WhoIsToldMode.CreatePolicy);
    });

    test("a rule running several policies, all archived, does not count", async () => {
      const read: WhoIsToldFacts = await facts({
        policies: 0,
        incident: [[true, true, true]],
      });

      expect(read.incidentRuleCount).toBe(0);
      expect(getWhoIsToldMode(read)).toBe(WhoIsToldMode.CreatePolicy);
    });

    test("a rule that runs no policy at all pages no one, and does not count", async () => {
      const read: WhoIsToldFacts = await facts({
        policies: 0,
        incident: [[]],
        alert: [[]],
      });

      expect(read.incidentRuleCount).toBe(0);
      expect(read.alertRuleCount).toBe(0);
      expect(getWhoIsToldMode(read)).toBe(WhoIsToldMode.CreatePolicy);
    });

    test("a rule running an archived policy beside one in service counts", async () => {
      const read: WhoIsToldFacts = await facts({
        policies: 1,
        incident: [[true, false]],
      });

      expect(read.incidentRuleCount).toBe(1);
      expect(getWhoIsToldMode(read)).toBe(WhoIsToldMode.ExistingPolicy);
    });

    test("only the rules that page anyone are counted, kind by kind", async () => {
      const read: WhoIsToldFacts = await facts({
        policies: 2,
        incident: [[false], [true], [], [true, false], [false, false]],
        alert: [[true], [false]],
      });

      expect(read.incidentRuleCount).toBe(3);
      expect(read.alertRuleCount).toBe(1);
    });

    test("a policy read with no archived flag counts as in service, as the server reads it", async () => {
      const read: WhoIsToldFacts = await facts({
        policies: 1,
        alert: [[undefined]],
      });

      expect(read.alertRuleCount).toBe(1);
    });

    test("an alert rule alone that runs a policy in service still means the project pages people already", async () => {
      const read: WhoIsToldFacts = await facts({
        policies: 0,
        alert: [[false]],
      });

      expect(getWhoIsToldMode(read)).toBe(WhoIsToldMode.ExistingPolicy);
    });

    test("rules that cannot be read are unknown, never none: nothing is made on a guess", async () => {
      allow(true);
      countSpy.mockResolvedValue(0 as never);
      getListSpy.mockRejectedValue(new Error("offline"));

      const read: WhoIsToldFacts = await WebsiteDownApi.loadWhoIsToldFacts();

      expect(read.incidentRuleCount).toBeNull();
      expect(read.alertRuleCount).toBeNull();
      expect(getWhoIsToldMode(read)).toBe(WhoIsToldMode.OwnerEmailOnly);
    });

    test("a list that answers without its rows is unknown too", async () => {
      allow(true);
      countSpy.mockResolvedValue(0 as never);
      getListSpy.mockResolvedValue({} as never);

      const read: WhoIsToldFacts = await WebsiteDownApi.loadWhoIsToldFacts();

      expect(read.incidentRuleCount).toBeNull();
      expect(getWhoIsToldMode(read)).toBe(WhoIsToldMode.OwnerEmailOnly);
    });
  });

  /*
   * An archived policy pages no one (#8234): a project whose only policies
   * are archived has no policy yet, and is offered one, as the monitor's
   * "When this goes down" and Setup Health count it. The fake server counts
   * as the real one does: only the records the query matches.
   */
  describe("only policies in service count (#8234)", () => {
    const serve: (
      policies: Array<{ isArchived: boolean }>,
      rules?: {
        incident?: Array<Array<boolean>>;
        alert?: Array<Array<boolean>>;
      },
    ) => void = (
      policies: Array<{ isArchived: boolean }>,
      rules?: {
        incident?: Array<Array<boolean>>;
        alert?: Array<Array<boolean>>;
      },
    ): void => {
      allow(true);
      serveRules(rules || {});
      countSpy.mockImplementation((async (args: {
        modelType: { new (): unknown };
        query: Record<string, unknown>;
      }) => {
        return policies.filter((policy: Record<string, unknown>): boolean => {
          return Object.entries(args.query).every(
            ([column, value]: [string, unknown]): boolean => {
              return policy[column] === value;
            },
          );
        }).length;
      }) as unknown as (...args: Array<never>) => Promise<unknown>);
    };

    test("the policies are counted as the On-Call Policies list shows them: archived ones left out", async () => {
      serve([]);
      await WebsiteDownApi.loadWhoIsToldFacts();

      const policyCounts: Array<Array<unknown>> = countSpy.mock.calls.filter(
        (call: Array<unknown>): boolean => {
          return (
            (call[0] as { modelType: unknown }).modelType === OnCallDutyPolicy
          );
        },
      );

      expect(policyCounts).toHaveLength(1);
      expect((policyCounts[0]![0] as { query: unknown }).query).toEqual({
        isArchived: false,
      });
    });

    test("a project whose only policy is archived has none, and the setup makes one", async () => {
      serve([{ isArchived: true }]);

      const facts: WhoIsToldFacts = await WebsiteDownApi.loadWhoIsToldFacts();

      expect(facts.policyCount).toBe(0);
      expect(getWhoIsToldMode(facts)).toBe(WhoIsToldMode.CreatePolicy);
    });

    test("several archived policies are still none", async () => {
      serve([{ isArchived: true }, { isArchived: true }, { isArchived: true }]);

      const facts: WhoIsToldFacts = await WebsiteDownApi.loadWhoIsToldFacts();

      expect(facts.policyCount).toBe(0);
      expect(getWhoIsToldMode(facts)).toBe(WhoIsToldMode.CreatePolicy);
    });

    test("one in service beside archived ones: the project's policies decide", async () => {
      serve([{ isArchived: true }, { isArchived: false }]);

      const facts: WhoIsToldFacts = await WebsiteDownApi.loadWhoIsToldFacts();

      expect(facts.policyCount).toBe(1);
      expect(getWhoIsToldMode(facts)).toBe(WhoIsToldMode.ExistingPolicy);
    });

    /*
     * The rules that run the archived policy page no one either (#8433):
     * the project's only policy archived, its rule with it, is one with no
     * policy yet.
     */
    test("an on-call rule that runs only the archived policy does not mean the project pages people", async () => {
      serve([{ isArchived: true }], { incident: [[true]] });

      const read: WhoIsToldFacts = await WebsiteDownApi.loadWhoIsToldFacts();

      expect(read.incidentRuleCount).toBe(0);
      expect(getWhoIsToldMode(read)).toBe(WhoIsToldMode.CreatePolicy);
    });

    test("one in service beside archived ones, its rule with it: the project's policies and rules decide", async () => {
      serve([{ isArchived: true }, { isArchived: false }], {
        incident: [[true]],
        alert: [[false]],
      });

      const read: WhoIsToldFacts = await WebsiteDownApi.loadWhoIsToldFacts();

      expect(read.policyCount).toBe(1);
      expect(read.incidentRuleCount).toBe(0);
      expect(read.alertRuleCount).toBe(1);
      expect(getWhoIsToldMode(read)).toBe(WhoIsToldMode.ExistingPolicy);
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
        translator: createTranslator(undefined),
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
      // The server words the two rules in the reader's language (#7995).
      everyNewEventRulesLanguage: "en",
    });
  });

  // #9742: a policy's name is one policy's, so a taken name is numbered.
  test("while another policy has its name, the policy is made numbered, with the same first responders", async () => {
    // Each try's name as it was sent: the model is the same object each time.
    const tried: Array<string | undefined> = [];

    createSpy.mockImplementation((async (args: {
      model: OnCallDutyPolicy;
    }): Promise<unknown> => {
      tried.push(args.model.name);

      if (tried.length === 1) {
        throw new HTTPErrorResponse(
          400,
          {
            message: getNameTakenRefusalText(
              ON_CALL_POLICY_NAME_TAKEN_REFUSAL,
              args.model.name,
            ),
          },
          {},
        );
      }

      return { data: model(OnCallDutyPolicy, { _id: id(50).toString() }) };
    }) as never);

    expect(
      await WebsiteDownApi.createPolicy({
        userIds: [id(1).toString()],
        teamIds: [],
        translator: createTranslator(undefined),
      }),
    ).toBe(id(50).toString());

    const calls: Array<Parameters<typeof ModelAPI.create>[0]> =
      createSpy.mock.calls.map(
        (call: Array<unknown>): Parameters<typeof ModelAPI.create>[0] => {
          return call[0] as Parameters<typeof ModelAPI.create>[0];
        },
      );

    expect(calls).toHaveLength(2);
    expect(tried).toEqual([
      "Default on-call policy",
      "Default on-call policy 2",
    ]);
    expect(calls[1]!.miscDataProps).toEqual(calls[0]!.miscDataProps);
  });

  test("any other refusal of the policy is the setup's error, tried once", async () => {
    createSpy.mockRejectedValue(
      new HTTPErrorResponse(400, { message: "Bad" }, {}),
    );

    await expect(
      WebsiteDownApi.createPolicy({
        userIds: [id(1).toString()],
        teamIds: [],
        translator: createTranslator(undefined),
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  test("read in German, the policy is named in German, and its rules are asked for in German (#7995)", async () => {
    createSpy.mockResolvedValue({
      data: model(OnCallDutyPolicy, { _id: id(50).toString() }),
    });

    await WebsiteDownApi.createPolicy({
      userIds: [id(1).toString()],
      teamIds: [],
      translator: dashboardTranslator("de"),
    });

    const call: Parameters<typeof ModelAPI.create>[0] = createSpy.mock
      .calls[0]![0] as unknown as Parameters<typeof ModelAPI.create>[0];

    expect((call.model as OnCallDutyPolicy).name).toBe(
      dashboardTranslator("de").translateText("Default on-call policy"),
    );
    expect((call.model as OnCallDutyPolicy).name).not.toBe(
      "Default on-call policy",
    );
    expect(
      (call.miscDataProps as Record<string, unknown>)[
        "everyNewEventRulesLanguage"
      ],
    ).toBe("de");
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
      isArchived: false,
    });
  });

  test("a policy that is gone reads as null", async () => {
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null);

    expect(await WebsiteDownApi.loadPolicy(id(50).toString())).toBeNull();
  });

  // An archived policy pages no one: the read tells it apart (#8432).
  describe("a policy archived since (#8432)", () => {
    test("the read asks whether the policy is archived", async () => {
      const getItem: LooseSpy = jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValue(
          model(OnCallDutyPolicy, { _id: id(50).toString(), name: "Ops" }),
        ) as unknown as LooseSpy;

      await WebsiteDownApi.loadPolicy(id(50).toString());

      expect(
        (getItem.mock.calls[0]![0] as unknown as { select: unknown }).select,
      ).toEqual({ _id: true, name: true, isArchived: true });
    });

    test("an archived policy reads as archived - there, not gone - with who it pages", async () => {
      jest.spyOn(ModelAPI, "getItem").mockResolvedValue(
        model(OnCallDutyPolicy, {
          _id: id(50).toString(),
          name: "Default on-call policy",
          isArchived: true,
        }),
      );
      getListSpy.mockImplementation((async (args: {
        modelType: { new (): unknown };
      }) => {
        return args.modelType === OnCallDutyPolicyEscalationRuleUser
          ? list([
              model(OnCallDutyPolicyEscalationRuleUser, {
                user: model(User, { name: "Ada Lovelace" }),
              }),
            ])
          : list([]);
      }) as unknown as (...args: Array<never>) => Promise<unknown>);

      expect(await WebsiteDownApi.loadPolicy(id(50).toString())).toEqual({
        id: id(50).toString(),
        name: "Default on-call policy",
        responders: ["Ada Lovelace"],
        isArchived: true,
      });
    });

    test("read with no archived flag, it is in service, never undefined", async () => {
      jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValue(
          model(OnCallDutyPolicy, { _id: id(50).toString(), name: "Ops" }),
        );

      expect(
        (await WebsiteDownApi.loadPolicy(id(50).toString()))!.isArchived,
      ).toBe(false);
    });
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

/*
 * A MONITOR SOMEONE ELSE MADE FOR THE ADDRESS (#7254): a teammate's, or one
 * the API, Terraform or an import made. Read through the model API as any
 * list is - so the server hands over only what this person may read - and
 * never taken over.
 */
describe("a monitor someone else made for the address (#7254)", () => {
  const ME: string = id(7).toString();
  const GRACE: string = id(8).toString();

  const monitorFor: (
    n: number,
    text: string,
    values?: Record<string, unknown>,
  ) => Monitor = (
    n: number,
    text: string,
    values?: Record<string, unknown>,
  ): Monitor => {
    const made: Monitor = buildWebsiteMonitor({
      address: parseWebsiteAddress(text)!,
      isApi: false,
      seeds: {
        operationalStatusId: id(1),
        offlineStatusId: id(3),
        incidentSeverityId: id(11),
        alertSeverityId: id(20),
      },
    });

    return model(Monitor, {
      _id: id(n).toString(),
      name: made.name,
      monitorSteps: made.monitorSteps,
      monitoringInterval: made.monitoringInterval,
      ...(values || {}),
    });
  };

  const find: (text: string) => Promise<WebsiteDownFoundMonitor | null> = (
    text: string,
  ): Promise<WebsiteDownFoundMonitor | null> => {
    return WebsiteDownApi.findOtherMonitor({
      address: parseWebsiteAddress(text)!,
      userId: ME,
    });
  };

  test("reads the project's newest Website and API monitors, whoever made them, with who made each", async () => {
    getListSpy.mockResolvedValue(list([]));

    expect(await find("acme.example")).toBeNull();
    expect(getListSpy).toHaveBeenCalledTimes(1);

    const call: {
      modelType: unknown;
      query: Record<string, unknown>;
      limit: number;
      skip: number;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      requestOptions?: unknown;
    } = getListSpy.mock.calls[0]![0] as unknown as {
      modelType: unknown;
      query: Record<string, unknown>;
      limit: number;
      skip: number;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
      requestOptions?: unknown;
    };

    expect(call.modelType).toBe(Monitor);
    // Anyone's: no createdByUserId, unlike this person's own read.
    expect(Object.keys(call.query)).toEqual(["monitorType"]);
    expect((call.query["monitorType"] as Includes).values).toEqual([
      MonitorType.Website,
      MonitorType.API,
    ]);
    expect(call.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(call.limit).toBe(OTHER_MONITORS_READ_LIMIT);
    expect(OTHER_MONITORS_READ_LIMIT).toBe(200);
    expect(call.skip).toBe(0);
    expect(call.select).toEqual({
      _id: true,
      name: true,
      monitorSteps: true,
      monitoringInterval: true,
      minimumProbeAgreement: true,
      isArchived: true,
      disableActiveMonitoring: true,
      createdByUserId: true,
      createdByUser: { name: true },
    });
    /*
     * As this person, through the model API's own route: nothing asks the
     * server for more than it lets them read.
     */
    expect(call.requestOptions).toBeUndefined();
  });

  test("a teammate's that checks the address: its name and who made it, never this person's", async () => {
    getListSpy.mockResolvedValue(
      list([
        monitorFor(1, "status.acme.example"),
        monitorFor(2, "https://ACME.example/", {
          name: "Acme storefront",
          createdByUserId: new ObjectID(GRACE),
          createdByUser: model(User, { name: "Grace Hopper" }),
        }),
      ]),
    );

    const found: WebsiteDownFoundMonitor | null = await find("acme.example");

    expect(found).toEqual({
      id: id(2).toString(),
      name: "Acme storefront",
      creatorName: "Grace Hopper",
      isOwn: false,
      record: {
        id: id(2).toString(),
        name: "Acme storefront",
        monitorSteps: expect.anything(),
        monitoringInterval: "*/5 * * * *",
        minimumProbeAgreement: null,
      },
    });
  });

  test("one the API, Terraform or an import made names nobody", async () => {
    getListSpy.mockResolvedValue(list([monitorFor(2, "acme.example")]));

    const found: WebsiteDownFoundMonitor | null = await find("acme.example");

    expect(found?.creatorName).toBe("");
    expect(found?.isOwn).toBe(false);
  });

  test("one this person made, older than their own read, is theirs", async () => {
    getListSpy.mockResolvedValue(
      list([
        monitorFor(3, "acme.example", {
          createdByUserId: new ObjectID(ME),
          createdByUser: model(User, { name: "Ada Lovelace" }),
        }),
      ]),
    );

    expect((await find("acme.example"))?.isOwn).toBe(true);
  });

  test("archived, turned off or another address is not checking it: nothing is said of it", async () => {
    getListSpy.mockResolvedValue(
      list([
        monitorFor(1, "acme.example", { isArchived: true }),
        monitorFor(2, "acme.example", { disableActiveMonitoring: true }),
        monitorFor(3, "acme.example/health"),
      ]),
    );

    expect(await find("acme.example")).toBeNull();
  });

  test("a name it may not read is the address's host, never blank", async () => {
    getListSpy.mockResolvedValue(
      list([monitorFor(4, "acme.example", { name: undefined })]),
    );

    expect((await find("acme.example"))?.name).toBe("acme.example");
  });

  /*
   * A monitor this person may not read is never in the list the server
   * hands back, so nothing is said of it: the setup asks no count, no
   * root read and no other route that could tell it exists.
   */
  test("only what the server handed over is named: no count, no other read", async () => {
    getListSpy.mockResolvedValue(list([]));

    expect(await find("acme.example")).toBeNull();
    expect(countSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(getListSpy).toHaveBeenCalledTimes(1);
  });

  test("a read that fails throws: nothing is made on a guess", async () => {
    getListSpy.mockRejectedValue(new Error("offline"));

    await expect(find("acme.example")).rejects.toThrow("offline");
  });
});

/*
 * FROM HOW MANY LOCATIONS (#7461): the probes a new monitor starts with, by
 * Create Monitor's rule, read before it is made.
 */
describe("how many locations a new monitor is checked from (#7461)", () => {
  const probe: (n: number, values: Record<string, unknown>) => Probe = (
    n: number,
    values: Record<string, unknown>,
  ): Probe => {
    return model(Probe, { _id: id(n).toString(), ...values });
  };

  let getAllProbesSpy: LooseSpy;
  let getItemSpy: LooseSpy;

  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(id(500));
    getAllProbesSpy = jest.spyOn(
      ProbeUtil,
      "getAllProbes",
    ) as unknown as LooseSpy;
    getItemSpy = jest.spyOn(ModelAPI, "getItem") as unknown as LooseSpy;
    getItemSpy.mockResolvedValue(model(Project, {}));
  });

  test("one probe on a self-hosted server: one location", async () => {
    getAllProbesSpy.mockResolvedValue([
      probe(1, {
        isGlobalProbe: false,
        shouldAutoEnableProbeOnNewMonitors: true,
      }),
    ]);

    expect(await WebsiteDownApi.loadDefaultLocationCount()).toBe(1);
  });

  test("only the probes a new monitor starts with: those that opt in", async () => {
    getAllProbesSpy.mockResolvedValue([
      probe(1, {
        isGlobalProbe: true,
        shouldAutoEnableProbeOnNewMonitors: true,
      }),
      probe(2, {
        isGlobalProbe: true,
        shouldAutoEnableProbeOnNewMonitors: true,
      }),
      probe(3, {
        isGlobalProbe: true,
        shouldAutoEnableProbeOnNewMonitors: false,
      }),
      probe(4, {
        isGlobalProbe: false,
        shouldAutoEnableProbeOnNewMonitors: true,
      }),
    ]);

    expect(await WebsiteDownApi.loadDefaultLocationCount()).toBe(3);
  });

  test("the global ones left out where the project says so", async () => {
    getAllProbesSpy.mockResolvedValue([
      probe(1, {
        isGlobalProbe: true,
        shouldAutoEnableProbeOnNewMonitors: true,
      }),
      probe(2, {
        isGlobalProbe: false,
        shouldAutoEnableProbeOnNewMonitors: true,
      }),
    ]);
    getItemSpy.mockResolvedValue(
      model(Project, { doNotAddGlobalProbesByDefaultOnNewMonitors: true }),
    );

    expect(await WebsiteDownApi.loadDefaultLocationCount()).toBe(1);

    const call: {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    } = getItemSpy.mock.calls[0]![0] as unknown as {
      modelType: unknown;
      id: ObjectID;
      select: Record<string, unknown>;
    };

    expect(call.modelType).toBe(Project);
    expect(call.id.toString()).toBe(id(500).toString());
    expect(call.select).toEqual({
      doNotAddGlobalProbesByDefaultOnNewMonitors: true,
    });
  });

  test("a project it cannot read is the server's default: global probes added", async () => {
    getAllProbesSpy.mockResolvedValue([
      probe(1, {
        isGlobalProbe: true,
        shouldAutoEnableProbeOnNewMonitors: true,
      }),
    ]);
    getItemSpy.mockRejectedValue(new Error("not allowed"));

    expect(await WebsiteDownApi.loadDefaultLocationCount()).toBe(1);
  });

  test("probes that cannot be read: no number, never a guess", async () => {
    getAllProbesSpy.mockRejectedValue(new Error("offline"));

    expect(await WebsiteDownApi.loadDefaultLocationCount()).toBeNull();
  });
});

/*
 * STEP 4, SHOW IT TO CUSTOMERS? (#7053): the pages offered, whether one
 * shows the monitor already, and putting it on one.
 */
describe("a status page to show it on (#7053)", () => {
  beforeEach(() => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(id(500));
  });

  test("the project's status pages by name, none archived", async () => {
    getListSpy.mockResolvedValue(
      list([
        model(StatusPage, { _id: id(1).toString(), name: "Acme Status" }),
        model(StatusPage, {
          _id: id(2).toString(),
          name: "Old status",
          isArchived: true,
        }),
        model(StatusPage, { _id: id(3).toString(), name: "Internal" }),
      ]),
    );

    expect(await WebsiteDownApi.loadStatusPages()).toEqual([
      { id: id(1).toString(), name: "Acme Status" },
      { id: id(3).toString(), name: "Internal" },
    ]);

    const call: {
      modelType: unknown;
      query: Record<string, unknown>;
      limit: number;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = getListSpy.mock.calls[0]![0] as unknown as {
      modelType: unknown;
      query: Record<string, unknown>;
      limit: number;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    };

    expect(call.modelType).toBe(StatusPage);
    expect(String(call.query["projectId"])).toBe(id(500).toString());
    /*
     * Asked for live pages only (#10646): archived pages used up the read,
     * so a project with many of them was offered fewer, or none.
     */
    expect(call.query["isArchived"]).toBe(false);
    expect(call.limit).toBe(STATUS_PAGES_READ_LIMIT);
    expect(call.select).toEqual({ _id: true, name: true, isArchived: true });
    expect(call.sort).toEqual({ name: SortOrder.Ascending });
  });

  const PAGES: Array<{ id: string; name: string }> = [
    { id: id(1).toString(), name: "Acme Status" },
    { id: id(2).toString(), name: "Internal" },
  ];

  /*
   * The project's live pages, every one - past the ones step 4 read first
   * too (#10646): a page that shows the monitor is read by its id.
   */
  const LIVE_PAGES: Array<{ id: string; name: string }> = [
    ...PAGES,
    { id: id(42).toString(), name: "Zulu Status" },
  ];

  const showing: (statusPageIds: Array<string>) => void = (
    statusPageIds: Array<string>,
  ): void => {
    getListSpy.mockImplementation((async (options: {
      modelType: unknown;
      query: Record<string, unknown>;
    }) => {
      if (options.modelType === StatusPage) {
        const asked: Array<string> = (
          (options.query["_id"] as Includes | undefined)?.values || []
        ).map((value: unknown): string => {
          return String(value).toLowerCase();
        });

        return list(
          LIVE_PAGES.filter((page: { id: string }): boolean => {
            return asked.includes(page.id.toLowerCase());
          }).map((page: { id: string; name: string }) => {
            return model(StatusPage, { _id: page.id, name: page.name });
          }),
        );
      }

      return list(
        statusPageIds.map((statusPageId: string, index: number) => {
          return model(StatusPageResource, {
            _id: id(100 + index).toString(),
            statusPageId: new ObjectID(statusPageId),
          });
        }),
      );
    }) as never);
  };

  test("the page that shows the monitor, read by the monitor", async () => {
    showing([id(2).toString()]);

    expect(
      await WebsiteDownApi.findStatusPageShowing({
        monitorId: id(99).toString(),
        statusPages: PAGES,
      }),
    ).toEqual(PAGES[1]);

    const call: { modelType: unknown; query: Record<string, unknown> } =
      getListSpy.mock.calls[0]![0] as unknown as {
        modelType: unknown;
        query: Record<string, unknown>;
      };

    expect(call.modelType).toBe(StatusPageResource);
    expect(String(call.query["monitorId"])).toBe(id(99).toString());
  });

  test("the run's page first, when it still shows it", async () => {
    showing([id(1).toString(), id(2).toString()]);

    expect(
      await WebsiteDownApi.findStatusPageShowing({
        monitorId: id(99).toString(),
        statusPages: PAGES,
        preferredStatusPageId: id(2).toString(),
      }),
    ).toEqual(PAGES[1]);
  });

  test("none shows it: null, and no page is read", async () => {
    showing([]);

    expect(
      await WebsiteDownApi.findStatusPageShowing({
        monitorId: id(99).toString(),
        statusPages: PAGES,
      }),
    ).toBeNull();

    expect(
      getListSpy.mock.calls.filter((call: Array<unknown>): boolean => {
        return (call[0] as { modelType: unknown }).modelType === StatusPage;
      }),
    ).toHaveLength(0);
  });

  /*
   * #10646: the page was looked for among the ones step 4 read first, so a
   * monitor on a page past them was taken for one no page showed, and
   * added again.
   */
  test("a page past the ones the step read first shows it: found, read by its id and named", async () => {
    showing([id(42).toString()]);

    expect(
      await WebsiteDownApi.findStatusPageShowing({
        monitorId: id(99).toString(),
        statusPages: PAGES,
        preferredStatusPageId: id(42).toString(),
      }),
    ).toEqual({ id: id(42).toString(), name: "Zulu Status" });

    const pageRead: {
      query: Record<string, unknown>;
      limit: number;
    } = getListSpy.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          modelType: unknown;
          query: Record<string, unknown>;
          limit: number;
        };
      })
      .find((options: { modelType: unknown }): boolean => {
        return options.modelType === StatusPage;
      })!;

    expect(pageRead.query["_id"]).toBeInstanceOf(Includes);
    // An archived page is offline: it shows nobody anything.
    expect(pageRead.query["isArchived"]).toBe(false);
    expect(pageRead.limit).toBe(1);
  });

  test("a page deleted or archived since: null, so the step asks again", async () => {
    showing([id(77).toString()]);

    expect(
      await WebsiteDownApi.findStatusPageShowing({
        monitorId: id(99).toString(),
        statusPages: PAGES,
        preferredStatusPageId: id(77).toString(),
      }),
    ).toBeNull();
  });

  test("several pages show it, none the run's: the first by name", async () => {
    showing([id(42).toString(), id(2).toString()]);

    expect(
      await WebsiteDownApi.findStatusPageShowing({
        monitorId: id(99).toString(),
        statusPages: PAGES,
      }),
    ).toEqual(PAGES[1]);
  });

  test("no page offered: nothing is read", async () => {
    expect(
      await WebsiteDownApi.findStatusPageShowing({
        monitorId: id(99).toString(),
        statusPages: [],
      }),
    ).toBeNull();
    expect(getListSpy).not.toHaveBeenCalled();
  });

  test("puts the monitor on the page as the status page setup does, named after the monitor", async () => {
    const addSpy: LooseSpy = jest
      .spyOn(StatusPageSetupApi, "addMonitors")
      .mockResolvedValue({
        succeeded: [],
        skipped: [],
        failed: [],
      } as never) as unknown as LooseSpy;

    await WebsiteDownApi.addToStatusPage({
      statusPageId: id(1).toString(),
      monitorId: id(99).toString(),
      monitorName: "acme.example",
    });

    expect(addSpy).toHaveBeenCalledWith({
      statusPageId: id(1).toString(),
      monitors: [{ id: id(99).toString(), name: "acme.example" }],
    });
  });

  test("a page it could not be added to throws: the step never reads as done", async () => {
    jest
      .spyOn(StatusPageSetupApi, "addMonitors")
      .mockRejectedValue(new Error("Status page not found."));

    await expect(
      WebsiteDownApi.addToStatusPage({
        statusPageId: id(1).toString(),
        monitorId: id(99).toString(),
        monitorName: "acme.example",
      }),
    ).rejects.toThrow("Status page not found.");
  });
});

/*
 * WHO MAY DO WHAT THE NEW WAYS OFFER: put a monitor on a status page
 * (#7053), and use the on-call guided setup (#7370).
 */
describe("who may do what the summary and step 4 offer", () => {
  const allowOnly: (allowed: Array<{ new (): unknown }>) => void = (
    allowed: Array<{ new (): unknown }>,
  ): void => {
    jest
      .spyOn(PermissionGate, "check")
      .mockImplementation((record: unknown): PermissionGateResult => {
        return {
          isAllowed: allowed.some((type: { new (): unknown }): boolean => {
            return record instanceof type;
          }),
        };
      });
  };

  test("a status page: reading the pages and adding a monitor to one, both", () => {
    allowOnly([StatusPage, StatusPageResource]);
    expect(mayAddToStatusPage()).toBe(true);

    allowOnly([StatusPage]);
    expect(mayAddToStatusPage()).toBe(false);

    allowOnly([StatusPageResource]);
    expect(mayAddToStatusPage()).toBe(false);
  });

  test("the on-call setup: who may create an on-call policy, as On-Call's own Guided setup", () => {
    allowOnly([OnCallDutyPolicy]);
    expect(mayUseOnCallSetup()).toBe(true);

    allowOnly([]);
    expect(mayUseOnCallSetup()).toBe(false);
  });
});
