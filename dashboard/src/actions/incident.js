import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/incident';
import errors from '../errors';

//Array of Incidents

export function projectIncidentsRequest(promise) {
    return {
        type: types.PROJECT_INCIDENTS_REQUEST,
        payload: promise,
    };
}

export function projectIncidentsError(error) {
    return {
        type: types.PROJECT_INCIDENTS_FAILED,
        payload: error,
    };
}

export function projectIncidentsSuccess(incidents) {
    return {
        type: types.PROJECT_INCIDENTS_SUCCESS,
        payload: incidents,
    };
}

export const resetProjectIncidents = () => {
    return {
        type: types.PROJECT_INCIDENTS_RESET,
    };
};

// Gets project Incidents
export function getProjectIncidents(projectId, skip, limit) {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function(dispatch) {
        let promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = getApi(
                `incident/${projectId}/incident?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = getApi(`incident/${projectId}/incident`);
        }
        dispatch(projectIncidentsRequest(promise));

        promise.then(
            function(incidents) {
                const data = incidents.data;
                data.projectId = projectId;
                dispatch(projectIncidentsSuccess(data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(projectIncidentsError(errors(error)));
            }
        );
    };
}

//get all icident for a project belonging to a component
export function getProjectComponentIncidents(
    projectId,
    componentId,
    skip,
    limit
) {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function(dispatch) {
        let promise = null;
        if (skip >= 0 && limit >= 0) {
            promise = getApi(
                `incident/${projectId}/incidents/${componentId}?skip=${skip}&limit=${limit}`
            );
        } else {
            promise = getApi(`incident/${projectId}/incidents/${componentId}`);
        }
        dispatch(projectIncidentsRequest(promise));

        promise.then(
            function(incidents) {
                const data = incidents.data;
                data.count = incidents.data.data.count;
                data.data = incidents.data.data.incidents;
                data.projectId = projectId;
                dispatch(projectIncidentsSuccess(data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(projectIncidentsError(errors(error)));
            }
        );
    };
}

// SubProjects Incidents

export function incidentsRequest(promise) {
    return {
        type: types.INCIDENTS_REQUEST,
        payload: promise,
    };
}

export function incidentsError(error) {
    return {
        type: types.INCIDENTS_FAILED,
        payload: error,
    };
}

export function incidentsSuccess(incidents) {
    return {
        type: types.INCIDENTS_SUCCESS,
        payload: incidents,
    };
}

export const resetIncidents = () => {
    return {
        type: types.INCIDENTS_RESET,
    };
};

// Gets project Incidents
export function getIncidents(projectId) {
    return function(dispatch) {
        const promise = getApi(`incident/${projectId}`);
        dispatch(incidentsRequest(promise));

        promise.then(
            function(incidents) {
                dispatch(incidentsSuccess(incidents.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(incidentsError(errors(error)));
            }
        );
    };
}
//get component incidents
export function getComponentIncidents(projectId, componentId) {
    return function(dispatch) {
        const promise = getApi(
            `incident/${projectId}/${componentId}/incidents`
        );
        dispatch(incidentsRequest(promise));

        promise.then(
            function(incidents) {
                dispatch(incidentsSuccess(incidents.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(incidentsError(errors(error)));
            }
        );
    };
}

// Create a new incident

export function createIncidentRequest(monitorId) {
    return {
        type: types.CREATE_INCIDENT_REQUEST,
        payload: monitorId,
    };
}

export function createIncidentError(error) {
    return {
        type: types.CREATE_INCIDENT_FAILED,
        payload: error,
    };
}

export function createIncidentSuccess(incident) {
    return {
        type: types.CREATE_INCIDENT_SUCCESS,
        payload: incident,
    };
}

export const resetCreateIncident = () => {
    return {
        type: types.CREATE_INCIDENT_RESET,
    };
};

export const createIncidentReset = () => {
    return function(dispatch) {
        dispatch(resetCreateIncident());
    };
};

// Calls the API to create new incident.
export function createNewIncident(
    projectId,
    monitorId,
    incidentType,
    title,
    description,
    incidentPriority,
    customFields
) {
    return async function(dispatch) {
        const promise = postApi(`incident/${projectId}/${monitorId}`, {
            monitorId,
            projectId,
            incidentType,
            title,
            description,
            incidentPriority,
            customFields,
        });

        dispatch(createIncidentRequest(monitorId));

        promise.then(
            function(createIncident) {
                dispatch(createIncidentSuccess(createIncident.data));
                dispatch({
                    type: 'ADD_NEW_INCIDENT_TO_UNRESOLVED',
                    payload: createIncident.data,
                });
                dispatch({
                    type: 'ADD_NEW_INCIDENT_TO_MONITORS',
                    payload: createIncident.data,
                });
                return { createIncident };
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(createIncidentError(errors(error)));
                return { error };
            }
        );

        return promise;
    };
}

// incident portion

export function incidentRequest(promise) {
    return {
        type: types.INCIDENT_REQUEST,
        payload: promise,
    };
}

export function incidentError(error) {
    return {
        type: types.INCIDENT_FAILED,
        payload: error,
    };
}

export function incidentSuccess(incident) {
    return {
        type: types.INCIDENT_SUCCESS,
        payload: incident,
    };
}

export const resetIncident = () => {
    return {
        type: types.INCIDENT_RESET,
    };
};

export function acknowledgeIncidentRequest(promise) {
    return {
        type: types.ACKNOWLEDGE_INCIDENT_REQUEST,
        payload: promise,
    };
}

export function resolveIncidentRequest(promise) {
    return {
        type: types.RESOLVE_INCIDENT_REQUEST,
        payload: promise,
    };
}

export function acknowledgeIncidentSuccess(incident) {
    return {
        type: types.ACKNOWLEDGE_INCIDENT_SUCCESS,
        payload: incident,
    };
}

export function resolveIncidentSuccess(incident) {
    return {
        type: types.RESOLVE_INCIDENT_SUCCESS,
        payload: incident,
    };
}

// Calls the API to get the incident to show
export function getIncident(projectId, incidentId) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function(dispatch) {
        let promise = null;
        promise = getApi(`incident/${projectId}/incident/${incidentId}`);
        dispatch(incidentRequest(promise));

        promise.then(
            function(incident) {
                dispatch(incidentSuccess(incident.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(incidentError(errors(error)));
            }
        );

        return promise;
    };
}

// Calls the API to get the incident to show using idNumber
export function getIncidentByIdNumber(projectId, incidentIdNumber) {
    return function(dispatch) {
        let promise = null;
        promise = getApi(
            `incident/${projectId}/incidentNumber/${incidentIdNumber}`
        );
        dispatch(incidentRequest(promise));

        promise.then(
            function(incident) {
                dispatch(incidentSuccess(incident.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(incidentError(errors(error)));
            }
        );

        return promise;
    };
}

// Calls the API to get the incident timeline
export function getIncidentTimeline(projectId, incidentId, skip, limit) {
    return function(dispatch) {
        let promise = null;
        promise = getApi(
            `incident/${projectId}/timeline/${incidentId}?skip=${skip}&limit=${limit}`
        );
        dispatch(incidentTimelineRequest(promise));

        promise.then(
            function(timeline) {
                dispatch(incidentTimelineSuccess(timeline.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(incidentTimelineError(errors(error)));
            }
        );
    };
}

export function incidentTimelineRequest(promise) {
    return {
        type: types.INCIDENT_TIMELINE_REQUEST,
        payload: promise,
    };
}

export function incidentTimelineSuccess(timeline) {
    return {
        type: types.INCIDENT_TIMELINE_SUCCESS,
        payload: timeline,
    };
}

export function incidentTimelineError(error) {
    return {
        type: types.INCIDENT_TIMELINE_FAILED,
        payload: error,
    };
}

// calls the api to post acknowledgement data to the database
export function acknowledgeIncident(projectId, incidentId, userId, multiple) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function(dispatch) {
        let promise = null;
        const data = {
            decoded: userId,
            projectId,
            incidentId,
        };
        promise = postApi(
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
            function(result) {
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
                        incidentId,
                        incidentMessages: result.data.data,
                        count: result.data.data.length,
                        type: result.data.type,
                    })
                );
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                if (multiple) {
                    dispatch(
                        incidentError({
                            multiple: true,
                            error: errors(error),
                        })
                    );
                } else {
                    dispatch(
                        incidentError({
                            multiple: false,
                            error: errors(error),
                        })
                    );
                }
            }
        );
        return promise;
    };
}

// calls the api to store the resolve status to the database
export function resolveIncident(projectId, incidentId, userId, multiple) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function(dispatch) {
        let promise = null;
        const data = {
            decoded: userId,
            projectId,
            incidentId,
        };
        promise = postApi(`incident/${projectId}/resolve/${incidentId}`, data);
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
            function(result) {
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
                        incidentId,
                        incidentMessages: result.data.data,
                        count: result.data.data.length,
                        type: result.data.type,
                    })
                );
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                if (multiple) {
                    dispatch(
                        incidentError({
                            multiple: true,
                            error: errors(error),
                        })
                    );
                } else {
                    dispatch(
                        incidentError({
                            multiple: false,
                            error: errors(error),
                        })
                    );
                }
            }
        );
        return promise;
    };
}

export function closeIncidentRequest(incidentId) {
    return {
        type: types.CLOSE_INCIDENT_REQUEST,
        payload: incidentId,
    };
}

export function closeIncidentError(error) {
    return {
        type: types.CLOSE_INCIDENT_FAILED,
        payload: error,
    };
}

export function closeIncidentSuccess(incident) {
    return {
        type: types.CLOSE_INCIDENT_SUCCESS,
        payload: incident,
    };
}

export function closeIncident(projectId, incidentId) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function(dispatch) {
        const promise = postApi(
            `incident/${projectId}/close/${incidentId}`,
            {}
        );
        dispatch(closeIncidentRequest(incidentId));

        promise.then(
            function(incident) {
                dispatch(closeIncidentSuccess(incident.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(closeIncidentError(errors(error)));
            }
        );
    };
}

// Unresolved Incidents Section

export function UnresolvedIncidentsRequest(promise) {
    return {
        type: types.UNRESOLVED_INCIDENTS_REQUEST,
        payload: promise,
    };
}

export function UnresolvedIncidentsError(error) {
    return {
        type: types.UNRESOLVED_INCIDENTS_FAILED,
        payload: error,
    };
}

export function UnresolvedIncidentsSuccess(incidents) {
    return {
        type: types.UNRESOLVED_INCIDENTS_SUCCESS,
        payload: incidents,
    };
}

export function resetUnresolvedIncidents() {
    return {
        type: types.UNRESOLVED_INCIDENTS_RESET,
    };
}

// Calls the API to register a user.
export function fetchUnresolvedIncidents(projectId) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function(dispatch) {
        let promise = null;

        promise = getApi(`incident/${projectId}/unresolvedincidents`);

        dispatch(UnresolvedIncidentsRequest(promise));

        promise.then(
            function(incidents) {
                dispatch(UnresolvedIncidentsSuccess(incidents.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(UnresolvedIncidentsError(errors(error)));
            }
        );
    };
}

// Calls the API to delete incidents after deleting the project
export function deleteProjectIncidents(projectId) {
    return {
        type: types.DELETE_PROJECT_INCIDENTS,
        payload: projectId,
    };
}

// Internal notes and investigation notes Section

export function investigationNoteRequest(promise, updated) {
    return {
        type: types.INVESTIGATION_NOTE_REQUEST,
        payload: { promise, updated },
    };
}

export function investigationNoteError(error, updated) {
    return {
        type: types.INVESTIGATION_NOTE_FAILED,
        payload: { error, updated },
    };
}

export function investigationNoteSuccess(incidentMessage) {
    return {
        type: types.INVESTIGATION_NOTE_SUCCESS,
        payload: incidentMessage,
    };
}

export function setInvestigationNote(projectId, incidentId, body) {
    return function(dispatch) {
        let promise = null;

        promise = postApi(
            `incident/${projectId}/incident/${incidentId}/message`,
            body
        );

        const isUpdate = body.id ? true : false;

        dispatch(investigationNoteRequest(promise, isUpdate));

        promise.then(
            function(incidents) {
                dispatch(investigationNoteSuccess(incidents.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(investigationNoteError(errors(error), isUpdate));
            }
        );
        return promise;
    };
}

export function internalNoteRequest(promise, updated) {
    return {
        type: types.INTERNAL_NOTE_REQUEST,
        payload: { promise, updated },
    };
}

export function internalNoteError(error, updated) {
    return {
        type: types.INTERNAL_NOTE_FAILED,
        payload: { error, updated },
    };
}

export function internalNoteSuccess(incident) {
    return {
        type: types.INTERNAL_NOTE_SUCCESS,
        payload: incident,
    };
}

export function setInternalNote(projectId, incidentId, body) {
    return function(dispatch) {
        let promise = null;
        promise = postApi(
            `incident/${projectId}/incident/${incidentId}/message`,
            body
        );

        const isUpdate = body.id ? true : false;

        dispatch(internalNoteRequest(promise, isUpdate));

        promise.then(
            function(incidents) {
                if (incidents.data.type === 'internal') {
                    dispatch(
                        fetchIncidentMessagesSuccess({
                            incidentId,
                            incidentMessages: incidents.data.data,
                            count: incidents.data.data.length,
                            type: incidents.data.type,
                        })
                    );
                } else {
                    dispatch(internalNoteSuccess(incidents.data));
                }
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(internalNoteError(errors(error), isUpdate));
            }
        );
        return promise;
    };
}

export function deleteIncidentSuccess(incidentId) {
    return {
        type: types.DELETE_INCIDENT_SUCCESS,
        payload: incidentId,
    };
}

export function deleteIncidentRequest(incidentId) {
    return {
        type: types.DELETE_INCIDENT_REQUEST,
        payload: incidentId,
    };
}

export function deleteIncidentFailure(error) {
    return {
        type: types.DELETE_INCIDENT_FAILURE,
        payload: error,
    };
}

export function deleteIncidentReset(error) {
    return {
        type: types.DELETE_INCIDENT_RESET,
        payload: error,
    };
}

//Delete an incident
export function deleteIncident(projectId, incidentId) {
    return function(dispatch) {
        const promise = deleteApi(`incident/${projectId}/${incidentId}`);
        dispatch(deleteIncidentRequest(incidentId));

        promise.then(
            function(incident) {
                dispatch(deleteIncidentSuccess(incident.data._id));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(
                    deleteIncidentFailure({ error: errors(error), incidentId })
                );
            }
        );

        return promise;
    };
}

export function fetchIncidentMessages(
    projectId,
    incidentId,
    skip,
    limit,
    type = 'investigation'
) {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function(dispatch) {
        const promise = getApi(
            `incident/${projectId}/incident/${incidentId}/message?type=${type}&limit=${limit}&skip=${skip}`
        );
        dispatch(fetchIncidentMessagesRequest({ incidentId, type }));

        promise.then(
            function(response) {
                dispatch(
                    fetchIncidentMessagesSuccess({
                        incidentId,
                        incidentMessages: response.data.data,
                        skip,
                        limit,
                        count: response.data.count,
                        type,
                    })
                );
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(
                    fetchIncidentMessagesFailure({
                        incidentId,
                        error: errors(error),
                    })
                );
            }
        );

        return promise;
    };
}

export function fetchIncidentMessagesSuccess(incidentMessages) {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_SUCCESS,
        payload: incidentMessages,
    };
}

export function fetchIncidentMessagesRequest(incidentId) {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_REQUEST,
        payload: incidentId,
    };
}

export function fetchIncidentMessagesFailure(error) {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_FAILURE,
        payload: error,
    };
}

export function resetFetchIncidentMessages() {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_RESET,
    };
}
export function editIncidentMessageSwitch(index) {
    return {
        type: types.EDIT_INCIDENT_MESSAGE_SWITCH,
        payload: index,
    };
}

export function deleteIncidentMessage(
    projectId,
    incidentId,
    incidentMessageId
) {
    return function(dispatch) {
        const promise = deleteApi(
            `incident/${projectId}/incident/${incidentId}/message/${incidentMessageId}`
        );
        dispatch(deleteIncidentMessageRequest(incidentMessageId));

        promise.then(
            function(incidentMessage) {
                if (incidentMessage.data.type === 'internal') {
                    dispatch(
                        fetchIncidentMessagesSuccess({
                            incidentId,
                            incidentMessages: incidentMessage.data.data,
                            count: incidentMessage.data.data.length,
                            type: incidentMessage.data.type,
                        })
                    );
                } else {
                    dispatch(
                        deleteIncidentMessageSuccess(incidentMessage.data)
                    );
                }
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(
                    deleteIncidentMessageFailure({
                        error: errors(error),
                        incidentMessageId,
                    })
                );
            }
        );

        return promise;
    };
}

export function deleteIncidentMessageSuccess(removedIncidentMessage) {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_SUCCESS,
        payload: removedIncidentMessage,
    };
}

export function deleteIncidentMessageRequest(incidentMessageId) {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_REQUEST,
        payload: incidentMessageId,
    };
}

export function deleteIncidentMessageFailure(error) {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_FAILURE,
        payload: error,
    };
}

export function updateIncident(
    projectId,
    incidentId,
    incidentType,
    title,
    description,
    incidentPriority
) {
    return function(dispatch) {
        const promise = putApi(
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
            function(incident) {
                dispatch(updateIncidentSuccess(incident.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(updateIncidentFailure(errors(error)));
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

function updateIncidentSuccess(data) {
    return {
        type: types.UPDATE_INCIDENT_SUCCESS,
        payload: data,
    };
}

function updateIncidentFailure(error) {
    return {
        type: types.UPDATE_INCIDENT_FAILED,
        payload: error,
    };
}
