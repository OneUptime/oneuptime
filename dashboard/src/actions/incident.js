import { postApi, getApi, putApi, deleteApi } from '../api';
import * as types from '../constants/incident'
import errors from '../errors'

//Array of Incidents

export function projectIncidentsRequest(promise) {
    return {
        type: types.PROJECT_INCIDENTS_REQUEST,
        payload: promise
    };
}

export function projectIncidentsError(error) {
    return {
        type: types.PROJECT_INCIDENTS_FAILED,
        payload: error
    };
}

export function projectIncidentsSuccess(incidents) {
    return {
        type: types.PROJECT_INCIDENTS_SUCCESS,
        payload: incidents
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
    
    return function (dispatch) {
        var promise = null;
        if (skip >= 0 && limit >= 0){
            promise = getApi(`incident/${projectId}/incident?skip=${skip}&limit=${limit}`);
        }else {
            promise = getApi(`incident/${projectId}/incident`);
        }
        dispatch(projectIncidentsRequest(promise));

        promise.then(function (incidents) {
            var data = incidents.data;
			data.projectId = projectId;
            dispatch(projectIncidentsSuccess(data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(projectIncidentsError(errors(error)));
        });
    };
}

// SubProjects Incidents

export function incidentsRequest(promise) {
    return {
        type: types.INCIDENTS_REQUEST,
        payload: promise
    };
}

export function incidentsError(error) {
    return {
        type: types.INCIDENTS_FAILED,
        payload: error
    };
}

export function incidentsSuccess(incidents) {
    return {
        type: types.INCIDENTS_SUCCESS,
        payload: incidents
    };
}

export const resetIncidents = () => {
    return {
        type: types.INCIDENTS_RESET,
    };
};

// Gets project Incidents
export function getIncidents(projectId) {
    
    return function (dispatch) {
        const promise = getApi(`incident/${projectId}`);
        dispatch(incidentsRequest(promise));

        promise.then(function (incidents) {
            dispatch(incidentsSuccess(incidents.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(incidentsError(errors(error)));
        });
    };
}


// Create a new incident

export function createIncidentRequest(promise) {
    return {
        type: types.CREATE_INCIDENT_REQUEST,
        payload: promise
    };
}

export function createIncidentError(error) {
    return {
        type: types.CREATE_INCIDENT_FAILED,
        payload: error
    };
}

export function createIncidentSuccess(incident) {
    return {
        type: types.CREATE_INCIDENT_SUCCESS,
        payload: incident
    };
}

export const resetCreateIncident = () => {
    return {
        type: types.CREATE_INCIDENT_RESET,
    };
};

// Calls the API to create new incident.
export function createNewIncident(projectId, monitorId, incidentType) {
    return function (dispatch) {
        var promise = postApi(`incident/${projectId}/${monitorId}`, { monitorId, projectId, incidentType });

        dispatch(createIncidentRequest(promise));

        promise.then(function (createIncident) {
            dispatch(createIncidentSuccess(createIncident.data));
            dispatch({
                type: 'ADD_NEW_INCIDENT_TO_UNRESOLVED',
                payload: createIncident.data
            });
            dispatch({
                type: 'ADD_NEW_INCIDENT_TO_MONITORS',
                payload: createIncident.data
            });
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(createIncidentError(errors(error)));
        });

        return promise;
    };
}

// incident portion

export function incidentRequest(promise) {
    return {
        type: types.INCIDENT_REQUEST,
        payload: promise
    };
}

export function incidentError(error) {
    return {
        type: types.INCIDENT_FAILED,
        payload: error
    };
}

export function incidentSuccess(incident) {
    return {
        type: types.INCIDENT_SUCCESS,
        payload: incident
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
        payload: promise
    };
}

export function resolveIncidentRequest(promise) {
    return {
        type: types.RESOLVE_INCIDENT_REQUEST,
        payload: promise
    };
}

export function acknowledgeIncidentSuccess(incident) {
    return {
        type: types.ACKNOWLEDGE_INCIDENT_SUCCESS,
        payload: incident
    };
}

export function resolveIncidentSuccess(incident) {
    return {
        type: types.RESOLVE_INCIDENT_SUCCESS,
        payload: incident
    };
}

// Calls the API to get the incident to show
export function getIncident(projectId, incidentId) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function (dispatch) {
        var promise = null;
        promise = getApi(`incident/${projectId}/incident/${incidentId}`);
        dispatch(incidentRequest(promise));

        promise.then(function (incident) {
            dispatch(incidentSuccess(incident.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(incidentError(errors(error)));
        });
    };
}

// calls the api to post acknowledgement data to the database
export function acknowledgeIncident(projectId, incidentId, userId, multiple) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function (dispatch) {
        var promise = null,
            data = {
                decoded: userId,
                projectId,
                incidentId
            }
        promise = postApi(`incident/${projectId}/acknowledge/${incidentId}`, data);
        if (multiple) {
            dispatch(acknowledgeIncidentRequest({
                multiple: true,
                promise: promise
            }));
        } else {
            dispatch(acknowledgeIncidentRequest({
                multiple: false,
                promise: promise
            }));
        }

        promise.then(function (incident) {
            if (multiple) {
                dispatch(acknowledgeIncidentSuccess({
                    multiple: true,
                    data: incident.data
                }));
            } else {
                dispatch(acknowledgeIncidentSuccess({
                    multiple: false,
                    data: incident.data
                }));
            }
            dispatch({
                type: 'ACKNOWLEDGE_INCIDENT_SUCCESS',
                payload: incident.data
            });
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            if (multiple) {
                dispatch(incidentError({
                    multiple: true,
                    error: errors(error)
                }));
            } else {
                dispatch(incidentError({
                    multiple: false,
                    error: errors(error)
                }));
            }
        });
    };
}

// calls the api to store the resolve status to the database
export function resolveIncident(projectId, incidentId, userId, multiple) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function (dispatch) {
        var promise = null,
            data = {
                decoded: userId,
                projectId,
                incidentId
            }
        promise = postApi(`incident/${projectId}/resolve/${incidentId}`, data);
        if (multiple) {
            dispatch(resolveIncidentRequest({
                multiple: true,
                promise: promise
            }));
        } else {
            dispatch(resolveIncidentRequest({
                multiple: false,
                promise: promise
            }));
        }

        promise.then(function (incident) {
            if (multiple) {
                dispatch(resolveIncidentSuccess({
                    multiple: true,
                    data: incident.data
                }));
            } else {
                dispatch(resolveIncidentSuccess({
                    multiple: false,
                    data: incident.data
                }));
            }
            dispatch({
                type: 'RESOLVE_INCIDENT_SUCCESS',
                payload: incident.data
            });
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            if (multiple) {
                dispatch(incidentError({
                    multiple: true,
                    error: errors(error)
                }));
            } else {
                dispatch(incidentError({
                    multiple: false,
                    error: errors(error)
                }));
            }
        });
    };
}

export function closeIncidentRequest(promise) {
    return {
        type: types.CLOSE_INCIDENT_REQUEST,
        payload: promise
    };
}

export function closeIncidentError(error) {
    return {
        type: types.CLOSE_INCIDENT_FAILED,
        payload: error
    };
}

export function closeIncidentSuccess(incident) {
    return {
        type: types.CLOSE_INCIDENT_SUCCESS,
        payload: incident
    };
}

export function closeIncident(projectId, incidentId) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function (dispatch) {
        var promise = postApi(`incident/${projectId}/close/${incidentId}`, {});
        dispatch(closeIncidentRequest(promise))

        promise.then(function (incident) {
            dispatch(closeIncidentSuccess(incident.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(closeIncidentError(errors(error)))
        });
    };
}

// Unresolved Incidents Section

export function UnresolvedIncidentsRequest(promise) {
    return {
        type: types.UNRESOLVED_INCIDENTS_REQUEST,
        payload: promise
    };
}

export function UnresolvedIncidentsError(error) {
    return {
        type: types.UNRESOLVED_INCIDENTS_FAILED,
        payload: error
    };
}

export function UnresolvedIncidentsSuccess(incidents) {
    return {
        type: types.UNRESOLVED_INCIDENTS_SUCCESS,
        payload: incidents
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
    return function (dispatch) {
        var promise = null;

        promise = getApi(`incident/${projectId}/unresolvedincidents`);

        dispatch(UnresolvedIncidentsRequest(promise));

        promise.then(function (incidents) {
            dispatch(UnresolvedIncidentsSuccess(incidents.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(UnresolvedIncidentsError(errors(error)));
        });
    };
}

// Calls the API to delete incidents after deleting the project
export function deleteProjectIncidents(projectId) {
    return {
        type: types.DELETE_PROJECT_INCIDENTS,
        payload: projectId
    };
}


// Internal notes and investigation notes Section


export function investigationNoteRequest(promise) {
    return {
        type: types.INVESTIGATION_NOTE_REQUEST,
        payload: promise
    };
}

export function investigationNoteError(error) {
    return {
        type: types.INVESTIGATION_NOTE_FAILED,
        payload: error
    };
}

export function investigationNoteSuccess(incident) {
    return {
        type: types.INVESTIGATION_NOTE_SUCCESS,
        payload: incident
    };
}



export function setInvestigationNote(projectId, incidentId, investigationNote) {

    return function (dispatch) {
        var promise = null;
        var body = {};
        body.investigationNote = investigationNote;
        promise = putApi(`incident/${projectId}/incident/${incidentId}`, body);

        dispatch(investigationNoteRequest(promise));

        promise.then(function (incidents) {
            dispatch(investigationNoteSuccess(incidents.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(investigationNoteError(errors(error)));
        });
    };
}



export function internalNoteRequest(promise) {
    return {
        type: types.INTERNAL_NOTE_REQUEST,
        payload: promise
    };
}

export function internalNoteError(error) {
    return {
        type: types.INTERNAL_NOTE_FAILED,
        payload: error
    };
}

export function internalNoteSuccess(incident) {
    return {
        type: types.INTERNAL_NOTE_SUCCESS,
        payload: incident
    };
}

export function setinternalNote(projectId, incidentId, internalNote) {

    return function (dispatch) {
        var promise = null;
        var body = {};
        body.internalNote = internalNote;
        promise = putApi(`incident/${projectId}/incident/${incidentId}`, body);

        dispatch(internalNoteRequest(promise));

        promise.then(function (incidents) {
            dispatch(internalNoteSuccess(incidents.data));
        }, function (error) {
            if (error && error.response && error.response.data)
                error = error.response.data;
            if (error && error.data) {
                error = error.data;
            }
            if (error && error.message) {
                error = error.message;
            }
            else {
                error = 'Network Error';
            }
            dispatch(internalNoteError(errors(error)));
        });
    };
}

export function deleteIncidentSuccess(incidentId) {
    return {
        type: types.DELETE_INCIDENT_SUCCESS,
        payload: incidentId
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
        payload: error
    };
}

export function deleteIncidentReset(error) {
    return {
        type: types.DELETE_INCIDENT_RESET,
        payload: error
    };
}

//Delete an incident
export function deleteIncident(projectId, incidentId) {
    return function (dispatch) {

        var promise = deleteApi(`incident/${projectId}/${incidentId}`);
        dispatch(deleteIncidentRequest(incidentId));

        promise.then(function (incident) {

            dispatch(deleteIncidentSuccess(incident.data._id));
        }, function (error) {
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
            dispatch(deleteIncidentFailure({ error: errors(error), incidentId }));
        });

        return promise;

    };

}