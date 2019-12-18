import {
    FETCH_SCHEDULED_EVENTS_SUCCESS,
    FETCH_SCHEDULED_EVENTS_REQUEST,
    FETCH_SCHEDULED_EVENTS_FAILURE,
    CREATE_SCHEDULED_EVENT_SUCCESS,
    CREATE_SCHEDULED_EVENT_REQUEST,
    CREATE_SCHEDULED_EVENT_FAILURE,
    DELETE_SCHEDULED_EVENT_SUCCESS,
    DELETE_SCHEDULED_EVENT_REQUEST,
    DELETE_SCHEDULED_EVENT_FAILURE,
    UPDATE_SCHEDULED_EVENT_SUCCESS,
    UPDATE_SCHEDULED_EVENT_REQUEST,
    UPDATE_SCHEDULED_EVENT_FAILURE
} from '../constants/scheduledEvent';


const INITIAL_STATE = {
    scheduledEventList: {
        scheduledEvents: [],
        error: null,
        requesting: false,
        success: false,
        skip: null,
        limit: null,
        count: null
    },
    newScheduledEvent: {
        scheduledEvent: null,
        error: null,
        requesting: false,
        success: false
    },
    deletedScheduledEvent: {
        error: null,
        requesting: false,
        success: false
    },
    updatedScheduledEvent: {
        scheduledEvent: null,
        error: null,
        requesting: false,
        success: false
    }
}


export default function scheduledEvent(state = INITIAL_STATE, action) {
    switch (action.type) {
        case CREATE_SCHEDULED_EVENT_SUCCESS:
            return Object.assign({}, state, {
                newScheduledEvent: {
                    requesting: false,
                    error: null,
                    success: true,
                    scheduledEvent: action.payload
                },
                scheduledEventList: {
                    ...state.scheduledEventList,
                    scheduledEvents: state.scheduledEventList.scheduledEvents.concat(action.payload),
                    count:state.scheduledEventList.count+1
                }
            });
        case CREATE_SCHEDULED_EVENT_FAILURE:
            return Object.assign({}, state, {
                ...state,
                newScheduledEvent: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    scheduledEvent: state.newScheduledEvent.scheduledEvent
                }
            });
        case CREATE_SCHEDULED_EVENT_REQUEST:
            return Object.assign({}, state, {
                ...state,
                newScheduledEvent: {
                    requesting: true,
                    error: null,
                    success: false,
                    scheduledEvent: state.newScheduledEvent.scheduledEvent
                }
            });

        case FETCH_SCHEDULED_EVENTS_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                scheduledEventList: {
                    requesting: false,
                    error: null,
                    success: true,
                    scheduledEvents: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip
                }
            });
        case FETCH_SCHEDULED_EVENTS_FAILURE:
            return Object.assign({}, state, {
                ...state,
                scheduledEventList: {
                    ...state.scheduledEventList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                }
            });

        case FETCH_SCHEDULED_EVENTS_REQUEST:
            return Object.assign({}, state, {
                ...state,
                scheduledEventList: {
                    ...state.scheduledEventList,
                    requesting: true,
                }
            });

        case DELETE_SCHEDULED_EVENT_SUCCESS:
            return Object.assign({}, state, {
                ...state,
                scheduledEventList: {
                    ...state.scheduledEventList,
                    scheduledEvents: state.scheduledEventList.scheduledEvents.filter(scheduledEvent => {
                        if (scheduledEvent._id === action.payload) {
                            return false;
                        } else {
                            return true;
                        }
                    }),
                    count:state.scheduledEventList.count-1
                },
                deletedScheduledEvent:{
                    requesting:false,
                    success:true,
                    error:false
                }
            });
        case DELETE_SCHEDULED_EVENT_FAILURE:
            return Object.assign({}, state, {
                ...state,
                deletedScheduledEvent:{
                    requesting:false,
                    success:false,
                    error: action.payload
                }
            });
        case DELETE_SCHEDULED_EVENT_REQUEST:
            return Object.assign({}, state, {
                ...state,
                deletedScheduledEvent:{
                    requesting:true,
                    success:false,
                    error:null
                }
            });

        case UPDATE_SCHEDULED_EVENT_SUCCESS:
            return Object.assign({}, state, {
                updatedScheduledEvent: {
                    requesting: false,
                    error: null,
                    success: true,
                    scheduledEvent: action.payload
                },
                scheduledEventList: {
                    ...state.scheduledEventList,
                    scheduledEvents: state.scheduledEventList.scheduledEvents.map(scheduledEvent => {
                        if (action.payload._id === scheduledEvent._id){
                            return action.payload
                        }
                        return scheduledEvent;
                    }),
                }
            });
        case UPDATE_SCHEDULED_EVENT_FAILURE:
            return Object.assign({}, state, {
                ...state,
                updatedScheduledEvent: {
                    ...state.updatedScheduledEvent,
                    requesting: false,
                    error: action.payload,
                    success: false,
                }
            });
        case UPDATE_SCHEDULED_EVENT_REQUEST:
            return Object.assign({}, state, {
                ...state,
                updatedScheduledEvent: {
                    ...state.updatedScheduledEvent,
                    requesting: true,
                    error: null,
                    success: false,
                }
            });

        default: return state;
    }
}
