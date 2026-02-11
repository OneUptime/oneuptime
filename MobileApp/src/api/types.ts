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
  declaredAt: string;
  createdAt: string;
  currentIncidentState: NamedEntityWithColor;
  incidentSeverity: NamedEntityWithColor;
  monitors: NamedEntity[];
}

export interface AlertItem {
  _id: string;
  title: string;
  alertNumber: number;
  alertNumberWithPrefix: string;
  description: string;
  createdAt: string;
  currentAlertState: NamedEntityWithColor;
  alertSeverity: NamedEntityWithColor;
  monitor: NamedEntity | null;
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
  createdAt: string;
  declaredAt: string;
  incidentCount: number;
  currentIncidentState: NamedEntityWithColor;
  incidentSeverity: NamedEntityWithColor;
}

export interface AlertEpisodeItem {
  _id: string;
  title: string;
  episodeNumber: number;
  episodeNumberWithPrefix: string;
  description: string;
  createdAt: string;
  alertCount: number;
  currentAlertState: NamedEntityWithColor;
  alertSeverity: NamedEntityWithColor;
}

export interface NoteItem {
  _id: string;
  note: string;
  createdAt: string;
  createdByUser: { _id: string; name: string } | null;
}
