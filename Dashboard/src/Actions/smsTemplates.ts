import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import * as types from '../constants/smstemplates';
import ErrorPayload from 'CommonUI/src/payload-types/error';
//Array of sms templates

export const smsTemplatesRequest = (promise: $TSFixMe) => {
    return {
        type: types.SMS_TEMPLATES_REQUEST,
        payload: promise,
    };
};

export const smsTemplatesError = (error: ErrorPayload) => {
    return {
        type: types.SMS_TEMPLATES_FAILED,
        payload: error,
    };
};

export const smsTemplatesSuccess = (incidents: $TSFixMe) => {
    return {
        type: types.SMS_TEMPLATES_SUCCESS,
        payload: incidents,
    };
};

export const smsTemplatesReset = () => {
    return {
        type: types.SMS_TEMPLATES_RESET,
    };
};

// Calls the API to get sms templates
export const getSmsTemplates = (projectId: string) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`smsTemplate/${projectId}`);
        dispatch(smsTemplatesRequest(promise));

        promise.then(
            function (sms) {
                dispatch(smsTemplatesSuccess(sms.data));
            },
            function (error) {
                dispatch(smsTemplatesError(error));
            }
        );
    };
};

// Edit sms templates
export const editSmsTemplateReset = () => {
    return {
        type: types.EDIT_SMS_TEMPLATES_RESET,
    };
};

export const editSmsTemplateRequest = () => {
    return {
        type: types.EDIT_SMS_TEMPLATES_REQUEST,
        payload: true,
    };
};

export const editSmsTemplateSuccess = (smsTemplates: $TSFixMe) => {
    return {
        type: types.EDIT_SMS_TEMPLATES_SUCCESS,
        payload: smsTemplates,
    };
};

export const editSmsTemplateError = (error: ErrorPayload) => {
    return {
        type: types.EDIT_SMS_TEMPLATES_FAILED,
        payload: error,
    };
};

export const editSmsTemplates = (projectId: string, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`smsTemplate/${projectId}`, data);
        dispatch(editSmsTemplateRequest());

        promise.then(
            function (smsTemplate) {
                dispatch(editSmsTemplateSuccess(smsTemplate.data));
            },
            error => {
                dispatch(editSmsTemplateError(error));
            }
        );
    };
};

//Array of sms templates

export const resetSmsTemplatesRequest = (promise: $TSFixMe) => {
    return {
        type: types.RESET_SMS_TEMPLATES_REQUEST,
        payload: promise,
    };
};

export const resetSmsTemplatesError = (error: ErrorPayload) => {
    return {
        type: types.RESET_SMS_TEMPLATES_FAILED,
        payload: error,
    };
};

export const resetSmsTemplatesSuccess = (smsTemplates: $TSFixMe) => {
    return {
        type: types.RESET_SMS_TEMPLATES_SUCCESS,
        payload: smsTemplates,
    };
};

// Calls the API to reset sms templates
export const resetSmsTemplates = (projectId: string, templateId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(
            `smsTemplate/${projectId}/${templateId}/reset`
        );
        dispatch(resetSmsTemplatesRequest(promise));

        promise.then(
            function (sms) {
                dispatch(resetSmsTemplatesSuccess(sms.data));
            },
            function (error) {
                dispatch(resetSmsTemplatesError(error));
            }
        );
        return promise;
    };
};

export const smtpConfigRequest = (promise: $TSFixMe) => {
    return {
        type: types.SMTP_CONFIG_REQUEST,
        payload: promise,
    };
};

export const smtpConfigError = (error: ErrorPayload) => {
    return {
        type: types.SMTP_CONFIG_FAILED,
        payload: error,
    };
};

export const smtpConfigSuccess = (config: $TSFixMe) => {
    return {
        type: types.SMTP_CONFIG_SUCCESS,
        payload: config,
    };
};

// Calls the API to reset email templates
export const getSmtpConfig = (projectId: string) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`smsSmtp/${projectId}`);
        dispatch(smtpConfigRequest(promise));

        promise.then(
            function (data) {
                if (data.data && data.data.enabled) {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: true,
                    });
                } else {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: false,
                    });
                }

                dispatch(smtpConfigSuccess(data.data));
            },
            function (error) {
                dispatch(smtpConfigError(error));
            }
        );
    };
};

export const postSmtpConfig = (projectId: string, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.post(`smsSmtp/${projectId}`, data);
        dispatch(smtpConfigRequest(promise));

        promise.then(
            function (data) {
                dispatch(smtpConfigSuccess(data.data));

                if (data.data && data.data.enabled) {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: true,
                    });
                } else {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: false,
                    });
                }
            },
            function (error) {
                dispatch(smtpConfigError(error));
            }
        );
    };
};

export const deleteSmtpConfigRequest = (promise: $TSFixMe) => {
    return {
        type: types.DELETE_SMTP_CONFIG_REQUEST,
        payload: promise,
    };
};

export const deleteSmtpConfigError = (error: ErrorPayload) => {
    return {
        type: types.DELETE_SMTP_CONFIG_FAILED,
        payload: error,
    };
};

export const deleteSmtpConfigSuccess = (config: $TSFixMe) => {
    return {
        type: types.DELETE_SMTP_CONFIG_SUCCESS,
        payload: config,
    };
};

export const deleteSmtpConfig = (projectId: string, smtpId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = delete `smsSmtp/${projectId}/${smtpId}`;
        dispatch(deleteSmtpConfigRequest(promise));

        promise.then(
            function (data) {
                dispatch(deleteSmtpConfigSuccess(data.data));

                if (data.data && data.data.enabled) {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: true,
                    });
                } else {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: false,
                    });
                }
            },
            function (error) {
                dispatch(deleteSmtpConfigError(error));
            }
        );
    };
};

export function updateSmtpConfig(
    projectId: string,
    smtpId: $TSFixMe,
    data: $TSFixMe
) {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`smsSmtp/${projectId}/${smtpId}`, data);
        dispatch(smtpConfigRequest(promise));

        promise.then(
            function (data) {
                dispatch(smtpConfigSuccess(data.data));

                if (data.data && data.data.enabled) {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: true,
                    });
                } else {
                    dispatch({
                        type: types.SET_SMTP_CONFIG,
                        payload: false,
                    });
                }
            },
            function (error) {
                dispatch(smtpConfigError(error));
            }
        );
    };
}

export const changeShowingTemplate = (smsTemplate: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: types.CHANGE_SHOWING_TEMPLATE,
            payload: smsTemplate,
        });
    };
};

export const setRevealVariable = (smstype: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: types.SET_REVEAL_VARIABLE,
            payload: smstype,
        });
    };
};

export const setSmtpConfig = (val: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: types.SET_SMTP_CONFIG,
            payload: val,
        });
    };
};
