
import reducer from '../../reducers/login'
import * as types from '../../constants/login'

const initialState = {
	requesting: false,
	user: {},
	error: null,
	success: false
};


describe('Login Reducers',()=>{

    it('should return initial state', () => {
        expect(reducer(initialState,{})).toEqual(initialState)
    });

    it('should handle LOGIN_REQUEST', () => {
        const expected = {
            requesting: true,
            user: {},
            error: null,
            success: false
        };
        expect(reducer(initialState,{type:types.LOGIN_REQUEST})).toEqual(expected)
    });

    it('should handle LOGIN_SUCCESS', () => {
        const expected = {
            requesting: false,
            user: {},
            error: null,
            success: true
        };
        expect(reducer(initialState,{type:types.LOGIN_SUCCESS})).toEqual(expected)
    });

    it('should handle LOGIN_FAILED', () => {
        const expected = {
            requesting: false,
            user: {},
            error: 'error LOGIN_FAILED',
            success: false
        };
        expect(reducer(initialState,{type:types.LOGIN_FAILED,payload:'error LOGIN_FAILED'})).toEqual(expected)
    });

    it('should handle LOGIN_REQUEST', () => {
        expect(reducer(initialState,{type:types.RESET_LOGIN})).toEqual(initialState)
    });

});
