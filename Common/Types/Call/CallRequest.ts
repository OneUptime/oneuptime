export interface Say {
    sayMessage: string;
}

export interface GatherInput {
    introMessage: string;
    numDigits: number;
    timeoutInSeconds: number;
    noInputMessage: string;
    onInputCallRequest: {
        [x: string]: Say; // input. 
        default: Say; // what if there is no input or invalid input. 
    };
}

export enum CallAction {
    
}

export default interface CallRequest {
    data: Array<Say | CallAction | GatherInput>;
}
