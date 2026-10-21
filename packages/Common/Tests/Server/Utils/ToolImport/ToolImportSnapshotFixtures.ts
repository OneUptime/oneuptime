import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import DayOfWeek from "../../../../Types/Day/DayOfWeek";
import EventInterval from "../../../../Types/Events/EventInterval";
import { ToolImportNote } from "../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ImportedIncidentCustomField,
  ImportedIncidentRole,
  ImportedIncidentRoleKind,
  ImportedIncidentSeverity,
  ImportedIncidentState,
  ImportedIncidentStateKind,
  ImportedPerson,
  ImportedPolicy,
  ImportedRotation,
  ImportedSchedule,
  ImportedService,
  ImportedTeam,
  ToolImportSnapshot,
} from "../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../Types/ToolImport/ToolImportSource";
import {
  ToolImportAccess,
  ToolImportExistingRecord,
  ToolImportProjectState,
} from "../../../../Server/Utils/ToolImport/ToolImportPlanner";

/*
 * Snapshots, project states and access, built in code for the planner and
 * applier tests: what an adapter would have read, what a project already
 * has, and what the person may do.
 */

export function person(
  sourceId: string,
  overrides: Partial<ImportedPerson> = {},
): ImportedPerson {
  return {
    sourceId: sourceId,
    name: sourceId.toUpperCase(),
    email: `${sourceId}@example.com`,
    isActive: true,
    notes: [],
    ...overrides,
  };
}

export function team(
  sourceId: string,
  name: string,
  memberSourceIds: Array<string>,
): ImportedTeam {
  return {
    sourceId: sourceId,
    name: name,
    memberSourceIds: memberSourceIds,
    notes: [],
  };
}

export function rotation(
  key: string,
  participantSourceIds: Array<string>,
  overrides: Partial<ImportedRotation> = {},
): ImportedRotation {
  return {
    key: key,
    name: key,
    startsAt: "2026-01-05T09:00:00.000Z",
    intervalType: EventInterval.Week,
    intervalCount: 1,
    restriction: null,
    participantSourceIds: participantSourceIds,
    notes: [],
    ...overrides,
  };
}

export const BUSINESS_HOURS: ImportedRotation["restriction"] = {
  type: "Weekly",
  windows: [
    {
      startDay: DayOfWeek.Monday,
      startTime: "09:00",
      endDay: DayOfWeek.Friday,
      endTime: "17:00",
    },
  ],
};

export const AFTER_HOURS: ImportedRotation["restriction"] = {
  type: "Weekly",
  windows: [
    {
      startDay: DayOfWeek.Friday,
      startTime: "17:00",
      endDay: DayOfWeek.Monday,
      endTime: "09:00",
    },
  ],
};

export function schedule(
  sourceId: string,
  name: string,
  rotations: Array<ImportedRotation>,
  overrides: Partial<ImportedSchedule> = {},
): ImportedSchedule {
  return {
    sourceId: sourceId,
    name: name,
    timezone: "Europe/London",
    isEnabled: true,
    ownerTeamSourceIds: [],
    rotations: rotations,
    notes: [],
    ...overrides,
  };
}

export function policy(
  sourceId: string,
  name: string,
  levels: ImportedPolicy["levels"],
  overrides: Partial<ImportedPolicy> = {},
): ImportedPolicy {
  return {
    sourceId: sourceId,
    name: name,
    ownerTeamSourceIds: [],
    levels: levels,
    repeatTimes: 0,
    notes: [],
    ...overrides,
  };
}

export function level(data: {
  people?: Array<string>;
  teams?: Array<string>;
  schedules?: Array<string>;
  wait?: number;
}): ImportedPolicy["levels"][number] {
  return {
    escalateAfterMinutes: data.wait ?? 30,
    personSourceIds: data.people || [],
    teamSourceIds: data.teams || [],
    scheduleSourceIds: data.schedules || [],
  };
}

export function service(sourceId: string, name: string): ImportedService {
  return { sourceId: sourceId, name: name, ownerTeamSourceIds: [], notes: [] };
}

export function severity(
  sourceId: string,
  name: string,
  order: number,
): ImportedIncidentSeverity {
  return { sourceId: sourceId, name: name, order: order, notes: [] };
}

export function incidentState(
  sourceId: string,
  name: string,
  kind: ImportedIncidentStateKind,
  category: string,
): ImportedIncidentState {
  return {
    sourceId: sourceId,
    name: name,
    kind: kind,
    sourceCategory: category,
    order: 1,
    notes: [],
  };
}

export function role(
  sourceId: string,
  name: string,
  kind: ImportedIncidentRoleKind,
): ImportedIncidentRole {
  return { sourceId: sourceId, name: name, kind: kind, notes: [] };
}

export function customField(
  sourceId: string,
  name: string,
  fieldType: CustomFieldType | null,
  overrides: Partial<ImportedIncidentCustomField> = {},
): ImportedIncidentCustomField {
  return {
    sourceId: sourceId,
    name: name,
    fieldType: fieldType,
    options: [],
    isFromCatalog: false,
    notes: [],
    ...overrides,
  };
}

export function snapshot(
  overrides: Partial<ToolImportSnapshot> = {},
): ToolImportSnapshot {
  return {
    source: ToolImportSource.OpsGenie,
    readAt: "2026-10-08T12:00:00.000Z",
    accountName: "acme",
    people: [],
    teams: [],
    schedules: [],
    policies: [],
    services: [],
    incidentSeverities: [],
    incidentStates: [],
    incidentRoles: [],
    incidentCustomFields: [],
    notes: [],
    ...overrides,
  };
}

export function projectState(
  overrides: Partial<ToolImportProjectState> = {},
): ToolImportProjectState {
  return {
    memberUserIdsByEmail: new Map<string, string>(),
    existingByKind: new Map<
      ToolImportResourceKind,
      Array<ToolImportExistingRecord>
    >(),
    createdIncidentState: { id: "state-identified", name: "Identified" },
    resolvedIncidentState: { id: "state-resolved", name: "Resolved" },
    primaryIncidentRole: { id: "role-commander", name: "Incident Commander" },
    previousRecords: [],
    ...overrides,
  };
}

export function fullAccess(
  overrides: Partial<ToolImportAccess> = {},
): ToolImportAccess {
  const createRefusals: Map<ToolImportResourceKind, ToolImportNote | null> =
    new Map<ToolImportResourceKind, ToolImportNote | null>();

  for (const kind of Object.values(ToolImportResourceKind)) {
    createRefusals.set(kind, null);
  }

  return {
    createRefusals: createRefusals,
    inviteRefusal: null,
    inviteTeams: [{ id: "team-members", name: "Members" }],
    defaultInviteTeamId: "team-members",
    isLimitedToOneLevelPerPolicy: false,
    ...overrides,
  };
}
