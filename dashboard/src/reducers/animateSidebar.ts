import { ANIMATE_SIDEBAR } from '../constants/animateSidebar';

const initialState = {
    animateSidebar: false,
};

export default (state = initialState, action) => {
    switch (action.type) {
        case ANIMATE_SIDEBAR:
            return Object.assign({}, state, {
                animateSidebar: action.payload,
            });
        default:
            return state;
    }
};
