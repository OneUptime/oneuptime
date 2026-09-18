import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import HostService from "../../../../Server/Services/HostService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSummarySnapshot, {
  MonitorSummarySnapshotSource,
  MonitorSummarySnapshotVersion,
} from "../../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import MonitorSummarySnapshotUtil from "../../../../Utils/Monitor/MonitorSummarySnapshotUtil";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The real creators import the template sandbox, but these fixtures do not
 * execute JavaScript templates or need the native isolated-vm addon.
 */
jest.mock("isolated-vm", () => {
  return {};
});

type EntityKind = "alert" | "incident";
type Entity = Alert | Incident;

const ENTITY_KINDS: Array<EntityKind> = ["alert", "incident"];

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const OWNER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RESOLVED_STATE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const FIRST_CREATED_AT: Date = new Date("2026-09-17T14:20:00.000Z");
const SECOND_CREATED_AT: Date = new Date("2026-09-18T08:45:00.000Z");
const CHECK_AT: Date = new Date("2026-09-18T10:32:00.000Z");
const NEXT_CHECK_AT: Date = new Date("2026-09-18T10:37:00.000Z");
const DATABASE_CREATED_AT: Date = new Date("2026-09-18T10:32:03.000Z");
const AFTER_OWNERS_AT: Date = new Date("2026-09-18T10:32:30.000Z");
const CRITERIA_ID: string = "criteria-high-cpu";
const TEMPLATE_ID: string = "template-high-cpu";

function monitor(): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = MonitorType.Metrics;
  model.name = "CPU by host";
  return model;
}

function criteria(): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = CRITERIA_ID;
  instance.data!.name = "CPU above threshold";
  instance.data!.createAlerts = true;
  instance.data!.createIncidents = true;
  instance.data!.alerts = [
    {
      id: TEMPLATE_ID,
      title: "High CPU",
      description: "CPU is above the threshold.",
      alertSeverityId: SEVERITY_ID,
      autoResolveAlert: false,
      ownerUserIds: [OWNER_ID],
    },
  ];
  instance.data!.incidents = [
    {
      id: TEMPLATE_ID,
      title: "High CPU",
      description: "CPU is above the threshold.",
      incidentSeverityId: SEVERITY_ID,
      autoResolveIncident: false,
      ownerUserIds: [OWNER_ID],
    },
  ];
  return instance;
}

function openEntity(input: {
  kind: EntityKind;
  id: string;
  createdAt?: Date | undefined;
  fingerprint?: string | undefined;
  criteriaId?: string | undefined;
  templateId?: string | undefined;
}): Entity {
  const entity: Entity = input.kind === "alert" ? new Alert() : new Incident();
  entity._id = input.id;
  entity.projectId = PROJECT_ID;
  entity.title = "High CPU on an existing host";
  if (input.createdAt !== undefined) {
    entity.createdAt = input.createdAt;
  } else {
    delete entity.createdAt;
  }
  entity.createdCriteriaId = input.criteriaId || CRITERIA_ID;
  if (input.fingerprint !== undefined) {
    entity.seriesFingerprint = input.fingerprint;
  }
  if (entity instanceof Alert) {
    entity.alertNumber = 372;
    entity.alertNumberWithPrefix = "ALT-372";
  } else {
    entity.createdIncidentTemplateId = input.templateId || TEMPLATE_ID;
    entity.incidentNumber = 372;
    entity.incidentNumberWithPrefix = "INC-372";
  }
  return entity;
}

function series(fingerprint: string): PerSeriesCriteriaMatch {
  return {
    criteriaMetId: CRITERIA_ID,
    fingerprint,
    labels: { "host.name": fingerprint },
    rootCause: `High CPU on ${fingerprint}`,
  };
}

function summary(): MonitorEvaluationSummary {
  return {
    evaluatedAt: CHECK_AT,
    criteriaResults: [],
    events: [],
  };
}

function relatedCreatedAt(
  kind: EntityKind,
  event: MonitorEvaluationEvent,
): Date | undefined {
  return kind === "alert"
    ? event.relatedAlertCreatedAt
    : event.relatedIncidentCreatedAt;
}

function relatedId(
  kind: EntityKind,
  event: MonitorEvaluationEvent,
): string | undefined {
  return kind === "alert" ? event.relatedAlertId : event.relatedIncidentId;
}

const DATA_TO_PROCESS: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: MONITOR_ID,
  monitoredAt: CHECK_AT,
} as unknown as ProbeMonitorResponse;

describe.each(ENTITY_KINDS)(
  "Monitor summary %s action timestamps",
  (kind: EntityKind) => {
    let openEntities: Array<Entity> = [];
    let createdEntities: Array<Entity> = [];
    let currentDate: Date = CHECK_AT;
    let databaseCreatedAt: Date | undefined = DATABASE_CREATED_AT;
    let seriesCreatedAt: Dictionary<Date> = {};

    async function evaluate(
      input: {
        matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
        suppliedOpenEntities?: Array<Entity> | undefined;
        evaluationSummary?: MonitorEvaluationSummary | undefined;
        monitorSummary?: MonitorSummarySnapshot | undefined;
        suppressedSeriesFingerprints?: Set<string> | undefined;
      } = {},
    ): Promise<MonitorEvaluationSummary> {
      const evaluationSummary: MonitorEvaluationSummary =
        input.evaluationSummary || summary();
      const commonInput: {
        criteriaInstance: MonitorCriteriaInstance;
        monitor: Monitor;
        dataToProcess: ProbeMonitorResponse;
        rootCause: string;
        evaluationSummary: MonitorEvaluationSummary;
        monitorSummary?: MonitorSummarySnapshot | undefined;
        matchesPerSeries?: Array<PerSeriesCriteriaMatch> | undefined;
        suppressedSeriesFingerprints?: Set<string> | undefined;
        props: Record<string, never>;
      } = {
        criteriaInstance: criteria(),
        monitor: monitor(),
        dataToProcess: DATA_TO_PROCESS,
        rootCause: "CPU is above the threshold",
        evaluationSummary,
        monitorSummary: input.monitorSummary,
        matchesPerSeries: input.matchesPerSeries,
        suppressedSeriesFingerprints: input.suppressedSeriesFingerprints,
        props: {},
      };

      if (kind === "alert") {
        await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
          ...commonInput,
          autoResolveCriteriaInstanceIdAlertIdsDictionary: {},
          openAlerts: input.suppliedOpenEntities as Array<Alert> | undefined,
        });
      } else {
        await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
          ...commonInput,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary: {},
          openIncidents: input.suppliedOpenEntities as
            | Array<Incident>
            | undefined,
        });
      }

      return evaluationSummary;
    }

    function recordCreation(entity: Entity): void {
      entity._id = `created-${createdEntities.length + 1}`;
      const createdAt: Date | undefined =
        seriesCreatedAt[entity.seriesFingerprint || ""] || databaseCreatedAt;
      if (createdAt !== undefined) {
        entity.createdAt = createdAt;
      } else {
        delete entity.createdAt;
      }
      createdEntities.push(entity);
    }

    beforeEach(() => {
      openEntities = [];
      createdEntities = [];
      currentDate = CHECK_AT;
      databaseCreatedAt = DATABASE_CREATED_AT;
      seriesCreatedAt = {};

      jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
        return currentDate;
      });
      jest.spyOn(AlertService, "findBy").mockImplementation(async () => {
        return openEntities as Array<Alert>;
      });
      jest.spyOn(IncidentService, "findBy").mockImplementation(async () => {
        return openEntities as Array<Incident>;
      });
      jest
        .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
        .mockResolvedValue(true);
      jest
        .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
        .mockResolvedValue({
          hostIds: [],
          dockerHostIds: [],
          podmanHostIds: [],
          kubernetesClusterIds: [],
          serviceIds: [],
          proxmoxClusterIds: [],
          vmwareVCenterIds: [],
          cephClusterIds: [],
          dockerSwarmClusterIds: [],
          iotFleetIds: [],
        });
      jest.spyOn(HostService, "findBy").mockResolvedValue([]);
      jest
        .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
        .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });
      jest
        .spyOn(AlertService, "create")
        .mockImplementation(async (createBy: unknown): Promise<Alert> => {
          const entity: Alert = (createBy as { data: Alert }).data;
          recordCreation(entity);
          return entity;
        });
      jest
        .spyOn(IncidentService, "create")
        .mockImplementation(async (createBy: unknown): Promise<Incident> => {
          const entity: Incident = (createBy as { data: Incident }).data;
          recordCreation(entity);
          return entity;
        });
      /*
       * Owner assignment happens after persistence. Its completion time is
       * deliberately later than the database's createdAt timestamp.
       */
      jest.spyOn(AlertService, "addOwners").mockImplementation(async () => {
        currentDate = AFTER_OWNERS_AT;
      });
      jest.spyOn(IncidentService, "addOwners").mockImplementation(async () => {
        currentDate = AFTER_OWNERS_AT;
      });
      jest
        .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
        .mockResolvedValue(RESOLVED_STATE_ID);
      jest
        .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
        .mockResolvedValue(RESOLVED_STATE_ID);
      jest
        .spyOn(AlertStateTimelineService, "create")
        .mockResolvedValue(undefined as never);
      jest
        .spyOn(IncidentStateTimelineService, "create")
        .mockResolvedValue(undefined as never);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("selects the persisted creation date when loading active records", async () => {
      openEntities = [
        openEntity({ kind, id: "active", createdAt: FIRST_CREATED_AT }),
      ];

      const result: MonitorEvaluationSummary = await evaluate();

      expect(
        kind === "alert" ? AlertService.findBy : IncidentService.findBy,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({ createdAt: true }),
        }),
      );
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.type).toBe(`${kind}-skipped`);
      expect(relatedId(kind, result.events[0]!)).toBe("active");
      expect(relatedCreatedAt(kind, result.events[0]!)).toEqual(
        FIRST_CREATED_AT,
      );
      expect(result.events[0]!.at).toEqual(CHECK_AT);
      expect(createdEntities).toHaveLength(0);
    });

    it("keeps each series' own creation date when open records arrive in a different order", async () => {
      openEntities = [
        openEntity({
          kind,
          id: "other-criteria",
          fingerprint: "host-a",
          criteriaId: "other",
          createdAt: CHECK_AT,
        }),
        openEntity({
          kind,
          id: "active-b",
          fingerprint: "host-b",
          createdAt: SECOND_CREATED_AT,
        }),
        openEntity({
          kind,
          id: "active-a",
          fingerprint: "host-a",
          createdAt: FIRST_CREATED_AT,
        }),
      ];

      const result: MonitorEvaluationSummary = await evaluate({
        matchesPerSeries: [series("host-a"), series("host-b")],
      });

      expect(result.events).toHaveLength(2);
      expect(
        result.events.map((event: MonitorEvaluationEvent) => {
          return [
            relatedId(kind, event),
            relatedCreatedAt(kind, event),
            event.at,
          ];
        }),
      ).toEqual([
        ["active-a", FIRST_CREATED_AT, CHECK_AT],
        ["active-b", SECOND_CREATED_AT, CHECK_AT],
      ]);
      expect(createdEntities).toHaveLength(0);
    });

    it("keeps creation dates stable across repeated monitor checks", async () => {
      openEntities = [
        openEntity({ kind, id: "active", createdAt: FIRST_CREATED_AT }),
      ];

      const first: MonitorEvaluationSummary = await evaluate();
      currentDate = NEXT_CHECK_AT;
      const second: MonitorEvaluationSummary = await evaluate();

      expect(first.events[0]!.at).toEqual(CHECK_AT);
      expect(second.events[0]!.at).toEqual(NEXT_CHECK_AT);
      expect(relatedCreatedAt(kind, first.events[0]!)).toEqual(
        FIRST_CREATED_AT,
      );
      expect(relatedCreatedAt(kind, second.events[0]!)).toEqual(
        FIRST_CREATED_AT,
      );
      expect(createdEntities).toHaveLength(0);
    });

    it("uses the creation date from the caller's previously loaded active records", async () => {
      const result: MonitorEvaluationSummary = await evaluate({
        suppliedOpenEntities: [
          openEntity({ kind, id: "supplied", createdAt: SECOND_CREATED_AT }),
        ],
      });

      expect(AlertService.findBy).not.toHaveBeenCalled();
      expect(IncidentService.findBy).not.toHaveBeenCalled();
      expect(relatedId(kind, result.events[0]!)).toBe("supplied");
      expect(relatedCreatedAt(kind, result.events[0]!)).toEqual(
        SECOND_CREATED_AT,
      );
      expect(result.events[0]!.at).toEqual(CHECK_AT);
    });

    it("does not invent a creation date for an active record whose date is unavailable", async () => {
      openEntities = [openEntity({ kind, id: "legacy-active" })];

      const result: MonitorEvaluationSummary = await evaluate();

      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.type).toBe(`${kind}-skipped`);
      expect(relatedCreatedAt(kind, result.events[0]!)).toBeUndefined();
      expect(result.events[0]!.at).toEqual(CHECK_AT);
      expect(createdEntities).toHaveLength(0);
    });

    it("timestamps new creation with the database date even when owner assignment finishes later", async () => {
      const result: MonitorEvaluationSummary = await evaluate();

      expect(
        kind === "alert" ? AlertService.addOwners : IncidentService.addOwners,
      ).toHaveBeenCalledTimes(1);
      expect(currentDate).toEqual(AFTER_OWNERS_AT);
      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.type).toBe(`${kind}-created`);
      expect(result.events[0]!.at).toEqual(DATABASE_CREATED_AT);
      expect(result.events[0]!.at).not.toEqual(CHECK_AT);
      expect(result.events[0]!.at).not.toEqual(AFTER_OWNERS_AT);
    });

    it("falls back to the current action time when creation returns no database date", async () => {
      databaseCreatedAt = undefined;

      const result: MonitorEvaluationSummary = await evaluate();

      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.type).toBe(`${kind}-created`);
      expect(result.events[0]!.at).toEqual(AFTER_OWNERS_AT);
    });

    it("uses each new series' database timestamp independently", async () => {
      const secondDatabaseDate: Date = new Date("2026-09-18T10:32:35.000Z");
      seriesCreatedAt = {
        "host-a": DATABASE_CREATED_AT,
        "host-b": secondDatabaseDate,
      };

      const result: MonitorEvaluationSummary = await evaluate({
        matchesPerSeries: [series("host-a"), series("host-b")],
      });

      expect(createdEntities).toHaveLength(2);
      expect(
        result.events.map((event: MonitorEvaluationEvent) => {
          return [event.type, event.at];
        }),
      ).toEqual([
        [`${kind}-created`, DATABASE_CREATED_AT],
        [`${kind}-created`, secondDatabaseDate],
      ]);
    });

    it("leaves scheduled-maintenance skips at the evaluation time without a related creation date", async () => {
      const result: MonitorEvaluationSummary = await evaluate({
        matchesPerSeries: [series("host-a")],
        suppressedSeriesFingerprints: new Set<string>(["host-a"]),
      });

      expect(result.events).toHaveLength(1);
      expect(result.events[0]!.type).toBe(`${kind}-skipped`);
      expect(result.events[0]!.at).toEqual(CHECK_AT);
      expect(relatedCreatedAt(kind, result.events[0]!)).toBeUndefined();
      expect(relatedId(kind, result.events[0]!)).toBeUndefined();
      expect(createdEntities).toHaveLength(0);
    });

    it("timestamps resolution at recovery rather than at the record's creation", async () => {
      openEntities = [
        openEntity({ kind, id: "recovering", createdAt: FIRST_CREATED_AT }),
      ];
      const evaluationSummary: MonitorEvaluationSummary = summary();
      const commonInput: {
        monitorId: ObjectID;
        rootCause: string;
        criteriaInstance: null;
        dataToProcess: ProbeMonitorResponse;
        evaluationSummary: MonitorEvaluationSummary;
      } = {
        monitorId: MONITOR_ID,
        rootCause: "CPU recovered",
        criteriaInstance: null,
        dataToProcess: DATA_TO_PROCESS,
        evaluationSummary,
      };
      if (kind === "alert") {
        await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
          ...commonInput,
          autoResolveCriteriaInstanceIdAlertIdsDictionary: {
            [CRITERIA_ID]: [TEMPLATE_ID],
          },
        });
      } else {
        await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
          ...commonInput,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary: {
            [CRITERIA_ID]: [TEMPLATE_ID],
          },
        });
      }

      expect(evaluationSummary.events).toHaveLength(1);
      expect(evaluationSummary.events[0]!.type).toBe(`${kind}-resolved`);
      expect(evaluationSummary.events[0]!.at).toEqual(CHECK_AT);
      expect(
        relatedCreatedAt(kind, evaluationSummary.events[0]!),
      ).toBeUndefined();
    });

    it("persists an already-active entity's creation date in the summary captured on a newly created entity", async () => {
      openEntities = [
        openEntity({
          kind,
          id: "active-a",
          fingerprint: "host-a",
          createdAt: FIRST_CREATED_AT,
        }),
      ];
      const evaluationSummary: MonitorEvaluationSummary = summary();
      const monitorSummary: MonitorSummarySnapshot = {
        version: MonitorSummarySnapshotVersion,
        source: MonitorSummarySnapshotSource.Captured,
        monitorType: MonitorType.Metrics,
        capturedAt: CHECK_AT,
        evaluationSummary,
      };

      await evaluate({
        matchesPerSeries: [series("host-a"), series("host-b")],
        evaluationSummary,
        monitorSummary,
      });

      expect(createdEntities).toHaveLength(1);
      const stored: JSONObject = JSON.parse(
        JSON.stringify(createdEntities[0]!.monitorSummary),
      ) as JSONObject;
      const restored: MonitorSummarySnapshot | null =
        MonitorSummarySnapshotUtil.deserialize(stored);
      const restoredEvent: MonitorEvaluationEvent =
        restored!.evaluationSummary!.events[0]!;

      expect(restoredEvent.type).toBe(`${kind}-skipped`);
      expect(relatedId(kind, restoredEvent)).toBe("active-a");
      expect(relatedCreatedAt(kind, restoredEvent)).toBeInstanceOf(Date);
      expect(relatedCreatedAt(kind, restoredEvent)).toEqual(FIRST_CREATED_AT);
      expect(restoredEvent.at).toBeInstanceOf(Date);
      expect(restoredEvent.at).toEqual(CHECK_AT);
      expect(
        MonitorSummarySnapshotUtil.toSummaryInfoProps(restored!)
          .evaluationSummary!.events[0],
      ).toEqual(restoredEvent);
    });

    it("preserves both distinct timestamps in plain JSON monitor logs", async () => {
      openEntities = [
        openEntity({ kind, id: "active", createdAt: FIRST_CREATED_AT }),
      ];
      const result: MonitorEvaluationSummary = await evaluate();
      const stored: { events: Array<Record<string, string>> } = JSON.parse(
        JSON.stringify(result),
      ) as { events: Array<Record<string, string>> };

      expect(
        stored.events[0]![
          kind === "alert"
            ? "relatedAlertCreatedAt"
            : "relatedIncidentCreatedAt"
        ],
      ).toBe(FIRST_CREATED_AT.toISOString());
      expect(stored.events[0]!["at"]).toBe(CHECK_AT.toISOString());
    });
  },
);
