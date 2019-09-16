import {
    SHOW_PROFILE_MENU,
    HIDE_PROFILE_MENU
} from '../constants/profile';

const INITIAL_STATE = {
    menuVisible: false,
};

export default function profileSettings(state = INITIAL_STATE, action) {

    switch (action.type) {

        case SHOW_PROFILE_MENU:

            return Object.assign({}, state, {
                menuVisible: true
            });

        case HIDE_PROFILE_MENU:

            return Object.assign({}, state, {
                menuVisible: false
            });

        default: return state;
    }
}
