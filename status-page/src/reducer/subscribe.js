import {
    OPEN_SUBSCRIBE_MENU,
    SELECTED_MENU,
    USER_DATA,
    USER_DATA_RESET,
    SUBSCRIBE_SUCCESS,
    SUBSCRIBE_REQUEST,
    SUBSCRIBE_FAILURE,
    VALIDATION_ERROR,
    OPEN_LANGUAGE_MENU,
} from '../actions/subscribe';

const INITIAL_STATE = {
    subscribeMenu: false,
    languageMenu: false,
    selectedMenu: 1,
    openSelectedBox: false,
    userDetails: {},
    subscribed: {
        requesting: false,
        success: false,
        error: false,
    },
    unsubscribe: {
        requesting: false,
        success: false,
        error: false,
    },
};

export default (state = INITIAL_STATE, action) => {
    switch (action.type) {
        case OPEN_SUBSCRIBE_MENU:
            return Object.assign({}, state, {
                subscribeMenu: !state.subscribeMenu,
                subscribed: {
                    requesting: state.subscribed.requesting,
                    success: state.subscribed.requesting,
                    error: false,
                },
                selectedMenu: 1,
                openSelectedBox: false,
            });
        case OPEN_LANGUAGE_MENU:
            return Object.assign({}, state, {
                languageMenu: !state.languageMenu,
                openSelectedBox: false,
            });
        case SELECTED_MENU:
            return Object.assign({}, state, {
                selectedMenu: action.payload,
                subscribed: {
                    requesting: state.subscribed.requesting,
                    success: state.subscribed.requesting,
                    error: false,
                },
                openSelectedBox: false,
            });

        case USER_DATA:
            return Object.assign({}, state, {
                userDetails: action.payload,
                subscribed: {
                    requesting: false,
                    success: false,
                    error: false,
                },
                openSelectedBox: !state.openSelectedBox,
            });

        case USER_DATA_RESET:
            return Object.assign({}, state, {
                userDetails: {},
            });

        case SUBSCRIBE_SUCCESS:
            return Object.assign({}, state, {
                subscribed: {
                    requesting: false,
                    success: true,
                    error: false,
                },
            });

        case SUBSCRIBE_REQUEST:
            return Object.assign({}, state, {
                subscribed: {
                    requesting: true,
                    success: false,
                    error: false,
                },
            });

        case SUBSCRIBE_FAILURE:
            return Object.assign({}, state, {
                subscribed: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case VALIDATION_ERROR:
            return Object.assign({}, state, {
                subscribed: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        default:
            return state;
    }
};
