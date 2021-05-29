/* eslint-disable no-console */
import {
    FETCH_AUTOMATED_SCRIPT_SUCCESS,
    FETCH_AUTOMATED_SCRIPT_FAILURE,
    FETCH_AUTOMATED_SCRIPT_RESET,
    FETCH_AUTOMATED_SCRIPT_REQUEST,
    // CREATE_AUTOMATED_SCRIPT_SUCCESS,
    // CREATE_AUTOMATED_SCRIPT_FAILURE,
    CREATE_AUTOMATED_SCRIPT_REQUEST,
    EDIT_AUTOMATED_SCRIPT_SUCCESS,
    EDIT_AUTOMATED_SCRIPT_FAILURE,
    EDIT_AUTOMATED_SCRIPT_RESET,
    EDIT_AUTOMATED_SCRIPT_REQUEST,
    EDIT_AUTOMATED_SCRIPT_SWITCH,
} from '../constants/automatedScript';

const INITIAL_STATE = {
    scripts: [],
};

export default function component(state = INITIAL_STATE, action) {
    switch (action.type) {
        // case CREATE_AUTOMATED_SCRIPT_FAILURE:
        //     return Object.assign({}, state, {
        //         newComponent: {
        //             ...state.newComponent,
        //             requesting: false,
        //             error: action.payload,
        //             success: false,
        //         },
        //     });

        case CREATE_AUTOMATED_SCRIPT_REQUEST:
            return Object.assign({}, state, {
                newComponent: {
                    ...state.newComponent,
                    requesting: true,
                },
            });

        case FETCH_AUTOMATED_SCRIPT_SUCCESS:
            return Object.assign({}, state, {
                scripts: action.payload,
            });

        case FETCH_AUTOMATED_SCRIPT_FAILURE:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_AUTOMATED_SCRIPT_RESET:
            return Object.assign({}, state, {
                componentList: INITIAL_STATE.componentList,
            });

        case FETCH_AUTOMATED_SCRIPT_REQUEST:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case EDIT_AUTOMATED_SCRIPT_SUCCESS:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: false,
                    error: null,
                    success: false,
                    components: state.componentList.components.map(project => {
                        const subProject = Object.assign({}, project);
                        const subProjectComponents =
                            subProject.components &&
                            subProject.components.slice();

                        const newComponent = Object.assign({}, action.payload);

                        const componentIndex =
                            subProjectComponents &&
                            subProjectComponents.findIndex(
                                component => component._id === newComponent._id
                            );
                        const isSubProjectComponent = componentIndex > -1;

                        if (subProject._id === newComponent.projectId._id) {
                            if (isSubProjectComponent) {
                                const oldComponent = Object.assign(
                                    {},
                                    subProjectComponents[componentIndex]
                                );

                                if (!newComponent.skip)
                                    newComponent.skip = oldComponent.skip;
                                if (!newComponent.limit)
                                    newComponent.limit = oldComponent.limit;
                                if (!newComponent.count)
                                    newComponent.count = oldComponent.count;

                                subProjectComponents[
                                    componentIndex
                                ] = newComponent;
                            } else {
                                newComponent.skip = 0;
                                newComponent.limit = 0;
                                newComponent.count = 0;

                                subProjectComponents.unshift(newComponent);
                                subProject.count += 1;
                            }
                        } else {
                            if (isSubProjectComponent) {
                                subProjectComponents.splice(componentIndex, 1);
                                subProject.count -= 1;
                            }
                        }

                        subProject.components = subProjectComponents;
                        return subProject;
                    }),
                },
                editComponent: {
                    requesting: false,
                    error: null,
                    success: false,
                },
                currentComponent: {
                    ...state.currentComponent,
                    component: action.payload,
                },
            });

        case EDIT_AUTOMATED_SCRIPT_FAILURE:
            return Object.assign({}, state, {
                editComponent: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case EDIT_AUTOMATED_SCRIPT_RESET:
            return Object.assign({}, state, {
                editComponent: INITIAL_STATE.editComponent,
            });

        case EDIT_AUTOMATED_SCRIPT_REQUEST:
            return Object.assign({}, state, {
                editComponent: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case EDIT_AUTOMATED_SCRIPT_SWITCH:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: false,
                    error: null,
                    success: false,
                    components: state.componentList.components.map(
                        component => {
                            component.components = component.components.map(
                                (component, i) => {
                                    if (
                                        i === action.payload ||
                                        component._id === action.payload
                                    ) {
                                        if (!component.editMode)
                                            component.editMode = true;
                                        else component.editMode = false;
                                        return component;
                                    } else {
                                        component.editMode = false;
                                        return component;
                                    }
                                }
                            );
                            return component;
                        }
                    ),
                },
                editComponent: {
                    requesting: false,
                    error: null,
                    success: false,
                },
            });

        default:
            return state;
    }
}
