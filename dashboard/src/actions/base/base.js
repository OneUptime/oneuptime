import { postApi, getApi, putApi, deleteApi } from '../api';
import { getErrorMessageFromResponse } from '../../utils/error';

class BaseAction {
    constructor({
        friendlyName,
        apiPath,
        isResourceInProject,
        actionType,
        isRequestAllowed = true,
    }) {
        if (!friendlyName) {
            throw new Error('friendlyName is required.');
        }

        if (!actionType) {
            throw new Error('actionType is required.');
        }

        this.FriendlyName = friendlyName;

        if (!apiPath) {
            this.ApiName = friendlyName.toLowerCase().replace(' ', '-');
        }

        this.isResourceInProject = isResourceInProject;
        this.actionType = actionType;
        this.isRequestAllowed = isRequestAllowed;

        this.constantKeys = {
            request: actionType.toUpperCase() + '_REQUEST',
            success: actionType.toUpperCase() + '_SUCCESS',
            failure: actionType.toUpperCase() + '_FAILURE',
            reset: actionType.toUpperCase() + '_RESET',
        };

        this.actionKeys = {
            request: actionType.toLowerCase() + 'Request',
            success: actionType.toLowerCase() + 'Success',
            failure: actionType.toLowerCase() + 'Failure',
            apiCall: actionType.toLowerCase(),
        };
    }

    getConstants() {
        const friendlyName = this.friendlyName.replace(' ', '_');
        const request = this.actionType + '_' + friendlyName + '_REQUEST';
        const success = this.actionType + '_' + friendlyName + '_SUCCESS';
        const failure = this.actionType + '_' + friendlyName + '_FAILURE';
        const reset = this.actionType + '_' + friendlyName + '_RESET';

        const constants = {
            [this.constantKeys.request]: request,
            [this.constantKeys.success]: success,
            [this.constantKeys.failure]: failure,
            [this.constantKeys.reset]: reset,
        };

        return constants;
    }

    getActions() {
        const constants = this.getConstants();

        const actions = {};

        actions[this.actionKeys.request] = function() {
            return {
                type: constants[this.constantKeys.request],
            };
        };

        actions[this.actionKeys.success] = function(data) {
            return {
                type: constants[this.constantKeys.success],
                payload: data,
            };
        };

        actions[this.actionKeys.failure] = function(error) {
            return {
                type: constants[this.constantKeys.failure],
                payload: error,
            };
        };

        actions[this.actionKeys.apiCall] = async function(data) {
            if (this.isRequestAllowed) {
                throw 'This request is not allowed';
            }

            return async function(dispatch) {
                let path = `${this.ApiName}`;

                if (this.isResourceInProject) {
                    path += `/${data.projectId}`;
                }

                dispatch(actions[this.actionKeys.request]());
                let response = null;
                try {
                    

                    if (this.actionType === 'create') {
                        response = await postApi(path, data);
                    }

                    if (this.actionType === 'list') {
                        response = await getApi(path, data);
                    }

                    if (this.actionType === 'get') {
                        response = await getApi(path, data);
                    }

                    if (this.actionType === 'update') {
                        response = await putApi(path, data);
                    }

                    if (this.actionType === 'delete') {
                        response = await deleteApi(path, data);
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
