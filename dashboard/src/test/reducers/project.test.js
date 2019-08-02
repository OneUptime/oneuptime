
import reducer from '../../reducers/project'
import * as types from '../../constants/project'

const initialState = {
    projects: {
        requesting: false,
        error: null,
        success: false,
        projects: []
    },
    currentProject: null,
    newProject: {
        requesting: false,
        error: null,
        success: false,
        project: {}
    },
    projectSwitcherVisible: false,
    resetToken: {
        success: false,
        requesting: false,
        error: null
    },
    renameProject: {
        success: false,
        requesting: false,
        error: null
    },
    changePlan: {
        success: false,
        requesting: false,
        error: null
    },
    deleteProject: {
        success: false,
        requesting: false,
        error: null
    },
    exitProject: {
        success: false,
        requesting: false,
        error: null
    },
    showForm: false,
    showDeleteModal: false
};

describe('Project Reducers',()=>{

    it('should return initial state', () => {
        expect(reducer(initialState,{})).toEqual(initialState)
    });

    it('should handle PROJECTS_SUCCESS', () => {
        const payload = {prop:'from payload'}
        const expected = {
            ...initialState,
            projects: {
                requesting: false,
                error: null,
                success: true,
                projects: payload
            }
        }
        expect(reducer(initialState,{type:types.PROJECTS_SUCCESS,payload:payload})).toEqual(expected)
    });
    
    it('should handle PROJECTS_REQUEST', () => {
        const payload = {prop:'from payload'}
        const expected = {
            ...initialState,
            projects: {
                requesting: true,
                error: null,
                success: false,
            }
        }
        expect(reducer(initialState,{type:types.PROJECTS_REQUEST,payload:payload})).toEqual(expected)
    });

    it('should handle PROJECTS_FAILED', () => {
        const payload = 'some error'
        const expected = {
            ...initialState,
            projects: {
                requesting: false,
                error: payload,
                success: false,
                projects: []
            }
        }
        expect(reducer(initialState,{
            type:types.PROJECTS_FAILED,
            payload:payload
        })).toEqual(expected)
    });

    it('should handle PROJECTS_RESET', () => {
        const expected = {
            ...initialState,
            projects: {
                requesting: false,
                error: null,
                success: false,
                projects: []
            }
        }
        expect(reducer(initialState,{type:types.PROJECTS_RESET})).toEqual(expected)
    });

    it('should handle SWITCH_PROJECT', () => {
        const payload = {_id:'_id'}
        const expected = {
            ...initialState,
            currentProject: payload
        }
        expect(reducer(initialState,{type:types.SWITCH_PROJECT,payload:payload})).toEqual(expected)
    });

    it('should handle SWITCH_PROJECT_RESET', () => {
        const expected = {
            ...initialState,
            currentProject: null
        }
        expect(reducer(initialState,{type:types.SWITCH_PROJECT_RESET})).toEqual(expected)
    });

    it('should handle CREATE_PROJECT_RESET', () => {
        const expected = {
            ...initialState,
            currentProject: null
        }
        expect(reducer(initialState,{type:types.CREATE_PROJECT_RESET})).toEqual(expected)
    });

    it('should handle CREATE_PROJECT_SUCCESS', () => {
        const payload = {_id:'_id'}
        const expected = {
            ...initialState,
            newProject: {
                requesting: false,
                error: null,
                success: true,
                project: payload
            },
            currentProject: payload,
            projects: {
                requesting: false,
                error: null,
                success: true,
                projects: [payload]
            }
        }
        expect(reducer(initialState,{type:types.CREATE_PROJECT_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle CREATE_PROJECT_REQUEST', () => {
        const expected = {
            ...initialState,
            newProject: {
                requesting: true,
                success: false,
                error: null
            }
        }
        expect(reducer(initialState,{type:types.CREATE_PROJECT_REQUEST})).toEqual(expected)
    });

    it('should handle CREATE_PROJECT_FAILED', () => {
        const payload = 'some error'
        const expected = {
            ...initialState,
            newProject: {
                requesting: false,
                error: payload,
                success: false,
            }
        }
        expect(reducer(initialState,{type:types.CREATE_PROJECT_FAILED,payload:payload})).toEqual(expected)
    });

    it('should handle RESET_PROJECT_TOKEN_SUCCESS', () => {
        initialState.projects.projects = [{_id:'_id'}]
        const payload = {_id:'_id'}
        const expected = {
            ...initialState,
            projects: {
                requesting: false,
                error: null,
                success: false,
                projects: [{_id:'_id'}]
            },
            currentProject: payload,
            resetToken: {
                requesting: false,
                success: true,
                error: null
            }
        }
        expect(reducer(initialState,{type:types.RESET_PROJECT_TOKEN_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle RESET_PROJECT_TOKEN_REQUEST', () => {
        const expected = {
            ...initialState,
            resetToken: {
                requesting: true,
                success: false,
                error: null
            }
        }
        expect(reducer(initialState,{type:types.RESET_PROJECT_TOKEN_REQUEST})).toEqual(expected)
    });

    it('should handle RESET_PROJECT_TOKEN_FAILED', () => {
        const payload = 'some error'
        const expected = {
            ...initialState,
            resetToken: {
                requesting: false,
                success: false,
                error: payload,
            }
        }
        expect(reducer(initialState,{type:types.RESET_PROJECT_TOKEN_FAILED, payload:payload})).toEqual(expected)
    });

    it('should handle RESET_PROJECT_TOKEN_RESET', () => {
        const expected = {
            ...initialState,
            resetToken: {
                requesting: false,
                success: false,
                error: null,
            }
        }
        expect(reducer(initialState,{type:types.RESET_PROJECT_TOKEN_RESET})).toEqual(expected)
    });

    it('should handle RENAME_PROJECT_SUCCESS', () => {
        initialState.projects.projects = [{_id:'_id'}]
        const payload = {_id:'_id'}
        const expected = {
            ...initialState,
            projects: {
                requesting: false,
                error: null,
                success: false,
                projects:[{_id:'_id'}]
            },
            currentProject: payload,
            renameProject: {
                requesting: false,
                success: true,
                error: null
            }
        }
        expect(reducer(initialState,{type:types.RENAME_PROJECT_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle RENAME_PROJECT_RESET', () => {
        const expected = {
            ...initialState,
            renameProject: {
                requesting: false,
                success: false,
                error: null
            }
        }
        expect(reducer(initialState,{type:types.RENAME_PROJECT_RESET})).toEqual(expected)
    });

    it('should handle RENAME_PROJECT_REQUEST', () => {
        const expected = {
            ...initialState,
            renameProject: {
                requesting: true,
                success: false,
                error: null
            }
        }
        expect(reducer(initialState,{type:types.RENAME_PROJECT_REQUEST})).toEqual(expected)
    });

    it('should handle RENAME_PROJECT_FAILED', () => {
        const payload = 'some error'
        const expected = {
            ...initialState,
            renameProject: {
                requesting: false,
                success: false,
                error: payload
            }
        }
        expect(reducer(initialState,{type:types.RENAME_PROJECT_FAILED, payload:payload})).toEqual(expected)
    });

    it('should handle DELETE_PROJECT_SUCCESS', () => {
        initialState.projects.projects = [{_id:'_id'}]
        const payload = {ok:1}
        const expected = {
            ...initialState,
            deleteProject: {
                requesting: false,
                success:true,
                error: null
            },
            projects: {
                requesting: false,
                error: null,
                success: false,
                projects:initialState.projects.projects
            }
        }
        expect(reducer(initialState,{type:types.DELETE_PROJECT_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle DELETE_PROJECT_SUCCESS', () => {
        initialState.projects.projects = [{_id:'_id'}]
        const payload = {ok:0}
        const expected = {
            ...initialState,
            deleteProject: {
                requesting: false,
                success:false,
                error: null
            },
            projects: {
                requesting: false,
                error: null,
                success: false,
                projects:initialState.projects.projects
            }
        }
        expect(reducer(initialState,{type:types.DELETE_PROJECT_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle DELETE_PROJECT_REQUEST', () => {
        const expected = {
            ...initialState,
            deleteProject: {
                requesting: true,
                success: false,
                error: null
            }
        }
        expect(reducer(initialState,{type:types.DELETE_PROJECT_REQUEST})).toEqual(expected)
    });

    it('should handle DELETE_PROJECT_FAILED', () => {
        const payload = 'some error'
        const expected = {
            ...initialState,
            deleteProject: {
                requesting: false,
                success: false,
                error: payload
            }
        }
        expect(reducer(initialState,{type:types.DELETE_PROJECT_FAILED, payload:payload})).toEqual(expected)
    });

    it('should handle DELETE_PROJECT_RESET', () => {
        const expected = {
            ...initialState,
            deleteProject: {
                requesting: false,
                success: false,
                error: null,
            }
        }
        expect(reducer(initialState,{type:types.DELETE_PROJECT_RESET})).toEqual(expected)
    });

    it('should handle SHOW_PROJECT_SWITCHER', () => {
        const expected = {
            ...initialState,
            projectSwitcherVisible: true
        }
        expect(reducer(initialState,{type:types.SHOW_PROJECT_SWITCHER})).toEqual(expected)
    });

    it('should handle HIDE_PROJECT_SWITCHER', () => {
        const expected = {
            ...initialState,
            projectSwitcherVisible: false
        }
        expect(reducer(initialState,{type:types.HIDE_PROJECT_SWITCHER})).toEqual(expected)
    });

    it('should handle SHOW_PROJECT_FORM', () => {
        const expected = {
            ...initialState,
            showForm: true
        }
        expect(reducer(initialState,{type:types.SHOW_PROJECT_FORM})).toEqual(expected)
    });

    it('should handle HIDE_PROJECT_FORM', () => {
        const expected = {
            ...initialState,
            showForm: false
        }
        expect(reducer(initialState,{type:types.HIDE_PROJECT_FORM})).toEqual(expected)
    });

    it('should handle SHOW_DELETE_MODAL', () => {
        const expected = {
            ...initialState,
            showDeleteModal: true
        }
        expect(reducer(initialState,{type:types.SHOW_DELETE_MODAL})).toEqual(expected)
    });

    it('should handle HIDE_DELETE_MODAL', () => {
        const expected = {
            ...initialState,
            showDeleteModal: false
        }
        expect(reducer(initialState,{type:types.HIDE_DELETE_MODAL})).toEqual(expected)
    });

    it('should handle CHANGE_PLAN_SUCCESS', () => {
        initialState.projects.projects = [{_id:'_id'}]
        const payload = {_id:'_id'}
        const expected = {
            ...initialState,
            projects: {
                requesting: false,
                error: null,
                success: false,
                projects:initialState.projects.projects
            },
            currentProject: payload,
            changePlan: {
                requesting: false,
                success: true,
                error: null
            }
        }
        expect(reducer(initialState,{type:types.CHANGE_PLAN_SUCCESS,payload:payload})).toEqual(expected)
    });

    it('should handle CHANGE_PLAN_RESET', () => {
        const expected = {
            ...initialState,
            changePlan: {
                requesting: false,
                success: false,
                error: null
            }
        }
        expect(reducer(initialState,{type:types.CHANGE_PLAN_RESET})).toEqual(expected)
    });
    it('should handle CHANGE_PLAN_REQUEST', () => {
        const expected = {
            ...initialState,
            changePlan: {
                requesting: true,
                    success: false,
                    error: null
            }
        }
        expect(reducer(initialState,{type:types.CHANGE_PLAN_REQUEST})).toEqual(expected)
    });

    it('should handle CHANGE_PLAN_FAILED', () => {
        const payload = 'some error'
        const expected = {
            ...initialState,
            changePlan: {
                requesting: false,
                success: false,
                error: payload
            }
        }
        expect(reducer(initialState,{type:types.CHANGE_PLAN_FAILED, payload:payload})).toEqual(expected)
    });

    it('should handle EXIT_PROJECT_SUCCESS', () => {
        const expected = {
            ...initialState,
            exitProject: {
                requesting: false,
                error: null,
                success: true,
            },
            currentProject: null
        }
        expect(reducer(initialState,{type:types.EXIT_PROJECT_SUCCESS})).toEqual(expected)
    });

    it('should handle EXIT_PROJECT_REQUEST', () => {
        const expected = {
            ...initialState,
            exitProject: {
                requesting: true,
                success: false,
                error: null
            }
        }
        expect(reducer(initialState,{type:types.EXIT_PROJECT_REQUEST})).toEqual(expected)
    });

    it('should handle EXIT_PROJECT_FAILED', () => {
        const payload = 'some error'
        const expected = {
            ...initialState,
            exitProject: {
                requesting: false,
                success: false,
                error: payload,
            }
        }
        expect(reducer(initialState,{type:types.EXIT_PROJECT_FAILED, payload:payload})).toEqual(expected)
    });

    it('should handle CHANGE_PROJECT_ROLES', () => {
        const payload = [{_id:'_id'}]
        const expected = {
            ...initialState,
            currentProject : {
                ...initialState.currentProject,
                users:payload
            }
        }
        expect(reducer(initialState,{type:types.CHANGE_PROJECT_ROLES, payload:payload})).toEqual(expected)
    });

});
