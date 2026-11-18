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
import AlertOnCallRulesOnOwnerChange from "../../../Server/Utils/Alert/AlertOnCallRulesOnOwnerChange";
import CreatedNotificationHold, {
  OwnersAddedBy,
} from "../../../Server/Utils/Notification/CreatedNotificationHold";
import OpenStackScopedRules from "../../../Server/Utils/OpenStack/OpenStackScopedRules";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import VideoCallRuleExecutor from "../../../Server/Utils/VideoCall/VideoCallRuleExecutor";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
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
import { useInMemoryOwnerNotificationDeliveries } from "../../Helpers/InMemoryOwnerNotificationDeliveries";
import {
  InMemoryOnCallPages,
  useInMemoryOnCallPages,
} from "../../Helpers/InMemoryOnCallPages";
import CreateOneBaseModel from "../../../Server/Types/Workflow/Components/BaseModel/CreateOneBaseModel";
import { RunReturnType } from "../../../Server/Types/Workflow/ComponentCode";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import Email from "../../../Types/Email";
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
import { FindOperator } from "typeorm";

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
 *
 * AND WHEREVER THE PROCESS THAT HOLDS IT STOPS (#7571), AND WHOEVER ADDS AN
 * OWNER A MOMENT LATER (#7573). The hold is written on the record with the
 * flag (createdNotificationHeldAt), the release and the job's take are each
 * one compare-and-set - held here in memory as the database would run them
 * - and the job runs on a clock the tests move: a hold nobody lets go is
 * taken once it is five minutes old, and a record let go is taken a minute
 * after its create. The process stops before its chain starts, before the
 * monitor says its owners are in, and after the hold is let go; the release
 * fails; the release and the job race; an owner is added by a request of
 * its own. Each time the email goes out once, to whoever owns the record
 * then.
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

// A stored record: the row the insert wrote, and the columns the job reads.
interface StoredRecord {
  kind: Kind;
  model: BaseModel;
  isNotified: boolean;
  // When its hold began, while it is held (createdNotificationHeldAt).
  heldAt: Date | null;
  createdAt: Date;
}

let records: Map<string, StoredRecord>;

// The clock every hook and job reads (OneUptimeDate.getCurrentDate), moved by the tests.
const STARTED_AT: Date = new Date("2026-11-12T08:00:00.000Z");
let clock: Date;

function advance(data: { minutes?: number; seconds?: number }): void {
  clock = new Date(
    clock.getTime() +
      (data.minutes || 0) * 60 * 1000 +
      (data.seconds || 0) * 1000,
  );
}

/*
 * Where the process that runs the create stops, when it does: right after
 * the insert - nothing after it runs, not its chain, not its caller - or
 * never.
 */
let processStopsAfterInsert: boolean;

// Letting a hold go fails, of a record of this kind: the database is away a moment.
let releaseFails: Record<Kind, boolean>;

// What a job's read was: the records let go, or the records held too long.
type JobRead = "letGo" | "heldTooLong";

/*
 * What happens between a job's read and its takes, when a test says: the
 * read has read its records, and hands them back once this is done.
 */
let whenJobHasRead:
  | ((data: { kind: Kind; read: JobRead }) => Promise<void>)
  | null;

// Every compare-and-set the release and the job wrote, in order, and whether it matched.
let compareAndSets: Array<{
  kind: Kind;
  recordId: string;
  data: JSONObject;
  expectedData: JSONObject;
  isWritten: boolean;
}>;

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

      // The row as the insert wrote it: the hold with the flag, in one write.
      const heldAt: unknown = record.getColumnValue(
        "createdNotificationHeldAt",
      );

      records.set(idOf(record._id), {
        kind: kind,
        model: record,
        isNotified: record.getColumnValue(NOTIFIED_COLUMN[kind]) === true,
        heldAt: heldAt instanceof Date ? new Date(heldAt.getTime()) : null,
        createdAt: OneUptimeDate.getCurrentDate(),
      });

      // The process stops here: nothing after the insert ever runs in it.
      if (processStopsAfterInsert) {
        await new Promise<never>(() => {
          // never settles
        });
      }

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
  // No rule asks who owns an alert: its on-call rules wait for nobody (see the end of this file).
  jest
    .spyOn(AlertOnCallRuleEngineService, "hasRulesWithOwnerCondition")
    .mockResolvedValue(false as never);
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

// The record as the job selects it: what its email says, and what it takes the record by.
function asTheJobReadsIt(kind: Kind, id: string): BaseModel {
  const read: BaseModel = asTheEmailReadsIt(kind, id);
  const stored: StoredRecord = records.get(id)!;

  read.setColumnValue(NOTIFIED_COLUMN[kind], stored.isNotified);
  read.setColumnValue(
    "createdNotificationHeldAt",
    stored.heldAt ? new Date(stored.heldAt.getTime()) : null,
  );

  return read;
}

function asTheEmailReadsIt(kind: Kind, id: string): BaseModel {
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

// The upper bound of a `<=` condition the service read by (QueryHelper.lessThanEqualTo).
function upTo(query: Record<string, unknown>, column: string): Date {
  const condition: FindOperator<unknown> = query[
    column
  ] as FindOperator<unknown>;

  expect(condition.getSql?.("x")).toMatch(/^\(x <= :\w+\)$/);

  const bound: unknown = Object.values(
    condition.objectLiteralParameters || {},
  )[0];

  expect(bound).toBeInstanceOf(Date);

  return bound as Date;
}

// What the record holds in a column the release and the job write.
function storedValue(
  kind: Kind,
  record: StoredRecord,
  column: string,
): boolean | Date | null {
  if (column === NOTIFIED_COLUMN[kind]) {
    return record.isNotified;
  }

  if (column === "createdNotificationHeldAt") {
    return record.heldAt;
  }

  throw new Error(
    `Nothing but the notification's own columns is written: ${column}.`,
  );
}

// A guard's value as Postgres compares it: null-safe, a time as its instant.
function isSameValue(
  stored: boolean | Date | null,
  expected: unknown,
): boolean {
  if (expected === undefined) {
    throw new Error("A compare-and-set names every value it expects.");
  }

  if (stored === null || expected === null) {
    return stored === null && expected === null;
  }

  if (stored instanceof Date || expected instanceof Date) {
    return (
      stored instanceof Date &&
      expected instanceof Date &&
      stored.getTime() === expected.getTime()
    );
  }

  return stored === expected;
}

/*
 * The records' columns the jobs read and take, and the hold lets go of, as
 * the database holds them: the job's two reads, and every write to them one
 * compare-and-set (DatabaseService.compareAndSetColumnsByIdWithoutHooks).
 */
function stubNotifiedColumn(kind: Kind): void {
  const service: Record<string, (...args: Array<unknown>) => unknown> =
    (kind === "incident" ? IncidentService : AlertService) as unknown as Record<
      string,
      (...args: Array<unknown>) => unknown
    >;
  const notifiedColumn: string = NOTIFIED_COLUMN[kind];

  /*
   * The job's two reads (findCreatedNotificationsDue): the records let go -
   * marked not notified - created at or before one time, and the records
   * still held whose hold began at or before another.
   */
  jest.spyOn(service, "findAllBy").mockImplementation((async (args: {
    query: Record<string, unknown>;
    select: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<BaseModel>> => {
    expect(args.props).toEqual({ isRoot: true });
    expect(args.select[notifiedColumn]).toBe(true);
    expect(args.select["createdNotificationHeldAt"]).toBe(true);

    let isRead: (record: StoredRecord) => boolean;
    let read: JobRead = "letGo";

    if (args.query[notifiedColumn] === false) {
      expect(Object.keys(args.query).sort()).toEqual(
        ["createdAt", notifiedColumn].sort(),
      );

      const createdBefore: Date = upTo(args.query, "createdAt");

      isRead = (record: StoredRecord): boolean => {
        return (
          !record.isNotified &&
          record.createdAt.getTime() <= createdBefore.getTime()
        );
      };
    } else {
      expect(Object.keys(args.query)).toEqual(["createdNotificationHeldAt"]);

      const heldBefore: Date = upTo(args.query, "createdNotificationHeldAt");
      read = "heldTooLong";

      isRead = (record: StoredRecord): boolean => {
        return (
          record.heldAt !== null &&
          record.heldAt.getTime() <= heldBefore.getTime()
        );
      };
    }

    const found: Array<BaseModel> = Array.from(records.entries())
      .filter(([, record]: [string, StoredRecord]): boolean => {
        return record.kind === kind && isRead(record);
      })
      .map(([id]: [string, StoredRecord]): BaseModel => {
        return asTheJobReadsIt(kind, id);
      });

    if (whenJobHasRead) {
      await whenJobHasRead({ kind: kind, read: read });
    }

    return found;
  }) as never);

  // The hold's release and the job's take: one write each, made only while the row holds what it expects.
  jest
    .spyOn(service, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (input: {
      id: ObjectID;
      data: JSONObject;
      expectedData: JSONObject;
    }): Promise<boolean> => {
      if (releaseFails[kind] && input.data[notifiedColumn] === false) {
        throw new Error("The database is away");
      }

      const record: StoredRecord | undefined = records.get(idOf(input.id));

      const isWritten: boolean =
        Boolean(record) &&
        Object.entries(input.expectedData).every(
          ([column, expected]: [string, unknown]): boolean => {
            return isSameValue(storedValue(kind, record!, column), expected);
          },
        );

      if (record && isWritten) {
        for (const [column, value] of Object.entries(input.data)) {
          if (column === notifiedColumn) {
            record.isNotified = value === true;
          } else if (column === "createdNotificationHeldAt") {
            record.heldAt =
              value instanceof Date ? new Date(value.getTime()) : null;
          } else {
            throw new Error(`Nothing else is written with them: ${column}.`);
          }
        }
      }

      compareAndSets.push({
        kind: kind,
        recordId: idOf(input.id),
        data: input.data,
        expectedData: input.expectedData,
        isWritten: isWritten,
      });

      return isWritten;
    }) as never);

  // No plain update writes them: neither the release nor the job.
  jest.spyOn(service, "updateOneById").mockImplementation((async (updateBy: {
    data: JSONObject;
  }): Promise<void> => {
    for (const column of [notifiedColumn, "createdNotificationHeldAt"]) {
      if (Object.prototype.hasOwnProperty.call(updateBy.data, column)) {
        throw new Error(
          `${column} is written by a compare-and-set, never by a plain update.`,
        );
      }
    }
  }) as never);
}

// What the jobs read and write besides the owners: the records' columns, and the send.
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

/*
 * The notifications on-call pages sent, which the job reads to leave out an
 * owner the record's page reached already (#7987): nobody was paged, unless
 * a test says so.
 */
let pages: InMemoryOnCallPages;

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
  processStopsAfterInsert = false;
  releaseFails = { incident: false, alert: false };
  whenJobHasRead = null;
  compareAndSets = [];
  gates = {
    chain: new Gate(true),
    monitor: new Gate(true),
    creator: new Gate(true),
  };

  clock = new Date(STARTED_AT.getTime());
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation((): Date => {
    return new Date(clock.getTime());
  });

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
  /*
   * Whom the Created job tells is written down before it takes the record,
   * and each owner told through it (OwnerNotificationDeliveries, #8199).
   */
  useInMemoryOwnerNotificationDeliveries();
  pages = useInMemoryOnCallPages();
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

      // Let go, but not a minute old: an owner a request of its own adds is still to come.
      await runJob(kind);
      expect(notified(kind)).toEqual([]);

      advance({ minutes: 1 });
      await runJob(kind);

      expect(notified(kind)).toEqual(EVERY_KIND_OF_OWNER_REACHED);

      // Once: a later run finds nothing to send, nor one once a hold would have run out.
      await runJob(kind);
      advance({ minutes: 10 });
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
      advance({ minutes: 1 });
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

      // Written held - the flag and when the hold began, in the insert itself.
      expect(records.get(onlyRecord(kind))!.isNotified).toBe(true);
      expect(records.get(onlyRecord(kind))!.heldAt).toEqual(STARTED_AT);

      // The run right after the insert, and runs while it is held, took nothing.
      await runJob(kind);
      advance({ minutes: 4, seconds: 59 });
      await runJob(kind);
      expect(notified(kind)).toEqual([]);

      gates.chain.open();
      gates.monitor.open();
      await opening;
      await waitUntil((): boolean => {
        return !records.get(onlyRecord(kind))!.isNotified;
      });

      // Let go: the hold is over.
      expect(records.get(onlyRecord(kind))!.heldAt).toBeNull();

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

        advance({ minutes: 1 });
        await runJob(kind);
        await runJob(kind);

        expect(notified(kind)).toEqual([PROJECT_OWNER]);
        expect(errorsLogged()).toEqual([]);
      },
    );

    /*
     * ONE NOTIFICATION FOR A NEW RECORD, NOT TWO (#7987): an owner the
     * record's on-call page reached as it was created is not sent the
     * Created email too.
     */
    function pagedAsItWasCreated(userId: string): void {
      const recordId: ObjectID = new ObjectID(onlyRecord(kind));

      pages.add({
        projectId: PROJECT_ID,
        userId: new ObjectID(userId),
        ...(kind === "incident"
          ? { triggeredByIncidentId: recordId }
          : { triggeredByAlertId: recordId }),
      });
    }

    test("leaves out an owner its on-call page reached already, and reaches every other owner, once", async () => {
      await openFromMonitor(kind);
      await waitUntil((): boolean => {
        return !records.get(onlyRecord(kind))!.isNotified;
      });

      // The record's on-call policy paged Ben as it was created.
      pagedAsItWasCreated(BEN);

      advance({ minutes: 1 });
      await runJob(kind);
      await runJob(kind);

      expect(notified(kind)).toEqual(
        EVERY_KIND_OF_OWNER_REACHED.filter((userId: string): boolean => {
          return userId !== BEN;
        }),
      );
      expect(errorsLogged()).toEqual([]);
    });

    test("the project's owner, standing in for a record nobody owns and paged as it was created, hears of it once: by the page", async () => {
      owners = NOBODY;

      await openFromMonitor(kind);
      await waitUntil((): boolean => {
        return !records.get(onlyRecord(kind))!.isNotified;
      });

      pagedAsItWasCreated(PROJECT_OWNER);

      advance({ minutes: 1 });
      await runJob(kind);
      await runJob(kind);

      expect(notified(kind)).toEqual([]);
      // Taken all the same: no later run reads it again.
      expect(records.get(onlyRecord(kind))!.isNotified).toBe(true);
      expect(errorsLogged()).toEqual([]);
    });
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
      advance({ minutes: 1 });
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

    advance({ minutes: 1 });
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

    advance({ minutes: 1 });
    await runJob("incident");

    expect(notified("incident")).toEqual([PROJECT_OWNER]);
  });
});

// The clock at `minutes` and `seconds` after the first record was written.
function at(minutes: number, seconds: number = 0): void {
  clock = new Date(STARTED_AT.getTime() + minutes * 60 * 1000 + seconds * 1000);
}

function stored(kind: Kind): StoredRecord {
  return records.get(onlyRecord(kind))!;
}

// What the release wrote of a record: each compare-and-set that lets it go.
function releasesOf(kind: Kind): Array<{ isWritten: boolean }> {
  return compareAndSets.filter(
    (write: { kind: Kind; data: JSONObject }): boolean => {
      return write.kind === kind && write.data[NOTIFIED_COLUMN[kind]] === false;
    },
  );
}

// What the job wrote of a record: each compare-and-set that takes it.
function takesOf(kind: Kind): Array<{ isWritten: boolean }> {
  return compareAndSets.filter(
    (write: { kind: Kind; data: JSONObject }): boolean => {
      return write.kind === kind && write.data[NOTIFIED_COLUMN[kind]] === true;
    },
  );
}

// The monitor's own code never gets past its first step: the process stopped there.
function monitorNeverFinishes(kind: Kind): void {
  jest
    .spyOn(
      OpenStackScopedRules,
      kind === "incident" ? "finishIncident" : "finishAlert",
    )
    .mockImplementation((() => {
      return new Promise<never>(() => {
        // never settles
      });
    }) as never);
}

function serviceOf(kind: Kind): {
  create: (createBy: CreateBy<BaseModel>) => Promise<BaseModel>;
} {
  return (kind === "incident" ? IncidentService : AlertService) as unknown as {
    create: (createBy: CreateBy<BaseModel>) => Promise<BaseModel>;
  };
}

function newRecordOf(kind: Kind): BaseModel {
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

// The release's own words for a failure, by kind.
const RELEASE_FAILED: Record<Kind, string> = {
  incident:
    "Releasing the Incident Created notification held for the owners failed in IncidentService.onCreateSuccess: Error: The database is away. The owners are told once the hold has lasted 5 minutes.",
  alert:
    "Releasing the Alert Created notification held for the owners failed in AlertService.onCreateSuccess: Error: The database is away. The owners are told once the hold has lasted 5 minutes.",
};

/*
 * WHEREVER THE PROCESS THAT HOLDS IT STOPS (#7571). The hold is written on
 * the record in its insert, so a hold nobody lets go - the process that
 * made the record stopped, or letting it go failed - is taken by the job
 * once it is five minutes old, and its owners are told: whoever owns it by
 * then, or the project's owners. The release and the job's take are each
 * one compare-and-set, so whichever comes first is the one that acts, and
 * the email goes out once.
 */
describe.each(["incident", "alert"] as Array<Kind>)(
  "the Created email of an %s whose process stops",
  (kind: Kind) => {
    test("before the monitor says its owners are in: held until the hold runs out, then sent once, to the owners it has by then", async () => {
      monitorNeverFinishes(kind);

      void openFromMonitor(kind);

      // The chain has run its owner rules; the monitor never adds its owners.
      await waitUntil((): boolean => {
        return ownerRulesRan.includes(kind);
      });
      await settle();

      expect(stored(kind).isNotified).toBe(true);
      expect(stored(kind).heldAt).toEqual(STARTED_AT);
      expect(releasesOf(kind)).toEqual([]);

      for (const [minutes, seconds] of [
        [0, 0],
        [1, 0],
        [2, 30],
        [4, 59],
      ] as Array<[number, number]>) {
        at(minutes, seconds);
        await runJob(kind);
      }

      // Within the hold, nobody is told - least of all the project's owners.
      expect(notified(kind)).toEqual([]);

      at(5);
      await runJob(kind);

      // The owner rule's owners, whom the chain added: the monitor's never were.
      expect(notified(kind)).toEqual([CARA, DAN]);
      expect(stored(kind).isNotified).toBe(true);
      expect(stored(kind).heldAt).toBeNull();

      for (const minutes of [5, 6, 60]) {
        at(minutes);
        await runJob(kind);
      }

      expect(notified(kind)).toEqual([CARA, DAN]);
      expect(takesOf(kind)).toEqual([
        expect.objectContaining({ isWritten: true }),
      ]);
      expect(errorsLogged()).toEqual([]);
    });

    test("right after the insert: nobody adds an owner, and the project's owners are told once the hold runs out", async () => {
      processStopsAfterInsert = true;

      void openFromMonitor(kind);

      await waitUntil((): boolean => {
        return records.size === 1;
      });
      await settle();

      // Written held, and nothing after the insert ran: not the chain, not the monitor.
      expect(stored(kind).isNotified).toBe(true);
      expect(stored(kind).heldAt).toEqual(STARTED_AT);
      expect(ownerRulesRan).toEqual([]);
      expect(ownerRows).toEqual([]);

      at(4, 59);
      await runJob(kind);
      expect(notified(kind)).toEqual([]);

      at(5);
      await runJob(kind);
      at(30);
      await runJob(kind);

      expect(notified(kind)).toEqual([PROJECT_OWNER]);
    });

    test("after the hold is let go: the next run tells its owners once, and none after - not once a hold would have run out", async () => {
      await openFromMonitor(kind);
      await waitUntil((): boolean => {
        return !stored(kind).isNotified;
      });

      // Let go: nothing of the create is needed in memory any more.
      expect(stored(kind).heldAt).toBeNull();
      expect(releasesOf(kind)).toEqual([
        expect.objectContaining({ isWritten: true }),
      ]);

      for (const minutes of [1, 5, 6, 60]) {
        at(minutes);
        await runJob(kind);
      }

      expect(notified(kind)).toEqual(EVERY_KIND_OF_OWNER_REACHED);
      expect(takesOf(kind)).toEqual([
        expect.objectContaining({ isWritten: true }),
      ]);
    });

    test("when letting go fails: the owners are told once the hold runs out, once", async () => {
      releaseFails[kind] = true;

      await openFromMonitor(kind);
      await waitUntil((): boolean => {
        return errorsLogged().includes(RELEASE_FAILED[kind]);
      });

      // Still held: the release never wrote.
      expect(stored(kind).isNotified).toBe(true);
      expect(stored(kind).heldAt).toEqual(STARTED_AT);

      at(1);
      await runJob(kind);
      at(4, 59);
      await runJob(kind);
      expect(notified(kind)).toEqual([]);

      at(5);
      await runJob(kind);
      at(6);
      await runJob(kind);

      // Every owner was in by then: the monitor's and the chain's.
      expect(notified(kind)).toEqual(EVERY_KIND_OF_OWNER_REACHED);
      expect(errorsLogged()).toEqual([RELEASE_FAILED[kind]]);
    });

    test("when the hold runs out while the chain is still adding owners: told once, to whoever owns it then, and the chain's late release lets nothing go", async () => {
      gates.chain = new Gate(false);

      await openFromMonitor(kind);

      // The monitor has added its owners; the chain is still on its way to the owner rules.
      at(5);
      await runJob(kind);

      expect(notified(kind)).toEqual([ANA, BEN]);

      gates.chain.open();
      await waitUntil((): boolean => {
        return ownerRulesRan.includes(kind) && releasesOf(kind).length === 1;
      });
      await settle();

      // The release found the hold taken, and wrote nothing.
      expect(releasesOf(kind)).toEqual([
        expect.objectContaining({ isWritten: false }),
      ]);
      expect(stored(kind).isNotified).toBe(true);
      expect(stored(kind).heldAt).toBeNull();

      at(6);
      await runJob(kind);
      at(60);
      await runJob(kind);

      expect(notified(kind)).toEqual([ANA, BEN]);
      expect(errorsLogged()).toEqual([]);
    });

    test("when it is let go between the job's read of it as held and its take: that run sends nothing, and the next tells every owner once", async () => {
      gates.chain = new Gate(false);

      await openFromMonitor(kind);

      // The job reads it as held too long; the chain lets it go before the job takes it.
      whenJobHasRead = async (data: {
        kind: Kind;
        read: JobRead;
      }): Promise<void> => {
        if (data.kind !== kind || data.read !== "heldTooLong") {
          return;
        }

        whenJobHasRead = null;
        gates.chain.open();
        await waitUntil((): boolean => {
          return !stored(kind).isNotified;
        });
      };

      at(5);
      await runJob(kind);

      expect(notified(kind)).toEqual([]);
      expect(takesOf(kind)).toEqual([
        expect.objectContaining({ isWritten: false }),
      ]);
      expect(stored(kind).isNotified).toBe(false);

      at(6);
      await runJob(kind);
      at(60);
      await runJob(kind);

      expect(notified(kind)).toEqual(EVERY_KIND_OF_OWNER_REACHED);
      expect(errorsLogged()).toEqual([]);
    });

    test("when two runs read it at once: one tells its owners, once", async () => {
      await openFromMonitor(kind);
      await waitUntil((): boolean => {
        return !stored(kind).isNotified;
      });

      // Both runs have read it as let go before either takes it.
      let reads: number = 0;
      let bothRead: () => void = (): void => {};
      const bothHaveRead: Promise<void> = new Promise<void>(
        (resolve: () => void) => {
          bothRead = resolve;
        },
      );

      whenJobHasRead = async (data: {
        kind: Kind;
        read: JobRead;
      }): Promise<void> => {
        if (data.kind !== kind || data.read !== "letGo") {
          return;
        }

        reads++;

        if (reads === 2) {
          bothRead();
        }

        await bothHaveRead;
      };

      at(1);
      await Promise.all([runJob(kind), runJob(kind)]);

      expect(reads).toBe(2);
      expect(notified(kind)).toEqual(EVERY_KIND_OF_OWNER_REACHED);
      expect(
        takesOf(kind).map((take: { isWritten: boolean }): boolean => {
          return take.isWritten;
        }),
      ).toEqual([true, false]);
    });
  },
);

/*
 * A create that says it was notified already is written as it says: never
 * held, so the job never takes it - not even once a hold would have run
 * out, whatever hold its caller sent with it (only the create's hook writes
 * one).
 */
describe.each(["incident", "alert"] as Array<Kind>)(
  "the Created email of an %s written as notified already",
  (kind: Kind) => {
    test("is never sent, and its create neither holds it nor lets it go", async () => {
      const record: BaseModel = newRecordOf(kind);
      record.setColumnValue(NOTIFIED_COLUMN[kind], true);
      // A hold of its caller's own: never written.
      record.setColumnValue(
        "createdNotificationHeldAt",
        new Date(STARTED_AT.getTime() - 60 * 60 * 1000),
      );

      await serviceOf(kind).create({
        data: record,
        props: { isRoot: true },
      });
      await waitUntil((): boolean => {
        return ownerRulesRan.includes(kind);
      });
      await settle();

      expect(stored(kind).isNotified).toBe(true);
      expect(stored(kind).heldAt).toBeNull();

      for (const minutes of [0, 1, 5, 6, 60]) {
        at(minutes);
        await runJob(kind);
      }

      expect(notified(kind)).toEqual([]);
      expect(compareAndSets).toEqual([]);
    });
  },
);

/*
 * AN OWNER ADDED BY A REQUEST OF ITS OWN (#7573): an API script that creates
 * the record, then adds its owner in a second call; a workflow's next step;
 * the MCP server. The job takes a record let go only a minute after its
 * create, so an owner added in that minute is told, and the project's
 * owners - who would have been told in its place - are not.
 */
describe.each(["incident", "alert"] as Array<Kind>)(
  "the Created email of an %s whose owner is added by a request of its own",
  (kind: Kind) => {
    // The second call: an owner row of the record, as the API writes it.
    async function addOwnerInASecondRequest(
      record: BaseModel,
      userId: string,
    ): Promise<void> {
      if (kind === "incident") {
        const owner: IncidentOwnerUser = new IncidentOwnerUser();
        owner.projectId = PROJECT_ID;
        owner.incidentId = record.id!;
        owner.userId = new ObjectID(userId);

        await IncidentOwnerUserService.create({
          data: owner,
          props: { isRoot: true },
        });
        return;
      }

      const owner: AlertOwnerUser = new AlertOwnerUser();
      owner.projectId = PROJECT_ID;
      owner.alertId = record.id!;
      owner.userId = new ObjectID(userId);

      await AlertOwnerUserService.create({
        data: owner,
        props: { isRoot: true },
      });
    }

    beforeEach(() => {
      // Nobody owns it as it is created: no rule, no criteria, and an API key is made nobody's owner.
      owners = NOBODY;
    });

    test("reaches the owner added within a minute of the create, and not the project's owners", async () => {
      const created: BaseModel = await serviceOf(kind).create({
        data: newRecordOf(kind),
        props: { isRoot: true },
      });
      await waitUntil((): boolean => {
        return !stored(kind).isNotified;
      });

      // Let go - its create added nobody - but not a minute old.
      at(0, 20);
      await runJob(kind);
      expect(notified(kind)).toEqual([]);

      at(0, 30);
      await addOwnerInASecondRequest(created, ANA);

      at(0, 59);
      await runJob(kind);
      expect(notified(kind)).toEqual([]);

      at(1);
      await runJob(kind);
      at(2);
      await runJob(kind);

      expect(notified(kind)).toEqual([ANA]);
      expect(errorsLogged()).toEqual([]);
    });

    test("reaches the project's owners a minute after the create when nobody adds one", async () => {
      await serviceOf(kind).create({
        data: newRecordOf(kind),
        props: { isRoot: true },
      });
      await waitUntil((): boolean => {
        return !stored(kind).isNotified;
      });

      at(0, 59);
      await runJob(kind);
      expect(notified(kind)).toEqual([]);

      at(1);
      await runJob(kind);
      at(6);
      await runJob(kind);

      expect(notified(kind)).toEqual([PROJECT_OWNER]);
    });

    test("does not reach an owner added once it went out: they hear they were added, not that it was created", async () => {
      const created: BaseModel = await serviceOf(kind).create({
        data: newRecordOf(kind),
        props: { isRoot: true },
      });
      await waitUntil((): boolean => {
        return !stored(kind).isNotified;
      });

      at(1);
      await runJob(kind);
      expect(notified(kind)).toEqual([PROJECT_OWNER]);

      at(1, 30);
      await addOwnerInASecondRequest(created, ANA);
      at(2);
      await runJob(kind);

      expect(notified(kind)).toEqual([PROJECT_OWNER]);
    });
  },
);

/*
 * #8198: THE OWNERS HANDED OVER WITH THE CREATE. A caller that adds the
 * owners by a request of its own after the minute - a slow MCP agent, a
 * workflow with a delay in between - leaves the Created email with the
 * project's owners. One that hands them over with the create - the REST
 * create's miscDataProps, a workflow's Create One step's Owner Users and
 * Owner Teams, an MCP create tool's ownerUsers and ownerTeams, which it
 * sends as miscDataProps - has them in before the hold is let go, so the
 * email reaches them however late the job runs, and nobody else.
 */
describe.each(["incident", "alert"] as Array<Kind>)(
  "the Created email of an %s whose create hands its owners over",
  (kind: Kind) => {
    beforeEach(() => {
      // Nobody else owns it: no rule, no criteria, only whom the create names.
      owners = NOBODY;
    });

    test("over the API, in miscDataProps: reaches them, and not the project's owners, however long after the create the job runs", async () => {
      await serviceOf(kind).create({
        data: newRecordOf(kind),
        miscDataProps: {
          ownerUsers: [ANA],
          ownerTeams: [PLATFORM_TEAM],
        },
        props: { isRoot: true },
      });
      await waitUntil((): boolean => {
        return !stored(kind).isNotified;
      });

      // Far past the minute an owner a request of its own adds has.
      at(10);
      await runJob(kind);
      at(11);
      await runJob(kind);

      // Dan through the Platform team.
      expect(notified(kind)).toEqual([ANA, DAN].sort());
      expect(errorsLogged()).toEqual([]);

      // Added quietly: the Created email is the one they get.
      expect(
        ownerRows
          .filter((row: OwnerRow): boolean => {
            return row.recordId === onlyRecord(kind);
          })
          .map((row: OwnerRow): string => {
            return row.userId || row.teamId || "";
          })
          .sort(),
      ).toEqual([ANA, PLATFORM_TEAM].sort());
    });

    test("from a workflow's Create One step: by ID, by email address and by team - reaching them, and not the project's owners - and the run log names whom it left out", async () => {
      const BEN_EMAIL: string = "ben@acme.test";
      const DEPARTED_EMAIL: string = "departed@acme.test";

      // People are found by email address as the step asks: Ben, and somebody who left.
      jest.spyOn(UserService, "findBy").mockImplementation((async (args: {
        query: Record<string, unknown>;
      }): Promise<Array<User>> => {
        const byEmail: Record<string, string> = {
          [BEN_EMAIL]: BEN,
          [DEPARTED_EMAIL]: DEPARTED,
        };

        if (args.query["email"]) {
          return idsAt(args.query, "email")
            .filter((email: string): boolean => {
              return Boolean(byEmail[email]);
            })
            .map((email: string): User => {
              const user: User = personOf(byEmail[email]!);
              user.email = new Email(email);
              return user;
            });
        }

        return idsAt(args.query, "_id").map((id: string): User => {
          return personOf(id);
        });
      }) as never);

      // The step's own props: a Project Admin of the workflow's project, never root.
      jest
        .spyOn(WorkflowPrincipal, "getProps")
        .mockImplementation((async (data: {
          projectId: ObjectID;
          workflowId: ObjectID;
        }) => {
          return WorkflowPrincipal.getPropsWithoutPlan(data);
        }) as never);

      const step: CreateOneBaseModel<BaseModel> = new CreateOneBaseModel(
        (kind === "incident"
          ? IncidentService
          : AlertService) as unknown as DatabaseService<BaseModel>,
      );

      const log: Array<string> = [];

      const result: RunReturnType = await step.run(
        {
          json: {
            title: "Checkout is down",
            ...(kind === "incident"
              ? { incidentSeverityId: INCIDENT_SEVERITY }
              : { alertSeverityId: ALERT_SEVERITY }),
          },
          ownerUsers: [
            ANA,
            `${BEN_EMAIL}, ${DEPARTED_EMAIL}`,
            // A name: entries are read as a Page step reads them, ids and addresses only.
            "Jane",
          ],
          ownerTeams: [PLATFORM_TEAM],
        },
        {
          log: (message: unknown): void => {
            log.push(String(message));
          },
          workflowLogId: ObjectID.generate(),
          workflowId: ObjectID.generate(),
          projectId: PROJECT_ID,
          onError: (exception: Error): Error => {
            return exception;
          },
        } as never,
      );

      expect(result.executePort?.id).toBe("success");

      await waitUntil((): boolean => {
        return !stored(kind).isNotified;
      });

      at(10);
      await runJob(kind);
      at(11);
      await runJob(kind);

      expect(notified(kind)).toEqual([ANA, BEN, DAN].sort());
      expect(errorsLogged()).toEqual([]);

      // Whom it left out, and why: in the run log, never as a failure.
      expect(log).toEqual(
        expect.arrayContaining([
          `Owner Users also held "Jane", which is not a user's ID or email address: left out.`,
          `Owner Users: no member of this project has the ID or email address "${DEPARTED_EMAIL}": left out.`,
        ]),
      );
    });

    test("from a workflow's Create One step with no owners named: the project's owners, as before", async () => {
      jest
        .spyOn(WorkflowPrincipal, "getProps")
        .mockImplementation((async (data: {
          projectId: ObjectID;
          workflowId: ObjectID;
        }) => {
          return WorkflowPrincipal.getPropsWithoutPlan(data);
        }) as never);

      const step: CreateOneBaseModel<BaseModel> = new CreateOneBaseModel(
        (kind === "incident"
          ? IncidentService
          : AlertService) as unknown as DatabaseService<BaseModel>,
      );

      const result: RunReturnType = await step.run(
        {
          json: {
            title: "Checkout is down",
            ...(kind === "incident"
              ? { incidentSeverityId: INCIDENT_SEVERITY }
              : { alertSeverityId: ALERT_SEVERITY }),
          },
        },
        {
          log: (): void => {
            // nothing to say
          },
          workflowLogId: ObjectID.generate(),
          workflowId: ObjectID.generate(),
          projectId: PROJECT_ID,
          onError: (exception: Error): Error => {
            return exception;
          },
        } as never,
      );

      expect(result.executePort?.id).toBe("success");
      await waitUntil((): boolean => {
        return !stored(kind).isNotified;
      });

      at(2);
      await runJob(kind);

      expect(notified(kind)).toEqual([PROJECT_OWNER]);
    });
  },
);

/*
 * #7571 as it was reported: a create made the way MonitorIncident makes
 * one - its caller says it adds owners before the create starts - whose
 * caller never says they are in, as when its process stops. Before, the
 * incident was never picked and nobody was emailed.
 */
describe("an incident whose create's caller never says its owners are in", () => {
  test("is held no longer than a hold lasts, and its owners are then told once", async () => {
    const createBy: CreateBy<Incident> = {
      data: newRecordOf("incident") as Incident,
      props: { isRoot: true },
    };
    CreatedNotificationHold.willAddOwners(
      createBy as CreateBy<BaseModel>,
      OwnersAddedBy.Caller,
    );

    await IncidentService.create(createBy);
    await waitUntil((): boolean => {
      return ownerRulesRan.includes("incident");
    });
    await settle();

    at(4, 59);
    await runJob("incident");
    expect(notified("incident")).toEqual([]);

    at(5);
    await runJob("incident");
    at(6);
    await runJob("incident");

    // The owner rule's owners, whom its chain added.
    expect(notified("incident")).toEqual([CARA, DAN]);
  });
});

/*
 * AN ALERT'S ON-CALL RULES SEE ITS OWNERS TOO (#9407). A rule with an Alert
 * Owner condition ("Alert Owner is any of Payments") is matched on the
 * alert's owner rows as its create chain runs its on-call rules. The
 * criteria's and the device's owners are written by the monitor once the
 * create has returned, the creator's as it returns, and nothing ordered the
 * chain after them: "is any of" missed them, and "is none of" paged. In a
 * project with such a rule, the chain's on-call rules wait for them - a
 * moment at most - and in one without, they run at once, as before.
 */
describe("an alert's on-call rules, as the alert is created", () => {
  // The alert's owners, as each run of its on-call rules read them.
  let ownersSeen: Array<Array<string>>;
  // The project has a rule with an Alert Owner condition.
  let asksWhoOwns: boolean;

  const CREATOR_PROPS: DatabaseCommonInteractionProps = {
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

  function sorted(ids: Array<string>): Array<string> {
    return [...ids].sort();
  }

  beforeEach(() => {
    ownersSeen = [];
    asksWhoOwns = true;

    jest
      .spyOn(AlertOnCallRuleEngineService, "hasRulesWithOwnerCondition")
      .mockImplementation((async (): Promise<boolean> => {
        return asksWhoOwns;
      }) as never);

    // What the rules would match an Alert Owner condition on: the alert's owner rows, now.
    jest
      .spyOn(AlertOnCallRuleEngineService, "applyRulesToAlert")
      .mockImplementation((async (alert: Alert): Promise<undefined> => {
        ownersSeen.push(
          sorted(
            ownerRows
              .filter((row: OwnerRow): boolean => {
                return row.recordId === idOf(alert.id);
              })
              .map((row: OwnerRow): string => {
                return row.userId || row.teamId || "";
              }),
          ),
        );
        return undefined;
      }) as never);
  });

  test("wait for the criteria's and the device's owners, which the monitor adds once the create has returned", async () => {
    gates.monitor = new Gate(false);

    const opening: Promise<unknown> = openFromMonitor("alert");

    // The chain has run its owner rules; the monitor has not added its owners yet.
    await waitUntil((): boolean => {
      return gates.monitor.reached && ownerRulesRan.includes("alert");
    });
    await settle();

    expect(ownersSeen).toEqual([]);

    gates.monitor.open();
    await opening;
    await waitUntil((): boolean => {
      return ownersSeen.length > 0;
    });

    // Every owner: the criteria's Ana, the device's Ben, the owner rule's Cara and Platform.
    expect(ownersSeen).toEqual([sorted([ANA, BEN, CARA, PLATFORM_TEAM])]);
    expect(errorsLogged()).toEqual([]);
  });

  test("run at once in a project with no rule that asks who owns an alert", async () => {
    asksWhoOwns = false;
    gates.monitor = new Gate(false);

    const opening: Promise<unknown> = openFromMonitor("alert");

    await waitUntil((): boolean => {
      return ownersSeen.length > 0;
    });

    // Nothing asks about the monitor's owners: only the owner rule's are in.
    expect(ownersSeen).toEqual([sorted([CARA, PLATFORM_TEAM])]);

    gates.monitor.open();
    await opening;

    expect(ownersSeen).toHaveLength(1);
  });

  test("wait for the person who created it on the dashboard, made its owner as the create returns", async () => {
    owners = NOBODY;
    gates.creator = new Gate(false);

    const creating: Promise<BaseModel> = serviceOf("alert").create({
      data: newRecordOf("alert"),
      props: CREATOR_PROPS,
    });

    await waitUntil((): boolean => {
      return gates.creator.reached && ownerRulesRan.includes("alert");
    });
    await settle();

    expect(ownersSeen).toEqual([]);

    gates.creator.open();
    await creating;
    await waitUntil((): boolean => {
      return ownersSeen.length > 0;
    });

    expect(ownersSeen).toEqual([[ADA]]);
  });

  test("wait a moment at most for a monitor that never says its owners are in", async () => {
    const target: { OWNERS_WAITED_FOR_AT_MOST_MS: number } =
      AlertOnCallRulesOnOwnerChange as unknown as {
        OWNERS_WAITED_FOR_AT_MOST_MS: number;
      };
    const was: number = target.OWNERS_WAITED_FOR_AT_MOST_MS;
    const warnings: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((() => {
        // read below
      }) as never);

    target.OWNERS_WAITED_FOR_AT_MOST_MS = 20;

    try {
      monitorNeverFinishes("alert");

      // Never settles: the monitor's code stopped at its first step.
      void openFromMonitor("alert");

      await waitUntil((): boolean => {
        return ownersSeen.length > 0;
      });

      // The rules ran without the monitor's owners, and said why.
      expect(ownersSeen).toEqual([sorted([CARA, PLATFORM_TEAM])]);
      expect(
        warnings.mock.calls.some((call: Array<unknown>): boolean => {
          return String(call[0]).includes("were not all in after 20 ms");
        }),
      ).toBe(true);
    } finally {
      target.OWNERS_WAITED_FOR_AT_MOST_MS = was;
    }
  });
});
