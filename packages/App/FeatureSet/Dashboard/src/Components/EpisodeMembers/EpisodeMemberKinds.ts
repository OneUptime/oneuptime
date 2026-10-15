import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "Common/Models/DatabaseModels/AlertEpisodeMember";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import {
  ALERT_EPISODE_ID_KEY,
  ALERT_IDS_KEY,
  ALERT_IDS_TO_ADD_KEY,
  INCIDENT_EPISODE_ID_KEY,
  INCIDENT_IDS_KEY,
  INCIDENT_IDS_TO_ADD_KEY,
} from "Common/Types/Episode/EpisodeMembersAdd";
import PageMap from "../../Utils/PageMap";

/*
 * Adding incidents or alerts to an episode, by hand (EpisodeMembersAdd):
 * everything that differs between the two is here, so the dialogs, the
 * bulk actions and the requests are written once.
 *
 * The words are English; they are translated where they are shown, inside
 * whole sentences.
 */

export enum EpisodeMemberKind {
  Alert = "alert",
  Incident = "incident",
}

export interface EpisodeMemberKindConfig {
  kind: EpisodeMemberKind;

  // What is added: Alert or Incident.
  recordModelType: { new (): BaseModel };
  // What it is added to: AlertEpisode or IncidentEpisode.
  episodeModelType: { new (): BaseModel };
  // The row that says it is in: AlertEpisodeMember or IncidentEpisodeMember.
  membershipModelType: { new (): BaseModel };
  // The severities both share: AlertSeverity or IncidentSeverity.
  severityModelType: { new (): BaseModel };

  /*
   * The add request's body: { <episodeIdKey>: id, <idsKey>: [ids] } (its
   * route is written out where it is called: EpisodeMembersApi).
   */
  episodeIdKey: string;
  idsKey: string;
  // A new episode's create carries the ids as miscDataProps[<idsToAddKey>].
  idsToAddKey: string;

  // The record's columns.
  recordNumberField: string;
  recordNumberWithPrefixField: string;
  recordStateField: string;
  recordSeverityField: string;
  recordSeverityIdField: string;
  // The latest episode the record is in (see EpisodeMembershipReference).
  recordEpisodeIdField: string;
  // Newest first by this date.
  recordDateField: string;

  // The episode's columns.
  episodeStateField: string;
  episodeSeverityField: string;
  episodeSeverityIdField: string;
  episodeCountField: string;

  // The membership's columns.
  membershipEpisodeIdField: string;
  membershipRecordIdField: string;

  // "alert" / "alerts" in a sentence; "Alert" / "Alerts" in a title.
  singular: string;
  plural: string;
  singularTitle: string;
  pluralTitle: string;

  recordViewPage: PageMap;
  episodeViewPage: PageMap;
}

export const ALERT_EPISODE_MEMBER_KIND: EpisodeMemberKindConfig = {
  kind: EpisodeMemberKind.Alert,
  recordModelType: Alert,
  episodeModelType: AlertEpisode,
  membershipModelType: AlertEpisodeMember,
  severityModelType: AlertSeverity,
  episodeIdKey: ALERT_EPISODE_ID_KEY,
  idsKey: ALERT_IDS_KEY,
  idsToAddKey: ALERT_IDS_TO_ADD_KEY,
  recordNumberField: "alertNumber",
  recordNumberWithPrefixField: "alertNumberWithPrefix",
  recordStateField: "currentAlertState",
  recordSeverityField: "alertSeverity",
  recordSeverityIdField: "alertSeverityId",
  recordEpisodeIdField: "alertEpisodeId",
  recordDateField: "createdAt",
  episodeStateField: "currentAlertState",
  episodeSeverityField: "alertSeverity",
  episodeSeverityIdField: "alertSeverityId",
  episodeCountField: "alertCount",
  membershipEpisodeIdField: "alertEpisodeId",
  membershipRecordIdField: "alertId",
  singular: "alert",
  plural: "alerts",
  singularTitle: "Alert",
  pluralTitle: "Alerts",
  recordViewPage: PageMap.ALERT_VIEW,
  episodeViewPage: PageMap.ALERT_EPISODE_VIEW,
};

export const INCIDENT_EPISODE_MEMBER_KIND: EpisodeMemberKindConfig = {
  kind: EpisodeMemberKind.Incident,
  recordModelType: Incident,
  episodeModelType: IncidentEpisode,
  membershipModelType: IncidentEpisodeMember,
  severityModelType: IncidentSeverity,
  episodeIdKey: INCIDENT_EPISODE_ID_KEY,
  idsKey: INCIDENT_IDS_KEY,
  idsToAddKey: INCIDENT_IDS_TO_ADD_KEY,
  recordNumberField: "incidentNumber",
  recordNumberWithPrefixField: "incidentNumberWithPrefix",
  recordStateField: "currentIncidentState",
  recordSeverityField: "incidentSeverity",
  recordSeverityIdField: "incidentSeverityId",
  recordEpisodeIdField: "incidentEpisodeId",
  recordDateField: "declaredAt",
  episodeStateField: "currentIncidentState",
  episodeSeverityField: "incidentSeverity",
  episodeSeverityIdField: "incidentSeverityId",
  episodeCountField: "incidentCount",
  membershipEpisodeIdField: "incidentEpisodeId",
  membershipRecordIdField: "incidentId",
  singular: "incident",
  plural: "incidents",
  singularTitle: "Incident",
  pluralTitle: "Incidents",
  recordViewPage: PageMap.INCIDENT_VIEW,
  episodeViewPage: PageMap.INCIDENT_EPISODE_VIEW,
};
