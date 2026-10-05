import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import MonitorService from "../../../Server/Services/MonitorService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import RelationIdUtil from "../../../Server/Utils/Database/RelationIdUtil";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../TestingUtils/ProjectDirectory";

/*
 * An incident, an alert, a scheduled maintenance event, an episode and a
 * monitor each name records of their project - a state, a severity, the
 * monitor status to switch to, a monitor - and a write may name each one by
 * its ID column (`incidentSeverityId`) or by its relation
 * (`incidentSeverity`). The two are one database column, and TypeORM stores
 * the relation's id when a write carries both. So each service checks every
 * name that holds an id, and refuses a write whose two names disagree
 * before it reads anything:
 *
 *   - the project's own record, under either name or the same one under
 *     both, is accepted;
 *   - two different records under the two names, or a record beside a
 *     clear, are refused, naming both fields;
 *   - another project's record, under either name, is refused with the same
 *     words as an id that matches nothing.
 *
 * The services' own hooks run; which records the project has is a stand-in
 * (stubProjectDirectory), and a write the check accepts stops right after it
 * (PastTheCheck) instead of going on to the database.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-b0b0-4aaa-8bbb-000000000001",
);

// Ids of records of the project, two per table, and of none of it.
function ids(table: number): {
  own: string;
  otherOwn: string;
  foreign: string;
} {
  const suffix: string = String(table).padStart(2, "0");

  return {
    own: `0193c0de-b0b0-4aaa-8bbb-0000000a00${suffix}`,
    otherOwn: `0193c0de-b0b0-4aaa-8bbb-0000000b00${suffix}`,
    foreign: `0193c0de-b0b0-4aaa-8bbb-0000000f00${suffix}`,
  };
}

const INCIDENT_STATE: ReturnType<typeof ids> = ids(1);
const INCIDENT_SEVERITY: ReturnType<typeof ids> = ids(2);
const MONITOR_STATUS: ReturnType<typeof ids> = ids(3);
const ALERT_STATE: ReturnType<typeof ids> = ids(4);
const ALERT_SEVERITY: ReturnType<typeof ids> = ids(5);
const MONITOR: ReturnType<typeof ids> = ids(6);
const SCHEDULED_MAINTENANCE_STATE: ReturnType<typeof ids> = ids(7);

// An id no record has, in any project.
const MISSING_ID: string = "0193c0de-b0b0-4aaa-8bbb-00000000e999";

// Thrown right after a check accepts the write.
class PastTheCheck extends Error {}

interface Site {
  service: unknown;
  // How the services' refusals name the record written: "incident".
  subject: string;
  write: "create" | "update";
  relation: string;
  idColumn: string;
  // How the service's own check names the record: "Incident Severity".
  modelName: string;
  table: string;
  records: ReturnType<typeof ids>;
  // A create payload that is valid in every way but the reference.
  newRecord?: () => Record<string, unknown>;
  /*
   * The generic project check (ProjectReferencesService) covers this
   * relation too, before the service's own check: it looks the ids up first,
   * and names the record by the relation's title.
   */
  alsoCheckedGenerically?: boolean;
}

const incidentRecord: () => Record<string, unknown> = () => {
  return { title: "Payments are down" };
};

const SITES: Array<Site> = [
  // ---------------------------------------------------------------- incident
  {
    service: IncidentService,
    subject: "incident",
    write: "update",
    relation: "currentIncidentState",
    idColumn: "currentIncidentStateId",
    modelName: "Incident State",
    table: "IncidentState",
    records: INCIDENT_STATE,
    alsoCheckedGenerically: true,
  },
  {
    service: IncidentService,
    subject: "incident",
    write: "update",
    relation: "incidentSeverity",
    idColumn: "incidentSeverityId",
    modelName: "Incident Severity",
    table: "IncidentSeverity",
    records: INCIDENT_SEVERITY,
  },
  {
    service: IncidentService,
    subject: "incident",
    write: "update",
    relation: "changeMonitorStatusTo",
    idColumn: "changeMonitorStatusToId",
    modelName: "Monitor Status",
    table: "MonitorStatus",
    records: MONITOR_STATUS,
  },
  {
    service: IncidentService,
    subject: "incident",
    write: "create",
    relation: "incidentSeverity",
    idColumn: "incidentSeverityId",
    modelName: "Incident Severity",
    table: "IncidentSeverity",
    records: INCIDENT_SEVERITY,
    newRecord: incidentRecord,
  },
  {
    service: IncidentService,
    subject: "incident",
    write: "create",
    relation: "changeMonitorStatusTo",
    idColumn: "changeMonitorStatusToId",
    modelName: "Monitor Status",
    table: "MonitorStatus",
    records: MONITOR_STATUS,
    newRecord: incidentRecord,
  },
  // ------------------------------------------------------------------- alert
  {
    service: AlertService,
    subject: "alert",
    write: "update",
    relation: "currentAlertState",
    idColumn: "currentAlertStateId",
    modelName: "Alert State",
    table: "AlertState",
    records: ALERT_STATE,
    alsoCheckedGenerically: true,
  },
  {
    service: AlertService,
    subject: "alert",
    write: "update",
    relation: "alertSeverity",
    idColumn: "alertSeverityId",
    modelName: "Alert Severity",
    table: "AlertSeverity",
    records: ALERT_SEVERITY,
  },
  {
    service: AlertService,
    subject: "alert",
    write: "update",
    relation: "monitorStatusWhenThisAlertWasCreated",
    idColumn: "monitorStatusWhenThisAlertWasCreatedId",
    modelName: "Monitor Status",
    table: "MonitorStatus",
    records: MONITOR_STATUS,
  },
  {
    service: AlertService,
    subject: "alert",
    write: "update",
    relation: "monitor",
    idColumn: "monitorId",
    modelName: "Monitor",
    table: "Monitor",
    records: MONITOR,
  },
  {
    service: AlertService,
    subject: "alert",
    write: "create",
    relation: "alertSeverity",
    idColumn: "alertSeverityId",
    modelName: "Alert Severity",
    table: "AlertSeverity",
    records: ALERT_SEVERITY,
    newRecord: () => {
      return { title: "Disk is full" };
    },
  },
  {
    service: AlertService,
    subject: "alert",
    write: "create",
    relation: "monitorStatusWhenThisAlertWasCreated",
    idColumn: "monitorStatusWhenThisAlertWasCreatedId",
    modelName: "Monitor Status",
    table: "MonitorStatus",
    records: MONITOR_STATUS,
    newRecord: () => {
      return { title: "Disk is full" };
    },
  },
  {
    service: AlertService,
    subject: "alert",
    write: "create",
    relation: "monitor",
    idColumn: "monitorId",
    modelName: "Monitor",
    table: "Monitor",
    records: MONITOR,
    newRecord: () => {
      return { title: "Disk is full" };
    },
  },
  // ------------------------------------------------- scheduled maintenance
  {
    service: ScheduledMaintenanceService,
    subject: "scheduled maintenance event",
    write: "update",
    relation: "currentScheduledMaintenanceState",
    idColumn: "currentScheduledMaintenanceStateId",
    modelName: "Scheduled Maintenance State",
    table: "ScheduledMaintenanceState",
    records: SCHEDULED_MAINTENANCE_STATE,
    alsoCheckedGenerically: true,
  },
  {
    service: ScheduledMaintenanceService,
    subject: "scheduled maintenance event",
    write: "update",
    relation: "changeMonitorStatusTo",
    idColumn: "changeMonitorStatusToId",
    modelName: "Monitor Status",
    table: "MonitorStatus",
    records: MONITOR_STATUS,
  },
  {
    service: ScheduledMaintenanceService,
    subject: "scheduled maintenance event",
    write: "create",
    relation: "changeMonitorStatusTo",
    idColumn: "changeMonitorStatusToId",
    modelName: "Monitor Status",
    table: "MonitorStatus",
    records: MONITOR_STATUS,
    newRecord: () => {
      return { title: "Database upgrade" };
    },
  },
  // ---------------------------------------------------------------- episodes
  {
    service: IncidentEpisodeService,
    subject: "incident episode",
    write: "update",
    relation: "currentIncidentState",
    idColumn: "currentIncidentStateId",
    modelName: "Incident State",
    table: "IncidentState",
    records: INCIDENT_STATE,
    alsoCheckedGenerically: true,
  },
  {
    service: IncidentEpisodeService,
    subject: "incident episode",
    write: "update",
    relation: "incidentSeverity",
    idColumn: "incidentSeverityId",
    modelName: "Incident Severity",
    table: "IncidentSeverity",
    records: INCIDENT_SEVERITY,
  },
  {
    service: IncidentEpisodeService,
    subject: "incident episode",
    write: "create",
    relation: "incidentSeverity",
    idColumn: "incidentSeverityId",
    modelName: "Incident Severity",
    table: "IncidentSeverity",
    records: INCIDENT_SEVERITY,
    newRecord: () => {
      return { title: "Checkout errors" };
    },
  },
  {
    service: AlertEpisodeService,
    subject: "alert episode",
    write: "update",
    relation: "currentAlertState",
    idColumn: "currentAlertStateId",
    modelName: "Alert State",
    table: "AlertState",
    records: ALERT_STATE,
    alsoCheckedGenerically: true,
  },
  {
    service: AlertEpisodeService,
    subject: "alert episode",
    write: "update",
    relation: "alertSeverity",
    idColumn: "alertSeverityId",
    modelName: "Alert Severity",
    table: "AlertSeverity",
    records: ALERT_SEVERITY,
  },
  {
    service: AlertEpisodeService,
    subject: "alert episode",
    write: "create",
    relation: "alertSeverity",
    idColumn: "alertSeverityId",
    modelName: "Alert Severity",
    table: "AlertSeverity",
    records: ALERT_SEVERITY,
    newRecord: () => {
      return { title: "Disk alerts" };
    },
  },
  // ----------------------------------------------------------------- monitor
  {
    service: MonitorService,
    subject: "monitor",
    write: "update",
    relation: "currentMonitorStatus",
    idColumn: "currentMonitorStatusId",
    modelName: "Monitor Status",
    table: "MonitorStatus",
    records: MONITOR_STATUS,
    alsoCheckedGenerically: true,
  },
];

let directory: ProjectDirectoryStub;

function stateRow<T extends { _id?: string | undefined }>(
  ctor: new () => T,
  id: string,
): T {
  const row: T = new ctor();
  row._id = id;
  return row;
}

beforeEach(() => {
  directory = stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      IncidentState: [INCIDENT_STATE.own, INCIDENT_STATE.otherOwn],
      IncidentSeverity: [INCIDENT_SEVERITY.own, INCIDENT_SEVERITY.otherOwn],
      MonitorStatus: [MONITOR_STATUS.own, MONITOR_STATUS.otherOwn],
      AlertState: [ALERT_STATE.own, ALERT_STATE.otherOwn],
      AlertSeverity: [ALERT_SEVERITY.own, ALERT_SEVERITY.otherOwn],
      Monitor: [MONITOR.own, MONITOR.otherOwn],
      ScheduledMaintenanceState: [
        SCHEDULED_MAINTENANCE_STATE.own,
        SCHEDULED_MAINTENANCE_STATE.otherOwn,
      ],
    },
  });

  // The project's starting states, which the create hooks look up.
  jest
    .spyOn(IncidentStateService, "findOneBy")
    .mockResolvedValue(stateRow(IncidentState, INCIDENT_STATE.own) as never);
  jest
    .spyOn(AlertStateService, "findOneBy")
    .mockResolvedValue(stateRow(AlertState, ALERT_STATE.own) as never);
  jest
    .spyOn(ScheduledMaintenanceStateService, "findOneBy")
    .mockResolvedValue(
      stateRow(
        ScheduledMaintenanceState,
        SCHEDULED_MAINTENANCE_STATE.own,
      ) as never,
    );

  /*
   * An update reads the records it matches - for the ids they already hold,
   * the alerts whose monitor moves, the projects they are in: none here.
   */
  for (const service of [
    IncidentService,
    AlertService,
    ScheduledMaintenanceService,
    IncidentEpisodeService,
    AlertEpisodeService,
    MonitorService,
  ]) {
    jest
      .spyOn(service as unknown as { findBy: () => Promise<unknown> }, "findBy")
      .mockResolvedValue([] as never);
  }

  /*
   * The service's own check, as it is, then the stop: a write it accepts
   * goes no further.
   */
  const validate: typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject =
    ProjectScopedReferenceValidator.validateReferencesBelongToProject.bind(
      ProjectScopedReferenceValidator,
    );

  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockImplementation(async (data: Parameters<typeof validate>[0]) => {
      await validate(data);
      throw new PastTheCheck();
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function write(site: Site, values: Record<string, unknown>): Promise<unknown> {
  const hooks: Record<string, (input: unknown) => Promise<unknown>> =
    site.service as Record<string, (input: unknown) => Promise<unknown>>;

  const run: Promise<unknown> =
    site.write === "create"
      ? hooks["onBeforeCreate"]!({
          data: { ...site.newRecord!(), ...values },
          props: { tenantId: PROJECT_ID },
        })
      : hooks["onBeforeUpdate"]!({
          data: values,
          query: {},
          props: { tenantId: PROJECT_ID },
        });

  return run.then(
    () => {
      return "went on";
    },
    (error: unknown) => {
      return error;
    },
  );
}

// The ids the project check looked up in one table.
function lookedUp(table: string): Array<string> {
  return directory.recordLookups
    .filter((lookup: { model: string }): boolean => {
      return lookup.model === table;
    })
    .flatMap((lookup: { ids: Array<string> }): Array<string> => {
      return lookup.ids;
    })
    .map((id: string): string => {
      return id.toLowerCase();
    });
}

function conflictMessage(site: Site): string {
  return RelationIdUtil.getConflictMessage(site.modelName, [
    site.idColumn,
    site.relation,
  ]);
}

function refusalOf(outcome: unknown): string {
  expect(outcome).toBeInstanceOf(BadDataException);
  return (outcome as Error).message;
}

describe.each(SITES)("$subject $write: $relation", (site: Site) => {
  test("the project's own record under the ID column is accepted", async () => {
    expect(
      await write(site, { [site.idColumn]: site.records.own }),
    ).toBeInstanceOf(PastTheCheck);
    expect(lookedUp(site.table)).toContain(site.records.own);
  });

  test("the project's own record under the relation is accepted", async () => {
    expect(
      await write(site, { [site.relation]: { _id: site.records.own } }),
    ).toBeInstanceOf(PastTheCheck);
    expect(lookedUp(site.table)).toContain(site.records.own);
  });

  test("the same record under both names, in any case, is accepted", async () => {
    expect(
      await write(site, {
        [site.idColumn]: new ObjectID(site.records.own.toUpperCase()),
        [site.relation]: { _id: site.records.own },
      }),
    ).toBeInstanceOf(PastTheCheck);
    expect(new Set(lookedUp(site.table))).toEqual(new Set([site.records.own]));
  });

  test("two of the project's own records under the two names are refused, naming both fields", async () => {
    expect(
      refusalOf(
        await write(site, {
          [site.idColumn]: site.records.own,
          [site.relation]: { _id: site.records.otherOwn },
        }),
      ),
    ).toBe(conflictMessage(site));

    if (!site.alsoCheckedGenerically) {
      // Refused before anything is read.
      expect(lookedUp(site.table)).toEqual([]);
    }
  });

  test("another project's record behind one of the project's own is refused, whichever name holds which", async () => {
    for (const values of [
      {
        [site.idColumn]: site.records.own,
        [site.relation]: { _id: site.records.foreign },
      },
      {
        [site.idColumn]: site.records.foreign,
        [site.relation]: { _id: site.records.own },
      },
    ]) {
      const message: string = refusalOf(await write(site, values));

      /*
       * Refused as two names that disagree, or - where the generic check
       * reads the names first - as a record that is not the project's.
       * Either way the id is never accepted.
       */
      if (site.alsoCheckedGenerically) {
        expect(message).toContain(`"${site.records.foreign}"`);
      } else {
        expect(message).toBe(conflictMessage(site));
      }
    }
  });

  test("a record under one name beside a clear under the other is refused", async () => {
    for (const values of [
      { [site.idColumn]: null, [site.relation]: { _id: site.records.own } },
      { [site.idColumn]: site.records.own, [site.relation]: null },
    ]) {
      expect(refusalOf(await write(site, values))).toBe(conflictMessage(site));
    }
  });

  test.each([
    [
      "the ID column",
      (site: Site, id: string) => {
        return { [site.idColumn]: id };
      },
    ],
    [
      "the relation",
      (site: Site, id: string) => {
        return { [site.relation]: { _id: id } };
      },
    ],
  ] as Array<[string, (site: Site, id: string) => Record<string, unknown>]>)(
    "another project's record under %s is refused with the same words as one that does not exist",
    async (
      _name: string,
      payload: (site: Site, id: string) => Record<string, unknown>,
    ) => {
      const foreign: string = refusalOf(
        await write(site, payload(site, site.records.foreign)),
      );
      const missing: string = refusalOf(
        await write(site, payload(site, MISSING_ID)),
      );

      expect(foreign).toContain(
        `This ${site.subject} references records that are not in this project:`,
      );
      expect(foreign).toContain(`"${site.records.foreign}"`);
      expect(missing.split(MISSING_ID).join("<id>")).toBe(
        foreign.split(site.records.foreign).join("<id>"),
      );
    },
  );
});
