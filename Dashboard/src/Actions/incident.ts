import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/incident';
import ErrorPayload from 'CommonUI/src/payload-types/error';
import PositiveNumber from 'Common/Types/PositiveNumber';
//Array of Incidents

export const projectIncidentsRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.PROJECT_INCIDENTS_REQUEST,
        payload: promise,
    };
};

export const projectIncidentsError: Function = (error: ErrorPayload): void => {
    return {
        type: types.PROJECT_INCIDENTS_FAILED,
        payload: error,
    };
};

export const projectIncidentsSuccess: Function = (
    incidents: $TSFixMe
): void => {
    return {
        type: types.PROJECT_INCIDENTS_SUCCESS,
        payload: incidents,
    };
};

export const resetProjectIncidents: Function = (): void => {
    return {
        type: types.PROJECT_INCIDENTS_RESET,
    };
};

// Gets project Incidents
export function getProjectIncidents(
    projectId: ObjectID,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function (dispatch: Dispatch): void {
        let promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = BackendAPI.get(
                `incident/${projectId}/incident?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = BackendAPI.get(`incident/${projectId}/incident`);
        }
        dispatch(projectIncidentsRequest(promise));

        promise.then(
            (incidents): void => {
                const data: $TSFixMe = incidents.data;
                data.projectId = projectId;
                dispatch(projectIncidentsSuccess(data));
            },
            (error): void => {
                dispatch(projectIncidentsError(error));
            }
        );
    };
}

//get all icident for a project belonging to a component
export function getProjectComponentIncidents(
    projectId: ObjectID,
    componentId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
): void {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function (dispatch: Dispatch): void {
        let promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = BackendAPI.get(
                `incident/${projectId}/incidents/${componentId}?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = BackendAPI.get(
                `incident/${projectId}/incidents/${componentId}`
            );
        }
        dispatch(projectIncidentsRequest(promise));

        promise.then(
            (incidents): void => {
                const data: $TSFixMe = incidents.data;

                data.count = incidents.data.data.count;

                data.data = incidents.data.data.incidents;
                data.projectId = projectId;
                dispatch(projectIncidentsSuccess(data));
            },
            (error): void => {
                dispatch(projectIncidentsError(error));
            }
        );
    };
}

// SubProjects Incidents

export const incidentsRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.INCIDENTS_REQUEST,
        payload: promise,
    };
};

export const incidentsError: Function = (error: ErrorPayload): void => {
    return {
        type: types.INCIDENTS_FAILED,
        payload: error,
    };
};

export const incidentsSuccess: Function = (incidents: $TSFixMe): void => {
    return {
        type: types.INCIDENTS_SUCCESS,
        payload: incidents,
    };
};

export const resetIncidents: Function = (): void => {
    return {
        type: types.INCIDENTS_RESET,
    };
};

// Gets project Incidents
export const getIncidents: Function = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(`incident/${projectId}`);
        dispatch(incidentsRequest(promise));

        promise.then(
            (incidents): void => {
                dispatch(incidentsSuccess(incidents.data));
            },
            (error): void => {
                dispatch(incidentsError(error));
            }
        );
    };
};
//get component incidents
export function getComponentIncidents(
    projectId: ObjectID,
    componentId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `incident/${projectId}/${componentId}/incidents`
        );
        dispatch(incidentsRequest(promise));

        promise.then(
            (incidents): void => {
                dispatch(incidentsSuccess(incidents.data));
            },
            (error): void => {
                dispatch(incidentsError(error));
            }
        );
    };
}

// Create a new incident

export const createIncidentRequest: Function = (projectId: ObjectID): void => {
    return {
        type: types.CREATE_INCIDENT_REQUEST,
        payload: projectId,
    };
};

export const createIncidentError: Function = (error: ErrorPayload): void => {
    return {
        type: types.CREATE_INCIDENT_FAILED,
        payload: error,
    };
};

export const createIncidentSuccess: Function = (incident: $TSFixMe): void => {
    return {
        type: types.CREATE_INCIDENT_SUCCESS,
        payload: incident,
    };
};

export const resetCreateIncident: Function = (): void => {
    return {
        type: types.CREATE_INCIDENT_RESET,
    };
};

export const createIncidentReset: Function = (): void => {
    return function (dispatch: Dispatch): void {
        dispatch(resetCreateIncident());
    };
};

// Calls the API to create new incident.
export function createNewIncident(
    projectId: ObjectID,
    monitors: $TSFixMe,
    incidentType: $TSFixMe,
    title: $TSFixMe,
    description: $TSFixMe,
    incidentPriority: $TSFixMe,
    customFields: $TSFixMe
) {
    return async function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `incident/${projectId}/create-incident`,
            {
                monitors,
                projectId,
                incidentType,
                title,
                description,
                incidentPriority,
                customFields,
            }
        );

        dispatch(createIncidentRequest(projectId));

        promise.then(
            (createIncident): void => {
                dispatch({
                    type: 'ADD_NEW_INCIDENT_TO_UNRESOLVED',

                    payload: createIncident.data,
                });
                dispatch({
                    type: 'ADD_NEW_INCIDENT_TO_MONITORS',

                    payload: createIncident.data,
                });

                dispatch(createIncidentSuccess(createIncident.data));
            },
            (error): void => {
                dispatch(createIncidentError(error));
            }
        );

        return promise;
    };
}

// incident portion

export const incidentRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.INCIDENT_REQUEST,
        payload: promise,
    };
};

export const incidentError: Function = (error: ErrorPayload): void => {
    return {
        type: types.INCIDENT_FAILED,
        payload: error,
    };
};

export const incidentSuccess: Function = (incident: $TSFixMe): void => {
    return {
        type: types.INCIDENT_SUCCESS,
        payload: incident,
    };
};

export const resetIncident: Function = (): void => {
    return {
        type: types.INCIDENT_RESET,
    };
};

export const acknowledgeIncidentRequest: Function = (
    promise: $TSFixMe
): void => {
    return {
        type: types.ACKNOWLEDGE_INCIDENT_REQUEST,
        payload: promise,
    };
};

export const resolveIncidentRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.RESOLVE_INCIDENT_REQUEST,
        payload: promise,
    };
};

export const acknowledgeIncidentSuccess: Function = (
    incident: $TSFixMe
): void => {
    return {
        type: types.ACKNOWLEDGE_INCIDENT_SUCCESS,
        payload: incident,
    };
};

export const resolveIncidentSuccess: Function = (incident: $TSFixMe): void => {
    return {
        type: types.RESOLVE_INCIDENT_SUCCESS,
        payload: incident,
    };
};

// Calls the API to get the incident to show
export const getIncident: Function = (
    projectId: ObjectID,
    incidentSlug: $TSFixMe
): void => {
    //This fucntion will switch to incidentSlug of the params beig passed.
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.get(
            `incident/${projectId}/incident/${incidentSlug}`
        );
        dispatch(incidentRequest(promise));

        promise.then(
            (incident): void => {
                dispatch(incidentSuccess(incident.data));
            },
            (error): void => {
                dispatch(incidentError(error));
            }
        );

        return promise;
    };
};

export const addIncident: Function = (incident: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch(incidentSuccess(incident));
    };
};
// Calls the API to get the incident timeline
export function getIncidentTimeline(
    projectId: ObjectID,
    incidentId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.get(
            `incident/${projectId}/timeline/${incidentId}?skip=${skip}&limit=${limit}`
        );
        dispatch(incidentTimelineRequest(promise));

        promise.then(
            (timeline): void => {
                dispatch(incidentTimelineSuccess(timeline.data));
            },
            (error): void => {
                dispatch(incidentTimelineError(error));
            }
        );
    };
}

export const incidentTimelineRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.INCIDENT_TIMELINE_REQUEST,
        payload: promise,
    };
};

export const incidentTimelineSuccess: Function = (timeline: $TSFixMe): void => {
    return {
        type: types.INCIDENT_TIMELINE_SUCCESS,
        payload: timeline,
    };
};

export const incidentTimelineError: Function = (error: ErrorPayload): void => {
    return {
        type: types.INCIDENT_TIMELINE_FAILED,
        payload: error,
    };
};

export const setActiveIncident: Function = (incidentId: $TSFixMe): void => {
    return {
        type: 'SET_ACTIVE_INCIDENT',
        payload: incidentId,
    };
};

// calls the api to post acknowledgement data to the database
export function acknowledgeIncident(
    projectId: ObjectID,
    incidentId: $TSFixMe,
    userId: ObjectID,
    multiple: $TSFixMe
) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function (dispatch: Dispatch): void {
        let promise = null;
        const data: $TSFixMe = {
            decoded: userId,
            projectId,
            incidentId,
        };

        dispatch(setActiveIncident(incidentId));

        promise = BackendAPI.post(
            `incident/${projectId}/acknowledge/${incidentId}`,
            data
        );
        if (multiple) {
            dispatch(
                acknowledgeIncidentRequest({
                    multiple: true,
                    promise: promise,
                })
            );
        } else {
            dispatch(
                acknowledgeIncidentRequest({
                    multiple: false,
                    promise: promise,
                })
            );
        }

        promise.then(
            (result): void => {
                if (multiple) {
                    dispatch(
                        acknowledgeIncidentSuccess({
                            multiple: true,

                            data: result.data.incident,
                        })
                    );
                } else {
                    dispatch(
                        acknowledgeIncidentSuccess({
                            multiple: false,

                            data: result.data.incident,
                        })
                    );
                }
                dispatch({
                    type: 'ACKNOWLEDGE_INCIDENT_SUCCESS',

                    payload: result.data.incident,
                });
                dispatch(
                    fetchIncidentMessagesSuccess({
                        incidentId: result.data.incident.idNumber, // The incidentID needed is no longer objectID from DB but incident serial ID e.g 1

                        incidentMessages: result.data.data,

                        count: result.data.data.length,

                        type: result.data.type,

                        incidentSlug: result.data.incident.incidentSlug,
                    })
                );
            },
            (error): void => {
                if (multiple) {
                    dispatch(
                        incidentError({
                            multiple: true,
                            error: error,
                        })
                    );
                } else {
                    dispatch(
                        incidentError({
                            multiple: false,
                            error: error,
                        })
                    );
                }
            }
        );
        return promise;
    };
}

// calls the api to store the resolve status to the database
export function resolveIncident(
    projectId: ObjectID,
    incidentId: $TSFixMe,
    userId: ObjectID,
    multiple: $TSFixMe
) {
    //This function will switch to incidentId of the params being passed.
    return function (dispatch: Dispatch): void {
        let promise = null;
        const data: $TSFixMe = {
            decoded: userId,
            projectId,
            incidentId,
        };

        dispatch(setActiveIncident(incidentId));

        promise = BackendAPI.post(
            `incident/${projectId}/resolve/${incidentId}`,
            data
        );
        if (multiple) {
            dispatch(
                resolveIncidentRequest({
                    multiple: true,
                    promise: promise,
                })
            );
        } else {
            dispatch(
                resolveIncidentRequest({
                    multiple: false,
                    promise: promise,
                })
            );
        }

        promise.then(
            (result): void => {
                if (multiple) {
                    dispatch(
                        resolveIncidentSuccess({
                            multiple: true,

                            data: result.data.incident,
                        })
                    );
                } else {
                    dispatch(
                        resolveIncidentSuccess({
                            multiple: false,

                            data: result.data.incident,
                        })
                    );
                }
                dispatch({
                    type: 'RESOLVE_INCIDENT_SUCCESS',

                    payload: result.data.incident,
                });
                dispatch(
                    fetchIncidentMessagesSuccess({
                        incidentId: result.data.incident.idNumber, // The incidentID needed is no longer objectID from DB but incident serial ID e.g 1

                        incidentMessages: result.data.data,

                        count: result.data.data.length,

                        type: result.data.type,

                        incidentSlug: result.data.incident.incidentSlug,
                    })
                );
            },
            (error): void => {
                if (multiple) {
                    dispatch(
                        incidentError({
                            multiple: true,
                            error: error,
                        })
                    );
                } else {
                    dispatch(
                        incidentError({
                            multiple: false,
                            error: error,
                        })
                    );
                }
            }
        );
        return promise;
    };
}

export const closeIncidentRequest: Function = (incidentId: $TSFixMe): void => {
    return {
        type: types.CLOSE_INCIDENT_REQUEST,
        payload: incidentId,
    };
};

export const closeIncidentError: Function = (error: ErrorPayload): void => {
    return {
        type: types.CLOSE_INCIDENT_FAILED,
        payload: error,
    };
};

export const closeIncidentSuccess: Function = (incident: $TSFixMe): void => {
    return {
        type: types.CLOSE_INCIDENT_SUCCESS,
        payload: incident,
    };
};

export const closeIncident: Function = (
    projectId: ObjectID,
    incidentId: $TSFixMe
): void => {
    //This function will switch to incidentId of the params beig passed.
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(
            `incident/${projectId}/close/${incidentId}`,
            {}
        );
        dispatch(closeIncidentRequest(incidentId));

        promise.then(
            (incident): void => {
                dispatch(closeIncidentSuccess(incident.data));
            },
            (error): void => {
                dispatch(closeIncidentError(error));
            }
        );
    };
};

// Unresolved Incidents Section

export const UnresolvedIncidentsRequest: Function = (
    promise: $TSFixMe
): void => {
    return {
        type: types.UNRESOLVED_INCIDENTS_REQUEST,
        payload: promise,
    };
};

export const UnresolvedIncidentsError: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.UNRESOLVED_INCIDENTS_FAILED,
        payload: error,
    };
};

export const UnresolvedIncidentsSuccess: Function = (
    incidents: $TSFixMe
): void => {
    return {
        type: types.UNRESOLVED_INCIDENTS_SUCCESS,
        payload: incidents,
    };
};

export const resetUnresolvedIncidents: Function = (): void => {
    return {
        type: types.UNRESOLVED_INCIDENTS_RESET,
    };
};

// Calls the API to register a user.
export const fetchUnresolvedIncidents: Function = (
    projectId: ObjectID,
    isHome = false
): void => {
    //This fucntion will switch to incidentId of the params beig passed.
    return function (dispatch: Dispatch): void {
        let promise = null;

        promise = BackendAPI.get(
            `incident/${projectId}/unresolvedincidents?isHome=${isHome}`
        );

        dispatch(UnresolvedIncidentsRequest(promise));

        promise.then(
            (incidents): void => {
                dispatch(UnresolvedIncidentsSuccess(incidents.data));
            },
            (error): void => {
                dispatch(UnresolvedIncidentsError(error));
            }
        );
    };
};

// Calls the API to delete incidents after deleting the project
export const deleteProjectIncidents: Function = (projectId: ObjectID): void => {
    return {
        type: types.DELETE_PROJECT_INCIDENTS,
        payload: projectId,
    };
};

// Internal notes and investigation notes Section

export const investigationNoteRequest: Function = (
    promise: $TSFixMe,
    updated: $TSFixMe
): void => {
    return {
        type: types.INVESTIGATION_NOTE_REQUEST,
        payload: { promise, updated },
    };
};

export const investigationNoteError: Function = (
    error: ErrorPayload,
    updated: $TSFixMe
): void => {
    return {
        type: types.INVESTIGATION_NOTE_FAILED,
        payload: { error, updated },
    };
};

export const investigationNoteSuccess: Function = (
    incidentMessage: $TSFixMe
): void => {
    return {
        type: types.INVESTIGATION_NOTE_SUCCESS,
        payload: incidentMessage,
    };
};

export function setInvestigationNote(
    projectId: ObjectID,
    incidentId: $TSFixMe,
    body: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        let promise = null;

        promise = BackendAPI.post(
            `incident/${projectId}/incident/${incidentId}/message`,
            body
        );

        const isUpdate: $TSFixMe = body.id ? true : false;

        dispatch(investigationNoteRequest(promise, isUpdate));

        promise.then(
            (incidents): void => {
                dispatch(investigationNoteSuccess(incidents.data));
            },
            (error): void => {
                dispatch(investigationNoteError(error, isUpdate));
            }
        );
        return promise;
    };
}

export const internalNoteRequest: Function = (
    promise: $TSFixMe,
    updated: $TSFixMe
): void => {
    return {
        type: types.INTERNAL_NOTE_REQUEST,
        payload: { promise, updated },
    };
};

export const internalNoteError: Function = (
    error: ErrorPayload,
    updated: $TSFixMe
): void => {
    return {
        type: types.INTERNAL_NOTE_FAILED,
        payload: { error, updated },
    };
};

export const internalNoteSuccess: Function = (incident: $TSFixMe): void => {
    return {
        type: types.INTERNAL_NOTE_SUCCESS,
        payload: incident,
    };
};

export function setInternalNote(
    projectId: ObjectID,
    incidentId: $TSFixMe,
    body: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        let promise = null;
        promise = BackendAPI.post(
            `incident/${projectId}/incident/${incidentId}/message`,
            body
        );

        const isUpdate: $TSFixMe = body.id ? true : false;

        dispatch(internalNoteRequest(promise, isUpdate));

        promise.then(
            (incidents): void => {
                if (incidents.data.type === 'internal') {
                    dispatch(
                        fetchIncidentMessagesSuccess({
                            incidentId: incidents.data.idNumber,

                            incidentMessages: incidents.data.data,

                            count: incidents.data.data.length,

                            type: incidents.data.type,

                            incidentSlug: incidents.data.incidentSlug,
                        })
                    );
                } else {
                    dispatch(internalNoteSuccess(incidents.data));
                }
            },
            (error): void => {
                dispatch(internalNoteError(error, isUpdate));
            }
        );
        return promise;
    };
}

export const deleteIncidentSuccess: Function = (incidentId: $TSFixMe): void => {
    return {
        type: types.DELETE_INCIDENT_SUCCESS,
        payload: incidentId,
    };
};

export const deleteIncidentRequest: Function = (incidentId: $TSFixMe): void => {
    return {
        type: types.DELETE_INCIDENT_REQUEST,
        payload: incidentId,
    };
};

export const deleteIncidentFailure: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_INCIDENT_FAILURE,
        payload: error,
    };
};

export const deleteIncidentReset: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_INCIDENT_RESET,
        payload: error,
    };
};

//Delete an incident
export const deleteIncident: Function = (
    projectId: ObjectID,
    incidentId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = delete `incident/${projectId}/${incidentId}`;
        dispatch(deleteIncidentRequest(incidentId));

        promise.then(
            (incident): void => {
                dispatch(deleteIncidentSuccess(incident.data._id));
            },
            (error): void => {
                dispatch(deleteIncidentFailure({ error: error, incidentId }));
            }
        );

        return promise;
    };
};

function hideIncidentSuccess(data: $TSFixMe): void {
    return {
        type: types.HIDE_INCIDENT_SUCCESS,
        payload: data,
    };
}

function hideIncidentFailure(error: ErrorPayload): void {
    return {
        type: types.HIDE_INCIDENT_FAILED,
        payload: error,
    };
}

// hide an incident
export const hideIncident: Function = (data: $TSFixMe): void => {
    const { hideIncident, incidentId, projectId }: $TSFixMe = data;
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `incident/${projectId}/${incidentId}`,
            {
                hideIncident,
            }
        );
        promise.then(
            (incident): void => {
                dispatch(hideIncidentSuccess(incident));
            },
            (error): void => {
                dispatch(hideIncidentFailure({ error: error, incidentId }));
            }
        );

        return promise;
    };
};

export function fetchIncidentMessages(
    projectId: ObjectID,
    incidentSlug: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber,
    type = 'investigation'
): void {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `incident/${projectId}/incident/${incidentSlug}/message?type=${type}&limit=${limit}&skip=${skip}`
        );
        dispatch(
            fetchIncidentMessagesRequest({
                incidentId: incidentSlug,
                type,
                incidentSlug,
            })
        );

        promise.then(
            (response): void => {
                dispatch(
                    fetchIncidentMessagesSuccess({
                        incidentId: incidentSlug,

                        incidentMessages: response.data.data,
                        skip,
                        limit,

                        count: response.data.count,
                        type,
                        incidentSlug: incidentSlug,
                    })
                );
            },
            (error): void => {
                dispatch(
                    fetchIncidentMessagesFailure({
                        incidentId: incidentSlug,
                        error: error,
                        incidentSlug,
                    })
                );
            }
        );

        return promise;
    };
}

export const fetchIncidentMessagesSuccess: Function = (
    incidentMessages: $TSFixMe
): void => {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_SUCCESS,
        payload: incidentMessages,
    };
};

export const fetchIncidentMessagesRequest: Function = (
    incidentId: $TSFixMe
): void => {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_REQUEST,
        payload: incidentId,
    };
};

export const fetchIncidentMessagesFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_FAILURE,
        payload: error,
    };
};

export const resetFetchIncidentMessages: Function = (): void => {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_RESET,
    };
};
export const editIncidentMessageSwitch: Function = (index: $TSFixMe): void => {
    return {
        type: types.EDIT_INCIDENT_MESSAGE_SWITCH,
        payload: index,
    };
};

export function deleteIncidentMessage(
    projectId: ObjectID,
    incidentId: $TSFixMe,
    incidentMessageId: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe =
            delete `incident/${projectId}/incident/${incidentId}/message/${incidentMessageId}`;
        dispatch(deleteIncidentMessageRequest(incidentMessageId));

        promise.then(
            (incidentMessage): void => {
                if (incidentMessage.data.type === 'internal') {
                    dispatch(
                        fetchIncidentMessagesSuccess({
                            incidentId: incidentMessage.data.idNumber,

                            incidentMessages: incidentMessage.data.data,

                            count: incidentMessage.data.data.length,

                            type: incidentMessage.data.type,

                            incidentSlug: incidentMessage.data.incidentSlug,
                        })
                    );
                } else {
                    dispatch(
                        deleteIncidentMessageSuccess(incidentMessage.data)
                    );
                }
            },
            (error): void => {
                dispatch(
                    deleteIncidentMessageFailure({
                        error: error,
                        incidentMessageId,
                    })
                );
            }
        );

        return promise;
    };
}

export const deleteIncidentMessageSuccess: Function = (
    removedIncidentMessage: $TSFixMe
): void => {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_SUCCESS,
        payload: removedIncidentMessage,
    };
};

export const deleteIncidentMessageRequest: Function = (
    incidentMessageId: $TSFixMe
): void => {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_REQUEST,
        payload: incidentMessageId,
    };
};

export const deleteIncidentMessageFailure: Function = (
    error: ErrorPayload
): void => {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_FAILURE,
        payload: error,
    };
};

export function updateIncident(
    projectId: ObjectID,
    incidentId: $TSFixMe,
    incidentType: $TSFixMe,
    title: $TSFixMe,
    description: $TSFixMe,
    incidentPriority: $TSFixMe
) {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `incident/${projectId}/incident/${incidentId}/details`,
            {
                incidentType,
                title,
                description,
                incidentPriority,
            }
        );
        dispatch(updateIncidentRequest());

        promise.then(
            (incident): void => {
                dispatch(updateIncidentSuccess(incident.data));
            },
            (error): void => {
                dispatch(updateIncidentFailure(error));
            }
        );
        return promise;
    };
}

function updateIncidentRequest(): void {
    return {
        type: types.UPDATE_INCIDENT_REQUEST,
    };
}

function updateIncidentSuccess(data: $TSFixMe): void {
    return {
        type: types.UPDATE_INCIDENT_SUCCESS,
        payload: data,
    };
}

function updateIncidentFailure(error: ErrorPayload): void {
    return {
        type: types.UPDATE_INCIDENT_FAILED,
        payload: error,
    };
}
