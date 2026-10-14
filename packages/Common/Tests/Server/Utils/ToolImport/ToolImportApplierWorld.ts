import { jest } from "@jest/globals";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import ToolImportRecord from "../../../../Models/DatabaseModels/ToolImportRecord";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import IncidentCustomFieldService from "../../../../Server/Services/IncidentCustomFieldService";
import IncidentRoleService from "../../../../Server/Services/IncidentRoleService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import IncidentStateService from "../../../../Server/Services/IncidentStateService";
import MonitorOwnerUserService from "../../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../Server/Services/MonitorStatusService";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyOwnerTeamService from "../../../../Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyScheduleLayerService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleOwnerTeamService from "../../../../Server/Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import ServiceOwnerTeamService from "../../../../Server/Services/ServiceOwnerTeamService";
import ServiceService from "../../../../Server/Services/ServiceService";
import StatusPageGroupService from "../../../../Server/Services/StatusPageGroupService";
import StatusPageOwnerUserService from "../../../../Server/Services/StatusPageOwnerUserService";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import ToolImportRecordService from "../../../../Server/Services/ToolImportRecordService";
import ToolImportProjectStateReader from "../../../../Server/Utils/ToolImport/ToolImportProjectStateReader";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import { FindOperator } from "typeorm";

/*
 * OneUptime's services as the applier unit tests see them: every create the
 * import makes is recorded (which service, the record, the props it was made
 * with, its misc data) and answered with the record and a new id, as the
 * service would answer. A test can make one service refuse, to see the
 * import carry on. ToolImportRecord rows live in memory, read as the
 * database reads them, so a test can start from what an earlier import (or
 * an earlier attempt) remembered.
 *
 * The Postgres suite (ToolImportPostgres) runs an import end to end
 * through the real services and a real, migrated database.
 */

export interface RecordedCreate {
  service: string;
  data: BaseModel;
  props: DatabaseCommonInteractionProps;
  miscDataProps?: JSONObject | undefined;
}

type CreateArgs = {
  data: BaseModel;
  props: DatabaseCommonInteractionProps;
  miscDataProps?: JSONObject | undefined;
};

interface CreateSpyTarget {
  create: (args: CreateArgs) => Promise<BaseModel>;
}

interface UpdateByIdSpyTarget {
  updateOneById: (args: never) => Promise<void>;
}

interface UpdateBySpyTarget {
  updateBy: (args: never) => Promise<number>;
}

// An update the import made: by id, or by a query.
export interface RecordedUpdate {
  service: string;
  id?: string | undefined;
  query?: JSONObject | undefined;
  data: JSONObject;
  props: DatabaseCommonInteractionProps;
}

function monitorStatus(
  id: string,
  flags: { isOperationalState?: boolean; isOfflineState?: boolean },
  priority: number,
): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.id = new ObjectID(toUuid(id));
  status.isOperationalState = Boolean(flags.isOperationalState);
  status.isOfflineState = Boolean(flags.isOfflineState);
  status.priority = priority;
  return status;
}

function severityRecord<T extends IncidentSeverity | AlertSeverity>(
  type: { new (): T },
  id: string,
  order: number,
): T {
  const severity: T = new type();
  severity.id = new ObjectID(toUuid(id));
  severity.order = order;
  return severity;
}

/*
 * The ids a read by id names (QueryHelper.any on `_id`), lowercase, or null
 * when it names none.
 */
export function idsNamedBy(value: unknown): Set<string> | null {
  if (!(value instanceof FindOperator)) {
    return null;
  }

  return new Set<string>(
    Object.values(value.objectLiteralParameters || {})
      .flat()
      .map((id: unknown): string => {
        return String(id).toLowerCase();
      }),
  );
}

// A read of a table, as DatabaseService.findBy is asked for one.
export interface TableRead {
  sort?: Record<string, unknown> | undefined;
  skip?: unknown;
  limit?: unknown;
}

/*
 * The rows a read of the database returns of `rows` (oldest first): in the
 * read's order - by `_id` when it sorts by it, newest first when it names
 * no order, as DatabaseService does - from `skip`, and at most `limit`. So
 * a read that stops at its limit misses the oldest rows, as one of the
 * database would, and a read of every row (findAllBy) pages through them.
 */
export function readAsTheDatabaseWould<T extends BaseModel>(
  rows: Array<T>,
  read: TableRead,
): Array<T> {
  const isSorted: boolean = Object.keys(read.sort || {}).length > 0;

  if (
    isSorted &&
    JSON.stringify(read.sort) !== JSON.stringify({ _id: SortOrder.Ascending })
  ) {
    throw new Error(
      `Only an order by _id is stood in for, not ${JSON.stringify(read.sort)}.`,
    );
  }

  const ordered: Array<T> = isSorted
    ? [...rows].sort((a: T, b: T): number => {
        const left: string = a._id || "";
        const right: string = b._id || "";

        return left < right ? -1 : left > right ? 1 : 0;
      })
    : [...rows].reverse();
  const skip: number = typeof read.skip === "number" ? read.skip : 0;
  const limit: number =
    typeof read.limit === "number" ? read.limit : ordered.length;

  return ordered.slice(skip, skip + limit);
}

/*
 * A readable name as a UUID, the same every time: "status-offline" is
 * always the same id, so a test can name the record it expects.
 */
export function toUuid(name: string): string {
  let hash: number = 0;

  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  const hex: string = hash.toString(16).padStart(8, "0").slice(0, 8);

  return `${hex}-0000-4000-8000-${String(name.length).padStart(12, "0")}`;
}

export class ApplierWorld {
  public creates: Array<RecordedCreate> = [];
  // The remembered rows, oldest first.
  public records: Array<ToolImportRecord> = [];
  public recordReads: Array<TableRead> = [];
  public deletedRecordIds: Array<string> = [];
  public members: Map<string, string> = new Map<string, string>();
  private refusals: Map<string, (data: BaseModel) => Error | null> = new Map<
    string,
    (data: BaseModel) => Error | null
  >();

  public constructor() {
    const services: Record<string, unknown> = {
      TeamMember: TeamMemberService,
      Team: TeamService,
      Service: ServiceService,
      ServiceOwnerTeam: ServiceOwnerTeamService,
      IncidentSeverity: IncidentSeverityService,
      IncidentState: IncidentStateService,
      IncidentRole: IncidentRoleService,
      IncidentCustomField: IncidentCustomFieldService,
      OnCallDutyPolicySchedule: OnCallDutyPolicyScheduleService,
      OnCallDutyPolicyScheduleLayer: OnCallDutyPolicyScheduleLayerService,
      OnCallDutyPolicyScheduleLayerUser:
        OnCallDutyPolicyScheduleLayerUserService,
      OnCallDutyPolicyScheduleOwnerTeam:
        OnCallDutyPolicyScheduleOwnerTeamService,
      OnCallDutyPolicy: OnCallDutyPolicyService,
      OnCallDutyPolicyEscalationRule: OnCallDutyPolicyEscalationRuleService,
      OnCallDutyPolicyOwnerTeam: OnCallDutyPolicyOwnerTeamService,
    };

    for (const [name, service] of Object.entries(services)) {
      jest
        .spyOn(service as CreateSpyTarget, "create")
        .mockImplementation(async (args: CreateArgs): Promise<BaseModel> => {
          return await this.create(name, args);
        });
    }

    /*
     * The remembered rows (of a kind, when the read names one) as the
     * database reads them: a read that stops at its limit misses the
     * oldest, and a read of every row - findAllBy, the service's own -
     * pages through them all. Each read is kept in `recordReads`.
     */
    jest.spyOn(ToolImportRecordService, "findBy").mockImplementation((async (
      args: TableRead & { query: { kind?: ToolImportResourceKind } },
    ): Promise<Array<ToolImportRecord>> => {
      this.recordReads.push(args);

      return readAsTheDatabaseWould(
        this.records.filter((record: ToolImportRecord) => {
          return !args.query.kind || record.kind === args.query.kind;
        }),
        args,
      );
    }) as never);

    jest
      .spyOn(ToolImportRecordService, "create")
      .mockImplementation((async (args: {
        data: ToolImportRecord;
      }): Promise<ToolImportRecord> => {
        const record: ToolImportRecord = args.data;
        record.id = ObjectID.generate();
        this.records.push(record);
        return record;
      }) as never);

    jest
      .spyOn(ToolImportRecordService, "updateOneById")
      .mockImplementation((async (args: {
        id: ObjectID;
        data: { isComplete?: boolean };
      }): Promise<void> => {
        const record: ToolImportRecord | undefined = this.records.find(
          (candidate: ToolImportRecord) => {
            return candidate.id?.toString() === args.id.toString();
          },
        );

        if (record && args.data.isComplete !== undefined) {
          record.isComplete = args.data.isComplete;
        }
      }) as never);

    jest
      .spyOn(ToolImportRecordService, "deleteOneById")
      .mockImplementation((async (args: { id: ObjectID }): Promise<number> => {
        this.deletedRecordIds.push(args.id.toString());
        this.records = this.records.filter((record: ToolImportRecord) => {
          return record.id?.toString() !== args.id.toString();
        });
        return 1;
      }) as never);

    jest
      .spyOn(ToolImportProjectStateReader, "readMembersByEmail")
      .mockImplementation(async (): Promise<Map<string, string>> => {
        return new Map(this.members);
      });
  }

  /*
   * The services an uptime or status page import uses, stood in for the
   * same way: their creates recorded and answered, the project's monitor
   * statuses and severities answered from `statuses`, `incidentSeverities`
   * and `alertSeverities` (each read recorded in `reads`), and every
   * update the import makes - marking what it made as announced -
   * recorded in `updates`.
   */
  public statuses: Array<MonitorStatus> = [
    monitorStatus("status-operational", { isOperationalState: true }, 1),
    monitorStatus("status-degraded", {}, 2),
    monitorStatus("status-offline", { isOfflineState: true }, 3),
  ];
  public incidentSeverities: Array<IncidentSeverity> = [
    severityRecord(IncidentSeverity, "incident-critical", 1),
    severityRecord(IncidentSeverity, "incident-minor", 2),
  ];
  public alertSeverities: Array<AlertSeverity> = [
    severityRecord(AlertSeverity, "alert-critical", 1),
    severityRecord(AlertSeverity, "alert-major", 2),
    severityRecord(AlertSeverity, "alert-minor", 3),
    severityRecord(AlertSeverity, "alert-warning", 4),
  ];
  public reads: Array<string> = [];
  public updates: Array<RecordedUpdate> = [];

  public withMonitoring(): ApplierWorld {
    const services: Record<string, unknown> = {
      Monitor: MonitorService,
      StatusPage: StatusPageService,
      StatusPageGroup: StatusPageGroupService,
      StatusPageResource: StatusPageResourceService,
      StatusPageSubscriber: StatusPageSubscriberService,
    };

    for (const [name, service] of Object.entries(services)) {
      jest
        .spyOn(service as CreateSpyTarget, "create")
        .mockImplementation(async (args: CreateArgs): Promise<BaseModel> => {
          return await this.create(name, args);
        });
    }

    jest.spyOn(MonitorStatusService, "findBy").mockImplementation((async () => {
      this.reads.push("MonitorStatus");
      return this.statuses;
    }) as never);

    // The subscribers it made, read back by id.
    jest
      .spyOn(StatusPageSubscriberService, "findBy")
      .mockImplementation((async (args: {
        query: { _id?: unknown };
      }): Promise<Array<StatusPageSubscriber>> => {
        const ids: Set<string> | null = idsNamedBy(args.query._id);

        return this.dataOf<StatusPageSubscriber>("StatusPageSubscriber").filter(
          (subscriber: StatusPageSubscriber) => {
            return !ids || ids.has(subscriber.id!.toString().toLowerCase());
          },
        );
      }) as never);

    jest
      .spyOn(IncidentSeverityService, "findBy")
      .mockImplementation((async () => {
        this.reads.push("IncidentSeverity");
        return this.incidentSeverities;
      }) as never);

    jest.spyOn(AlertSeverityService, "findBy").mockImplementation((async () => {
      this.reads.push("AlertSeverity");
      return this.alertSeverities;
    }) as never);

    const updateTargets: Record<string, unknown> = {
      Monitor: MonitorService,
      StatusPage: StatusPageService,
    };

    for (const [name, service] of Object.entries(updateTargets)) {
      jest
        .spyOn(service as UpdateByIdSpyTarget, "updateOneById")
        .mockImplementation((async (args: {
          id: ObjectID;
          data: JSONObject;
          props: DatabaseCommonInteractionProps;
        }): Promise<void> => {
          this.updates.push({
            service: name,
            id: args.id.toString(),
            data: args.data,
            props: args.props,
          });
        }) as never);
    }

    const ownerTargets: Record<string, unknown> = {
      MonitorOwnerUser: MonitorOwnerUserService,
      StatusPageOwnerUser: StatusPageOwnerUserService,
    };

    for (const [name, service] of Object.entries(ownerTargets)) {
      jest
        .spyOn(service as UpdateBySpyTarget, "updateBy")
        .mockImplementation((async (args: {
          query: JSONObject;
          data: JSONObject;
          props: DatabaseCommonInteractionProps;
        }): Promise<number> => {
          this.updates.push({
            service: name,
            query: args.query,
            data: args.data,
            props: args.props,
          });
          return 1;
        }) as never);
    }

    return this;
  }

  // Makes `service` refuse the creates `refuse` returns an error for.
  public refuse(
    service: string,
    refuse: (data: BaseModel) => Error | null,
  ): ApplierWorld {
    this.refusals.set(service, refuse);
    return this;
  }

  public createsOf(service: string): Array<RecordedCreate> {
    return this.creates.filter((create: RecordedCreate) => {
      return create.service === service;
    });
  }

  public dataOf<T extends BaseModel>(service: string): Array<T> {
    return this.createsOf(service).map((create: RecordedCreate) => {
      return create.data as T;
    });
  }

  private async create(name: string, args: CreateArgs): Promise<BaseModel> {
    const refusal: Error | null = this.refusals.get(name)?.(args.data) || null;

    if (refusal) {
      throw refusal;
    }

    const data: BaseModel = args.data;
    data.id = ObjectID.generate();

    // An invitation by email names the account it created or found.
    if (name === "TeamMember" && args.miscDataProps?.["email"]) {
      (data as unknown as { userId: ObjectID }).userId = new ObjectID(
        this.userIdFor(args.miscDataProps["email"] as string),
      );
    }

    this.creates.push({
      service: name,
      data: data,
      props: args.props,
      miscDataProps: args.miscDataProps,
    });

    return data;
  }

  // A stable user id per invited email, so tests can name who was invited.
  public userIdFor(email: string): string {
    let hash: number = 0;

    for (const char of email) {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    }

    const hex: string = hash.toString(16).padStart(8, "0").slice(0, 8);

    return `${hex}-0000-4000-8000-000000000000`;
  }
}
