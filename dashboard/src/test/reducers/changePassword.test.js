
import reducer from '../../reducers/changePassword'
import * as types from '../../constants/changePassword'

const initialState = {
	requesting: false,
	error: null,
	success: false
};


describe('Change password Reducers',()=>{

    it('should return initial state', () => {
        expect(reducer(initialState,{})).toEqual(initialState)
    });
    
    it('should handle CHANGEPASSWORD_REQUEST ', () => {
        const expected = {
            requesting: true,
            error: null,
            success: false  
        }
        expect(reducer(initialState,{type:types.CHANGEPASSWORD_REQUEST})).toEqual(expected)
    });

    it('should handle CHANGEPASSWORD_SUCCESS', () => {
        const expected = {
            requesting: false,
            error: null,
            success: true  
        }
        expect(reducer(initialState,{type:types.CHANGEPASSWORD_SUCCESS})).toEqual(expected)
    });

    it('should handle CHANGEPASSWORD_FAILED', () => {
        const expected = {
            requesting: false,
            error: 'error that will occur',
            success: false  
        }
        expect(reducer(initialState,{type:types.CHANGEPASSWORD_FAILED,payload:expected.error})).toEqual(expected)
    });

    it('should handle RESET_CHANGEPASSWORD ', () => {
        expect(reducer(initialState,{type:types.RESET_CHANGEPASSWORD})).toEqual(initialState)
    });
});
