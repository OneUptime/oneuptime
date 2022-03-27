import { ANIMATE_SIDEBAR } from '../constants/animateSidebar';

import Action from 'common-ui/src/types/action';

const initialState = {
    animateSidebar: false,
};

export default (state = initialState, action: Action) => {
    switch (action.type) {
        case ANIMATE_SIDEBAR:
            return Object.assign({}, state, {
                animateSidebar: action.payload,
            });
        default:
            return state;
    }
};
