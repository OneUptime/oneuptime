import * as types from '../constants/modal';
import { OpenModalAction, CloseModalAction } from '../types/modal';

export const openModal = function (obj: OpenModalAction) {
    return {
        type: types.OPEN_MODAL,
        payload: obj,
    };
};

export const closeModal = function (obj: CloseModalAction) {
    return {
        type: types.CLOSE_MODAL,
        payload: obj,
    };
};
