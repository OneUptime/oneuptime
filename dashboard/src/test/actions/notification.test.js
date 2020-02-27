import axiosMock from '../axios_mock';
import { API_URL } from '../../config';
import * as _actions from '../../actions/notification';
import * as _types from '../../constants/notification';

const actions = { ..._actions, ..._types };

describe('actions', () => {
    it('should create an action of type OPEN_NOTIFICATION_MENU', () => {
        const expectedAction = {
            type: actions.OPEN_NOTIFICATION_MENU,
        };
        expect(actions.openNotificationMenu().type).toEqual(
            expectedAction.type
        );
    });
});

describe('actions', () => {
    it('should create an action of type CLOSE_NOTIFICATION_MENU', () => {
        const error = 'error that will occur';
        const expectedAction = {
            type: actions.CLOSE_NOTIFICATION_MENU,
        };
        expect(actions.closeNotificationMenu(error).type).toEqual(
            expectedAction.type
        );
        expect(actions.closeNotificationMenu(error).payload).toEqual(error);
    });
});

describe('actions', () => {
    it('should create an action of type OPEN_NOTIFICATION_MENU', () => {
        const error = 'error that will occur';
        const expectedAction = {
            type: actions.CLOSE_NOTIFICATION_MENU,
        };
        const action = actions.closeNotificationMenu(error);
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(error);
    });
});

/*
     Create a new project actions
*/

describe('actions', () => {
    it('should create an action of type FETCH_NOTIFICATIONS_REQUEST', () => {
        const expectedAction = {
            type: actions.FETCH_NOTIFICATIONS_REQUEST,
        };
        expect(actions.fetchNotificationsRequest().type).toEqual(
            expectedAction.type
        );
    });
});

describe('actions', () => {
    it('should create an action of type FETCH_NOTIFICATIONS_FAILED', () => {
        const error = 'error that will occur';
        const expectedAction = {
            type: actions.FETCH_NOTIFICATIONS_FAILED,
        };
        const action = actions.fetchNotificationsError(error);
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(error);
    });
});

describe('actions', () => {
    it('should create an action of type FETCH_NOTIFICATIONS_SUCCESS', () => {
        const notifications = [];
        const expectedAction = {
            notifications: [],
            type: actions.FETCH_NOTIFICATIONS_SUCCESS,
        };
        const action = actions.fetchNotificationsSuccess(notifications);
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(notifications);
    });
});

describe('actions', () => {
    it('should create an action of type FETCH_NOTIFICATIONS_RESET', () => {
        const expectedAction = {
            type: actions.FETCH_NOTIFICATIONS_RESET,
        };
        expect(actions.fetchNotificationsReset().type).toEqual(
            expectedAction.type
        );
    });
});

describe('actions', () => {
    it('should create an action of type NOTIFICATION_READ_SUCCESS', () => {
        const notificationId = 'notificationId';
        const expectedAction = {
            notifications: [],
            type: actions.NOTIFICATION_READ_SUCCESS,
        };
        const action = actions.notificationReadSuccess(notificationId);
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(notificationId);
    });
});

describe('actions', () => {
    it('should create an action of type ALL_NOTIFICATION_READ_SUCCESS', () => {
        const projectId = 'projectId';
        const expectedAction = {
            type: actions.ALL_NOTIFICATION_READ_SUCCESS,
        };
        const action = actions.allNotificationReadSuccess(projectId);
        expect(action.type).toEqual(expectedAction.type);
        expect(action.payload).toEqual(projectId);
    });
});

describe('actions', () => {
    it('should despatch FETCH_NOTIFICATIONS_REQUEST and FETCH_NOTIFICATIONS_SUCCESS  actions', () => {
        axiosMock
            .onGet(`${API_URL}/notification/projectId/getNotifications`)
            .reply(200, [], {});

        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.FETCH_NOTIFICATIONS_SUCCESS:
                    expect(dispatched.type).toEqual(
                        actions.FETCH_NOTIFICATIONS_SUCCESS
                    );
                    expect(dispatched.payload).toEqual([]);
                    break;
                case actions.FETCH_NOTIFICATIONS_REQUEST:
                    expect(dispatched.type).toEqual(
                        actions.FETCH_NOTIFICATIONS_REQUEST
                    );

                    break;
                default:
                    expect(dispatched.type).toEqual(
                        actions.FETCH_NOTIFICATIONS_FAILED
                    );
                    expect(dispatched.payload).toEqual('fail test');
            }
        };
        actions.fetchNotifications('projectId')(dispatch);
    });
});
describe('actions', () => {
    it('should despatch ALERT_FETCH_REQUEST and ALERT_FETCH_SUCCESS  actions', () => {
        axiosMock
            .onPost(
                `${API_URL}/notification/projectId/notificationId/setNotificationasread`
            )
            .reply(200, { userId: 'userId' }, {});
        localStorage.setItem('id', 'user id');

        const dispatch = dispatched => {
            switch (dispatched.type) {
                case actions.NOTIFICATION_READ_SUCCESS:
                    expect(dispatched.type).toEqual(
                        actions.NOTIFICATION_READ_SUCCESS
                    );
                    expect(dispatched.payload).toEqual({
                        notificationId: { userId: 'userId' },
                        userId: 'user id',
                    });
                    break;
                case actions.FETCH_NOTIFICATIONS_REQUEST:
                    expect(dispatched.type).toEqual(
                        actions.FETCH_NOTIFICATIONS_REQUEST
                    );

                    break;
                default:
                    expect(dispatched.type).toEqual(
                        actions.FETCH_NOTIFICATIONS_FAILED
                    );
                    expect(dispatched.payload).toEqual('fail test');
            }
        };
        actions.markAsRead('projectId', 'notificationId')(dispatch);
    });
});
