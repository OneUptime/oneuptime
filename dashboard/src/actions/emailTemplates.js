import { getApi, putApi,postApi,deleteApi } from '../api';
import * as types from '../constants/emailTemplates'
import errors from '../errors'

//Array of email templates

export function emailTemplatesRequest(promise) {
    return {
        type: types.EMAIL_TEMPLATES_REQUEST,
        payload: promise
    };
}

export function emailTemplatesError(error) {
    return {
        type: types.EMAIL_TEMPLATES_FAILED,
        payload: error
    };
}

export function emailTemplatesSuccess(incidents) {
    return {
        type: types.EMAIL_TEMPLATES_SUCCESS,
        payload: incidents
    };
}

export const emailTemplatesReset = () => {
    return {
        type: types.EMAIL_TEMPLATES_RESET,
    };
};

// Calls the API to get email templates
export function getEmailTemplates(projectId) {
    return function (dispatch) {
        var promise = getApi(`emailTemplate/${projectId}`);
        dispatch(emailTemplatesRequest(promise));

        promise.then(function (emails) {
            dispatch(emailTemplatesSuccess(emails.data));
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
            dispatch(emailTemplatesError(errors(error)));
        });
    };
}

// Edit email templates
export function editEmailTemplateReset(){
    return {
        type: types.EDIT_EMAIL_TEMPLATES_RESET
    }
}

export function editEmailTemplateRequest(){
    return {
        type: types.EDIT_EMAIL_TEMPLATES_REQUEST,
        payload: true
    }
}

export function editEmailTemplateSuccess(emailTemplates){
    return {
        type: types.EDIT_EMAIL_TEMPLATES_SUCCESS,
        payload: emailTemplates
    };
}

export function editEmailTemplateError(error){
    return {
        type: types.EDIT_EMAIL_TEMPLATES_FAILED,
        payload: error
    }
}

export function editEmailTemplates(projectId, data){
    return function(dispatch){
        var promise = putApi(`emailTemplate/${projectId}`, data);
        dispatch(editEmailTemplateRequest());

        promise.then(function(emailTemplate){
            dispatch(editEmailTemplateSuccess(emailTemplate.data));
        }, error=>{
            if(error && error.response && error.response.data)
				error = error.response.data;
			if(error && error.data){
				error = error.data;
			}
			if(error && error.message){
				error = error.message;
			}
			else{
				error = 'Network Error';
            }
            dispatch(editEmailTemplateError(errors(error)));
        });
    }
}

//Array of email templates

export function resetEmailTemplatesRequest(promise) {
    return {
        type: types.RESET_EMAIL_TEMPLATES_REQUEST,
        payload: promise
    };
}

export function resetEmailTemplatesError(error) {
    return {
        type: types.RESET_EMAIL_TEMPLATES_FAILED,
        payload: error
    };
}

export function resetEmailTemplatesSuccess(emailTemplates) {
    return {
        type: types.RESET_EMAIL_TEMPLATES_SUCCESS,
        payload: emailTemplates
    };
}


// Calls the API to reset email templates
export function resetEmailTemplates(projectId, templateId) {
    return function (dispatch) {
        var promise = getApi(`emailTemplate/${projectId}/${templateId}/reset`);
        dispatch(resetEmailTemplatesRequest(promise));

        promise.then(function (emails) {
            dispatch(resetEmailTemplatesSuccess(emails.data));
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
            dispatch(resetEmailTemplatesError(errors(error)));
        });
    };
}

export function smtpConfigRequest(promise) {
    return {
        type: types.SMTP_CONFIG_REQUEST,
        payload: promise
    };
}

export function smtpConfigError(error) {
    return {
        type: types.SMTP_CONFIG_FAILED,
        payload: error
    };
}

export function smtpConfigSuccess(config) {
    return {
        type: types.SMTP_CONFIG_SUCCESS,
        payload: config
    };
}


// Calls the API to reset email templates
export function getSmtpConfig(projectId) {
    return function (dispatch) {
        var promise = getApi(`emailSmtp/${projectId}`);
        dispatch(smtpConfigRequest(promise));

        promise.then(function (data) {

            if(data.data && data.data.enabled){
                dispatch({
                    type: types.SET_SMTP_CONFIG,
                    payload: true
                });
            }
            else{
                dispatch({
                    type: types.SET_SMTP_CONFIG,
                    payload: false
                });
            }
            dispatch(smtpConfigSuccess(data.data));
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
            dispatch(smtpConfigError(errors(error)));
        });
    };
}

export function postSmtpConfig(projectId,data) {
    return function (dispatch) {
        var promise = postApi(`emailSmtp/${projectId}`,data);
        dispatch(smtpConfigRequest(promise));

        promise.then(function (data) {
            dispatch(smtpConfigSuccess(data.data));
            if(data.data && data.data.enabled){
                dispatch({
                    type: types.SET_SMTP_CONFIG,
                    payload: true
                });
            }
            else{
                dispatch({
                    type: types.SET_SMTP_CONFIG,
                    payload: false
                });
            }
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
            dispatch(smtpConfigError(errors(error)));
        });
    };
}

export function deleteSmtpConfigRequest(promise) {
    return {
        type: types.DELETE_SMTP_CONFIG_REQUEST,
        payload: promise
    };
}

export function deleteSmtpConfigError(error) {
    return {
        type: types.DELETE_SMTP_CONFIG_FAILED,
        payload: error
    };
}

export function deleteSmtpConfigSuccess(config) {
    return {
        type: types.DELETE_SMTP_CONFIG_SUCCESS,
        payload: config
    };
}

export function deleteSmtpConfig(projectId,smtpId,data) {
    return function (dispatch) {
        var promise = deleteApi(`emailSmtp/${projectId}/${smtpId}`,data);
        dispatch(deleteSmtpConfigRequest(promise));

        promise.then(function (data) {
            dispatch(deleteSmtpConfigSuccess(data.data));
            if(data.data && data.data.enabled){
                dispatch({
                    type: types.SET_SMTP_CONFIG,
                    payload: true
                });
            }
            else{
                dispatch({
                    type: types.SET_SMTP_CONFIG,
                    payload: false
                });
            }
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
            dispatch(deleteSmtpConfigError(errors(error)));
        });
    };
}

export function updateSmtpConfig(projectId,smtpId,data) {
    return function (dispatch) {
        var promise = putApi(`emailSmtp/${projectId}/${smtpId}`,data);
        dispatch(smtpConfigRequest(promise));

        promise.then(function (data) {
            dispatch(smtpConfigSuccess(data.data));
            if(data.data && data.data.enabled){
                dispatch({
                    type: types.SET_SMTP_CONFIG,
                    payload: true
                });
            }
            else{
                dispatch({
                    type: types.SET_SMTP_CONFIG,
                    payload: false
                });
            }
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
            dispatch(smtpConfigError(errors(error)));
        });
    };
}

export function changeShowingTemplate(emailTemplate) {
    return function (dispatch) {
        dispatch({
            type: types.CHANGE_SHOWING_TEMPLATE,
            payload: emailTemplate
        });
    };
}

export function setRevealVariable(emailtype) {
    return function (dispatch) {
        dispatch({
            type: types.SET_REVEAL_VARIABLE,
            payload: emailtype
        });
    };
}

export function setSmtpConfig(val) {
    return function (dispatch) {
        dispatch({
            type: types.SET_SMTP_CONFIG,
            payload: val
        });
    };
}