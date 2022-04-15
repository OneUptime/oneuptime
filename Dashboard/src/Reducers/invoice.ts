import * as types from '../constants/invoice';
import Action from 'CommonUI/src/types/action';
const getInitialState: Function = (): void => {
    return {
        requesting: false,
        error: null,
        success: false,
        invoices: [],
        nextCount: 0,
    };
};

export default function getInvoice(
    state = getInitialState(),
    action: Action
): void {
    switch (action.type) {
        case types.GET_INVOICE_REQUEST:
            return Object.assign({}, state, {
                requesting: true,
                error: null,
                success: false,
            });

        case types.GET_INVOICE_SUCCESS:
            return Object.assign({}, state, {
                requesting: false,
                success: true,
                invoices: {
                    data:
                        (action.payload.data && action.payload.data.data) || [],
                    has_more:
                        (action.payload.data && action.payload.data.has_more) ||
                        false,
                    count: action.payload.count || 0,
                },
                error: null,
            });

        case types.GET_INVOICE_FAILED:
            return Object.assign({}, state, {
                requesting: false,
                success: false,
                error: action.payload,
            });

        case types.GET_INVOICE_RESET:
            return Object.assign({}, getInitialState());

        case types.INCREMENT_NEXT_COUNT:
            return Object.assign({}, state, {
                nextCount: state.nextCount + 1,
            });

        case types.DECREMENT_NEXT_COUNT:
            return Object.assign({}, state, {
                nextCount: state.nextCount - 1,
            });

        default:
            return state;
    }
}
