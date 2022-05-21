import ModalConstant from '../Constants/ModalConstants';
import ModalAction from '../ActionTypes/ModalActionType';
import {
    CloseModalActionPayload,
    OpenModalActionPayload,
} from '../PayloadTypes/ModalPayloadType';

export interface InitialStateType {
    modals: Array<OpenModalActionPayload>;
}

const initialState: InitialStateType = {
    modals: [],
};

export default (
    state: InitialStateType = initialState,
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
                modals: state.modals.filter((item: OpenModalActionPayload) => {
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
