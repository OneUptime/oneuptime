import { create, getList } from "@/api/modelApi";
import { includes, objectId } from "@/api/serialization";
import { Incident, IncidentNote, IncidentState, PaginationResult } from "@/types/models";
import { ensureId, ensureListIds } from "@/utils/normalizers";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";

const INCIDENT_PATH = "/incident";
const INCIDENT_STATE_PATH = "/incident-state";
const INCIDENT_STATE_TIMELINE_PATH = "/incident-state-timeline";
const INCIDENT_PUBLIC_NOTE_PATH = "/incident-public-note";

export const fetchIncidentStates = async (projectId: string): Promise<IncidentState[]> => {
  const response = await getList<IncidentState>({
    path: INCIDENT_STATE_PATH,
    query: {
      projectId: objectId(projectId),
    },
    select: {
      name: true,
      color: true,
      isResolvedState: true,
      isAcknowledgedState: true,
    },
    sort: {
      order: {
        _type: "Ascending",
      },
    },
    limit: 100,
    skip: 0,
  });

  return ensureListIds(response.data) as IncidentState[];
};

export const fetchActiveIncidents = async (
  projectId: string,
  unresolvedStateIds: string[],
): Promise<PaginationResult<Incident>> => {
  const response = await getList<Incident>({
    path: INCIDENT_PATH,
    query: {
  projectId: new ObjectID(projectId),
  currentIncidentStateId: new Includes(unresolvedStateIds),
    },
    select: {
      title: true,
      description: true,
      incidentNumber: true,
      currentIncidentState: {
        name: true,
        color: true,
      },
      incidentSeverity: {
        name: true,
        color: true,
      },
      monitors: {
        name: true,
        _id: true,
        currentMonitorStatus: {
          name: true,
          color: true,
        },
      },
      labels: {
        name: true,
        color: true,
      },
      createdAt: true,
    },
    sort: {
      createdAt: {
        _type: "Descending",
      },
    },
    limit: 25,
    skip: 0,
  });

  return {
    ...response,
  data: ensureListIds(response.data) as Incident[],
  };
};

export const acknowledgeIncident = async (params: {
  projectId: string;
  incidentId: string;
  acknowledgedStateId: string;
}): Promise<void> => {
  const { projectId, incidentId, acknowledgedStateId } = params;

  await create({
    path: INCIDENT_STATE_TIMELINE_PATH,
    data: {
  projectId: new ObjectID(projectId),
  incidentId: new ObjectID(incidentId),
  incidentStateId: new ObjectID(acknowledgedStateId),
    },
  });
};

export const resolveIncident = async (params: {
  projectId: string;
  incidentId: string;
  resolvedStateId: string;
}): Promise<void> => {
  const { projectId, incidentId, resolvedStateId } = params;

  await create({
    path: INCIDENT_STATE_TIMELINE_PATH,
    data: {
  projectId: new ObjectID(projectId),
  incidentId: new ObjectID(incidentId),
  incidentStateId: new ObjectID(resolvedStateId),
    },
  });
};

export const addIncidentNote = async (params: {
  projectId: string;
  incidentId: string;
  note: string;
}): Promise<IncidentNote> => {
  const { projectId, incidentId, note } = params;

  const response = await create<IncidentNote>({
    path: INCIDENT_PUBLIC_NOTE_PATH,
    data: {
  projectId: new ObjectID(projectId),
  incidentId: new ObjectID(incidentId),
      note,
    },
  });

  return ensureId(response) as IncidentNote;
};

export const fetchIncidentNotes = async (
  projectId: string,
  incidentId: string,
): Promise<PaginationResult<IncidentNote>> => {
  const response = await getList<IncidentNote>({
    path: INCIDENT_PUBLIC_NOTE_PATH,
    query: {
  projectId: new ObjectID(projectId),
  incidentId: new ObjectID(incidentId),
    },
    select: {
      note: true,
      createdAt: true,
      createdByUser: {
        name: true,
        email: true,
      },
    },
    sort: {
      createdAt: {
        _type: "Descending",
      },
    },
    limit: 50,
    skip: 0,
  });

  return {
    ...response,
    data: ensureListIds(response.data) as IncidentNote[],
  };
};
