import BackendAPI from '../../api';
import { getErrorMessageFromResponse } from '../../utils/error';
import { Dispatch } from 'redux';
import ErrorPayload from 'CommonUI/src/payload-types/error';
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
        isRequestAllowed = true,
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
        const request =
            this.actionType.toUpperCase() + '_' + friendlyName + '_REQUEST';
        const success =
            this.actionType.toUpperCase() + '_' + friendlyName + '_SUCCESS';
        const failure =
            this.actionType.toUpperCase() + '_' + friendlyName + '_FAILURE';
        const reset =
            this.actionType.toUpperCase() + '_' + friendlyName + '_RESET';

        const constants = {
            request: request,
            success: success,
            failure: failure,
            reset: reset,
        };

        if (this.actionType === 'list') {
            //add pagination actions.

            constants.paginateNext =
                this.actionType.toUpperCase() +
                '_' +
                friendlyName +
                '_PAGINATE_NEXT';

            constants.paginatePrevious =
                this.actionType.toUpperCase() +
                '_' +
                friendlyName +
                '_PAGINATE_PREVIOUS';

            constants.paginateToPage =
                this.actionType.toUpperCase() +
                '_' +
                friendlyName +
                '_PAGINATE_TO_PAGE';
        }

        return constants;
    }

    getActions() {
        const constants = this.getConstants();

        const actions = {};

        actions[this.actionKeys.request] = function (): void {
            return {
                type: constants[this.constantKeys.request],
            };
        };

        actions[this.actionKeys.success] = function (data: $TSFixMe): void {
            return {
                type: constants[this.constantKeys.success],
                payload: data,
            };
        };

        actions[this.actionKeys.failure] = function (
            error: ErrorPayload
        ): void {
            return {
                type: constants[this.constantKeys.failure],
                payload: error,
            };
        };

        actions[this.actionKeys.apiCall] = async function (
            data: $TSFixMe
        ): void {
            if (this.isRequestAllowed) {
                throw 'This request is not allowed';
            }

            return async function (this: $TSFixMe, dispatch: Dispatch): void {
                let path = `${this.apiName}`;

                if (this.isResourceInProject) {
                    path += `/${data.projectId}`;
                }

                dispatch(actions[this.actionKeys.request]());
                let response = null;
                try {
                    if (this.actionType === 'create') {
                        response = await BackendAPI.post(path, data);
                    }

                    if (this.actionType === 'list') {
                        response = await BackendAPI.get(path, data);
                    }

                    if (this.actionType === 'get') {
                        response = await BackendAPI.get(path, data);
                    }

                    if (this.actionType === 'update') {
                        response = await BackendAPI.put(path, data);
                    }

                    if (this.actionType === 'delete') {
                        response = await delete (path, data);
                    }

                    const data = response.data;

                    dispatch(actions[this.actionKeys.success](data));
                } catch (error) {
                    dispatch(
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
