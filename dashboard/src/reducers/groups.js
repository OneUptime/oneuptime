import * as types from '../constants/group';

const initialState = {
    createGroup: { requesting: false, success: false, error: null },
    getGroups: { requesting: false, success: false, error: null },
    deleteGroup: { requesting: false, success: false, error: null },
    updateGroup: { requesting: false, success: false, error: null },
    groups: [],
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
                    requesting: true,
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
                if (projectGroup.project.id === action.payload.projectId) {
                    const k = projectGroup.groups.groups.map(group => {
                        if (group._id === action.payload._id) {
                            return action.payload;
                        }
                        return group;
                    });
                    return {
                        groups: {
                            ...projectGroup.groups,
                            groups: k,
                        },
                        project: projectGroup.project,
                    };
                }
                return projectGroup;
            });
            return {
                ...state,
                updateGroup: {
                    requesting: false,
                    success: true,
                    error: null,
                },
                groups: updatedGroup,
            };

        default:
            return state;
    }
}
