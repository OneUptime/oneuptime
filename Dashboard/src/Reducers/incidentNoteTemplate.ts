import * as types from '../constants/incidentNoteTemplate';

import Action from 'CommonUI/src/types/action';

const initialState: $TSFixMe = {
    noteTemplates: {
        requesting: false,
        success: false,
        error: null,
        templates: [],
        count: 0,
        skip: 0,
        limit: 10,
    },
    createNoteTemplate: {
        requesting: false,
        success: false,
        error: null,
    },
    updateNoteTemplate: {
        requesting: false,
        success: false,
        error: null,
    },
    deleteNoteTemplate: {
        requesting: false,
        success: false,
        error: null,
    },
};

export default (state = initialState, action: Action): void => {
    switch (action.type) {
        case types.FETCH_INCIDENT_NOTE_TEMPLATES_REQUEST:
            return {
                ...state,
                noteTemplates: {
                    ...state.noteTemplates,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.FETCH_INCIDENT_NOTE_TEMPLATES_SUCCESS:
            return {
                ...state,
                noteTemplates: {
                    requesting: false,
                    success: true,
                    error: null,
                    templates: action.payload.data,
                    limit: action.payload.limit || 10,
                    skip: action.payload.skip || 0,
                    count: action.payload.count || 0,
                },
            };
        case types.FETCH_INCIDENT_NOTE_TEMPLATES_FAILURE:
            return {
                ...state,
                noteTemplates: {
                    ...state.noteTemplates,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.CREATE_INCIDENT_NOTE_TEMPLATE_REQUEST:
            return {
                ...state,
                createNoteTemplate: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.CREATE_INCIDENT_NOTE_TEMPLATE_SUCCESS:
            return {
                ...state,
                createNoteTemplate: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        case types.CREATE_INCIDENT_NOTE_TEMPLATE_FAILURE:
            return {
                ...state,
                createNoteTemplate: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.UPDATE_INCIDENT_NOTE_TEMPLATE_REQUEST:
            return {
                ...state,
                updateNoteTemplate: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.UPDATE_INCIDENT_NOTE_TEMPLATE_SUCCESS:
            return {
                ...state,
                updateNoteTemplate: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                noteTemplates: {
                    ...state.noteTemplates,
                    templates: state.noteTemplates.templates.map(
                        (template: $TSFixMe) => {
                            if (
                                String(template._id) ===
                                String(action.payload._id)
                            ) {
                                template = action.payload;
                            }
                            return template;
                        }
                    ),
                },
            };
        case types.UPDATE_INCIDENT_NOTE_TEMPLATE_FAILURE:
            return {
                ...state,
                updateNoteTemplate: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.DELETE_INCIDENT_NOTE_TEMPLATE_REQUEST:
            return {
                ...state,
                deleteNoteTemplate: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.DELETE_INCIDENT_NOTE_TEMPLATE_SUCCESS:
            return {
                ...state,
                deleteNoteTemplate: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        case types.DELETE_INCIDENT_NOTE_TEMPLATE_FAILURE:
            return {
                ...state,
                deleteNoteTemplate: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        default:
            return state;
    }
};
