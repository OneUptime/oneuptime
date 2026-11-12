/*
 * MonitorIncident and MonitorAlert render titles through MonitorTemplateUtil,
 * which pulls the native isolated-vm addon in through VMAPI. Nothing here
 * runs the sandbox, and the prebuilt binary cannot always load in the test
 * environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

// The owners' jobs register through RunCron at import: their handlers are read off its calls.
jest.mock("../../../../App/FeatureSet/Workers/Utils/Cron", () => {
  return { __esModule: true, default: jest.fn() };
});

import Alert from "../../../Models/DatabaseModels/Alert";
import AlertOwnerRule from "../../../Models/DatabaseModels/AlertOwnerRule";
import AlertOwnerTeam from "../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentOwnerRule from "../../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertGroupingEngineService from "../../../Server/Services/AlertGroupingEngineService";
import AlertIncidentRuleEngineService from "../../../Server/Services/AlertIncidentRuleEngineService";
import AlertLabelRuleEngineService from "../../../Server/Services/AlertLabelRuleEngineService";
import AlertOnCallRuleEngineService from "../../../Server/Services/AlertOnCallRuleEngineService";
import AlertOwnerRuleEngineService from "../../../Server/Services/AlertOwnerRuleEngineService";
import AlertOwnerRuleService from "../../../Server/Services/AlertOwnerRuleService";
import AlertOwnerTeamService from "../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import AlertPrivacyRuleEngineService from "../../../Server/Services/AlertPrivacyRuleEngineService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentGroupingEngineService from "../../../Server/Services/IncidentGroupingEngineService";
import IncidentLabelRuleEngineService from "../../../Server/Services/IncidentLabelRuleEngineService";
import IncidentOnCallRuleEngineService from "../../../Server/Services/IncidentOnCallRuleEngineService";
import IncidentOwnerRuleEngineService from "../../../Server/Services/IncidentOwnerRuleEngineService";
import IncidentOwnerRuleService from "../../../Server/Services/IncidentOwnerRuleService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentPostmortemStatusService from "../../../Server/Services/IncidentPostmortemStatusService";
import IncidentPrivacyRuleEngineService from "../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import MonitorOwnerTeamService from "../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../Server/Services/MonitorService";
import NetworkDeviceOwnerUserService from "../../../Server/Services/NetworkDeviceOwnerUserService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import ServiceOwnerTeamService from "../../../Server/Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../../Server/Services/ServiceOwnerUserService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import LinkedAffectedResources from "../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import AiFirstResponder from "../../../Server/Utils/AI/FirstResponder/AiFirstResponder";
import IncidentFollowUpCheck from "../../../Server/Utils/AI/SRE/IncidentFollowUpCheck";
import AIAlertInvestigationRunner from "../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DataAlertCause from "../../../Server/Utils/DataObservability/DataAlertCause";
import logger from "../../../Server/Utils/Logger";
import MonitorAlert from "../../../Server/Utils/Monitor/MonitorAlert";
import MonitorIncident from "../../../Server/Utils/Monitor/MonitorIncident";
import MonitorResourceContextUtil from "../../../Server/Utils/Monitor/MonitorResourceContext";
import OpenStackScopedRules from "../../../Server/Utils/OpenStack/OpenStackScopedRules";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import VideoCallRuleExecutor from "../../../Server/Utils/VideoCall/VideoCallRuleExecutor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PositiveNumber from "../../../Types/PositiveNumber";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { StartingStage } from "../../../Utils/StartingStage";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import RunCron from "../../../../App/FeatureSet/Workers/Utils/Cron";
import "../../../../App/FeatureSet/Workers/Jobs/IncidentOwners/SendCreatedResourceNotification";
import "../../../../App/FeatureSet/Workers/Jobs/AlertOwners/SendCreatedResourceNotification";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN INCIDENT'S "CREATED" EMAIL REACHES ITS REAL OWNERS, HOWEVER FAST ITS
 * JOB RUNS (#7210).
 *
 * The owners hear that an incident (an alert) was created from a job that
 * runs every minute (IncidentOwner:SendCreatedResourceEmail,
 * AlertOwner:SendCreatedResourceEmail): it takes every record not marked as
 * notified, marks it, and tells its owners - or, finding none, the
 * project's owners. A monitor's incident gets its owners after it is
 * written: the criteria's and the network device's once the create has
 * returned (MonitorIncident), the project's owner rules' in the create's
 * chain, which nobody waits for. A run of the job in between told the
 * project's owners, and the people the incident is for heard nothing.
 *
 * Here the real MonitorIncident (MonitorAlert) opens the record through the
 * real IncidentService.create and its real hooks, the database's insert
 * held in memory between them; the real owner rule engine and the real
 * OwnerRuleAssignment write its owner rows, and the real jobs - read off
 * RunCron - send the email, to whom the real findOwners reads. The job is
 * run right after the insert, while the monitor is still adding its owners,
 * while the chain is still on its way to the owner rules, and once
 * everything is done: whenever it runs, the email goes to every owner, and
 * nobody else, once.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "72100000-0000-4000-8000-000000000001",
);
const MONITOR_ID: string = "72100000-0000-4000-8000-000000000002";
const STEP_ID: string = "72100000-0000-4000-8000-000000000003";
const INCIDENT_SEVERITY: string = "72100000-0000-4000-8000-0000000000b1";
const ALERT_SEVERITY: string = "72100000-0000-4000-8000-0000000000b2";
const CREATED_INCIDENT_STATE: string = "72100000-0000-4000-8000-0000000000c1";
const CREATED_ALERT_STATE: string = "72100000-0000-4000-8000-0000000000c2";
const OWNER_RULE: string = "72100000-0000-4000-8000-0000000000d1";
// The criteria's incident and alert, which the record names as its template.
const CRITERIA_ITEM: Record<"incident" | "alert", string> = {
  incident: "72100000-0000-4000-8000-0000000000a1",
  alert: "72100000-0000-4000-8000-0000000000a2",
};

// The project's people: who owns what, and who owns the project.
const ANA: string = "72100000-0000-4000-8000-0000000000e1";
const BEN: string = "72100000-0000-4000-8000-0000000000e2";
const CARA: string = "72100000-0000-4000-8000-0000000000e3";
const DAN: string = "72100000-0000-4000-8000-0000000000e4";
const ADA: string = "72100000-0000-4000-8000-0000000000e5";
const PROJECT_OWNER: string = "72100000-0000-4000-8000-0000000000e6";
// Somebody who left the project.
const DEPARTED: string = "72100000-0000-4000-8000-0000000000e9";
const MEMBERS_TEAM: string = "72100000-0000-4000-8000-0000000000f0";
// Dan's team.
const PLATFORM_TEAM: string = "72100000-0000-4000-8000-0000000000f1";

type Kind = "incident" | "alert";

// The project's team member rows: every person but DEPARTED is a member.
const TEAM_ROWS: Array<{ teamId: string; userId: string }> = [
  ...[ANA, BEN, CARA, DAN, ADA, PROJECT_OWNER].map((userId: string) => {
    return { teamId: MEMBERS_TEAM, userId: userId };
  }),
  { teamId: PLATFORM_TEAM, userId: DAN },
];

// Who owns what the monitor opens: its criteria's owners, its device's, an owner rule's.
interface Owners {
  criteriaUsers: Array<string>;
  deviceUsers: Array<string>;
  rule: { users: Array<string>; teams: Array<string> } | null;
}

const EVERY_KIND_OF_OWNER: Owners = {
  criteriaUsers: [ANA],
  deviceUsers: [BEN],
  rule: { users: [CARA], teams: [PLATFORM_TEAM] },
};

// ... and whom an email to them reaches: Dan through his team.
const EVERY_KIND_OF_OWNER_REACHED: Array<string> = [ANA, BEN, CARA, DAN];

const NOBODY: Owners = { criteriaUsers: [], deviceUsers: [], rule: null };

let owners: Owners;

// A stored record: the row the insert wrote, and the one column the job reads.
interface StoredRecord {
  kind: Kind;
  model: BaseModel;
  isNotified: boolean;
}

let records: Map<string, StoredRecord>;

interface OwnerRow {
  recordId: string;
  userId?: string;
  teamId?: string;
}

let ownerRows: Array<OwnerRow>;

// Who the jobs notified: each send, in order.
let sent: Array<{ kind: Kind; recordId: string; userId: string }>;

// Each owner rule engine run that has finished, by kind.
let ownerRulesRan: Array<Kind>;

// Run the job right after each insert, before any hook after it.
let runJobAfterInsert: boolean;

/*
 * A step held until a test lets it through: `reached` once something waits
 * at it.
 */
class Gate {
  public reached: boolean = false;
  private opened: Promise<void>;
  private openIt: () => void = (): void => {};

  public constructor(isOpen: boolean) {
    this.opened = isOpen
      ? Promise.resolve()
      : new Promise<void>((resolve: () => void) => {
          this.openIt = resolve;
        });
  }

  public async pass(): Promise<void> {
    this.reached = true;
    await this.opened;
  }

  public open(): void {
    this.openIt();
  }
}

/*
 * Where a test holds the record on its way: the create's chain before its
 * Slack / Microsoft Teams step (before any owner it adds), the monitor's
 * code once the create has returned (before the criteria's and the
 * device's owners), and a create before its creator is made an owner.
 */
let gates: { chain: Gate; monitor: Gate; creator: Gate };

function idOf(value: unknown): string {
  return value ? String(value).toLowerCase() : "";
}

function idsAt(query: unknown, column: string): Array<string> {
  const value: unknown = (query as Record<string, unknown> | undefined)?.[
    column
  ];
  const parameters: Record<string, unknown> =
    ((value as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters as Record<string, unknown>) || {};
  const values: unknown = Object.values(parameters)[0];

  return (Array.isArray(values) ? values : []).map((item: unknown): string => {
    return String(item).toLowerCase();
  });
}

function personOf(userId: string): User {
  const user: User = new User();
  user._id = userId;
  return user;
}

type CronHandler = () => Promise<void>;

function jobNamed(name: string): CronHandler {
  const call: Array<unknown> | undefined = (
    RunCron as unknown as { mock: { calls: Array<Array<unknown>> } }
  ).mock.calls.find((item: Array<unknown>): boolean => {
    return item[0] === name;
  });

  if (!call) {
    throw new Error(`The job ${name} did not register.`);
  }

  return call[2] as CronHandler;
}

// The real jobs, as the worker runs them every minute.
const JOBS: Record<Kind, CronHandler> = {
  incident: jobNamed("IncidentOwner:SendCreatedResourceEmail"),
  alert: jobNamed("AlertOwner:SendCreatedResourceEmail"),
};

async function runJob(kind: Kind): Promise<void> {
  await JOBS[kind]();
}

// Who the job has told about records of `kind`, sorted.
function notified(kind: Kind): Array<string> {
  return sent
    .filter((item: { kind: Kind }): boolean => {
      return item.kind === kind;
    })
    .map((item: { userId: string }): string => {
      return item.userId;
    })
    .sort();
}

function onlyRecord(kind: Kind): string {
  const ids: Array<string> = Array.from(records.entries())
    .filter(([, record]: [string, StoredRecord]): boolean => {
      return record.kind === kind;
    })
    .map(([id]: [string, StoredRecord]): string => {
      return id;
    });

  expect(ids).toHaveLength(1);

  return ids[0]!;
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 400; attempt++) {
    if (condition()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error("The record never got there.");
}

// The notified column of each kind, as the job and the hold write it.
const NOTIFIED_COLUMN: Record<Kind, string> = {
  incident: "isOwnerNotifiedOfResourceCreation",
  alert: "isOwnerNotifiedOfAlertCreation",
};

function kindOf(service: unknown): Kind | null {
  if (service === IncidentService) {
    return "incident";
  }

  if (service === AlertService) {
    return "alert";
  }

  return null;
}

type CreateHooks = {
  onBeforeCreate: (
    createBy: CreateBy<BaseModel>,
  ) => Promise<OnCreate<BaseModel>>;
  onCreateSuccess: (
    onCreate: OnCreate<BaseModel>,
    createdItem: BaseModel,
  ) => Promise<BaseModel>;
  autoOwnerOnCreate: (
    createdItem: BaseModel,
    props: DatabaseCommonInteractionProps,
  ) => Promise<void>;
};

/*
 * DatabaseService.create, as it runs a create with its hooks, the insert
 * held here: onBeforeCreate, the row written as the hook left it,
 * onCreateSuccess (whose chain runs on), and the creator made an owner.
 */
function stubDatabaseCreate(): void {
  jest
    .spyOn(DatabaseService.prototype, "create")
    .mockImplementation(async function (
      this: unknown,
      createBy: CreateBy<BaseModel>,
    ): Promise<BaseModel> {
      const kind: Kind | null = kindOf(this);

      if (!kind) {
        throw new Error("Nothing but incidents and alerts is created here.");
      }

      const hooks: CreateHooks = this as unknown as CreateHooks;
      const onCreate: OnCreate<BaseModel> =
        await hooks.onBeforeCreate(createBy);
      const record: BaseModel = onCreate.createBy.data;

      record._id = ObjectID.generate().toString();
      record.setColumnValue("projectId", PROJECT_ID);

      records.set(idOf(record._id), {
        kind: kind,
        model: record,
        isNotified: record.getColumnValue(NOTIFIED_COLUMN[kind]) === true,
      });

      // The job may run any moment after the insert: right here, first.
      if (runJobAfterInsert) {
        await runJob(kind);
      }

      createBy.data = await hooks.onCreateSuccess(onCreate, record);

      await gates.creator.pass();
      await hooks.autoOwnerOnCreate(createBy.data, createBy.props);

      return createBy.data;
    } as never);
}

// The record's owner tables, held in memory (see OwnerRuleMatchingAgreement).
function stubOwnerTable(data: {
  service: unknown;
  makeRow: () => BaseModel;
  recordColumn: "incidentId" | "alertId";
  ownerColumn: "userId" | "teamId";
}): void {
  const table: Record<string, (...args: Array<unknown>) => Promise<unknown>> =
    data.service as Record<
      string,
      (...args: Array<unknown>) => Promise<unknown>
    >;

  jest.spyOn(table, "findBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<BaseModel>> => {
    const recordId: string = idOf(args.query[data.recordColumn]);
    const asked: Array<string> | null = args.query[data.ownerColumn]
      ? idsAt(args.query, data.ownerColumn)
      : null;

    return ownerRows
      .filter((row: OwnerRow): boolean => {
        const ownerId: string = row[data.ownerColumn] || "";

        return (
          row.recordId === recordId &&
          Boolean(ownerId) &&
          (!asked || asked.includes(ownerId))
        );
      })
      .map((row: OwnerRow): BaseModel => {
        const ownerId: string = row[data.ownerColumn]!;
        const item: BaseModel = data.makeRow();
        item.setColumnValue(data.recordColumn, new ObjectID(row.recordId));
        item.setColumnValue("projectId", PROJECT_ID);
        item.setColumnValue(data.ownerColumn, new ObjectID(ownerId));

        if (data.ownerColumn === "userId") {
          item.setColumnValue("user", personOf(ownerId));
        }

        return item;
      });
  }) as never);

  jest.spyOn(table, "create").mockImplementation((async (createBy: {
    data: BaseModel;
  }): Promise<BaseModel> => {
    ownerRows.push({
      recordId: idOf(createBy.data.getColumnValue(data.recordColumn)),
      [data.ownerColumn]: idOf(createBy.data.getColumnValue(data.ownerColumn)),
    });

    return createBy.data;
  }) as never);
}

// The project's team member rows, every read of them (see OwnerRuleMatchingAgreement).
function stubTeamMembers(): void {
  const matching: (
    query: Record<string, unknown>,
  ) => Array<{ teamId: string; userId: string }> = (
    query: Record<string, unknown>,
  ): Array<{ teamId: string; userId: string }> => {
    if (query["projectId"] && idOf(query["projectId"]) !== idOf(PROJECT_ID)) {
      return [];
    }

    const teamIds: Array<string> | null = query["teamId"]
      ? idsAt(query, "teamId")
      : null;
    const userIds: Array<string> | null = query["userId"]
      ? query["userId"] instanceof ObjectID
        ? [idOf(query["userId"])]
        : idsAt(query, "userId")
      : null;

    return TEAM_ROWS.filter((row: { teamId: string; userId: string }) => {
      return (
        (!teamIds || teamIds.includes(row.teamId)) &&
        (!userIds || userIds.includes(row.userId))
      );
    });
  };

  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<TeamMember>> => {
    return matching(args.query).map(
      (row: { teamId: string; userId: string }): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.projectId = PROJECT_ID;
        member.teamId = new ObjectID(row.teamId);
        member.userId = new ObjectID(row.userId);
        member.hasAcceptedInvitation = true;
        member.user = personOf(row.userId);
        return member;
      },
    );
  }) as never);

  jest.spyOn(TeamMemberService, "countBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<PositiveNumber> => {
    return new PositiveNumber(matching(args.query).length);
  }) as never);
}

// The monitor and its one criteria, which opens an incident or an alert.
function criteriaOf(kind: Kind): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-offline";
  instance.data!.name = "Offline";
  instance.data!.changeMonitorStatus = false;
  instance.data!.createIncidents = kind === "incident";
  instance.data!.createAlerts = kind === "alert";
  instance.data!.incidents = [];
  instance.data!.alerts = [];

  const template: Record<string, unknown> = {
    id: CRITERIA_ITEM[kind],
    title: "Checkout API is offline",
    description: "The check failed.",
    ownerUserIds: owners.criteriaUsers.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    ownerTeamIds: [],
  };

  if (kind === "incident") {
    instance.data!.incidents = [
      {
        ...template,
        incidentSeverityId: new ObjectID(INCIDENT_SEVERITY),
      } as never,
    ];
  } else {
    instance.data!.alerts = [
      {
        ...template,
        alertSeverityId: new ObjectID(ALERT_SEVERITY),
      } as never,
    ];
  }

  return instance;
}

function monitorOf(kind: Kind): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID;
  monitor.name = "Checkout API";
  monitor.description = "";
  monitor.monitorType = MonitorType.Website;
  monitor.projectId = PROJECT_ID;
  monitor.labels = [];
  monitor.monitorSteps = {
    data: {
      monitorStepsInstanceArray: [
        {
          id: new ObjectID(STEP_ID),
          data: {
            id: STEP_ID,
            monitorCriteria: {
              data: { monitorCriteriaInstanceArray: [criteriaOf(kind)] },
            },
          },
        },
      ],
    },
  } as unknown as MonitorSteps;
  return monitor;
}

const DATA_TO_PROCESS: ProbeMonitorResponse = {
  projectId: PROJECT_ID,
  monitorId: new ObjectID(MONITOR_ID),
  monitorStepId: new ObjectID(STEP_ID),
  monitoredAt: new Date("2026-11-12T08:00:00.000Z"),
} as unknown as ProbeMonitorResponse;

// The monitor's criteria is met: it opens the record, as the probe's report would.
function openFromMonitor(kind: Kind): Promise<unknown> {
  if (kind === "incident") {
    return MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
      criteriaInstance: criteriaOf(kind),
      monitor: monitorOf(kind),
      dataToProcess: DATA_TO_PROCESS,
      rootCause: "The check failed",
      autoResolveCriteriaInstanceIdIncidentIdsDictionary: {},
      openIncidents: [],
      props: {},
    });
  }

  return MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
    criteriaInstance: criteriaOf(kind),
    monitor: monitorOf(kind),
    dataToProcess: DATA_TO_PROCESS,
    rootCause: "The check failed",
    autoResolveCriteriaInstanceIdAlertIdsDictionary: {},
    openAlerts: [],
    props: {},
  });
}

// What the monitor's code reads to open the record.
function stubMonitorReads(): void {
  jest.spyOn(MonitorService, "findOneById").mockImplementation((async () => {
    return monitorOf("incident");
  }) as never);
  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockImplementation((async () => {
      return {
        ownerUserIds: owners.deviceUsers.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
        ownerTeamIds: [],
      };
    }) as never);
  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockImplementation((async () => {
      return MonitorResourceContextUtil.emptyContext();
    }) as never);
  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockImplementation((async () => {
      return MonitorResourceContextUtil.emptyContext();
    }) as never);
  jest.spyOn(MonitorOwnerUserService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(MonitorOwnerTeamService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(ServiceOwnerUserService, "findBy").mockResolvedValue([] as never);
  jest.spyOn(ServiceOwnerTeamService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "isUsableInProject")
    .mockResolvedValue(true);
  jest
    .spyOn(ProjectScopedReferenceValidator, "filterUsableInProject")
    .mockImplementation((async (data: { ids: Array<ObjectID | string> }) => {
      return { usableIds: data.ids, droppedIds: [] };
    }) as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockImplementation((async () => {
      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = INCIDENT_SEVERITY;
      severity.name = "Critical";
      return [severity];
    }) as never);
  jest.spyOn(AlertSeverityService, "findBy").mockImplementation((async () => {
    const severity: AlertSeverity = new AlertSeverity();
    severity._id = ALERT_SEVERITY;
    severity.name = "Warning";
    return [severity];
  }) as never);
  jest.spyOn(DataAlertCause, "getSubject").mockResolvedValue(null);

  // The monitor's code, once the create has returned: held at its first step.
  jest
    .spyOn(OpenStackScopedRules, "finishIncident")
    .mockImplementation((async (): Promise<void> => {
      await gates.monitor.pass();
    }) as never);
  jest
    .spyOn(OpenStackScopedRules, "finishAlert")
    .mockImplementation((async (): Promise<void> => {
      await gates.monitor.pass();
    }) as never);
}

// The project's one owner rule, when the test gives it one: it matches everything.
function stubOwnerRules(): void {
  const rule: (
    make: () => IncidentOwnerRule | AlertOwnerRule,
  ) => Array<IncidentOwnerRule | AlertOwnerRule> = (
    make: () => IncidentOwnerRule | AlertOwnerRule,
  ): Array<IncidentOwnerRule | AlertOwnerRule> => {
    if (!owners.rule) {
      return [];
    }

    const item: IncidentOwnerRule | AlertOwnerRule = make();
    item._id = OWNER_RULE;
    item.name = "Checkout belongs to Platform";
    item.projectId = PROJECT_ID;
    item.isEnabled = true;
    item.notifyOwners = true;
    item.monitors = [];
    item.monitorLabels = [];
    item.ownerUsers = owners.rule.users.map(personOf);
    item.ownerTeams = owners.rule.teams.map((id: string): Team => {
      const team: Team = new Team();
      team._id = id;
      return team;
    });
    item.inheritOwnersFromMonitors = false;
    item.inheritOwnersFromServices = false;
    return [item];
  };

  jest
    .spyOn(IncidentOwnerRuleService, "findBy")
    .mockImplementation((async () => {
      return rule((): IncidentOwnerRule => {
        const item: IncidentOwnerRule = new IncidentOwnerRule();
        item.incidentSeverities = [];
        item.incidentLabels = [];
        return item;
      });
    }) as never);
  jest.spyOn(AlertOwnerRuleService, "findBy").mockImplementation((async () => {
    return rule((): AlertOwnerRule => {
      const item: AlertOwnerRule = new AlertOwnerRule();
      item.alertSeverities = [];
      item.alertLabels = [];
      return item;
    });
  }) as never);

  // The real engines; a test waits for them through ownerRulesRan.
  const incidentRules: typeof IncidentOwnerRuleEngineService.applyRulesToIncident =
    IncidentOwnerRuleEngineService.applyRulesToIncident.bind(
      IncidentOwnerRuleEngineService,
    );
  jest
    .spyOn(IncidentOwnerRuleEngineService, "applyRulesToIncident")
    .mockImplementation((async (...args: Array<unknown>) => {
      const result: unknown = await (
        incidentRules as unknown as (
          ...args: Array<unknown>
        ) => Promise<unknown>
      )(...args);
      ownerRulesRan.push("incident");
      return result;
    }) as never);

  const alertRules: typeof AlertOwnerRuleEngineService.applyRulesToAlert =
    AlertOwnerRuleEngineService.applyRulesToAlert.bind(
      AlertOwnerRuleEngineService,
    );
  jest
    .spyOn(AlertOwnerRuleEngineService, "applyRulesToAlert")
    .mockImplementation((async (...args: Array<unknown>) => {
      const result: unknown = await (
        alertRules as unknown as (...args: Array<unknown>) => Promise<unknown>
      )(...args);
      ownerRulesRan.push("alert");
      return result;
    }) as never);
}

// What the create's hooks read, and every step of its chain but the owners'.
function stubCreateHooks(): void {
  stubProjectDirectory({});

  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue([] as never);
  // The criteria's incident is not an incident template: none is found under its id.
  jest
    .spyOn(IncidentTemplateService, "findOneBy")
    .mockResolvedValue(null as never);

  // The owner rule engines' feed line names who they added.
  jest.spyOn(UserService, "findBy").mockImplementation((async (args: {
    query: unknown;
  }): Promise<Array<User>> => {
    return idsAt(args.query, "_id").map((id: string): User => {
      return personOf(id);
    });
  }) as never);
  jest.spyOn(TeamService, "findBy").mockImplementation((async (args: {
    query: unknown;
  }): Promise<Array<Team>> => {
    return idsAt(args.query, "_id").map((id: string): Team => {
      const team: Team = new Team();
      team._id = id;
      team.name = "Platform";
      return team;
    });
  }) as never);
  jest
    .spyOn(IncidentStateService, "getCreatedIncidentStateId")
    .mockResolvedValue(new ObjectID(CREATED_INCIDENT_STATE) as never);
  jest
    .spyOn(IncidentStateService, "findOneBy")
    .mockImplementation((async (): Promise<IncidentState> => {
      const state: IncidentState = new IncidentState();
      state._id = CREATED_INCIDENT_STATE;
      state.isCreatedState = true;
      return state;
    }) as never);
  jest.spyOn(IncidentStateService, "getStartingState").mockResolvedValue({
    stage: StartingStage.Open,
    flaggedResolved: false,
  } as never);
  jest
    .spyOn(AlertStateService, "getCreatedAlertStateId")
    .mockResolvedValue(new ObjectID(CREATED_ALERT_STATE) as never);
  jest
    .spyOn(AlertStateService, "findOneBy")
    .mockImplementation((async (): Promise<AlertState> => {
      const state: AlertState = new AlertState();
      state._id = CREATED_ALERT_STATE;
      state.isCreatedState = true;
      return state;
    }) as never);
  jest.spyOn(AlertStateService, "getStartingState").mockResolvedValue({
    stage: StartingStage.Open,
    flaggedResolved: false,
  } as never);
  jest
    .spyOn(IncidentPostmortemStatusService, "getProjectStatuses")
    .mockResolvedValue([] as never);
  jest
    .spyOn(ProjectService, "incrementAndGetIncidentCounter")
    .mockResolvedValue({ counter: 7, prefix: "INC-" } as never);
  jest
    .spyOn(ProjectService, "incrementAndGetAlertCounter")
    .mockResolvedValue({ counter: 9, prefix: "ALT-" } as never);
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue("**Ada**" as never);
  jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation((() => {
    // no analytics in tests
  }) as never);

  const incidentService: Record<string, () => Promise<unknown>> =
    IncidentService as unknown as Record<string, () => Promise<unknown>>;
  const alertService: Record<string, () => Promise<unknown>> =
    AlertService as unknown as Record<string, () => Promise<unknown>>;

  // The chain's Slack / Microsoft Teams step: before any owner it adds.
  jest
    .spyOn(incidentService, "handleIncidentWorkspaceOperationsAsync")
    .mockImplementation(async (): Promise<undefined> => {
      await gates.chain.pass();
      return undefined;
    });
  jest
    .spyOn(alertService, "handleAlertWorkspaceOperationsAsync")
    .mockImplementation(async (): Promise<undefined> => {
      await gates.chain.pass();
      return undefined;
    });

  for (const method of [
    "createIncidentFeedAsync",
    "handleIncidentStateChangeAsync",
    "handleMonitorStatusChangeAsync",
    "disableActiveMonitoringIfManualIncident",
    "refreshReminderSchedule",
    "executeOnCallDutyPoliciesAsync",
  ]) {
    jest.spyOn(incidentService, method).mockResolvedValue(undefined as never);
  }

  for (const method of [
    "createAlertFeedAsync",
    "handleAlertStateChangeAsync",
    "refreshReminderSchedule",
    "executeAlertOnCallDutyPoliciesAsync",
  ]) {
    jest.spyOn(alertService, method).mockResolvedValue(undefined as never);
  }

  jest.spyOn(IncidentService, "findOneById").mockImplementation((async (args: {
    id: ObjectID;
  }) => {
    return records.get(idOf(args.id))?.model || null;
  }) as never);

  jest
    .spyOn(IncidentPrivacyRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(false as never);
  jest
    .spyOn(IncidentLabelRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentOnCallRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RunbookRuleEngineService, "applyRulesToIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentGroupingEngineService, "processIncident")
    .mockResolvedValue({} as never);
  jest
    .spyOn(IncidentSlaService, "createSlaForIncident")
    .mockResolvedValue(null as never);
  jest
    .spyOn(AIIncidentInvestigationRunner, "investigateNewIncident")
    .mockResolvedValue(false as never);
  jest
    .spyOn(AutoRemediationRuleEngineService, "onIncidentCreated")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(VideoCallRuleExecutor, "startCallsForIncident")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(AlertPrivacyRuleEngineService, "applyRulesToAlert")
    .mockResolvedValue(false as never);
  jest
    .spyOn(AlertLabelRuleEngineService, "applyRulesToAlert")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertOnCallRuleEngineService, "applyRulesToAlert")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(RunbookRuleEngineService, "applyRulesToAlert")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertGroupingEngineService, "processAlert")
    .mockResolvedValue({ grouped: false } as never);
  jest
    .spyOn(AIAlertInvestigationRunner, "investigateNewAlert")
    .mockResolvedValue(false as never);
  jest
    .spyOn(AutoRemediationRuleEngineService, "onAlertCreated")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentFollowUpCheck, "onAlertOpened")
    .mockResolvedValue([] as never);
  jest
    .spyOn(AlertIncidentRuleEngineService, "applyRulesToAlert")
    .mockResolvedValue({ outcome: "NoRuleMatched" } as never);
  jest
    .spyOn(VideoCallRuleExecutor, "startCallsForAlert")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(AiFirstResponder, "onRecordCreated")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);
}

// The record as the job selects it: what its email says.
function asTheJobReadsIt(kind: Kind, id: string): BaseModel {
  const project: Project = new Project();
  project.name = "Payments";

  if (kind === "incident") {
    const incident: Incident = new Incident();
    incident._id = id;
    incident.projectId = PROJECT_ID;
    incident.project = project;
    incident.title = "Checkout API is offline";
    incident.description = "The check failed.";
    incident.incidentNumber = 7;
    incident.incidentNumberWithPrefix = "INC-7";
    const state: IncidentState = new IncidentState();
    state.name = "Created";
    incident.currentIncidentState = state;
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "Critical";
    incident.incidentSeverity = severity;
    return incident;
  }

  const alert: Alert = new Alert();
  alert._id = id;
  alert.projectId = PROJECT_ID;
  alert.project = project;
  alert.title = "Checkout API is offline";
  alert.description = "The check failed.";
  alert.alertNumber = 9;
  alert.alertNumberWithPrefix = "ALT-9";
  const state: AlertState = new AlertState();
  state.name = "Created";
  alert.currentAlertState = state;
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Warning";
  alert.alertSeverity = severity;
  return alert;
}

// The records' one column the jobs read and mark, and the hold releases.
function stubNotifiedColumn(kind: Kind): void {
  const service: Record<string, (...args: Array<unknown>) => unknown> =
    (kind === "incident" ? IncidentService : AlertService) as unknown as Record<
      string,
      (...args: Array<unknown>) => unknown
    >;

  // Exactly the records not marked as notified (the jobs' own query).
  jest.spyOn(service, "findAllBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
  }): Promise<Array<BaseModel>> => {
    expect(args.query).toEqual({ [NOTIFIED_COLUMN[kind]]: false });

    return Array.from(records.entries())
      .filter(([, record]: [string, StoredRecord]): boolean => {
        return record.kind === kind && !record.isNotified;
      })
      .map(([id]: [string, StoredRecord]): BaseModel => {
        return asTheJobReadsIt(kind, id);
      });
  }) as never);

  // The job's mark, and the hold's release, on the same column.
  jest.spyOn(service, "updateOneById").mockImplementation((async (updateBy: {
    id: ObjectID;
    data: JSONObject;
  }): Promise<void> => {
    const value: unknown = updateBy.data[NOTIFIED_COLUMN[kind]];
    const record: StoredRecord | undefined = records.get(idOf(updateBy.id));

    if (record && typeof value === "boolean") {
      record.isNotified = value;
    }
  }) as never);
}

// What the jobs read and write besides the owners: the records' one column, and the send.
function stubJobs(): void {
  stubNotifiedColumn("incident");
  stubNotifiedColumn("alert");

  jest
    .spyOn(IncidentService, "getIncidentIdentifiedDate")
    .mockResolvedValue(new Date("2026-11-12T08:00:00.000Z") as never);
  jest
    .spyOn(AlertService, "getAlertIdentifiedDate")
    .mockResolvedValue(new Date("2026-11-12T08:00:00.000Z") as never);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue("https://oneuptime.example/incident" as never);
  jest
    .spyOn(AlertService, "getAlertLinkInDashboard")
    .mockResolvedValue("https://oneuptime.example/alert" as never);
  jest
    .spyOn(AlertService, "countBy")
    .mockResolvedValue(new PositiveNumber(1) as never);
  jest
    .spyOn(LinkedAffectedResources, "readForIncident")
    .mockResolvedValue([] as never);
  jest
    .spyOn(LinkedAffectedResources, "readForAlert")
    .mockResolvedValue([] as never);
  jest
    .spyOn(ProjectService, "getOwners")
    .mockResolvedValue([personOf(PROJECT_OWNER)] as never);

  jest
    .spyOn(UserNotificationSettingService, "sendUserNotification")
    .mockImplementation((async (data: {
      userId: ObjectID;
      incidentId?: ObjectID;
      alertId?: ObjectID;
    }): Promise<void> => {
      sent.push({
        kind: data.incidentId ? "incident" : "alert",
        recordId: idOf(data.incidentId || data.alertId),
        userId: idOf(data.userId),
      });
    }) as never);
}

let errors: ReturnType<typeof jest.spyOn>;

// What went wrong on the way - the chain and the jobs log, and carry on.
function errorsLogged(): Array<string> {
  return errors.mock.calls.map((call: Array<unknown>): string => {
    return String(call[0]);
  });
}

beforeEach(() => {
  owners = EVERY_KIND_OF_OWNER;
  records = new Map<string, StoredRecord>();
  ownerRows = [];
  sent = [];
  ownerRulesRan = [];
  runJobAfterInsert = true;
  gates = {
    chain: new Gate(true),
    monitor: new Gate(true),
    creator: new Gate(true),
  };

  errors = jest.spyOn(logger, "error").mockImplementation((() => {
    // read by the tests
  }) as never);

  /*
   * The owner tables first: a spy on a service whose create it inherits is
   * already a mock (DatabaseService.prototype.create, stubbed below) would
   * be handed that very mock, and its implementation would replace the
   * insert's.
   */
  stubOwnerTable({
    service: IncidentOwnerUserService,
    makeRow: (): BaseModel => {
      return new IncidentOwnerUser();
    },
    recordColumn: "incidentId",
    ownerColumn: "userId",
  });
  stubOwnerTable({
    service: IncidentOwnerTeamService,
    makeRow: (): BaseModel => {
      return new IncidentOwnerTeam();
    },
    recordColumn: "incidentId",
    ownerColumn: "teamId",
  });
  stubOwnerTable({
    service: AlertOwnerUserService,
    makeRow: (): BaseModel => {
      return new AlertOwnerUser();
    },
    recordColumn: "alertId",
    ownerColumn: "userId",
  });
  stubOwnerTable({
    service: AlertOwnerTeamService,
    makeRow: (): BaseModel => {
      return new AlertOwnerTeam();
    },
    recordColumn: "alertId",
    ownerColumn: "teamId",
  });

  stubDatabaseCreate();
  stubCreateHooks();
  stubMonitorReads();
  stubOwnerRules();
  stubJobs();
  stubTeamMembers();
});

afterEach(() => {
  gates.chain.open();
  gates.monitor.open();
  gates.creator.open();
  jest.restoreAllMocks();
});

describe.each(["incident", "alert"] as Array<Kind>)(
  "the Created email of an %s a monitor opens",
  (kind: Kind) => {
    test("reaches the criteria's, the device's and the owner rule's owners, and nobody else, when the monitor adds its owners last", async () => {
      gates.monitor = new Gate(false);

      const opening: Promise<unknown> = openFromMonitor(kind);

      // The chain has run its owner rules; the monitor has not added its owners yet.
      await waitUntil((): boolean => {
        return gates.monitor.reached && ownerRulesRan.includes(kind);
      });
      await settle();
      await runJob(kind);

      expect(notified(kind)).toEqual([]);

      gates.monitor.open();
      await opening;
      await runJob(kind);

      expect(notified(kind)).toEqual(EVERY_KIND_OF_OWNER_REACHED);

      // Once: a later run finds nothing to send.
      await runJob(kind);

      expect(notified(kind)).toEqual(EVERY_KIND_OF_OWNER_REACHED);
      expect(records.get(onlyRecord(kind))!.isNotified).toBe(true);
      expect(errorsLogged()).toEqual([]);
    });

    test("reaches them all, and nobody else, when the owner rules add theirs last", async () => {
      gates.chain = new Gate(false);

      await openFromMonitor(kind);

      // The monitor has added its owners; the chain is still on its way to the owner rules.
      expect(gates.chain.reached).toBe(true);
      expect(ownerRulesRan).toEqual([]);
      await runJob(kind);

      expect(notified(kind)).toEqual([]);

      gates.chain.open();
      await waitUntil((): boolean => {
        return !records.get(onlyRecord(kind))!.isNotified;
      });
      await runJob(kind);

      expect(notified(kind)).toEqual(EVERY_KIND_OF_OWNER_REACHED);
      expect(errorsLogged()).toEqual([]);
    });

    test("is held from the moment it is written: a run right after the insert takes nothing", async () => {
      gates.chain = new Gate(false);
      gates.monitor = new Gate(false);

      const opening: Promise<unknown> = openFromMonitor(kind);

      await waitUntil((): boolean => {
        return gates.chain.reached && gates.monitor.reached;
      });

      // The run right after the insert, and one now, took nothing.
      expect(records.get(onlyRecord(kind))!.isNotified).toBe(true);
      await runJob(kind);
      expect(notified(kind)).toEqual([]);

      gates.chain.open();
      gates.monitor.open();
      await opening;
      await waitUntil((): boolean => {
        return !records.get(onlyRecord(kind))!.isNotified;
      });
      await runJob(kind);

      expect(notified(kind)).toEqual(EVERY_KIND_OF_OWNER_REACHED);
    });

    test.each([
      ["nobody owns it", NOBODY],
      [
        "it is owned only by somebody who left the project",
        { criteriaUsers: [DEPARTED], deviceUsers: [], rule: null },
      ],
    ])(
      "reaches the project's owners, once, when %s",
      async (_label: string, nobody: Owners) => {
        owners = nobody;

        await openFromMonitor(kind);
        await waitUntil((): boolean => {
          return !records.get(onlyRecord(kind))!.isNotified;
        });

        // Not before every owner is in: the run right after the insert sent nothing.
        expect(notified(kind)).toEqual([]);

        await runJob(kind);
        await runJob(kind);

        expect(notified(kind)).toEqual([PROJECT_OWNER]);
        expect(errorsLogged()).toEqual([]);
      },
    );
  },
);

/*
 * Somebody who creates an incident (an alert) on the dashboard is made its
 * owner as the create returns (DatabaseService.autoOwnerOnCreate): after
 * the chain may well have run its owner rules. The email waits for them
 * too.
 */
describe.each(["incident", "alert"] as Array<Kind>)(
  "the Created email of an %s created on the dashboard",
  (kind: Kind) => {
    const ADA_PROPS: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userId: new ObjectID(ADA),
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: [
            {
              _type: "UserPermission",
              permission: Permission.ProjectMember,
              labelIds: [],
              isBlockPermission: false,
            },
          ],
        } as UserTenantAccessPermission,
      },
    };

    function newRecord(): BaseModel {
      if (kind === "incident") {
        const incident: Incident = new Incident();
        incident.projectId = PROJECT_ID;
        incident.title = "Checkout is down";
        incident.incidentSeverityId = new ObjectID(INCIDENT_SEVERITY);
        return incident;
      }

      const alert: Alert = new Alert();
      alert.projectId = PROJECT_ID;
      alert.title = "Checkout is down";
      alert.alertSeverityId = new ObjectID(ALERT_SEVERITY);
      return alert;
    }

    test("reaches its creator, who is made its owner after the owner rules have run", async () => {
      owners = NOBODY;
      gates.creator = new Gate(false);

      const service: {
        create: (createBy: CreateBy<BaseModel>) => Promise<BaseModel>;
      } = (kind === "incident" ? IncidentService : AlertService) as unknown as {
        create: (createBy: CreateBy<BaseModel>) => Promise<BaseModel>;
      };

      const creating: Promise<BaseModel> = service.create({
        data: newRecord(),
        props: ADA_PROPS,
      });

      await waitUntil((): boolean => {
        return gates.creator.reached && ownerRulesRan.includes(kind);
      });
      await settle();
      await runJob(kind);

      // Nobody is told before its creator is its owner - least of all the project's owners.
      expect(notified(kind)).toEqual([]);

      gates.creator.open();
      await creating;
      await runJob(kind);

      expect(notified(kind)).toEqual([ADA]);
      expect(errorsLogged()).toEqual([]);
    });
  },
);

/*
 * An incident written, but not read back by its chain - the database away
 * a moment: its chain never starts, so it adds nobody, and its create fails.
 * It is still let go once its create and the monitor are done, never held
 * for good: the email goes out, to the project's owners.
 */
describe("the Created email of an incident its chain can't read back", () => {
  test("goes out once its create has failed and the monitor is done", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockRejectedValue(new Error("The database is away") as never);

    await openFromMonitor("incident");
    await waitUntil((): boolean => {
      return !records.get(onlyRecord("incident"))!.isNotified;
    });

    // The chain never got to its owner rules, and the monitor added nobody.
    expect(ownerRulesRan).toEqual([]);
    expect(ownerRows).toEqual([]);

    await runJob("incident");
    await runJob("incident");

    expect(notified("incident")).toEqual([PROJECT_OWNER]);
    expect(
      errorsLogged().some((line: string): boolean => {
        return line.includes("Failed to create incident");
      }),
    ).toBe(true);
  });

  test("goes out when the incident is gone by the time its chain reads it", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);

    await openFromMonitor("incident");
    await waitUntil((): boolean => {
      return !records.get(onlyRecord("incident"))!.isNotified;
    });

    expect(ownerRulesRan).toEqual([]);

    await runJob("incident");

    expect(notified("incident")).toEqual([PROJECT_OWNER]);
  });
});
