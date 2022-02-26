import { postApi, getApi, putApi, deleteApi } from '../../api';
import { getErrorMessageFromResponse } from '../../utils/error';

class BaseAction {
    actionKeys: $TSFixMe;
    actionType: $TSFixMe;
    apiName: $TSFixMe;
    constantKeys: $TSFixMe;
    friendlyName: $TSFixMe;
    isRequestAllowed: $TSFixMe;
    isResourceInProject: $TSFixMe;
    constructor({
        friendlyName,
        apiPath,
        isResourceInProject,
        actionType,
        isRequestAllowed = true
    }: $TSFixMe) {
        if (!friendlyName) {
            throw new Error('friendlyName is required.');
        }

        if (!actionType) {
            throw new Error('actionType is required.');
        }

        this.friendlyName = friendlyName;

        if (!apiPath) {
            this.apiName = friendlyName.toLowerCase().replace(' ', '-');
        }

        this.isResourceInProject = isResourceInProject;
        this.actionType = actionType;
        this.isRequestAllowed = isRequestAllowed;

        this.actionKeys = {
            request: actionType.toLowerCase() + 'Request',
            success: actionType.toLowerCase() + 'Success',
            failure: actionType.toLowerCase() + 'Failure',
            apiCall: actionType.toLowerCase(),
        };
    }

    getConstants() {
        const friendlyName = this.friendlyName.replace(' ', '_').toUpperCase();
        const request = this.actionType.toUpperCase() + '_' + friendlyName + '_REQUEST';
        const success = this.actionType.toUpperCase() + '_' + friendlyName + '_SUCCESS';
        const failure = this.actionType.toUpperCase() + '_' + friendlyName + '_FAILURE';
        const reset = this.actionType.toUpperCase() + '_' + friendlyName + '_RESET';

        const constants = {
            request: request,
            success: success,
            failure: failure,
            reset: reset,
        };

        if(this.actionType === "list"){
            //add pagination actions. 
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginateNext' does not exist on type '{ ... Remove this comment to see the full error message
            constants.paginateNext = this.actionType.toUpperCase() + '_' + friendlyName + '_PAGINATE_NEXT';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginatePrevious' does not exist on type... Remove this comment to see the full error message
            constants.paginatePrevious = this.actionType.toUpperCase() + '_' + friendlyName + '_PAGINATE_PREVIOUS';
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'paginateToPage' does not exist on type '... Remove this comment to see the full error message
            constants.paginateToPage = this.actionType.toUpperCase() + '_' + friendlyName + '_PAGINATE_TO_PAGE';
        }

        return constants;
    }

    getActions() {
        const constants = this.getConstants();

        const actions = {};

        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        actions[this.actionKeys.request] = function () {
            return {
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                type: constants[this.constantKeys.request],
            };
        };

        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        actions[this.actionKeys.success] = function (data: $TSFixMe) {
            return {
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                type: constants[this.constantKeys.success],
                payload: data,
            };
        };

        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        actions[this.actionKeys.failure] = function (error: $TSFixMe) {
            return {
                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                type: constants[this.constantKeys.failure],
                payload: error,
            };
        };

        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        actions[this.actionKeys.apiCall] = async function (data: $TSFixMe) {
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'isRequestAllowed' does not exist on type... Remove this comment to see the full error message
            if (this.isRequestAllowed) {
                throw 'This request is not allowed';
            }

            return async function(this: $TSFixMe, dispatch: $TSFixMe) {
                let path = `${this.apiName}`;

                if (this.isResourceInProject) {
                    path += `/${data.projectId}`;
                }

                // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                dispatch(actions[this.actionKeys.request]());
                let response = null;
                try {
                    if (this.actionType === 'create') {
                        // @ts-expect-error ts-migrate(2448) FIXME: Block-scoped variable 'data' used before its decla... Remove this comment to see the full error message
                        response = await postApi(path, data);
                    }

                    if (this.actionType === 'list') {
                        // @ts-expect-error ts-migrate(2448) FIXME: Block-scoped variable 'data' used before its decla... Remove this comment to see the full error message
                        response = await getApi(path, data);
                    }

                    if (this.actionType === 'get') {
                        // @ts-expect-error ts-migrate(2448) FIXME: Block-scoped variable 'data' used before its decla... Remove this comment to see the full error message
                        response = await getApi(path, data);
                    }

                    if (this.actionType === 'update') {
                        // @ts-expect-error ts-migrate(2448) FIXME: Block-scoped variable 'data' used before its decla... Remove this comment to see the full error message
                        response = await putApi(path, data);
                    }

                    if (this.actionType === 'delete') {
                        // @ts-expect-error ts-migrate(2448) FIXME: Block-scoped variable 'data' used before its decla... Remove this comment to see the full error message
                        response = await deleteApi(path, data);
                    }

                    // @ts-expect-error ts-migrate(7022) FIXME: 'data' implicitly has type 'any' because it does n... Remove this comment to see the full error message
                    const data = response.data;

                    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                    dispatch(actions[this.actionKeys.success](data));
                } catch (error) {
                    dispatch(
                        // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
                        actions[this.actionKeys.failure](
                            getErrorMessageFromResponse(error)
                        )
                    );
                }

                return response;
            };
        };

        return actions;
    }
}

export default BaseAction;
