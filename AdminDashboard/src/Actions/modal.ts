import * as types from '../constants/Modal';

export const openModal: Function = (obj: $TSFixMe): void => {
    return {
        type: types.OPEN_MODAL,
        payload: obj,
    };
};
export const closeModal: Function = (obj: $TSFixMe): void => {
    return {
        type: types.CLOSE_MODAL,
        payload: obj,
    };
};
