import BackendAPI from 'common-ui/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/incident';
import ErrorPayload from 'common-ui/src/payload-types/error';
import PositiveNumber from 'common/Types/PositiveNumber';
//Array of Incidents

export const projectIncidentsRequest = (promise: $TSFixMe) => {
    return {
        type: types.PROJECT_INCIDENTS_REQUEST,
        payload: promise,
    };
};

export const projectIncidentsError = (error: ErrorPayload) => {
    return {
        type: types.PROJECT_INCIDENTS_FAILED,
        payload: error,
    };
};

export const projectIncidentsSuccess = (incidents: $TSFixMe) => {
    return {
        type: types.PROJECT_INCIDENTS_SUCCESS,
        payload: incidents,
    };
};

export const resetProjectIncidents = () => {
    return {
        type: types.PROJECT_INCIDENTS_RESET,
    };
};

// Gets project Incidents
export function getProjectIncidents(
    projectId: string,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function (dispatch: Dispatch) {
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
            function (incidents) {
                const data = incidents.data;
                data.projectId = projectId;
                dispatch(projectIncidentsSuccess(data));
            },
            function (error) {
                dispatch(projectIncidentsError(error));
            }
        );
    };
}

//get all icident for a project belonging to a component
export function getProjectComponentIncidents(
    projectId: string,
    componentId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function (dispatch: Dispatch) {
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
            function (incidents) {
                const data = incidents.data;

                data.count = incidents.data.data.count;

                data.data = incidents.data.data.incidents;
                data.projectId = projectId;
                dispatch(projectIncidentsSuccess(data));
            },
            function (error) {
                dispatch(projectIncidentsError(error));
            }
        );
    };
}

// SubProjects Incidents

export const incidentsRequest = (promise: $TSFixMe) => {
    return {
        type: types.INCIDENTS_REQUEST,
        payload: promise,
    };
};

export const incidentsError = (error: ErrorPayload) => {
    return {
        type: types.INCIDENTS_FAILED,
        payload: error,
    };
};

export const incidentsSuccess = (incidents: $TSFixMe) => {
    return {
        type: types.INCIDENTS_SUCCESS,
        payload: incidents,
    };
};

export const resetIncidents = () => {
    return {
        type: types.INCIDENTS_RESET,
    };
};

// Gets project Incidents
export const getIncidents = (projectId: string) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`incident/${projectId}`);
        dispatch(incidentsRequest(promise));

        promise.then(
            function (incidents) {
                dispatch(incidentsSuccess(incidents.data));
            },
            function (error) {
                dispatch(incidentsError(error));
            }
        );
    };
};
//get component incidents
export function getComponentIncidents(
    projectId: string,
    componentId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `incident/${projectId}/${componentId}/incidents`
        );
        dispatch(incidentsRequest(promise));

        promise.then(
            function (incidents) {
                dispatch(incidentsSuccess(incidents.data));
            },
            function (error) {
                dispatch(incidentsError(error));
            }
        );
    };
}

// Create a new incident

export const createIncidentRequest = (projectId: string) => {
    return {
        type: types.CREATE_INCIDENT_REQUEST,
        payload: projectId,
    };
};

export const createIncidentError = (error: ErrorPayload) => {
    return {
        type: types.CREATE_INCIDENT_FAILED,
        payload: error,
    };
};

export const createIncidentSuccess = (incident: $TSFixMe) => {
    return {
        type: types.CREATE_INCIDENT_SUCCESS,
        payload: incident,
    };
};

export const resetCreateIncident = () => {
    return {
        type: types.CREATE_INCIDENT_RESET,
    };
};

export const createIncidentReset = () => {
    return function (dispatch: Dispatch) {
        dispatch(resetCreateIncident());
    };
};

// Calls the API to create new incident.
export function createNewIncident(
    projectId: string,
    monitors: $TSFixMe,
    incidentType: $TSFixMe,
    title: $TSFixMe,
    description: $TSFixMe,
    incidentPriority: $TSFixMe,
    customFields: $TSFixMe
) {
    return async function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
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
            function (createIncident) {
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
            function (error) {
                dispatch(createIncidentError(error));
            }
        );

        return promise;
    };
}

// incident portion

export const incidentRequest = (promise: $TSFixMe) => {
    return {
        type: types.INCIDENT_REQUEST,
        payload: promise,
    };
};

export const incidentError = (error: ErrorPayload) => {
    return {
        type: types.INCIDENT_FAILED,
        payload: error,
    };
};

export const incidentSuccess = (incident: $TSFixMe) => {
    return {
        type: types.INCIDENT_SUCCESS,
        payload: incident,
    };
};

export const resetIncident = () => {
    return {
        type: types.INCIDENT_RESET,
    };
};

export const acknowledgeIncidentRequest = (promise: $TSFixMe) => {
    return {
        type: types.ACKNOWLEDGE_INCIDENT_REQUEST,
        payload: promise,
    };
};

export const resolveIncidentRequest = (promise: $TSFixMe) => {
    return {
        type: types.RESOLVE_INCIDENT_REQUEST,
        payload: promise,
    };
};

export const acknowledgeIncidentSuccess = (incident: $TSFixMe) => {
    return {
        type: types.ACKNOWLEDGE_INCIDENT_SUCCESS,
        payload: incident,
    };
};

export const resolveIncidentSuccess = (incident: $TSFixMe) => {
    return {
        type: types.RESOLVE_INCIDENT_SUCCESS,
        payload: incident,
    };
};

// Calls the API to get the incident to show
export const getIncident = (projectId: string, incidentSlug: $TSFixMe) => {
    //This fucntion will switch to incidentSlug of the params beig passed.
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.get(
            `incident/${projectId}/incident/${incidentSlug}`
        );
        dispatch(incidentRequest(promise));

        promise.then(
            function (incident) {
                dispatch(incidentSuccess(incident.data));
            },
            function (error) {
                dispatch(incidentError(error));
            }
        );

        return promise;
    };
};

export const addIncident = (incident: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch(incidentSuccess(incident));
    };
};
// Calls the API to get the incident timeline
export function getIncidentTimeline(
    projectId: string,
    incidentId: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber
) {
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.get(
            `incident/${projectId}/timeline/${incidentId}?skip=${skip}&limit=${limit}`
        );
        dispatch(incidentTimelineRequest(promise));

        promise.then(
            function (timeline) {
                dispatch(incidentTimelineSuccess(timeline.data));
            },
            function (error) {
                dispatch(incidentTimelineError(error));
            }
        );
    };
}

export const incidentTimelineRequest = (promise: $TSFixMe) => {
    return {
        type: types.INCIDENT_TIMELINE_REQUEST,
        payload: promise,
    };
};

export const incidentTimelineSuccess = (timeline: $TSFixMe) => {
    return {
        type: types.INCIDENT_TIMELINE_SUCCESS,
        payload: timeline,
    };
};

export const incidentTimelineError = (error: ErrorPayload) => {
    return {
        type: types.INCIDENT_TIMELINE_FAILED,
        payload: error,
    };
};

export const setActiveIncident = (incidentId: $TSFixMe) => {
    return {
        type: 'SET_ACTIVE_INCIDENT',
        payload: incidentId,
    };
};

// calls the api to post acknowledgement data to the database
export function acknowledgeIncident(
    projectId: string,
    incidentId: $TSFixMe,
    userId: string,
    multiple: $TSFixMe
) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function (dispatch: Dispatch) {
        let promise = null;
        const data = {
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
            function (result) {
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
            function (error) {
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
    projectId: string,
    incidentId: $TSFixMe,
    userId: string,
    multiple: $TSFixMe
) {
    //This function will switch to incidentId of the params being passed.
    return function (dispatch: Dispatch) {
        let promise = null;
        const data = {
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
            function (result) {
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
            function (error) {
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

export const closeIncidentRequest = (incidentId: $TSFixMe) => {
    return {
        type: types.CLOSE_INCIDENT_REQUEST,
        payload: incidentId,
    };
};

export const closeIncidentError = (error: ErrorPayload) => {
    return {
        type: types.CLOSE_INCIDENT_FAILED,
        payload: error,
    };
};

export const closeIncidentSuccess = (incident: $TSFixMe) => {
    return {
        type: types.CLOSE_INCIDENT_SUCCESS,
        payload: incident,
    };
};

export const closeIncident = (projectId: string, incidentId: $TSFixMe) => {
    //This function will switch to incidentId of the params beig passed.
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(
            `incident/${projectId}/close/${incidentId}`,
            {}
        );
        dispatch(closeIncidentRequest(incidentId));

        promise.then(
            function (incident) {
                dispatch(closeIncidentSuccess(incident.data));
            },
            function (error) {
                dispatch(closeIncidentError(error));
            }
        );
    };
};

// Unresolved Incidents Section

export const UnresolvedIncidentsRequest = (promise: $TSFixMe) => {
    return {
        type: types.UNRESOLVED_INCIDENTS_REQUEST,
        payload: promise,
    };
};

export const UnresolvedIncidentsError = (error: ErrorPayload) => {
    return {
        type: types.UNRESOLVED_INCIDENTS_FAILED,
        payload: error,
    };
};

export const UnresolvedIncidentsSuccess = (incidents: $TSFixMe) => {
    return {
        type: types.UNRESOLVED_INCIDENTS_SUCCESS,
        payload: incidents,
    };
};

export const resetUnresolvedIncidents = () => {
    return {
        type: types.UNRESOLVED_INCIDENTS_RESET,
    };
};

// Calls the API to register a user.
export const fetchUnresolvedIncidents = (projectId: string, isHome = false) => {
    //This fucntion will switch to incidentId of the params beig passed.
    return function (dispatch: Dispatch) {
        let promise = null;

        promise = BackendAPI.get(
            `incident/${projectId}/unresolvedincidents?isHome=${isHome}`
        );

        dispatch(UnresolvedIncidentsRequest(promise));

        promise.then(
            function (incidents) {
                dispatch(UnresolvedIncidentsSuccess(incidents.data));
            },
            function (error) {
                dispatch(UnresolvedIncidentsError(error));
            }
        );
    };
};

// Calls the API to delete incidents after deleting the project
export const deleteProjectIncidents = (projectId: string) => {
    return {
        type: types.DELETE_PROJECT_INCIDENTS,
        payload: projectId,
    };
};

// Internal notes and investigation notes Section

export const investigationNoteRequest = (
    promise: $TSFixMe,
    updated: $TSFixMe
) => {
    return {
        type: types.INVESTIGATION_NOTE_REQUEST,
        payload: { promise, updated },
    };
};

export const investigationNoteError = (
    error: ErrorPayload,
    updated: $TSFixMe
) => {
    return {
        type: types.INVESTIGATION_NOTE_FAILED,
        payload: { error, updated },
    };
};

export const investigationNoteSuccess = (incidentMessage: $TSFixMe) => {
    return {
        type: types.INVESTIGATION_NOTE_SUCCESS,
        payload: incidentMessage,
    };
};

export function setInvestigationNote(
    projectId: string,
    incidentId: $TSFixMe,
    body: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        let promise = null;

        promise = BackendAPI.post(
            `incident/${projectId}/incident/${incidentId}/message`,
            body
        );

        const isUpdate = body.id ? true : false;

        dispatch(investigationNoteRequest(promise, isUpdate));

        promise.then(
            function (incidents) {
                dispatch(investigationNoteSuccess(incidents.data));
            },
            function (error) {
                dispatch(investigationNoteError(error, isUpdate));
            }
        );
        return promise;
    };
}

export const internalNoteRequest = (promise: $TSFixMe, updated: $TSFixMe) => {
    return {
        type: types.INTERNAL_NOTE_REQUEST,
        payload: { promise, updated },
    };
};

export const internalNoteError = (error: ErrorPayload, updated: $TSFixMe) => {
    return {
        type: types.INTERNAL_NOTE_FAILED,
        payload: { error, updated },
    };
};

export const internalNoteSuccess = (incident: $TSFixMe) => {
    return {
        type: types.INTERNAL_NOTE_SUCCESS,
        payload: incident,
    };
};

export function setInternalNote(
    projectId: string,
    incidentId: $TSFixMe,
    body: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        let promise = null;
        promise = BackendAPI.post(
            `incident/${projectId}/incident/${incidentId}/message`,
            body
        );

        const isUpdate = body.id ? true : false;

        dispatch(internalNoteRequest(promise, isUpdate));

        promise.then(
            function (incidents) {
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
            function (error) {
                dispatch(internalNoteError(error, isUpdate));
            }
        );
        return promise;
    };
}

export const deleteIncidentSuccess = (incidentId: $TSFixMe) => {
    return {
        type: types.DELETE_INCIDENT_SUCCESS,
        payload: incidentId,
    };
};

export const deleteIncidentRequest = (incidentId: $TSFixMe) => {
    return {
        type: types.DELETE_INCIDENT_REQUEST,
        payload: incidentId,
    };
};

export const deleteIncidentFailure = (error: ErrorPayload) => {
    return {
        type: types.DELETE_INCIDENT_FAILURE,
        payload: error,
    };
};

export const deleteIncidentReset = (error: ErrorPayload) => {
    return {
        type: types.DELETE_INCIDENT_RESET,
        payload: error,
    };
};

//Delete an incident
export const deleteIncident = (projectId: string, incidentId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = delete `incident/${projectId}/${incidentId}`;
        dispatch(deleteIncidentRequest(incidentId));

        promise.then(
            function (incident) {
                dispatch(deleteIncidentSuccess(incident.data._id));
            },
            function (error) {
                dispatch(deleteIncidentFailure({ error: error, incidentId }));
            }
        );

        return promise;
    };
};

function hideIncidentSuccess(data: $TSFixMe) {
    return {
        type: types.HIDE_INCIDENT_SUCCESS,
        payload: data,
    };
}

function hideIncidentFailure(error: ErrorPayload) {
    return {
        type: types.HIDE_INCIDENT_FAILED,
        payload: error,
    };
}

// hide an incident
export const hideIncident = (data: $TSFixMe) => {
    const { hideIncident, incidentId, projectId } = data;
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`incident/${projectId}/${incidentId}`, {
            hideIncident,
        });
        promise.then(
            function (incident) {
                dispatch(hideIncidentSuccess(incident));
            },
            function (error) {
                dispatch(hideIncidentFailure({ error: error, incidentId }));
            }
        );

        return promise;
    };
};

export function fetchIncidentMessages(
    projectId: string,
    incidentSlug: $TSFixMe,
    skip: PositiveNumber,
    limit: PositiveNumber,
    type = 'investigation'
) {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
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
            function (response) {
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
            function (error) {
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

export const fetchIncidentMessagesSuccess = (incidentMessages: $TSFixMe) => {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_SUCCESS,
        payload: incidentMessages,
    };
};

export const fetchIncidentMessagesRequest = (incidentId: $TSFixMe) => {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_REQUEST,
        payload: incidentId,
    };
};

export const fetchIncidentMessagesFailure = (error: ErrorPayload) => {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_FAILURE,
        payload: error,
    };
};

export const resetFetchIncidentMessages = () => {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_RESET,
    };
};
export const editIncidentMessageSwitch = (index: $TSFixMe) => {
    return {
        type: types.EDIT_INCIDENT_MESSAGE_SWITCH,
        payload: index,
    };
};

export function deleteIncidentMessage(
    projectId: string,
    incidentId: $TSFixMe,
    incidentMessageId: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise =
            delete `incident/${projectId}/incident/${incidentId}/message/${incidentMessageId}`;
        dispatch(deleteIncidentMessageRequest(incidentMessageId));

        promise.then(
            function (incidentMessage) {
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
            function (error) {
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

export const deleteIncidentMessageSuccess = (
    removedIncidentMessage: $TSFixMe
) => {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_SUCCESS,
        payload: removedIncidentMessage,
    };
};

export const deleteIncidentMessageRequest = (incidentMessageId: $TSFixMe) => {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_REQUEST,
        payload: incidentMessageId,
    };
};

export const deleteIncidentMessageFailure = (error: ErrorPayload) => {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_FAILURE,
        payload: error,
    };
};

export function updateIncident(
    projectId: string,
    incidentId: $TSFixMe,
    incidentType: $TSFixMe,
    title: $TSFixMe,
    description: $TSFixMe,
    incidentPriority: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(
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
            function (incident) {
                dispatch(updateIncidentSuccess(incident.data));
            },
            function (error) {
                dispatch(updateIncidentFailure(error));
            }
        );
        return promise;
    };
}

function updateIncidentRequest() {
    return {
        type: types.UPDATE_INCIDENT_REQUEST,
    };
}

function updateIncidentSuccess(data: $TSFixMe) {
    return {
        type: types.UPDATE_INCIDENT_SUCCESS,
        payload: data,
    };
}

function updateIncidentFailure(error: ErrorPayload) {
    return {
        type: types.UPDATE_INCIDENT_FAILED,
        payload: error,
    };
}
