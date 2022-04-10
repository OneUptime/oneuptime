import ActionPayload from '../types/action-payload';

export interface OpenModalActionPayload extends ActionPayload {
    id: string;
    onClose: Function;
    content: string;
}

export interface CloseModalActionPayload extends ActionPayload {
    id: string;
}

export type PayloadTypes = CloseModalActionPayload | OpenModalActionPayload;
