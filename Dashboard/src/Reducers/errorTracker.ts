import {
    CREATE_ERROR_TRACKER_FAILURE,
    CREATE_ERROR_TRACKER_REQUEST,
    CREATE_ERROR_TRACKER_RESET,
    CREATE_ERROR_TRACKER_SUCCESS,
    FETCH_ERROR_TRACKERS_FAILURE,
    FETCH_ERROR_TRACKERS_REQUEST,
    FETCH_ERROR_TRACKERS_RESET,
    FETCH_ERROR_TRACKERS_SUCCESS,
    FETCH_ISSUES_FAILURE,
    FETCH_ISSUES_REQUEST,
    FETCH_ISSUES_RESET,
    FETCH_ISSUES_SUCCESS,
    FETCH_ERROR_EVENT_FAILURE,
    FETCH_ERROR_EVENT_REQUEST,
    FETCH_ERROR_EVENT_RESET,
    FETCH_ERROR_EVENT_SUCCESS,
    SET_CURRENT_ERROR_EVENT,
    DELETE_ERROR_TRACKER_FAILURE,
    DELETE_ERROR_TRACKER_REQUEST,
    DELETE_ERROR_TRACKER_SUCCESS,
    EDIT_ERROR_TRACKER_SWITCH,
    EDIT_ERROR_TRACKER_FAILURE,
    EDIT_ERROR_TRACKER_REQUEST,
    EDIT_ERROR_TRACKER_RESET,
    EDIT_ERROR_TRACKER_SUCCESS,
    RESET_ERROR_TRACKER_KEY_FAILURE,
    RESET_ERROR_TRACKER_KEY_REQUEST,
    RESET_ERROR_TRACKER_KEY_RESET,
    RESET_ERROR_TRACKER_KEY_SUCCESS,
    IGNORE_ERROR_EVENT_FAILURE,
    IGNORE_ERROR_EVENT_REQUEST,
    IGNORE_ERROR_EVENT_RESET,
    IGNORE_ERROR_EVENT_SUCCESS,
    UNRESOLVE_ERROR_EVENT_FAILURE,
    UNRESOLVE_ERROR_EVENT_REQUEST,
    UNRESOLVE_ERROR_EVENT_RESET,
    UNRESOLVE_ERROR_EVENT_SUCCESS,
    RESOLVE_ERROR_EVENT_FAILURE,
    RESOLVE_ERROR_EVENT_REQUEST,
    RESOLVE_ERROR_EVENT_RESET,
    RESOLVE_ERROR_EVENT_SUCCESS,
    UPDATE_ERROR_EVENT_MEMBER_FAILURE,
    UPDATE_ERROR_EVENT_MEMBER_REQUEST,
    UPDATE_ERROR_EVENT_MEMBER_RESET,
    UPDATE_ERROR_EVENT_MEMBER_SUCCESS,
    NEW_ERROR_EVENT_SUCCESS,
    DELETE_ERROR_TRACKER_ISSUE_FAILURE,
    DELETE_ERROR_TRACKER_ISSUE_REQUEST,
    DELETE_ERROR_TRACKER_ISSUE_SUCCESS,
} from '../constants/errorTracker';

import Action from 'CommonUI/src/Types/Action';

const INITIAL_STATE: $TSFixMe = {
    newErrorTracker: {
        errorTracker: null,
        error: null,
        requesting: false,
        success: false,
        initialValue: null,
    },
    errorTrackersList: {
        errorTrackers: [],
        error: null,
        requesting: false,
        success: false,
        fetchingPage: false,
    },
    errorTrackerIssues: {},
    errorEvents: {},
    currentErrorEvent: '',
    editErrorTracker: {
        requesting: false,
        error: null,
        success: false,
    },
    errorTrackerStatus: {
        requesting: false,
        error: null,
        success: false,
    },
    deleteErrorTracker: false,
    errorTrackerIssueMembers: {},
    deleteErrorTrackerIssue: false,
};
export default function errorTracker(
    state: $TSFixMe = INITIAL_STATE,
    action: Action
): void {
    let temporaryIssues: $TSFixMe,
        temporaryErrorEvents: $TSFixMe,
        temporaryErrorTrackers: $TSFixMe,
        temporaryIssue: $TSFixMe;
    switch (action.type) {
        case CREATE_ERROR_TRACKER_SUCCESS:
            return Object.assign({}, state, {
                newErrorTracker: INITIAL_STATE.newErrorTracker,
                errorTrackersList: {
                    ...state.errorTrackersList,
                    errorTrackers: [action.payload].concat(
                        state.errorTrackersList.errorTrackers
                    ),
                },
            });
        case CREATE_ERROR_TRACKER_FAILURE:
            return Object.assign({}, state, {
                newErrorTracker: {
                    ...state.newErrorTracker,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case CREATE_ERROR_TRACKER_RESET:
            return Object.assign({}, state, {
                newErrorTracker: INITIAL_STATE.newErrorTracker,
            });

        case CREATE_ERROR_TRACKER_REQUEST:
            return Object.assign({}, state, {
                newErrorTracker: {
                    ...state.newErrorTracker,
                    requesting: true,
                },
            });
        case FETCH_ERROR_TRACKERS_SUCCESS:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: null,
                    success: true,
                    errorTrackers: action.payload.errorTrackers,
                    count: action.payload.count,
                    skip: action.payload.skip,
                    limit: action.payload.limit,
                    fetchingPage: false,
                },
            });

        case FETCH_ERROR_TRACKERS_FAILURE:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                    fetchingPage: false,
                },
            });

        case FETCH_ERROR_TRACKERS_RESET:
            return Object.assign({}, state, {
                errorTrackersList: INITIAL_STATE.errorTrackersList,
            });

        case FETCH_ERROR_TRACKERS_REQUEST:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: action.payload ? false : true,
                    error: null,
                    success: false,
                    fetchingPage: true,
                },
            });
        case FETCH_ISSUES_SUCCESS:
            return Object.assign({}, state, {
                errorTrackerIssues: {
                    ...state.errorTrackerIssues,
                    [action.payload.errorTrackerId]: {
                        errorTrackerIssues: action.payload.errorTrackerIssues,
                        error: null,
                        requesting: false,
                        success: true,
                        skip: action.payload.skip,
                        limit: action.payload.limit,
                        count: action.payload.count,
                        dateRange: action.payload.dateRange,
                    },
                },
            });

        case FETCH_ISSUES_FAILURE:
            temporaryIssues = {
                ...state.errorTrackerIssues,

                [action.payload.errorTrackerId]: state.errorTrackerIssues[
                    action.payload.errorTrackerId
                ]
                    ? {
                          ...state.errorTrackerIssues[
                              action.payload.errorTrackerId
                          ],
                          error: action.payload.error,
                      }
                    : {
                          errorTrackerIssues: [],
                          error: action.payload.error,
                          requesting: false,
                          success: false,
                          skip: 0,
                          limit: 10,
                          count: null,
                          dateRange: null,
                      },
            };
            return Object.assign({}, state, {
                errorTrackerIssues: temporaryIssues,
            });

        case FETCH_ISSUES_RESET:
            return Object.assign({}, state, {
                errorTrackerIssues: INITIAL_STATE.errorTrackerIssues,
            });

        case FETCH_ISSUES_REQUEST:
            temporaryIssues = {
                ...state.errorTrackerIssues,

                [action.payload]: state.errorTrackerIssues[action.payload]
                    ? {
                          ...state.errorTrackerIssues[action.payload],
                          requesting: true,
                      }
                    : {
                          errorTrackerIssues: [],
                          error: null,
                          requesting: true,
                          success: false,
                          skip: 0,
                          limit: 10,
                          count: null,
                          dateRange: null,
                      },
            };
            return Object.assign({}, state, {
                errorTrackerIssues: temporaryIssues,
            });
        case FETCH_ERROR_EVENT_REQUEST:
            /*
             * Check if the error event exist
             * If it doesnt, create the error event details
             * If it does, update the requesting
             */
            temporaryErrorEvents = {
                ...state.errorEvents,

                [action.payload.errorEventId]: state.errorEvents[
                    action.payload.errorEventId
                ]
                    ? {
                          ...state.errorEvents[action.payload.errorEventId],
                          requesting: true,
                      }
                    : {
                          errorEvent: undefined,
                          error: null,
                          requesting: true,
                          success: false,
                          previous: undefined,
                          next: undefined,
                          totalEvents: 0,
                      },
            };
            return Object.assign({}, state, {
                errorEvents: temporaryErrorEvents,
            });
        case FETCH_ERROR_EVENT_SUCCESS:
            return Object.assign({}, state, {
                errorEvents: {
                    ...state.errorEvents,
                    [action.payload.errorEventId]: {
                        errorEvent: action.payload.errorEvent,
                        error: null,
                        requesting: false,
                        success: true,
                        previous: action.payload.previous,
                        next: action.payload.next,
                        totalEvents: action.payload.totalEvents,
                    },
                },
            });
        case FETCH_ERROR_EVENT_FAILURE:
            temporaryErrorEvents = {
                ...state.errorEvents,

                [action.payload.errorEventId]: state.errorEvents[
                    action.payload.errorEventId
                ]
                    ? {
                          ...state.errorEvents[action.payload.errorEventId],
                          error: action.payload.error,
                      }
                    : {
                          errorEvent: undefined,
                          error: action.payload.error,
                          requesting: false,
                          success: false,
                          previous: undefined,
                          next: undefined,
                          totalEvents: 0,
                      },
            };
            return Object.assign({}, state, {
                errorEvents: temporaryErrorEvents,
            });
        case FETCH_ERROR_EVENT_RESET:
            return Object.assign({}, state, {
                errorEvents: INITIAL_STATE.errorEvents,
            });
        case SET_CURRENT_ERROR_EVENT:
            return Object.assign({}, state, {
                currentErrorEvent: action.payload.errorEventId,
            });
        case DELETE_ERROR_TRACKER_SUCCESS:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: null,
                    success: true,
                    errorTrackers: state.errorTrackersList.errorTrackers.filter(
                        ({ _id }: $TSFixMe) => {
                            return _id !== action.payload;
                        }
                    ),
                },
                deleteErrorTracker: false,
            });

        case DELETE_ERROR_TRACKER_FAILURE:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                deleteErrorTracker: false,
            });

        case DELETE_ERROR_TRACKER_REQUEST:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: null,
                    success: false,
                },
                deleteErrorTracker: action.payload,
            });
        case EDIT_ERROR_TRACKER_SWITCH:
            temporaryErrorTrackers = state.errorTrackersList.errorTrackers.map(
                (errorTracker: $TSFixMe) => {
                    if (errorTracker._id === action.payload) {
                        if (!errorTracker.editMode) {
                            errorTracker.editMode = true;
                        } else {
                            errorTracker.editMode = false;
                        }
                    } else {
                        errorTracker.editMode = false;
                    }
                    return errorTracker;
                }
            );
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: null,
                    success: false,
                    errorTrackers: temporaryErrorTrackers,
                },
                editErrorTracker: {
                    requesting: false,
                    error: null,
                    success: false,
                },
            });
        case EDIT_ERROR_TRACKER_SUCCESS:
            temporaryErrorTrackers = state.errorTrackersList.errorTrackers.map(
                (errorTracker: $TSFixMe) => {
                    if (errorTracker._id === action.payload._id) {
                        errorTracker = action.payload;
                    }
                    return errorTracker;
                }
            );
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: null,
                    success: true,
                    errorTrackers: temporaryErrorTrackers,
                },
            });
        case EDIT_ERROR_TRACKER_FAILURE:
            return Object.assign({}, state, {
                editErrorTracker: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case EDIT_ERROR_TRACKER_RESET:
            return Object.assign({}, state, {
                editErrorTracker: INITIAL_STATE.editErrorTracker,
            });

        case EDIT_ERROR_TRACKER_REQUEST:
            return Object.assign({}, state, {
                editErrorTracker: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });
        case RESET_ERROR_TRACKER_KEY_SUCCESS:
            temporaryErrorTrackers = state.errorTrackersList.errorTrackers.map(
                (errorTracker: $TSFixMe) => {
                    if (errorTracker._id === action.payload._id) {
                        errorTracker = action.payload;
                    }
                    return errorTracker;
                }
            );
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: null,
                    success: true,
                    errorTrackers: temporaryErrorTrackers,
                },
            });

        case RESET_ERROR_TRACKER_KEY_FAILURE:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case RESET_ERROR_TRACKER_KEY_RESET:
            return Object.assign({}, state, {
                errorTrackersList: INITIAL_STATE.errorTrackersList,
            });

        case RESET_ERROR_TRACKER_KEY_REQUEST:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });
        case IGNORE_ERROR_EVENT_SUCCESS:
            temporaryIssues = state.errorTrackerIssues[
                action.payload.errorTrackerId
            ]
                ? state.errorTrackerIssues[action.payload.errorTrackerId]
                      .errorTrackerIssues
                : [...action.payload.ignoredIssues];
            temporaryIssues.map((errorTrackerIssues: $TSFixMe) => {
                const issue: $TSFixMe = action.payload.ignoredIssues.filter(
                    (ignoredIssue: $TSFixMe) => {
                        return ignoredIssue._id === errorTrackerIssues._id;
                    }
                );

                if (issue && issue.length > 0) {
                    errorTrackerIssues.ignored = issue[0].ignored;
                    errorTrackerIssues.resolved = issue[0].resolved;
                    errorTrackerIssues.timeline = issue[0].timeline;
                }

                return errorTrackerIssues;
            });
            return Object.assign({}, state, {
                errorTrackerIssues: {
                    ...state.errorTrackerIssues,
                    [action.payload.errorTrackerId]: {
                        ...state.errorTrackerIssues[
                            action.payload.errorTrackerId
                        ],
                        errorTrackerIssues: temporaryIssues,
                    },
                },
                errorTrackerStatus: {
                    ...state.errorTrackerStatus,
                    [action.payload.errorTrackerId]: {
                        requestingResolve: false,
                        requestingIgnore: false,
                        error: null,
                    },
                },
            });

        case IGNORE_ERROR_EVENT_REQUEST:
            return Object.assign({}, state, {
                errorTrackerStatus: {
                    ...state.errorTrackerStatus,
                    [action.payload.errorTrackerId]: {
                        [action.payload.issueId[0]]: {
                            requestingResolve: false,
                            requestingIgnore: true,
                            error: null,
                        },
                        requestingResolve: false,
                        requestingIgnore: true,
                        error: null,
                    },
                },
            });
        case IGNORE_ERROR_EVENT_FAILURE:
            return Object.assign({}, state, {
                errorTrackerStatus: {
                    ...state.errorTrackerStatus,
                    [action.payload.errorTrackerId]: {
                        requestingResolve: false,
                        requestingIgnore: false,
                        error: action.payload.error,
                    },
                },
            });

        case IGNORE_ERROR_EVENT_RESET:
            return Object.assign({}, state, {
                errorTrackerStatus: INITIAL_STATE.errorTrackerStatus,
            });
        case UNRESOLVE_ERROR_EVENT_SUCCESS:
            temporaryIssues = state.errorTrackerIssues[
                action.payload.errorTrackerId
            ]
                ? state.errorTrackerIssues[action.payload.errorTrackerId]
                      .errorTrackerIssues
                : [...action.payload.unresolvedIssues];
            temporaryIssues.map((errorTrackerIssues: $TSFixMe) => {
                const issue: $TSFixMe = action.payload.unresolvedIssues.filter(
                    (unresolvedIssue: $TSFixMe) => {
                        return unresolvedIssue._id === errorTrackerIssues._id;
                    }
                );

                if (issue && issue.length > 0) {
                    errorTrackerIssues.ignored = issue[0].ignored;
                    errorTrackerIssues.resolved = issue[0].resolved;
                    errorTrackerIssues.timeline = issue[0].timeline;
                }

                return errorTrackerIssues;
            });
            return Object.assign({}, state, {
                errorTrackerIssues: {
                    ...state.errorTrackerIssues,
                    [action.payload.errorTrackerId]: {
                        ...state.errorTrackerIssues[
                            action.payload.errorTrackerId
                        ],
                        errorTrackerIssues: temporaryIssues,
                    },
                },
                errorTrackerStatus: {
                    ...state.errorTrackerStatus,
                    [action.payload.errorTrackerId]: {
                        requestingResolve: false,
                        requestingIgnore: false,
                        error: null,
                    },
                },
            });

        case UNRESOLVE_ERROR_EVENT_REQUEST:
            return Object.assign({}, state, {
                errorTrackerStatus: {
                    ...state.errorTrackerStatus,
                    [action.payload.errorTrackerId]: {
                        [action.payload.issueId[0]]: {
                            requestingResolve: true,
                            requestingIgnore: false,
                            error: null,
                        },
                        requestingResolve: true,
                        requestingIgnore: false,
                        error: null,
                    },
                },
            });
        case UNRESOLVE_ERROR_EVENT_FAILURE:
            return Object.assign({}, state, {
                errorTrackerStatus: {
                    ...state.errorTrackerStatus,
                    [action.payload.errorTrackerId]: {
                        requestingResolve: false,
                        requestingIgnore: false,
                        error: action.payload.error,
                    },
                },
            });

        case UNRESOLVE_ERROR_EVENT_RESET:
            return Object.assign({}, state, {
                errorTrackerStatus: INITIAL_STATE.errorTrackerStatus,
            });
        case RESOLVE_ERROR_EVENT_SUCCESS:
            temporaryIssues = state.errorTrackerIssues[
                action.payload.errorTrackerId
            ]
                ? state.errorTrackerIssues[action.payload.errorTrackerId]
                      .errorTrackerIssues
                : [...action.payload.resolvedIssues];
            temporaryIssues.map((errorTrackerIssues: $TSFixMe) => {
                const issue: $TSFixMe = action.payload.resolvedIssues.filter(
                    (resolvedIssue: $TSFixMe) => {
                        return resolvedIssue._id === errorTrackerIssues._id;
                    }
                );

                if (issue && issue.length > 0) {
                    errorTrackerIssues.ignored = issue[0].ignored;
                    errorTrackerIssues.resolved = issue[0].resolved;
                    errorTrackerIssues.timeline = issue[0].timeline;
                }

                return errorTrackerIssues;
            });
            return Object.assign({}, state, {
                errorTrackerIssues: {
                    ...state.errorTrackerIssues,
                    [action.payload.errorTrackerId]: {
                        ...state.errorTrackerIssues[
                            action.payload.errorTrackerId
                        ],
                        errorTrackerIssues: temporaryIssues,
                    },
                },
                errorTrackerStatus: {
                    ...state.errorTrackerStatus,
                    [action.payload.errorTrackerId]: {
                        requestingResolve: false,
                        requestingIgnore: false,
                        error: null,
                    },
                },
            });

        case RESOLVE_ERROR_EVENT_REQUEST:
            return Object.assign({}, state, {
                errorTrackerStatus: {
                    ...state.errorTrackerStatus,
                    [action.payload.errorTrackerId]: {
                        [action.payload.issueId[0]]: {
                            requestingResolve: true,
                            requestingIgnore: false,
                            error: null,
                        },
                        requestingResolve: true,
                        requestingIgnore: false,
                        error: null,
                    },
                },
            });
        case RESOLVE_ERROR_EVENT_FAILURE:
            return Object.assign({}, state, {
                errorTrackerStatus: {
                    ...state.errorTrackerStatus,
                    [action.payload.errorTrackerId]: {
                        requestingResolve: false,
                        requestingIgnore: false,
                        error: action.payload.error,
                    },
                },
            });

        case RESOLVE_ERROR_EVENT_RESET:
            return Object.assign({}, state, {
                errorTrackerStatus: INITIAL_STATE.errorTrackerStatus,
            });
        case UPDATE_ERROR_EVENT_MEMBER_REQUEST:
            return Object.assign({}, state, {
                errorTrackerIssueMembers: {
                    ...state.errorTrackerIssueMembers,
                    [action.payload.issueId]: {
                        ...state.errorTrackerIssueMembers[
                            action.payload.issueId
                        ],
                        [action.payload.memberId]: {
                            requesting: true,
                            error: null,
                        },
                    },
                },
            });
        case UPDATE_ERROR_EVENT_MEMBER_RESET:
            return Object.assign({}, state, {
                errorTrackerIssueMembers: {
                    ...state.errorTrackerIssueMembers,
                    [action.payload.issueId]: {
                        ...state.errorTrackerIssueMembers[
                            action.payload.issueId
                        ],
                        [action.payload.memberId]: {
                            requesting: false,
                            error: null,
                        },
                    },
                },
            });
        case UPDATE_ERROR_EVENT_MEMBER_FAILURE:
            return Object.assign({}, state, {
                errorTrackerIssueMembers: {
                    ...state.errorTrackerIssueMembers,
                    [action.payload.issueId]: {
                        ...state.errorTrackerIssueMembers[
                            action.payload.issueId
                        ],
                        [action.payload.memberId]: {
                            requesting: false,
                            error: null,
                        },
                    },
                },
            });
        case UPDATE_ERROR_EVENT_MEMBER_SUCCESS:
            temporaryIssues = state.errorTrackerIssues[
                action.payload.errorTrackerId
            ].errorTrackerIssues.map((issue: $TSFixMe) => {
                if (issue._id === action.payload.issueId) {
                    issue.members = action.payload.members;
                }
                return issue;
            });
            return Object.assign({}, state, {
                errorTrackerIssues: {
                    ...state.errorTrackerIssues,
                    [action.payload.errorTrackerId]: {
                        ...state.errorTrackerIssues[
                            action.payload.errorTrackerId
                        ],
                        errorTrackerIssues: temporaryIssues,
                    },
                },
                errorTrackerIssueMembers: {
                    ...state.errorTrackerIssueMembers,
                    [action.payload.issueId]: {},
                },
            });
        case NEW_ERROR_EVENT_SUCCESS:
            temporaryIssues =
                state.errorTrackerIssues[
                    action.payload.errorEvent.errorTrackerId
                ].errorTrackerIssues;
            temporaryIssue = temporaryIssues.filter((issue: $TSFixMe) => {
                return issue._id === action.payload.errorEvent.issueId;
            });
            // If issue exist
            if (
                temporaryIssue.length > 0 &&
                temporaryIssue[0].latestId !== action.payload.errorEvent._id
            ) {
                temporaryIssues = state.errorTrackerIssues[
                    action.payload.errorEvent.errorTrackerId
                ].errorTrackerIssues.map((issue: $TSFixMe) => {
                    if (issue._id === action.payload.errorEvent.issueId) {
                        issue = action.payload.issue;
                    }
                    return issue;
                });
            } else if (temporaryIssue.length < 1) {
                temporaryIssues = [action.payload.issue].concat(
                    state.errorTrackerIssues[
                        action.payload.errorEvent.errorTrackerId
                    ].errorTrackerIssues
                );
            }
            if (temporaryIssues.length > 10) {
                temporaryIssues.pop();
            }
            return Object.assign({}, state, {
                errorTrackerIssues: {
                    ...state.errorTrackerIssues,
                    [action.payload.errorEvent.errorTrackerId]: {
                        ...state.errorTrackerIssues[
                            action.payload.errorEvent.errorTrackerId
                        ],
                        errorTrackerIssues: temporaryIssues,
                    },
                },
            });
        case DELETE_ERROR_TRACKER_ISSUE_SUCCESS:
            temporaryIssues =
                state.errorTrackerIssues[action.payload.errorTrackerId]
                    .errorTrackerIssues;

            temporaryIssues = temporaryIssues.filter(({ _id }: $TSFixMe) => {
                return _id !== action.payload._id;
            });
            return Object.assign({}, state, {
                errorTrackerIssues: {
                    ...state.errorTrackerIssues,
                    requesting: false,
                    error: null,
                    success: true,
                    [action.payload.errorTrackerId]: {
                        ...state.errorTrackerIssues[
                            action.payload.errorTrackerId
                        ],
                        errorTrackerIssues: temporaryIssues,
                    },
                },
                deleteErrorTracker: false,
            });

        case DELETE_ERROR_TRACKER_ISSUE_FAILURE:
            return Object.assign({}, state, {
                errorTrackerIssues: {
                    ...state.errorTrackerIssues,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                deleteErrorTrackerIssue: false,
            });

        case DELETE_ERROR_TRACKER_ISSUE_REQUEST:
            return Object.assign({}, state, {
                errorTrackerIssues: {
                    ...state.errorTrackerIssues,
                    requesting: true,
                    error: null,
                    success: false,
                },
                deleteErrorTrackerIssue: action.payload,
            });
        default:
            return state;
    }
}
