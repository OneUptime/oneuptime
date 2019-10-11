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
    },
    alertCharges: {
        requesting: false,
        error: null,
        success: false,
        count:0,
        skip:0,
        limit:10,
        data: []
    },
    downloadedAlertCharges: {
        requesting: false,
        error: null,
        success: false,
        count:0,
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
        case types.FETCH_ALERT_CHARGES_SUCCESS:
            return Object.assign({}, state, {
                alertCharges: {
                    requesting: false,
                    error: null,
                    success: true,
                    count : action.payload.count,
                    skip : action.payload.skip,
                    limit : action.payload.limit,
                    data: action.payload.data
                }
            });

        case types.FETCH_ALERT_CHARGES_REQUEST:
            return Object.assign({}, state, {
                alertCharges: {
                    requesting: true,
                    success: false,
                    error: null,
                    skip : state.alertCharges.skip,
                    limit : state.alertCharges.limit,
                    count: state.alertCharges.count,
                    data: state.alertCharges.data
                }
            });

        case types.FETCH_ALERT_CHARGES_FAILED:
            return Object.assign({}, state, {
                alertCharges: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    count: 0,
                    skip:state.alertCharges.skip,
                    limit:state.alertCharges.limit,
                    data: []
                }
            });

        case types.DOWNLOAD_ALERT_CHARGES_SUCCESS:
            return Object.assign({}, state, {
                downloadedAlertCharges: {
                    requesting: false,
                    error: null,
                    success: true,
                    count : action.payload.count,
                    data: action.payload.data.map(alertCharge => {
                        return {
                            ChargeAmount: alertCharge.chargeAmount,
                            ClosingAccountBalance: alertCharge.closingAccountBalance,
                            MonitorName: alertCharge.monitorId.name,
                            AlertType: alertCharge.alertId.alertVia,
                            Time: alertCharge.createdAt,
                            IncidentId: alertCharge.incidentId,
                            SentTo: alertCharge.sentTo
                        }
                    })
                }
            });

        case types.DOWNLOAD_ALERT_CHARGES_REQUEST:
            return Object.assign({}, state, {
                downloadedAlertCharges: {
                    requesting: true,
                    success: false,
                    error: null,
                    count: state.downloadedAlertCharges.count,
                    data: state.downloadedAlertCharges.data
                }
            });

        case types.DOWNLOAD_ALERT_CHARGES_FAILED:
            return Object.assign({}, state, {
                downloadedAlertCharges: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    count: 0,
                    data: []
                }
            });

        default: return state;
    }
}
