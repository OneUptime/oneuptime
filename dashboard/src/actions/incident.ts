import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/incident';
import errors from '../errors';

//Array of Incidents

export function projectIncidentsRequest(promise: $TSFixMe) {
    return {
        type: types.PROJECT_INCIDENTS_REQUEST,
        payload: promise,
    };
}

export function projectIncidentsError(error: $TSFixMe) {
    return {
        type: types.PROJECT_INCIDENTS_FAILED,
        payload: error,
    };
}

export function projectIncidentsSuccess(incidents: $TSFixMe) {
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
export function getProjectIncidents(
    projectId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function(dispatch: $TSFixMe) {
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
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    skip = parseInt(skip);
    limit = parseInt(limit);

    return function(dispatch: $TSFixMe) {
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
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                const data = incidents.data;
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                data.count = incidents.data.data.count;
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function incidentsRequest(promise: $TSFixMe) {
    return {
        type: types.INCIDENTS_REQUEST,
        payload: promise,
    };
}

export function incidentsError(error: $TSFixMe) {
    return {
        type: types.INCIDENTS_FAILED,
        payload: error,
    };
}

export function incidentsSuccess(incidents: $TSFixMe) {
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
export function getIncidents(projectId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`incident/${projectId}`);
        dispatch(incidentsRequest(promise));

        promise.then(
            function(incidents) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
export function getComponentIncidents(
    projectId: $TSFixMe,
    componentId: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
            `incident/${projectId}/${componentId}/incidents`
        );
        dispatch(incidentsRequest(promise));

        promise.then(
            function(incidents) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function createIncidentRequest(projectId: $TSFixMe) {
    return {
        type: types.CREATE_INCIDENT_REQUEST,
        payload: projectId,
    };
}

export function createIncidentError(error: $TSFixMe) {
    return {
        type: types.CREATE_INCIDENT_FAILED,
        payload: error,
    };
}

export function createIncidentSuccess(incident: $TSFixMe) {
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
    return function(dispatch: $TSFixMe) {
        dispatch(resetCreateIncident());
    };
};

// Calls the API to create new incident.
export function createNewIncident(
    projectId: $TSFixMe,
    monitors: $TSFixMe,
    incidentType: $TSFixMe,
    title: $TSFixMe,
    description: $TSFixMe,
    incidentPriority: $TSFixMe,
    customFields: $TSFixMe
) {
    return async function(dispatch: $TSFixMe) {
        const promise = postApi(`incident/${projectId}/create-incident`, {
            monitors,
            projectId,
            incidentType,
            title,
            description,
            incidentPriority,
            customFields,
        });

        dispatch(createIncidentRequest(projectId));

        promise.then(
            function(createIncident) {
                dispatch({
                    type: 'ADD_NEW_INCIDENT_TO_UNRESOLVED',
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    payload: createIncident.data,
                });
                dispatch({
                    type: 'ADD_NEW_INCIDENT_TO_MONITORS',
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    payload: createIncident.data,
                });
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(createIncidentSuccess(createIncident.data));
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
            }
        );

        return promise;
    };
}

// incident portion

export function incidentRequest(promise: $TSFixMe) {
    return {
        type: types.INCIDENT_REQUEST,
        payload: promise,
    };
}

export function incidentError(error: $TSFixMe) {
    return {
        type: types.INCIDENT_FAILED,
        payload: error,
    };
}

export function incidentSuccess(incident: $TSFixMe) {
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

export function acknowledgeIncidentRequest(promise: $TSFixMe) {
    return {
        type: types.ACKNOWLEDGE_INCIDENT_REQUEST,
        payload: promise,
    };
}

export function resolveIncidentRequest(promise: $TSFixMe) {
    return {
        type: types.RESOLVE_INCIDENT_REQUEST,
        payload: promise,
    };
}

export function acknowledgeIncidentSuccess(incident: $TSFixMe) {
    return {
        type: types.ACKNOWLEDGE_INCIDENT_SUCCESS,
        payload: incident,
    };
}

export function resolveIncidentSuccess(incident: $TSFixMe) {
    return {
        type: types.RESOLVE_INCIDENT_SUCCESS,
        payload: incident,
    };
}

// Calls the API to get the incident to show
export function getIncident(projectId: $TSFixMe, incidentSlug: $TSFixMe) {
    //This fucntion will switch to incidentSlug of the params beig passed.
    return function(dispatch: $TSFixMe) {
        let promise = null;
        promise = getApi(`incident/${projectId}/incident/${incidentSlug}`);
        dispatch(incidentRequest(promise));

        promise.then(
            function(incident) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function addIncident(incident: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        dispatch(incidentSuccess(incident));
    };
}
// Calls the API to get the incident timeline
export function getIncidentTimeline(
    projectId: $TSFixMe,
    incidentId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        let promise = null;
        promise = getApi(
            `incident/${projectId}/timeline/${incidentId}?skip=${skip}&limit=${limit}`
        );
        dispatch(incidentTimelineRequest(promise));

        promise.then(
            function(timeline) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function incidentTimelineRequest(promise: $TSFixMe) {
    return {
        type: types.INCIDENT_TIMELINE_REQUEST,
        payload: promise,
    };
}

export function incidentTimelineSuccess(timeline: $TSFixMe) {
    return {
        type: types.INCIDENT_TIMELINE_SUCCESS,
        payload: timeline,
    };
}

export function incidentTimelineError(error: $TSFixMe) {
    return {
        type: types.INCIDENT_TIMELINE_FAILED,
        payload: error,
    };
}

export function setActiveIncident(incidentId: $TSFixMe) {
    return {
        type: 'SET_ACTIVE_INCIDENT',
        payload: incidentId,
    };
}

// calls the api to post acknowledgement data to the database
export function acknowledgeIncident(
    projectId: $TSFixMe,
    incidentId: $TSFixMe,
    userId: $TSFixMe,
    multiple: $TSFixMe
) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function(dispatch: $TSFixMe) {
        let promise = null;
        const data = {
            decoded: userId,
            projectId,
            incidentId,
        };

        dispatch(setActiveIncident(incidentId));

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
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            data: result.data.incident,
                        })
                    );
                } else {
                    dispatch(
                        acknowledgeIncidentSuccess({
                            multiple: false,
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            data: result.data.incident,
                        })
                    );
                }
                dispatch({
                    type: 'ACKNOWLEDGE_INCIDENT_SUCCESS',
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    payload: result.data.incident,
                });
                dispatch(
                    fetchIncidentMessagesSuccess({
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        incidentId: result.data.incident.idNumber, // The incidentID needed is no longer objectID from DB but incident serial ID e.g 1
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        incidentMessages: result.data.data,
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        count: result.data.data.length,
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        type: result.data.type,
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        incidentSlug: result.data.incident.incidentSlug,
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
export function resolveIncident(
    projectId: $TSFixMe,
    incidentId: $TSFixMe,
    userId: $TSFixMe,
    multiple: $TSFixMe
) {
    //This function will switch to incidentId of the params being passed.
    return function(dispatch: $TSFixMe) {
        let promise = null;
        const data = {
            decoded: userId,
            projectId,
            incidentId,
        };

        dispatch(setActiveIncident(incidentId));

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
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            data: result.data.incident,
                        })
                    );
                } else {
                    dispatch(
                        resolveIncidentSuccess({
                            multiple: false,
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            data: result.data.incident,
                        })
                    );
                }
                dispatch({
                    type: 'RESOLVE_INCIDENT_SUCCESS',
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                    payload: result.data.incident,
                });
                dispatch(
                    fetchIncidentMessagesSuccess({
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        incidentId: result.data.incident.idNumber, // The incidentID needed is no longer objectID from DB but incident serial ID e.g 1
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        incidentMessages: result.data.data,
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        count: result.data.data.length,
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        type: result.data.type,
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        incidentSlug: result.data.incident.incidentSlug,
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

export function closeIncidentRequest(incidentId: $TSFixMe) {
    return {
        type: types.CLOSE_INCIDENT_REQUEST,
        payload: incidentId,
    };
}

export function closeIncidentError(error: $TSFixMe) {
    return {
        type: types.CLOSE_INCIDENT_FAILED,
        payload: error,
    };
}

export function closeIncidentSuccess(incident: $TSFixMe) {
    return {
        type: types.CLOSE_INCIDENT_SUCCESS,
        payload: incident,
    };
}

export function closeIncident(projectId: $TSFixMe, incidentId: $TSFixMe) {
    //This function will switch to incidentId of the params beig passed.
    return function(dispatch: $TSFixMe) {
        const promise = postApi(
            `incident/${projectId}/close/${incidentId}`,
            {}
        );
        dispatch(closeIncidentRequest(incidentId));

        promise.then(
            function(incident) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function UnresolvedIncidentsRequest(promise: $TSFixMe) {
    return {
        type: types.UNRESOLVED_INCIDENTS_REQUEST,
        payload: promise,
    };
}

export function UnresolvedIncidentsError(error: $TSFixMe) {
    return {
        type: types.UNRESOLVED_INCIDENTS_FAILED,
        payload: error,
    };
}

export function UnresolvedIncidentsSuccess(incidents: $TSFixMe) {
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
export function fetchUnresolvedIncidents(projectId: $TSFixMe, isHome = false) {
    //This fucntion will switch to incidentId of the params beig passed.
    return function(dispatch: $TSFixMe) {
        let promise = null;

        promise = getApi(
            `incident/${projectId}/unresolvedincidents?isHome=${isHome}`
        );

        dispatch(UnresolvedIncidentsRequest(promise));

        promise.then(
            function(incidents) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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
export function deleteProjectIncidents(projectId: $TSFixMe) {
    return {
        type: types.DELETE_PROJECT_INCIDENTS,
        payload: projectId,
    };
}

// Internal notes and investigation notes Section

export function investigationNoteRequest(promise: $TSFixMe, updated: $TSFixMe) {
    return {
        type: types.INVESTIGATION_NOTE_REQUEST,
        payload: { promise, updated },
    };
}

export function investigationNoteError(error: $TSFixMe, updated: $TSFixMe) {
    return {
        type: types.INVESTIGATION_NOTE_FAILED,
        payload: { error, updated },
    };
}

export function investigationNoteSuccess(incidentMessage: $TSFixMe) {
    return {
        type: types.INVESTIGATION_NOTE_SUCCESS,
        payload: incidentMessage,
    };
}

export function setInvestigationNote(
    projectId: $TSFixMe,
    incidentId: $TSFixMe,
    body: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        let promise = null;

        promise = postApi(
            `incident/${projectId}/incident/${incidentId}/message`,
            body
        );

        const isUpdate = body.id ? true : false;

        dispatch(investigationNoteRequest(promise, isUpdate));

        promise.then(
            function(incidents) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function internalNoteRequest(promise: $TSFixMe, updated: $TSFixMe) {
    return {
        type: types.INTERNAL_NOTE_REQUEST,
        payload: { promise, updated },
    };
}

export function internalNoteError(error: $TSFixMe, updated: $TSFixMe) {
    return {
        type: types.INTERNAL_NOTE_FAILED,
        payload: { error, updated },
    };
}

export function internalNoteSuccess(incident: $TSFixMe) {
    return {
        type: types.INTERNAL_NOTE_SUCCESS,
        payload: incident,
    };
}

export function setInternalNote(
    projectId: $TSFixMe,
    incidentId: $TSFixMe,
    body: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        let promise = null;
        promise = postApi(
            `incident/${projectId}/incident/${incidentId}/message`,
            body
        );

        const isUpdate = body.id ? true : false;

        dispatch(internalNoteRequest(promise, isUpdate));

        promise.then(
            function(incidents) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                if (incidents.data.type === 'internal') {
                    dispatch(
                        fetchIncidentMessagesSuccess({
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            incidentId: incidents.data.idNumber,
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            incidentMessages: incidents.data.data,
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            count: incidents.data.data.length,
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            type: incidents.data.type,
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            incidentSlug: incidents.data.incidentSlug,
                        })
                    );
                } else {
                    // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function deleteIncidentSuccess(incidentId: $TSFixMe) {
    return {
        type: types.DELETE_INCIDENT_SUCCESS,
        payload: incidentId,
    };
}

export function deleteIncidentRequest(incidentId: $TSFixMe) {
    return {
        type: types.DELETE_INCIDENT_REQUEST,
        payload: incidentId,
    };
}

export function deleteIncidentFailure(error: $TSFixMe) {
    return {
        type: types.DELETE_INCIDENT_FAILURE,
        payload: error,
    };
}

export function deleteIncidentReset(error: $TSFixMe) {
    return {
        type: types.DELETE_INCIDENT_RESET,
        payload: error,
    };
}

//Delete an incident
export function deleteIncident(projectId: $TSFixMe, incidentId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const promise = deleteApi(`incident/${projectId}/${incidentId}`);
        dispatch(deleteIncidentRequest(incidentId));

        promise.then(
            function(incident) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

function hideIncidentSuccess(data: $TSFixMe) {
    return {
        type: types.HIDE_INCIDENT_SUCCESS,
        payload: data,
    };
}

function hideIncidentFailure(error: $TSFixMe) {
    return {
        type: types.HIDE_INCIDENT_FAILED,
        payload: error,
    };
}

// hide an incident
export function hideIncident(data: $TSFixMe) {
    const { hideIncident, incidentId, projectId } = data;
    return function(dispatch: $TSFixMe) {
        const promise = putApi(`incident/${projectId}/${incidentId}`, {
            hideIncident,
        });
        promise.then(
            function(incident) {
                dispatch(hideIncidentSuccess(incident));
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
                    hideIncidentFailure({ error: errors(error), incidentId })
                );
            }
        );

        return promise;
    };
}

export function fetchIncidentMessages(
    projectId: $TSFixMe,
    incidentSlug: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe,
    type = 'investigation'
) {
    skip = parseInt(skip);
    limit = parseInt(limit);
    return function(dispatch: $TSFixMe) {
        const promise = getApi(
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
            function(response) {
                dispatch(
                    fetchIncidentMessagesSuccess({
                        incidentId: incidentSlug,
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        incidentMessages: response.data.data,
                        skip,
                        limit,
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                        count: response.data.count,
                        type,
                        incidentSlug: incidentSlug,
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
                        incidentId: incidentSlug,
                        error: errors(error),
                        incidentSlug,
                    })
                );
            }
        );

        return promise;
    };
}

export function fetchIncidentMessagesSuccess(incidentMessages: $TSFixMe) {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_SUCCESS,
        payload: incidentMessages,
    };
}

export function fetchIncidentMessagesRequest(incidentId: $TSFixMe) {
    return {
        type: types.FETCH_INCIDENT_MESSAGES_REQUEST,
        payload: incidentId,
    };
}

export function fetchIncidentMessagesFailure(error: $TSFixMe) {
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
export function editIncidentMessageSwitch(index: $TSFixMe) {
    return {
        type: types.EDIT_INCIDENT_MESSAGE_SWITCH,
        payload: index,
    };
}

export function deleteIncidentMessage(
    projectId: $TSFixMe,
    incidentId: $TSFixMe,
    incidentMessageId: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        // @ts-expect-error ts-migrate(2554) FIXME: Expected 2 arguments, but got 1.
        const promise = deleteApi(
            `incident/${projectId}/incident/${incidentId}/message/${incidentMessageId}`
        );
        dispatch(deleteIncidentMessageRequest(incidentMessageId));

        promise.then(
            function(incidentMessage) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                if (incidentMessage.data.type === 'internal') {
                    dispatch(
                        fetchIncidentMessagesSuccess({
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            incidentId: incidentMessage.data.idNumber,
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            incidentMessages: incidentMessage.data.data,
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            count: incidentMessage.data.data.length,
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            type: incidentMessage.data.type,
                            // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                            incidentSlug: incidentMessage.data.incidentSlug,
                        })
                    );
                } else {
                    dispatch(
                        // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

export function deleteIncidentMessageSuccess(removedIncidentMessage: $TSFixMe) {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_SUCCESS,
        payload: removedIncidentMessage,
    };
}

export function deleteIncidentMessageRequest(incidentMessageId: $TSFixMe) {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_REQUEST,
        payload: incidentMessageId,
    };
}

export function deleteIncidentMessageFailure(error: $TSFixMe) {
    return {
        type: types.DELETE_INCIDENT_MESSAGE_FAILURE,
        payload: error,
    };
}

export function updateIncident(
    projectId: $TSFixMe,
    incidentId: $TSFixMe,
    incidentType: $TSFixMe,
    title: $TSFixMe,
    description: $TSFixMe,
    incidentPriority: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
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
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
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

function updateIncidentSuccess(data: $TSFixMe) {
    return {
        type: types.UPDATE_INCIDENT_SUCCESS,
        payload: data,
    };
}

function updateIncidentFailure(error: $TSFixMe) {
    return {
        type: types.UPDATE_INCIDENT_FAILED,
        payload: error,
    };
}
