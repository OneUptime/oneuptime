
import reducer from '../../reducers/notifications'
import * as types from '../../constants/notification'

const initialState = {
    notifications:{
        error:null, 
        requesting: false, 
        success:false,
        notifications:[]
    },
    notificationsVisible:false
};


describe('Notification Reducers',()=>{

    it('should return initial state', () => {
        expect(reducer(initialState,{})).toEqual(initialState)
    });

    it('should handle OPEN_NOTIFICATION_MENU', () => {
        const expected  = {
            notifications:{
                ...initialState.notifications
            },
            notificationsVisible: true
        };        
        expect(reducer(initialState,{type:types.OPEN_NOTIFICATION_MENU})).toEqual(expected)
    });

    it('should handle CLOSE_NOTIFICATION_MENU', () => {
        const expected  = {
            notifications:{
                ...initialState.notifications
            },
            notificationsVisible: false
        };        
        expect(reducer(initialState,{type:types.CLOSE_NOTIFICATION_MENU})).toEqual(expected)
    });

    it('should handle FETCH_NOTIFICATIONS_FAILED', () => {
        const expected  = {
            notifications:{
                ...initialState.notifications,
                error:'error FETCH_NOTIFICATIONS_FAILED'
            },
            notificationsVisible: false
        };        
        expect(reducer(initialState,{type:types.FETCH_NOTIFICATIONS_FAILED,payload:'error FETCH_NOTIFICATIONS_FAILED'})).toEqual(expected)
    });

    it('should handle FETCH_NOTIFICATIONS_SUCCESS', () => {
        const expected  = {
            notifications:{
                ...initialState.notifications,
                notifications:[{_id:'test FETCH_NOTIFICATIONS_SUCCESS'}],
                success:true
            },
            notificationsVisible: false
        };        
        expect(reducer(initialState,{
            type:types.FETCH_NOTIFICATIONS_SUCCESS,
            payload:{data: [{_id:'test FETCH_NOTIFICATIONS_SUCCESS'}]}
        })).toEqual(expected)
    });

    it('should handle FETCH_NOTIFICATIONS_REQUEST', () => {
        const expected  = {
            notifications:{
                ...initialState.notifications,
                requesting:true
            },
            notificationsVisible: false
        };        
        expect(reducer(initialState,{type:types.FETCH_NOTIFICATIONS_REQUEST})).toEqual(expected)
    });

    it('should handle FETCH_NOTIFICATIONS_RESET', () => {
        const expected  = {
            notifications:{
                ...initialState.notifications,
            },
            notificationsVisible: false
        };        
        expect(reducer(initialState,{type:types.FETCH_NOTIFICATIONS_RESET})).toEqual(expected)
    });

    it('should handle ADD_NOTIFICATION_BY_SOCKET', () => {
        const expected  = {
            notifications:{
                ...initialState.notifications,
                success:true,
                notifications: [{_id:'test ADD_NOTIFICATION_BY_SOCKET'}]
            },
            notificationsVisible: false
        };        
        expect(reducer(initialState,{type:'ADD_NOTIFICATION_BY_SOCKET',payload:{_id:'test ADD_NOTIFICATION_BY_SOCKET'}})).toEqual(expected)
    });

    it('should handle NOTIFICATION_READ_SUCCESS', () => {
        initialState.notifications.notifications = [{_id:'test ADD_NOTIFICATION_BY_SOCKET',read:[]}]
        const expected  = {
            notifications:{
                ...initialState.notifications,
                notifications: [{_id:'test ADD_NOTIFICATION_BY_SOCKET',read:['test NOTIFICATION_READ_SUCCESS']}]
            },
            notificationsVisible: false
        };        
        expect(reducer(initialState,{
            type:types.NOTIFICATION_READ_SUCCESS,
            payload:{notificationId:{_id: 'test ADD_NOTIFICATION_BY_SOCKET'},userId:'test NOTIFICATION_READ_SUCCESS'}
        })).toEqual(expected)
    });

    it('should handle NOTIFICATION_READ_SUCCESS, different notificationId ', () => {
        initialState.notifications.notifications = [{_id:'test ADD_NOTIFICATION_BY_SOCKET',read:[]}]
        const expected  = {
            notifications:{
                ...initialState.notifications,
                notifications: [{_id:'test ADD_NOTIFICATION_BY_SOCKET',read:[]}]
            },
            notificationsVisible: false
        };        
        expect(reducer(initialState,{type:types.NOTIFICATION_READ_SUCCESS,payload:{notificationId:'_test ADD_NOTIFICATION_BY_SOCKET',userId:'test NOTIFICATION_READ_SUCCESS'}})).toEqual(expected)
    });

});
