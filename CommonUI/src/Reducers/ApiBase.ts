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
    private constants: ApiBaseConstants;
    private _name: string;
   

    public get name(): string {
        return this._name;
    }

    constructor(name: string) {
        this._name = name;
        this.constants = new ApiBaseConstants(this.name);
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
                case this.constants.REQUEST + this.name:
                    return Object.assign({}, state, {
                        requesting: (action.payload as ApiRequest).requesting,
                    });
                case this.constants.ERROR + this.name:
                    return Object.assign({}, state, {
                        error: (action.payload as ApiError).errorResponse,
                    });
                case this.constants.RESET + this.name:
                    return Object.assign({}, state, this.initialState);
                case this.constants.SUCCESS + this.name:
                    return Object.assign({}, state, {
                        success: (action.payload as ApiSuccess).response,
                    });
                default:
                    return state;
            }
        };
    }
}