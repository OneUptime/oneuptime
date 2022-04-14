import ModalConstant from '../constants/modal';
import ModalAction from '../action-types/modal';
import {
    CloseModalActionPayload,
    OpenModalActionPayload,
} from '../payload-types/modal';

export interface InitialStateType {
    modals: Array<OpenModalActionPayload>;
}

const initialState: InitialStateType: $TSFixMe = {
    modals: [],
};

export default (
    state = initialState,
    action: ModalAction
): InitialStateType => {
    switch (action.type) {
        case ModalConstant.OPEN_MODAL: {
            return Object.assign({}, state, {
                modals: state.modals.concat(
                    action.payload as OpenModalActionPayload
                ),
            });
        }

        case ModalConstant.CLOSE_MODAL: {
            return Object.assign({}, state, {
                modals: state.modals.filter(
                    item =>
                        item.id !==
                        (action.payload as CloseModalActionPayload).id
                ),
            });
        }

        default:
            return state;
    }
};
