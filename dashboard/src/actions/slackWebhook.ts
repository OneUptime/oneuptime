import { deleteApi, getApi, postApi, putApi } from '../api';
import * as types from '../constants/slackWebhooks';

export function deleteSlackRequest() {
    return {
        type: types.DELETE_SLACK_WEBHOOK_REQUEST,
    };
}

export function deleteSlackError(error: $TSFixMe) {
    return {
        type: types.DELETE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
}

export function deleteSlackSuccess(deleteSlack: $TSFixMe) {
    return {
        type: types.DELETE_SLACK_WEBHOOK_SUCCESS,
        payload: deleteSlack,
    };
}

export const resetDeleteSlack = () => {
    return {
        type: types.DELETE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to link webhook team to project
export function deleteSlack(projectId: $TSFixMe, msTeamsId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = deleteApi(
            `webhook/${projectId}/delete/${msTeamsId}`,
            null
        );

        dispatch(deleteSlackRequest());

        return promise.then(
            function(msTeams) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(deleteSlackSuccess(msTeams.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                return msTeams.data;
            },
            function(error) {
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
                dispatch(deleteSlackError(error));
            }
        );
    };
}

export function getSlackRequest(promise: $TSFixMe) {
    return {
        type: types.GET_SLACK_WEBHOOK_REQUEST,
        payload: promise,
    };
}

export function getSlackError(error: $TSFixMe) {
    return {
        type: types.GET_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
}

export function getSlackSuccess(msTeams: $TSFixMe) {
    return {
        type: types.GET_SLACK_WEBHOOK_SUCCESS,
        payload: msTeams,
    };
}

export const resetGetSlack = () => {
    return {
        type: types.GET_SLACK_WEBHOOK_RESET,
    };
};

export function getSlack(projectId: $TSFixMe, skip: $TSFixMe, limit: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        let promise = null;
        promise = getApi(
            `webhook/${projectId}/hooks?skip=${skip || 0}&limit=${limit ||
                10}&type=slack`
        );
        dispatch(getSlackRequest(promise));

        promise.then(
            function(webhooks) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(getSlackSuccess(webhooks.data));
            },
            function(error) {
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
                dispatch(getSlackError(error));
            }
        );

        return promise;
    };
}

export function getSlackMonitor(
    projectId: $TSFixMe,
    monitorId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        let promise = null;
        promise = getApi(
            `webhook/${projectId}/hooks/${monitorId}?skip=${skip ||
                0}&limit=${limit || 10}&type=slack`
        );
        dispatch(getSlackRequest(promise));

        promise.then(
            function(webhooks) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(getSlackSuccess(webhooks.data));
            },
            function(error) {
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
                dispatch(getSlackError(error));
            }
        );

        return promise;
    };
}

export function createSlackRequest() {
    return {
        type: types.CREATE_SLACK_WEBHOOK_REQUEST,
    };
}

export function createSlackError(error: $TSFixMe) {
    return {
        type: types.CREATE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
}

export function createSlackSuccess(newWebHook: $TSFixMe) {
    return {
        type: types.CREATE_SLACK_WEBHOOK_SUCCESS,
        payload: newWebHook,
    };
}

export const resetCreateSlack = () => {
    return {
        type: types.CREATE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to add webhook to project
export function createSlack(projectId: $TSFixMe, data: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi(`webhook/${projectId}/create`, data);

        dispatch(createSlackRequest());
        return promise.then(
            function(webhook) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(createSlackSuccess(webhook.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                return webhook.data;
            },
            function(error) {
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
                dispatch(createSlackError(error));
            }
        );
    };
}

export function updateSlackRequest() {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_REQUEST,
    };
}

export function updateSlackError(error: $TSFixMe) {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_FAILED,
        payload: error,
    };
}

export function updateSlackSuccess(newWebHook: $TSFixMe) {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_SUCCESS,
        payload: newWebHook,
    };
}

export const resetUpdateSlack = () => {
    return {
        type: types.UPDATE_SLACK_WEBHOOK_RESET,
    };
};

// Calls the API to add webhook to project
export function updateSlack(
    projectId: $TSFixMe,
    webhookId: $TSFixMe,
    data: $TSFixMe
) {
    return function(dispatch: $TSFixMe) {
        const promise = putApi(`webhook/${projectId}/${webhookId}`, data);

        dispatch(updateSlackRequest());

        return promise.then(
            function(webhook) {
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                dispatch(updateSlackSuccess(webhook.data));
                // @ts-expect-error ts-migrate(2571) FIXME: Object is of type 'unknown'.
                return webhook.data;
            },
            function(error) {
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
                dispatch(updateSlackError(error));
            }
        );
    };
}

// Implements pagination for Webhooks Members table

export function paginateNext() {
    return {
        type: types.PAGINATE_NEXT,
    };
}

export function paginatePrev() {
    return {
        type: types.PAGINATE_PREV,
    };
}

export function paginateReset() {
    return {
        type: types.PAGINATE_RESET,
    };
}

export function paginate(type: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        type === 'next' && dispatch(paginateNext());
        type === 'prev' && dispatch(paginatePrev());
        type === 'reset' && dispatch(paginateReset());
    };
}
