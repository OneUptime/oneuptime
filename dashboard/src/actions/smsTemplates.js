import { getApi, putApi,postApi,deleteApi } from '../api';
import * as types from '../constants/smstemplates'
import errors from '../errors'

//Array of sms templates

export function smsTemplatesRequest(promise) {
    return {
        type: types.SMS_TEMPLATES_REQUEST,
        payload: promise
    };
}

export function smsTemplatesError(error) {
    return {
        type: types.SMS_TEMPLATES_FAILED,
        payload: error
    };
}

export function smsTemplatesSuccess(incidents) {
    return {
        type: types.SMS_TEMPLATES_SUCCESS,
        payload: incidents
    };
}

export const smsTemplatesReset = () => {
    return {
        type: types.SMS_TEMPLATES_RESET,
    };
};

// Calls the API to get sms templates
export function getSmsTemplates(projectId) {
    return function (dispatch) {
        const promise = getApi(`smsTemplate/${projectId}`);
        dispatch(smsTemplatesRequest(promise));

        promise.then(function (sms) {
            dispatch(smsTemplatesSuccess(sms.data));
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
            dispatch(smsTemplatesError(errors(error)));
        });
    };
}

// Edit sms templates
export function editSmsTemplateReset(){
    return {
        type: types.EDIT_SMS_TEMPLATES_RESET
    }
}

export function editSmsTemplateRequest(){
    return {
        type: types.EDIT_SMS_TEMPLATES_REQUEST,
        payload: true
    }
}

export function editSmsTemplateSuccess(smsTemplates){
    return {
        type: types.EDIT_SMS_TEMPLATES_SUCCESS,
        payload: smsTemplates
    };
}

export function editSmsTemplateError(error){
    return {
        type: types.EDIT_SMS_TEMPLATES_FAILED,
        payload: error
    }
}

export function editSmsTemplates(projectId, data){
    return function(dispatch){
        const promise = putApi(`smsTemplate/${projectId}`, data);
        dispatch(editSmsTemplateRequest());

        promise.then(function(smsTemplate){
            dispatch(editSmsTemplateSuccess(smsTemplate.data));
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
            dispatch(editSmsTemplateError(errors(error)));
        });
    }
}

//Array of sms templates

export function resetSmsTemplatesRequest(promise) {
    return {
        type: types.RESET_SMS_TEMPLATES_REQUEST,
        payload: promise
    };
}

export function resetSmsTemplatesError(error) {
    return {
        type: types.RESET_SMS_TEMPLATES_FAILED,
        payload: error
    };
}

export function resetSmsTemplatesSuccess(smsTemplates) {
    return {
        type: types.RESET_SMS_TEMPLATES_SUCCESS,
        payload: smsTemplates
    };
}


// Calls the API to reset sms templates
export function resetSmsTemplates(projectId, templateId) {
    return function (dispatch) {
        const promise = getApi(`smsTemplate/${projectId}/${templateId}/reset`);
        dispatch(resetSmsTemplatesRequest(promise));

        promise.then(function (sms) {
            dispatch(resetSmsTemplatesSuccess(sms.data));
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
            dispatch(resetSmsTemplatesError(errors(error)));
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
        const promise = getApi(`smsSmtp/${projectId}`);
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
        const promise = postApi(`smsSmtp/${projectId}`,data);
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
        const promise = deleteApi(`smsSmtp/${projectId}/${smtpId}`,data);
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
        const promise = putApi(`smsSmtp/${projectId}/${smtpId}`,data);
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

export function changeShowingTemplate(smsTemplate) {
    return function (dispatch) {
        dispatch({
            type: types.CHANGE_SHOWING_TEMPLATE,
            payload: smsTemplate
        });
    };
}

export function setRevealVariable(smstype) {
    return function (dispatch) {
        dispatch({
            type: types.SET_REVEAL_VARIABLE,
            payload: smstype
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