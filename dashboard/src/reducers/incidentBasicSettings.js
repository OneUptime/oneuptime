import {
    FETCH_INCIDENT_BASIC_SETTINGS_REQUEST,
    FETCH_INCIDENT_BASIC_SETTINGS_SUCCESS,
    FETCH_INCIDENT_BASIC_SETTINGS_FAILURE,
    UPDATE_INCIDENT_BASIC_SETTINGS_REQUEST,
    UPDATE_INCIDENT_BASIC_SETTINGS_SUCCESS,
    UPDATE_INCIDENT_BASIC_SETTINGS_FAILURE,
    FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_REQUEST,
    FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_SUCCESS,
    FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_FAILURE,
} from '../constants/incidentBasicSettings';

const INITIAL_STATE = {
    incidentBasicSettings: {
        title: '',
        description: '',
    },
    fetchIncidentBasicSettings: {
        requesting: false,
        error: null,
        success: null,
    },
    updateIncidentBasicSettings: {
        requesting: false,
        error: null,
        success: null,
    },
    incidentBasicSettingsVariables:{
        incidentBasicSettingsVariables:[],
        requesting: false,
        error: null,
        success: null,
    }
};

export default (state = INITIAL_STATE, action) => {
    switch (action.type) {
        case FETCH_INCIDENT_BASIC_SETTINGS_REQUEST:
            return Object.assign({}, state, {
                fetchIncidentBasicSettings: {
                    ...state.fetchIncidentBasicSettings,
                    requesting: true,
                    error: null,
                    success: null,
                },
            });
        case FETCH_INCIDENT_BASIC_SETTINGS_SUCCESS:
            return Object.assign({}, state, {
                fetchIncidentBasicSettings: {
                    ...state.fetchIncidentBasicSettings,
                    requesting: false,
                    error: null,
                    success: true,
                },
                incidentBasicSettings: action.payload,
            });
        case FETCH_INCIDENT_BASIC_SETTINGS_FAILURE:
            return Object.assign({}, state, {
                fetchIncidentBasicSettings: {
                    ...state.fetchIncidentBasicSettings,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });
        case UPDATE_INCIDENT_BASIC_SETTINGS_REQUEST:
            return Object.assign({}, state, {
                updateIncidentBasicSettings: {
                    ...state.updateIncidentBasicSettings,
                    requesting: true,
                    error: null,
                    success: null,
                },
            });
        case UPDATE_INCIDENT_BASIC_SETTINGS_SUCCESS:
            return Object.assign({}, state, {
                updateIncidentBasicSettings: {
                    ...state.updateIncidentBasicSettings,
                    requesting: false,
                    error: null,
                    success: true,
                },
                incidentBasicSettings: action.payload,
            });
        case UPDATE_INCIDENT_BASIC_SETTINGS_FAILURE:
            return Object.assign({}, state, {
                updateIncidentBasicSettings: {
                    ...state.updateIncidentBasicSettings,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });
        case FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_REQUEST:
            return Object.assign({},state, {
                incidentBasicSettingsVariables:{
                    ...state.incidentBasicSettingsVariables,
                    requesting:true,
                    error: null,
                    success: null,
                }
            });
        case FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_SUCCESS:
            return Object.assign({},state, {
                incidentBasicSettingsVariables:{
                    ...state.incidentBasicSettingsVariables,
                    requesting:false,
                    error: null,
                    success: true,
                    incidentBasicSettingsVariables: action.payload
                }
            });
        case FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_FAILURE:
            return Object.assign({},state, {
                incidentBasicSettingsVariables:{
                    ...state.incidentBasicSettingsVariables,
                    requesting:false,
                    error: action.payload,
                    success: false,
                }
            });
        default:
            return state;
    }
};
