
export function addnotifications(notification) {
    return function (dispatch) {
            dispatch({
                type: 'ADD_NOTIFICATION_BY_SOCKET',
                payload: notification
            });
    };
}