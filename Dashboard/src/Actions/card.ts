import BackendAPI from 'CommonUI/src/utils/api/backend';
import { Dispatch } from 'redux';
import ObjectID from 'Common/Types/ObjectID';
import * as types from '../constants/card';
import ErrorPayload from 'CommonUI/src/payload-types/error';
export const addCardRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.ADD_CARD_REQUEST,
        payload: promise,
    };
};

export const addCardFailed: Function = (error: ErrorPayload): void => {
    return {
        type: types.ADD_CARD_FAILED,
        payload: error,
    };
};

export const addCardSuccess: Function = (card: $TSFixMe): void => {
    return {
        type: types.ADD_CARD_SUCCESS,
        payload: card,
    };
};

export const addCard: Function = (userId: ObjectID, token: $TSFixMe): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.post(`stripe/${userId}/creditCard/${token}`);

        dispatch(addCardRequest(promise));

        promise.then(
            (card): void => {
                dispatch(addCardSuccess(card.data));
            },
            (error): void => {
                dispatch(addCardFailed(error));
            }
        );
        return promise;
    };
};
export const fetchCardsRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.FETCH_CARDS_REQUEST,
        payload: promise,
    };
};

export const fetchCardsFailed: Function = (error: ErrorPayload): void => {
    return {
        type: types.FETCH_CARDS_FAILED,
        payload: error,
    };
};

export const fetchCardsSuccess: Function = (cards: $TSFixMe): void => {
    return {
        type: types.FETCH_CARDS_SUCCESS,
        payload: cards,
    };
};

export const fetchCards: Function = (userId: ObjectID): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.get(`stripe/${userId}/creditCard`);

        dispatch(fetchCardsRequest(promise));

        promise.then(
            (cards): void => {
                dispatch(fetchCardsSuccess(cards.data.data));
            },
            (error): void => {
                dispatch(fetchCardsFailed(error));
            }
        );
        return promise;
    };
};

export const deleteCardRequest: Function = (promise: $TSFixMe): void => {
    return {
        type: types.DELETE_CARD_REQUEST,
        payload: promise,
    };
};

export const deleteCardFailed: Function = (error: ErrorPayload): void => {
    return {
        type: types.DELETE_CARD_FAILED,
        payload: error,
    };
};

export const deleteCardSuccess: Function = (card: $TSFixMe): void => {
    return {
        type: types.DELETE_CARD_SUCCESS,
        payload: card,
    };
};

export const deleteCard: Function = (
    userId: ObjectID,
    cardId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = delete `stripe/${userId}/creditCard/${cardId}`;

        dispatch(deleteCardRequest(promise));

        promise.then(
            (card): void => {
                dispatch(deleteCardSuccess(card.data));
            },
            (error): void => {
                dispatch(deleteCardFailed(error));
            }
        );
        return promise;
    };
};

export const setDefaultCardRequest: Function = (
    promise: $TSFixMe,
    cardId: $TSFixMe
): void => {
    return {
        type: types.SET_DEFAULT_CARD_REQUEST,
        payload: {
            promise,
            cardId,
        },
    };
};

export const setDefaultCardFailed: Function = (error: ErrorPayload): void => {
    return {
        type: types.SET_DEFAULT_CARD_FAILED,
        payload: error,
    };
};

export const setDefaultCardSuccess: Function = (card: $TSFixMe): void => {
    return {
        type: types.SET_DEFAULT_CARD_SUCCESS,
        payload: card,
    };
};

export const setDefaultCard: Function = (
    userId: ObjectID,
    cardId: $TSFixMe
): void => {
    return function (dispatch: Dispatch): void {
        const promise = BackendAPI.put(`stripe/${userId}/creditCard/${cardId}`);

        dispatch(setDefaultCardRequest(promise, cardId));

        promise.then(
            (card): void => {
                dispatch(setDefaultCardSuccess(card.data));
                dispatch(fetchCards(userId));
            },
            (error): void => {
                dispatch(setDefaultCardFailed(error));
            }
        );
        return promise;
    };
};
