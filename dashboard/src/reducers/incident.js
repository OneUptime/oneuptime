import * as types from '../constants/incident'


const initialState = {
    incidents: {
        requesting: false,
        error: null,
        success: false,
        incidents: [],
        count: null,
        limit: null,
        skip: null
    },
    newIncident: {
        requesting: false,
        error: null,
        success: false
    },
    incident: {
        requesting: false,
        error: null,
        success: false,
        incident: null,
        deleteIncident: {
            requesting: false,
            error: null,
            success: false
        }
    },
    investigationNotes: {
        requesting: false,
        error: null,
        success: false,
    },
    internalNotes: {
        requesting: false,
        error: null,
        success: false,
    },
    unresolvedincidents: {
        requesting: false,
        error: null,
        success: false,
        incidents: [],
    },
    closeincident: {
        requesting: false,
        error: null,
        success: false,
    }
};


export default function incident(state = initialState, action) {
    let incidents, isExistingIncident;
    switch (action.type) {

        case types.INCIDENTS_SUCCESS:
            return Object.assign({}, state, {
                incidents: {
                    requesting: false,
                    error: null,
                    success: true,
                    incidents: action.payload,
                },
            });

        case types.INCIDENTS_REQUEST:
            return Object.assign({}, state, {
                incidents: {
                    requesting: true,
                    success: false,
                    error: null,
                    count: null,
                    limit: null,
                    skip: null
                }
            });


        case types.INCIDENTS_FAILED:
            return Object.assign({}, state, {
                incidents: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    incidents: [],
                    count: null,
                    limit: null,
                    skip: null
                },
            });

        case types.INCIDENTS_RESET:
            return Object.assign({}, state, {
                incidents: {
                    requesting: false,
                    error: null,
                    success: false,
                    incidents: [],
                    count: null,
                    limit: null,
                    skip: null
                },
            });

        case types.CREATE_INCIDENT_RESET:
            return Object.assign({}, state, {
                newIncident: initialState.newIncident
            });

        case types.CREATE_INCIDENT_SUCCESS:
            isExistingIncident = state.incidents.incidents.find(incident => incident._id === action.payload.projectId);
            return Object.assign({}, state, {
                newIncident: {
                    requesting: false,
                    error: null,
                    success: false,
                },
                incidents: {
                    incidents: isExistingIncident ? state.incidents.incidents.length > 0 ? state.incidents.incidents.map((incident) => {
                        return incident._id === action.payload.projectId ?
                            {
                                _id: action.payload.projectId,
                                incidents: [action.payload, ...incident.incidents.filter((inc, index) => index < 9)],
                                count: incident.count + 1,
                                skip: incident.skip,
                                limit: incident.limit
                            }
                            : incident
                    }) : [{ _id: action.payload.projectId, incidents: [action.payload], count: 1, skip: 0, limit: 0 }]
                        : state.incidents.incidents.concat([{ _id: action.payload.projectId, incidents: [action.payload], count: 1, skip: 0, limit: 0 }]),
                    error: null,
                    requesting: false,
                    success: true
                }
            });

        case types.CREATE_INCIDENT_REQUEST:
            return Object.assign({}, state, {
                newIncident: {
                    requesting: true,
                    success: false,
                    error: null
                }
            });

        case types.CREATE_INCIDENT_FAILED:
            return Object.assign({}, state, {
                newIncident: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.INCIDENT_SUCCESS:
            return Object.assign({}, state, {
                incident: {
                    requesting: false,
                    error: null,
                    success: true,
                    incident: action.payload
                },
            });

        case types.INCIDENT_REQUEST:
            return Object.assign({}, state, {
                incident: {
                    requesting: true,
                    success: false,
                    error: null,
                    incident: null
                }
            });


        case types.INCIDENT_FAILED:
            if (action.payload.multiple)
                return Object.assign({}, state, {
                    unresolvedincidents: {
                        requesting: false,
                        error: action.payload.error,
                        success: false,
                        incidents: state.unresolvedincidents.incidents
                    },
                })
            else
                return Object.assign({}, state, {
                    incident: {
                        requesting: false,
                        error: action.payload.error,
                        success: false,
                        incident: []
                    },
                })


        case types.INCIDENT_RESET:
            return Object.assign({}, state, {
                incident: {
                    requesting: false,
                    error: null,
                    success: false,
                    incident: null
                },
            });

        case types.PROJECT_INCIDENTS_SUCCESS:
            return Object.assign({}, state, {
                incidents: {
                    incidents: state.incidents.incidents.map((incident) => {
                        return incident._id === action.payload.projectId ?
                            {
                                _id: action.payload.projectId,
                                incidents: [...action.payload.data],
                                count: action.payload.count,
                                skip: action.payload.skip,
                                limit: action.payload.limit
                            }
                            : incident
                    }),
                    error: null,
                    requesting: false,
                    success: true
                },
            });

        case types.PROJECT_INCIDENTS_REQUEST:
            return Object.assign({}, state, {
                incidents: {
                    requesting: true,
                    success: false,
                    error: null,
                    incidents: state.incidents.incidents
                }
            });


        case types.PROJECT_INCIDENTS_FAILED:
            return Object.assign({}, state, {
                incidents: {
                    requesting: false,
                    error: action.payload.error,
                    success: false,
                    incidents: state.incidents.incidents
                },
            });


        case types.PROJECT_INCIDENTS_RESET:
            return Object.assign({}, state, {
                incidents: {
                    requesting: false,
                    error: null,
                    success: false,
                    incidents: state.incidents.incidents
                },
            });

        case types.ACKNOWLEDGE_INCIDENT_SUCCESS:
            if (action.payload.multiple) {
                return Object.assign({}, state, {
                    unresolvedincidents: {
                        requesting: false,
                        error: null,
                        success: true,
                        incidents: state.unresolvedincidents.incidents.map(incident => {
                            if (incident._id === action.payload.data._id) {
                                return action.payload.data;
                            } else {
                                return incident;
                            }
                        })
                    },
                })
            } else {
                return Object.assign({}, state, {
                    incident: {
                        requesting: false,
                        error: null,
                        success: true,
                        incident: action.payload.data
                    },
                    unresolvedincidents: {
                        requesting: false,
                        error: null,
                        success: true,
                        incidents: state.unresolvedincidents.incidents.map(incident => {
                            if (incident._id === action.payload.data._id) {
                                return action.payload.data;
                            } else {
                                return incident;
                            }
                        })
                    },
                })
            }

        case types.RESOLVE_INCIDENT_SUCCESS:
            if (action.payload.multiple) {
                return Object.assign({}, state, {
                    unresolvedincidents: {
                        requesting: false,
                        error: null,
                        success: true,
                        incidents: state.unresolvedincidents.incidents.map(incident => {
                            if (incident._id === action.payload.data._id) {
                                return action.payload.data;
                            } else {
                                return incident;
                            }
                        })
                    },
                })
            } else {
                return Object.assign({}, state, {
                    incident: {
                        requesting: false,
                        error: null,
                        success: true,
                        incident: action.payload.data
                    },
                    unresolvedincidents: {
                        requesting: false,
                        error: null,
                        success: true,
                        incidents: state.unresolvedincidents.incidents.map(incident => {
                            if (incident._id === action.payload.data._id) {
                                return action.payload.data;
                            } else {
                                return incident;
                            }
                        })
                    },
                })
            }

        case types.ACKNOWLEDGE_INCIDENT_REQUEST:
            if (action.payload.multiple) {
                return Object.assign({}, state, {
                    unresolvedincidents: {
                        ...state.unresolvedincidents,
                        requesting: true,
                        success: false,
                        error: null,
                    },
                })
            } else {
                return Object.assign({}, state, {
                    incident: {
                        ...state.incident,
                        requesting: true,
                        success: false,
                        error: null,
                    },
                })
            }

        case types.RESOLVE_INCIDENT_REQUEST:
            if (action.payload.multiple) {
                return Object.assign({}, state, {
                    unresolvedincidents: {
                        ...state.unresolvedincidents,
                        requesting: true,
                        success: false,
                        error: null,
                    },
                })
            } else {
                return Object.assign({}, state, {
                    incident: {
                        ...state.incident,
                        requesting: true,
                        success: false,
                        error: null,
                    },
                })
            }

        case types.UNRESOLVED_INCIDENTS_SUCCESS:
            return Object.assign({}, state, {
                unresolvedincidents: {
                    requesting: false,
                    error: null,
                    success: true,
                    incidents: action.payload
                },
            });

        case types.UNRESOLVED_INCIDENTS_REQUEST:
            return Object.assign({}, state, {
                unresolvedincidents: {
                    requesting: true,
                    success: false,
                    error: null,
                    incidents: null
                }
            });

        case types.UNRESOLVED_INCIDENTS_FAILED:
            return Object.assign({}, state, {
                unresolvedincidents: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    incidents: []
                },
            });

        case types.UNRESOLVED_INCIDENTS_RESET:
            return Object.assign({}, state, {
                unresolvedincidents: {
                    requesting: false,
                    error: null,
                    success: false,
                    incidents: []
                },
            });

        case types.DELETE_PROJECT_INCIDENTS:
            incidents = Object.assign([], state.incidents);
            incidents = incidents.filter(incident => incident.projectId !== action.payload);
            return Object.assign({}, state, {
                incidents: {
                    requesting: false,
                    error: null,
                    success: false,
                    incidents,
                    count: null,
                    limit: null,
                    skip: null
                },
            });

        case types.INTERNAL_NOTE_SUCCESS:
            return Object.assign({}, state, {
                incident: {
                    ...state.incident,
                    incident: action.payload,
                },
                internalNotes: {
                    requesting: false,
                    success: true,
                    error: null,
                }
            });

        case types.INTERNAL_NOTE_REQUEST:
            return Object.assign({}, state, {
                internalNotes: {
                    requesting: true,
                    success: false,
                    error: null,
                }
            });


        case types.INTERNAL_NOTE_FAILED:
            return Object.assign({}, state, {
                internalNotes: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case types.INVESTIGATION_NOTE_SUCCESS:
            return Object.assign({}, state, {
                incident: {
                    ...state.incident,
                    incident: action.payload,
                },
                investigationNotes: {
                    requesting: false,
                    success: true,
                    error: null,
                }
            });

        case types.INVESTIGATION_NOTE_REQUEST:
            return Object.assign({}, state, {
                investigationNotes: {
                    requesting: true,
                    success: false,
                    error: null,
                }
            });


        case types.INVESTIGATION_NOTE_FAILED:
            return Object.assign({}, state, {
                investigationNotes: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                }
            });

        case 'INCIDENT_RESOLVED_BY_SOCKET':
            return Object.assign({}, state, {
                unresolvedincidents: {
                    requesting: false,
                    error: null,
                    success: true,
                    incidents: state.unresolvedincidents.incidents.map(incident => {
                        if (incident._id === action.payload.data._id) {
                            return action.payload.data;
                        } else {
                            return incident;
                        }
                    })
                },
                incident: {
                    requesting: false,
                    error: null,
                    success: true,
                    incident: state.incident.incident && state.incident.incident._id === action.payload.data._id ? action.payload.data : state.incident.incident
                },
            });

        case 'INCIDENT_ACKNOWLEDGED_BY_SOCKET':
            return Object.assign({}, state, {
                unresolvedincidents: {
                    requesting: false,
                    error: null,
                    success: true,
                    incidents: state.unresolvedincidents.incidents.map(incident => {
                        if (incident._id === action.payload.data._id) {
                            return action.payload.data;
                        } else {
                            return incident;
                        }
                    })
                },
                incident: {
                    requesting: false,
                    error: null,
                    success: true,
                    incident: state.incident.incident && state.incident.incident._id === action.payload.data._id ? action.payload.data : state.incident.incident
                },
            });

        case 'DELETE_MONITOR_BY_SOCKET':
            return Object.assign({}, state, {
                unresolvedincidents: {
                    ...state.unresolvedincidents,
                    incidents: state.unresolvedincidents.incidents.filter(incident => {
                        if (incident.monitorId._id === action.payload) {
                            return false;
                        } else {
                            return true;
                        }
                    })
                },
            });

        case 'ADD_NEW_INCIDENT_TO_UNRESOLVED':
            return Object.assign({}, state, {
                unresolvedincidents: {
                    ...state.unresolvedincidents,
                    incidents: [action.payload].concat(state.unresolvedincidents.incidents)
                },
            });

        case 'UPDATE_INCIDENTS_MONITOR_NAME':
            return Object.assign({}, state, {
                unresolvedincidents: {
                    ...state.unresolvedincidents,
                    incidents: state.unresolvedincidents.incidents.map(incident => {
                        if (incident.monitorId._id === action.payload._id) {
                            return {
                                ...incident,
                                monitorId: {
                                    ...incident.monitorId,
                                    name: action.payload.name
                                }
                            }
                        } else {
                            return incident;
                        }
                    })
                },
            });

        case types.CLOSE_INCIDENT_SUCCESS:
            return Object.assign({}, state, {
                unresolvedincidents: {
                    requesting: false,
                    error: null,
                    success: true,
                    incidents: state.unresolvedincidents.incidents.filter(incident => {
                        if (incident._id === action.payload._id) {
                            return false;
                        } else {
                            return true;
                        }
                    })
                },
                closeincident: {
                    requesting: false,
                    success: true,
                    error: null,
                }
            })

        case types.CLOSE_INCIDENT_REQUEST:
            return Object.assign({}, state, {
                closeincident: {
                    requesting: true,
                    success: false,
                    error: null,
                }
            });

        case types.CLOSE_INCIDENT_FAILED:
            return Object.assign({}, state, {
                closeincident: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case types.DELETE_INCIDENT_SUCCESS:
            return Object.assign({}, state, {
                incident: {
                    ...state.incident,
                    deleteIncident:{
                        requesting: false,
                        success: true,
                        error: null
                    }
                },
                unresolvedincidents: {
                    ...state.unresolvedincidents,
                    incidents: state.unresolvedincidents.incidents.filter(incident => incident._id !== action.payload)
                },
            })

        case types.DELETE_INCIDENT_FAILURE:
            return Object.assign({}, state, {
                incident: {
                    ...state.incident,
                    deleteIncident:{
                        requesting: false,
                        success: false,
                        error: action.payload
                    }
                }
            })

        case types.DELETE_INCIDENT_REQUEST:
            return Object.assign({}, state, {
                incident: {
                    ...state.incident,
                    deleteIncident:{
                        requesting: true,
                        success: false,
                        error: null
                    }
                }
            })

        case types.DELETE_INCIDENT_RESET:
            return Object.assign({}, state, {
                incident: {
                    ...state.incident,
                    deleteIncident:{
                        requesting: false,
                        success: false,
                        error: null
                    }
                }
            })
        default: return state;
    }
}
