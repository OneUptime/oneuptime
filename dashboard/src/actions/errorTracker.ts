/* eslint-disable no-console */
import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/errorTracker';
import errors from '../errors';

//Create new error tracker
//props -> {name: '', type, data -> { data.url}}
export function createErrorTracker(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    values: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
            `error-tracker/${projectId}/${componentId}/create`,
            values
        );
        dispatch(createErrorTrackerRequest());

        promise.then(
            function (errorTracker) {
                dispatch(createErrorTrackerSuccess(errorTracker.data));
            },
            function (error) {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(createErrorTrackerFailure(errors(error)));
            }
        );

        return promise;
    };
}

export const createErrorTrackerSuccess = (newErrorTracker: $TSFixMe) => {
    return {
        type: types.CREATE_ERROR_TRACKER_SUCCESS,
        payload: newErrorTracker,
    };
}

export const createErrorTrackerRequest = () => {
    return {
        type: types.CREATE_ERROR_TRACKER_REQUEST,
    };
}

export const createErrorTrackerFailure = (error: $TSFixMe) => {
    return {
        type: types.CREATE_ERROR_TRACKER_FAILURE,
        payload: error,
    };
}

export const resetCreateErrorTracker = () => {
    return {
        type: types.CREATE_ERROR_TRACKER_RESET,
    };
}

export const fetchErrorTrackersByProject = (projectId: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(`component/${projectId}/issues`);

        dispatch(fetchErrorTrackersRequest());

        promise.then(
            function (errorTrackers) {
                dispatch(
                    fetchErrorTrackersSuccess(errorTrackers.data.errorTrackers)
                );
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
                dispatch(fetchErrorTrackersFailure(errors(error)));
            }
        );

        return promise;
    };
}

export function fetchErrorTrackers(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    skip = 0,
    limit = 0,
    fetchingPage = false
) {
    return function (dispatch: $TSFixMe) {
        const promise = getApi(
            `error-tracker/${projectId}/${componentId}?skip=${skip}&limit=${limit}`
        );
        dispatch(fetchErrorTrackersRequest(fetchingPage));

        promise.then(
            function (errorTrackers) {
                dispatch(fetchErrorTrackersSuccess(errorTrackers.data));
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
                dispatch(fetchErrorTrackersFailure(errors(error)));
            }
        );

        return promise;
    };
}

export const fetchErrorTrackersSuccess = (errorTrackers: $TSFixMe) => {
    return {
        type: types.FETCH_ERROR_TRACKERS_SUCCESS,
        payload: errorTrackers,
    };
}

export const fetchErrorTrackersRequest = (fetchingPage: $TSFixMe) => {
    return {
        type: types.FETCH_ERROR_TRACKERS_REQUEST,
        payload: fetchingPage,
    };
}

export const fetchErrorTrackersFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_ERROR_TRACKERS_FAILURE,
        payload: error,
    };
}

export const resetFetchErrorTrackers = () => {
    return {
        type: types.FETCH_ERROR_TRACKERS_RESET,
    };
}

export function fetchErrorTrackerIssues(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    errorTrackerId: $TSFixMe,
    skip: $TSFixMe,
    limit: $TSFixMe,
    startDate: $TSFixMe,
    endDate: $TSFixMe,
    filters = null
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}/issues`,
            { skip, limit, startDate, endDate, filters }
        );
        dispatch(fetchErrorTrackerIssuesRequest(errorTrackerId));

        promise.then(
            function (response) {
                dispatch(
                    fetchErrorTrackerIssuesSuccess({
                        errorTrackerId,
                        errorTrackerIssues:
                            response.data.data.errorTrackerIssues,

                        dateRange: response.data.data.dateRange,
                        skip,
                        limit,

                        count: response.data.data.count,
                    })
                );
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
                dispatch(fetchErrorTrackerIssuesFailure(errors(error)));
            }
        );

        return promise;
    };
}

export const fetchErrorTrackerIssuesSuccess = (errorTrackersList: $TSFixMe) => {
    return {
        type: types.FETCH_ISSUES_SUCCESS,
        payload: errorTrackersList,
    };
}

export const fetchErrorTrackerIssuesRequest = (errorTrackerId: $TSFixMe) => {
    return {
        type: types.FETCH_ISSUES_REQUEST,
        payload: errorTrackerId,
    };
}

export const fetchErrorTrackerIssuesFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_ISSUES_FAILURE,
        payload: error,
    };
}

export const resetFetchErrorTrackerIssues = () => {
    return {
        type: types.FETCH_ISSUES_RESET,
    };
}

export function fetchErrorEvent(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    errorTrackerId: $TSFixMe,
    errorEventId: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}/error-events/${errorEventId}`
        );
        dispatch(fetchErrorEventRequest(errorTrackerId, errorEventId));

        promise.then(
            function (response) {
                dispatch(
                    fetchErrorEventSuccess({
                        errorTrackerId,
                        errorEventId,

                        errorEvent: response.data.errorEvent,

                        previous: response.data.previous,

                        next: response.data.next,

                        totalEvents: response.data.totalEvents,
                    })
                );
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
                dispatch(fetchErrorEventFailure(errors(error)));
            }
        );

        return promise;
    };
}

export const fetchErrorEventSuccess = (errorEvent: $TSFixMe) => {
    return {
        type: types.FETCH_ERROR_EVENT_SUCCESS,
        payload: errorEvent,
    };
}

export function fetchErrorEventRequest(
    errorTrackerId: $TSFixMe,
    errorEventId: $TSFixMe
) {
    return {
        type: types.FETCH_ERROR_EVENT_REQUEST,
        payload: { errorTrackerId, errorEventId },
    };
}

export const fetchErrorEventFailure = (error: $TSFixMe) => {
    return {
        type: types.FETCH_ERROR_EVENT_FAILURE,
        payload: error,
    };
}

export const resetFetchErrorEvent = () => {
    return {
        type: types.FETCH_ERROR_EVENT_RESET,
    };
}

export const setCurrentErrorEvent = (errorEventId: $TSFixMe) => {
    return {
        type: types.SET_CURRENT_ERROR_EVENT,
        payload: { errorEventId },
    };
}

//Delete an errorTrackeer
//props -> {name: '', type, data -> { data.url}}
export function deleteErrorTracker(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    errorTrackerId: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = deleteApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}`
        );
        dispatch(deleteErrorTrackerRequest(errorTrackerId));

        promise.then(
            function (errorTracker) {
                dispatch(deleteErrorTrackerSuccess(errorTracker.data._id));
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
                dispatch(
                    deleteErrorTrackerFailure({
                        error: errors(error),
                        errorTrackerId,
                    })
                );
            }
        );

        return promise;
    };
}

export const deleteErrorTrackerSuccess = (removedErrorTrackerId: $TSFixMe) => {
    return {
        type: types.DELETE_ERROR_TRACKER_SUCCESS,
        payload: removedErrorTrackerId,
    };
}

export const deleteErrorTrackerRequest = (errorTrackerId: $TSFixMe) => {
    return {
        type: types.DELETE_ERROR_TRACKER_REQUEST,
        payload: errorTrackerId,
    };
}

export const deleteErrorTrackerFailure = (error: $TSFixMe) => {
    return {
        type: types.DELETE_ERROR_TRACKER_FAILURE,
        payload: error,
    };
}

export const editErrorTrackerSwitch = (index: $TSFixMe) => {
    return {
        type: types.EDIT_ERROR_TRACKER_SWITCH,
        payload: index,
    };
}
//Edit new errorTracker
export function editErrorTracker(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    errorTrackerId: $TSFixMe,
    values: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = putApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}`,
            values
        );
        dispatch(editErrorTrackerRequest());

        promise.then(
            function (errorTracker) {
                dispatch(editErrorTrackerSuccess(errorTracker.data));
            },
            function (error) {
                if (error && error.response && error.response.data) {
                    error = error.response.data;
                }
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(editErrorTrackerFailure(errors(error)));
            }
        );

        return promise;
    };
}

export const editErrorTrackerSuccess = (newErrorTracker: $TSFixMe) => {
    return {
        type: types.EDIT_ERROR_TRACKER_SUCCESS,
        payload: newErrorTracker,
    };
}

export const editErrorTrackerRequest = () => {
    return {
        type: types.EDIT_ERROR_TRACKER_REQUEST,
    };
}

export const editErrorTrackerFailure = (error: $TSFixMe) => {
    return {
        type: types.EDIT_ERROR_TRACKER_FAILURE,
        payload: error,
    };
}

export function resetErrorTrackerKey(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    errorTrackerId: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}/reset-key`
        );
        dispatch(resetErrorTrackerKeyRequest());

        promise.then(
            function (errorTracker) {
                dispatch(resetErrorTrackerKeySuccess(errorTracker.data));
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
                dispatch(resetErrorTrackerKeyFailure(errors(error)));
            }
        );

        return promise;
    };
}

export const resetErrorTrackerKeySuccess = (errorTracker: $TSFixMe) => {
    return {
        type: types.RESET_ERROR_TRACKER_KEY_SUCCESS,
        payload: errorTracker,
    };
}

export const resetErrorTrackerKeyRequest = () => {
    return {
        type: types.RESET_ERROR_TRACKER_KEY_REQUEST,
    };
}

export const resetErrorTrackerKeyFailure = (error: $TSFixMe) => {
    return {
        type: types.RESET_ERROR_TRACKER_KEY_FAILURE,
        payload: error,
    };
}

export const resetresetErrorTrackerKey = () => {
    return {
        type: types.RESET_ERROR_TRACKER_KEY_RESET,
    };
}

export function ignoreErrorEvent(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    errorTrackerId: $TSFixMe,
    issueId: $TSFixMe,
    unIgnore: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}/issues/action`,
            { issueId, action: unIgnore } // Instead of 'Unignore' becoming UNDEFINED always because the argument is always empty. A 'ignore' or 'unignore' parameter is used
        );
        dispatch(ignoreErrorEventRequest(errorTrackerId, issueId));

        promise.then(
            function (response) {
                dispatch(
                    ignoreErrorEventSuccess({
                        errorTrackerId,

                        ignoredIssues: response.data.issues,
                    })
                );
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
                dispatch(
                    ignoreErrorEventFailure(errors(error, errorTrackerId))
                );
            }
        );

        return promise;
    };
}

export const ignoreErrorEventReset = () => {
    return {
        type: types.IGNORE_ERROR_EVENT_RESET,
    };
}

export function ignoreErrorEventRequest(
    errorTrackerId: $TSFixMe,
    issueId: $TSFixMe
) {
    return {
        type: types.IGNORE_ERROR_EVENT_REQUEST,
        payload: { errorTrackerId, issueId },
    };
}
export function ignoreErrorEventFailure(
    error: $TSFixMe,
    errorTrackerId: $TSFixMe
) {
    return {
        type: types.IGNORE_ERROR_EVENT_FAILURE,
        payload: { error, errorTrackerId },
    };
}
export const ignoreErrorEventSuccess = (errorEvents: $TSFixMe) => {
    return {
        type: types.IGNORE_ERROR_EVENT_SUCCESS,
        payload: errorEvents,
    };
}

export function unresolveErrorEvent(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    errorTrackerId: $TSFixMe,
    issueId: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}/issues/action`,
            { issueId, action: 'unresolve' }
        );
        dispatch(unresolveErrorEventRequest(errorTrackerId, issueId));

        promise.then(
            function (response) {
                dispatch(
                    unresolveErrorEventSuccess({
                        errorTrackerId,

                        unresolvedIssues: response.data.issues,
                    })
                );
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
                dispatch(
                    unresolveErrorEventFailure(errors(error, errorTrackerId))
                );
            }
        );

        return promise;
    };
}

export const unresolveErrorEventReset = () => {
    return {
        type: types.UNRESOLVE_ERROR_EVENT_RESET,
    };
}

export function unresolveErrorEventRequest(
    errorTrackerId: $TSFixMe,
    issueId: $TSFixMe
) {
    return {
        type: types.UNRESOLVE_ERROR_EVENT_REQUEST,
        payload: { errorTrackerId, issueId },
    };
}
export function unresolveErrorEventFailure(
    error: $TSFixMe,
    errorTrackerId: $TSFixMe
) {
    return {
        type: types.UNRESOLVE_ERROR_EVENT_FAILURE,
        payload: { error, errorTrackerId },
    };
}
export const unresolveErrorEventSuccess = (errorEvents: $TSFixMe) => {
    return {
        type: types.UNRESOLVE_ERROR_EVENT_SUCCESS,
        payload: errorEvents,
    };
}

export function resolveErrorEvent(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    errorTrackerId: $TSFixMe,
    issueId: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}/issues/action`,
            { issueId, action: 'resolve' }
        );
        dispatch(resolveErrorEventRequest(errorTrackerId, issueId));

        promise.then(
            function (response) {
                dispatch(
                    resolveErrorEventSuccess({
                        errorTrackerId,

                        resolvedIssues: response.data.issues,
                    })
                );
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
                dispatch(
                    resolveErrorEventFailure(errors(error, errorTrackerId))
                );
            }
        );

        return promise;
    };
}

export const resolveErrorEventReset = () => {
    return {
        type: types.RESOLVE_ERROR_EVENT_RESET,
    };
}

export function resolveErrorEventRequest(
    errorTrackerId: $TSFixMe,
    issueId: $TSFixMe
) {
    return {
        type: types.RESOLVE_ERROR_EVENT_REQUEST,
        payload: { errorTrackerId, issueId },
    };
}
export function resolveErrorEventFailure(
    error: $TSFixMe,
    errorTrackerId: $TSFixMe
) {
    return {
        type: types.RESOLVE_ERROR_EVENT_FAILURE,
        payload: { error, errorTrackerId },
    };
}
export const resolveErrorEventSuccess = (errorEvents: $TSFixMe) => {
    return {
        type: types.RESOLVE_ERROR_EVENT_SUCCESS,
        payload: errorEvents,
    };
}

export function updateErrorEventMember(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    errorTrackerId: $TSFixMe,
    issueId: $TSFixMe,
    teamMemberId: $TSFixMe,
    type = 'assign'
) {
    return function (dispatch: $TSFixMe) {
        const promise = postApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}/${type}/${issueId}`,
            { teamMemberId }
        );
        dispatch(
            updateErrorEventMemberRequest({
                issueId,
                memberId: teamMemberId[0],
            })
        );

        promise.then(
            function (response) {
                dispatch(
                    updateErrorEventMemberSuccess({
                        errorTrackerId,
                        issueId,

                        members: response.data.members,
                    })
                );
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
                dispatch(updateErrorEventMemberFailure(errors(error)));
            }
        );

        return promise;
    };
}

export const updateErrorEventMemberReset = () => {
    return {
        type: types.UPDATE_ERROR_EVENT_MEMBER_RESET,
    };
}

export function updateErrorEventMemberRequest(
    errorTrackerIssueMembers: $TSFixMe
) {
    return {
        type: types.UPDATE_ERROR_EVENT_MEMBER_REQUEST,
        payload: errorTrackerIssueMembers,
    };
}
export const updateErrorEventMemberFailure = (error: $TSFixMe) => {
    return {
        type: types.UPDATE_ERROR_EVENT_MEMBER_FAILURE,
        payload: error,
    };
}
export function updateErrorEventMemberSuccess(
    errorTrackerIssueMembers: $TSFixMe
) {
    return {
        type: types.UPDATE_ERROR_EVENT_MEMBER_SUCCESS,
        payload: errorTrackerIssueMembers,
    };
}
export const getErrorEventSuccess = (data: $TSFixMe) => {
    return {
        type: types.NEW_ERROR_EVENT_SUCCESS,
        payload: data,
    };
}
//Delete an errorTracker Issue
export function deleteErrorTrackerIssue(
    projectId: $TSFixMe,
    componentId: $TSFixMe,
    errorTrackerId: $TSFixMe,
    issueId: $TSFixMe
) {
    return function (dispatch: $TSFixMe) {
        const promise = deleteApi(
            `error-tracker/${projectId}/${componentId}/${errorTrackerId}/issue/${issueId}`
        );
        dispatch(deleteErrorTrackerIssueRequest(issueId));

        promise.then(
            function (errorTracker) {
                dispatch(deleteErrorTrackerIssueSuccess(errorTracker.data));
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
                dispatch(
                    deleteErrorTrackerIssueFailure({
                        error: errors(error),
                        issueId,
                    })
                );
            }
        );

        return promise;
    };
}

export function deleteErrorTrackerIssueSuccess(
    removedErrorTrackerIssue: $TSFixMe
) {
    return {
        type: types.DELETE_ERROR_TRACKER_ISSUE_SUCCESS,
        payload: removedErrorTrackerIssue,
    };
}

export const deleteErrorTrackerIssueRequest = (errorTrackerIssueId: $TSFixMe) => {
    return {
        type: types.DELETE_ERROR_TRACKER_ISSUE_REQUEST,
        payload: errorTrackerIssueId,
    };
}

export const deleteErrorTrackerIssueFailure = (error: $TSFixMe) => {
    return {
        type: types.DELETE_ERROR_TRACKER_ISSUE_FAILURE,
        payload: error,
    };
}
