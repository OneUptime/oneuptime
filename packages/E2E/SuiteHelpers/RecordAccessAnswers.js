/*
 * WHAT THE READER MAY DO ON A RECORD, AS AN OFFLINE FIXTURE'S SERVER
 * ANSWERS IT (#10272).
 *
 * Each record's view layout - an incident's, an alert's, an episode's, a
 * maintenance event's - asks GET /<record>/record-access/:id once as its
 * pages open (RecordAccessScopeProvider), and the locks on its pages weigh
 * the answer (Types/RecordAccess/RecordAccess): whether the reader may
 * change and delete the record, and add, change and remove each of its
 * parts - a change or a removal of a part only once the record has a row of
 * it, and an owner is added and removed, never changed. The server works it
 * out by the checks a write runs (Server/Utils/RecordAccess
 * /RecordAccessBuilder, RecordAccessKinds) and says why it refuses one.
 *
 * A fixture's readers hold grants that reach the whole project: none is
 * limited to labels or to the records they own, and no team of theirs
 * blocks one on some labels. For them the rule refuses what their
 * permissions do not allow, as a permission they do not hold, and nothing
 * more - except on a private record, which is changed only with the
 * permissions of the teams of theirs that own it (PrivateRecordHeld, the
 * rule as the Dashboard states it): what those may not do is refused as
 * private, naming them. A master admin is refused nothing. So the answer
 * locks nothing the page's own locks do not, as the server's does for such
 * a reader.
 *
 * A fixture answers the route with answerRecordAccess, handing it the rows
 * it holds, who reads them, and where to record a table it cannot answer:
 *
 *   if (method === "GET" && url.includes("/record-access/")) {
 *     const access = answerRecordAccess({ url, rowsOf, reader, unmodelled });
 *     if (access) {
 *       return ok(access);
 *     }
 *   }
 */
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeInternalNote from "Common/Models/DatabaseModels/AlertEpisodeInternalNote";
import AlertEpisodeOwnerTeam from "Common/Models/DatabaseModels/AlertEpisodeOwnerTeam";
import AlertEpisodeOwnerUser from "Common/Models/DatabaseModels/AlertEpisodeOwnerUser";
import AlertEpisodeStateTimeline from "Common/Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import AlertOwnerTeam from "Common/Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "Common/Models/DatabaseModels/AlertOwnerUser";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";
import AlertVideoCall from "Common/Models/DatabaseModels/AlertVideoCall";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeInternalNote from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodeOwnerTeam from "Common/Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "Common/Models/DatabaseModels/IncidentEpisodeOwnerUser";
import IncidentEpisodePublicNote from "Common/Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentEpisodeRoleMember from "Common/Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentEpisodeStateTimeline from "Common/Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentMember from "Common/Models/DatabaseModels/IncidentMember";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import IncidentPostmortemActionItem from "Common/Models/DatabaseModels/IncidentPostmortemActionItem";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceInternalNote from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HeldPermissionsUtil from "Common/Types/HeldPermissions";
import PrivateRecordHeld from "Common/Types/PrivateRecord/PrivateRecordHeld";
import RecordAccess, {
  RECORD_ACCESS_TABLES,
  RecordAccessKind,
  RecordAccessOperation,
  RecordAccessRefusalReason,
} from "Common/Types/RecordAccess/RecordAccess";
import { RECORD_ACCESS_API_PATHS } from "../../App/FeatureSet/Dashboard/src/Components/RecordAccess/RecordAccessApi";

// Each kind's record, the key its parts name it by, and its owner tables.
const RECORDS = {
  [RecordAccessKind.Incident]: {
    modelType: Incident,
    key: "incidentId",
    ownerUser: IncidentOwnerUser,
    ownerTeam: IncidentOwnerTeam,
  },
  [RecordAccessKind.Alert]: {
    modelType: Alert,
    key: "alertId",
    ownerUser: AlertOwnerUser,
    ownerTeam: AlertOwnerTeam,
  },
  [RecordAccessKind.IncidentEpisode]: {
    modelType: IncidentEpisode,
    key: "incidentEpisodeId",
    ownerUser: IncidentEpisodeOwnerUser,
    ownerTeam: IncidentEpisodeOwnerTeam,
  },
  [RecordAccessKind.AlertEpisode]: {
    modelType: AlertEpisode,
    key: "alertEpisodeId",
    ownerUser: AlertEpisodeOwnerUser,
    ownerTeam: AlertEpisodeOwnerTeam,
  },
  [RecordAccessKind.ScheduledMaintenance]: {
    modelType: ScheduledMaintenance,
    key: "scheduledMaintenanceId",
    ownerUser: ScheduledMaintenanceOwnerUser,
    ownerTeam: ScheduledMaintenanceOwnerTeam,
  },
};

function tableNameOf(modelType) {
  return new modelType().tableName;
}

// The model of each table an answer is about (RECORD_ACCESS_TABLES).
const MODELS = new Map(
  [
    Incident,
    IncidentStateTimeline,
    IncidentInternalNote,
    IncidentPublicNote,
    IncidentMember,
    IncidentOwnerUser,
    IncidentOwnerTeam,
    IncidentPostmortemActionItem,
    IncidentVideoCall,
    Alert,
    AlertStateTimeline,
    AlertInternalNote,
    AlertOwnerUser,
    AlertOwnerTeam,
    AlertVideoCall,
    IncidentEpisode,
    IncidentEpisodeStateTimeline,
    IncidentEpisodeInternalNote,
    IncidentEpisodePublicNote,
    IncidentEpisodeRoleMember,
    IncidentEpisodeOwnerUser,
    IncidentEpisodeOwnerTeam,
    AlertEpisode,
    AlertEpisodeStateTimeline,
    AlertEpisodeInternalNote,
    AlertEpisodeOwnerUser,
    AlertEpisodeOwnerTeam,
    ScheduledMaintenance,
    ScheduledMaintenanceStateTimeline,
    ScheduledMaintenanceInternalNote,
    ScheduledMaintenancePublicNote,
    ScheduledMaintenanceOwnerUser,
    ScheduledMaintenanceOwnerTeam,
  ].map((modelType) => {
    return [tableNameOf(modelType), modelType];
  }),
);

const ROUTE = /\/api(\/[a-z-]+)\/record-access\/([^/?#]+)/;

function permissionsAllow(model, operation, permissions) {
  if (operation === RecordAccessOperation.Create) {
    return model.hasCreatePermissions(permissions);
  }
  if (operation === RecordAccessOperation.Update) {
    return model.hasUpdatePermissions(permissions);
  }
  return model.hasDeletePermissions(permissions);
}

/*
 * The answer to GET <url>, as JSON (RecordAccess.toJSON), or null when
 * <url> is no record's route. `rowsOf(modelType)` is the rows the fixture
 * holds of a model - none of one it does not hold - each id as text or an
 * ObjectID. `reader` is who asks: `isMasterAdmin`, refused nothing;
 * `permissions`, what they hold across the project; `permissionRows` and
 * `globalPermissions`, their snapshot (UserPermission rows, each naming the
 * team it is granted through, and what they hold outside any project), of
 * which a private record weighs only the rows of the teams of theirs that
 * own it; and `userId`, as a person named as its owner holds all of theirs
 * on it.
 *
 * A record the fixture does not hold is refused as missing, as the server
 * refuses one the reader may not read. A table of the answer with no model
 * here is one the server's rule has gained since: it is handed to
 * `unmodelled(tableName)` - the fixture records it with the requests it
 * does not model, which its specs assert are none - and left out.
 */
export function answerRecordAccess(data) {
  const [, recordPath, recordId] = ROUTE.exec(data.url) || [];
  const kind = Object.values(RecordAccessKind).find((candidate) => {
    return RECORD_ACCESS_API_PATHS[candidate] === recordPath;
  });

  if (!kind) {
    return null;
  }

  const spec = RECORDS[kind];
  const rowsOfRecord = (modelType) => {
    return data.rowsOf(modelType).filter((row) => {
      return String(row[spec.key]) === recordId;
    });
  };
  const record = data.rowsOf(spec.modelType).find((row) => {
    return String(row._id) === recordId;
  });

  if (!record) {
    throw new HTTPErrorResponse(
      404,
      { message: `${new spec.modelType().singularName} not found.` },
      {},
    );
  }

  const reader = data.reader;
  const owningTeams = rowsOfRecord(spec.ownerTeam);
  // Null when all the reader holds reaches the record; else what does.
  const heldOnRecord = reader.isMasterAdmin
    ? null
    : PrivateRecordHeld.getHeldOnRecord({
        rows: reader.permissionRows,
        globalPermissions: reader.globalPermissions,
        isPrivate: record.isPrivate === true,
        isOwnedByPerson: rowsOfRecord(spec.ownerUser).some((owner) => {
          return String(owner.userId) === String(reader.userId);
        }),
        owningTeamIds: owningTeams.map((owner) => {
          return String(owner.teamId);
        }),
      });
  const onRecord = heldOnRecord
    ? HeldPermissionsUtil.getUnblockedPermissions(heldOnRecord)
    : reader.permissions;
  const readerTeamIds = reader.permissionRows
    .filter((row) => {
      return Boolean(row.teamId);
    })
    .map((row) => {
      return String(row.teamId);
    });
  // The teams of the reader's that own it, as a private refusal names them.
  const owningTeamNames = owningTeams
    .filter((owner) => {
      return readerTeamIds.includes(String(owner.teamId));
    })
    .map((owner) => {
      return owner.team?.name;
    })
    .filter(Boolean);

  const verdict = (model, operation) => {
    if (reader.isMasterAdmin || permissionsAllow(model, operation, onRecord)) {
      return RecordAccess.allowed();
    }
    if (permissionsAllow(model, operation, reader.permissions)) {
      return RecordAccess.refused(RecordAccessRefusalReason.Private, {
        teamNames: owningTeamNames,
      });
    }
    return RecordAccess.refused(RecordAccessRefusalReason.Permission);
  };

  const tables = {};

  RECORD_ACCESS_TABLES[kind].forEach((tableName, index) => {
    const modelType = MODELS.get(tableName);

    if (!modelType) {
      data.unmodelled(tableName);
      return;
    }

    // The record's own table comes first; the rest are its parts.
    const isRecord = index === 0;
    const isOwner =
      modelType === spec.ownerUser || modelType === spec.ownerTeam;
    const hasRow = isRecord || rowsOfRecord(modelType).length > 0;
    const operations = isRecord
      ? [RecordAccessOperation.Update, RecordAccessOperation.Delete]
      : isOwner
        ? [RecordAccessOperation.Create, RecordAccessOperation.Delete]
        : [
            RecordAccessOperation.Create,
            RecordAccessOperation.Update,
            RecordAccessOperation.Delete,
          ];
    const model = new modelType();

    tables[tableName] = {};

    for (const operation of operations) {
      if (operation === RecordAccessOperation.Create || hasRow) {
        tables[tableName][operation] = verdict(model, operation);
      }
    }
  });

  return RecordAccess.toJSON({ kind, recordId, tables });
}
