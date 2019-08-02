
import alert from '../../reducers/alert'
import * as types from '../../constants/alert'

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
    }
};

describe('Alerts Reducers',()=>{

    it('should return initial state', () => {
        expect(alert(initialState,{})).toEqual(initialState)
    });
    it('should handle ALERT_FETCH_SUCCESS action', () => {
        const payload = {
            data:[{_id:'test'}],
            limit:50,
            skip:10
        }
        const expected = {
            requesting: false,
            error: null,
            success: true,
            data: payload.data,
            count: payload.count,
            limit: payload.limit,
            skip: payload.skip
        }
        const reducer = alert(initialState,{
            type:types.ALERT_FETCH_SUCCESS,
            payload:payload
        })
        expect(reducer.alerts).toEqual(expected)
    });
    it('should handle ALERT_FETCH_REQUEST action', () => {
        const payload = {
            alerts:[{_id:'test'}],
            limit:50,
            skip:10
        }
        const expected = {
            requesting: true,
            success: false,
            error: null,
            data: [],
            count: null,
            limit: null,
            skip: null
        }
        const reducer = alert(initialState,{type:types.ALERT_FETCH_REQUEST})
        expect(reducer.alerts).toEqual(expected)
    });

    it('should handle ALERT_FETCH_FAILED action', () => {
        const payload = 'error that will occur';
        const expected = {
            requesting: false,
            error: payload,
            success: false,
            data: [],
            count: null,
            limit: null,
            skip: null
        }
        const reducer = alert(null,{type:types.ALERT_FETCH_FAILED,payload:payload})
        expect(reducer.alerts).toEqual(expected)
    });

    it('should handle ALERT_FETCH_RESET action', () => {
        const expected = {
            requesting: false,
            error: null,
            success: false,
            data: [],
            count: null,
            limit: null,
            skip: null
        };
        const reducer = alert(initialState,{type:types.ALERT_FETCH_RESET})
        expect(reducer.alerts).toEqual(expected)
    });

    it('should handle INCIDENTS_ALERT_FETCH_SUCCESS action', () => {
        const payload = {
            data:[{_id:'test alerts'}],
            limit:50,
            skip:10
        }
        const expected = {
            requesting: false,
            error: null,
            success: true,
            data: payload.data,
            count: payload.count,
            limit: payload.limit,
            skip: payload.skip
        }
        const reducer = alert(initialState,{
            type:types.INCIDENTS_ALERT_FETCH_SUCCESS,
            payload:payload
        })
        expect(reducer.incidentalerts).toEqual(expected)
    });

    it('should handle INCIDENTS_ALERT_FETCH_REQUEST action', () => {
        const payload = {
            alerts:[{_id:'test alerts'}],
            limit:50,
            skip:10
        }
        const expected = {
            requesting: true,
            success: false,
            error: null,
            skip : initialState.incidentalerts.skip,
            limit : initialState.incidentalerts.limit,
            count: initialState.incidentalerts.count,
            data: initialState.incidentalerts.data
        }
        const reducer = alert(initialState,{type:types.INCIDENTS_ALERT_FETCH_REQUEST,payload:payload})
        expect(reducer.incidentalerts).toEqual(expected)
    });

    it('should handle INCIDENTS_ALERT_FETCH_FAILED action', () => {
        const payload = 'error that will occur'
        const expected = {
            requesting: false,
            error: payload,
            success: false,
            count: 0,
            skip:initialState.incidentalerts.skip,
            limit:initialState.incidentalerts.limit,
            data: []
        }
        const reducer = alert(initialState,{type:types.INCIDENTS_ALERT_FETCH_FAILED,payload:payload})
        expect(reducer.incidentalerts).toEqual(expected)
    });

    it('should handle INCIDENTS_ALERT_FETCH_RESET action', () => {        
        const reducer = alert(initialState,{type:types.INCIDENTS_ALERT_FETCH_RESET})
        expect(reducer.incidentalerts).toEqual(initialState.incidentalerts)
    });
});
