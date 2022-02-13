import { postApi } from '../api';
import * as types from '../constants/statusPage';
import errors from '../errors';

// Create status page

export function createStatusPageRequest() {
    return {
        type: types.CREATE_STATUSPAGE_REQUEST,
    };
}

export function createStatusPageSuccess(statusPage) {
    return {
        type: types.CREATE_STATUSPAGE_SUCCESS,
        payload: statusPage,
    };
}

export function createStatusPageError(error) {
    return {
        type: types.CREATE_STATUSPAGE_FAILURE,
        payload: error,
    };
}

// Calls the API to create statuspage.
export function createStatusPage(projectId, data) {
    return function(dispatch) {
        const promise = postApi(`status-page/${projectId}`, data);
        dispatch(createStatusPageRequest());
        promise.then(
            function(response) {
                const statusPage = response.data;
                dispatch(createStatusPageSuccess(statusPage));
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
                dispatch(createStatusPageError(errors(error)));
            }
        );

        return promise;
    };
}