import { OPEN_MODAL, CLOSE_MODAL } from '../constants/modal';

const initialState = {
    modals: [],
    feedbackModalVisble: false,
};

export default (state = initialState, action) => {
    switch (action.type) {
        case OPEN_MODAL:
            return Object.assign({}, state, {
                modals: state.modals.concat(action.payload),
            });

        // BUG FIX: issue with closing modal in the right order, when they are stacked on top of each other
        // since our modals are always going to be in a stack,
        // it makes sense to always remove items from the last index
        // LIFO ===> last in first out
        case CLOSE_MODAL: {
            const modals = [...state.modals];
            modals.pop();
            return Object.assign({}, state, {
                modals,
            });
        }

        default:
            return state;
    }
};
