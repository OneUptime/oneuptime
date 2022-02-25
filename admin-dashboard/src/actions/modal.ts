import * as types from '../constants/modal';

export const openModal = obj => {
    return {
        type: types.OPEN_MODAL,
        payload: obj,
    };
};
export const closeModal = obj => {
    return {
        type: types.CLOSE_MODAL,
        payload: obj,
    };
};
