import ModalConstants from '../constants/modal';
import {
    OpenModalActionPayload,
    CloseModalActionPayload,
} from '../payload-types/modal';

export const openModal = function (payload: OpenModalActionPayload) {
    return {
        type: ModalConstants.OPEN_MODAL,
        payload: payload,
    };
};

export const closeModal = function (payload: CloseModalActionPayload) {
    return {
        type: ModalConstants.CLOSE_MODAL,
        payload: payload,
    };
};
