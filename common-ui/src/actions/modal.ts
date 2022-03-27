import ModalConstants from '../constants/modal';
import { PayloadTypes } from '../payloads/modal';
import {
    OpenModalActionPayload,
    CloseModalActionPayload,
} from '../payloads/modal';
import Action from '../types/action';

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

export interface ModalAction extends Action {
    payload: PayloadTypes;
}
