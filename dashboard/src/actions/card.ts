import { postApi, getApi, deleteApi, putApi } from '../api';
import * as types from '../constants/card';

export function addCardRequest(promise: $TSFixMe) {
    return {
        type: types.ADD_CARD_REQUEST,
        payload: promise,
    };
}

export function addCardFailed(error: $TSFixMe) {
    return {
        type: types.ADD_CARD_FAILED,
        payload: error,
    };
}

export function addCardSuccess(card: $TSFixMe) {
    return {
        type: types.ADD_CARD_SUCCESS,
        payload: card,
    };
}

export function addCard(userId: $TSFixMe, token: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = postApi(`stripe/${userId}/creditCard/${token}`);

        dispatch(addCardRequest(promise));

        promise.then(
            function(card) {
                dispatch(addCardSuccess(card.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(addCardFailed(error));
            }
        );
        return promise;
    };
}
export function fetchCardsRequest(promise: $TSFixMe) {
    return {
        type: types.FETCH_CARDS_REQUEST,
        payload: promise,
    };
}

export function fetchCardsFailed(error: $TSFixMe) {
    return {
        type: types.FETCH_CARDS_FAILED,
        payload: error,
    };
}

export function fetchCardsSuccess(cards: $TSFixMe) {
    return {
        type: types.FETCH_CARDS_SUCCESS,
        payload: cards,
    };
}

export function fetchCards(userId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = getApi(`stripe/${userId}/creditCard`);

        dispatch(fetchCardsRequest(promise));

        promise.then(
            function(cards) {
                dispatch(fetchCardsSuccess(cards.data.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(fetchCardsFailed(error));
            }
        );
        return promise;
    };
}

export function deleteCardRequest(promise: $TSFixMe) {
    return {
        type: types.DELETE_CARD_REQUEST,
        payload: promise,
    };
}

export function deleteCardFailed(error: $TSFixMe) {
    return {
        type: types.DELETE_CARD_FAILED,
        payload: error,
    };
}

export function deleteCardSuccess(card: $TSFixMe) {
    return {
        type: types.DELETE_CARD_SUCCESS,
        payload: card,
    };
}

export function deleteCard(userId: $TSFixMe, cardId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = deleteApi(`stripe/${userId}/creditCard/${cardId}`);

        dispatch(deleteCardRequest(promise));

        promise.then(
            function(card) {
                dispatch(deleteCardSuccess(card.data));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(deleteCardFailed(error));
            }
        );
        return promise;
    };
}

export function setDefaultCardRequest(promise: $TSFixMe, cardId: $TSFixMe) {
    return {
        type: types.SET_DEFAULT_CARD_REQUEST,
        payload: {
            promise,
            cardId,
        },
    };
}

export function setDefaultCardFailed(error: $TSFixMe) {
    return {
        type: types.SET_DEFAULT_CARD_FAILED,
        payload: error,
    };
}

export function setDefaultCardSuccess(card: $TSFixMe) {
    return {
        type: types.SET_DEFAULT_CARD_SUCCESS,
        payload: card,
    };
}

export function setDefaultCard(userId: $TSFixMe, cardId: $TSFixMe) {
    return function(dispatch: $TSFixMe) {
        const promise = putApi(`stripe/${userId}/creditCard/${cardId}`);

        dispatch(setDefaultCardRequest(promise, cardId));

        promise.then(
            function(card) {
                dispatch(setDefaultCardSuccess(card.data));
                dispatch(fetchCards(userId));
            },
            function(error) {
                if (error && error.response && error.response.data)
                    error = error.response.data;
                if (error && error.data) {
                    error = error.data;
                }
                if (error && error.message) {
                    error = error.message;
                } else {
                    error = 'Network Error';
                }
                dispatch(setDefaultCardFailed(error));
            }
        );
        return promise;
    };
}
