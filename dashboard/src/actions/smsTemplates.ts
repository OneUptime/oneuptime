import BackendAPI from '../api';
import { Dispatch } from 'redux';
import * as types from '../constants/smstemplates';
import errors from '../errors';

//Array of sms templates

export const smsTemplatesRequest = (promise: $TSFixMe) => {
    return {
        type: types.SMS_TEMPLATES_REQUEST,
        payload: promise,
    };
};

export const smsTemplatesError = (error: $TSFixMe) => {
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
export const getSmsTemplates = (projectId: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.get(`smsTemplate/${projectId}`);
        dispatch(smsTemplatesRequest(promise));

        promise.then(
            function (sms) {
                dispatch(smsTemplatesSuccess(sms.data));
            },
            function (error) {
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
                dispatch(smsTemplatesError(errors(error)));
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

export const editSmsTemplateError = (error: $TSFixMe) => {
    return {
        type: types.EDIT_SMS_TEMPLATES_FAILED,
        payload: error,
    };
};

export const editSmsTemplates = (projectId: $TSFixMe, data: $TSFixMe) => {
    return function (dispatch: Dispatch) {
        const promise = BackendAPI.put(`smsTemplate/${projectId}`, data);
        dispatch(editSmsTemplateRequest());

        promise.then(
            function (smsTemplate) {
                dispatch(editSmsTemplateSuccess(smsTemplate.data));
            },
            error => {
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
                dispatch(editSmsTemplateError(errors(error)));
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

export const resetSmsTemplatesError = (error: $TSFixMe) => {
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
export const resetSmsTemplates = (
    projectId: $TSFixMe,
    templateId: $TSFixMe
) => {
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
                dispatch(resetSmsTemplatesError(errors(error)));
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

export const smtpConfigError = (error: $TSFixMe) => {
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
export const getSmtpConfig = (projectId: $TSFixMe) => {
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
                dispatch(smtpConfigError(errors(error)));
            }
        );
    };
};

export const postSmtpConfig = (projectId: $TSFixMe, data: $TSFixMe) => {
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
                dispatch(smtpConfigError(errors(error)));
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

export const deleteSmtpConfigError = (error: $TSFixMe) => {
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

export const deleteSmtpConfig = (projectId: $TSFixMe, smtpId: $TSFixMe) => {
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
                dispatch(deleteSmtpConfigError(errors(error)));
            }
        );
    };
};

export function updateSmtpConfig(
    projectId: $TSFixMe,
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
                dispatch(smtpConfigError(errors(error)));
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
