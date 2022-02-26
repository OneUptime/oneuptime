export const INITIAL_STATE = {
    data: {
        list: {
            data: [],
            skip: 0,
            limit: 10,
            count: 0
        },
        current: null,
    },
    loading: {
        list: false,
        get: false,
        delete: false,
        update: false,
        create: false,
    },
    error: {
        list: null,
        get: null,
        delete: null,
        update: null,
        create: null,
    },
};


const getReducer = ({
    actionBase
}: $TSFixMe) => {

    const createConstants = actionBase.getCreateConstants();
    const listConstants = actionBase.getListConstants();
    const getConstants = actionBase.getGetConstants();
    const deleteConstants = actionBase.getDeleteConstants();
    const updateConstants = actionBase.getUpdateConstants();

    return (state = INITIAL_STATE, action: $TSFixMe) => {
        switch (action.type) {


            // request 
            case createConstants.request:
                {
                    return {
                        ...state,
                        loading: {
                            ...state.loading,
                            create: true
                        }
                    };
                }

            case listConstants.request:
                {
                    return {
                        ...state,
                        loading: {
                            ...state.loading,
                            list: true
                        }
                    };
                }

            case deleteConstants.request:
                {
                    return {
                        ...state,
                        loading: {
                            ...state.loading,
                            delete: true
                        }
                    };
                }
            case getConstants.request:
                {
                    return {
                        ...state,
                        loading: {
                            ...state.loading,
                            get: true
                        }
                    };
                }

            case updateConstants.request:
                {
                    return {
                        ...state,
                        loading: {
                            ...state.loading,
                            update: true
                        }
                    };
                }

            // error

            case createConstants.failure:
                {
                    return {
                        ...state,
                        error: {
                            ...state.error,
                            create: action.payload
                        }
                    };
                }

            case listConstants.failure:
                {
                    return {
                        ...state,
                        error: {
                            ...state.error,
                            list: action.payload
                        }
                    };
                }

            case deleteConstants.failure:
                {
                    return {
                        ...state,
                        error: {
                            ...state.error,
                            delete: action.payload
                        }
                    };
                }
            case getConstants.failure:
                {
                    return {
                        ...state,
                        error: {
                            ...state.error,
                            get: action.payload
                        }
                    };
                }

            case updateConstants.failure:
                {
                    return {
                        ...state,
                        error: {
                            ...state.error,
                            update: action.payload
                        }
                    };
                }

            // Success Case

            case updateConstants.success:
                {
                    return {
                        ...state,
                        data: {
                            ...state.data,
                            current: action.payload
                        }
                    };
                }

            case getConstants.success:
                {
                    return {
                        ...state,
                        data: {
                            ...state.data,
                            current: action.payload
                        }
                    };
                }


            case deleteConstants.success:
                {
                    return {
                        ...state,
                        data: {
                            ...state.data,
                            current: null
                        }
                    };
                }

            case createConstants.success:
                {
                    return {
                        ...state,
                        data: {
                            ...state.data,
                            current: action.payload
                        }
                    };
                }

            case listConstants.success:
                {
                    return {
                        ...state,
                        data: {
                            ...state.data,
                            list: {
                                data: action.payload.data,
                                skip: action.payload.skip,
                                limit: action.payload.limit,
                                count: action.payload.count,
                            }
                        }
                    };
                }

            case listConstants.paginateNext:
                {
                    return {
                        ...state,
                        data: {
                            ...state.data,
                            list: {
                                data: [],
                                skip: state.data.list.skip + state.data.list.limit,
                                limit: state.data.list.limit,
                                count: state.data.list.count,
                            }
                        },
                        loading: {
                            ...state.loading,
                            list: true
                        }
                    };
                }
            case listConstants.paginatePrevious:
                {
                    return {
                        ...state,
                        data: {
                            ...state.data,
                            list: {
                                data: [],
                                skip: state.data.list.skip - state.data.list.limit,
                                limit: state.data.list.limit,
                                count: state.data.list.count,
                            }
                        },
                        loading: {
                            ...state.loading,
                            list: true
                        }
                    };
                }
            case listConstants.paginateToPage:
                {
                    return {
                        ...state,
                        data: {
                            ...state.data,
                            list: {
                                data: [],
                                skip:  state.data.list.limit * (action.payload-1),
                                limit: state.data.list.limit,
                                count: state.data.list.count,
                            }
                        },
                        loading: {
                            ...state.loading,
                            list: true
                        }
                    };
                }
            default:
                return state;
        }
    };
}


export default getReducer;
