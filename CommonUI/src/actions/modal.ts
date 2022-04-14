import ModalConstants from '../constants/modal';
import {
    OpenModalActionPayload,
    CloseModalActionPayload,
} from '../payload-types/modal';
import Action from '../types/action';

export const openModal: $TSFixMe = function (payload: OpenModalActionPayload): Action {
    return new Action({
        type: ModalConstants.OPEN_MODAL,
        payload: payload,
    });
};

export const closeModal: $TSFixMe = function (payload: CloseModalActionPayload): Action {
    return new Action({
        type: ModalConstants.CLOSE_MODAL,
        payload: payload,
    });
};
