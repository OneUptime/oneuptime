import Modal from '../types/constants/modal';
import {
    OpenModalActionPayload,
    CloseModalActionPayload,
} from '../types/payloads/modal';

export const openModal = function (payload: OpenModalActionPayload) {
    return {
        type: Modal.OPEN_MODAL,
        payload: payload,
    };
};

export const closeModal = function (payload: CloseModalActionPayload) {
    return {
        type: Modal.CLOSE_MODAL,
        payload: payload,
    };
};
