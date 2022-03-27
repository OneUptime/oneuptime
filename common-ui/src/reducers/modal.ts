import ModalConstant from '../constants/modal';
import { ModalAction } from '../actions/modal';

const initialState = {
    modals: [],
};

export default (state = initialState, action: ModalAction) => {
    switch (action.type) {
        case ModalConstant.OPEN_MODAL:
            return Object.assign({}, state, {
                modals: state.modals.concat(action.payload),
            });

        case ModalConstant.CLOSE_MODAL:
            return Object.assign({}, state, {
                modals: state.modals.filter(
                    item => item.id !== action.payload.id
                ),
            });

        default:
            return state;
    }
};
