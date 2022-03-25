export type OpenModalActionPayload = {
    id: string;
    onClose: Function;
    content: string;
};

export type CloseModalActionPayload = {
    id: string;
};
