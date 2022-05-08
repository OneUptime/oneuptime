import ModalConstant from '../constants/modal';
import ModalAction from '../ActionTypes/modal';
import {
    CloseModalActionPayload,
    OpenModalActionPayload,
} from '../PayloadTypes/modal';

export interface InitialStateType {
    modals: Array<OpenModalActionPayload>;
}

const initialState: InitialStateType = {
    modals: [],
};

export default (
    state: $TSFixMe = initialState,
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
                modals: state.modals.filter((item: $TSFixMe) => {
                    return (
                        item.id !==
                        (action.payload as CloseModalActionPayload).id
                    );
                }),
            });
        }

        default:
            return state;
    }
};
