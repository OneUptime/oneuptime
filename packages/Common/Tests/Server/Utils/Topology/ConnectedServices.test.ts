import "../../TestingUtils/Init";
import ConnectedServices, {
  CONNECTED_SERVICES_KEY_PART,
  MAX_EPISODES_COMPARED,
  NO_SERVICE_KEY_PART,
  RecordServices,
} from "../../../../Server/Utils/Topology/ConnectedServices";
import AlertEpisodeMemberService from "../../../../Server/Services/AlertEpisodeMemberService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentEpisodeMemberService from "../../../../Server/Services/IncidentEpisodeMemberService";
import IncidentService from "../../../../Server/Services/IncidentService";
import InventoryItemRelationshipService from "../../../../Server/Services/InventoryItemRelationshipService";
import InventoryItemService from "../../../../Server/Services/InventoryItemService";
import MonitorService from "../../../../Server/Services/MonitorService";
import FindBy from "../../../../Server/Types/Database/FindBy";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisodeMember from "../../../../Models/DatabaseModels/AlertEpisodeMember";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "../../../../Models/DatabaseModels/IncidentEpisodeMember";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../../Models/DatabaseModels/InventoryItemRelationship";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Service from "../../../../Models/DatabaseModels/Service";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import EntityRelationshipType from "../../../../Types/Telemetry/EntityRelationshipType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Contract under test - which services are connected on the Service Map,
 * and which services an alert or an incident is on (ConnectedServices,
 * issue #6798), for grouping rules that group by connected services:
 *
 *  - a record's services are its own and its monitor's (an incident's:
 *    its monitors'), each once, by id in lower case;
 *  - two services are connected when one calls the other: a depends-on
 *    relationship of the inventory, either way, between the inventory
 *    items that point at the project's Service rows - a callee that is not
 *    a Service row connects nothing;
 *  - an episode's services are its records' services;
 *  - every read is held to the project, as root, and bounded; nothing is
 *    read for nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-000000000002",
);
const CHECKOUT: string = "0193c0de-bbbb-4aaa-8bbb-0000000000a1";
const ORDERS: string = "0193c0de-bbbb-4aaa-8bbb-0000000000a2";
const PAYMENTS: string = "0193c0de-bbbb-4aaa-8bbb-0000000000a3";
const SEARCH: string = "0193c0de-bbbb-4aaa-8bbb-0000000000a4";

function service(id: string): Service {
  return new Service(new ObjectID(id));
}

function item(data: {
  key: string;
  serviceId?: string | undefined;
}): InventoryItem {
  const row: InventoryItem = new InventoryItem(ObjectID.generate());
  row.entityKey = data.key;
  if (data.serviceId) {
    row.resourceType = "Service";
    row.resourceId = new ObjectID(data.serviceId);
  }
  return row;
}

function calls(from: string, to: string): InventoryItemRelationship {
  const row: InventoryItemRelationship = new InventoryItemRelationship(
    ObjectID.generate(),
  );
  row.fromEntityKey = from;
  row.toEntityKey = to;
  row.relationshipType = EntityRelationshipType.DependsOn;
  return row;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the grouping key part", () => {
  const onService: RecordServices = {
    serviceIds: new Set<string>([CHECKOUT]),
    connectedServiceIds: new Set<string>([CHECKOUT]),
  };
  const onNone: RecordServices = {
    serviceIds: new Set<string>(),
    connectedServiceIds: new Set<string>(),
  };

  test("a record on a service shares one part with every other", () => {
    expect(
      ConnectedServices.getGroupingKeyPart({
        services: onService,
        monitorId: MONITOR_ID,
        groupsByMonitor: false,
      }),
    ).toBe(CONNECTED_SERVICES_KEY_PART);
  });

  test("a record on no service is grouped by its monitor", () => {
    expect(
      ConnectedServices.getGroupingKeyPart({
        services: onNone,
        monitorId: MONITOR_ID,
        groupsByMonitor: false,
      }),
    ).toBe(`monitor:${MONITOR_ID.toString()}`);
    expect(
      ConnectedServices.getGroupingKeyPart({
        services: null,
        monitorId: MONITOR_ID,
        groupsByMonitor: false,
      }),
    ).toBe(`monitor:${MONITOR_ID.toString()}`);
  });

  test("the monitor is not named twice, and a record with neither shares the no-service part", () => {
    expect(
      ConnectedServices.getGroupingKeyPart({
        services: onNone,
        monitorId: MONITOR_ID,
        groupsByMonitor: true,
      }),
    ).toBe(NO_SERVICE_KEY_PART);
    expect(
      ConnectedServices.getGroupingKeyPart({
        services: onNone,
        monitorId: undefined,
        groupsByMonitor: false,
      }),
    ).toBe(NO_SERVICE_KEY_PART);
  });
});

describe("the services a record is on", () => {
  test("an alert's own and its monitor's, each once, in lower case; an alert on none is left out", async () => {
    const onBoth: Alert = new Alert(new ObjectID(PAYMENTS));
    onBoth.services = [service(CHECKOUT.toUpperCase())];
    onBoth.monitorId = MONITOR_ID;
    const onNone: Alert = new Alert(new ObjectID(SEARCH));
    onNone.services = [];

    const alertFind: SpyInstance<typeof AlertService.findBy> = jest
      .spyOn(AlertService, "findBy")
      .mockResolvedValue([onBoth, onNone]);
    const monitorFind: SpyInstance<typeof MonitorService.findBy> = jest
      .spyOn(MonitorService, "findBy")
      .mockImplementation(async () => {
        const monitor: Monitor = new Monitor(MONITOR_ID);
        monitor.services = [service(CHECKOUT), service(ORDERS)];
        return [monitor];
      });

    const services: Map<
      string,
      Set<string>
    > = await ConnectedServices.readServicesOfAlerts({
      projectId: PROJECT_ID,
      alertIds: [new ObjectID(PAYMENTS), new ObjectID(SEARCH)],
    });

    expect(Array.from(services.keys())).toEqual([PAYMENTS]);
    expect(Array.from(services.get(PAYMENTS)!).sort()).toEqual(
      [CHECKOUT, ORDERS].sort(),
    );

    for (const call of [...alertFind.mock.calls, ...monitorFind.mock.calls]) {
      const read: FindBy<never> = call[0] as unknown as FindBy<never>;
      expect((read.query as unknown as JSONObject)["projectId"]).toBe(
        PROJECT_ID,
      );
      expect(read.props).toEqual({ isRoot: true });
      expect(read.limit).toBeGreaterThan(0);
    }
  });

  test("an incident's own and its monitors'", async () => {
    const incident: Incident = new Incident(new ObjectID(PAYMENTS));
    incident.services = [service(PAYMENTS)];
    incident.monitors = [new Monitor(MONITOR_ID)];

    jest.spyOn(IncidentService, "findBy").mockResolvedValue([incident]);
    jest.spyOn(MonitorService, "findBy").mockImplementation(async () => {
      const monitor: Monitor = new Monitor(MONITOR_ID);
      monitor.services = [service(CHECKOUT)];
      return [monitor];
    });

    const services: Map<
      string,
      Set<string>
    > = await ConnectedServices.readServicesOfIncidents({
      projectId: PROJECT_ID,
      incidentIds: [new ObjectID(PAYMENTS)],
    });

    expect(Array.from(services.get(PAYMENTS)!).sort()).toEqual(
      [CHECKOUT, PAYMENTS].sort(),
    );
  });

  test("nothing is read for no records", async () => {
    const alertFind: SpyInstance<typeof AlertService.findBy> = jest.spyOn(
      AlertService,
      "findBy",
    );
    const incidentFind: SpyInstance<typeof IncidentService.findBy> = jest.spyOn(
      IncidentService,
      "findBy",
    );

    expect(
      (
        await ConnectedServices.readServicesOfAlerts({
          projectId: PROJECT_ID,
          alertIds: [],
        })
      ).size,
    ).toBe(0);
    expect(
      (
        await ConnectedServices.readServicesOfIncidents({
          projectId: PROJECT_ID,
          incidentIds: [],
        })
      ).size,
    ).toBe(0);
    expect(alertFind).not.toHaveBeenCalled();
    expect(incidentFind).not.toHaveBeenCalled();
  });
});

describe("the services connected on the Service Map", () => {
  /*
   * checkout -> orders -> payments, and checkout -> a database that is not
   * one of the project's services; search calls nothing.
   */
  function stubMap(): {
    relationshipReads: Array<FindBy<InventoryItemRelationship>>;
    itemReads: Array<FindBy<InventoryItem>>;
  } {
    const relationshipReads: Array<FindBy<InventoryItemRelationship>> = [];
    const itemReads: Array<FindBy<InventoryItem>> = [];
    const items: Array<InventoryItem> = [
      item({ key: "k-checkout", serviceId: CHECKOUT }),
      item({ key: "k-orders", serviceId: ORDERS }),
      item({ key: "k-payments", serviceId: PAYMENTS }),
      item({ key: "k-search", serviceId: SEARCH }),
      item({ key: "k-postgres" }),
    ];
    const edges: Array<InventoryItemRelationship> = [
      calls("k-checkout", "k-orders"),
      calls("k-orders", "k-payments"),
      calls("k-checkout", "k-postgres"),
    ];

    jest
      .spyOn(InventoryItemService, "findBy")
      .mockImplementation(async (findBy: FindBy<InventoryItem>) => {
        itemReads.push(findBy);
        const query: JSONObject = findBy.query as unknown as JSONObject;
        const values: Array<string> = (
          Object.values(
            (
              (query["resourceId"] || query["entityKey"]) as {
                objectLiteralParameters?: Record<string, unknown>;
              }
            ).objectLiteralParameters || {},
          )[0] as Array<unknown>
        ).map((value: unknown): string => {
          return String(value).toLowerCase();
        });

        return items.filter((row: InventoryItem): boolean => {
          return query["resourceId"] !== undefined
            ? Boolean(row.resourceId) &&
                values.includes(row.resourceId!.toString().toLowerCase())
            : Boolean(row.resourceId) &&
                values.includes(row.entityKey!.toLowerCase());
        });
      });
    jest
      .spyOn(InventoryItemRelationshipService, "findBy")
      .mockImplementation(async (findBy: FindBy<InventoryItemRelationship>) => {
        relationshipReads.push(findBy);
        const query: JSONObject = findBy.query as unknown as JSONObject;
        const column: "fromEntityKey" | "toEntityKey" =
          query["fromEntityKey"] !== undefined
            ? "fromEntityKey"
            : "toEntityKey";
        const keys: Array<string> = Object.values(
          (
            query[column] as {
              objectLiteralParameters?: Record<string, unknown>;
            }
          ).objectLiteralParameters || {},
        )[0] as Array<string>;

        return edges.filter((edge: InventoryItemRelationship): boolean => {
          return keys.includes(edge[column]!);
        });
      });

    return { relationshipReads, itemReads };
  }

  test("the ones a service calls and the ones that call it, one call apart, with itself", async () => {
    stubMap();

    expect(
      Array.from(
        await ConnectedServices.readConnectedServiceIds({
          projectId: PROJECT_ID,
          serviceIds: [ORDERS],
        }),
      ).sort(),
    ).toEqual([CHECKOUT, ORDERS, PAYMENTS].sort());

    // Two calls away is not connected; a database that is no service adds nothing.
    expect(
      Array.from(
        await ConnectedServices.readConnectedServiceIds({
          projectId: PROJECT_ID,
          serviceIds: [CHECKOUT],
        }),
      ).sort(),
    ).toEqual([CHECKOUT, ORDERS].sort());
  });

  test("reads only depends-on relationships, both ways, in the project", async () => {
    const { relationshipReads } = stubMap();

    await ConnectedServices.readConnectedServiceIds({
      projectId: PROJECT_ID,
      serviceIds: [ORDERS],
    });

    expect(relationshipReads).toHaveLength(2);

    for (const read of relationshipReads) {
      const query: JSONObject = read.query as unknown as JSONObject;
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(query["relationshipType"]).toBe(EntityRelationshipType.DependsOn);
      expect(read.props).toEqual({ isRoot: true });
    }

    expect(
      relationshipReads.map((read: FindBy<InventoryItemRelationship>) => {
        const query: JSONObject = read.query as unknown as JSONObject;
        return query["fromEntityKey"] !== undefined ? "from" : "to";
      }),
    ).toEqual(["from", "to"]);
  });

  test("a service that calls nothing and is called by nothing is connected to itself alone", async () => {
    stubMap();

    expect(
      Array.from(
        await ConnectedServices.readConnectedServiceIds({
          projectId: PROJECT_ID,
          serviceIds: [SEARCH],
        }),
      ),
    ).toEqual([SEARCH]);
  });

  test("a service the inventory has not seen is itself alone, and no relationship is read", async () => {
    const { relationshipReads } = stubMap();
    const unseen: string = "0193c0de-bbbb-4aaa-8bbb-0000000000ff";

    expect(
      Array.from(
        await ConnectedServices.readConnectedServiceIds({
          projectId: PROJECT_ID,
          serviceIds: [unseen],
        }),
      ),
    ).toEqual([unseen]);
    expect(relationshipReads).toHaveLength(0);
  });

  test("no services: nothing is read", async () => {
    const { itemReads } = stubMap();

    expect(
      (
        await ConnectedServices.readConnectedServiceIds({
          projectId: PROJECT_ID,
          serviceIds: [],
        })
      ).size,
    ).toBe(0);
    expect(itemReads).toHaveLength(0);
  });

  test("an alert on no service is connected to nothing, and the map is not read", async () => {
    jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
    const itemFind: SpyInstance<typeof InventoryItemService.findBy> =
      jest.spyOn(InventoryItemService, "findBy");

    const services: RecordServices = await ConnectedServices.readForAlert({
      projectId: PROJECT_ID,
      alertId: new ObjectID(SEARCH),
    });

    expect(services.serviceIds.size).toBe(0);
    expect(services.connectedServiceIds.size).toBe(0);
    expect(itemFind).not.toHaveBeenCalled();
  });
});

describe("the services of episodes", () => {
  const EPISODE_A: ObjectID = new ObjectID(
    "0193c0de-bbbb-4aaa-8bbb-0000000000e1",
  );
  const EPISODE_B: ObjectID = new ObjectID(
    "0193c0de-bbbb-4aaa-8bbb-0000000000e2",
  );

  test("an alert episode's are its alerts' services, newest members first and bounded", async () => {
    const member: (episode: ObjectID, alert: string) => AlertEpisodeMember = (
      episode: ObjectID,
      alert: string,
    ): AlertEpisodeMember => {
      const row: AlertEpisodeMember = new AlertEpisodeMember(
        ObjectID.generate(),
      );
      row.alertEpisodeId = episode;
      row.alertId = new ObjectID(alert);
      return row;
    };
    const memberFind: SpyInstance<typeof AlertEpisodeMemberService.findBy> =
      jest
        .spyOn(AlertEpisodeMemberService, "findBy")
        .mockResolvedValue([
          member(EPISODE_A, PAYMENTS),
          member(EPISODE_B, SEARCH),
        ]);
    jest.spyOn(ConnectedServices, "readServicesOfAlerts").mockResolvedValue(
      new Map<string, Set<string>>([
        [PAYMENTS, new Set<string>([ORDERS])],
        [SEARCH, new Set<string>([SEARCH])],
      ]),
    );

    const services: Map<
      string,
      Set<string>
    > = await ConnectedServices.readServicesOfAlertEpisodes({
      projectId: PROJECT_ID,
      episodeIds: [EPISODE_A, EPISODE_B],
    });

    expect(Array.from(services.get(EPISODE_A.toString())!)).toEqual([ORDERS]);
    expect(Array.from(services.get(EPISODE_B.toString())!)).toEqual([SEARCH]);

    const read: FindBy<AlertEpisodeMember> = memberFind.mock
      .calls[0]![0] as FindBy<AlertEpisodeMember>;
    expect((read.query as unknown as JSONObject)["projectId"]).toBe(PROJECT_ID);
    expect(read.sort).toEqual({ createdAt: "DESC" });
    expect(read.limit).toBeGreaterThan(0);
  });

  test("an incident episode's are its incidents' services", async () => {
    const row: IncidentEpisodeMember = new IncidentEpisodeMember(
      ObjectID.generate(),
    );
    row.incidentEpisodeId = EPISODE_A;
    row.incidentId = new ObjectID(PAYMENTS);

    jest.spyOn(IncidentEpisodeMemberService, "findBy").mockResolvedValue([row]);
    jest
      .spyOn(ConnectedServices, "readServicesOfIncidents")
      .mockResolvedValue(
        new Map<string, Set<string>>([[PAYMENTS, new Set<string>([CHECKOUT])]]),
      );

    const services: Map<
      string,
      Set<string>
    > = await ConnectedServices.readServicesOfIncidentEpisodes({
      projectId: PROJECT_ID,
      episodeIds: [EPISODE_A],
    });

    expect(Array.from(services.get(EPISODE_A.toString())!)).toEqual([CHECKOUT]);
  });

  test("the first episode, in the order given, that holds a connected service is picked", () => {
    const servicesByEpisode: Map<string, Set<string>> = new Map([
      [EPISODE_A.toString(), new Set<string>([SEARCH])],
      [EPISODE_B.toString(), new Set<string>([ORDERS])],
    ]);

    expect(
      ConnectedServices.pickConnectedEpisodeId({
        episodeIds: [EPISODE_A, EPISODE_B],
        servicesByEpisode,
        connectedServiceIds: new Set<string>([CHECKOUT, ORDERS]),
      })?.toString(),
    ).toBe(EPISODE_B.toString());
    expect(
      ConnectedServices.pickConnectedEpisodeId({
        episodeIds: [EPISODE_A, EPISODE_B],
        servicesByEpisode,
        connectedServiceIds: new Set<string>([PAYMENTS]),
      }),
    ).toBeNull();
  });

  test("intersects says whether two sets share a service", () => {
    expect(
      ConnectedServices.intersects(
        new Set<string>([CHECKOUT, ORDERS]),
        new Set<string>([ORDERS]),
      ),
    ).toBe(true);
    expect(
      ConnectedServices.intersects(new Set<string>([CHECKOUT]), new Set()),
    ).toBe(false);
    expect(ConnectedServices.intersects(undefined, new Set([CHECKOUT]))).toBe(
      false,
    );
  });

  test("a rule compares a record with a bounded number of its episodes", () => {
    expect(MAX_EPISODES_COMPARED).toBeGreaterThan(0);
    expect(MAX_EPISODES_COMPARED).toBeLessThanOrEqual(50);
  });
});
