export type ObjectID = string;

export interface BaseModel {
  id: ObjectID;
  _id?: ObjectID;
  createdAt?: string;
  updatedAt?: string;
}

export interface User extends BaseModel {
  email: string;
  name?: string;
  timezone?: string;
  isMasterAdmin?: boolean;
  profilePictureId?: ObjectID;
}

export interface Project extends BaseModel {
  name: string;
  slug?: string;
}

export interface IncidentState extends BaseModel {
  name: string;
  color?: string;
  isResolvedState?: boolean;
  isAcknowledgedState?: boolean;
}

export interface AlertState extends BaseModel {
  name: string;
  color?: string;
  isResolvedState?: boolean;
  isAcknowledgedState?: boolean;
}

export interface IncidentSeverity extends BaseModel {
  name: string;
  color?: string;
}

export interface MonitorStatus extends BaseModel {
  name: string;
  color?: string;
  isOperationalState?: boolean;
}

export interface Monitor extends BaseModel {
  name: string;
  description?: string;
  currentMonitorStatus?: MonitorStatus;
  lastPingAt?: string;
}

export interface Incident extends BaseModel {
  title: string;
  incidentNumber?: number;
  description?: string;
  currentIncidentState?: IncidentState;
  incidentSeverity?: IncidentSeverity;
  monitors?: Monitor[];
  labels?: Array<{ name: string; color?: string }>;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

export interface Alert extends BaseModel {
  title: string;
  description?: string;
  monitors?: Monitor[];
  currentAlertState?: AlertState;
}

export interface IncidentNote extends BaseModel {
  note: string;
  incidentId: ObjectID;
  createdByUserId?: ObjectID;
  createdByUser?: User;
}

export interface OnCallEscalationRuleUser {
  id: ObjectID;
  user?: User;
  label?: string;
  order?: number;
  onCallDutyPolicy?: OnCallDutyPolicy;
}

export interface OnCallEscalationRuleTeam {
  id: ObjectID;
  team?: {
    id: ObjectID;
    name: string;
  };
  label?: string;
  order?: number;
  onCallDutyPolicy?: OnCallDutyPolicy;
}

export interface OnCallEscalationRuleSchedule {
  id: ObjectID;
  onCallDutyPolicy?: OnCallDutyPolicy;
  label?: string;
  order?: number;
}

export interface OnCallDutyPolicy extends BaseModel {
  name: string;
  description?: string;
}

export interface TeamMember extends BaseModel {
  name: string;
  email: string;
}

export interface PaginationResult<T> {
  data: T[];
  count: number;
  skip: number;
  limit: number;
}
