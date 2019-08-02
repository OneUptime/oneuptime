import * as types from '../constants/smstemplates';


const initialState = {
    smsTemplates: {
        requesting: false,
        error: null,
        success: false,
        templates: [],
    },
    editSmsTemplates:{
        requesting: false,
        error: null,
        success: false
    },
    resetSmsTemplates:{
        requesting: false,
        error: null,
        success: false
    },
    showingTemplate:{},
    revealVariable:'',
    smsSmtpConfiguration:{
        requesting: false,
        error: null,
        success: false,
        config:{}
    },
    smsSmtpDelete:{
        requesting: false,
        error: null,
        success: false
    },
    showSmsSmtpConfiguration : false,
};


export default function incident(state = initialState, action) {
    switch (action.type) {

        case types.SMS_TEMPLATES_SUCCESS:
            return Object.assign({}, state, {
                smsTemplates: {
                    requesting: false,
                    error: null,
                    success: true,
                    templates: action.payload,
                },
            });

        case types.SMS_TEMPLATES_REQUEST:
            return Object.assign({}, state, {
                smsTemplates: {
                    requesting: true,
                    error: null,
                    success: false,
                    templates: [],
                },
            });

        case types.SMS_TEMPLATES_FAILED:
            return Object.assign({}, state, {
                smsTemplates: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    templates: [],
                },
            });

        case types.SMS_TEMPLATES_RESET:
            return Object.assign({}, state, {
                smsTemplates: {
                    requesting: false,
                    error: null,
                    success: false,
                    templates: [],
                },
            });

        case types.EDIT_SMS_TEMPLATES_SUCCESS:
            return Object.assign({}, state, {
                smsTemplates: {
                    requesting: false,
                    error: null,
                    success: true,
                    templates: action.payload,
                },
                editSmsTemplates: {
                    requesting: false,
                    error: null,
                    success: true
                },
                showingTemplate: action.payload.find(temp => temp.smsType === state.showingTemplate.smsType)
            });

        case types.EDIT_SMS_TEMPLATES_REQUEST:
            return Object.assign({}, state, {
                editSmsTemplates: {
                    requesting: action.payload,
                    error: null,
                    success: false
                }
            });

        case types.EDIT_SMS_TEMPLATES_FAILED:
            return Object.assign({}, state, {
                editSmsTemplates: {
                    requesting: false,
                    error: action.payload,
                    success: false
                }
            });

        case types.EDIT_SMS_TEMPLATES_RESET:
            return Object.assign({}, state, {
                editSmsTemplates: {
                    requesting: false,
                    error: null,
                    success: false
                }
            });

        case types.RESET_SMS_TEMPLATES_SUCCESS:
            return Object.assign({}, state, {
                smsTemplates: {
                    requesting: false,
                    error: null,
                    success: true,
                    templates: action.payload,
                },
                resetSmsTemplates:{
                    requesting: false,
                    error: null,
                    success: false
                },
                showingTemplate: action.payload.find(temp => temp.smsType === state.showingTemplate.smsType)
            });

        case types.RESET_SMS_TEMPLATES_REQUEST:
            return Object.assign({}, state, {
                resetSmsTemplates:{
                    requesting: true,
                    error: null,
                    success: false
                }
            });

        case types.RESET_SMS_TEMPLATES_FAILED:
            return Object.assign({}, state, {
                resetSmsTemplates:{
                    requesting: false,
                    error: action.payload,
                    success: false
                }
            });

        case types.CHANGE_SHOWING_TEMPLATE:
            return Object.assign({}, state, {
                showingTemplate: state.smsTemplates.templates.find(temp => temp.smsType === action.payload)
            });

        case types.SET_REVEAL_VARIABLE:
            return Object.assign({}, state, {
                revealVariable: action.payload
            });

        case types.SET_SMTP_CONFIG:
            return Object.assign({}, state, {
                showSmsSmtpConfiguration: action.payload
            });

        case types.SMTP_CONFIG_SUCCESS:
            return Object.assign({}, state, {
                smsSmtpConfiguration:{
                    requesting: false,
                    error: null,
                    success: true,
                    config: action.payload
                },
            });

        case types.SMTP_CONFIG_FAILED:
            return Object.assign({}, state, {
                smsSmtpConfiguration:{
                    requesting: false,
                    error: action.payload,
                    success: false,
                    config:state.smsSmtpConfiguration.config
                },
            });

        case types.SMTP_CONFIG_REQUEST:
            return Object.assign({}, state, {
                smsSmtpConfiguration:{
                    requesting: true,
                    error: null,
                    success: false,
                    config: state.smsSmtpConfiguration.config
                },
                smsSmtpDelete:{
                    ...state.smsSmtpDelete,
                    error: null,
                }
            });

        case types.DELETE_SMTP_CONFIG_SUCCESS:
            return Object.assign({}, state, {
                smsSmtpDelete:{
                    requesting: false,
                    error: null,
                    success: true
                },
                smsSmtpConfiguration:{
                    requesting: false,
                    error: null,
                    success: false,
                    config: action.payload
                },
            });

        case types.DELETE_SMTP_CONFIG_FAILED:
            return Object.assign({}, state, {
                smsSmtpDelete:{
                    requesting: false,
                    error: action.payload,
                    success: false
                },
            });

        case types.DELETE_SMTP_CONFIG_REQUEST:
            return Object.assign({}, state, {
                smsSmtpDelete:{
                    requesting: true,
                    error: null,
                    success: false
                },
                smsSmtpConfiguration:{
                    ...state.smsSmtpConfiguration,
                    error: null,
                },
            });

            default: return state;
        }
    }
