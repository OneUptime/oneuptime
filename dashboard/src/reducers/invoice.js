import * as types from '../constants/invoice'

const initialState = {
    requesting: false,
    error: null,
    success: false,
    invoices: []
};


export default function getInvoice(state = initialState, action) {
    switch (action.type) {

      case types.GET_INVOICE_REQUEST:
        return Object.assign({}, state, {
          requesting: true,
          error: null,
          success: false
        });

      case types.GET_INVOICE_SUCCESS:
        return Object.assign({}, state, {
          requesting: false,
          success: true,
          invoices: state.invoices.concat(action.payload),
          error: null
        })

      case types.GET_INVOICE_FAILED:
        return Object.assign({}, state, {
          requesting: false,
          success: false,
          error: action.payload
        })

      case types.GET_INVOICE_RESET:
        return Object.assign({}, {
          requesting: false,
          success: false,
          error: null,
          invoices: []
        })

      default:
        return state;
    }
}
