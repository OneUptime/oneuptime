import {
    OPEN_NOTIFICATION_MENU,
    CLOSE_NOTIFICATION_MENU,
    FETCH_NOTIFICATIONS_FAILED,
    FETCH_NOTIFICATIONS_SUCCESS,
    FETCH_NOTIFICATIONS_REQUEST,
    FETCH_NOTIFICATIONS_RESET,
    NOTIFICATION_READ_SUCCESS,
    NOTIFICATION_CLOSED_SUCCESS,
    ALL_NOTIFICATION_READ_SUCCESS,
    RESET_PROJECT_NOTIFICATIONS,
} from '../constants/notification';

const initialState = {
    notifications: {
        error: null,
        requesting: false,
        success: false,
        notifications: [],
    },
    notificationsVisible: false,
    notificationsPosition: 0,
};

export default (state = initialState, action: $TSFixMe) => {
    switch (action.type) {
        case OPEN_NOTIFICATION_MENU:
            return Object.assign({}, state, {
                notificationsVisible: true,
                notificationsPosition: action.payload,
            });

        case CLOSE_NOTIFICATION_MENU:
            return Object.assign({}, state, {
                notificationsVisible: false,
            });

        case FETCH_NOTIFICATIONS_FAILED:
            return Object.assign({}, state, {
                notifications: {
                    ...state.notifications,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_NOTIFICATIONS_SUCCESS:
            return Object.assign({}, state, {
                notifications: {
                    requesting: false,
                    success: true,
                    error: null,
                    notifications: action.payload.data,
                },
            });

        case FETCH_NOTIFICATIONS_REQUEST:
            return Object.assign({}, state, {
                notifications: {
                    ...state.notifications,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case FETCH_NOTIFICATIONS_RESET:
            return Object.assign({}, state, {
                notifications: {
                    error: null,
                    requesting: false,
                    success: false,
                    notifications: [],
                },
                notificationsVisible: false,
            });

        case 'ADD_NOTIFICATION_BY_SOCKET': {
            const notify = state.notifications.notifications;
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
            notify.unshift(action.payload);
            return Object.assign({}, state, {
                notifications: {
                    error: null,
                    requesting: false,
                    success: true,
                    notifications: notify,
                },
            });
        }

        case NOTIFICATION_READ_SUCCESS:
            return Object.assign({}, state, {
                notifications: {
                    ...state.notifications,
                    notifications: state.notifications.notifications.map(
                        notification => {
                            if (
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                notification._id ===
                                action.payload.notificationId
                            ) {
                                return {
                                    // @ts-expect-error ts-migrate(2698) FIXME: Spread types may only be created from object types... Remove this comment to see the full error message
                                    ...notification,
                                    read: notification.read.concat([
                                        action.payload.userId,
                                    ]),
                                };
                            } else {
                                return notification;
                            }
                        }
                    ),
                },
            });

        case NOTIFICATION_CLOSED_SUCCESS:
            return Object.assign({}, state, {
                notifications: {
                    ...state.notifications,
                    notifications: state.notifications.notifications.map(
                        notification => {
                            if (
                                // @ts-expect-error ts-migrate(2339) FIXME: Property '_id' does not exist on type 'never'.
                                notification._id ===
                                action.payload.notificationId
                            ) {
                                return {
                                    // @ts-expect-error ts-migrate(2698) FIXME: Spread types may only be created from object types... Remove this comment to see the full error message
                                    ...notification,
                                    closed: notification.closed.concat([
                                        action.payload.userId,
                                    ]),
                                };
                            } else {
                                return notification;
                            }
                        }
                    ),
                },
            });

        case ALL_NOTIFICATION_READ_SUCCESS:
            return Object.assign({}, state, {
                notifications: {
                    ...state.notifications,
                    notifications: state.notifications.notifications.map(
                        notification => {
                            return {
                                // @ts-expect-error ts-migrate(2698) FIXME: Spread types may only be created from object types... Remove this comment to see the full error message
                                ...notification,
                                read: notification.read.concat([
                                    action.payload,
                                ]),
                            };
                        }
                    ),
                },
            });

        case RESET_PROJECT_NOTIFICATIONS:
            return Object.assign({}, state, {
                notifications: {
                    ...state.notifications,
                    notifications: state.notifications.notifications.filter(
                        notification =>
                            // @ts-expect-error ts-migrate(2339) FIXME: Property 'projectId' does not exist on type 'never... Remove this comment to see the full error message
                            notification.projectId !== action.payload
                    ),
                },
            });

        default:
            return state;
    }
};
