import * as types from '../constants/emailTemplates';


const initialState = {
    emailTemplates: {
        requesting: false,
        error: null,
        success: false,
        templates: [],
    },
    editEmailTemplates:{
        requesting: false,
        error: null,
        success: false
    },
    resetEmailTemplates:{
        requesting: false,
        error: null,
        success: false
    },
    showingTemplate:{},
    revealVariable:'',
    emailSmtpConfiguration:{
        requesting: false,
        error: null,
        success: false,
        config:{}
    },
    emailSmtpDelete:{
        requesting: false,
        error: null,
        success: false
    },
    showEmailSmtpConfiguration : false,
};


export default function incident(state = initialState, action) {
    switch (action.type) {

        case types.EMAIL_TEMPLATES_SUCCESS:
            return Object.assign({}, state, {
                emailTemplates: {
                    requesting: false,
                    error: null,
                    success: true,
                    templates: action.payload,
                },
            });

        case types.EMAIL_TEMPLATES_REQUEST:
            return Object.assign({}, state, {
                emailTemplates: {
                    requesting: true,
                    error: null,
                    success: false,
                    templates: [],
                },
            });

        case types.EMAIL_TEMPLATES_FAILED:
            return Object.assign({}, state, {
                emailTemplates: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    templates: [],
                },
            });

        case types.EMAIL_TEMPLATES_RESET:
            return Object.assign({}, state, {
                emailTemplates: {
                    requesting: false,
                    error: null,
                    success: false,
                    templates: [],
                },
            });

        case types.EDIT_EMAIL_TEMPLATES_SUCCESS:
            return Object.assign({}, state, {
                emailTemplates: {
                    requesting: false,
                    error: null,
                    success: true,
                    templates: action.payload,
                },
                editEmailTemplates: {
                    requesting: false,
                    error: null,
                    success: true
                },
                showingTemplate: action.payload.find(temp => temp.emailType === state.showingTemplate.emailType)
            });

        case types.EDIT_EMAIL_TEMPLATES_REQUEST:
            return Object.assign({}, state, {
                editEmailTemplates: {
                    requesting: action.payload,
                    error: null,
                    success: false
                }
            });

        case types.EDIT_EMAIL_TEMPLATES_FAILED:
            return Object.assign({}, state, {
                editEmailTemplates: {
                    requesting: false,
                    error: action.payload,
                    success: false
                }
            });

        case types.EDIT_EMAIL_TEMPLATES_RESET:
            return Object.assign({}, state, {
                editEmailTemplates: {
                    requesting: false,
                    error: null,
                    success: false
                }
            });

        case types.RESET_EMAIL_TEMPLATES_SUCCESS:
            return Object.assign({}, state, {
                emailTemplates: {
                    requesting: false,
                    error: null,
                    success: true,
                    templates: action.payload,
                },
                resetEmailTemplates:{
                    requesting: false,
                    error: null,
                    success: false
                },
                showingTemplate: action.payload.find(temp => temp.emailType === state.showingTemplate.emailType)
            });

        case types.RESET_EMAIL_TEMPLATES_REQUEST:
            return Object.assign({}, state, {
                resetEmailTemplates:{
                    requesting: true,
                    error: null,
                    success: false
                }
            });

        case types.RESET_EMAIL_TEMPLATES_FAILED:
            return Object.assign({}, state, {
                resetEmailTemplates:{
                    requesting: false,
                    error: action.payload,
                    success: false
                }
            });

        case types.CHANGE_SHOWING_TEMPLATE:
            return Object.assign({}, state, {
                showingTemplate: state.emailTemplates.templates.find(temp => temp.emailType === action.payload)
            });

        case types.SET_REVEAL_VARIABLE:
            return Object.assign({}, state, {
                revealVariable: action.payload
            });

        case types.SET_SMTP_CONFIG:
            return Object.assign({}, state, {
                showEmailSmtpConfiguration: action.payload
            });

        case types.SMTP_CONFIG_SUCCESS:
            return Object.assign({}, state, {
                emailSmtpConfiguration:{
                    requesting: false,
                    error: null,
                    success: true,
                    config: action.payload
                },
            });

        case types.SMTP_CONFIG_FAILED:
            return Object.assign({}, state, {
                emailSmtpConfiguration:{
                    requesting: false,
                    error: action.payload,
                    success: false,
                    config:state.emailSmtpConfiguration.config
                },
            });

        case types.SMTP_CONFIG_REQUEST:
            return Object.assign({}, state, {
                emailSmtpConfiguration:{
                    requesting: true,
                    error: null,
                    success: false,
                    config: state.emailSmtpConfiguration.config
                },
                emailSmtpDelete:{
                    ...state.emailSmtpDelete,
                    error: null,
                }
            });

        case types.DELETE_SMTP_CONFIG_SUCCESS:
            return Object.assign({}, state, {
                emailSmtpDelete:{
                    requesting: false,
                    error: null,
                    success: true
                },
                emailSmtpConfiguration:{
                    requesting: false,
                    error: null,
                    success: false,
                    config: action.payload
                },
            });

        case types.DELETE_SMTP_CONFIG_FAILED:
            return Object.assign({}, state, {
                emailSmtpDelete:{
                    requesting: false,
                    error: action.payload,
                    success: false
                },
            });

        case types.DELETE_SMTP_CONFIG_REQUEST:
            return Object.assign({}, state, {
                emailSmtpDelete:{
                    requesting: true,
                    error: null,
                    success: false
                },
                emailSmtpConfiguration:{
                    ...state.emailSmtpConfiguration,
                    error: null,
                },
            });

            default: return state;
        }
    }
