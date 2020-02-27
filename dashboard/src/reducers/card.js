import * as types from '../constants/card';

const initialState = {
    addCard: {
        requesting: false,
        error: null,
        success: false,
        card: {},
    },
    fetchCards: {
        requesting: false,
        error: null,
        success: false,
        cards: [],
    },
    deleteCard: {
        requesting: false,
        error: null,
        success: false,
        card: {},
    },
    setDefaultCard: {
        requesting: false,
        requestingCardId: null,
        error: null,
        success: false,
        card: {},
    },
};

export default function card(state = initialState, action) {
    switch (action.type) {
        case types.ADD_CARD_REQUEST:
            return Object.assign({}, state, {
                ...state,
                addCard: {
                    ...state.addCard,
                    requesting: true,
                },
            });

        case types.ADD_CARD_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                addCard: {
                    requesting: false,
                    error: null,
                    success: true,
                    card: action.payload,
                },
                fetchCards: {
                    ...state.fetchCards,
                    cards: state.fetchCards.cards.concat(action.payload),
                },
            });

        case types.ADD_CARD_FAILED:
            return Object.assign({}, state, {
                ...state,
                addCard: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.FETCH_CARDS_REQUEST:
            return Object.assign({}, state, {
                ...state,
                fetchCards: {
                    ...state.fetchCards,
                    requesting: true,
                },
            });

        case types.FETCH_CARDS_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                fetchCards: {
                    ...state.fetchCards,
                    requesting: false,
                    success: true,
                    error: null,
                    cards: action.payload.sort(function(a, b) {
                        if (a.id > b.id) {
                            return -1;
                        }
                        return 1;
                    }),
                },
            });

        case types.FETCH_CARDS_FAILED:
            return Object.assign({}, state, {
                ...state,
                fetchCards: {
                    ...state.fetchCards,
                    requesting: false,
                    error: action.payload,
                },
            });

        case types.DELETE_CARD_REQUEST:
            return Object.assign({}, state, {
                ...state,
                deleteCard: {
                    ...state.deleteCard,
                    requesting: true,
                },
            });

        case types.DELETE_CARD_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                deleteCard: {
                    ...state.deleteCard,
                    requesting: false,
                    success: true,
                },
                fetchCards: {
                    ...state.fetchCards,
                    cards: state.fetchCards.cards.filter(card => {
                        if (action.payload.id === card.id) {
                            return false;
                        }
                        return true;
                    }),
                },
            });

        case types.DELETE_CARD_FAILED:
            return Object.assign({}, state, {
                ...state,
                deleteCard: {
                    ...state.deleteCard,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            });

        case types.SET_DEFAULT_CARD_REQUEST:
            return Object.assign({}, state, {
                ...state,
                setDefaultCard: {
                    ...state.setDefaultCard,
                    requesting: true,
                    requestingCardId: action.payload.cardId,
                },
            });

        case types.SET_DEFAULT_CARD_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                setDefaultCard: {
                    ...state.setDefaultCard,
                    requesting: false,
                    card: action.payload,
                    requestingCardId: null,
                },
            });

        case types.SET_DEFAULT_CARD_FAILED:
            return Object.assign({}, state, {
                ...state,
                setDefaultCard: {
                    ...state.setDefaultCard,
                    requesting: false,
                    error: action.payload,
                    requestingCardId: null,
                },
            });

        default:
            return state;
    }
}
