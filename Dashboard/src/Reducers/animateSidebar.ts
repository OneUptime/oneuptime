import { ANIMATE_SIDEBAR } from '../constants/animateSidebar';

import Action from 'CommonUI/src/Types/Action';

const initialState: $TSFixMe = {
    animateSidebar: false,
};

export default (state: $TSFixMe = initialState, action: Action): void => {
    switch (action.type) {
        case ANIMATE_SIDEBAR:
            return Object.assign({}, state, {
                animateSidebar: action.payload,
            });
        default:
            return state;
    }
};
