import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import NotificationRuleEventType from "../../../Types/Workspace/NotificationRules/EventType";
import {
  NotificationRuleConditionCheckOn,
  OWNER_CHECK_ON_BY_EVENT_TYPE,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import AlertEpisodeOwnerTeamService from "../../Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "../../Services/AlertEpisodeOwnerUserService";
import AlertOwnerTeamService from "../../Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../Services/AlertOwnerUserService";
import DatabaseService from "../../Services/DatabaseService";
import IncidentEpisodeOwnerTeamService from "../../Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "../../Services/IncidentEpisodeOwnerUserService";
import IncidentOwnerTeamService from "../../Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../Services/IncidentOwnerUserService";
import MonitorOwnerTeamService from "../../Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../Services/MonitorOwnerUserService";
import OnCallDutyPolicyOwnerTeamService from "../../Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "../../Services/OnCallDutyPolicyOwnerUserService";
import ScheduledMaintenanceOwnerTeamService from "../../Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "../../Services/ScheduledMaintenanceOwnerUserService";
import ServiceLevelObjectiveOwnerTeamService from "../../Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "../../Services/ServiceLevelObjectiveOwnerUserService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";

/*
 * WHO OWNS A RECORD, AS A RULE'S OWNERS CONDITION READS IT (#7554, #7583).
 *
 * "Incident Owner is any of Platform team, Jane" matches an incident when
 * one of its owner users or owner teams is picked. The owners are taken as
 * they are recorded - the rows of the record's owner tables - so a person
 * who is only a member of an owning team is not an owner by being in it:
 * picking Jane matches what Jane owns herself, and picking the Platform
 * team matches what the team owns. A record's owners are read each time it
 * is posted about, so an owner added after the record was created counts
 * from then on.
 *
 * Every kind of record with owners keeps them in a pair of tables - one
 * row a person, one row a team - whose column for the record is named as
 * NotificationFor names the record (incidentId, alertId, ...). A security
 * case and a hunt have no owners.
 */

// The NotificationFor keys of the records that have owners.
export type OwnedRecordKey =
  | "incidentId"
  | "alertId"
  | "incidentEpisodeId"
  | "alertEpisodeId"
  | "scheduledMaintenanceId"
  | "monitorId"
  | "onCallDutyPolicyId"
  | "serviceLevelObjectiveId";

// The tables a kind of record keeps its owners in.
interface OwnerTables {
  recordKey: OwnedRecordKey;
  eventType: NotificationRuleEventType;
  userService: DatabaseService<BaseModel>;
  teamService: DatabaseService<BaseModel>;
}

// Read as plain services of rows: each has its record's column and userId or teamId.
const asService: (service: unknown) => DatabaseService<BaseModel> = (
  service: unknown,
): DatabaseService<BaseModel> => {
  return service as DatabaseService<BaseModel>;
};

// Each kind of record with owners, and the tables its owners are kept in.
const OWNER_TABLES: () => Array<OwnerTables> = (): Array<OwnerTables> => {
  return [
    {
      recordKey: "incidentId",
      eventType: NotificationRuleEventType.Incident,
      userService: asService(IncidentOwnerUserService),
      teamService: asService(IncidentOwnerTeamService),
    },
    {
      recordKey: "alertId",
      eventType: NotificationRuleEventType.Alert,
      userService: asService(AlertOwnerUserService),
      teamService: asService(AlertOwnerTeamService),
    },
    {
      recordKey: "scheduledMaintenanceId",
      eventType: NotificationRuleEventType.ScheduledMaintenance,
      userService: asService(ScheduledMaintenanceOwnerUserService),
      teamService: asService(ScheduledMaintenanceOwnerTeamService),
    },
    {
      recordKey: "monitorId",
      eventType: NotificationRuleEventType.Monitor,
      userService: asService(MonitorOwnerUserService),
      teamService: asService(MonitorOwnerTeamService),
    },
    {
      recordKey: "onCallDutyPolicyId",
      eventType: NotificationRuleEventType.OnCallDutyPolicy,
      userService: asService(OnCallDutyPolicyOwnerUserService),
      teamService: asService(OnCallDutyPolicyOwnerTeamService),
    },
    {
      recordKey: "incidentEpisodeId",
      eventType: NotificationRuleEventType.IncidentEpisode,
      userService: asService(IncidentEpisodeOwnerUserService),
      teamService: asService(IncidentEpisodeOwnerTeamService),
    },
    {
      recordKey: "alertEpisodeId",
      eventType: NotificationRuleEventType.AlertEpisode,
      userService: asService(AlertEpisodeOwnerUserService),
      teamService: asService(AlertEpisodeOwnerTeamService),
    },
    {
      recordKey: "serviceLevelObjectiveId",
      eventType: NotificationRuleEventType.ServiceLevelObjective,
      userService: asService(ServiceLevelObjectiveOwnerUserService),
      teamService: asService(ServiceLevelObjectiveOwnerTeamService),
    },
  ];
};

// How many records' owners are read in one query of the summaries.
export const OWNER_READ_BATCH_SIZE: number = 500;

// The owner of a record, read from a row of its owner tables.
const readId: (row: BaseModel, column: string) => string = (
  row: BaseModel,
  column: string,
): string => {
  const value: unknown = (row as unknown as Record<string, unknown>)[column];

  return value === undefined || value === null ? "" : value.toString();
};

export default class WorkspaceRecordOwners {
  /*
   * The record a notification is for, when its kind of record has owners:
   * the key that names it, its id and its owners condition. The kind is
   * the rules' event type, as the rules being matched were chosen by it -
   * never guessed from which ids the notification happens to carry.
   */
  public static getOwnedRecord(data: {
    eventType: NotificationRuleEventType;
    notificationFor: {
      [key in OwnedRecordKey]?: ObjectID | undefined;
    };
  }): {
    recordKey: OwnedRecordKey;
    recordId: ObjectID;
    checkOn: NotificationRuleConditionCheckOn;
  } | null {
    const tables: OwnerTables | undefined = OWNER_TABLES().find(
      (candidate: OwnerTables): boolean => {
        return candidate.eventType === data.eventType;
      },
    );
    const checkOn: NotificationRuleConditionCheckOn | undefined =
      OWNER_CHECK_ON_BY_EVENT_TYPE[data.eventType];

    if (!tables || !checkOn) {
      return null;
    }

    const recordId: ObjectID | undefined =
      data.notificationFor[tables.recordKey];

    return recordId
      ? { recordKey: tables.recordKey, recordId: recordId, checkOn: checkOn }
      : null;
  }

  /*
   * The ids of the people and teams that own one record - people first,
   * then teams - as its owners condition matches them.
   */
  public static async getOwnerIds(data: {
    recordKey: OwnedRecordKey;
    recordId: ObjectID;
  }): Promise<Array<string>> {
    const owners: Map<
      string,
      Array<string>
    > = await WorkspaceRecordOwners.getOwnerIdsByRecord({
      recordKey: data.recordKey,
      recordIds: [data.recordId],
    });

    return owners.get(data.recordId.toString().toLowerCase()) || [];
  }

  /*
   * The owners of many records of one kind at once - a summary's incidents -
   * by record id (lower case), a few hundred records a query. A record
   * with no owners has an empty list.
   */
  public static async getOwnerIdsByRecord(data: {
    recordKey: OwnedRecordKey;
    recordIds: Array<ObjectID>;
  }): Promise<Map<string, Array<string>>> {
    const owners: Map<string, Array<string>> = new Map();
    const tables: OwnerTables | undefined = OWNER_TABLES().find(
      (candidate: OwnerTables): boolean => {
        return candidate.recordKey === data.recordKey;
      },
    );

    const recordIds: Array<string> = Array.from(
      new Set(
        data.recordIds.map((recordId: ObjectID): string => {
          return recordId.toString().toLowerCase();
        }),
      ),
    );

    for (const recordId of recordIds) {
      owners.set(recordId, []);
    }

    if (!tables || recordIds.length === 0) {
      return owners;
    }

    for (
      let start: number = 0;
      start < recordIds.length;
      start += OWNER_READ_BATCH_SIZE
    ) {
      const batch: Array<string> = recordIds.slice(
        start,
        start + OWNER_READ_BATCH_SIZE,
      );

      for (const owner of [
        { service: tables.userService, column: "userId" },
        { service: tables.teamService, column: "teamId" },
      ]) {
        const rows: Array<BaseModel> = await owner.service.findAllBy({
          query: {
            [data.recordKey]: QueryHelper.any(batch),
          } as unknown as Query<BaseModel>,
          select: {
            [data.recordKey]: true,
            [owner.column]: true,
          } as unknown as Select<BaseModel>,
          props: {
            isRoot: true,
          },
        });

        for (const row of rows) {
          const recordId: string = readId(row, data.recordKey).toLowerCase();
          const ownerId: string = readId(row, owner.column);
          const list: Array<string> | undefined = owners.get(recordId);

          if (list && ownerId && !list.includes(ownerId)) {
            list.push(ownerId);
          }
        }
      }
    }

    return owners;
  }
}
