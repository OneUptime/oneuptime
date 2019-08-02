
import reducer from '../../reducers/profile'
import * as types from '../../constants/profile'

const initialState = {
    menuVisible: false,
    profileSetting: {
        error: null,
        requesting: false,
        success: false,
        data: {}
    },
    onCallAlertSetting: {
        error: null,
        requesting: false,
        success: false,
    },
    changePasswordSetting: {
        error: null,
        requesting: false,
        success: false,
    },
    file: null
};

describe('Profile Reducers',()=>{

    it('should return initial state', () => {
        expect(reducer(initialState,{})).toEqual(initialState)
    });

    it('should handle UPDATE_PROFILE_SETTING_REQUEST', () => {
        let expected = {
            ...initialState,
            profileSetting: {
                requesting: true,
                error: null,
                success: false,
            }
        }
        expect(reducer(initialState,{type:types.UPDATE_PROFILE_SETTING_REQUEST})).toEqual(expected)
    });

    it('should handle UPDATE_PROFILE_SETTING_SUCCESS', () => {
        const payload = ['some test results']
        let expected = {
            ...initialState,
            profileSetting: {
                requesting: false,
                error: null,
                success: true,
                data:payload
            }
        }
        expect(reducer(initialState,{type:types.UPDATE_PROFILE_SETTING_SUCCESS, payload:payload})).toEqual(expected)
    });

    it('should handle UPDATE_PROFILE_SETTING_FAILURE', () => {
        const payload = 'some error that occurred'
        let expected = {
            ...initialState,
            profileSetting: {
                requesting: false,
                error: payload,
                success: false,
            }
        }
        expect(reducer(initialState,{type:types.UPDATE_PROFILE_SETTING_FAILURE, payload:payload})).toEqual(expected)
    });

    it('should handle UPDATE_PROFILE_SETTING_RESET', () => {

        expect(reducer(initialState,{type:types.UPDATE_PROFILE_SETTING_RESET})).toEqual(initialState)

    });


    it('should handle UPDATE_CHANGE_PASSWORD_SETTING_REQUEST', () => {
        let expected = {
            ...initialState,
            changePasswordSetting: {
                requesting: true,
                error: null,
                success: false,
            }
        }
        expect(reducer(initialState,{type:types.UPDATE_CHANGE_PASSWORD_SETTING_REQUEST})).toEqual(expected)
    });

    it('should handle UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS', () => {
        let expected = {
            ...initialState,
            changePasswordSetting: {
                requesting: false,
                    error: null,
                    success: true,
            }
        }
        expect(reducer(initialState,{type:types.UPDATE_CHANGE_PASSWORD_SETTING_SUCCESS})).toEqual(expected)
    });

    it('should handle UPDATE_CHANGE_PASSWORD_SETTING_FAILURE', () => {
        const payload ='error occurred'
        let expected = {
            ...initialState,
            changePasswordSetting: {
                requesting: false,
                error: payload,
                success: false,
            }
        }
        expect(reducer(initialState,{type:types.UPDATE_CHANGE_PASSWORD_SETTING_FAILURE, payload:payload})).toEqual(expected)
    });

    it('should handle UPDATE_CHANGE_PASSWORD_SETTING_RESET', () => {

        expect(reducer(initialState,{type:types.UPDATE_CHANGE_PASSWORD_SETTING_RESET})).toEqual(initialState)

    });

    it('should handle SHOW_PROFILE_MENU', () => {
        const expected = {
            ...initialState,
            menuVisible: true
        }
        expect(reducer(initialState,{type:types.SHOW_PROFILE_MENU})).toEqual(expected)

    });

    it('should handle HIDE_PROFILE_MENU', () => {
        const expected = {
            ...initialState,
            menuVisible: false
        }
        expect(reducer(initialState,{type:types.HIDE_PROFILE_MENU})).toEqual(expected)

    });

    it('should handle USER_SETTINGS_REQUEST', () => {
        const expected = {
            ...initialState,
            profileSetting: {
                error: null,
                requesting: true,
                success: false,
                data: {}
            }
        }
        expect(reducer(initialState,{type:types.USER_SETTINGS_REQUEST})).toEqual(expected)

    });


    it('should handle USER_SETTINGS_SUCCESS', () => {
        const payload = {props:'from payload'}
        const expected = {
            ...initialState,
            profileSetting: {
                error: null,
                requesting: false,
                success: false,
                data: payload
            }
        }
        expect(reducer(initialState,{type:types.USER_SETTINGS_SUCCESS,payload:payload})).toEqual(expected)

    });

    it('should handle USER_SETTINGS_FAILURE', () => {
        const payload ='error occurred'
        let expected = {
            ...initialState,
            profileSetting: {
                error: payload,
                requesting: false,
                success: false,
                data: {}
            }
        }
        expect(reducer(initialState,{type:types.USER_SETTINGS_FAILURE, payload:payload})).toEqual(expected)
    });

    it('should handle USER_SETTINGS_RESET', () => {
        const expected = {
            ...initialState,
            profileSetting: {
                error: null,
                requesting: false,
                success: false,
                data: {}
            }
        }
        expect(reducer(initialState,{type:types.USER_SETTINGS_RESET})).toEqual(expected)

    });

    it('should handle LOG_FILE', () => {
        let payload = 'assume its a file'
        const expected = {
            ...initialState,
            file: payload
        }
        expect(reducer(initialState,{type:'LOG_FILE',payload:payload})).toEqual(expected)

    });

    it('should handle RESET_FILE', () => {
        const expected = {
            ...initialState,
            file: null
        }
        expect(reducer(initialState,{type:'RESET_FILE'})).toEqual(expected)

    });

});
