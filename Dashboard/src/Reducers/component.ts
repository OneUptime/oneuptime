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
    FETCH_COMPONENT_RESOURCES_FAILURE,
    FETCH_COMPONENT_RESOURCES_REQUEST,
    FETCH_COMPONENT_RESOURCES_RESET,
    FETCH_COMPONENT_RESOURCES_SUCCESS,
    FETCH_COMPONENT_SUMMARY_REQUEST,
    FETCH_COMPONENT_SUMMARY_SUCCESS,
    FETCH_COMPONENT_SUMMARY_FAILURE,
    FETCH_COMPONENT_SUMMARY_RESET,
    SHOW_DELETE_MODAL,
    ADD_CURRENT_COMPONENT,
    HIDE_DELETE_MODAL,
    FETCH_COMPONENT_REQUEST,
    FETCH_COMPONENT_SUCCESS,
    FETCH_COMPONENT_FAILURE,
    FETCH_PAGINATED_COMPONENTS_FAILURE,
    FETCH_PAGINATED_COMPONENTS_REQUEST,
    FETCH_PAGINATED_COMPONENTS_SUCCESS,
} from '../constants/component';

import Action from 'CommonUI/src/types/action';

const INITIAL_STATE: $TSFixMe = {
    componentList: {
        components: [],
        error: null,
        requesting: false,
        success: false,
    },
    currentComponent: {
        requesting: false,
        error: null,
        success: false,
        component: null,
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
    componentResourceList: [],
    showDeleteModal: false,
    componentIssueList: [],
    componentSummary: {
        data: [],
        error: null,
        requesting: false,
        success: false,
    },
};

export default function component(state = INITIAL_STATE, action: Action): void {
    let components: $TSFixMe,
        isExistingComponent: $TSFixMe,
        failureComponentResourceList: $TSFixMe,
        requestComponentResourceList: $TSFixMe;
    switch (action.type) {
        case CREATE_COMPONENT_SUCCESS:
            isExistingComponent = state.componentList.components.find(
                component => {
                    return component._id === action.payload.projectId._id;
                }
            );
            return Object.assign({}, state, {
                ...state,

                newComponent: {
                    requesting: false,
                    error: null,
                    success: false,
                    component: null,
                },
                currentComponent: {
                    ...state.currentComponent,
                    component: action.payload,
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
                                                _id: action.payload.projectId
                                                    ._id,
                                                components: [
                                                    action.payload,

                                                    ...subProjectComponents.components,
                                                ],
                                                count:
                                                    subProjectComponents.count +
                                                    1,

                                                skip: subProjectComponents.skip,
                                                limit: subProjectComponents.limit,
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
        case SHOW_DELETE_MODAL:
            return Object.assign({}, state, {
                showDeleteModal: true,
            });

        case HIDE_DELETE_MODAL:
            return Object.assign({}, state, {
                showDeleteModal: false,
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
                currentComponent: INITIAL_STATE.currentComponent,
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

        case FETCH_PAGINATED_COMPONENTS_SUCCESS: {
            const updatedComponents: $TSFixMe =
                state.componentList.components.map((componentObj: $TSFixMe) => {
                    if (componentObj._id === action.payload._id) {
                        componentObj = action.payload;
                    }
                    return componentObj;
                });
            return {
                ...state,
                componentList: {
                    ...state.componentList,
                    components: updatedComponents,
                    [action.payload._id]: {
                        error: null,
                        requesting: false,
                    },
                },
            };
        }

        case FETCH_COMPONENTS_FAILURE:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: false,
                    error: action.payload,
                    success: false,
                },
            });

        case FETCH_PAGINATED_COMPONENTS_FAILURE:
            return {
                ...state,
                componentList: {
                    ...state.componentList,
                    [action.payload.projectId]: {
                        error: action.payload.error,
                        requesting: false,
                    },
                },
            };

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

        case FETCH_PAGINATED_COMPONENTS_REQUEST:
            return {
                ...state,
                componentList: {
                    ...state.componentList,
                    [action.payload]: {
                        error: null,
                        requesting: true,
                    },
                },
            };

        case EDIT_COMPONENT_SUCCESS:
            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    requesting: false,
                    error: null,
                    success: false,
                    components: state.componentList.components.map(
                        (project: $TSFixMe) => {
                            const subProject: $TSFixMe = Object.assign(
                                {},
                                project
                            );
                            const subProjectComponents: $TSFixMe =
                                subProject.components &&
                                subProject.components.slice();

                            const newComponent: $TSFixMe = Object.assign(
                                {},
                                action.payload
                            );

                            const componentIndex: $TSFixMe =
                                subProjectComponents &&
                                subProjectComponents.findIndex(
                                    (component: $TSFixMe) => {
                                        return (
                                            component._id === newComponent._id
                                        );
                                    }
                                );
                            const isSubProjectComponent: $TSFixMe =
                                componentIndex > -1;

                            if (subProject._id === newComponent.projectId._id) {
                                if (isSubProjectComponent) {
                                    const oldComponent: $TSFixMe =
                                        Object.assign(
                                            {},
                                            subProjectComponents[componentIndex]
                                        );

                                    if (!newComponent.skip) {
                                        newComponent.skip = oldComponent.skip;
                                    }
                                    if (!newComponent.limit) {
                                        newComponent.limit = oldComponent.limit;
                                    }
                                    if (!newComponent.count) {
                                        newComponent.count = oldComponent.count;
                                    }

                                    subProjectComponents[componentIndex] =
                                        newComponent;
                                } else {
                                    newComponent.skip = 0;
                                    newComponent.limit = 0;
                                    newComponent.count = 0;

                                    subProjectComponents.unshift(newComponent);

                                    subProject.count += 1;
                                }
                            } else {
                                if (isSubProjectComponent) {
                                    subProjectComponents.splice(
                                        componentIndex,
                                        1
                                    );

                                    subProject.count -= 1;
                                }
                            }

                            subProject.components = subProjectComponents;
                            return subProject;
                        }
                    ),
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
                                (component: $TSFixMe, i: $TSFixMe) => {
                                    if (
                                        i === action.payload ||
                                        component._id === action.payload
                                    ) {
                                        if (!component.editMode) {
                                            component.editMode = true;
                                        } else {
                                            component.editMode = false;
                                        }
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
                            subProjectComponent.components =
                                subProjectComponent.components.filter(
                                    ({ _id }: $TSFixMe) => {
                                        return _id !== action.payload;
                                    }
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
            components = components.filter(component => {
                return action.payload !== component.projectId;
            });

            return Object.assign({}, state, {
                componentList: {
                    ...state.componentList,
                    components,
                    error: null,
                    loading: false,
                },
                currentComponent: INITIAL_STATE.currentComponent,
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

        case FETCH_COMPONENT_RESOURCES_SUCCESS:
            return Object.assign({}, state, {
                componentResourceList: {
                    ...state.componentResourceList,
                    [action.payload.componentId]: {
                        requesting: false,
                        error: null,
                        success: false,
                        componentResources: action.payload.totalResources,
                    },
                },
            });

        case FETCH_COMPONENT_RESOURCES_FAILURE:
            failureComponentResourceList = {
                ...state.componentResourceList,
                [action.payload.componentId]: state.componentResourceList[
                    action.payload.componentId
                ]
                    ? {
                          ...state.componentResourceList[
                              action.payload.componentId
                          ],
                          error: action.payload.error,
                      }
                    : {
                          componentResourceList: [],
                          error: action.payload.error,
                          requesting: false,
                          success: false,
                      },
            };
            return Object.assign({}, state, {
                componentResourceList: failureComponentResourceList,
            });

        case FETCH_COMPONENT_RESOURCES_RESET:
            return Object.assign({}, state, {
                componentResourceList: INITIAL_STATE.componentResourceList,
            });

        case FETCH_COMPONENT_RESOURCES_REQUEST:
            requestComponentResourceList = {
                ...state.componentResourceList,
                [action.payload.componentId]: state.componentResourceList[
                    action.payload.componentId
                ]
                    ? {
                          ...state.componentResourceList[
                              action.payload.componentId
                          ],
                          requesting: true,
                      }
                    : {
                          componentResourceList: [],
                          error: null,
                          requesting: true,
                          success: false,
                      },
            };
            return Object.assign({}, state, {
                componentResourceList: requestComponentResourceList,
            });

        case FETCH_COMPONENT_SUMMARY_SUCCESS:
            return Object.assign({}, state, {
                componentSummary: {
                    data: action.payload.data,
                    error: null,
                    requesting: false,
                    success: true,
                },
            });

        case FETCH_COMPONENT_SUMMARY_FAILURE:
            return Object.assign({}, state, {
                componentSummary: {
                    data: [],
                    error: action.payload,
                    requesting: false,
                    success: false,
                },
            });

        case FETCH_COMPONENT_SUMMARY_RESET:
            return Object.assign({}, state, {
                componentSummary: {
                    data: [],
                    error: null,
                    requesting: false,
                    success: false,
                },
            });

        case FETCH_COMPONENT_SUMMARY_REQUEST:
            return Object.assign({}, state, {
                componentSummary: {
                    data: [],
                    error: null,
                    requesting: true,
                    success: false,
                },
            });

        case ADD_CURRENT_COMPONENT:
            return Object.assign({}, state, {
                currentComponent: {
                    ...state.currentComponent,
                    component: action.payload,
                },
            });

        case FETCH_COMPONENT_REQUEST:
            return {
                ...state,
                currentComponent: {
                    ...state.currentComponent,
                    requesting: true,
                    error: null,
                    success: false,
                },
            };

        case FETCH_COMPONENT_SUCCESS:
            return {
                ...state,
                currentComponent: {
                    requesting: false,
                    success: true,
                    error: null,
                    component: action.payload,
                },
            };

        case FETCH_COMPONENT_FAILURE:
            return {
                ...state,
                currentComponent: {
                    ...state.currentComponent,
                    requesting: false,
                    success: false,
                    error: action.payload,
                },
            };

        default:
            return state;
    }
}
