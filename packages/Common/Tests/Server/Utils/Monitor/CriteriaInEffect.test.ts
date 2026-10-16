import CriteriaInEffect, {
  OpenCriteriaRecord,
} from "../../../../Server/Utils/Monitor/CriteriaInEffect";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Whether a criteria is already in effect for a series of a monitor: what
 * lets "All Values" keep judging a firing series on its data points while
 * a series the criteria has not acted on yet waits for a full window
 * (#4793). A criteria that opens alerts or incidents is in effect while
 * one it opened for that series is open; a criteria that only sets the
 * monitor's status, while the monitor has that status.
 */

const OFFLINE_STATUS: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ONLINE_STATUS: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const UNRESOLVED_ALERT_STATE: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const UNRESOLVED_INCIDENT_STATE: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const FIRING_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HEALTHY_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function criteria(input: {
  id: string;
  statusId?: ObjectID | undefined;
  changeMonitorStatus?: boolean | undefined;
  createAlerts?: boolean | undefined;
  createIncidents?: boolean | undefined;
  withTemplates?: boolean | undefined;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  const withTemplates: boolean = input.withTemplates !== false;

  instance.data = {
    id: input.id,
    monitorStatusId: input.statusId,
    filterCondition: FilterCondition.Any,
    filters: [],
    incidents:
      input.createIncidents && withTemplates
        ? [
            {
              id: ObjectID.generate().toString(),
              title: "Incident",
              description: "",
              incidentSeverityId: ObjectID.generate(),
              autoResolveIncident: true,
              onCallPolicyIds: [],
            },
          ]
        : [],
    alerts:
      input.createAlerts && withTemplates
        ? [
            {
              id: ObjectID.generate().toString(),
              title: "Alert",
              description: "",
              alertSeverityId: ObjectID.generate(),
              autoResolveAlert: true,
              onCallPolicyIds: [],
            },
          ]
        : [],
    name: input.id,
    description: "",
    changeMonitorStatus: input.changeMonitorStatus,
    createAlerts: input.createAlerts,
    createIncidents: input.createIncidents,
  };

  return instance;
}

// The template's offline criteria: status, an incident and an alert.
const firing: MonitorCriteriaInstance = criteria({
  id: FIRING_ID,
  statusId: OFFLINE_STATUS,
  changeMonitorStatus: true,
  createAlerts: true,
  createIncidents: true,
});

// The template's healthy criteria: the status alone.
const healthy: MonitorCriteriaInstance = criteria({
  id: HEALTHY_ID,
  statusId: ONLINE_STATUS,
  changeMonitorStatus: true,
});

function monitorWithStatus(statusId: ObjectID | undefined): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = MONITOR_ID;
  monitor.projectId = PROJECT_ID;
  if (statusId) {
    monitor.currentMonitorStatusId = statusId;
  }
  return monitor;
}

function reading(
  records: Array<OpenCriteriaRecord>,
): () => Promise<Array<OpenCriteriaRecord>> {
  return async (): Promise<Array<OpenCriteriaRecord>> => {
    return records;
  };
}

describe("CriteriaInEffect", () => {
  describe("a criteria that opens alerts or incidents", () => {
    test("is in effect for a series while one it opened for that series is open", async () => {
      const inEffect: CriteriaInEffect = new CriteriaInEffect({
        monitor: monitorWithStatus(OFFLINE_STATUS),
        readOpenRecords: reading([
          { createdCriteriaId: FIRING_ID, seriesFingerprint: "series-a" },
        ]),
      });

      expect(
        await inEffect.isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: "series-a",
        }),
      ).toBe(true);
      expect(
        await inEffect.isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: "series-b",
        }),
      ).toBe(false);
    });

    test("not for a record another criteria opened", async () => {
      const inEffect: CriteriaInEffect = new CriteriaInEffect({
        monitor: monitorWithStatus(OFFLINE_STATUS),
        readOpenRecords: reading([
          {
            createdCriteriaId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            seriesFingerprint: "series-a",
          },
        ]),
      });

      expect(
        await inEffect.isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: "series-a",
        }),
      ).toBe(false);
    });

    test("an ungrouped monitor's record - no series - is in effect for the whole monitor only", async () => {
      const inEffect: CriteriaInEffect = new CriteriaInEffect({
        monitor: monitorWithStatus(OFFLINE_STATUS),
        readOpenRecords: reading([
          { createdCriteriaId: FIRING_ID, seriesFingerprint: undefined },
        ]),
      });

      expect(
        await inEffect.isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: undefined,
        }),
      ).toBe(true);
      expect(
        await inEffect.isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: "series-a",
        }),
      ).toBe(false);
    });

    /*
     * The leak this refuses: a grouped monitor is offline because series A
     * is firing, and series B - brand new, one reading - would pass for
     * "in effect" off the monitor's status and page at once.
     */
    test("never off the monitor's status: another series firing does not let a new one skip its window", async () => {
      const inEffect: CriteriaInEffect = new CriteriaInEffect({
        monitor: monitorWithStatus(OFFLINE_STATUS),
        readOpenRecords: reading([
          { createdCriteriaId: FIRING_ID, seriesFingerprint: "series-a" },
        ]),
      });

      expect(
        await inEffect.isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: "series-b",
        }),
      ).toBe(false);
    });

    test("reads the open records once, and only when asked about such a criteria", async () => {
      let reads: number = 0;
      const inEffect: CriteriaInEffect = new CriteriaInEffect({
        monitor: monitorWithStatus(ONLINE_STATUS),
        readOpenRecords: async (): Promise<Array<OpenCriteriaRecord>> => {
          reads++;
          return [];
        },
      });

      await inEffect.isInEffect({
        criteriaInstance: healthy,
        seriesFingerprint: "series-a",
      });
      expect(reads).toBe(0);

      for (const series of ["series-a", "series-b", "series-c"]) {
        await inEffect.isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: series,
        });
      }
      expect(reads).toBe(1);
    });

    test("without a reader, nothing it opened counts as open", async () => {
      expect(
        await new CriteriaInEffect({
          monitor: monitorWithStatus(OFFLINE_STATUS),
        }).isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: undefined,
        }),
      ).toBe(false);
    });

    test("a read that fails fails the evaluation - it is never taken for nothing open", async () => {
      const inEffect: CriteriaInEffect = new CriteriaInEffect({
        monitor: monitorWithStatus(OFFLINE_STATUS),
        readOpenRecords: async (): Promise<Array<OpenCriteriaRecord>> => {
          throw new Error("postgres unavailable");
        },
      });

      await expect(
        inEffect.isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: "series-a",
        }),
      ).rejects.toThrow("postgres unavailable");
    });
  });

  describe("a criteria that only sets the monitor's status", () => {
    test("is in effect while the monitor has its status, for every series", async () => {
      const inEffect: CriteriaInEffect = new CriteriaInEffect({
        monitor: monitorWithStatus(ONLINE_STATUS),
      });

      for (const series of [undefined, "series-a", "series-b"]) {
        expect(
          await inEffect.isInEffect({
            criteriaInstance: healthy,
            seriesFingerprint: series,
          }),
        ).toBe(true);
      }
    });

    test("not while the monitor has another status, or none", async () => {
      expect(
        await new CriteriaInEffect({
          monitor: monitorWithStatus(OFFLINE_STATUS),
        }).isInEffect({ criteriaInstance: healthy, seriesFingerprint: "a" }),
      ).toBe(false);
      expect(
        await new CriteriaInEffect({
          monitor: monitorWithStatus(undefined),
        }).isInEffect({ criteriaInstance: healthy, seriesFingerprint: "a" }),
      ).toBe(false);
    });

    test("a criteria switched on to open records it has no template for only sets the status", async () => {
      const statusOnly: MonitorCriteriaInstance = criteria({
        id: FIRING_ID,
        statusId: OFFLINE_STATUS,
        changeMonitorStatus: true,
        createAlerts: true,
        createIncidents: true,
        withTemplates: false,
      });

      expect(
        await new CriteriaInEffect({
          monitor: monitorWithStatus(OFFLINE_STATUS),
          readOpenRecords: reading([]),
        }).isInEffect({ criteriaInstance: statusOnly, seriesFingerprint: "a" }),
      ).toBe(true);
    });

    test("a criteria that neither sets a status nor opens anything is never in effect", async () => {
      const inert: MonitorCriteriaInstance = criteria({
        id: FIRING_ID,
        statusId: OFFLINE_STATUS,
        changeMonitorStatus: false,
      });

      expect(
        await new CriteriaInEffect({
          monitor: monitorWithStatus(OFFLINE_STATUS),
        }).isInEffect({ criteriaInstance: inert, seriesFingerprint: "a" }),
      ).toBe(false);
    });
  });

  test("no criteria, or one without an id, is never in effect", async () => {
    const inEffect: CriteriaInEffect = new CriteriaInEffect({
      monitor: monitorWithStatus(ONLINE_STATUS),
    });

    expect(
      await inEffect.isInEffect({
        criteriaInstance: undefined,
        seriesFingerprint: undefined,
      }),
    ).toBe(false);

    const withoutId: MonitorCriteriaInstance = criteria({
      id: "",
      statusId: ONLINE_STATUS,
      changeMonitorStatus: true,
    });

    expect(
      await inEffect.isInEffect({
        criteriaInstance: withoutId,
        seriesFingerprint: undefined,
      }),
    ).toBe(false);
  });

  describe("forMonitor reads what MonitorResource's resolve passes read", () => {
    let alertQueries: Array<JSONObject> = [];
    let incidentQueries: Array<JSONObject> = [];

    beforeEach(() => {
      alertQueries = [];
      incidentQueries = [];

      jest
        .spyOn(AlertStateService, "getUnresolvedAlertStateIds")
        .mockResolvedValue([UNRESOLVED_ALERT_STATE]);
      jest
        .spyOn(IncidentStateService, "getUnresolvedIncidentStateIds")
        .mockResolvedValue([UNRESOLVED_INCIDENT_STATE]);

      jest
        .spyOn(AlertService, "findBy")
        .mockImplementation(async (findBy: unknown): Promise<Array<Alert>> => {
          alertQueries.push(findBy as JSONObject);
          const alert: Alert = new Alert();
          alert.createdCriteriaId = FIRING_ID;
          alert.seriesFingerprint = "series-a";
          return [alert];
        });
      jest
        .spyOn(IncidentService, "findBy")
        .mockImplementation(
          async (findBy: unknown): Promise<Array<Incident>> => {
            incidentQueries.push(findBy as JSONObject);
            const incident: Incident = new Incident();
            incident.createdCriteriaId = FIRING_ID;
            // An ungrouped incident of the same criteria.
            return [incident];
          },
        );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("the monitor's open alerts and incidents: an open alert or an open incident keeps its series in effect", async () => {
      const inEffect: CriteriaInEffect = CriteriaInEffect.forMonitor(
        monitorWithStatus(OFFLINE_STATUS),
      );

      expect(
        await inEffect.isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: "series-a",
        }),
      ).toBe(true);
      expect(
        await inEffect.isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: undefined,
        }),
      ).toBe(true);
      expect(
        await inEffect.isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: "series-b",
        }),
      ).toBe(false);

      expect(alertQueries).toHaveLength(1);
      expect(incidentQueries).toHaveLength(1);
    });

    test("scoped to the monitor and the project's unresolved states, reading only what it needs, as root", async () => {
      await CriteriaInEffect.forMonitor(
        monitorWithStatus(OFFLINE_STATUS),
      ).isInEffect({ criteriaInstance: firing, seriesFingerprint: "x" });

      const alertQuery: JSONObject = alertQueries[0]!["query"] as JSONObject;
      expect(String(alertQuery["monitor"])).toBe(MONITOR_ID.toString());
      expect(JSON.stringify(alertQuery["currentAlertStateId"])).toContain(
        UNRESOLVED_ALERT_STATE.toString(),
      );
      expect(alertQueries[0]!["select"]).toEqual({
        _id: true,
        createdCriteriaId: true,
        seriesFingerprint: true,
      });
      expect(alertQueries[0]!["props"]).toEqual({ isRoot: true });

      const incidentQuery: JSONObject = incidentQueries[0]![
        "query"
      ] as JSONObject;
      expect(
        (incidentQuery["monitors"] as Array<ObjectID>).map((id: ObjectID) => {
          return id.toString();
        }),
      ).toEqual([MONITOR_ID.toString()]);
      expect(JSON.stringify(incidentQuery["currentIncidentStateId"])).toContain(
        UNRESOLVED_INCIDENT_STATE.toString(),
      );
      expect(incidentQueries[0]!["select"]).toEqual({
        _id: true,
        createdCriteriaId: true,
        seriesFingerprint: true,
      });

      expect(AlertStateService.getUnresolvedAlertStateIds).toHaveBeenCalledWith(
        PROJECT_ID,
      );
      expect(
        IncidentStateService.getUnresolvedIncidentStateIds,
      ).toHaveBeenCalledWith(PROJECT_ID);
    });

    test("a monitor without an id or a project has nothing open", async () => {
      const monitor: Monitor = new Monitor();

      expect(
        await CriteriaInEffect.forMonitor(monitor).isInEffect({
          criteriaInstance: firing,
          seriesFingerprint: undefined,
        }),
      ).toBe(false);
      expect(alertQueries).toEqual([]);
      expect(incidentQueries).toEqual([]);
    });
  });
});
