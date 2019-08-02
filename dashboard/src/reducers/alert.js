import * as types from '../constants/alert'

const initialState = {
    alerts: {
        requesting: false,
        error: null,
        success: false,
        data: [],
        count: null,
        limit: null,
        skip: null
    },
    incidentalerts :{
        requesting: false,
        error: null,
        success: false,
        count:0,
        skip:0,
        limit:10,
        data: []
    },
    subscribersAlert :{
        requesting: false,
        error: null,
        success: false,
        count:0,
        skip:0,
        limit:10,
        data: []
    }
};

export default  (state = initialState, action) => {
    switch (action.type) {

        case types.ALERT_FETCH_SUCCESS:
            return Object.assign({}, state, {
                alerts: {
                    requesting: false,
                    error: null,
                    success: true,
                    data: action.payload,
                },
            });

        case types.ALERT_FETCH_REQUEST:
            return Object.assign({}, state, {
                alerts: {
                    requesting: true,
                    success: false,
                    error: null,
                    data: state.alerts.data,
                }
            });

        case types.ALERT_FETCH_FAILED:
            return Object.assign({}, state, {
                alerts: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    data: [],
                },
            });

        case types.ALERT_FETCH_RESET:
            return Object.assign({}, state, {
                alerts: {
                    requesting: false,
                    error: null,
                    success: false,
                    data: [],
                    count: null,
                    limit: null,
                    skip: null
                },
            });

        case types.PROJECT_ALERT_FETCH_SUCCESS:
            return Object.assign({}, state, {
                alerts: {
                    requesting: false,
                    error: null,
                    success: true,
                    data: state.alerts.data.map((alert)=>{
                        return alert._id === action.payload.projectId || alert._id === action.payload.projectId._id ?
                        {
                            _id: action.payload.projectId, 
                            alerts: [...action.payload.data], 
                            count: action.payload.count, 
                            skip: action.payload.skip, 
                            limit: action.payload.limit} 
                        : alert
                    }),
                },
            });

        case types.PROJECT_ALERT_FETCH_REQUEST:
            return Object.assign({}, state, {
                alerts: {
                    requesting: true,
                    success: false,
                    error: null,
                    data: state.alerts.data,
                }
            });

        case types.PROJECT_ALERT_FETCH_FAILED:
            return Object.assign({}, state, {
                alerts: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    data: [],
                },
            });

        case types.PROJECT_ALERT_FETCH_RESET:
            return Object.assign({}, state, {
                alerts: {
                    requesting: false,
                    error: null,
                    success: false,
                    data: [],
                    count: null,
                    limit: null,
                    skip: null
                },
            });

        case types.INCIDENTS_ALERT_FETCH_SUCCESS:
            return Object.assign({}, state, {
                incidentalerts: {
                    requesting: false,
                    error: null,
                    success: true,
                    count : action.payload.count,
                    skip : action.payload.skip,
                    limit : action.payload.limit,
                    data: action.payload.data
                },
            });

        case types.INCIDENTS_ALERT_FETCH_REQUEST:
            return Object.assign({}, state, {
                incidentalerts: {
                    requesting: true,
                    success: false,
                    error: null,
                    skip : state.incidentalerts.skip,
                    limit : state.incidentalerts.limit,
                    count: state.incidentalerts.count,
                    data: state.incidentalerts.data
                }
            });

        case types.INCIDENTS_ALERT_FETCH_FAILED:
            return Object.assign({}, state, {
                incidentalerts: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    count: 0,
                    skip:state.incidentalerts.skip,
                    limit:state.incidentalerts.limit,
                    data: []
                },
            });

        case types.INCIDENTS_ALERT_FETCH_RESET:
            return Object.assign({}, state, {
                incidentalerts: {
                    requesting: false,
                    error: null,
                    success: false,
                    count: 0,
                    skip : 0,
                    limit : 10,
                    data: []
                },
            });

        case types.SUBSCRIBERS_ALERT_FETCH_SUCCESS:
            return Object.assign({}, state, {
                subscribersAlert: {
                    requesting: false,
                    error: null,
                    success: true,
                    count : action.payload.count,
                    skip : action.payload.skip,
                    limit : action.payload.limit,
                    data: action.payload.data
                },
            });

        case types.SUBSCRIBERS_ALERT_FETCH_REQUEST:
            return Object.assign({}, state, {
                subscribersAlert: {
                    requesting: true,
                    success: false,
                    error: null,
                    skip : state.subscribersAlert.skip,
                    limit : state.subscribersAlert.limit,
                    count: state.subscribersAlert.count,
                    data: state.subscribersAlert.data
                }
            });

        case types.SUBSCRIBERS_ALERT_FETCH_FAILED:
            return Object.assign({}, state, {
                subscribersAlert: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    count: 0,
                    skip:state.subscribersAlert.skip,
                    limit:state.subscribersAlert.limit,
                    data: []
                },
            });

        case types.SUBSCRIBERS_ALERT_FETCH_RESET:
            return Object.assign({}, state, {
                subscribersAlert: {
                    requesting: false,
                    error: null,
                    success: false,
                    count: 0,
                    skip : 0,
                    limit : 10,
                    data: []
                },
            });
        default: return state;
    }
}
