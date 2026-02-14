import type AlertModel from "Common/Models/DatabaseModels/Alert.js";
import type AlertEpisodeModel from "Common/Models/DatabaseModels/AlertEpisode.js";
import type AlertFeedModel from "Common/Models/DatabaseModels/AlertFeed.js";
import type AlertSeverityModel from "Common/Models/DatabaseModels/AlertSeverity.js";
import type AlertStateModelClass from "Common/Models/DatabaseModels/AlertState.js";
import type AlertStateTimelineModel from "Common/Models/DatabaseModels/AlertStateTimeline.js";
import type IncidentModel from "Common/Models/DatabaseModels/Incident.js";
import type IncidentEpisodeModel from "Common/Models/DatabaseModels/IncidentEpisode.js";
import type IncidentEpisodeInternalNoteModel from "Common/Models/DatabaseModels/IncidentEpisodeInternalNote.js";
import type IncidentFeedModel from "Common/Models/DatabaseModels/IncidentFeed.js";
import type IncidentSeverityModel from "Common/Models/DatabaseModels/IncidentSeverity.js";
import type IncidentStateModelClass from "Common/Models/DatabaseModels/IncidentState.js";
import type IncidentStateTimelineModel from "Common/Models/DatabaseModels/IncidentStateTimeline.js";
import type MonitorModel from "Common/Models/DatabaseModels/Monitor.js";
import type ProjectModel from "Common/Models/DatabaseModels/Project.js";
import type UserModel from "Common/Models/DatabaseModels/User.js";

type Alert = InstanceType<typeof AlertModel>;
type AlertEpisode = InstanceType<typeof AlertEpisodeModel>;
type AlertFeed = InstanceType<typeof AlertFeedModel>;
type AlertSeverity = InstanceType<typeof AlertSeverityModel>;
type AlertStateModel = InstanceType<typeof AlertStateModelClass>;
type AlertStateTimeline = InstanceType<typeof AlertStateTimelineModel>;
type Incident = InstanceType<typeof IncidentModel>;
type IncidentEpisode = InstanceType<typeof IncidentEpisodeModel>;
type IncidentEpisodeInternalNote = InstanceType<
  typeof IncidentEpisodeInternalNoteModel
>;
type IncidentFeed = InstanceType<typeof IncidentFeedModel>;
type IncidentSeverity = InstanceType<typeof IncidentSeverityModel>;
type IncidentStateModel = InstanceType<typeof IncidentStateModelClass>;
type IncidentStateTimeline = InstanceType<typeof IncidentStateTimelineModel>;
type Monitor = InstanceType<typeof MonitorModel>;
type Project = InstanceType<typeof ProjectModel>;
type User = InstanceType<typeof UserModel>;

type RequiredModelFields<T, K extends keyof T> = {
  [P in K]-?: NonNullable<T[P]>;
};

export interface ListResponse<T> {
  data: T[];
  count: number;
  skip: number;
  limit: number;
}

export interface ColorField {
  r: number;
  g: number;
  b: number;
}

type NamedEntityFromCommon = RequiredModelFields<Project, "_id" | "name">;

export type NamedEntity = NamedEntityFromCommon;

type NamedEntityWithColorFromCommon = RequiredModelFields<
  IncidentStateModel,
  "_id" | "name"
>;

export interface NamedEntityWithColor extends NamedEntityWithColorFromCommon {
  color: ColorField;
}

export type ProjectItem = RequiredModelFields<Project, "_id" | "name" | "slug">;

type IncidentItemFromCommon = RequiredModelFields<
  Incident,
  | "_id"
  | "title"
  | "incidentNumber"
  | "incidentNumberWithPrefix"
  | "description"
  | "declaredAt"
  | "createdAt"
>;

export interface IncidentItem
  extends Omit<
    IncidentItemFromCommon,
    "declaredAt" | "createdAt" | "currentIncidentState" | "incidentSeverity" | "monitors" | "projectId"
  > {
  rootCause?: string;
  declaredAt: string;
  createdAt: string;
  currentIncidentState: NamedEntityWithColor;
  incidentSeverity: NamedEntityWithColor &
    RequiredModelFields<IncidentSeverity, "_id" | "name">;
  monitors: Array<NamedEntity & RequiredModelFields<Monitor, "_id" | "name">>;
  projectId?: string;
}

type AlertItemFromCommon = RequiredModelFields<
  Alert,
  | "_id"
  | "title"
  | "alertNumber"
  | "alertNumberWithPrefix"
  | "description"
  | "createdAt"
>;

export interface AlertItem
  extends Omit<
    AlertItemFromCommon,
    "createdAt" | "currentAlertState" | "alertSeverity" | "monitor" | "projectId"
  > {
  rootCause?: string;
  createdAt: string;
  currentAlertState: NamedEntityWithColor;
  alertSeverity: NamedEntityWithColor &
    RequiredModelFields<AlertSeverity, "_id" | "name">;
  monitor: NamedEntity | null;
  projectId?: string;
}

export interface IncidentState
  extends RequiredModelFields<
    IncidentStateModel,
    "_id" | "name" | "isResolvedState" | "isAcknowledgedState" | "isCreatedState" | "order"
  > {
  color: ColorField;
}

export interface AlertState
  extends RequiredModelFields<
    AlertStateModel,
    "_id" | "name" | "isResolvedState" | "isAcknowledgedState" | "isCreatedState" | "order"
  > {
  color: ColorField;
}

type IncidentStateTimelineFromCommon = RequiredModelFields<
  IncidentStateTimeline,
  "_id" | "createdAt"
>;

export interface StateTimelineItem
  extends Omit<IncidentStateTimelineFromCommon, "createdAt" | "incidentState"> {
  createdAt: string;
  incidentState?: NamedEntityWithColor;
  alertState?: NamedEntityWithColor &
    RequiredModelFields<AlertStateTimeline, "_id">;
}

type IncidentEpisodeItemFromCommon = RequiredModelFields<
  IncidentEpisode,
  | "_id"
  | "title"
  | "episodeNumber"
  | "episodeNumberWithPrefix"
  | "description"
  | "createdAt"
  | "declaredAt"
  | "incidentCount"
>;

export interface IncidentEpisodeItem
  extends Omit<
    IncidentEpisodeItemFromCommon,
    "createdAt" | "declaredAt" | "currentIncidentState" | "incidentSeverity" | "projectId"
  > {
  rootCause?: string;
  createdAt: string;
  declaredAt: string;
  incidentCount: number;
  currentIncidentState: NamedEntityWithColor;
  incidentSeverity: NamedEntityWithColor &
    RequiredModelFields<IncidentSeverity, "_id" | "name">;
  projectId?: string;
}

type AlertEpisodeItemFromCommon = RequiredModelFields<
  AlertEpisode,
  | "_id"
  | "title"
  | "episodeNumber"
  | "episodeNumberWithPrefix"
  | "description"
  | "createdAt"
  | "alertCount"
>;

export interface AlertEpisodeItem
  extends Omit<
    AlertEpisodeItemFromCommon,
    "createdAt" | "currentAlertState" | "alertSeverity" | "projectId"
  > {
  rootCause?: string;
  createdAt: string;
  alertCount: number;
  currentAlertState: NamedEntityWithColor;
  alertSeverity: NamedEntityWithColor &
    RequiredModelFields<AlertSeverity, "_id" | "name">;
  projectId?: string;
}

type NoteItemFromCommon = RequiredModelFields<
  IncidentEpisodeInternalNote,
  "_id" | "note" | "createdAt"
>;

export interface NoteItem extends Omit<NoteItemFromCommon, "createdAt" | "createdByUser"> {
  createdAt: string;
  createdByUser:
    | (RequiredModelFields<User, "_id" | "name"> & {
        _id: string;
        name: string;
      })
    | null;
}

type FeedItemFromCommon = RequiredModelFields<AlertFeed | IncidentFeed, "_id" | "feedInfoInMarkdown" | "createdAt">;

export interface FeedItem extends Omit<FeedItemFromCommon, "createdAt" | "displayColor" | "postedAt"> {
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string;
  displayColor: ColorField;
  postedAt?: string;
  createdAt: string;
}

export interface WithProject<T> {
  item: T;
  projectId: string;
  projectName: string;
}

export type ProjectIncidentItem = WithProject<IncidentItem>;
export type ProjectAlertItem = WithProject<AlertItem>;
export type ProjectIncidentEpisodeItem = WithProject<IncidentEpisodeItem>;
export type ProjectAlertEpisodeItem = WithProject<AlertEpisodeItem>;
