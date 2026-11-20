import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  RecordAccessKind,
  RecordAccessOperation,
} from "../../../Types/RecordAccess/RecordAccess";
import AlertEpisodeInternalNoteService from "../../Services/AlertEpisodeInternalNoteService";
import AlertEpisodeOwnerTeamService from "../../Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "../../Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../Services/AlertEpisodeStateTimelineService";
import AlertInternalNoteService from "../../Services/AlertInternalNoteService";
import AlertOwnerTeamService from "../../Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../Services/AlertOwnerUserService";
import AlertService from "../../Services/AlertService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import AlertVideoCallService from "../../Services/AlertVideoCallService";
import DatabaseService from "../../Services/DatabaseService";
import IncidentEpisodeInternalNoteService from "../../Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeOwnerTeamService from "../../Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "../../Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodePublicNoteService from "../../Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeRoleMemberService from "../../Services/IncidentEpisodeRoleMemberService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../Services/IncidentEpisodeStateTimelineService";
import IncidentInternalNoteService from "../../Services/IncidentInternalNoteService";
import IncidentMemberService from "../../Services/IncidentMemberService";
import IncidentOwnerTeamService from "../../Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../Services/IncidentOwnerUserService";
import IncidentPostmortemActionItemService from "../../Services/IncidentPostmortemActionItemService";
import IncidentPublicNoteService from "../../Services/IncidentPublicNoteService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import IncidentVideoCallService from "../../Services/IncidentVideoCallService";
import ScheduledMaintenanceInternalNoteService from "../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceOwnerTeamService from "../../Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "../../Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenancePublicNoteService from "../../Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../Services/ScheduledMaintenanceStateTimelineService";

/*
 * THE RECORDS WHOSE PAGES ASK WHAT THE READER MAY DO (RecordAccessBuilder),
 * AND THE PARTS OF EACH THAT THEIR PAGES CHANGE.
 *
 * A part is a table read through the record (@CanAccessIfCanReadOn): its
 * notes, its state changes, its roles, its owners, its calls. Every row of
 * a part names the record by one key, and names no other record a grant or
 * a block could be limited to, so what the reader may do to one row of it
 * is what they may do to every row of it on this record: the server's rule
 * weighs the record's labels, owners and privacy for each. A table whose
 * rows each name another record as well - an incident's link to an alert,
 * an episode's incidents, a runbook's run - is left to the reader's own
 * permissions, and the server keeps the last word on it.
 *
 * Each part lists what its pages offer: a new row (Create), a change of a
 * row (Update), a row removed (Delete). An owner is added and removed,
 * never changed.
 */

export const ALL_OPERATIONS: ReadonlyArray<RecordAccessOperation> = [
  RecordAccessOperation.Create,
  RecordAccessOperation.Update,
  RecordAccessOperation.Delete,
];

const ADD_AND_REMOVE: ReadonlyArray<RecordAccessOperation> = [
  RecordAccessOperation.Create,
  RecordAccessOperation.Delete,
];

export interface RecordAccessPart {
  service: DatabaseService<BaseModel>;
  // The key a row names the record by: "incidentId".
  recordKey: string;
  operations: ReadonlyArray<RecordAccessOperation>;
}

export interface RecordAccessKindSpec {
  kind: RecordAccessKind;
  // The record's own table.
  service: DatabaseService<BaseModel>;
  // Who owns it, by the key their rows name it by: "incidentId".
  ownerUserService: DatabaseService<BaseModel>;
  ownerTeamService: DatabaseService<BaseModel>;
  ownerKey: string;
  // The record is changed and deleted; it is not created from its page.
  parts: ReadonlyArray<RecordAccessPart>;
}

const asService: (service: unknown) => DatabaseService<BaseModel> = (
  service: unknown,
): DatabaseService<BaseModel> => {
  return service as DatabaseService<BaseModel>;
};

const part: (
  service: unknown,
  recordKey: string,
  operations?: ReadonlyArray<RecordAccessOperation>,
) => RecordAccessPart = (
  service: unknown,
  recordKey: string,
  operations?: ReadonlyArray<RecordAccessOperation>,
): RecordAccessPart => {
  return {
    service: asService(service),
    recordKey: recordKey,
    operations: operations || ALL_OPERATIONS,
  };
};

/*
 * Read when a page asks, not when the module loads: a service's own module
 * may still be loading the first time this one is.
 */
export const getRecordAccessKindSpec: (
  kind: RecordAccessKind,
) => RecordAccessKindSpec = (kind: RecordAccessKind): RecordAccessKindSpec => {
  switch (kind) {
    case RecordAccessKind.Incident:
      return {
        kind: kind,
        service: asService(IncidentService),
        ownerUserService: asService(IncidentOwnerUserService),
        ownerTeamService: asService(IncidentOwnerTeamService),
        ownerKey: "incidentId",
        parts: [
          part(IncidentStateTimelineService, "incidentId"),
          part(IncidentInternalNoteService, "incidentId"),
          part(IncidentPublicNoteService, "incidentId"),
          part(IncidentMemberService, "incidentId"),
          part(IncidentOwnerUserService, "incidentId", ADD_AND_REMOVE),
          part(IncidentOwnerTeamService, "incidentId", ADD_AND_REMOVE),
          part(IncidentPostmortemActionItemService, "incidentId"),
          part(IncidentVideoCallService, "incidentId"),
        ],
      };
    case RecordAccessKind.Alert:
      return {
        kind: kind,
        service: asService(AlertService),
        ownerUserService: asService(AlertOwnerUserService),
        ownerTeamService: asService(AlertOwnerTeamService),
        ownerKey: "alertId",
        parts: [
          part(AlertStateTimelineService, "alertId"),
          part(AlertInternalNoteService, "alertId"),
          part(AlertOwnerUserService, "alertId", ADD_AND_REMOVE),
          part(AlertOwnerTeamService, "alertId", ADD_AND_REMOVE),
          part(AlertVideoCallService, "alertId"),
        ],
      };
    case RecordAccessKind.IncidentEpisode:
      return {
        kind: kind,
        service: asService(IncidentEpisodeService),
        ownerUserService: asService(IncidentEpisodeOwnerUserService),
        ownerTeamService: asService(IncidentEpisodeOwnerTeamService),
        ownerKey: "incidentEpisodeId",
        parts: [
          part(IncidentEpisodeStateTimelineService, "incidentEpisodeId"),
          part(IncidentEpisodeInternalNoteService, "incidentEpisodeId"),
          part(IncidentEpisodePublicNoteService, "incidentEpisodeId"),
          part(IncidentEpisodeRoleMemberService, "incidentEpisodeId"),
          part(
            IncidentEpisodeOwnerUserService,
            "incidentEpisodeId",
            ADD_AND_REMOVE,
          ),
          part(
            IncidentEpisodeOwnerTeamService,
            "incidentEpisodeId",
            ADD_AND_REMOVE,
          ),
        ],
      };
    case RecordAccessKind.AlertEpisode:
      return {
        kind: kind,
        service: asService(AlertEpisodeService),
        ownerUserService: asService(AlertEpisodeOwnerUserService),
        ownerTeamService: asService(AlertEpisodeOwnerTeamService),
        ownerKey: "alertEpisodeId",
        parts: [
          part(AlertEpisodeStateTimelineService, "alertEpisodeId"),
          part(AlertEpisodeInternalNoteService, "alertEpisodeId"),
          part(AlertEpisodeOwnerUserService, "alertEpisodeId", ADD_AND_REMOVE),
          part(AlertEpisodeOwnerTeamService, "alertEpisodeId", ADD_AND_REMOVE),
        ],
      };
    case RecordAccessKind.ScheduledMaintenance:
      return {
        kind: kind,
        service: asService(ScheduledMaintenanceService),
        ownerUserService: asService(ScheduledMaintenanceOwnerUserService),
        ownerTeamService: asService(ScheduledMaintenanceOwnerTeamService),
        ownerKey: "scheduledMaintenanceId",
        parts: [
          part(
            ScheduledMaintenanceStateTimelineService,
            "scheduledMaintenanceId",
          ),
          part(
            ScheduledMaintenanceInternalNoteService,
            "scheduledMaintenanceId",
          ),
          part(ScheduledMaintenancePublicNoteService, "scheduledMaintenanceId"),
          part(
            ScheduledMaintenanceOwnerUserService,
            "scheduledMaintenanceId",
            ADD_AND_REMOVE,
          ),
          part(
            ScheduledMaintenanceOwnerTeamService,
            "scheduledMaintenanceId",
            ADD_AND_REMOVE,
          ),
        ],
      };
  }
};
