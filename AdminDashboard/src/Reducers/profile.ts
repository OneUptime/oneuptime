import { SHOW_PROFILE_MENU, HIDE_PROFILE_MENU } from '../constants/profile';

import Action from 'CommonUI/src/Types/Action';

const INITIAL_STATE: $TSFixMe = {
    menuVisible: false,
    menuPosition: 0,
};

export default function profileSettings(
    state: $TSFixMe = INITIAL_STATE,
    action: Action
): void {
    switch (action.type) {
        case SHOW_PROFILE_MENU:
            return Object.assign({}, state, {
                menuVisible: true,
                menuPosition: action.payload,
            });

        case HIDE_PROFILE_MENU:
            return Object.assign({}, state, {
                menuVisible: false,
            });

        default:
            return state;
    }
}
