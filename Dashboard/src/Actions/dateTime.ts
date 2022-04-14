import { Dispatch } from 'redux';

export const setStartDate: Function = (date: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'SET_START_DATE',
            payload: date,
        });
    };
};

export const setEndDate: Function = (date: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        dispatch({
            type: 'SET_END_DATE',
            payload: date,
        });
    };
};
