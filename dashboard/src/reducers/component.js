/* eslint-disable no-console */
import {
    FETCH_COMPONENTS_SUCCESS,
    FETCH_COMPONENTS_FAILURE,
    FETCH_COMPONENTS_RESET,
    FETCH_COMPONENTS_REQUEST,
    CREATE_COMPONENT_SUCCESS,
    CREATE_COMPONENT_FAILURE,
    CREATE_COMPONENT_RESET,
    CREATE_COMPONENT_REQUEST,
    EDIT_COMPONENT_SUCCESS,
    EDIT_COMPONENT_FAILURE,
    EDIT_COMPONENT_RESET,
    EDIT_COMPONENT_REQUEST,
    EDIT_COMPONENT_SWITCH,
    DELETE_COMPONENT_SUCCESS,
    DELETE_COMPONENT_FAILURE,
    DELETE_COMPONENT_REQUEST,
    DELETE_PROJECT_COMPONENTS,
    ADD_SEAT_SUCCESS,
    ADD_SEAT_FAILURE,
    ADD_SEAT_REQUEST,
    ADD_SEAT_RESET,
} from '../constants/component';

const INITIAL_STATE = {
    componentList: {
        components: [],
        error: null,
        requesting: false,
        success: false,
    },
    newComponent: {
        component: null,
        error: null,
        requesting: false,
        success: false,
        initialValue: null,
    },
    editComponent: {
        error: null,
        requesting: false,
        success: false,
    },
    addseat: {
        error: null,
        requesting: false,
        success: false,
    },
    deleteComponent: false,
};

export default function component(state = INITIAL_STATE, action) {
    let components, isExistingComponent;
    switch (action.type) {
        case CREATE_COMPONENT_SUCCESS:
            isExistingComponent = state.componentList.components.find(
                component => component._id === action.payload.projectId._id
            );
            return Object.assign({}, state, {
                ...state,

                newComponent: {
                    requesting: false,
                    error: null,
                    success: false,
                    component: null,
                },
                componentList: {
                    ...state.componentList,

                    components: isExistingComponent
                        ? state.componentList.components.length > 0
                            ? state.componentList.components.map(
                                  subProjectComponents => {
                                      return subProjectComponents._id ===
                                          action.payload.projectId._id
                                          ? {
                                                _id:
                                                    action.payload.projectId
                                                        ._id,
                                                components: [
                                                    action.payload,
                                                    ...subProjectComponents.components,
                                                ],
                                                count:
                                                    subProjectComponents.count +
                                                    1,
                                                skip: subProjectComponents.skip,
                                                limit:
                                                    subProjectComponents.limit,
                                            }
                                          : subProjectComponents;
                                  }
                              )
                            : [
                                  {
                                      _id: action.payload.projectId,
                                      components: [action.payload],
                                      count: 1,
                                      skip: 0,
                                      limit: 0,
                                  },
                              ]
                        : [
                              {
                                  _id: action.payload.projectId,
                                  components: [action.payload],
                                  count: 1,
                                  skip: 0,
                                  limit: 0,
                              },
                          ].concat(state.componentList.components),
                },
            });

        case CREATE_COMPONENT_FAILURE:
            return Object.assign({}, state, {
                newComponent: {
                    ...state.newComponent,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case CREATE_COMPONENT_RESET:
            return Object.assign({}, state, {
                newComponent: INITIAL_STATE.newComponent,
            });

        case CREATE_COMPONENT_REQUEST:
            return Object.assign({}, state, {
                newComponent: {
                    ...state.newComponent,
                    requesting: true,
                },
            });

        case FETCH_COMPONENTS_SUCCESS:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: false,
                    error: null,
                    success: false,
                    components: action.payload,
                },
            });

        case FETCH_COMPONENTS_FAILURE:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_COMPONENTS_RESET:
            return Object.assign({}, state, {
                componentList: INITIAL_STATE.componentList,
            });

        case FETCH_COMPONENTS_REQUEST:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case EDIT_COMPONENT_SUCCESS:
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
            });

        case EDIT_COMPONENT_FAILURE:
            return Object.assign({}, state, {
                editComponent: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case EDIT_COMPONENT_RESET:
            return Object.assign({}, state, {
                editComponent: INITIAL_STATE.editComponent,
            });

        case EDIT_COMPONENT_REQUEST:
            return Object.assign({}, state, {
                editComponent: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case EDIT_COMPONENT_SWITCH:
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

        case DELETE_COMPONENT_SUCCESS:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: false,
                    error: null,
                    success: false,
                    components: state.componentList.components.map(
                        subProjectComponent => {
                            subProjectComponent.components = subProjectComponent.components.filter(
                                ({ _id }) => _id !== action.payload
                            );
                            return subProjectComponent;
                        }
                    ),
                },
                deleteComponent: false,
            });

        case DELETE_COMPONENT_FAILURE:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
                deleteComponent: false,
            });

        case DELETE_COMPONENT_REQUEST:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: false,
                    error: null,
                    success: false,
                },
                deleteComponent: action.payload,
            });

        case DELETE_PROJECT_COMPONENTS:
            components = Object.assign([], state.componentList.components);
            components = components.filter(
                component => action.payload !== component.projectId
            );

            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    components,
                    error: null,
                    loading: false,
                },
            });

        case ADD_SEAT_SUCCESS:
            return Object.assign({}, state, {
                addseat: {
                    requesting: false,
                    error: null,
                    success: action.payload,
                },
            });

        case ADD_SEAT_FAILURE:
            return Object.assign({}, state, {
                addseat: {
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case ADD_SEAT_REQUEST:
            return Object.assign({}, state, {
                addseat: {
                    requesting: true,
                    error: null,
                    success: false,
                },
            });

        case ADD_SEAT_RESET:
            return Object.assign({}, state, {
                addseat: {
                    requesting: false,
                    error: null,
                    success: false,
                },
            });

        default:
            return state;
    }
}
