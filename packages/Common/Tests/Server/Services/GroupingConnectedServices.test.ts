import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Semaphore, {
  SemaphoreMutex,
} from "../../../Server/Infrastructure/Semaphore";
import AlertEpisodeMemberService from "../../../Server/Services/AlertEpisodeMemberService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import FindBy from "../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import logger from "../../../Server/Utils/Logger";
import ConnectedServices, {
  CONNECTED_SERVICES_KEY_PART,
  MAX_EPISODES_COMPARED,
} from "../../../Server/Utils/Topology/ConnectedServices";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Contract under test - topology-aware grouping (issue #6798): a grouping
 * rule that groups by connected services, run through the real engines
 * with their reads stubbed.
 *
 *  - an alert (or incident) on a service joins the rule's open episode
 *    that holds a record on a service connected to its own - the most
 *    recently active such episode - and not one that holds only
 *    unconnected services;
 *  - with no connected episode open, it opens one (or reopens a recently
 *    resolved connected one, when the rule reopens);
 *  - while the rule waits for more records, only the waiting ones on
 *    connected services count with it;
 *  - a record on no service is grouped by its monitor, the old way;
 *  - a failure to read the services is logged, and the record is grouped
 *    by its monitor rather than not at all.
 */

interface AlertEngineInternals {
  groupAlertWithRule: (
    alert: Alert,
    rule: AlertGroupingRule,
  ) => Promise<{
    grouped: boolean;
    episodeId?: ObjectID;
    isNewEpisode?: boolean;
    wasReopened?: boolean;
    isWaitingForMore?: boolean;
  }>;
  addAlertToEpisode: (...args: Array<unknown>) => Promise<void>;
  createNewEpisode: (...args: Array<unknown>) => Promise<AlertEpisode | null>;
  waitForEpisode: (...args: Array<unknown>) => Promise<void>;
}

interface IncidentEngineInternals {
  groupIncidentWithRule: (
    incident: Incident,
    rule: IncidentGroupingRule,
  ) => Promise<{
    grouped: boolean;
    episodeId?: ObjectID;
    isNewEpisode?: boolean;
  }>;
  addIncidentToEpisode: (...args: Array<unknown>) => Promise<void>;
  createNewEpisode: (
    ...args: Array<unknown>
  ) => Promise<IncidentEpisode | null>;
}

const alertEngine: AlertEngineInternals =
  AlertGroupingEngineService as unknown as AlertEngineInternals;
const incidentEngine: IncidentEngineInternals =
  IncidentGroupingEngineService as unknown as IncidentEngineInternals;

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("0193c0de-aaaa-4aaa-8bbb-000000000002");
const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-000000000003",
);
const UNRESOLVED_STATE: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-000000000004",
);
const EPISODE_UNCONNECTED: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-0000000000e1",
);
const EPISODE_CONNECTED: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-0000000000e2",
);
const NEW_EPISODE: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-0000000000e3",
);

// checkout calls orders; search is connected to neither.
const CHECKOUT: string = "0193c0de-aaaa-4aaa-8bbb-0000000000a1";
const ORDERS: string = "0193c0de-aaaa-4aaa-8bbb-0000000000a2";
const SEARCH: string = "0193c0de-aaaa-4aaa-8bbb-0000000000a3";

function episode(id: ObjectID): AlertEpisode {
  const row: AlertEpisode = new AlertEpisode();
  row.id = id;
  return row;
}

function incidentEpisode(id: ObjectID): IncidentEpisode {
  const row: IncidentEpisode = new IncidentEpisode();
  row.id = id;
  return row;
}

function alertOnCheckout(): Alert {
  const alert: Alert = new Alert(ObjectID.generate());
  alert.projectId = PROJECT_ID;
  alert.title = "Checkout errors";
  alert.monitorId = MONITOR_ID;
  return alert;
}

function rule(values: Partial<AlertGroupingRule> = {}): AlertGroupingRule {
  const row: AlertGroupingRule = new AlertGroupingRule();
  row.id = RULE_ID;
  row.name = "Connected services";
  row.groupByConnectedServices = true;
  row.enableTimeWindow = true;
  row.timeWindowMinutes = 30;
  Object.assign(row, values);
  return row;
}

let episodeReads: Array<FindBy<AlertEpisode>>;
let episodesFound: Array<AlertEpisode>;
let servicesByEpisode: Map<string, Set<string>>;
let addToEpisode: SpyInstance<AlertEngineInternals["addAlertToEpisode"]>;
let createEpisode: SpyInstance<AlertEngineInternals["createNewEpisode"]>;
let findOne: SpyInstance<typeof AlertEpisodeService.findOneBy>;

beforeEach(() => {
  episodeReads = [];
  episodesFound = [];
  servicesByEpisode = new Map<string, Set<string>>();

  jest
    .spyOn(Semaphore, "lock")
    .mockResolvedValue({} as unknown as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(AlertEpisodeMemberService, "findHoldingEpisodeId")
    .mockResolvedValue(null);
  jest.spyOn(ConnectedServices, "readForAlert").mockResolvedValue({
    serviceIds: new Set<string>([CHECKOUT]),
    connectedServiceIds: new Set<string>([CHECKOUT, ORDERS]),
  });
  jest
    .spyOn(AlertEpisodeService, "findBy")
    .mockImplementation(async (findBy: FindBy<AlertEpisode>) => {
      episodeReads.push(findBy);
      return episodesFound;
    });
  findOne = jest
    .spyOn(AlertEpisodeService, "findOneBy")
    .mockImplementation(async (_: FindOneBy<AlertEpisode>) => {
      return null;
    });
  jest
    .spyOn(ConnectedServices, "readServicesOfAlertEpisodes")
    .mockImplementation(async () => {
      return servicesByEpisode;
    });
  jest
    .spyOn(AlertEpisodeService, "updateEpisodeSeverity")
    .mockResolvedValue(undefined);
  jest.spyOn(AlertEpisodeService, "reopenEpisode").mockResolvedValue(undefined);
  addToEpisode = jest
    .spyOn(alertEngine, "addAlertToEpisode")
    .mockResolvedValue(undefined);
  createEpisode = jest
    .spyOn(alertEngine, "createNewEpisode")
    .mockResolvedValue(episode(NEW_EPISODE));
  jest.spyOn(alertEngine, "waitForEpisode").mockResolvedValue(undefined);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an alert on a service", () => {
  test("joins the open episode that holds a connected service, not the more recent unconnected one", async () => {
    // The most recently active first, as the read asks.
    episodesFound = [episode(EPISODE_UNCONNECTED), episode(EPISODE_CONNECTED)];
    servicesByEpisode = new Map([
      [EPISODE_UNCONNECTED.toString(), new Set<string>([SEARCH])],
      [EPISODE_CONNECTED.toString(), new Set<string>([ORDERS])],
    ]);

    const result: Awaited<
      ReturnType<AlertEngineInternals["groupAlertWithRule"]>
    > = await alertEngine.groupAlertWithRule(alertOnCheckout(), rule());

    expect(result).toEqual({
      grouped: true,
      episodeId: EPISODE_CONNECTED,
      isNewEpisode: false,
    });
    expect(addToEpisode.mock.calls[0]![1]).toEqual(EPISODE_CONNECTED);
    expect(createEpisode).not.toHaveBeenCalled();
  });

  test("looks among the rule's open episodes of its key, within the time window, a bounded number of them", async () => {
    await alertEngine.groupAlertWithRule(alertOnCheckout(), rule());

    const read: FindBy<AlertEpisode> = episodeReads[0]!;
    const query: JSONObject = read.query as unknown as JSONObject;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["alertGroupingRuleId"]).toEqual(RULE_ID);
    expect(query["resolvedAt"]).toBeNull();
    expect(query["lastAlertAddedAt"]).toBeDefined();
    expect(read.sort).toEqual({ lastAlertAddedAt: "DESC" });
    expect(read.limit).toBe(MAX_EPISODES_COMPARED);
    expect(JSON.stringify(query["groupingKey"])).toContain(
      CONNECTED_SERVICES_KEY_PART,
    );
    // The single-episode lookup of the other rules is not used.
    expect(findOne).not.toHaveBeenCalled();
  });

  test("opens a new episode when no open one holds a connected service", async () => {
    episodesFound = [episode(EPISODE_UNCONNECTED)];
    servicesByEpisode = new Map([
      [EPISODE_UNCONNECTED.toString(), new Set<string>([SEARCH])],
    ]);

    const result: Awaited<
      ReturnType<AlertEngineInternals["groupAlertWithRule"]>
    > = await alertEngine.groupAlertWithRule(alertOnCheckout(), rule());

    expect(result).toEqual({
      grouped: true,
      episodeId: NEW_EPISODE,
      isNewEpisode: true,
    });
    expect(createEpisode.mock.calls[0]![2]).toBe(CONNECTED_SERVICES_KEY_PART);
    expect(addToEpisode.mock.calls[0]![1]).toEqual(NEW_EPISODE);
  });

  test("reopens a recently resolved episode that holds a connected service", async () => {
    const reopenable: AlertEpisode = episode(EPISODE_CONNECTED);

    jest
      .spyOn(AlertEpisodeService, "findBy")
      .mockImplementation(async (findBy: FindBy<AlertEpisode>) => {
        episodeReads.push(findBy);
        const query: JSONObject = findBy.query as unknown as JSONObject;
        // No open episode; one resolved within the reopen window.
        return query["resolvedAt"] === null ? [] : [reopenable];
      });
    servicesByEpisode = new Map([
      [EPISODE_CONNECTED.toString(), new Set<string>([ORDERS])],
    ]);

    const result: Awaited<
      ReturnType<AlertEngineInternals["groupAlertWithRule"]>
    > = await alertEngine.groupAlertWithRule(
      alertOnCheckout(),
      rule({ enableReopenWindow: true, reopenWindowMinutes: 30 }),
    );

    expect(result).toEqual({
      grouped: true,
      episodeId: EPISODE_CONNECTED,
      isNewEpisode: false,
      wasReopened: true,
    });
    expect(AlertEpisodeService.reopenEpisode).toHaveBeenCalledWith(
      EPISODE_CONNECTED,
    );
    expect(episodeReads[1]!.sort).toEqual({ resolvedAt: "DESC" });
  });

  test("while the rule waits for more, only the waiting alerts on connected services count", async () => {
    const waitingConnected: Alert = alertOnCheckout();
    waitingConnected.createdAt = new Date();
    const waitingUnconnected: Alert = alertOnCheckout();
    waitingUnconnected.createdAt = new Date();

    jest
      .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
      .mockResolvedValue([UNRESOLVED_STATE]);
    jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([waitingConnected, waitingUnconnected]);
    jest.spyOn(ConnectedServices, "readServicesOfAlerts").mockResolvedValue(
      new Map<string, Set<string>>([
        [ConnectedServices.key(waitingConnected.id), new Set([ORDERS])],
        [ConnectedServices.key(waitingUnconnected.id), new Set([SEARCH])],
      ]),
    );

    // Three to open: this one and the connected one are two.
    const waiting: Awaited<
      ReturnType<AlertEngineInternals["groupAlertWithRule"]>
    > = await alertEngine.groupAlertWithRule(
      alertOnCheckout(),
      rule({ enableMinimumAlertCount: true, minimumAlertCount: 3 }),
    );

    expect(waiting).toEqual({ grouped: false, isWaitingForMore: true });
    expect(createEpisode).not.toHaveBeenCalled();

    // Two to open: this one and the connected one open it together.
    const opened: Awaited<
      ReturnType<AlertEngineInternals["groupAlertWithRule"]>
    > = await alertEngine.groupAlertWithRule(
      alertOnCheckout(),
      rule({ enableMinimumAlertCount: true, minimumAlertCount: 2 }),
    );

    expect(opened.isNewEpisode).toBe(true);
    expect(createEpisode.mock.calls[0]![0]).toBe(waitingConnected);
  });
});

describe("an alert on no service", () => {
  test("is grouped by its monitor, the old way", async () => {
    (
      ConnectedServices.readForAlert as unknown as SpyInstance<
        typeof ConnectedServices.readForAlert
      >
    ).mockResolvedValue({
      serviceIds: new Set<string>(),
      connectedServiceIds: new Set<string>(),
    });

    const result: Awaited<
      ReturnType<AlertEngineInternals["groupAlertWithRule"]>
    > = await alertEngine.groupAlertWithRule(alertOnCheckout(), rule());

    expect(result.isNewEpisode).toBe(true);
    expect(episodeReads).toHaveLength(0);
    expect(findOne).toHaveBeenCalled();
    expect(createEpisode.mock.calls[0]![2]).toBe(
      `monitor:${MONITOR_ID.toString()}`,
    );
  });

  test("a failure to read its services is logged, and it is grouped by its monitor", async () => {
    (
      ConnectedServices.readForAlert as unknown as SpyInstance<
        typeof ConnectedServices.readForAlert
      >
    ).mockRejectedValue(new Error("Database not connected"));

    const result: Awaited<
      ReturnType<AlertEngineInternals["groupAlertWithRule"]>
    > = await alertEngine.groupAlertWithRule(alertOnCheckout(), rule());

    expect(result.grouped).toBe(true);
    expect(createEpisode.mock.calls[0]![2]).toBe(
      `monitor:${MONITOR_ID.toString()}`,
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("grouping it by its monitor"),
      expect.anything(),
    );
  });

  test("a rule that does not group by connected services never reads them", async () => {
    await alertEngine.groupAlertWithRule(
      alertOnCheckout(),
      rule({ groupByConnectedServices: false, groupByMonitor: true }),
    );

    expect(ConnectedServices.readForAlert).not.toHaveBeenCalled();
    expect(
      ConnectedServices.readServicesOfAlertEpisodes,
    ).not.toHaveBeenCalled();
  });
});

describe("an incident on a service", () => {
  function incidentOnCheckout(): Incident {
    const incident: Incident = new Incident(ObjectID.generate());
    incident.projectId = PROJECT_ID;
    incident.title = "Checkout errors";
    incident.monitors = [new Monitor(MONITOR_ID)];
    return incident;
  }

  function incidentRule(): IncidentGroupingRule {
    const row: IncidentGroupingRule = new IncidentGroupingRule();
    row.id = RULE_ID;
    row.name = "Connected services";
    row.groupByConnectedServices = true;
    return row;
  }

  let incidentEpisodesFound: Array<IncidentEpisode>;
  let addIncident: SpyInstance<IncidentEngineInternals["addIncidentToEpisode"]>;
  let createIncidentEpisode: SpyInstance<
    IncidentEngineInternals["createNewEpisode"]
  >;

  beforeEach(() => {
    incidentEpisodesFound = [];

    jest
      .spyOn(IncidentEpisodeMemberService, "findHoldingEpisodeId")
      .mockResolvedValue(null);
    jest.spyOn(ConnectedServices, "readForIncident").mockResolvedValue({
      serviceIds: new Set<string>([CHECKOUT]),
      connectedServiceIds: new Set<string>([CHECKOUT, ORDERS]),
    });
    jest
      .spyOn(IncidentEpisodeService, "findBy")
      .mockImplementation(async () => {
        return incidentEpisodesFound;
      });
    jest.spyOn(IncidentEpisodeService, "findOneBy").mockResolvedValue(null);
    jest
      .spyOn(ConnectedServices, "readServicesOfIncidentEpisodes")
      .mockImplementation(async () => {
        return servicesByEpisode;
      });
    jest
      .spyOn(IncidentEpisodeService, "updateEpisodeSeverity")
      .mockResolvedValue(undefined);
    addIncident = jest
      .spyOn(incidentEngine, "addIncidentToEpisode")
      .mockResolvedValue(undefined);
    createIncidentEpisode = jest
      .spyOn(incidentEngine, "createNewEpisode")
      .mockResolvedValue(incidentEpisode(NEW_EPISODE));
  });

  test("joins the open episode that holds a connected service", async () => {
    incidentEpisodesFound = [
      incidentEpisode(EPISODE_UNCONNECTED),
      incidentEpisode(EPISODE_CONNECTED),
    ];
    servicesByEpisode = new Map([
      [EPISODE_UNCONNECTED.toString(), new Set<string>([SEARCH])],
      [EPISODE_CONNECTED.toString(), new Set<string>([ORDERS])],
    ]);

    const result: Awaited<
      ReturnType<IncidentEngineInternals["groupIncidentWithRule"]>
    > = await incidentEngine.groupIncidentWithRule(
      incidentOnCheckout(),
      incidentRule(),
    );

    expect(result).toEqual({
      grouped: true,
      episodeId: EPISODE_CONNECTED,
      isNewEpisode: false,
    });
    expect(addIncident.mock.calls[0]![1]).toEqual(EPISODE_CONNECTED);
  });

  test("opens a new episode when none holds a connected service", async () => {
    incidentEpisodesFound = [incidentEpisode(EPISODE_UNCONNECTED)];
    servicesByEpisode = new Map([
      [EPISODE_UNCONNECTED.toString(), new Set<string>([SEARCH])],
    ]);

    const result: Awaited<
      ReturnType<IncidentEngineInternals["groupIncidentWithRule"]>
    > = await incidentEngine.groupIncidentWithRule(
      incidentOnCheckout(),
      incidentRule(),
    );

    expect(result.isNewEpisode).toBe(true);
    expect(createIncidentEpisode.mock.calls[0]![2]).toBe(
      CONNECTED_SERVICES_KEY_PART,
    );
  });
});
