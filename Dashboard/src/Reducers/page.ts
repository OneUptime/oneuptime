import {
    PAGE_LOAD_REQUEST,
    PAGE_LOAD_SUCCESS,
    PAGE_LOAD_RESET,
    TOGGLE_PROJECT_SETTINGS_MORE,
} from '../constants/page';

import Action from 'CommonUI/src/types/action';

const initialState = {
    requesting: false,
    title: '',
    sidenavopen: false,
    toggleProjectSettingsMore: false,
};

export default (state = initialState, action: Action) => {
    switch (action.type) {
        case PAGE_LOAD_REQUEST:
            return Object.assign({}, state, {
                requesting: true,
                title: action.payload,
            });

        case PAGE_LOAD_SUCCESS:
            return Object.assign({}, state, {
                requesting: false,
                title: action.payload,
            });

        case PAGE_LOAD_RESET:
            return Object.assign({}, state, {
                requesting: false,
                title: '',
            });

        case 'OPEN_SIDENAV':
            return Object.assign({}, state, {
                sidenavopen: true,
            });

        case 'CLOSE_SIDENAV':
            return Object.assign({}, state, {
                sidenavopen: false,
            });
        case TOGGLE_PROJECT_SETTINGS_MORE:
            return Object.assign({}, state, {
                toggleProjectSettingsMore: action.payload,
            });

        default:
            return state;
    }
};
