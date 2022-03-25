import Modal from '../types/constants/modal';
import {
    OpenModalActionPayload,
    CloseModalActionPayload,
} from '../types/payloads/modal';

export const openModal = function (paylaod: OpenModalActionPayload) {
    return {
        type: Modal.OPEN_MODAL,
        payload: paylaod,
    };
};

export const closeModal = function (paylaod: CloseModalActionPayload) {
    return {
        type: Modal.CLOSE_MODAL,
        payload: paylaod,
    };
};
