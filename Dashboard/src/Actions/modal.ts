import * as types from '../constants/modal';

export const openModal = function (obj: $TSFixMe): void {
    return {
        type: types.OPEN_MODAL,
        payload: obj,
    };
};
export const closeModal = function (obj: $TSFixMe): void {
    return {
        type: types.CLOSE_MODAL,
        payload: obj,
    };
};
