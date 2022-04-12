import { Dispatch } from 'redux';

export const setStartDate = (date: $TSFixMe): void => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'SET_START_DATE',
            payload: date,
        });
    };
};

export const setEndDate = (date: $TSFixMe): void => {
    return function (dispatch: Dispatch) {
        dispatch({
            type: 'SET_END_DATE',
            payload: date,
        });
    };
};
