import URL from "../API/URL";

export interface Say {
    sayMessage: string;
}

export interface OnCallInputRequest {
    [x: string]: Say; // input. 
    default: Say; // what if there is no input or invalid input. 
}

export interface GatherInput {
    introMessage: string;
    numDigits: number;
    timeoutInSeconds: number;
    noInputMessage: string;
    onInputCallRequest: OnCallInputRequest;
    responseUrl: URL;
}

export enum CallAction {
    
}

export default interface CallRequest {
    data: Array<Say | CallAction | GatherInput>;
}
