export interface Say {
    sayMessage: string;
}

export enum CallAction {
    Hangup = 'Hangup',
}

export default interface CallRequest {
    data: Array<Say | CallAction>;
}
