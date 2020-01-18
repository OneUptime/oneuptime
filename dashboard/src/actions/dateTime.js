export function setStartDate(date) {
    return function (dispatch) {
        dispatch({
            type: 'SET_START_DATE',
            payload: date
        });
    };
}

export function setEndDate(date) {
    return function (dispatch) {
        dispatch({
            type: 'SET_END_DATE',
            payload: date
        });
    };
}