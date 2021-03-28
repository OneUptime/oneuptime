import * as types from '../constants/group';

const initialState = {
    createGroup: { requesting: false, success: false, error: null },
    getGroups: { requesting: false, success: false, error: null },
    getProjectGroups: { requesting: false, success: false, error: null },
    deleteGroup: { requesting: false, success: false, error: null },
    updateGroup: { requesting: {}, success: false, error: null },
    groups: [],
    oncallDuty: [],
};

export default function groups(state = initialState, action) {
    let updatedGroup;
    switch (action.type) {
        case types.GET_GROUPS_REQUEST:
            return {
                ...state,
                getGroups: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.GET_GROUPS_FAILURE:
            return {
                ...state,
                getGroups: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.GET_GROUPS_SUCCESS:
            return {
                ...state,
                getGroups: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                groups: action.payload.data,
            };
        case types.CREATE_GROUP_REQUEST:
            return {
                ...state,
                createGroup: {
                    requesting: true,
                    success: true,
                    error: null,
                },
            };
        case types.CREATE_GROUP_FAILURE:
            return {
                ...state,
                createGroup: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.CREATE_GROUP_SUCCESS:
            return {
                ...state,
                createGroup: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        case types.UPDATE_GROUP_REQUEST:
            return {
                ...state,
                updateGroup: {
                    requesting: {
                        ...state.updateGroup.requesting,
                        [action.payload]: true,
                    },
                    success: false,
                    error: null,
                },
            };
        case types.UPDATE_GROUP_FAILURE:
            return {
                ...state,
                ...state,
                updateGroup: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.UPDATE_GROUP_SUCCESS:
            updatedGroup = state.groups.map(projectGroup => {
                if (projectGroup.project.id === action.payload.projectId._id) {
                    const groups = projectGroup.groups.groups.map(group => {
                        if (group._id === action.payload._id) {
                            return action.payload;
                        }
                        return group;
                    });
                    return {
                        groups: {
                            ...projectGroup.groups,
                            groups,
                        },
                        project: projectGroup.project,
                    };
                }
                return projectGroup;
            });
            return {
                ...state,
                updateGroup: {
                    requesting: {
                        ...state.updateGroup.requesting,
                        [action.payload._id]: false,
                    },
                    success: true,
                    error: null,
                },
                groups: updatedGroup,
            };
        case types.GET_PROJECT_GROUPS_REQUEST:
            return {
                ...state,
                getProjectGroups: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.GET_PROJECT_GROUPS_FAILURE:
            return {
                ...state,
                getProjectGroups: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.GET_PROJECT_GROUPS_SUCCESS:
            return {
                ...state,
                getProjectGroups: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                oncallDuty: action.payload,
                groups: state.groups.map(projectGroup => {
                    const projectId = action.payload.groups[0].projectId._id;
                    if (projectGroup.project.id === projectId) {
                        return {
                            project: projectGroup.project,
                            groups: action.payload,
                        };
                    }
                    return projectGroup;
                }),
            };
        case types.DELETE_GROUP_REQUEST:
            return {
                ...state,
                deleteGroup: {
                    requesting: true,
                    success: false,
                    error: null,
                },
            };
        case types.DELETE_GROUP_SUCCESS:
            return {
                ...state,
                deleteGroup: {
                    requesting: false,
                    success: true,
                    error: null,
                },
            };
        case types.DELETE_GROUP_FAILURE:
            return {
                ...state,
                deleteGroup: {
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };
        case types.RESET_ERROR_MESSAGE:
            return {
                ...state,
                createGroup: {
                    ...state.createGroup,
                    error: null,
                },
                updateGroup: {
                    ...state.updateGroup,
                    error: null,
                },
            };

        default:
            return state;
    }
}
