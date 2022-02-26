import {
    FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_REQUEST,
    FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_SUCCESS,
    FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_FAILURE,
    SET_REVEAL_VARIABLES_INCIDENT_BASIC_SETTINGS,
    FETCH_INCIDENT_TEMPLATES_REQUEST,
    FETCH_INCIDENT_TEMPLATES_SUCCESS,
    FETCH_INCIDENT_TEMPLATE_FAILURE,
    CREATE_INCIDENT_TEMPLATE_REQUEST,
    CREATE_INCIDENT_TEMPLATE_SUCCESS,
    CREATE_INCIDENT_TEMPLATE_FAILURE,
    UPDATE_INCIDENT_TEMPLATE_REQUEST,
    UPDATE_INCIDENT_TEMPALTE_SUCCESS,
    UPDATE_INCIDENT_TEMPLATE_FAILURE,
    DELETE_INCIDENT_TEMPLATE_REQUEST,
    DELETE_INCIDENT_TEMPLATE_SUCCESS,
    DELETE_INCIDENT_TEMPLATE_FAILURE,
    SET_DEFAULT_INCIDENT_TEMPLATE_REQUEST,
    SET_DEFAULT_INCIDENT_TEMPLATE_SUCCESS,
    SET_DEFAULT_INCIDENT_TEMPLATE_FAILURE,
    SET_ACTIVE_TEMPLATE,
    FETCH_DEFAULT_TEMPLATE_REQUEST,
    FETCH_DEFAULT_TEMPLATE_SUCCESS,
    FETCH_DEFAULT_TEMPLATE_FAILURE,
} from '../constants/incidentBasicSettings';

const INITIAL_STATE = {
    incidentBasicSettingsVariables: {
        incidentBasicSettingsVariables: [],
        requesting: false,
        error: null,
        success: null,
    },
    revealVariables: false,
    incidentTemplates: {
        requesting: false,
        success: false,
        error: null,
        templates: [],
        limit: 10,
        skip: 0,
        count: 0,
    },
    createIncidentTemplate: {
        requesting: false,
        success: false,
        error: null,
    },
    updateIncidentTemplate: {
        requesting: false,
        success: false,
        error: null,
    },
    deleteIncidentTemplate: {
        requesting: false,
        success: false,
        error: null,
    },
    setDefaultTemplate: {
        requesting: false,
        success: false,
        error: null,
    },
    activeTemplate: null,
    defaultTemplate: {
        requesting: false,
        success: false,
        error: null,
        template: {},
    },
};

export default (state = INITIAL_STATE, action: $TSFixMe) => {
    switch (action.type) {
        case FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_REQUEST:
            return Object.assign({}, state, {
                incidentBasicSettingsVariables: {
                    ...state.incidentBasicSettingsVariables,
                    requesting: true,
                    error: null,
                    success: null,
                },
            });
        case FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_SUCCESS:
            return Object.assign({}, state, {
                incidentBasicSettingsVariables: {
                    ...state.incidentBasicSettingsVariables,
                    requesting: false,
                    error: null,
                    success: true,
                    incidentBasicSettingsVariables: action.payload,
                },
            });
        case FETCH_INCIDENT_BASIC_SETTINGS_VARIABLES_FAILURE:
            return Object.assign({}, state, {
                incidentBasicSettingsVariables: {
                    ...state.incidentBasicSettingsVariables,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });
        case SET_REVEAL_VARIABLES_INCIDENT_BASIC_SETTINGS:
            return Object.assign({}, state, {
                revealVariables: action.payload,
            });
        case FETCH_INCIDENT_TEMPLATES_REQUEST:
            return {
                ...state,
                incidentTemplates: {
                    ...state.incidentTemplates,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case FETCH_INCIDENT_TEMPLATES_SUCCESS:
            return {
                ...state,
                incidentTemplates: {
                    requesting: false,
                    success: true,
                    error: null,
                    templates: action.payload.data,
                    limit: action.payload.limit || 10,
                    skip: action.payload.skip || 0,
                    count: action.payload.count || 0,
                },
            };
        case FETCH_INCIDENT_TEMPLATE_FAILURE:
            return {
                ...state,
                incidentTemplates: {
                    ...state.incidentTemplates,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case CREATE_INCIDENT_TEMPLATE_REQUEST:
            return {
                ...state,
                createIncidentTemplate: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case CREATE_INCIDENT_TEMPLATE_SUCCESS:
            return {
                ...state,
                createIncidentTemplate: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        case CREATE_INCIDENT_TEMPLATE_FAILURE:
            return {
                ...state,
                createIncidentTemplate: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case UPDATE_INCIDENT_TEMPLATE_REQUEST:
            return {
                ...state,
                updateIncidentTemplate: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case UPDATE_INCIDENT_TEMPALTE_SUCCESS:
            return {
                ...state,
                updateIncidentTemplate: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                incidentTemplates: {
                    ...state.incidentTemplates,
                    templates: state.incidentTemplates.templates.map(
                        template => {
                            if (
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                String(template._id) ===
                                String(action.payload._id)
                            ) {
                                return action.payload;
                            }
                            if (
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                String(template._id) !==
                                    String(action.payload._id) &&
                                action.payload.isDefault &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'isDefault' does not exist on type 'never... Remove this comment to see the full error message
                                template.isDefault
                            ) {
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'isDefault' does not exist on type 'never... Remove this comment to see the full error message
                                template.isDefault = false;
                            }
                            return template;
                        }
                    ),
                },
                defaultTemplate: {
                    ...state.defaultTemplate,
                    template: action.payload.isDefault
                        ? action.payload
                        : state.defaultTemplate.template,
                },
            };
        case UPDATE_INCIDENT_TEMPLATE_FAILURE:
            return {
                ...state,
                updateIncidentTemplate: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case DELETE_INCIDENT_TEMPLATE_REQUEST:
            return {
                ...state,
                deleteIncidentTemplate: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case DELETE_INCIDENT_TEMPLATE_SUCCESS:
            return {
                ...state,
                deleteIncidentTemplate: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        case DELETE_INCIDENT_TEMPLATE_FAILURE:
            return {
                ...state,
                deleteIncidentTemplate: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case SET_DEFAULT_INCIDENT_TEMPLATE_REQUEST:
            return {
                ...state,
                setDefaultTemplate: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case SET_DEFAULT_INCIDENT_TEMPLATE_SUCCESS:
            return {
                ...state,
                setDefaultTemplate: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                incidentTemplates: {
                    ...state.incidentTemplates,
                    templates: state.incidentTemplates.templates.map(
                        template => {
                            if (
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                String(template._id) ===
                                String(action.payload._id)
                            ) {
                                return action.payload;
                            }
                            if (
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                String(template._id) !==
                                    String(action.payload._id) &&
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'isDefault' does not exist on type 'never... Remove this comment to see the full error message
                                template.isDefault
                            ) {
                                // @ts-expect-error ts-migrate(2339) FIXME: Property 'isDefault' does not exist on type 'never... Remove this comment to see the full error message
                                template.isDefault = false;
                            }
                            return template;
                        }
                    ),
                },
                defaultTemplate: {
                    ...state.defaultTemplate,
                    template: action.payload,
                },
            };
        case SET_DEFAULT_INCIDENT_TEMPLATE_FAILURE:
            return {
                ...state,
                setDefaultTemplate: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case SET_ACTIVE_TEMPLATE:
            return {
                ...state,
                activeTemplate: action.payload,
            };
        case FETCH_DEFAULT_TEMPLATE_REQUEST:
            return {
                ...state,
                defaultTemplate: {
                    ...state.defaultTemplate,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case FETCH_DEFAULT_TEMPLATE_SUCCESS:
            return {
                ...state,
                defaultTemplate: {
                    requesting: false,
                    success: true,
                    error: null,
                    template: action.payload,
                },
            };
        case FETCH_DEFAULT_TEMPLATE_FAILURE:
            return {
                ...state,
                defaultTemplate: {
                    ...state.defaultTemplate,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        default:
            return state;
    }
};
