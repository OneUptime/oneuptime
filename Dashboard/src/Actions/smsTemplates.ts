import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/smstemplates';
import ErrorPayload from 'CommonUI/src/payload-types/error';
//Array of sms templates

export const smsTemplatesRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.SMS_TEMPLATES_REQUEST,
        payload: promise,
    };
};

export const smsTemplatesError: Function = (error: ErrorPayload): void => {
    return {
        type: types.SMS_TEMPLATES_FAILED,
        payload: error,
    };
};

export const smsTemplatesSuccess: Function = (incidents: $TSFixMe): void => {
    return {
        type: types.SMS_TEMPLATES_SUCCESS,
        payload: incidents,
    };
};

export const smsTemplatesReset: Function = (): void => {
    return {
        type: types.SMS_TEMPLATES_RESET,
    };
};

// Calls the API to get sms templates
export const getSmsTemplates: Function = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(`smsTemplate/${projectId}`);
        dispatch(smsTemplatesRequest(promise));

        promise.then(
            (sms): void => {
                dispatch(smsTemplatesSuccess(sms.data));
            },
            (error): void => {
                dispatch(smsTemplatesError(error));
            }
        );
    };
};

// Edit sms templates
export const editSmsTemplateReset: Function = (): void => {
    return {
        type: types.EDIT_SMS_TEMPLATES_RESET,
    };
};

export const editSmsTemplateRequest: Function = (): void => {
    return {
        type: types.EDIT_SMS_TEMPLATES_REQUEST,
        payload: true,
    };
};

export const editSmsTemplateSuccess: Function = (
    smsTemplates: $TSFixMe
): void => {
    return {
        type: types.EDIT_SMS_TEMPLATES_SUCCESS,
        payload: smsTemplates,
    };
};

export const editSmsTemplateError: Function = (error: ErrorPayload): void => {
    return {
        type: types.EDIT_SMS_TEMPLATES_FAILED,
        payload: error,
    };
};

export const editSmsTemplates: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `smsTemplate/${projectId}`,
            data
        );
        dispatch(editSmsTemplateRequest());

        promise.then(
            (smsTemplate): void => {
                dispatch(editSmsTemplateSuccess(smsTemplate.data));
            },
            error => {
                dispatch(editSmsTemplateError(error));
            }
        );
    };
};

//Array of sms templates

export const resetSmsTemplatesRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.RESET_SMS_TEMPLATES_REQUEST,
        payload: promise,
    };
};

export const resetSmsTemplatesError: Function = (error: ErrorPayload): void => {
    return {
        type: types.RESET_SMS_TEMPLATES_FAILED,
        payload: error,
    };
};

export const resetSmsTemplatesSuccess: Function = (
    smsTemplates: $TSFixMe
): void => {
    return {
        type: types.RESET_SMS_TEMPLATES_SUCCESS,
        payload: smsTemplates,
    };
};

// Calls the API to reset sms templates
export const resetSmsTemplates: Function = (
    projectId: ObjectID,
    templateId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(
            `smsTemplate/${projectId}/${templateId}/reset`
        );
        dispatch(resetSmsTemplatesRequest(promise));

        promise.then(
            (sms): void => {
                dispatch(resetSmsTemplatesSuccess(sms.data));
            },
            (error): void => {
                dispatch(resetSmsTemplatesError(error));
            }
        );
        return promise;
    };
};

export const smtpConfigRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.SMTP_CONFIG_REQUEST,
        payload: promise,
    };
};

export const smtpConfigError: Function = (error: ErrorPayload): void => {
    return {
        type: types.SMTP_CONFIG_FAILED,
        payload: error,
    };
};

export const smtpConfigSuccess: Function = (config: $TSFixMe): void => {
    return {
        type: types.SMTP_CONFIG_SUCCESS,
        payload: config,
    };
};

// Calls the API to reset email templates
export const getSmtpConfig: Function = (projectId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.get(`smsSmtp/${projectId}`);
        dispatch(smtpConfigRequest(promise));

        promise.then(
            (data): void => {
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
            (error): void => {
                dispatch(smtpConfigError(error));
            }
        );
    };
};

export const postSmtpConfig: Function = (
    projectId: ObjectID,
    data: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.post(`smsSmtp/${projectId}`, data);
        dispatch(smtpConfigRequest(promise));

        promise.then(
            (data): void => {
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
            (error): void => {
                dispatch(smtpConfigError(error));
            }
        );
    };
};

export const deleteSmtpConfigRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.DELETE_SMTP_CONFIG_REQUEST,
        payload: promise,
    };
};

export const deleteSmtpConfigError: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_SMTP_CONFIG_FAILED,
        payload: error,
    };
};

export const deleteSmtpConfigSuccess: Function = (config: $TSFixMe): void => {
    return {
        type: types.DELETE_SMTP_CONFIG_SUCCESS,
        payload: config,
    };
};

export const deleteSmtpConfig: Function = (
    projectId: ObjectID,
    smtpId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = delete `smsSmtp/${projectId}/${smtpId}`;
        dispatch(deleteSmtpConfigRequest(promise));

        promise.then(
            (data): void => {
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
            (error): void => {
                dispatch(deleteSmtpConfigError(error));
            }
        );
    };
};

export function updateSmtpConfig(
    projectId: ObjectID,
    smtpId: $TSFixMe,
    data: $TSFixMe
): void {
    return function (dispatch: Dispatch): void {
        const promise: $TSFixMe = BackendAPI.put(
            `smsSmtp/${projectId}/${smtpId}`,
            data
        );
        dispatch(smtpConfigRequest(promise));

        promise.then(
            (data): void => {
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
            (error): void => {
                dispatch(smtpConfigError(error));
            }
        );
    };
}

export const changeShowingTemplate: Function = (
    smsTemplate: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.CHANGE_SHOWING_TEMPLATE,
            payload: smsTemplate,
        });
    };
};

export const setRevealVariable: Function = (smstype: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.SET_REVEAL_VARIABLE,
            payload: smstype,
        });
    };
};

export const setSmtpConfig: Function = (val: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: types.SET_SMTP_CONFIG,
            payload: val,
        });
    };
};
