import * as types from '../constants/customField';

import Action from 'Common-ui/src/types/action';

const initialState = {
    customField: {
        requesting: false,
        success: false,
        error: null,
        field: null,
    },
    customFields: {
        requesting: false,
        success: false,
        error: null,
        fields: [],
        count: 0,
        skip: 0,
        limit: 10,
    },
    page: 1,
};

export default function customField(state = initialState, action: Action) {
    switch (action.type) {
        case types.CREATE_CUSTOM_FIELD_REQUEST:
            return {
                ...state,
                customField: {
                    ...state.customField,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.CREATE_CUSTOM_FIELD_SUCCESS:
            return {
                ...state,
                customField: {
                    requesting: false,
                    success: true,
                    error: null,
                    field: action.payload,
                },
                page: 1,
            };

        case types.CREATE_CUSTOM_FIELD_FAILURE:
            return {
                ...state,
                customField: {
                    ...state.customField,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.DELETE_CUSTOM_FIELD_REQUEST:
            return {
                ...state,
                customField: {
                    ...state.customField,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.DELETE_CUSTOM_FIELD_SUCCESS: {
            const fields = state.customFields.fields.filter(
                field => String(field._id) !== String(action.payload._id)
            );
            return {
                ...state,
                customFields: {
                    ...state.customFields,
                    fields,
                    count: state.customFields.count - 1,
                },
                customField: {
                    ...state.customField,
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        }

        case types.DELETE_CUSTOM_FIELD_FAILURE:
            return {
                ...state,
                customField: {
                    ...state.customField,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.FETCH_CUSTOM_FIELDS_REQUEST:
            return {
                ...state,
                customFields: {
                    ...state.customFields,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.FETCH_CUSTOM_FIELDS_SUCCESS:
            return {
                ...state,
                customFields: {
                    requesting: false,
                    success: true,
                    error: null,
                    fields: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip,
                },
            };

        case types.FETCH_CUSTOM_FIELDS_FAILURE:
            return {
                ...state,
                customFields: {
                    ...state.customFields,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        case types.UPDATE_CUSTOM_FIELD_REQUEST:
            return {
                ...state,
                customFields: {
                    ...state.customFields,
                    requesting: true,
                    success: false,
                    error: null,
                },
            };

        case types.UPDATE_CUSTOM_FIELD_SUCCESS: {
            const fields = state.customFields.fields.map(field => {
                if (String(field._id) === String(action.payload._id)) {
                    field = action.payload;
                }

                return field;
            });
            return {
                ...state,
                customFields: {
                    ...state.customFields,
                    requesting: false,
                    success: true,
                    error: null,
                    fields,
                },
            };
        }

        case types.UPDATE_CUSTOM_FIELD_FAILURE:
            return {
                ...state,
                customFields: {
                    ...state.customFields,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.NEXT_PAGE:
            return {
                ...state,
                page: state.page + 1,
            };
        case types.PREV_PAGE:
            return {
                ...state,
                page: state.page > 1 ? state.page - 1 : 1,
            };

        default:
            return state;
    }
}
