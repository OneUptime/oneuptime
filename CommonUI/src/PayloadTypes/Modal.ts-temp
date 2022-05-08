import ActionPayload from '../types/action-payload';
import ObjectID from 'Common/Types/ObjectID';

export interface OpenModalActionPayload extends ActionPayload {
    id: ObjectID;
    onClose: Function;
    content: string;
}

export interface CloseModalActionPayload extends ActionPayload {
    id: ObjectID;
}

export type PayloadTypes = CloseModalActionPayload | OpenModalActionPayload;
