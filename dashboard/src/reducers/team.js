import {
	TEAM_DELETE_REQUEST,
	TEAM_DELETE_SUCCESS,
	TEAM_DELETE_FAILURE,
	TEAM_LOADING_REQUEST,
	TEAM_LOADING_SUCCESS,
	TEAM_LOADING_FAILURE,
	TEAM_MEMBER_REQUEST,
	TEAM_MEMBER_SUCCESS,
	TEAM_MEMBER_FAILURE,
	TEAM_SUBPROJECT_LOADING_REQUEST,
	TEAM_SUBPROJECT_LOADING_SUCCESS,
	TEAM_SUBPROJECT_LOADING_FAILURE,
	TEAM_CREATE_REQUEST,
	TEAM_CREATE_SUCCESS,
	TEAM_CREATE_FAILURE,
	TEAM_UPDATE_ROLE_REQUEST,
	TEAM_UPDATE_ROLE_SUCCESS,
	TEAM_UPDATE_ROLE_FAILURE,
	PAGINATE_NEXT,
	PAGINATE_PREV,
	PAGINATE_RESET,
	TEAM_DELETE_RESET
} from '../constants/team';


const initialState = {
	teamLoading: {
		error: null,
		requesting: false,
		success: false,
	},
	subProjectTeamLoading: {
		error: null,
		requesting: false,
		success: false,
	},
	teamCreate: {
		error: null,
		requesting: false,
		success: false,
	},
	teamUpdateRole: {
		error: null,
		requesting: false,
		success: false,
		updating: []
	},
	teamdelete: {
		error: null,
		requesting: false,
		success: false,
		deleting: []
	},
	teamMember: {
		error: null,
		requesting: false,
		success: false,
		member: null
	},
	teamMembers: [],
	subProjectTeamMembers: [],
	pages: {}
};

export default (state = initialState, action) => {
	switch (action.type) {

		case TEAM_LOADING_REQUEST:
			return {
				...state,
				teamLoading: {
					...state.teamLoading,
					error: null,
					requesting: true,
					success: false,
				}
			};

		case TEAM_LOADING_SUCCESS:
			{
				const team = action.payload;
				return {
					...state,
					teamLoading: {
						error: null,
						requesting: false,
						success: true,
					},
					teamMembers: team
				};
			}

		case TEAM_LOADING_FAILURE:
			return {
				...state,
				teamLoading: {
					...state.teamLoading,
					error: action.payload,
					requesting: false,
					success: false,
				}
			};


		case TEAM_SUBPROJECT_LOADING_REQUEST:
			return {
				...state,
				teamLoading: {
					...state.teamLoading,
					error: null,
					requesting: true,
					success: false,
				}
			};

		case TEAM_SUBPROJECT_LOADING_SUCCESS:
			{
				const teamMembers = action.payload;
				return {
					...state,
					teamLoading: {
						...state.teamLoading,
						error: null,
						requesting: false,
						success: true,
					},
					subProjectTeamMembers: teamMembers
				};
			}

		case TEAM_SUBPROJECT_LOADING_FAILURE:
			return {
				...state,
				teamLoading: {
					...state.teamLoading,
					error: action.payload,
					requesting: false,
					success: false,
				}
			};

		case TEAM_CREATE_FAILURE:
			return {
				...state,
				teamCreate: {
					...state.teamCreate,
					error: action.payload,
					requesting: false,
					success: false,
				},
			};

		case TEAM_CREATE_SUCCESS:
			return {
				...state,
				teamCreate: {
					...state.teamCreate,
					error: null,
					requesting: false,
					success: true,
				},
				// teamMembers: action.payload
				subProjectTeamMembers: state.subProjectTeamMembers.map(subProject => {
					subProject.teamMembers = action.payload.find(team => team.projectId === subProject._id).team
					subProject.count = action.payload.find(team => team.projectId === subProject._id).team.length
					return subProject
				})
			};

		case TEAM_CREATE_REQUEST:
			return {
				...state,
				teamCreate: {
					...state.teamCreate,
					error: null,
					requesting: true,
					success: false,
				}
			};

		case TEAM_DELETE_REQUEST:
			return {
				...state,
				teamdelete: {
					...state.teamdelete,
					error: null,
					requesting: true,
					success: false,
					deleting: state.teamdelete.deleting.concat([action.payload])
				},
			};

		case TEAM_DELETE_SUCCESS:
			return {
				...state,
				teamdelete: {
					...state.teamdelete,
					error: null,
					requesting: false,
					success: true,
					deleting: []
				},
				// teamMembers: action.payload.data,
				subProjectTeamMembers: state.subProjectTeamMembers.map(subProject => {
					subProject.teamMembers = action.payload.find(team => team.projectId === subProject._id).team
					subProject.count = action.payload.find(team => team.projectId === subProject._id).team.length
					return subProject
				})
			};

		case TEAM_DELETE_FAILURE:
			return {
				...state,
				teamdelete: {
					...state.teamdelete,
					error: action.payload,
					requesting: false,
					success: false,
					deleting: []
				},
			};

		case TEAM_DELETE_RESET:
			return {
				...state,
				teamdelete: {
					...state.teamdelete,
					error: null,
					requesting: false,
					success: false,
					deleting: []
				},
			};

		case TEAM_MEMBER_REQUEST:
			return {
				...state,
				teamMember: {
					...state.teamMember,
					error: null,
					requesting: true,
					success: false,
					member: action.payload
				},
			};

		case TEAM_MEMBER_SUCCESS:
			return {
				...state,
				teamMember: {
					...state.teamMember,
					error: null,
					requesting: false,
					success: true,
					member: action.payload
				}
			};

		case TEAM_MEMBER_FAILURE:
			return {
				...state,
				teamMember: {
					...state.teamMember,
					error: action.payload,
					requesting: false,
					success: false,
					member: []
				}
			};

		case TEAM_UPDATE_ROLE_REQUEST:
			return {
				...state,
				teamUpdateRole: {
					...state.teamUpdateRole,
					error: null,
					requesting: true,
					success: false,
					updating: state.teamUpdateRole.updating.concat([action.payload])
				},
			};

		case TEAM_UPDATE_ROLE_SUCCESS:
			return {
				...state,
				teamUpdateRole: {
					...state.teamUpdateRole,
					error: null,
					requesting: false,
					success: true,
					updating: []
				},
				// teamMembers: teamMembers,
				subProjectTeamMembers: state.subProjectTeamMembers.map(subProject => {
					subProject.teamMembers = action.payload.find(team => team.projectId === subProject._id).team
					subProject.count = action.payload.find(team => team.projectId === subProject._id).team.length
					return subProject
				})
			};

		case TEAM_UPDATE_ROLE_FAILURE:
			return {
				...state,
				teamUpdateRole: {
					...state.teamUpdateRole,
					error: action.payload,
					requesting: false,
					success: false,
					updating: []
				},
			};

		case PAGINATE_NEXT:
			return {
				...state,
				pages: {
					...state.pages,
					[action.payload]: state.pages[action.payload] ? state.pages[action.payload] + 1 : 2
				}
			}

		case PAGINATE_PREV:
			return {
				...state,
				pages: {
					...state.pages,
					[action.payload]: state.pages[action.payload] ? state.pages[action.payload] - 1 : 1
				}
			}

		case PAGINATE_RESET:
			return {
				...state,
				pages: {}
			}

		default: return state;
	}
};