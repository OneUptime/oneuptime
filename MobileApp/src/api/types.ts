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

export interface NamedEntity {
  _id: string;
  name: string;
}

export interface NamedEntityWithColor {
  _id: string;
  name: string;
  color: ColorField;
}

export interface ProjectItem {
  _id: string;
  name: string;
  slug: string;
}

export interface IncidentItem {
  _id: string;
  title: string;
  incidentNumber: number;
  incidentNumberWithPrefix: string;
  description: string;
  rootCause?: string;
  declaredAt: string;
  createdAt: string;
  currentIncidentState: NamedEntityWithColor;
  incidentSeverity: NamedEntityWithColor;
  monitors: NamedEntity[];
  projectId?: string;
}

export interface AlertItem {
  _id: string;
  title: string;
  alertNumber: number;
  alertNumberWithPrefix: string;
  description: string;
  rootCause?: string;
  createdAt: string;
  currentAlertState: NamedEntityWithColor;
  alertSeverity: NamedEntityWithColor;
  monitor: NamedEntity | null;
  projectId?: string;
}

export interface IncidentState {
  _id: string;
  name: string;
  color: ColorField;
  isResolvedState: boolean;
  isAcknowledgedState: boolean;
  isCreatedState: boolean;
  order: number;
}

export interface AlertState {
  _id: string;
  name: string;
  color: ColorField;
  isResolvedState: boolean;
  isAcknowledgedState: boolean;
  isCreatedState: boolean;
  order: number;
}

export interface StateTimelineItem {
  _id: string;
  createdAt: string;
  incidentState?: NamedEntityWithColor;
  alertState?: NamedEntityWithColor;
}

export interface IncidentEpisodeItem {
  _id: string;
  title: string;
  episodeNumber: number;
  episodeNumberWithPrefix: string;
  description: string;
  rootCause?: string;
  createdAt: string;
  declaredAt: string;
  incidentCount: number;
  currentIncidentState: NamedEntityWithColor;
  incidentSeverity: NamedEntityWithColor;
  projectId?: string;
}

export interface AlertEpisodeItem {
  _id: string;
  title: string;
  episodeNumber: number;
  episodeNumberWithPrefix: string;
  description: string;
  rootCause?: string;
  createdAt: string;
  alertCount: number;
  currentAlertState: NamedEntityWithColor;
  alertSeverity: NamedEntityWithColor;
  projectId?: string;
}

export interface NoteItem {
  _id: string;
  note: string;
  createdAt: string;
  createdByUser: { _id: string; name: string } | null;
}

export interface FeedItem {
  _id: string;
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
