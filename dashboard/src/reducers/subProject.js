import * as types from '../constants/subProject';

const initialState = {
  subProjects: {
    requesting: false,
    error: null,
    success: false,
    subProjects: [],
    count: null,
    skip:null,
    limit:null
  },
  newSubProject: {
    requesting: false,
    error: null,
    success: false,
    subProject: {}
  },
  resetToken: {
    success: false,
    requesting: false,
    error: null
  },
  renameSubProject: {
    success: false,
    requesting: false,
    error: null
  },
  deleteSubProject: {
    success: false,
    requesting: false,
    error: null
  },
  exitSubProject: {
    success: false,
    requesting: false,
    error: null
  },
  showDeleteModal: false
};

export default function subProject(state = initialState, action) {
  let subProjects, index;
  switch (action.type) {
    case types.SUBPROJECTS_SUCCESS:
      return Object.assign({}, state, {
        subProjects: {
          requesting: false,
          error: null,
          success: true,
          subProjects: action.payload.subProjects,
          count: action.payload.count,
          skip: action.payload.skip,
          limit: action.payload.limit
        }
      });

    case types.SUBPROJECTS_REQUEST:
      return Object.assign({}, state, {
        subProjects: {
          requesting: true,
          success: false,
          error: null,
          subProjects: state.subProjects.subProjects,
          count: state.subProjects.count,
          skip: state.subProjects.skip,
          limit: state.subProjects.limit
        }
      });

    case types.SUBPROJECTS_FAILED:
      return Object.assign({}, state, {
        subProjects: {
          requesting: false,
          error: action.payload,
          success: false,
          subProjects: [],
          count: null,
          skip: null,
          limit: null
        }
      });

    case types.SUBPROJECTS_RESET:
      return Object.assign({}, state, {
        subProjects: {
          requesting: false,
          error: null,
          success: false,
          subProjects: [],
          count: null,
          skip: null,
          limit: null
        }
      });

    case types.CREATE_NEW_SUBPROJECT_RESET:
      return Object.assign({}, state, {
        newSubProject: {
          requesting: false,
          error: null,
          success: false,
          subProject: {}
        }
      });

    case types.CREATE_SUBPROJECT_RESET:
      return Object.assign({}, state, {
        currentSubProject: null
      });

    case types.CREATE_SUBPROJECT_SUCCESS:
      return Object.assign({}, state, {
        newSubProject: {
          requesting: false,
          error: null,
          success: true,
          subProject: action.payload
        },
        subProjects: {
          requesting: false,
          error: null,
          success: true,
          subProjects: state.subProjects.subProjects.concat(action.payload),
          count: state.subProjects.count + 1,
          skip: state.subProjects.skip,
          limit: state.subProjects.limit
        }
      });

    case types.CREATE_SUBPROJECT_REQUEST:
      return Object.assign({}, state, {
        newSubProject: {
          requesting: true,
          success: false,
          error: null
        }
      });

    case types.CREATE_SUBPROJECT_FAILED:
      return Object.assign({}, state, {
        newSubProject: {
          requesting: false,
          error: action.payload,
          success: false
        }
      });

    case types.RESET_SUBPROJECT_TOKEN_SUCCESS:
      subProjects = Object.assign([], state.subProjects.subProjects);
      index = subProjects.findIndex(
        subProject => subProject._id === action.payload._id
      );
      subProjects[index] = action.payload;
      return Object.assign({}, state, {
        subProjects: {
          requesting: false,
          error: null,
          success: false,
          subProjects,
          count: state.subProjects.count,
          skip: state.subProjects.skip,
          limit: state.subProjects.limit
        },
        currentSubProject: action.payload,
        resetToken: {
          requesting: false,
          success: true,
          error: null
        }
      });

    case types.RESET_SUBPROJECT_TOKEN_REQUEST:
      return Object.assign({}, state, {
        resetToken: {
          requesting: true,
          success: false,
          error: null
        }
      });

    case types.RESET_SUBPROJECT_TOKEN_FAILED:
      return Object.assign({}, state, {
        resetToken: {
          requesting: false,
          success: false,
          error: action.payload
        }
      });

    case types.RESET_SUBPROJECT_TOKEN_RESET:
      return Object.assign({}, state, {
        resetToken: {
          requesting: false,
          success: false,
          error: null
        }
      });

    case types.RENAME_SUBPROJECT_SUCCESS:
      subProjects = Object.assign([], state.subProjects.subProjects);
      index = subProjects.findIndex(
        subProject => subProject._id === action.payload._id
      );
      subProjects[index] = action.payload;
      return Object.assign({}, state, {
        subProjects: {
          requesting: false,
          error: null,
          success: false,
          subProjects,
          count: state.subProjects.count,
          skip: state.subProjects.skip,
          limit: state.subProjects.limit
        },
        renameSubProject: {
          requesting: false,
          success: true,
          error: null
        }
      });

    case types.RENAME_SUBPROJECT_RESET:
      return Object.assign({}, state, {
        renameSubProject: {
          requesting: false,
          success: false,
          error: null
        }
      });

    case types.RENAME_SUBPROJECT_REQUEST:
      return Object.assign({}, state, {
        renameSubProject: {
          requesting: true,
          success: false,
          error: null
        }
      });

    case types.RENAME_SUBPROJECT_FAILED:
      return Object.assign({}, state, {
        renameSubProject: {
          requesting: false,
          success: false,
          error: action.payload
        }
      });

    case types.DELETE_SUBPROJECT_SUCCESS:
      subProjects = Object.assign([], state.subProjects.subProjects);
      subProjects = subProjects.filter(
        subProject => subProject._id !== action.payload
      );
      return Object.assign({}, state, {
        deleteSubProject: {
          requesting: false,
          success: action.payload.ok === 1,
          error: null
        },
        subProjects: {
          requesting: false,
          error: null,
          success: false,
          subProjects,
          count: state.subProjects.count - 1,
          skip: state.subProjects.skip,
          limit: state.subProjects.limit
        }
      });

    case types.DELETE_SUBPROJECT_REQUEST:
      return Object.assign({}, state, {
        deleteSubProject: {
          requesting: true,
          success: false,
          error: null
        }
      });

    case types.DELETE_SUBPROJECT_FAILED:
      return Object.assign({}, state, {
        deleteSubProject: {
          requesting: false,
          success: false,
          error: action.payload
        }
      });

    case types.DELETE_SUBPROJECT_RESET:
      return Object.assign({}, state, {
        deleteSubProject: {
          requesting: false,
          success: false,
          error: null
        }
      });

    case types.EXIT_SUBPROJECT_SUCCESS:
      return Object.assign({}, state, {
        exitSubProject: {
          requesting: false,
          error: null,
          success: true
        },
        currentSubProject: null
      });

    case types.EXIT_SUBPROJECT_REQUEST:
      return Object.assign({}, state, {
        exitSubProject: {
          requesting: true,
          success: false,
          error: null
        }
      });

    case types.EXIT_SUBPROJECT_FAILED:
      return Object.assign({}, state, {
        exitSubProject: {
          requesting: false,
          success: false,
          error: action.payload
        }
      });

    case types.CHANGE_SUBPROJECT_ROLES:
      return Object.assign({}, state, {
        currentSubProject: {
          ...state.currentSubProject,
          users: action.payload
        }
      });

    case types.SWITCH_SUBPROJECT:
      return Object.assign({}, state, {
        currentSubProject: action.payload
      });

    case types.SWITCH_SUBPROJECT_RESET:
      return Object.assign({}, state, {
        currentSubProject: null
      });

    default:
      return state;
  }
}
