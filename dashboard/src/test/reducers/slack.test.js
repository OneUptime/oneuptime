import reducer from '../../reducers/slack'
import * as types from '../../constants/slack'

const initialState = {
    teams:{
        error:null, 
        requesting: false, 
        success:false,
        teams:[],
        count: null,
        limit: null,
        skip: null
    },
    deleteTeam: {
        error:null, 
        requesting: false, 
        success:false,
    },
    pages: {
		counter: 0
	}
};

describe('Slack Integration Reducers',()=>{

    it('should return initial state', () => {
        expect(reducer(initialState,{})).toEqual(initialState)
    });

    it('should handle GET_SLACK_TEAM_SUCCESS', () => {
        const payload = { data: [{_id:'_id'}], count: 1, skip: 0, limit: 10};
        const expected  = {
            ...initialState,
            teams: {
                requesting: false,
                error: null,
                success: true,
                teams: payload.data,
                count: payload.count,
                limit: payload.limit,
                skip: payload.skip
            },
        };        
        expect(reducer(initialState,{type:types.GET_SLACK_TEAM_SUCCESS, payload:payload})).toEqual(expected)
    });

    it('should handle GET_SLACK_TEAM_REQUEST', () => {
        initialState.teams.teams = [{_id:'_id'}]
        const expected  = {
            ...initialState,
            teams: {
                requesting: true,
                success: false,
                error: null,
                teams:[],
                count: null,
                limit: null,
                skip: null
            }
        };        
        expect(reducer(initialState,{type:types.GET_SLACK_TEAM_REQUEST})).toEqual(expected)
    });

    it('should handle GET_SLACK_TEAM_FAILED', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            teams: {
                requesting: false,
                error: payload,
                success: false,
                teams: [],
                count: null,
                limit: null,
                skip: null
            },
        };        
        expect(reducer(initialState,{type:types.GET_SLACK_TEAM_FAILED,payload:payload})).toEqual(expected)
    });

    it('should handle GET_SLACK_TEAM_RESET', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            teams: {
                requesting: false,
                error: null,
                success: false,
                teams: [],
                count: null,
                limit: null,
                skip: null
            },
        };        
        expect(reducer(initialState,{type:types.GET_SLACK_TEAM_RESET})).toEqual(expected)
    });

    it('should handle DELETE_SLACK_LINK_SUCCESS', () => {
        initialState.teams.teams = [{_id:'_id', name:'Slack team name'}]
        const payload = [{_id:'_id', name:'Slack team name'}];
        const count = initialState.teams.count - 1;
        const expected  = {
            ...initialState,
            teams: {
                requesting: false,
                error: null,
                success: true,
                teams: payload,
                skip: initialState.teams.skip,
                limit: initialState.teams.limit,
                count: count
            },
            deleteTeam: {
                requesting: false,
                error: null,
                success: true
            }
        };        
        expect(reducer(initialState,{type:types.DELETE_SLACK_LINK_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle DELETE_SLACK_LINK_REQUEST', () => {
        const expected  = {
            ...initialState,
            deleteTeam: {
                requesting: true,
                success: false,
                error: null
            }
        };        
        expect(reducer(initialState,{type:types.DELETE_SLACK_LINK_REQUEST})).toEqual(expected)
    });

    it('should handle DELETE_SLACK_LINK_FAILED', () => {
        const payload = 'some error'
        const expected  = {
            ...initialState,
            deleteTeam: {
                requesting: false,
                error: payload,
                success: false,
            },
        };        
        expect(reducer(initialState,{type:types.DELETE_SLACK_LINK_FAILED,payload:payload})).toEqual(expected)
    });

    it('should handle DELETE_SLACK_LINK_RESET', () => {
        const expected  = {
            ...initialState,
            deleteTeam: {
                requesting: false,
                success: false,
                error: null
            },
        };        
        expect(reducer(initialState,{type:types.DELETE_SLACK_LINK_RESET})).toEqual(expected)
    });

    it('should handle PAGINATE_NEXT', () => {
        const expected  = {
            ...initialState,
            pages: {
                counter: 0
            }
        };        
        expect(reducer(initialState,{type:types.PAGINATE_NEXT})).toEqual(expected)
    });

    it('should handle PAGINATE_PREV', () => {
        const expected  = {
            ...initialState,
            pages: {
                counter: 0
            }
        };        
        expect(reducer(initialState,{type:types.PAGINATE_PREV})).toEqual(expected)
    });

    it('should handle PAGINATE_RESET', () => {
        const expected  = {
            ...initialState,
            pages: {
                counter: 0
            }
        };        
        expect(reducer(initialState,{type:types.PAGINATE_RESET})).toEqual(expected)
    });
});