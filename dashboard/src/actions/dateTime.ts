export const setStartDate = (date: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'SET_START_DATE',
            payload: date,
        });
    };
};

export const setEndDate = (date: $TSFixMe) => {
    return function (dispatch: $TSFixMe) {
        dispatch({
            type: 'SET_END_DATE',
            payload: date,
        });
    };
};
