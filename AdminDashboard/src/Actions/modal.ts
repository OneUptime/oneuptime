import * as types from '../constants/modal';

export const openModal = (obj: $TSFixMe): void => {
    return {
        type: types.OPEN_MODAL,
        payload: obj,
    };
};
export const closeModal = (obj: $TSFixMe): void => {
    return {
        type: types.CLOSE_MODAL,
        payload: obj,
    };
};
