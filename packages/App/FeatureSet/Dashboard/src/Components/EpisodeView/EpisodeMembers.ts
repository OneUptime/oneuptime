import Select from "Common/Types/BaseDatabase/Select";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisodeMember from "Common/Models/DatabaseModels/AlertEpisodeMember";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";

// How many members the overview previews before pointing at the full list.
export const EPISODE_MEMBERS_PREVIEW_LIMIT: number = 8;

/*
 * Which incidents (or alerts) an episode holds: its membership rows, one per
 * member. The member's own incidentEpisodeId / alertEpisodeId cannot say: an
 * incident can be in several episodes, and that column names only the latest
 * one it is still in (IncidentEpisodeMemberService keeps it so). An incident
 * added to episode A and then to B points at B, so a query on the column
 * would leave it out of A.
 */
export interface EpisodeMembership<TMembership extends BaseModel> {
  // IncidentEpisodeMember or AlertEpisodeMember.
  modelType: { new (): TMembership };
  // Its link to the episode.
  episodeIdField: keyof TMembership & string;
  // Its link to the incident or alert.
  memberIdField: keyof TMembership & string;
}

export const INCIDENT_EPISODE_MEMBERSHIP: EpisodeMembership<IncidentEpisodeMember> =
  {
    modelType: IncidentEpisodeMember,
    episodeIdField: "incidentEpisodeId",
    memberIdField: "incidentId",
  };

export const ALERT_EPISODE_MEMBERSHIP: EpisodeMembership<AlertEpisodeMember> = {
  modelType: AlertEpisodeMember,
  episodeIdField: "alertEpisodeId",
  memberIdField: "alertId",
};

export interface EpisodeMemberPill {
  name: string;
  color: Color;
}

// One row of the "Incidents / Alerts in this episode" card, model agnostic.
export interface EpisodeMemberRow {
  id: string;
  number?: string | undefined; // e.g. "INC-42" or "#42"
  title: string;
  state?: EpisodeMemberPill | undefined;
  severity?: EpisodeMemberPill | undefined;
  occurredAt?: Date | undefined; // declaredAt for incidents, createdAt for alerts
}

export const INCIDENT_EPISODE_MEMBER_SELECT: Select<Incident> = {
  _id: true,
  title: true,
  incidentNumber: true,
  incidentNumberWithPrefix: true,
  declaredAt: true,
  createdAt: true,
  currentIncidentState: {
    _id: true,
    name: true,
    color: true,
  },
  incidentSeverity: {
    _id: true,
    name: true,
    color: true,
  },
};

export const ALERT_EPISODE_MEMBER_SELECT: Select<Alert> = {
  _id: true,
  title: true,
  alertNumber: true,
  alertNumberWithPrefix: true,
  createdAt: true,
  currentAlertState: {
    _id: true,
    name: true,
    color: true,
  },
  alertSeverity: {
    _id: true,
    name: true,
    color: true,
  },
};

type GetNumberLabelFunction = (
  numberWithPrefix: string | undefined,
  number: number | undefined,
) => string | undefined;

const getNumberLabel: GetNumberLabelFunction = (
  numberWithPrefix: string | undefined,
  number: number | undefined,
): string | undefined => {
  if (numberWithPrefix) {
    return numberWithPrefix;
  }

  if (number !== undefined && number !== null) {
    return "#" + number;
  }

  return undefined;
};

type GetPillFunction = (
  relation: { name?: string | undefined; color?: Color | undefined } | null,
) => EpisodeMemberPill | undefined;

/*
 * A relation that is missing entirely shows nothing. One that exists but has
 * lost its name or color (a soft deleted state, say) still shows, with the
 * same "Unknown" / black fallbacks the episode details card uses.
 */
const getPill: GetPillFunction = (
  relation: { name?: string | undefined; color?: Color | undefined } | null,
): EpisodeMemberPill | undefined => {
  if (!relation) {
    return undefined;
  }

  return {
    name: relation.name || "Unknown",
    color: relation.color || Black,
  };
};

export function getIncidentEpisodeMemberRow(
  incident: Incident,
): EpisodeMemberRow {
  return {
    id: incident.id?.toString() || incident._id?.toString() || "",
    number: getNumberLabel(
      incident.incidentNumberWithPrefix,
      incident.incidentNumber,
    ),
    title: incident.title || "Untitled incident",
    state: getPill(incident.currentIncidentState || null),
    severity: getPill(incident.incidentSeverity || null),
    occurredAt: incident.declaredAt || incident.createdAt || undefined,
  };
}

export function getAlertEpisodeMemberRow(alert: Alert): EpisodeMemberRow {
  return {
    id: alert.id?.toString() || alert._id?.toString() || "",
    number: getNumberLabel(alert.alertNumberWithPrefix, alert.alertNumber),
    title: alert.title || "Untitled alert",
    state: getPill(alert.currentAlertState || null),
    severity: getPill(alert.alertSeverity || null),
    occurredAt: alert.createdAt || undefined,
  };
}
