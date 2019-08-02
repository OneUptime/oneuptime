import {
    GET_SLACK_TEAM_REQUEST,
    GET_SLACK_TEAM_FAILED,
    GET_SLACK_TEAM_RESET,
    GET_SLACK_TEAM_SUCCESS,
    DELETE_SLACK_LINK_FAILED,
    DELETE_SLACK_LINK_REQUEST,
    DELETE_SLACK_LINK_RESET,
    DELETE_SLACK_LINK_SUCCESS
} from '../constants/slack';

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

export default (state = initialState, action) => {
    let teams, index, count;
    switch (action.type) {

        case GET_SLACK_TEAM_FAILED:
            return Object.assign({}, state, {
                teams: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                    teams : [],
                    count: null,
                    limit: null,
                    skip: null
                },
            });

        case GET_SLACK_TEAM_SUCCESS:
            return Object.assign({}, state, {
                teams: {
                    requesting: false,
                    success: true,
                    error: null,
                    teams: action.payload.data,
                    count: action.payload.count,
                    limit: action.payload.limit,
                    skip: action.payload.skip
                }
            });

        case GET_SLACK_TEAM_REQUEST:
            return Object.assign({}, state, {
                teams: {
                    requesting: true,
                    error: null,
                    success: false,
                    teams:[],
                    count: null,
                    limit: null,
                    skip: null
                },
            });

        case GET_SLACK_TEAM_RESET:
            return Object.assign({}, state, {
                teams:{
                    error:null, 
                    requesting: false, 
                    success:false,
                    teams:[],
                    count: null,
                    limit: null,
                    skip: null
                }
            });

        case DELETE_SLACK_LINK_FAILED:
            return Object.assign({}, state, {
                deleteTeam: {
                    requesting: false,
                    error: action.payload,
                    success: false
                },
            });

        case DELETE_SLACK_LINK_SUCCESS:

            teams = Object.assign([], state.teams.teams);
            index = teams.findIndex(team => team._id === action.payload._id);
            action.payload.n === 1 && action.payload.ok === 1 && teams.splice(index, 1);
            count = state.teams.count - 1;

            return Object.assign({}, state, {
                deleteTeam: {
                    requesting: false,
                    success: true,
                    error: null
                },
                teams: {
                    requesting: false,
                    success: true,
                    error: null,
                    teams,
                    skip: state.teams.skip,
                    limit: state.teams.limit,
                    count: count
                }
            });

        case DELETE_SLACK_LINK_REQUEST:
            return Object.assign({}, state, {
                deleteTeam: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case DELETE_SLACK_LINK_RESET:
            return Object.assign({}, state, {
                deleteTeam:{
                    error:null, 
                    requesting: false, 
                    success:false
                }
            });
        default: return state;
    }
}