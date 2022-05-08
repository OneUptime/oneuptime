import ApiBaseConstants from '../Constants/ApiBaseConstants';
import Action from '../Types/Action';
import {
    ApiRequest,
    ApiError,
    ApiSuccess,
} from '../PayloadTypes/ApiBasePayloadType';
import HTTPResponse from 'Common/Types/API/Response';
import HTTPErrorResponse from 'Common/Types/API/ErrorResponse';

export interface InitialStateType {
    requesting: boolean;
    data: HTTPResponse | null;
    error: HTTPErrorResponse | null;
    success: boolean;
}

export default class ApiBaseReducer {

    private _name: string;
    public get name(): string {
        return this._name;
    }

    constructor(name: string) {
        this._name = name;
    }

    private initialState: InitialStateType = {
        requesting: false,
        data: null,
        error: null,
        success: false,
    };

    public getInitialState(): InitialStateType {
        return this.initialState;
    }

    public getReducer(): Function {
        return (
            state: InitialStateType = this.initialState,
            action: Action
        ): InitialStateType => {
            switch (action.type) {
                case ApiBaseConstants.REQUEST + this.name:
                    return Object.assign({}, state, {
                        requesting: (action.payload as ApiRequest).requesting,
                    });
                case ApiBaseConstants.ERROR + this.name:
                    return Object.assign({}, state, {
                        error: (action.payload as ApiError).error,
                    });
                case ApiBaseConstants.RESET + this.name:
                    return Object.assign({}, state, this.initialState);
                case ApiBaseConstants.SUCCESS + this.name:
                    return Object.assign({}, state, {
                        success: (action.payload as ApiSuccess).data,
                    });
                default:
                    return state;
            }
        };
    }
}