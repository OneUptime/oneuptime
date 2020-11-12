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
} from '../constants/errorTracker';

const INITIAL_STATE = {
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
    },
    errorTrackerIssues: {},
    errorEvents: {},
};
export default function errorTracker(state = INITIAL_STATE, action) {
    let temporaryIssues, temporaryErrorEvents;
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
                    errorTrackers: action.payload,
                },
            });

        case FETCH_ERROR_TRACKERS_FAILURE:
            return Object.assign({}, state, {
                errorTrackersList: {
                    ...state.errorTrackersList,
                    requesting: false,
                    error: action.payload,
                    success: false,
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
                    requesting: true,
                    error: null,
                    success: false,
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
                [action.payload.errorTrackerId]: state.errorTrackerIssues[
                    action.payload.errorTrackerId
                ]
                    ? {
                          ...state.errorTrackerIssues[
                              action.payload.errorTrackerId
                          ],
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
                      },
            };
            return Object.assign({}, state, {
                errorTrackerIssues: temporaryIssues,
            });
        case FETCH_ERROR_EVENT_REQUEST:
            // check if the error event exist
            // if it doesnt, create the error event details
            // if it does, update the requesting
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
                          errorEvent: null,
                          error: null,
                          requesting: true,
                          success: false,
                          previous: null,
                          next: null,
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
                          errorEvent: null,
                          error: action.payload.error,
                          requesting: false,
                          success: false,
                          previous: null,
                          next: null,
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
        default:
            return state;
    }
}
