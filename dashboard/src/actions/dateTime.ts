export function setStartDate(date: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        dispatch({
            type: 'SET_START_DATE',
            payload: date,
        });
    };
}

export function setEndDate(date: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        dispatch({
            type: 'SET_END_DATE',
            payload: date,
        });
    };
}
